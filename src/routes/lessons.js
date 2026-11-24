const express = require('express');
const { makeProgress, gradeQuiz, PASS_MARK } = require('../progress');

module.exports = function lessonRoutes(db) {
  const router = express.Router();
  const progress = makeProgress(db);

  const getLesson = db.prepare('SELECT * FROM lessons WHERE id = ?');
  const getCourse = db.prepare('SELECT * FROM courses WHERE id = ?');
  const getQuestions = db.prepare('SELECT * FROM quiz_questions WHERE lesson_id = ? ORDER BY id');
  const getEnrollment = db.prepare('SELECT * FROM enrollments WHERE student_id = ? AND course_id = ?');

  const canEdit = (user, course) => user.role === 'admin' || (user.role === 'instructor' && course.instructor_id === user.id);
  const isEnrolled = (user, course) => {
    const e = getEnrollment.get(user.id, course.id);
    return !!e && e.status !== 'dropped';
  };

  function validateQuiz(quiz) {
    if (quiz === undefined) return null;
    if (!Array.isArray(quiz)) return 'Quiz must be an array of questions';
    for (const [i, q] of quiz.entries()) {
      if (!q.question || !String(q.question).trim()) return `Question ${i + 1}: text is required`;
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.some((o) => !String(o).trim())) return `Question ${i + 1}: provide at least two non-empty options`;
      if (!Number.isInteger(q.correct_index) || q.correct_index < 0 || q.correct_index >= q.options.length) return `Question ${i + 1}: correct_index is out of range`;
    }
    return null;
  }
  function saveQuiz(lessonId, quiz) {
    db.prepare('DELETE FROM quiz_questions WHERE lesson_id = ?').run(lessonId);
    const ins = db.prepare('INSERT INTO quiz_questions (lesson_id, question, options, correct_index) VALUES (?, ?, ?, ?)');
    for (const q of quiz) ins.run(lessonId, String(q.question).trim(), JSON.stringify(q.options.map(String)), q.correct_index);
  }

  /** Loads lesson + course, enforcing view access. */
  function load(req, res) {
    const lesson = getLesson.get(Number(req.params.id));
    const course = lesson && getCourse.get(lesson.course_id);
    if (!lesson || !course) { res.status(404).json({ error: 'Lesson not found' }); return null; }
    const editor = canEdit(req.user, course);
    if (!editor && !(course.published && isEnrolled(req.user, course))) {
      res.status(403).json({ error: 'Enrol in this course to access its lessons' }); return null;
    }
    return { lesson, course, editor };
  }

  // Create lesson in a course
  router.post('/courses/:courseId/lessons', (req, res) => {
    const course = getCourse.get(Number(req.params.courseId));
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!canEdit(req.user, course)) return res.status(403).json({ error: 'Only the course instructor or an admin can add lessons' });
    const { title, content = '', duration_minutes = 10, quiz = [] } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Lesson title is required' });
    if (!Number.isInteger(Number(duration_minutes)) || Number(duration_minutes) < 1) return res.status(400).json({ error: 'Duration must be a positive number of minutes' });
    const quizError = validateQuiz(quiz);
    if (quizError) return res.status(400).json({ error: quizError });
    const id = db.transaction(() => {
      const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM lessons WHERE course_id = ?').get(course.id).p;
      const info = db.prepare('INSERT INTO lessons (course_id, position, title, content, duration_minutes) VALUES (?, ?, ?, ?, ?)')
        .run(course.id, pos, String(title).trim(), String(content), Number(duration_minutes));
      saveQuiz(info.lastInsertRowid, quiz);
      // Students who had finished the course now have a new lesson to do.
      for (const e of db.prepare("SELECT student_id FROM enrollments WHERE course_id = ? AND status = 'completed'").all(course.id)) {
        progress.syncEnrollmentStatus(course.id, e.student_id);
      }
      return info.lastInsertRowid;
    })();
    res.status(201).json({ lesson: getLesson.get(id) });
  });

  router.get('/lessons/:id', (req, res) => {
    const ctx = load(req, res);
    if (!ctx) return;
    const questions = getQuestions.all(ctx.lesson.id).map((q) => ({
      id: q.id, question: q.question, options: JSON.parse(q.options), ...(ctx.editor ? { correct_index: q.correct_index } : {}),
    }));
    const siblings = db.prepare('SELECT id, position, title FROM lessons WHERE course_id = ? ORDER BY position').all(ctx.course.id);
    const idx = siblings.findIndex((s) => s.id === ctx.lesson.id);
    const completed = !!db.prepare('SELECT 1 FROM lesson_progress WHERE student_id = ? AND lesson_id = ?').get(req.user.id, ctx.lesson.id);
    const attempts = db.prepare('SELECT score, total, passed, created_at FROM quiz_attempts WHERE student_id = ? AND lesson_id = ? ORDER BY id DESC')
      .all(req.user.id, ctx.lesson.id).map((a) => ({ ...a, passed: !!a.passed }));
    res.json({
      lesson: ctx.lesson, course: { id: ctx.course.id, title: ctx.course.title, code: ctx.course.code },
      questions, completed, attempts, pass_mark: Math.round(PASS_MARK * 100), can_edit: ctx.editor,
      previous: siblings[idx - 1] || null, next: siblings[idx + 1] || null,
    });
  });

  router.put('/lessons/:id', (req, res) => {
    const ctx = load(req, res);
    if (!ctx) return;
    if (!ctx.editor) return res.status(403).json({ error: 'Not allowed' });
    const b = req.body || {};
    const title = b.title !== undefined ? String(b.title).trim() : ctx.lesson.title;
    if (!title) return res.status(400).json({ error: 'Lesson title is required' });
    const duration = b.duration_minutes !== undefined ? Number(b.duration_minutes) : ctx.lesson.duration_minutes;
    if (!Number.isInteger(duration) || duration < 1) return res.status(400).json({ error: 'Duration must be a positive number of minutes' });
    const quizError = validateQuiz(b.quiz);
    if (quizError) return res.status(400).json({ error: quizError });
    db.transaction(() => {
      db.prepare('UPDATE lessons SET title = ?, content = ?, duration_minutes = ? WHERE id = ?')
        .run(title, b.content !== undefined ? String(b.content) : ctx.lesson.content, duration, ctx.lesson.id);
      if (b.quiz !== undefined) saveQuiz(ctx.lesson.id, b.quiz);
    })();
    res.json({ lesson: getLesson.get(ctx.lesson.id) });
  });

  router.patch('/lessons/:id/move', (req, res) => {
    const ctx = load(req, res);
    if (!ctx) return;
    if (!ctx.editor) return res.status(403).json({ error: 'Not allowed' });
    const dir = req.body?.direction === 'up' ? -1 : 1;
    const list = db.prepare('SELECT id, position FROM lessons WHERE course_id = ? ORDER BY position').all(ctx.course.id);
    const i = list.findIndex((l) => l.id === ctx.lesson.id);
    const j = i + dir;
    if (j >= 0 && j < list.length) {
      db.transaction(() => {
        const set = db.prepare('UPDATE lessons SET position = ? WHERE id = ?');
        set.run(list[j].position, list[i].id);
        set.run(list[i].position, list[j].id);
      })();
    }
    res.json({ lessons: db.prepare('SELECT id, position, title FROM lessons WHERE course_id = ? ORDER BY position').all(ctx.course.id) });
  });

  router.delete('/lessons/:id', (req, res) => {
    const ctx = load(req, res);
    if (!ctx) return;
    if (!ctx.editor) return res.status(403).json({ error: 'Not allowed' });
    db.transaction(() => {
      db.prepare('DELETE FROM lessons WHERE id = ?').run(ctx.lesson.id);
      const rest = db.prepare('SELECT id FROM lessons WHERE course_id = ? ORDER BY position').all(ctx.course.id);
      rest.forEach((l, i) => db.prepare('UPDATE lessons SET position = ? WHERE id = ?').run(i + 1, l.id));
      if (rest.length === 0) db.prepare('UPDATE courses SET published = 0 WHERE id = ?').run(ctx.course.id);
      for (const e of db.prepare("SELECT student_id FROM enrollments WHERE course_id = ? AND status != 'dropped'").all(ctx.course.id)) {
        progress.syncEnrollmentStatus(ctx.course.id, e.student_id);
      }
    })();
    res.status(204).end();
  });

  // ----- Student progress -----
  function requireStudent(req, res, ctx) {
    if (req.user.role !== 'student' || !isEnrolled(req.user, ctx.course)) {
      res.status(403).json({ error: 'Only enrolled students can record progress' });
      return false;
    }
    return true;
  }

  router.post('/lessons/:id/complete', (req, res) => {
    const ctx = load(req, res);
    if (!ctx || !requireStudent(req, res, ctx)) return;
    const hasQuiz = getQuestions.all(ctx.lesson.id).length > 0;
    if (hasQuiz) {
      const passed = db.prepare('SELECT 1 FROM quiz_attempts WHERE student_id = ? AND lesson_id = ? AND passed = 1').get(req.user.id, ctx.lesson.id);
      if (!passed) return res.status(422).json({ error: `Pass the lesson quiz (${Math.round(PASS_MARK * 100)}%) to complete this lesson` });
    }
    db.prepare('INSERT OR IGNORE INTO lesson_progress (student_id, lesson_id) VALUES (?, ?)').run(req.user.id, ctx.lesson.id);
    const status = progress.syncEnrollmentStatus(ctx.course.id, req.user.id);
    res.json({ completed: true, enrollment_status: status, progress: progress.courseProgress(ctx.course.id, req.user.id) });
  });

  router.delete('/lessons/:id/complete', (req, res) => {
    const ctx = load(req, res);
    if (!ctx || !requireStudent(req, res, ctx)) return;
    db.prepare('DELETE FROM lesson_progress WHERE student_id = ? AND lesson_id = ?').run(req.user.id, ctx.lesson.id);
    const status = progress.syncEnrollmentStatus(ctx.course.id, req.user.id);
    res.json({ completed: false, enrollment_status: status, progress: progress.courseProgress(ctx.course.id, req.user.id) });
  });

  router.post('/lessons/:id/quiz', (req, res) => {
    const ctx = load(req, res);
    if (!ctx || !requireStudent(req, res, ctx)) return;
    const questions = getQuestions.all(ctx.lesson.id);
    if (!questions.length) return res.status(400).json({ error: 'This lesson has no quiz' });
    const answers = req.body?.answers;
    if (!Array.isArray(answers) || answers.length !== questions.length) return res.status(400).json({ error: `Provide ${questions.length} answers` });
    const result = gradeQuiz(questions, answers);
    db.transaction(() => {
      db.prepare('INSERT INTO quiz_attempts (student_id, lesson_id, score, total, passed) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.id, ctx.lesson.id, result.score, result.total, result.passed ? 1 : 0);
      if (result.passed) db.prepare('INSERT OR IGNORE INTO lesson_progress (student_id, lesson_id) VALUES (?, ?)').run(req.user.id, ctx.lesson.id);
    })();
    const status = progress.syncEnrollmentStatus(ctx.course.id, req.user.id);
    res.json({ ...result, percent: Math.round((result.score / result.total) * 100), enrollment_status: status, progress: progress.courseProgress(ctx.course.id, req.user.id) });
  });

  return router;
};
