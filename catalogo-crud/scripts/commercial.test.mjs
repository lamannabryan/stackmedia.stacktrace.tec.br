import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/config.mjs';
import { initializeCatalogDatabase } from '../src/database/catalog-database.mjs';
import { createApplication } from '../src/app.mjs';
import { createUserService, initializeUserSchema } from '../src/modules/users/user-service.mjs';
import { createArtworkService } from '../src/modules/artworks/artwork-service.mjs';
import { createSessionService } from '../src/modules/users/session-service.mjs';

const password = 'commercial-test-password';
const userData = (role = 'cliente', overrides = {}) => ({ name: role, email: `${role}@example.test`, password, role, ...overrides });
const generation = (key = 'request-0001', overrides = {}) => ({ idempotency_key: key, format: 'stories', output: 'png', ...overrides });
const status = code => error => error.statusCode === code;

async function unit(t, options = {}) {
  const database = new DatabaseSync(options.file || ':memory:');
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL');
  initializeUserSchema(database);
  t.after(() => database.close());
  const users = createUserService({ database });
  const client = await users.create(userData('cliente', options.user));
  const artworks = createArtworkService({ database, now: options.now });
  return { database, users, client, artworks };
}

async function cleanupDirectory(directory) {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('stackmedia-commercial-'));
  await rm(directory, { recursive: true, force: true });
}

