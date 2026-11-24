const express = require('express');
const { requireRole, canEditCourse } = require('../auth');
const { findInstructorId } = require('../accounts');
const { makeProgress } = require('../progress');
const { text, queryParam, id: parseId } = require('../validation');

const LEVELS = ['beginner', 'intermediate', 'advanced'];

const COURSE_SELECT = `
  SELECT c.*, u.name AS instructor_name,
    (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lesson_count,
    (SELECT COALESCE(SUM(duration_minutes),0) FROM lessons l WHERE l.course_id = c.id) AS total_minutes,
    (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status != 'dropped') AS enrolled_count
  FROM courses c JOIN users u ON u.id = c.instructor_id`;

/** Checks course fields. With partial=true only the supplied fields are validated (for updates). */
function validate(body, partial) {
  const out = {};
  for (const key of ['code', 'title']) {
    if (!partial || body[key] !== undefined) {
      const value = text(body[key]);
      if (!value) return { error: `${key[0].toUpperCase() + key.slice(1)} is required` };
      out[key] = value;
    }
  }
  if (body.description !== undefined) out.description = text(body.description);
  if (body.category !== undefined) out.category = text(body.category) || 'General';
  if (body.level !== undefined) {
    if (!LEVELS.includes(body.level)) return { error: `Level must be one of: ${LEVELS.join(', ')}` };
    out.level = body.level;
  }
  if (body.capacity !== undefined) {
    if (body.capacity === null || body.capacity === '') out.capacity = null;
    else if (!Number.isInteger(Number(body.capacity)) || Number(body.capacity) < 1) return { error: 'Capacity must be a positive whole number' };
    else out.capacity = Number(body.capacity);
  }
  return { fields: out };
}

