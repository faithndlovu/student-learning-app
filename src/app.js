const path = require('path');
const express = require('express');
const { createDb } = require('./db');
const { authenticate } = require('./auth');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/** Basic hardening headers (a dependency-free subset of what helmet sets). */
function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
  });
  next();
}

function createApp({ db = createDb() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '200kb' }));
  const auth = authenticate(db);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/users', auth, require('./routes/users')(db));
  app.use('/api/courses', auth, require('./routes/courses')(db));
  app.use('/api/dashboard', auth, require('./routes/dashboard')(db));
  app.use('/api', auth, require('./routes/lessons')(db));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Single-page web client: static files, with index.html for client-side routes.
  app.use(express.static(PUBLIC_DIR));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
