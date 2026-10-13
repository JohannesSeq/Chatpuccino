import crypto from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import { DATA } from './config.js';
import { HttpError, readJson, withLock, wrap, writeJson } from './util.js';
import { t } from './i18n.js';

const FILE = path.join(DATA, 'auth.json');
const COOKIE = 'chatpuccino_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
export const DEFAULT_USER = 'admin';
export const DEFAULT_PASSWORD = 'Admin';
const MIN_PASSWORD = 6;

function hashPassword(password, salt = crypto.randomBytes(16)) {
  return { salt: salt.toString('hex'), hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function checkPassword(password, rec) {
  const hash = crypto.scryptSync(password, Buffer.from(rec.salt, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(rec.hash, 'hex'));
}

function defaultAuth() {
  return {
    enabled: true,
    secret: crypto.randomBytes(32).toString('hex'),
    user: { username: DEFAULT_USER, ...hashPassword(DEFAULT_PASSWORD), version: 1, defaultPassword: true },
  };
}

let cached = null;

export function loadAuth() {
  if (cached) return Promise.resolve(cached);
  return withLock(FILE, async () => {
    let a = await readJson(FILE);
    if (!a?.user?.hash || !a.secret) {
      a = defaultAuth();
      await writeJson(FILE, a);
    }
    cached = a;
    return a;
  });
}

function mutateAuth(fn) {
  return withLock(FILE, async () => {
    let a = await readJson(FILE);
    if (!a?.user?.hash || !a.secret) a = defaultAuth();
    const result = await fn(a);
    await writeJson(FILE, a);
    cached = a;
    return result;
  });
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

function makeToken(auth) {
  const body = b64(JSON.stringify({ u: auth.user.username.toLowerCase(), v: auth.user.version, exp: Date.now() + SESSION_MS }));
  return `${body}.${sign(auth.secret, body)}`;
}

function verifyToken(auth, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return false;
  const expected = sign(auth.secret, body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() && p.u === auth.user.username.toLowerCase() && p.v === auth.user.version;
  } catch {
    return false;
  }
}

function readCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function setSession(req, res, auth) {
  res.cookie(COOKIE, makeToken(auth), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MS,
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
  });
}

const describe = (auth, authenticated) => ({
  enabled: auth.enabled,
  authenticated,
  username: authenticated || !auth.enabled ? auth.user.username : null,
  defaultPassword: authenticated || !auth.enabled ? Boolean(auth.user.defaultPassword) : false,
});

// Bloqueo progresivo por IP tras 5 intentos fallidos seguidos.
const attempts = new Map();
const MAX_FREE_ATTEMPTS = 5;

function checkThrottle(ip) {
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) {
    const wait = Math.ceil((a.until - Date.now()) / 1000);
    const err = new HttpError(429, t('server.auth.too_many_attempts', { wait }));
    err.retryAfter = wait;
    throw err;
  }
}

function recordFailure(ip) {
  const a = attempts.get(ip) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= MAX_FREE_ATTEMPTS) a.until = Date.now() + Math.min(15 * 60, 30 * 2 ** (a.count - MAX_FREE_ATTEMPTS)) * 1000;
  attempts.set(ip, a);
}

export function resetThrottle() {
  attempts.clear();
}

export const requireAuth = wrap(async (req, _res, next) => {
  const auth = await loadAuth();
  if (!auth.enabled || verifyToken(auth, readCookie(req))) return next();
  throw new HttpError(401, t('server.auth.login_required'));
});

const router = Router();

router.get('/me', wrap(async (req, res) => {
  const auth = await loadAuth();
  res.json(describe(auth, verifyToken(auth, readCookie(req))));
}));

router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const ip = req.ip;
  checkThrottle(ip);
  const auth = await loadAuth();
  const userOk = typeof username === 'string' && username.trim().toLowerCase() === auth.user.username.toLowerCase();
  // Se calcula el hash siempre para no revelar por tiempo si el usuario existe.
  const passOk = typeof password === 'string' && checkPassword(password, auth.user);
  if (!userOk || !passOk) {
    recordFailure(ip);
    throw new HttpError(401, t('server.auth.bad_credentials'));
  }
  attempts.delete(ip);
  setSession(req, res, auth);
  res.json(describe(auth, true));
}));

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.use(requireAuth);

async function confirmCurrent(req) {
  const auth = await loadAuth();
  const current = req.body?.current;
  if (typeof current !== 'string' || !checkPassword(current, auth.user)) {
    recordFailure(req.ip);
    throw new HttpError(403, t('server.auth.wrong_current_password'));
  }
}

// Cambia usuario y/o contraseña; cierra el resto de sesiones.
router.post('/account', wrap(async (req, res) => {
  checkThrottle(req.ip);
  await confirmCurrent(req);
  const { username, password } = req.body;
  const auth = await mutateAuth((a) => {
    if (typeof username === 'string' && username.trim() && username.trim() !== a.user.username) {
      const u = username.trim();
      if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(u)) throw new HttpError(400, t('server.auth.invalid_username'));
      a.user.username = u;
    }
    if (typeof password === 'string' && password) {
      if (password.length < MIN_PASSWORD) throw new HttpError(400, t('server.auth.password_too_short', { min: MIN_PASSWORD }));
      if (password === DEFAULT_PASSWORD) throw new HttpError(400, t('server.auth.password_is_default'));
      Object.assign(a.user, hashPassword(password), { defaultPassword: false });
    }
    a.user.version += 1;
    return a;
  });
  setSession(req, res, auth);
  res.json(describe(auth, true));
}));

router.post('/revoke', wrap(async (req, res) => {
  const auth = await mutateAuth((a) => {
    a.user.version += 1;
    return a;
  });
  setSession(req, res, auth);
  res.json({ ok: true });
}));

router.post('/enabled', wrap(async (req, res) => {
  checkThrottle(req.ip);
  await confirmCurrent(req);
  const enabled = Boolean(req.body?.enabled);
  const auth = await mutateAuth((a) => {
    a.enabled = enabled;
    return a;
  });
  if (enabled) setSession(req, res, auth);
  res.json(describe(auth, true));
}));

export default router;