async function httpFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'stackmedia-commercial-'));
  const config = loadConfig({ NODE_ENV: 'test', CATALOG_STORAGE_ROOT: directory,
    CATALOG_SOURCE: path.join(directory, 'products.json'), MANIFEST_SOURCE: path.join(directory, 'manifest.json') });
  await writeFile(config.sourceCatalogPath, JSON.stringify({ produtos: [{ id: 1, nome: 'Produto', status: 'pendente' }] }));
  await writeFile(config.sourceManifestPath, '{"produtos":[]}');
  const database = await initializeCatalogDatabase(config);
  const users = createUserService({ database });
  const superadmin = await users.create(userData('superadministrador'), { firstSuperAdminOnly: true });
  const admin = await users.create(userData('administrador'));
  const client = await users.create(userData());
  const errors = [];
  const server = createServer(createApplication({ config, database, logger: { error: error => errors.push(error) } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    database.close();
    await cleanupDirectory(directory);
    assert.deepEqual(errors, []);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (route, { session, body, headers, ...options } = {}) => fetch(origin + route, {
    redirect: 'manual', ...options, headers: {
      ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers,
    }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  async function login(user = superadmin) {
    const response = await call('/api/auth/login', { method: 'POST', body: { email: user.email, password } });
    assert.equal(response.status, 200);
    return { ...await response.json(), cookie: response.headers.get('set-cookie').split(';')[0] };
  }
  return { directory, config, database, users, superadmin, admin, client, call, login };
}

test('legacy migration preserves accounts, sessions, indexes and references; reruns preserve commerce data', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('administrador', 'cliente')),
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX legacy_user_name ON users(name);
      CREATE TABLE user_sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL);
      INSERT INTO users VALUES (42, 'Admin', 'legacy@example.test', 'scrypt:unchanged', 'administrador', 1, 'created', 'updated');
      INSERT INTO user_sessions VALUES ('token', 42, 'csrf', 9999999999999);`);
    initializeUserSchema(database);
    assert.equal(database.prepare('SELECT * FROM users').get().password_hash, 'scrypt:unchanged');
    assert.equal(database.prepare('SELECT * FROM users').get().role, 'administrador');
    assert.equal(database.prepare('SELECT * FROM users').get().artwork_limit, null);
    assert.equal(database.prepare('SELECT * FROM user_sessions').get().user_id, 42);
    assert.ok(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'legacy_user_name'").get());
    database.prepare("UPDATE users SET role = 'superadministrador', artwork_limit = 7, artwork_limit_period = 'monthly' WHERE id = 42").run();
    createArtworkService({ database }).generate(42, generation());
    initializeUserSchema(database);
    assert.equal(database.prepare('SELECT * FROM users').get().artwork_limit, 7);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM artwork_generations').get().n, 1);
    assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    database.prepare('DELETE FROM users WHERE id = 42').run();
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM artwork_generations').get().n, 0);
  } finally { database.close(); }
});

test('monthly quota renews at Sao Paulo midnight; total quota and idempotency survive period changes', async t => {
  let time = Date.parse('2026-11-01T02:59:59.999Z');
  const f = await unit(t, { user: { artwork_limit: 1, artwork_limit_period: 'monthly' }, now: () => time });
  const first = f.artworks.generate(f.client.id, generation());
  assert.equal(first.quota.period_month, '2026-10');
  assert.equal(first.quota.remaining, 0);
  assert.throws(() => f.artworks.generate(f.client.id, generation('request-0002')), status(403));
  assert.equal(f.artworks.generate(f.client.id, generation()).replayed, true);
  time += 1;
  assert.equal(f.artworks.quota(f.client.id).period_month, '2026-11');
  assert.equal(f.artworks.quota(f.client.id).remaining, 1);
  assert.equal(f.artworks.generate(f.client.id, generation()).quota.used, 0);
  f.artworks.generate(f.client.id, generation('request-0002'));
  f.users.updateCommercial(f.client.id, { artwork_limit_period: 'total', artwork_limit: 2 });
  time = Date.parse('2027-01-01T03:00:00Z');
  assert.equal(f.artworks.quota(f.client.id).used, 2);
  assert.throws(() => f.artworks.generate(f.client.id, generation('request-0003')), status(403));
  f.users.updateCommercial(f.client.id, { artwork_limit: 3 });
  assert.equal(f.artworks.generate(f.client.id, generation('request-0003')).quota.remaining, 0);
});

test('zero, unlimited, invalid requests, user isolation and idempotency conflicts', async t => {
  const f = await unit(t, { user: { artwork_limit: 0 } });
  assert.throws(() => f.artworks.generate(f.client.id, generation()), status(403));
  f.users.updateCommercial(f.client.id, { artwork_limit: null });
  assert.equal(f.artworks.generate(f.client.id, generation()).quota.remaining, null);
  const second = await f.users.create(userData('cliente', { email: 'second@example.test', artwork_limit: 1 }));
  assert.equal(f.artworks.generate(second.id, generation()).replayed, false);
  for (const body of [null, [], { ...generation(), user_id: second.id }, generation('short'), generation('request-0002', { output: 'jpg' }),
    generation('request-0002', { format: 'unknown' }), generation('request-0002', { format: 'indoor-h', output: 'png' })]) {
    assert.throws(() => f.artworks.generate(f.client.id, body), status(400));
  }
  assert.throws(() => f.artworks.generate(f.client.id, generation('request-0001', { output: 'mp4' })), status(409));
  assert.equal(f.artworks.quota(f.client.id).used, 1);
  f.users.updateCommercial(f.client.id, { access_expires_at: '2020-01-01T00:00:00Z' });
  assert.throws(() => f.artworks.generate(f.client.id, generation()), status(403));
  assert.equal(f.artworks.quota(f.client.id).can_generate, false);
});

test('concurrent independent database connections cannot exceed the last available art', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'stackmedia-commercial-'));
  const file = path.join(directory, 'quota.sqlite');
  const f = await unit(t, { file, user: { artwork_limit: 1 } });
  t.after(() => cleanupDirectory(directory));
  const url = new URL('../src/modules/artworks/artwork-service.mjs', import.meta.url).href;
  const results = await Promise.all(Array.from({ length: 4 }, (_, index) => new Promise((resolve, reject) => {
    const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { DatabaseSync } = await import('node:sqlite');
        const { createArtworkService } = await import(workerData.url);
        const database = new DatabaseSync(workerData.file);
        database.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON');
        try { createArtworkService({ database }).generate(workerData.id, workerData.payload); parentPort.postMessage(201); }
        catch (error) { parentPort.postMessage(error.statusCode || error.message); }
        finally { database.close(); }
      })().catch(error => { throw error; });`,
    { eval: true, workerData: { file, url, id: f.client.id, payload: generation(`concurrent-${index}`) } });
    let result;
    worker.on('message', value => { result = value; });
    worker.once('error', reject);
    worker.once('exit', code => code === 0 ? resolve(result) : reject(new Error(`Worker exited ${code}`)));
  })));
  assert.deepEqual(results.sort(), [201, 403, 403, 403]);
  assert.equal(f.artworks.quota(f.client.id).used, 1);
});

