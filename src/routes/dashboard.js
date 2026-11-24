const express = require('express');
const { makeProgress } = require('../progress');

const sum = (list, pick) => list.reduce((a, x) => a + pick(x), 0);
const average = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);

/** Role-specific dashboard data. */
module.exports = function dashboardRoutes(db) {
  const router = express.Router();
  const progress = makeProgress(db);

  const studentCourses = db.prepare(`SELECT c.id, c.code, c.title, c.category, e.status, e.enrolled_at, e.completed_at
    FROM enrollments e JOIN courses c ON c.id = e.course_id
    WHERE e.student_id = ? AND e.status != 'dropped' ORDER BY e.enrolled_at DESC`);
  const nextLesson = db.prepare(`SELECT l.id, l.title FROM lessons l WHERE l.course_id = ?
    AND NOT EXISTS (SELECT 1 FROM lesson_progress lp WHERE lp.lesson_id = l.id AND lp.student_id = ?) ORDER BY l.position LIMIT 1`);
  const recentActivity = db.prepare(`SELECT l.title AS lesson, c.title AS course, lp.completed_at FROM lesson_progress lp
    JOIN lessons l ON l.id = lp.lesson_id JOIN courses c ON c.id = l.course_id
    WHERE lp.student_id = ? ORDER BY lp.completed_at DESC LIMIT 6`);
  const courseStudents = db.prepare("SELECT student_id FROM enrollments WHERE course_id = ? AND status != 'dropped'");

  function studentDashboard(user) {
    const courses = studentCourses.all(user.id).map((c) => ({
      ...c,
      progress: progress.courseProgress(c.id, user.id),
      next_lesson: nextLesson.get(c.id, user.id) || null,
    }));
    const scores = courses.map((c) => c.progress.average_quiz_score).filter((s) => s !== null);
    return {
      role: 'student',
      summary: {
        enrolled: courses.filter((c) => c.status === 'active').length,
        completed: courses.filter((c) => c.status === 'completed').length,
        lessons_completed: sum(courses, (c) => c.progress.completed_lessons),
        minutes_studied: sum(courses, (c) => c.progress.minutes_studied),
        average_quiz_score: average(scores),
      },
      courses,
      recent: recentActivity.all(user.id),
    };
  }

  function teachingDashboard(user) {
    const scoped = user.role === 'instructor';
    const courses = db.prepare(`SELECT c.id, c.code, c.title, c.published,
        (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lesson_count,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status != 'dropped') AS students,
        (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.status = 'completed') AS completions
      FROM courses c ${scoped ? 'WHERE c.instructor_id = ?' : ''} ORDER BY c.title`).all(...(scoped ? [user.id] : []))
      .map((c) => {
        const percents = courseStudents.all(c.id).map((r) => progress.courseProgress(c.id, r.student_id).percent);
        return { ...c, published: !!c.published, average_progress: average(percents) ?? 0 };
      });
    const summary = {
      courses: courses.length,
      published: courses.filter((c) => c.published).length,
      enrolments: sum(courses, (c) => c.students),
      completions: sum(courses, (c) => c.completions),
    };
    if (user.role === 'admin') {
      Object.assign(summary, { admins: 0, instructors: 0, students: 0 });
      for (const r of db.prepare('SELECT role, COUNT(*) AS n FROM users GROUP BY role').all()) summary[`${r.role}s`] = r.n;
    }
    return { role: user.role, summary, courses };
  }

  router.get('/', (req, res) => {
    res.json(req.user.role === 'student' ? studentDashboard(req.user) : teachingDashboard(req.user));
  });

  return router;
};
