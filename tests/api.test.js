const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createDb } = require('../src/db');
const { gradeQuiz } = require('../src/progress');

describe('Student Learning API', () => {
  const app = createApp({ db: createDb(':memory:') });
  const tokens = {};
  const ids = {};
  const as = (who) => ({ Authorization: `Bearer ${tokens[who]}` });

  before(async () => {
    for (const who of ['admin', 'instructor', 'student', 'student2']) {
      const res = await request(app).post('/api/auth/register')
        .send({ name: who, email: `${who}@test.dev`, password: 'Password123!', programme: 'BSc' }).expect(201);
      tokens[who] = res.body.token;
      ids[who] = res.body.user.id;
    }
    await request(app).patch(`/api/users/${ids.instructor}/role`).set(as('admin')).send({ role: 'instructor' }).expect(200);
  });

  test('student registration assigns role and a student number', async () => {
    const res = await request(app).get('/api/auth/me').set(as('student')).expect(200);
    assert.equal(res.body.user.role, 'student');
    assert.match(res.body.user.student_number, /^STU\d{4}\d{4}$/);
    const admin = await request(app).get('/api/auth/me').set(as('admin')).expect(200);
    assert.equal(admin.body.user.role, 'admin');
    assert.equal(admin.body.user.student_number, null);
  });

  test('validation and profile updates', async () => {
    await request(app).post('/api/auth/register').send({ name: 'x', email: 'student@test.dev', password: 'Password123!' }).expect(409);
    await request(app).post('/api/auth/register').send({ name: 'x', email: 'y@test.dev', password: 'short' }).expect(400);
    await request(app).put('/api/auth/me').set(as('student')).send({ new_password: 'NewPassword1', current_password: 'wrong' }).expect(400);
    const r = await request(app).put('/api/auth/me').set(as('student')).send({ phone: '0821234567' }).expect(200);
    assert.equal(r.body.user.phone, '0821234567');
  });

  test('only instructors/admins create courses; admin-only user list', async () => {
    await request(app).post('/api/courses').set(as('student')).send({ code: 'X1', title: 'X' }).expect(403);
    await request(app).get('/api/users').set(as('instructor')).expect(403);
    const res = await request(app).post('/api/courses').set(as('instructor'))
      .send({ code: 'CS101', title: 'Intro to CS', category: 'Programming', level: 'beginner', capacity: 1 }).expect(201);
    ids.course = res.body.course.id;
    await request(app).post('/api/courses').set(as('instructor')).send({ code: 'cs101', title: 'Dup' }).expect(409);
  });

  test('cannot publish an empty course; drafts are hidden from students', async () => {
    await request(app).patch(`/api/courses/${ids.course}/publish`).set(as('instructor')).send({ published: true }).expect(400);
    const list = await request(app).get('/api/courses').set(as('student')).expect(200);
    assert.equal(list.body.courses.length, 0);
    await request(app).get(`/api/courses/${ids.course}`).set(as('student')).expect(404);
  });

  test('instructor adds lessons with a quiz and publishes', async () => {
    await request(app).post(`/api/courses/${ids.course}/lessons`).set(as('instructor'))
      .send({ title: 'Bad quiz', quiz: [{ question: 'Q', options: ['a'], correct_index: 0 }] }).expect(400);
    const l1 = await request(app).post(`/api/courses/${ids.course}/lessons`).set(as('instructor'))
      .send({ title: 'Variables', content: 'x = 1', duration_minutes: 15 }).expect(201);
    const l2 = await request(app).post(`/api/courses/${ids.course}/lessons`).set(as('instructor')).send({
      title: 'Loops', duration_minutes: 20,
      quiz: [
        { question: 'Which loop runs at least once?', options: ['for', 'while', 'do…while'], correct_index: 2 },
        { question: '2 + 2 = ?', options: ['3', '4'], correct_index: 1 },
      ],
    }).expect(201);
    ids.l1 = l1.body.lesson.id; ids.l2 = l2.body.lesson.id;
    assert.equal(l2.body.lesson.position, 2);
    await request(app).patch(`/api/courses/${ids.course}/publish`).set(as('instructor')).send({ published: true }).expect(200);
  });

  test('enrolment rules: lessons locked before enrolment, capacity enforced, no double enrolment', async () => {
    await request(app).get(`/api/lessons/${ids.l1}`).set(as('student')).expect(403);
    await request(app).post(`/api/courses/${ids.course}/enroll`).set(as('instructor')).expect(403);
    const e = await request(app).post(`/api/courses/${ids.course}/enroll`).set(as('student')).expect(201);
    assert.equal(e.body.enrollment.status, 'active');
    assert.equal(e.body.progress.percent, 0);
    await request(app).post(`/api/courses/${ids.course}/enroll`).set(as('student')).expect(409);
    const full = await request(app).post(`/api/courses/${ids.course}/enroll`).set(as('student2')).expect(409);
    assert.match(full.body.error, /full/);
  });

  test('students do not receive quiz answers', async () => {
    const res = await request(app).get(`/api/lessons/${ids.l2}`).set(as('student')).expect(200);
    assert.equal(res.body.questions.length, 2);
    assert.equal(res.body.questions[0].correct_index, undefined);
    assert.equal(res.body.previous.id, ids.l1);
    const inst = await request(app).get(`/api/lessons/${ids.l2}`).set(as('instructor')).expect(200);
    assert.equal(inst.body.questions[0].correct_index, 2);
  });

  test('progress tracking: complete lesson, quiz gate, failing and passing quiz, course completion', async () => {
    const p1 = await request(app).post(`/api/lessons/${ids.l1}/complete`).set(as('student')).expect(200);
    assert.equal(p1.body.progress.percent, 50);
    assert.equal(p1.body.progress.minutes_studied, 15);

    await request(app).post(`/api/lessons/${ids.l2}/complete`).set(as('student')).expect(422);
    const fail = await request(app).post(`/api/lessons/${ids.l2}/quiz`).set(as('student')).send({ answers: [0, 0] }).expect(200);
    assert.equal(fail.body.passed, false);
    assert.equal(fail.body.score, 0);
    await request(app).post(`/api/lessons/${ids.l2}/quiz`).set(as('student')).send({ answers: [2] }).expect(400);

    const pass = await request(app).post(`/api/lessons/${ids.l2}/quiz`).set(as('student')).send({ answers: [2, 1] }).expect(200);
    assert.equal(pass.body.passed, true);
    assert.equal(pass.body.percent, 100);
    assert.equal(pass.body.progress.percent, 100);
    assert.equal(pass.body.enrollment_status, 'completed');
    assert.equal(pass.body.progress.average_quiz_score, 100);
  });

  test('adding a lesson re-opens a completed enrolment; undo completion works', async () => {
    const l3 = await request(app).post(`/api/courses/${ids.course}/lessons`).set(as('instructor')).send({ title: 'Functions' }).expect(201);
    const course = await request(app).get(`/api/courses/${ids.course}`).set(as('student')).expect(200);
    assert.equal(course.body.course.enrollment.status, 'active');
    assert.equal(course.body.course.progress.percent, 67);
    const done = await request(app).post(`/api/lessons/${l3.body.lesson.id}/complete`).set(as('student')).expect(200);
    assert.equal(done.body.enrollment_status, 'completed');
    const undo = await request(app).delete(`/api/lessons/${l3.body.lesson.id}/complete`).set(as('student')).expect(200);
    assert.equal(undo.body.enrollment_status, 'active');
  });

  test('roster and dashboards', async () => {
    const roster = await request(app).get(`/api/courses/${ids.course}/roster`).set(as('instructor')).expect(200);
    assert.equal(roster.body.students.length, 1);
    assert.equal(roster.body.students[0].progress.completed_lessons, 2);
    await request(app).get(`/api/courses/${ids.course}/roster`).set(as('student')).expect(403);

    const sd = await request(app).get('/api/dashboard').set(as('student')).expect(200);
    assert.equal(sd.body.role, 'student');
    assert.equal(sd.body.summary.lessons_completed, 2);
    assert.equal(sd.body.courses[0].next_lesson.title, 'Functions');
    const ad = await request(app).get('/api/dashboard').set(as('admin')).expect(200);
    assert.equal(ad.body.summary.students, 2);
  });

  test('drop and re-enrol', async () => {
    await request(app).delete(`/api/courses/${ids.course}/enroll`).set(as('student')).expect(200);
    const mine = await request(app).get('/api/courses?mine=1').set(as('student')).expect(200);
    assert.equal(mine.body.courses.length, 0);
    const again = await request(app).post(`/api/courses/${ids.course}/enroll`).set(as('student')).expect(201);
    assert.equal(again.body.progress.completed_lessons, 2, 'previous progress is kept');
  });

  test('gradeQuiz helper', () => {
    const qs = [{ id: 1, correct_index: 0 }, { id: 2, correct_index: 1 }, { id: 3, correct_index: 2 }];
    assert.equal(gradeQuiz(qs, [0, 1, 0]).passed, true);  // 2/3 = 67%
    assert.equal(gradeQuiz(qs, [0, 0, 0]).passed, false); // 1/3 = 33%
  });

  test('malformed input returns 400/404 instead of crashing', async () => {
    await request(app).post('/api/auth/register').send({ name: 'n', email: 'num@test.dev', password: 12345678 }).expect(400);
    await request(app).post('/api/auth/register').send({ name: 'n', email: ['a@test.dev'], password: 'Password123!' }).expect(400);
    await request(app).post('/api/auth/login').send({ email: { $ne: 1 }, password: 'x' }).expect(401);
    await request(app).put('/api/auth/me').set(as('student')).send({ current_password: 'Password123!', new_password: 123456789 }).expect(400);
    await request(app).get('/api/users?role=student&role=admin').set(as('admin')).expect(200);
    await request(app).get('/api/courses?q=a&q=b').set(as('student')).expect(200);
    await request(app).get('/api/courses/abc').set(as('student')).expect(404);
    await request(app).get('/api/lessons/abc').set(as('student')).expect(404);
    await request(app).post(`/api/courses/${ids.course}/lessons`).set(as('instructor')).send({ title: 'L', quiz: [null] }).expect(400);
    await request(app).post(`/api/courses/${ids.course}/lessons`).set(as('instructor'))
      .send({ title: 'L', quiz: [{ question: 'q', options: [{}, {}], correct_index: 0 }] }).expect(400);
    await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad').expect(400);
    await request(app).get('/api/courses').set('Authorization', 'Bearer not-a-token').expect(401);
  });

  test('a user who owns courses cannot be made a student', async () => {
    const r = await request(app).patch(`/api/users/${ids.instructor}/role`).set(as('admin')).send({ role: 'student' }).expect(400);
    assert.match(r.body.error, /courses/);
    await request(app).patch(`/api/users/${ids.instructor}/role`).set(as('admin')).send({ role: 'admin' }).expect(200);
    await request(app).patch(`/api/users/${ids.instructor}/role`).set(as('admin')).send({ role: 'instructor' }).expect(200);
  });

  test('serves the web UI with security headers', async () => {
    const res = await request(app).get('/courses').expect(200);
    assert.match(res.text, /<title>LearnHub/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-powered-by'], undefined);
  });
});
