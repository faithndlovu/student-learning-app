/** Shared user-account helpers. */

/** Columns that are safe to return to clients (never the password hash). */
const PUBLIC_FIELDS = 'id, name, email, role, student_number, phone, programme, created_at';

/** Student numbers look like STU20260003: the year followed by the zero-padded user id. */
const studentNumber = (userId) => `STU${new Date().getFullYear()}${String(userId).padStart(4, '0')}`;

/** Gives a user a student number if they don't already have one. */
function ensureStudentNumber(db, userId) {
  db.prepare('UPDATE users SET student_number = ? WHERE id = ? AND student_number IS NULL').run(studentNumber(userId), userId);
}

/** Looks up a user who is allowed to own courses. Returns the id or null. */
function findInstructorId(db, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  const row = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('instructor','admin')").get(n);
  return row ? row.id : null;
}

module.exports = { PUBLIC_FIELDS, studentNumber, ensureStudentNumber, findInstructorId };
