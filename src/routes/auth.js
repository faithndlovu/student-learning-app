const express = require('express');
const bcrypt = require('bcryptjs');
const { signToken, authenticate } = require('../auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PUBLIC_FIELDS = 'id, name, email, role, student_number, phone, programme, created_at';

module.exports = function authRoutes(db) {
  const router = express.Router();
  const getUser = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`);

  /** Student self-registration. The very first account becomes the administrator. */
  router.post('/register', (req, res) => {
    const { name, email, password, phone = '', programme = '' } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
    if (!EMAIL_RE.test(email || '')) return res.status(400).json({ error: 'A valid email is required' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Email is already registered' });

    const isFirst = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
    const role = isFirst ? 'admin' : 'student';
    const create = db.transaction(() => {
      const info = db.prepare('INSERT INTO users (name, email, password_hash, role, phone, programme) VALUES (?, ?, ?, ?, ?, ?)')
        .run(String(name).trim(), email.toLowerCase(), bcrypt.hashSync(password, 10), role, String(phone), String(programme));
      if (role === 'student') {
        const number = `STU${new Date().getFullYear()}${String(info.lastInsertRowid).padStart(4, '0')}`;
        db.prepare('UPDATE users SET student_number = ? WHERE id = ?').run(number, info.lastInsertRowid);
      }
      return info.lastInsertRowid;
    });
    const user = getUser.get(create());
    res.status(201).json({ token: signToken(user), user });
  });

  router.post('/login', (req, res) => {
    const { email, password } = req.body || {};
    const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email || '');
    if (!row || !bcrypt.compareSync(password || '', row.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    const user = getUser.get(row.id);
    res.json({ token: signToken(user), user });
  });

  router.get('/me', authenticate(db), (req, res) => res.json({ user: getUser.get(req.user.id) }));

  /** Update own profile; changing password requires the current one. */
  router.put('/me', authenticate(db), (req, res) => {
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const { name, phone, programme, current_password, new_password } = req.body || {};
    const next = {
      name: name !== undefined ? String(name).trim() : current.name,
      phone: phone !== undefined ? String(phone) : current.phone,
      programme: programme !== undefined ? String(programme) : current.programme,
    };
    if (!next.name) return res.status(400).json({ error: 'Name is required' });
    let hash = current.password_hash;
    if (new_password) {
      if (!bcrypt.compareSync(current_password || '', current.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
      if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
      hash = bcrypt.hashSync(new_password, 10);
    }
    db.prepare('UPDATE users SET name = ?, phone = ?, programme = ?, password_hash = ? WHERE id = ?')
      .run(next.name, next.phone, next.programme, hash, req.user.id);
    res.json({ user: getUser.get(req.user.id) });
  });

  return router;
};