module.exports = function courseRoutes(db) {
  const router = express.Router();
  const progress = makeProgress(db);

  const getCourseStmt = db.prepare(`${COURSE_SELECT} WHERE c.id = ?`);
  const getCourse = (value) => {
    const courseId = parseId(value);
    return courseId ? getCourseStmt.get(courseId) : undefined;
  };
  const getEnrollment = db.prepare('SELECT * FROM enrollments WHERE student_id = ? AND course_id = ?');
  const codeTaken = db.prepare('SELECT 1 FROM courses WHERE code = ? AND id != ?');

  const canView = (user, course) => course.published || canEditCourse(user, course);

  function withStudentInfo(user, course) {
    const c = { ...course, published: !!course.published };
    if (user.role !== 'student') return c;
    const e = getEnrollment.get(user.id, course.id);
    return { ...c, enrollment: e || null, progress: e && e.status !== 'dropped' ? progress.courseProgress(course.id, user.id) : null };
  }

  /** Loads the course from :id and checks the user may edit it. Sends the error response and returns null otherwise. */
  function loadEditable(req, res) {
    const course = getCourse(req.params.id);
    if (!course) { res.status(404).json({ error: 'Course not found' }); return null; }
    if (!canEditCourse(req.user, course)) { res.status(403).json({ error: 'Only the course instructor or an admin can manage this course' }); return null; }
    return course;
  }

  // Catalogue / my courses
  router.get('/', (req, res) => {
    const q = queryParam(req.query.q).trim();
    const category = queryParam(req.query.category);
    const level = queryParam(req.query.level);
    const mine = ['1', 'true'].includes(queryParam(req.query.mine));
    const u = req.user;

    // Visibility: students see published courses; instructors also see their own drafts; admins see everything.
    const visible = [];
    const visibleParams = [];
    if (u.role === 'student') visible.push('c.published = 1');
    if (u.role === 'instructor') { visible.push('(c.published = 1 OR c.instructor_id = ?)'); visibleParams.push(u.id); }

    const where = [...visible];
    const params = [...visibleParams];
    if (mine) {
      if (u.role === 'student') { where.push("EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.student_id = ? AND e.status != 'dropped')"); params.push(u.id); }
      else if (u.role === 'instructor') { where.push('c.instructor_id = ?'); params.push(u.id); }
    }
    if (q) { where.push('(c.title LIKE ? OR c.code LIKE ? OR c.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (category) { where.push('c.category = ?'); params.push(category); }
    if (level) { where.push('c.level = ?'); params.push(level); }

    const whereSql = (list) => (list.length ? `WHERE ${list.join(' AND ')}` : '');
    const rows = db.prepare(`${COURSE_SELECT} ${whereSql(where)} ORDER BY c.title`).all(...params);
    const categories = db.prepare(`SELECT DISTINCT c.category FROM courses c ${whereSql(visible)} ORDER BY c.category`)
      .all(...visibleParams).map((r) => r.category);
    res.json({ courses: rows.map((c) => withStudentInfo(u, c)), categories });
  });

  router.post('/', requireRole('admin', 'instructor'), (req, res) => {
    const body = req.body || {};
    const { error, fields } = validate(body, false);
    if (error) return res.status(400).json({ error });
    if (codeTaken.get(fields.code, 0)) return res.status(409).json({ error: 'Course code already exists' });
    let instructorId = req.user.id;
    if (req.user.role === 'admin' && body.instructor_id) {
      instructorId = findInstructorId(db, body.instructor_id);
      if (!instructorId) return res.status(400).json({ error: 'instructor_id must refer to an instructor' });
    }
    const info = db.prepare(`INSERT INTO courses (code, title, description, category, level, capacity, instructor_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(fields.code, fields.title, fields.description || '', fields.category || 'General',
      fields.level || 'beginner', fields.capacity ?? null, instructorId);
    res.status(201).json({ course: withStudentInfo(req.user, getCourse(info.lastInsertRowid)) });
  });

  router.get('/:id', (req, res) => {
    const course = getCourse(req.params.id);
    if (!course || !canView(req.user, course)) return res.status(404).json({ error: 'Course not found' });
    const lessons = db.prepare(`
      SELECT l.id, l.position, l.title, l.duration_minutes,
        (SELECT COUNT(*) FROM quiz_questions q WHERE q.lesson_id = l.id) AS question_count,
        EXISTS (SELECT 1 FROM lesson_progress lp WHERE lp.lesson_id = l.id AND lp.student_id = ?) AS completed,
        (SELECT MAX(score * 100 / total) FROM quiz_attempts a WHERE a.lesson_id = l.id AND a.student_id = ?) AS best_score
      FROM lessons l WHERE l.course_id = ? ORDER BY l.position`).all(req.user.id, req.user.id, course.id)
      .map((l) => ({ ...l, completed: !!l.completed }));
    res.json({ course: withStudentInfo(req.user, course), lessons, can_edit: canEditCourse(req.user, course) });
  });

  router.put('/:id', (req, res) => {
    const course = loadEditable(req, res);
    if (!course) return;
    const body = req.body || {};
    const { error, fields } = validate(body, true);
    if (error) return res.status(400).json({ error });
    if (fields.code && codeTaken.get(fields.code, course.id)) return res.status(409).json({ error: 'Course code already exists' });
    if (req.user.role === 'admin' && body.instructor_id) {
      fields.instructor_id = findInstructorId(db, body.instructor_id);
      if (!fields.instructor_id) return res.status(400).json({ error: 'instructor_id must refer to an instructor' });
    }
    const keys = Object.keys(fields);
    if (keys.length) db.prepare(`UPDATE courses SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), course.id);
    res.json({ course: withStudentInfo(req.user, getCourse(course.id)) });
  });

  router.patch('/:id/publish', (req, res) => {
    const course = loadEditable(req, res);
    if (!course) return;
    const published = req.body?.published === true;
    if (published && course.lesson_count === 0) return res.status(400).json({ error: 'Add at least one lesson before publishing' });
    db.prepare('UPDATE courses SET published = ? WHERE id = ?').run(published ? 1 : 0, course.id);
    res.json({ course: withStudentInfo(req.user, getCourse(course.id)) });
  });

  router.delete('/:id', (req, res) => {
    const course = loadEditable(req, res);
    if (!course) return;
    db.prepare('DELETE FROM courses WHERE id = ?').run(course.id);
    res.status(204).end();
  });

  // ----- Enrolment -----
  router.post('/:id/enroll', requireRole('student'), (req, res) => {
    const course = getCourse(req.params.id);
    if (!course || !course.published) return res.status(404).json({ error: 'Course not found' });
    const existing = getEnrollment.get(req.user.id, course.id);
    if (existing && existing.status !== 'dropped') return res.status(409).json({ error: 'You are already enrolled in this course' });
    if (course.capacity && course.enrolled_count >= course.capacity) return res.status(409).json({ error: 'This course is full' });
    if (existing) db.prepare("UPDATE enrollments SET status = 'active', enrolled_at = datetime('now'), completed_at = NULL WHERE id = ?").run(existing.id);
    else db.prepare('INSERT INTO enrollments (student_id, course_id) VALUES (?, ?)').run(req.user.id, course.id);
    progress.syncEnrollmentStatus(course.id, req.user.id);
    res.status(201).json({ enrollment: getEnrollment.get(req.user.id, course.id), progress: progress.courseProgress(course.id, req.user.id) });
  });

  router.delete('/:id/enroll', requireRole('student'), (req, res) => {
    const courseId = parseId(req.params.id);
    const e = courseId && getEnrollment.get(req.user.id, courseId);
    if (!e || e.status === 'dropped') return res.status(404).json({ error: 'You are not enrolled in this course' });
    db.prepare("UPDATE enrollments SET status = 'dropped' WHERE id = ?").run(e.id);
    res.json({ enrollment: getEnrollment.get(req.user.id, courseId) });
  });

  // ----- Roster with per-student progress (instructor/admin) -----
  router.get('/:id/roster', (req, res) => {
    const course = loadEditable(req, res);
    if (!course) return;
    const students = db.prepare(`SELECT u.id, u.name, u.email, u.student_number, e.status, e.enrolled_at, e.completed_at
      FROM enrollments e JOIN users u ON u.id = e.student_id WHERE e.course_id = ? AND e.status != 'dropped' ORDER BY u.name`).all(course.id)
      .map((s) => ({ ...s, progress: progress.courseProgress(course.id, s.id) }));
    const avg = students.length ? Math.round(students.reduce((a, s) => a + s.progress.percent, 0) / students.length) : 0;
    res.json({ course, students, average_progress: avg, completed: students.filter((s) => s.status === 'completed').length });
  });

  return router;
};
