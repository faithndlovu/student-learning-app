const express = require('express');
const { requireRole } = require('../auth');

const ROLES = ['admin', 'instructor', 'student'];

module.exports = function userRoutes(db) {
  const router = express.Router();
  router.use(requireRole('admin'));

  router.get('/', (req, res) => {
    const { role, q } = req.query;
    const where = ['1=1'];
    const params = [];
    if (role) { where.push('u.role = ?'); params.push(role); }
    if (q) { where.push('(u.name LIKE ? OR u.email LIKE ? OR u.student_number LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const users = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.student_number, u.phone, u.programme, u.created_at,
        (SELECT COUNT(*) FROM enrollments e WHERE e.student_id = u.id AND e.status != 'dropped') AS enrolments,
        (SELECT COUNT(*) FROM courses c WHERE c.instructor_id = u.id) AS courses_taught
      FROM users u WHERE ${where.join(' AND ')} ORDER BY u.role, u.name`).all(...params);
    res.json({ users });
  });

  router.patch('/:id/role', (req, res) => {
    const { role } = req.body || {};
    if (!ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${ROLES.join(', ')}` });
    const id = Number(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin' && role !== 'admin' && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n <= 1) {
      return res.status(400).json({ error: 'Cannot demote the last administrator' });
    }
    if (user.role === 'instructor' && role !== 'instructor' && db.prepare('SELECT COUNT(*) AS n FROM courses WHERE instructor_id = ?').get(id).n) {
      return res.status(400).json({ error: 'Reassign this instructor’s courses first' });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    if (role === 'student' && !user.student_number) {
      db.prepare('UPDATE users SET student_number = ? WHERE id = ?').run(`STU${new Date().getFullYear()}${String(id).padStart(4, '0')}`, id);
    }
    res.json({ user: db.prepare('SELECT id, name, email, role, student_number FROM users WHERE id = ?').get(id) });
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: 'User not found' });
    if (db.prepare('SELECT COUNT(*) AS n FROM courses WHERE instructor_id = ?').get(id).n) {
      return res.status(400).json({ error: 'Reassign or delete this instructor’s courses first' });
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.status(204).end();
  });

  return router;
};
