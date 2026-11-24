require('./check-node');
require('dotenv').config({ quiet: true });

const { createDb, defaultDbPath } = require('./db');
const { createApp } = require('./app');
const { usingDevSecret } = require('./auth');

const PORT = Number(process.env.PORT) || 3000;
const db = createDb();
const server = createApp({ db }).listen(PORT, () => {
  console.log(`Student Learning App running at http://localhost:${PORT}`);
  console.log(`Database: ${defaultDbPath()}`);
  if (usingDevSecret) console.warn('Warning: JWT_SECRET is not set; using an insecure development secret. Set it in .env before deploying.');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Stop the other process or set PORT in .env.`);
  else console.error(err);
  process.exit(1);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
