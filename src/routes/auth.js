const express = require('express');
const bcrypt = require('bcryptjs');
const { signToken, authenticate } = require('../auth');
const { PUBLIC_FIELDS, ensureStudentNumber } = require('../accounts');
const { str, text, isEmail, passwordError } = require('../validation');

module.exports = function authRoutes(db) {
  const router = express.Router();
  const auth = authenticate(db);
  const getUser = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`);

  /** Student self-registration. The very first account becomes the administrator. */
  router.post('/register', (req, res) => {
    const body = req.body || {};
    const name = text(body.name);
    const email = text(body.email).toLowerCase();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!isEmail(email)) return res.status(400).json({ error: 'A valid email is required' });
    const pwError = passwordError(body.password);
    if (pwError) return res.status(400).json({ error: pwError });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Email is already registered' });

    const hash = bcrypt.hashSync(body.password, 10);
    const id = db.transaction(() => {
      const isFirst = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
      const role = isFirst ? 'admin' : 'student';
      const info = db.prepare('INSERT INTO users (name, email, password_hash, role, phone, programme) VALUES (?, ?, ?, ?, ?, ?)')
        .run(name, email, hash, role, text(body.phone), text(body.programme));
      if (role === 'student') ensureStudentNumber(db, info.lastInsertRowid);
      return info.lastInsertRowid;
    })();
    const user = getUser.get(id);
    res.status(201).json({ token: signToken(user), user });
  });

  router.post('/login', (req, res) => {
    const email = text(req.body?.email);
    const password = str(req.body?.password) ?? '';
    const row = email && db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    const user = getUser.get(row.id);
    res.json({ token: signToken(user), user });
  });

  router.get('/me', auth, (req, res) => res.json({ user: getUser.get(req.user.id) }));

  /** Update own profile; changing password requires the current one. */
  router.put('/me', auth, (req, res) => {
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const b = req.body || {};
    const next = {
      name: b.name !== undefined ? text(b.name) : current.name,
      phone: b.phone !== undefined ? text(b.phone) : current.phone,
      programme: b.programme !== undefined ? text(b.programme) : current.programme,
    };
    if (!next.name) return res.status(400).json({ error: 'Name is required' });
    let hash = current.password_hash;
    if (b.new_password) {
      if (!bcrypt.compareSync(str(b.current_password) ?? '', current.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
      const pwError = passwordError(b.new_password, 'New password');
      if (pwError) return res.status(400).json({ error: pwError });
      hash = bcrypt.hashSync(b.new_password, 10);
    }
    db.prepare('UPDATE users SET name = ?, phone = ?, programme = ?, password_hash = ? WHERE id = ?')
      .run(next.name, next.phone, next.programme, hash, req.user.id);
    res.json({ user: getUser.get(req.user.id) });
  });

  return router;
};