test('commercial values validate strictly and ordinary user edits preserve configured limits', async t => {
  const f = await unit(t);
  for (const change of [{ artwork_limit: -1 }, { artwork_limit: 1.5 }, { artwork_limit: '10' }, { artwork_limit: true },
    { artwork_limit: Number.MAX_SAFE_INTEGER + 1 }, { artwork_limit_period: 'weekly' }, { access_expires_at: '' },
    { access_expires_at: 123 }, { access_expires_at: '2026-11-01' }, { access_expires_at: '2026-11-01T00:00:00' },
    { access_expires_at: '2026-02-30T00:00:00Z' }, { access_expires_at: '2026-11-01T24:00:00Z' }, { role: 'cliente' }, {}]) {
    assert.throws(() => f.users.updateCommercial(f.client.id, change), status(400));
  }
  f.users.updateCommercial(f.client.id, { artwork_limit: 20, artwork_limit_period: 'monthly', access_expires_at: '2030-11-01T00:00:00-03:00' });
  const updated = await f.users.update(f.client.id, { name: 'Renamed', email: f.client.email, role: 'cliente' });
  assert.equal(updated.artwork_limit, 20);
  assert.equal(updated.artwork_limit_period, 'monthly');
  assert.equal(updated.access_expires_at, '2030-11-01T03:00:00.000Z');
});

test('only superadministrators manage commercial terms and protected accounts, through every write route', async t => {
  const f = await httpFixture(t);
  const root = await f.login();
  const admin = await f.login(f.admin);
  const client = await f.login(f.client);
  const route = `/api/users/${f.client.id}/commercial`;
  for (const session of [admin, client]) {
    assert.equal((await f.call(route, { session })).status, 403);
    assert.equal((await f.call(route, { method: 'PUT', session, body: { artwork_limit: 5 } })).status, 403);
  }
  assert.equal((await f.call(route, { method: 'PUT', session: root, headers: { 'X-CSRF-Token': '' }, body: { artwork_limit: 5 } })).status, 403);
  assert.equal((await f.call(route, { method: 'PUT', session: root, body: { artwork_limit: 5, artwork_limit_period: 'monthly' } })).status, 200);
  assert.equal((await f.call(route, { session: root })).status, 200);
  for (const change of [{ role: 'superadministrador' }, { artwork_limit: null }, { artwork_limit_period: 'total' }, { access_expires_at: '2030-01-01T00:00:00Z' }]) {
    assert.equal((await f.call(`/api/users/${f.client.id}`, { method: 'PUT', session: admin, body: { ...f.users.get(f.client.id), ...change } })).status, 403);
  }
  for (const change of [{ role: 'superadministrador' }, { artwork_limit: 5 }, { access_expires_at: '2030-01-01T00:00:00Z' }]) {
    assert.equal((await f.call('/api/users', { method: 'POST', session: admin, body: userData('cliente', { email: 'new@example.test', ...change }) })).status, 403);
  }
  for (const body of [{ ...f.superadmin, name: 'Renamed' }, { ...f.superadmin, password: 'replacement-password' }, { ...f.superadmin, role: 'cliente' }, { ...f.superadmin, active: false }]) {
    assert.equal((await f.call(`/api/users/${f.superadmin.id}`, { method: 'PUT', session: admin, body })).status, 403);
  }
  assert.equal((await f.call(`/api/users/${f.superadmin.id}`, { method: 'DELETE', session: admin })).status, 403);
  assert.equal((await f.call(`/api/users/${f.client.id}`, { method: 'PUT', session: admin, body: { name: 'Renamed', email: f.client.email, role: 'cliente' } })).status, 200);
  assert.equal(f.users.get(f.client.id).artwork_limit, 5);
  const created = await f.call('/api/users', { method: 'POST', session: root, body: userData('cliente', { email: 'new@example.test', artwork_limit: 8 }) });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).artwork_limit, 8);
  for (const change of [{ role: 'administrador' }, { active: false }, { access_expires_at: '2030-01-01T00:00:00Z' }]) {
    assert.equal((await f.call(`/api/users/${f.superadmin.id}`, { method: 'PUT', session: root, body: { ...f.superadmin, ...change } })).status, 409);
  }
  assert.equal((await f.call(`/api/users/${f.superadmin.id}/commercial`, { method: 'PUT', session: root, body: { access_expires_at: '2030-01-01T00:00:00Z' } })).status, 409);
  assert.equal((await f.call('/api/products?status=pendente', { session: root })).status, 200);
  assert.equal((await (await f.call('/api/products/1', { session: root })).json()).status, 'pendente');
  const product = await f.call('/api/products', { method: 'POST', session: root, body: { nome: 'Produto superadmin' } });
  assert.equal(product.status, 201);
  assert.equal((await product.json()).status, 'ativo');
  await assert.rejects(f.users.create(userData('superadministrador', { email: 'second-root@example.test' }), { firstSuperAdminOnly: true }), status(409));
});

