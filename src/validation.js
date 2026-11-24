/** Small input helpers so malformed requests get a 400 instead of crashing a query. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

/** Returns the value as a string if it is a string or number, otherwise undefined. */
function str(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Trimmed string, or '' when missing or not a string. */
const text = (value) => (str(value) ?? '').trim();

/** Query-string value: takes the first entry when a parameter is repeated. */
function queryParam(value) {
  return str(Array.isArray(value) ? value[0] : value) ?? '';
}

/** Positive integer id from a route parameter, or null. */
function id(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isEmail(value) {
  return typeof value === 'string' && EMAIL_RE.test(value);
}

function passwordError(value, label = 'Password') {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD) return `${label} must be at least ${MIN_PASSWORD} characters`;
  return null;
}

module.exports = { str, text, queryParam, id, isEmail, passwordError, MIN_PASSWORD };
