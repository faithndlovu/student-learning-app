const jwt = require('jsonwebtoken');

const DEV_SECRET = 'dev-only-secret-change-me';
const TOKEN_TTL = process.env.TOKEN_TTL || '8h';

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  }
  return DEV_SECRET;
}
const JWT_SECRET = jwtSecret();
const usingDevSecret = JWT_SECRET === DEV_SECRET;

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

/** Verifies the Bearer token and loads the current user onto req.user. */
function authenticate(db) {
  const findUser = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?');
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'Authentication required' });
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const user = Number.isInteger(payload.sub) ? findUser.get(payload.sub) : undefined;
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    req.user = user;
    next();
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

/** Admins can edit any course; instructors only their own. */
const canEditCourse = (user, course) => user.role === 'admin' || (user.role === 'instructor' && course.instructor_id === user.id);

module.exports = { signToken, authenticate, requireRole, canEditCourse, usingDevSecret };
