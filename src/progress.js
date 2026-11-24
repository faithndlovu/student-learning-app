/** Progress-tracking calculations shared by routes. */
const PASS_MARK = 0.6; // 60% needed to pass a lesson quiz

function makeProgress(db) {
  const q = {
    lessonCount: db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE course_id = ?'),
    completedCount: db.prepare(`SELECT COUNT(*) AS n FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id
      WHERE l.course_id = ? AND lp.student_id = ?`),
    avgBestScore: db.prepare(`SELECT AVG(best) AS avg FROM (
        SELECT MAX(CAST(a.score AS REAL) / a.total) AS best FROM quiz_attempts a JOIN lessons l ON l.id = a.lesson_id
        WHERE l.course_id = ? AND a.student_id = ? GROUP BY a.lesson_id)`),
    minutes: db.prepare(`SELECT COALESCE(SUM(l.duration_minutes),0) AS n FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id
      WHERE l.course_id = ? AND lp.student_id = ?`),
    enrollment: db.prepare('SELECT * FROM enrollments WHERE student_id = ? AND course_id = ?'),
  };

  /** Progress summary for one student in one course. */
  function courseProgress(courseId, studentId) {
    const total = q.lessonCount.get(courseId).n;
    const completed = q.completedCount.get(courseId, studentId).n;
    const avg = q.avgBestScore.get(courseId, studentId).avg;
    return {
      total_lessons: total,
      completed_lessons: completed,
      percent: total ? Math.round((completed / total) * 100) : 0,
      average_quiz_score: avg === null ? null : Math.round(avg * 100),
      minutes_studied: q.minutes.get(courseId, studentId).n,
    };
  }

  /** Marks the enrollment completed once every lesson is done. Returns the new status. */
  function syncEnrollmentStatus(courseId, studentId) {
    const e = q.enrollment.get(studentId, courseId);
    if (!e || e.status === 'dropped') return e?.status;
    const p = courseProgress(courseId, studentId);
    const done = p.total_lessons > 0 && p.completed_lessons >= p.total_lessons;
    if (done && e.status !== 'completed') {
      db.prepare("UPDATE enrollments SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(e.id);
      return 'completed';
    }
    if (!done && e.status === 'completed') {
      // New lessons were added after completion.
      db.prepare("UPDATE enrollments SET status = 'active', completed_at = NULL WHERE id = ?").run(e.id);
      return 'active';
    }
    return e.status;
  }

  return { courseProgress, syncEnrollmentStatus };
}

/** Grades a quiz. answers: array of selected option indexes, one per question in order. */
function gradeQuiz(questions, answers) {
  const results = questions.map((qq, i) => ({ question_id: qq.id, correct: Number(answers?.[i]) === qq.correct_index, correct_index: qq.correct_index }));
  const score = results.filter((r) => r.correct).length;
  return { score, total: questions.length, passed: questions.length > 0 && score / questions.length >= PASS_MARK, results };
}

module.exports = { makeProgress, gradeQuiz, PASS_MARK };