test('generation HTTP endpoint authenticates, checks CSRF, uses the session owner and enforces updated quotas', async t => {
  const f = await httpFixture(t);
  const route = '/api/artworks/generations';
  assert.equal((await f.call(route, { method: 'POST', body: generation() })).status, 401);
  const client = await f.login(f.client);
  assert.equal((await f.call(route, { method: 'POST', session: client, body: generation(), headers: { 'X-CSRF-Token': '' } })).status, 403);
  assert.equal((await f.call(route, { method: 'POST', session: client, body: { ...generation(), user_id: f.admin.id } })).status, 400);
  f.users.updateCommercial(f.client.id, { artwork_limit: 1 });
  const first = await f.call(route, { method: 'POST', session: client, body: generation() });
  assert.equal(first.status, 201);
  assert.equal((await first.json()).quota.remaining, 0);
  assert.equal((await f.call(route, { method: 'POST', session: client, body: generation() })).status, 200);
  assert.equal((await f.call(route, { method: 'POST', session: client, body: generation('request-0002') })).status, 403);
  assert.equal((await (await f.call('/api/artworks/quota', { session: client })).json()).used, 1);
  for (const user of [f.admin, f.superadmin]) {
    const session = await f.login(user);
    f.users.updateCommercial(user.id, { artwork_limit: 0 });
    assert.equal((await f.call(route, { method: 'POST', session, body: generation() })).status, 403);
  }
});

