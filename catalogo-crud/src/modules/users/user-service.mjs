import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { badRequest, HttpError } from '../../http/errors.mjs';
import { accessExpired, isAdminRole, ROLES, SUPER_ADMIN_ROLE } from './permissions.mjs';
import { commercialPolicy, COMMERCIAL_FIELDS } from './commercial-policy.mjs';
export { ROLES } from './permissions.mjs';
export { initializeUserSchema } from './schema.mjs';

const scrypt = promisify(scryptCallback);
const publicColumns = 'id, name, email, role, active, created_at, updated_at, access_expires_at, artwork_limit, artwork_limit_period';

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
  const { id, name, email, role, active, created_at, updated_at, access_expires_at, artwork_limit, artwork_limit_period } = row;
  return { id, name, email, role, active: Boolean(active), created_at, updated_at,
    access_expires_at, artwork_limit, artwork_limit_period };
}

export function createUserService({ database }) {
  const get = (id) => publicUser(database.prepare(`SELECT ${publicColumns} FROM users WHERE id = ?`).get(id));
  function validate(payload, current) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw badRequest('Dados de usuário inválidos.');
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!name || name.length > 120) throw badRequest('Informe um nome com até 120 caracteres.');
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Informe um e-mail válido.');
    if (!ROLES.includes(payload.role)) throw badRequest('Perfil inválido. Escolha superadministrador, administrador ou cliente.');
    if (payload.active !== undefined && typeof payload.active !== 'boolean') throw badRequest('Situação de usuário inválida.');
    return { name, email, role: payload.role, active: payload.active !== false ? 1 : 0, ...commercialPolicy(payload, current) };
  }
  function duplicate(email, id = 0) {
    if (database.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, id)) {
      throw new HttpError(409, 'Este e-mail já está cadastrado.');
    }
  }
  function authorize(actor, current, next, { commercialOnly = false } = {}) {
    // Calls without an actor are reserved for trusted local scripts and fixtures.
    // HTTP routes always supply the authenticated actor; re-read after awaits.
    if (actor === undefined) return;
    const latest = actor && get(actor.id);
    if (!latest?.active || accessExpired(latest)) throw new HttpError(401, 'Faça login para continuar.');
    if (!isAdminRole(latest.role)) throw new HttpError(403, 'Acesso exclusivo para administradores.');
    if (latest.role === SUPER_ADMIN_ROLE) return;
    const defaults = current || commercialPolicy({});
    if (commercialOnly || current?.role === SUPER_ADMIN_ROLE || next?.role === SUPER_ADMIN_ROLE
      || (next && COMMERCIAL_FIELDS.some(key => next[key] !== defaults[key]))) {
      throw new HttpError(403, 'Acesso exclusivo para superadministradores.');
    }
  }
  function protectLastAdmin(current, next) {
    if (current.role === SUPER_ADMIN_ROLE && current.active
      && (!next.active || next.role !== SUPER_ADMIN_ROLE || next.access_expires_at != null)
      && !database.prepare("SELECT id FROM users WHERE id != ? AND role = 'superadministrador' AND active = 1 AND access_expires_at IS NULL LIMIT 1").get(current.id)) {
      throw new HttpError(409, 'Mantenha pelo menos um superadministrador ativo e sem expiração.');
    }
    if (isAdminRole(current.role) && current.active && (!next.active || !isAdminRole(next.role) || next.access_expires_at != null)
      && !database.prepare("SELECT id FROM users WHERE id != ? AND role IN ('administrador', 'superadministrador') AND active = 1 AND access_expires_at IS NULL LIMIT 1").get(current.id)) {
      throw new HttpError(409, 'Mantenha pelo menos um administrador ativo.');
    }
  }
  async function create(payload, { firstAdminOnly = false, firstSuperAdminOnly = false, actor } = {}) {
    const user = validate(payload);
    authorize(actor, null, user);
    duplicate(user.email);
    const hash = await hashPassword(payload.password);
    database.exec('BEGIN IMMEDIATE');
    try {
      authorize(actor, null, user);
      if (firstAdminOnly && database.prepare('SELECT id FROM users LIMIT 1').get()) {
        throw new HttpError(409, 'O primeiro administrador já foi criado. Use a gestão de usuários.');
      }
      if (firstSuperAdminOnly && (user.role !== SUPER_ADMIN_ROLE || !user.active || user.access_expires_at !== null)) {
        throw badRequest('O primeiro superadministrador deve estar ativo e sem expiração.');
      }
      if (firstSuperAdminOnly && database.prepare("SELECT id FROM users WHERE role = 'superadministrador' LIMIT 1").get()) {
        throw new HttpError(409, 'Já existe um superadministrador. Use a API de gestão de usuários.');
      }
      duplicate(user.email);
      const now = new Date().toISOString();
      const result = database.prepare(`INSERT INTO users (name, email, role, active, password_hash, created_at, updated_at,
        access_expires_at, artwork_limit, artwork_limit_period) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(user.name, user.email, user.role, user.active, hash, now, now, user.access_expires_at, user.artwork_limit, user.artwork_limit_period);
      const created = get(Number(result.lastInsertRowid));
      database.exec('COMMIT');
      return created;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  async function update(id, payload, { actor } = {}) {
    const initial = get(id);
    if (!initial) throw new HttpError(404, 'Usuário não encontrado.');
    const user = validate(payload, initial);
    authorize(actor, initial, user);
    duplicate(user.email, id);
    const hash = payload.password ? await hashPassword(payload.password) : null;
    database.exec('BEGIN IMMEDIATE');
    try {
      const current = get(id);
      if (!current) throw new HttpError(404, 'Usuário não encontrado.');
      // Preserve commercial fields omitted by older clients, including concurrent edits.
      Object.assign(user, commercialPolicy(payload, current));
      authorize(actor, current, user);
      protectLastAdmin(current, user);
      duplicate(user.email, id);
      database.prepare(`UPDATE users SET name = ?, email = ?, role = ?, active = ?,
        password_hash = COALESCE(?, password_hash), updated_at = ?, access_expires_at = ?, artwork_limit = ?, artwork_limit_period = ? WHERE id = ?`)
        .run(user.name, user.email, user.role, user.active, hash, new Date().toISOString(),
          user.access_expires_at, user.artwork_limit, user.artwork_limit_period, id);
      if (hash || current.role !== user.role || current.active !== Boolean(user.active) || current.email !== user.email
        || current.access_expires_at !== user.access_expires_at) {
        database.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
      }
      database.exec('COMMIT');
      return get(id);
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  function updateCommercial(id, payload, { actor } = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || !Object.keys(payload).length || Object.keys(payload).some(key => !COMMERCIAL_FIELDS.includes(key))) {
      throw badRequest('Informe somente os campos comerciais: access_expires_at, artwork_limit e artwork_limit_period.');
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      const current = get(id);
      if (!current) throw new HttpError(404, 'Usuário não encontrado.');
      const next = { ...current, ...commercialPolicy(payload, current) };
      authorize(actor, current, next, { commercialOnly: true });
      protectLastAdmin(current, next);
      database.prepare(`UPDATE users SET access_expires_at = ?, artwork_limit = ?, artwork_limit_period = ?, updated_at = ? WHERE id = ?`)
        .run(next.access_expires_at, next.artwork_limit, next.artwork_limit_period, new Date().toISOString(), id);
      if (current.access_expires_at !== next.access_expires_at) database.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
      database.exec('COMMIT');
      return get(id);
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  function remove(id, actorId, { actor } = {}) {
    if (id === actorId) throw new HttpError(409, 'Você não pode excluir sua própria conta.');
    database.exec('BEGIN IMMEDIATE');
    try {
      const current = get(id);
      if (!current) throw new HttpError(404, 'Usuário não encontrado.');
      authorize(actor, current, null);
      protectLastAdmin(current, { active: false });
      database.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
      database.prepare('DELETE FROM users WHERE id = ?').run(id);
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  return { get, create, update, updateCommercial, remove,
    list: () => database.prepare(`SELECT ${publicColumns} FROM users ORDER BY name COLLATE NOCASE, id`).all().map(publicUser),
  };
}
