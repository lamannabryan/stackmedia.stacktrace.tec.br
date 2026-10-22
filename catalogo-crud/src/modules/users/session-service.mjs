import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from '../../http/errors.mjs';
import { publicUser, verifyPassword } from './user-service.mjs';

const COOKIE = 'stackmedia_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const digest = (value) => createHash('sha256').update(value).digest('hex');

export function createSessionService({ database, config }) {
  function cookie(token, clear = false) {
    const secure = config.environment === 'production' || config.secureCookies;
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
  }
  function tokenHash(request) {
    const token = String(request.headers.cookie || '').split(';').map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    return /^[a-f0-9]{64}$/.test(token || '') ? digest(token) : null;
  }
  function current(request) {
    const token = tokenHash(request);
    if (!token) return null;
    const row = database.prepare(`SELECT users.*, user_sessions.csrf_token FROM user_sessions
      JOIN users ON users.id = user_sessions.user_id
      WHERE token_hash = ? AND expires_at > ? AND users.active = 1`).get(token, Date.now());
    return row ? { user: publicUser(row), csrfToken: row.csrf_token } : null;
  }
  async function login(request, payload) {
    const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase().slice(0, 254) : '';
    const now = Date.now();
    database.prepare('DELETE FROM login_attempts WHERE expires_at <= ?').run(now);
    database.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(now);
    // Use the socket address, never an untrusted forwarded IP header.
    const keys = [[`email:${email}`, 10], [`ip:${request.socket.remoteAddress}`, 100]];
    for (const [key, limit] of keys) {
      const entry = database.prepare('SELECT attempts FROM login_attempts WHERE key = ?').get(digest(key));
      if (entry?.attempts >= limit) throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos e tente novamente.');
    }
    for (const [key] of keys) database.prepare(`INSERT INTO login_attempts (key, attempts, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1`).run(digest(key), now + WINDOW_MS);
    const account = database.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const valid = await verifyPassword(payload?.password, account?.password_hash);
    // Recheck after password derivation: disabling/resetting a user must win a concurrent login.
    const latest = account && database.prepare('SELECT * FROM users WHERE id = ?').get(account.id);
    if (!valid || !latest?.active || latest.password_hash !== account.password_hash) {
      throw new HttpError(401, 'E-mail ou senha inválidos.');
    }
    database.prepare('DELETE FROM login_attempts WHERE key = ?').run(digest(`email:${email}`));
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    const old = tokenHash(request);
    if (old) database.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(old);
    database.prepare('INSERT INTO user_sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)')
      .run(digest(token), latest.id, csrfToken, now + SESSION_MS);
    return { user: publicUser(latest), csrfToken, cookie: cookie(token) };
  }
  function logout(request) {
    const token = tokenHash(request);
    if (token) database.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(token);
    return cookie('', true);
  }
  return { current, login, logout };
}

export function requireAdmin(session) {
  if (!session) throw new HttpError(401, 'Faça login para continuar.');
  if (session.user.role !== 'administrador') throw new HttpError(403, 'Acesso exclusivo para administradores.');
}

export function validateMutation(request, session, { login = false, production = false } = {}) {
  const origin = request.headers.origin;
  const expectedHost = String(request.headers.host || '');
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Origem não permitida.');
  if (origin) {
    let allowed = false;
    try {
      const parsed = new URL(origin);
      const protocol = production || request.socket.encrypted ? 'https:' : 'http:';
      allowed = parsed.origin === origin && parsed.protocol === protocol && parsed.host === expectedHost;
    } catch { /* Invalid origin. */ }
    if (!allowed) throw new HttpError(403, 'Origem não permitida.');
  }
  if (!login && (!session || request.headers['x-csrf-token'] !== session.csrfToken)) {
    throw new HttpError(403, 'Sessão de segurança inválida. Atualize a página e tente novamente.');
  }
}
