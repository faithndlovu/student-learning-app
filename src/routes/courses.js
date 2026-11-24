const express = require('express');
const { requireRole } = require('../auth');
const { makeProgress } = require('../progress');

const LEVELS = ['beginner', 'intermediate', 'advanced'];

module.exports = function courseRoutes(db) {
  const router = express.Router();
  const progress = makeProgress(db);

  const COURSE_SELECT = `
    SELECT c.*, u.name AS instructor_name,
      (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lesson_count,
      (SELECT COALESCE(SUM(duration_minutes),0) FROM lessons l WHERE l.course_id = c.id) AS total_minutes,
      (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status != 'dropped') AS enrolled_count
    FROM courses c JOIN users u ON u.id = c.instructor_id`;
  const getCourse = (id) => db.prepare(`${COURSE_SELECT} WHERE c.id = ?`).get(id);
  const getEnrollment = db.prepare('SELECT * FROM enrollments WHERE student_id = ? AND course_id = ?');

  const canEdit = (user, course) => user.role === 'admin' || (user.role === 'instructor' && course.instructor_id === user.id);
  const canView = (user, course) => course.published || canEdit(user, course);

  function withStudentInfo(user, course) {
    if (user.role !== 'student') return course;
    const e = getEnrollment.get(user.id, course.id);
    return { ...course, enrollment: e || null, progress: e && e.status !== 'dropped' ? progress.courseProgress(course.id, user.id) : null };
  }

  function validate(body, partial) {
    const out = {};
    for (const key of ['code', 'title']) {
      if (!partial || body[key] !== undefined) {
        if (!body[key] || !String(body[key]).trim()) return { error: `${key[0].toUpperCase() + key.slice(1)} is required` };
        out[key] = String(body[key]).trim();
      }
    }
    if (body.description !== undefined) out.description = String(body.description);
    if (body.category !== undefined) out.category = String(body.category).trim() || 'General';
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

  // Catalogue / my courses
  router.get('/', (req, res) => {
    const { q, category, level, mine } = req.query;
    const where = [];
    const params = [];
    const u = req.user;
    if (u.role === 'student') where.push('c.published = 1');
    if (u.role === 'instructor') { where.push('(c.published = 1 OR c.instructor_id = ?)'); params.push(u.id); }
    if (mine === '1' || mine === 'true') {
      if (u.role === 'student') { where.push("EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.student_id = ? AND e.status != 'dropped')"); params.push(u.id); }
      else if (u.role === 'instructor') { where.push('c.instructor_id = ?'); params.push(u.id); }
    }
    if (q) { where.push('(c.title LIKE ? OR c.code LIKE ? OR c.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (category) { where.push('c.category = ?'); params.push(category); }
    if (level) { where.push('c.level = ?'); params.push(level); }
    const rows = db.prepare(`${COURSE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.title`).all(...params);
    const categories = db.prepare('SELECT DISTINCT category FROM courses WHERE published = 1 ORDER BY category').all().map((r) => r.category);
    res.json({ courses: rows.map((c) => withStudentInfo(u, c)), categories });
  });

  router.post('/', requireRole('admin', 'instructor'), (req, res) => {
    const { error, fields } = validate(req.body || {}, false);
    if (error) return res.status(400).json({ error });
    if (db.prepare('SELECT 1 FROM courses WHERE code = ?').get(fields.code)) return res.status(409).json({ error: 'Course code already exists' });
    let instructorId = req.user.id;
    if (req.user.role === 'admin' && req.body.instructor_id) {
      const inst = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('instructor','admin')").get(Number(req.body.instructor_id));
      if (!inst) return res.status(400).json({ error: 'instructor_id must refer to an instructor' });
      instructorId = inst.id;
    }
    const info = db.prepare(`INSERT INTO courses (code, title, description, category, level, capacity, instructor_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(fields.code, fields.title, fields.description || '', fields.category || 'General',
      fields.level || 'beginner', fields.capacity ?? null, instructorId);
    res.status(201).json({ course: getCourse(info.lastInsertRowid) });
  });

  router.get('/:id', (req, res) => {
    const course = getCourse(Number(req.params.id));
    if (!course || !canView(req.user, course)) return res.status(404).json({ error: 'Course not found' });
    const lessons = db.prepare(`
      SELECT l.id, l.position, l.title, l.duration_minutes,
        (SELECT COUNT(*) FROM quiz_questions q WHERE q.lesson_id = l.id) AS question_count,
        EXISTS (SELECT 1 FROM lesson_progress lp WHERE lp.lesson_id = l.id AND lp.student_id = ?) AS completed,
        (SELECT MAX(score * 100 / total) FROM quiz_attempts a WHERE a.lesson_id = l.id AND a.student_id = ?) AS best_score
      FROM lessons l WHERE l.course_id = ? ORDER BY l.position`).all(req.user.id, req.user.id, course.id)
      .map((l) => ({ ...l, completed: !!l.completed }));
    res.json({ course: withStudentInfo(req.user, course), lessons, can_edit: canEdit(req.user, course) });
  });

  router.put('/:id', (req, res) => {
    const course = getCourse(Number(req.params.id));
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!canEdit(req.user, course)) return res.status(403).json({ error: 'Only the course instructor or an admin can edit this course' });
    const { error, fields } = validate(req.body || {}, true);
    if (error) return res.status(400).json({ error });
    if (fields.code && db.prepare('SELECT 1 FROM courses WHERE code = ? AND id != ?').get(fields.code, course.id)) {
      return res.status(409).json({ error: 'Course code already exists' });
    }
    if (req.user.role === 'admin' && req.body.instructor_id) {
      const inst = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('instructor','admin')").get(Number(req.body.instructor_id));
      if (!inst) return res.status(400).json({ error: 'instructor_id must refer to an instructor' });
      fields.instructor_id = inst.id;
    }
    const keys = Object.keys(fields);
    if (keys.length) db.prepare(`UPDATE courses SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), course.id);
    res.json({ course: getCourse(course.id) });
  });

  router.patch('/:id/publish', (req, res) => {
    const course = getCourse(Number(req.params.id));
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!canEdit(req.user, course)) return res.status(403).json({ error: 'Not allowed' });
    const published = !!req.body?.published;
    if (published && course.lesson_count === 0) return res.status(400).json({ error: 'Add at least one lesson before publishing' });
    db.prepare('UPDATE courses SET published = ? WHERE id = ?').run(published ? 1 : 0, course.id);
    res.json({ course: getCourse(course.id) });
  });

  router.delete('/:id', (req, res) => {
    const course = getCourse(Number(req.params.id));
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!canEdit(req.user, course)) return res.status(403).json({ error: 'Not allowed' });
    db.prepare('DELETE FROM courses WHERE id = ?').run(course.id);
    res.status(204).end();
  });

  // ----- Enrolment -----
  router.post('/:id/enroll', requireRole('student'), (req, res) => {
    const course = getCourse(Number(req.params.id));
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
    const e = getEnrollment.get(req.user.id, Number(req.params.id));
    if (!e || e.status === 'dropped') return res.status(404).json({ error: 'You are not enrolled in this course' });
    db.prepare("UPDATE enrollments SET status = 'dropped' WHERE id = ?").run(e.id);
    res.json({ enrollment: getEnrollment.get(req.user.id, Number(req.params.id)) });
  });

  // ----- Roster with per-student progress (instructor/admin) -----
  router.get('/:id/roster', (req, res) => {
    const course = getCourse(Number(req.params.id));
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!canEdit(req.user, course)) return res.status(403).json({ error: 'Not allowed' });
    const students = db.prepare(`SELECT u.id, u.name, u.email, u.student_number, e.status, e.enrolled_at, e.completed_at
      FROM enrollments e JOIN users u ON u.id = e.student_id WHERE e.course_id = ? AND e.status != 'dropped' ORDER BY u.name`).all(course.id)
      .map((s) => ({ ...s, progress: progress.courseProgress(course.id, s.id) }));
    const avg = students.length ? Math.round(students.reduce((a, s) => a + s.progress.percent, 0) / students.length) : 0;
    res.json({ course, students, average_progress: avg, completed: students.filter((s) => s.status === 'completed').length });
  });

  return router;
};