test('expiration denies login and existing sessions, including pages; renewal requires a new login', async t => {
  const f = await httpFixture(t);
  const session = await f.login(f.client);
  f.users.updateCommercial(f.client.id, { access_expires_at: '2030-01-01T00:00:00Z' });
  assert.equal((await f.call('/api/auth/me', { session })).status, 401);
  const current = await f.login(f.client);
  // Simulate time reaching the configured expiry without an administrative update.
  f.database.prepare('UPDATE users SET access_expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1).toISOString(), f.client.id);
  assert.equal((await f.call('/api/products', { session: current })).status, 401);
  assert.equal((await f.call('/artes/stories', { session: current })).status, 302);
  assert.equal((await f.call('/api/auth/login', { method: 'POST', body: { email: f.client.email, password } })).status, 403);
  assert.equal((await f.call('/api/auth/login', { method: 'POST', body: { email: f.client.email, password: 'wrong-password' } })).status, 401);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ?').get(f.client.id).n, 0);
  f.users.updateCommercial(f.client.id, { access_expires_at: null });
  assert.equal((await f.call('/api/auth/me', { session: current })).status, 401);
  assert.equal((await f.login(f.client)).user.access_expires_at, null);
});

test('expired actors and concurrent privilege changes cannot mutate users after password hashing', async t => {
  const f = await unit(t);
  const root = await f.users.create(userData('superadministrador'));
  const admin = await f.users.create(userData('administrador'));
  const pending = f.users.update(f.client.id, { ...f.client, password: 'replacement-password' }, { actor: admin });
  await f.users.update(admin.id, { ...admin, role: 'cliente' });
  await assert.rejects(pending, status(403));
  f.database.prepare('UPDATE users SET access_expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', root.id);
  assert.throws(() => f.users.updateCommercial(f.client.id, { artwork_limit: 3 }, { actor: root }), status(401));
  assert.equal(f.users.get(f.client.id).artwork_limit, null);
});

test('login rechecks expiration after asynchronous password verification', async t => {
  const f = await unit(t);
  const sessions = createSessionService({ database: f.database, config: { environment: 'test' } });
  const pending = sessions.login({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }, { email: f.client.email, password });
  f.users.updateCommercial(f.client.id, { access_expires_at: '2020-01-01T00:00:00Z' });
  await assert.rejects(pending, status(403));
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n, 0);
});

