import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { badRequest, HttpError } from '../../http/errors.mjs';

const scrypt = promisify(scryptCallback);
const publicColumns = 'id, name, email, role, active, created_at, updated_at';
export const ROLES = Object.freeze(['administrador', 'cliente']);

export function initializeUserSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('administrador', 'cliente')),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS login_attempts (
      key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
    throw badRequest('A senha deve ter entre 10 e 128 caracteres.');
  }
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [, salt, hash] = String(encoded || '').split(':');
  // Unknown accounts still perform a password derivation.
  const actual = await scrypt(password, salt || 'stackmedia-unknown-account', 64);
  const expected = Buffer.from(hash || '00'.repeat(64), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual) && Boolean(hash);
}

export function publicUser(row) {
  if (!row) return null;
  const { id, name, email, role, active, created_at, updated_at } = row;
  return { id, name, email, role, active: Boolean(active), created_at, updated_at };
}

export function createUserService({ database }) {
  const get = (id) => publicUser(database.prepare(`SELECT ${publicColumns} FROM users WHERE id = ?`).get(id));
  function validate(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw badRequest('Dados de usuário inválidos.');
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!name || name.length > 120) throw badRequest('Informe um nome com até 120 caracteres.');
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Informe um e-mail válido.');
    if (!ROLES.includes(payload.role)) throw badRequest('Perfil inválido. Escolha administrador ou cliente.');
    if (payload.active !== undefined && typeof payload.active !== 'boolean') throw badRequest('Situação de usuário inválida.');
    return { name, email, role: payload.role, active: payload.active !== false ? 1 : 0 };
  }
  function duplicate(email, id = 0) {
    if (database.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, id)) {
      throw new HttpError(409, 'Este e-mail já está cadastrado.');
    }
  }
  function protectLastAdmin(current, next) {
    if (current.role === 'administrador' && current.active && (!next.active || next.role !== 'administrador')
      && database.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'administrador' AND active = 1").get().total <= 1) {
      throw new HttpError(409, 'Mantenha pelo menos um administrador ativo.');
    }
  }
  async function create(payload, { firstAdminOnly = false } = {}) {
    const user = validate(payload);
    duplicate(user.email);
    const hash = await hashPassword(payload.password);
    database.exec('BEGIN IMMEDIATE');
    try {
      if (firstAdminOnly && database.prepare('SELECT id FROM users LIMIT 1').get()) {
        throw new HttpError(409, 'O primeiro administrador já foi criado. Use a gestão de usuários.');
      }
      duplicate(user.email);
      const now = new Date().toISOString();
      const result = database.prepare(`INSERT INTO users (name, email, role, active, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(user.name, user.email, user.role, user.active, hash, now, now);
      const created = get(Number(result.lastInsertRowid));
      database.exec('COMMIT');
      return created;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  async function update(id, payload) {
    if (!get(id)) throw new HttpError(404, 'Usuário não encontrado.');
    const user = validate(payload);
    duplicate(user.email, id);
    const hash = payload.password ? await hashPassword(payload.password) : null;
    database.exec('BEGIN IMMEDIATE');
    try {
      const current = get(id);
      if (!current) throw new HttpError(404, 'Usuário não encontrado.');
      protectLastAdmin(current, user);
      duplicate(user.email, id);
      database.prepare(`UPDATE users SET name = ?, email = ?, role = ?, active = ?,
        password_hash = COALESCE(?, password_hash), updated_at = ? WHERE id = ?`)
        .run(user.name, user.email, user.role, user.active, hash, new Date().toISOString(), id);
      if (hash || current.role !== user.role || current.active !== Boolean(user.active) || current.email !== user.email) {
        database.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
      }
      database.exec('COMMIT');
      return get(id);
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  function remove(id, actorId) {
    if (id === actorId) throw new HttpError(409, 'Você não pode excluir sua própria conta.');
    database.exec('BEGIN IMMEDIATE');
    try {
      const current = get(id);
      if (!current) throw new HttpError(404, 'Usuário não encontrado.');
      protectLastAdmin(current, { active: false });
      database.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
      database.prepare('DELETE FROM users WHERE id = ?').run(id);
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  return { get, create, update, remove,
    list: () => database.prepare(`SELECT ${publicColumns} FROM users ORDER BY name COLLATE NOCASE, id`).all().map(publicUser),
  };
}
