const path = require('path');
const express = require('express');
const { createDb } = require('./db');
const { authenticate } = require('./auth');
const { makeProgress } = require('./progress');

function createApp({ db = createDb() } = {}) {
  const app = express();
  app.use(express.json({ limit: '200kb' }));
  const auth = authenticate(db);
  const progress = makeProgress(db);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/users', auth, require('./routes/users')(db));
  app.use('/api/courses', auth, require('./routes/courses')(db));
  app.use('/api', auth, require('./routes/lessons')(db));

  // Role-specific dashboard data.
  app.get('/api/dashboard', auth, (req, res) => {
    const u = req.user;
    if (u.role === 'student') {
      const courses = db.prepare(`SELECT c.id, c.code, c.title, c.category, e.status, e.enrolled_at, e.completed_at
        FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.student_id = ? AND e.status != 'dropped' ORDER BY e.enrolled_at DESC`)
        .all(u.id).map((c) => {
          const p = progress.courseProgress(c.id, u.id);
          const next = db.prepare(`SELECT l.id, l.title FROM lessons l WHERE l.course_id = ?
            AND NOT EXISTS (SELECT 1 FROM lesson_progress lp WHERE lp.lesson_id = l.id AND lp.student_id = ?) ORDER BY l.position LIMIT 1`).get(c.id, u.id);
          return { ...c, progress: p, next_lesson: next || null };
        });
      const scores = courses.map((c) => c.progress.average_quiz_score).filter((s) => s !== null);
      const recent = db.prepare(`SELECT l.title AS lesson, c.title AS course, lp.completed_at FROM lesson_progress lp
        JOIN lessons l ON l.id = lp.lesson_id JOIN courses c ON c.id = l.course_id WHERE lp.student_id = ? ORDER BY lp.completed_at DESC LIMIT 6`).all(u.id);
      return res.json({
        role: 'student',
        summary: {
          enrolled: courses.filter((c) => c.status === 'active').length,
          completed: courses.filter((c) => c.status === 'completed').length,
          lessons_completed: courses.reduce((a, c) => a + c.progress.completed_lessons, 0),
          minutes_studied: courses.reduce((a, c) => a + c.progress.minutes_studied, 0),
          average_quiz_score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
        },
        courses, recent,
      });
    }

    const scope = u.role === 'instructor' ? 'WHERE c.instructor_id = ?' : '';
    const params = u.role === 'instructor' ? [u.id] : [];
    const courses = db.prepare(`SELECT c.id, c.code, c.title, c.published,
        (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lesson_count,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status != 'dropped') AS students,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'completed') AS completions
      FROM courses c ${scope} ORDER BY c.title`).all(...params).map((c) => {
      const ids = db.prepare("SELECT student_id FROM enrollments WHERE course_id = ? AND status != 'dropped'").all(c.id);
      const avg = ids.length ? Math.round(ids.reduce((a, r) => a + progress.courseProgress(c.id, r.student_id).percent, 0) / ids.length) : 0;
      return { ...c, published: !!c.published, average_progress: avg };
    });
    const summary = {
      courses: courses.length,
      published: courses.filter((c) => c.published).length,
      enrolments: courses.reduce((a, c) => a + c.students, 0),
      completions: courses.reduce((a, c) => a + c.completions, 0),
    };
    if (u.role === 'admin') {
      for (const r of db.prepare('SELECT role, COUNT(*) AS n FROM users GROUP BY role').all()) summary[`${r.role}s`] = r.n;
    }
    res.json({ role: u.role, summary, courses });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