test('login rejects account restrictions before issuing a cookie and reveals reasons only after a valid password', async t => {
  const f = await httpFixture(t);
  const cases = [
    { active: false, code: 'ACCOUNT_INACTIVE' },
    { access_expires_at: '2020-01-01T00:00:00Z', code: 'ACCESS_EXPIRED' },
    { artwork_limit: 0, code: 'ARTWORK_LIMIT_REACHED' },
    { artwork_limit: 0, artwork_limit_period: 'monthly', code: 'ARTWORK_LIMIT_REACHED' },
    { artwork_limit: 1, used: true, code: 'ARTWORK_LIMIT_REACHED' },
    { artwork_limit: 1, artwork_limit_period: 'monthly', used: true, code: 'ARTWORK_LIMIT_REACHED' },
  ];
  for (const [index, { code, used, ...conditions }] of cases.entries()) {
    const user = await f.users.create(userData('cliente', { ...conditions, email: `blocked-${index}@example.test` }));
    if (used) createArtworkService({ database: f.database }).generate(user.id, generation());
    const before = f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ?').get(user.id).n;
    const wrong = await f.call('/api/auth/login', { method: 'POST', body: { email: user.email, password: 'wrong-password' } });
    assert.equal(wrong.status, 401);
    assert.deepEqual(await wrong.json(), { error: 'E-mail ou senha inválidos.' });
    const response = await f.call('/api/auth/login', { method: 'POST', body: {
      email: user.email, password, active: true, artwork_limit: null, access_expires_at: null, role: 'superadministrador',
    } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.equal(result.code, code);
    assert.equal('csrfToken' in result, false);
    assert.equal('user' in result, false);
    assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ?').get(user.id).n, before);
    await f.users.update(user.id, { ...user, active: true, artwork_limit: null, access_expires_at: null });
    assert.equal((await f.login(user)).user.id, user.id);
  }
});

test('monthly login eligibility renews at Sao Paulo midnight; total packages require more quota', async t => {
  let time = Date.parse('2026-11-01T02:59:59.999Z');
  const f = await unit(t, { user: { artwork_limit: 1, artwork_limit_period: 'monthly' }, now: () => time });
  const sessions = createSessionService({ database: f.database, config: { environment: 'test' }, now: () => time });
  const request = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  const credentials = { email: f.client.email, password };
  f.artworks.generate(f.client.id, generation());
  await assert.rejects(sessions.login(request, credentials), error => error.code === 'ARTWORK_LIMIT_REACHED');
  time += 1;
  assert.equal((await sessions.login(request, credentials)).user.id, f.client.id);
  assert.equal(f.artworks.quota(f.client.id).used, 0); // Logging in never consumes an art.
  f.users.updateCommercial(f.client.id, { artwork_limit_period: 'total' });
  await assert.rejects(sessions.login(request, credentials), error => error.code === 'ARTWORK_LIMIT_REACHED');
  f.users.updateCommercial(f.client.id, { artwork_limit: 2 });
  assert.equal((await sessions.login(request, credentials)).user.id, f.client.id);
  assert.equal(f.artworks.quota(f.client.id).remaining, 1);
});

test('quota exhaustion blocks new logins without adding a quota gate to existing sessions', async t => {
  const f = await httpFixture(t);
  for (const user of [f.client, f.admin, f.superadmin]) {
    const session = await f.login(user);
    f.users.updateCommercial(user.id, { artwork_limit: 0 });
    const denied = await f.call('/api/auth/login', { method: 'POST', body: { email: user.email, password } });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, 'ARTWORK_LIMIT_REACHED');
    assert.equal((await f.call('/api/auth/me', { session })).status, 200);
  }
});

test('login rechecks quota changes and consumption made during password verification', async t => {
  const f = await unit(t, { user: { artwork_limit: 1 } });
  const sessions = createSessionService({ database: f.database, config: { environment: 'test' } });
  const request = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  const credentials = { email: f.client.email, password };
  const duringConsumption = sessions.login(request, credentials);
  f.artworks.generate(f.client.id, generation());
  await assert.rejects(duringConsumption, error => error.code === 'ARTWORK_LIMIT_REACHED');
  f.users.updateCommercial(f.client.id, { artwork_limit: 2 });
  const duringLimitChange = sessions.login(request, credentials);
  f.users.updateCommercial(f.client.id, { artwork_limit: 0 });
  await assert.rejects(duringLimitChange, error => error.code === 'ARTWORK_LIMIT_REACHED');
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n, 0);
});

test('superadmin bootstrap works on an existing installation and MariaDB export includes commercial data', async t => {
  const f = await httpFixture(t);
  // Use the real CLI with only isolated paths and test credentials, never the local .env.
  const env = { ...process.env, NODE_ENV: 'test', CATALOG_STORAGE_ROOT: f.directory,
    CATALOG_DATABASE_PATH: f.config.databasePath, CATALOG_SOURCE: f.config.sourceCatalogPath, MANIFEST_SOURCE: f.config.sourceManifestPath,
    BOOTSTRAP_ADMIN_NAME: 'Bootstrap', BOOTSTRAP_ADMIN_EMAIL: 'bootstrap@example.test', BOOTSTRAP_ADMIN_PASSWORD: password };
  const cli = new URL('./create-admin.mjs', import.meta.url);
  const { fileURLToPath } = await import('node:url');
  let result = spawnSync(process.execPath, [fileURLToPath(cli), '--super-admin'], { env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  f.database.prepare('DELETE FROM users WHERE id = ?').run(f.superadmin.id);
  result = spawnSync(process.execPath, [fileURLToPath(cli), '--super-admin'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.database.prepare("SELECT role FROM users WHERE email = 'bootstrap@example.test'").get().role, 'superadministrador');
  f.users.updateCommercial(f.client.id, { artwork_limit: 3 });
  createArtworkService({ database: f.database }).generate(f.client.id, generation());
  result = spawnSync(process.execPath, [fileURLToPath(new URL('./export-mariadb.mjs', import.meta.url)),
    f.config.databasePath, path.join(f.directory, 'dump.sql')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).tables.artwork_generations, 1);
});
