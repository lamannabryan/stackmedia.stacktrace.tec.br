import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { loadConfig } from '../src/config.mjs';
import { initializeCatalogDatabase } from '../src/database/catalog-database.mjs';
import { createUserService, initializeUserSchema } from '../src/modules/users/user-service.mjs';
import { createApplication } from '../src/app.mjs';
import sharp from 'sharp';

async function fixture(t, environment = 'test', { integrationFetch, deepseek } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'stackmedia-auth-'));
  await writeFile(path.join(directory, 'products.json'), JSON.stringify({ produtos: [{ id: 1, nome: 'Produto', fabricante: 'Marca' }] }));
  await writeFile(path.join(directory, 'manifest.json'), '{"produtos":[]}');
  const config = { ...loadConfig({ NODE_ENV: environment, CATALOG_STORAGE_ROOT: directory,
    CATALOG_SOURCE: path.join(directory, 'products.json'), MANIFEST_SOURCE: path.join(directory, 'manifest.json') }) };
  config.storyBackgroundsDirectory = path.join(directory, 'stories');
  config.feedBackgroundsDirectory = path.join(directory, 'feed');
  config.encarteBackgroundsDirectory = path.join(directory, 'encarte');
  config.indoorBackgroundsDirectory = path.join(directory, 'indoor');
  config.imagesDirectory = path.join(directory, 'images');
  if (deepseek) config.deepseek = deepseek;
  const database = await initializeCatalogDatabase(config);
  const service = createUserService({ database });
  const admin = await service.create({ name: 'Admin', email: 'admin@example.test', password: 'admin-password-123', role: 'administrador' });
  const client = await service.create({ name: 'Cliente', email: 'client@example.test', password: 'client-password-123', role: 'cliente' });
  const errors = [];
  const server = createServer(createApplication({ config, database, integrationFetch, logger: { error: (error) => errors.push(error) } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); database.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('stackmedia-auth-'));
    await rm(directory, { recursive: true, force: true }); assert.deepEqual(errors, []);
  });
  const call = (route, { session, body, headers, ...options } = {}) => fetch(origin + route, {
    redirect: 'manual', ...options, headers: { ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  async function login(email = admin.email, password = 'admin-password-123') {
    const response = await call('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(response.status, 200);
    return { ...await response.json(), cookie: response.headers.get('set-cookie').split(';')[0], setCookie: response.headers.get('set-cookie') };
  }
  return { database, service, admin, client, origin, call, login };
}

test('DeepSeek lookup is authenticated and CSRF-protected, works for both roles and does not save products', async t => {
  let calls = 0;
  const ean = '3017620422003';
  const f = await fixture(t, 'test', { deepseek: { apiKey: 'test-secret' }, integrationFetch: async url => {
    calls++;
    return Response.json(url.endsWith('/search')
      ? { results: [{ title: 'Produto IA', url: 'https://example.com/product', content: `EAN ${ean}. Produto IA. Fabricante: Empresa IA.` }] }
      : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ean, encontrado: true,
        campos: { nome: { valor: 'Produto IA', fonte: 1, trecho: 'Produto IA.' }, subtitulo: null,
          fabricante: { valor: 'Empresa IA', fonte: 1, trecho: 'Fabricante: Empresa IA.' } } }) } }] });
  } });
  const route = '/api/products/lookup-ean';
  assert.equal((await f.call(route, { method: 'POST', body: { ean } })).status, 401);
  const clientSession = await f.login(f.client.email, 'client-password-123');
  assert.equal((await f.call(route, { method: 'POST', session: clientSession, headers: { 'X-CSRF-Token': '' }, body: { ean } })).status, 403);
  assert.equal((await f.call(route, { method: 'POST', session: clientSession, body: { ean: '3017620422004' } })).status, 400);
  assert.equal((await f.call(route, { method: 'POST', session: clientSession, body: { ean: ean.repeat(100) } })).status, 400);
  assert.equal(calls, 0);
  for (const session of [clientSession, await f.login()]) {
    const response = await f.call(route, { method: 'POST', session, body: { ean } });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.campos.nome, 'Produto IA');
    assert.equal(result.campos.fabricante, 'Empresa IA');
    assert.ok(!JSON.stringify(result).includes('test-secret'));
  }
  assert.equal(calls, 4);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM products').get().n, 1);
  const created = await f.call('/api/products', { method: 'POST', session: clientSession, body: { nome: 'Produto IA', fabricante: 'Empresa IA', ean, status: 'ativo' } });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).status, 'pendente');
});

test('administrators upload and remove backgrounds in each format; clients and invalid uploads are blocked', async (t) => {
  const f = await fixture(t);
  const session = await f.login();
  const client = await f.login(f.client.email, 'client-password-123');
  const buffer = await sharp({ create: { width: 24, height: 40, channels: 3, background: '#123456' } }).png().toBuffer();
  const body = { nome: 'Oferta especial', imagem: `data:image/png;base64,${buffer.toString('base64')}` };
  for (const page of ['/backgrounds', '/backgrounds.html', '/BACKGROUNDS.HTML', '/%62ackgrounds.html']) {
    assert.equal((await f.call(page, { session: client })).status, 403);
  }
  assert.equal((await f.call('/backgrounds', { session })).status, 200);
  for (const format of ['story', 'feed', 'encarte', 'indoor']) {
    const route = `/api/${format}-backgrounds`;
    assert.equal((await f.call(route, { method: 'POST', body })).status, 401);
    assert.equal((await f.call(route, { method: 'POST', session: client, body })).status, 403);
    assert.equal((await f.call(route, { method: 'POST', session, headers: { 'X-CSRF-Token': '' }, body })).status, 403);
    for (const invalid of [{ ...body, nome: '' }, { ...body, imagem: 'data:image/png;base64,YmFk' }]) {
      assert.equal((await f.call(route, { method: 'POST', session, body: invalid })).status, 400);
    }
    const response = await f.call(route, { method: 'POST', session, body });
    assert.equal(response.status, 201); const item = await response.json();
    assert.equal(item.nome, 'Oferta Especial');
    assert.equal((await f.call(item.url, { session: client })).status, 200);
    assert.equal((await f.call(item.thumbnail_url, { session: client })).status, 200);
    assert.equal((await (await f.call(route, { session: client })).json()).items.length, 1);
    const removal = `${route}/${encodeURIComponent(item.arquivo)}`;
    assert.equal((await f.call(removal, { method: 'DELETE', session: client })).status, 403);
    assert.equal((await f.call(`${route}/..%2Foutside.png`, { method: 'DELETE', session })).status, 403);
    assert.equal((await f.call(removal, { method: 'DELETE', session })).status, 204);
    assert.equal((await f.call(removal, { method: 'DELETE', session })).status, 404);
    assert.equal((await (await f.call(route, { session })).json()).items.length, 0);
    assert.equal((await f.call(item.url, { session })).status, 404);
  }
});

test('schema migrates without losing products, passwords and sessions are not stored in plaintext', async (t) => {
  const f = await fixture(t); initializeUserSchema(f.database);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM products').get().n, 1);
  assert.match(f.database.prepare('SELECT password_hash FROM users WHERE id = ?').get(f.admin.id).password_hash, /^scrypt:/);
  const session = await f.login();
  assert.match(session.setCookie, /HttpOnly/); assert.match(session.setCookie, /SameSite=Lax/);
  const stored = f.database.prepare('SELECT * FROM user_sessions').get();
  assert.notEqual(stored.token_hash, session.cookie.split('=')[1]);
  assert.equal('password_hash' in session.user, false);
  await assert.rejects(f.service.create({ name: 'Other', email: 'other@example.test', password: 'valid-password', role: 'administrador' }, { firstAdminOnly: true }), /já foi criado/);
});

test('anonymous access redirects pages, denies data and mutations, keeps login/PWA assets public', async (t) => {
  const f = await fixture(t);
  for (const route of ['/', '/catalogo', '/stories.html', '/usuarios', '/parceiros.html']) {
    const response = await f.call(route); assert.equal(response.status, 302, route); assert.match(response.headers.get('location'), /^\/login\?next=/);
  }
  for (const route of ['/api/products', '/api/users', '/api/featured-partners', '/api/product-images/search/3017620422003']) assert.equal((await f.call(route)).status, 401, route);
  assert.equal((await f.call('/api/products', { method: 'POST', body: { nome: 'Unauthorized' } })).status, 401);
  for (const route of ['/login', '/login.html', '/users.css', '/js/login.js', '/manifest.json', '/pwa-icons/icon-192.png', '/offline.html', '/sw.js']) {
    const response = await f.call(route);
    assert.equal(response.status, 200, route);
    // Finish static streams before teardown closes every server connection.
    await response.arrayBuffer();
  }
});

test('clients can read and create pending products, but only administrators can approve or mutate them', async (t) => {
  const f = await fixture(t); const session = await f.login(f.client.email, 'client-password-123');
  assert.equal((await f.call('/api/product-images/search/invalid', { session })).status, 400);
  assert.equal((await f.call('/api/product-images/search/3017620422003', { session })).status, 503);
  const aiResponse = await f.call('/api/products/lookup-ean', { method: 'POST', session, body: { ean: '3017620422003' } });
  assert.equal(aiResponse.status, 503);
  assert.match((await aiResponse.json()).error, /DEEPSEEK_API_KEY/);
  assert.equal((await f.call('/api/products', { method: 'POST', session,
    body: { nome: 'Invalid selection', ean: '3017620422003', imagem_busca_token: 'forged-token' } })).status, 400);
  assert.equal((await f.call('/api/products', { method: 'POST', session, headers: { 'X-CSRF-Token': '' },
    body: { nome: 'Blocked', ean: '3017620422003', imagem_busca_token: 'forged-token' } })).status, 403);
  for (const route of ['/catalogo', '/artes/stories', '/artes/feed', '/artes/indoor-h', '/api/products', '/api/featured-partners']) assert.equal((await f.call(route, { session })).status, 200, route);
  for (const route of ['/usuarios', '/usuarios.html', '/USUARIOS.HTML', '/%75suarios.html', '//usuarios.html', '/parceiros/', '/parceiros.html', '/PARCEIROS.HTML', '/%70arceiros.html', '/api/users', '/api/users/1']) {
    assert.equal((await f.call(route, { session })).status, 403, route);
  }
  const pendingResponse = await f.call('/api/products', { method: 'POST', session, body: { nome: 'Produto pendente', status: 'ativo' } });
  assert.equal(pendingResponse.status, 201);
  const pending = await pendingResponse.json();
  assert.equal(pending.status, 'pendente');
  const clientPendingListing = await (await f.call('/api/products?status=pendente', { session })).json();
  assert.equal(clientPendingListing.pagination.total, 0);
  assert.equal((await f.call(`/api/products/${pending.id}`, { session })).status, 404);
  assert.equal((await f.call(`/api/products/by-ean/${pending.ean || '00000000'}`, { session })).status, 404);

  for (const [method, route] of [['PUT', '/api/products/1'], ['DELETE', '/api/products/1'],
    ['PUT', '/api/featured-partners/1'], ['DELETE', '/api/featured-partners/1'], ['POST', '/api/users'], ['PUT', `/api/users/${f.client.id}`], ['DELETE', `/api/users/${f.admin.id}`]]) {
    assert.equal((await f.call(route, { method, session, body: { role: 'administrador', nome: 'Blocked' } })).status, 403, route);
  }
  const adminSession = await f.login();
  const adminPendingListing = await (await f.call('/api/products?status=pendente', { session: adminSession })).json();
  assert.equal(adminPendingListing.pagination.total, 1);
  const approved = await f.call(`/api/products/${pending.id}`, { method: 'PUT', session: adminSession, body: { status: 'ativo' } });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).status, 'ativo');
  assert.equal((await f.call(`/api/products/${pending.id}`, { session })).status, 200);
  assert.equal(f.service.get(f.client.id).role, 'cliente');
  assert.equal(f.database.prepare('SELECT nome FROM products WHERE id = 1').get().nome, 'Produto');
});

test('administrators manage users and products; input and unique e-mail are validated', async (t) => {
  const f = await fixture(t); const session = await f.login();
  const body = { name: 'Novo', email: 'new@example.test', password: 'new-password-123', role: 'cliente', active: true };
  const created = await f.call('/api/users', { method: 'POST', session, body }); assert.equal(created.status, 201);
  const user = await created.json(); assert.equal('password_hash' in user, false);
  const listing = await (await f.call('/api/users', { session })).json(); assert.equal(listing.items.length, 3);
  assert.equal((await f.call('/api/users', { method: 'POST', session, body: { ...body, email: 'NEW@EXAMPLE.TEST' } })).status, 409);
  for (const invalid of [{ password: 'short' }, { role: 'root' }, { email: 'bad' }, { name: '' }, { active: 'yes' }]) {
    assert.equal((await f.call('/api/users', { method: 'POST', session, body: { ...body, email: 'valid@example.test', ...invalid } })).status, 400);
  }
  assert.equal((await f.call(`/api/users/${user.id}`, { method: 'PUT', session, body: { ...body, name: 'Updated', role: 'administrador', password: '' } })).status, 200);
  assert.equal((await f.call(`/api/users/${user.id}`, { method: 'DELETE', session })).status, 204);
  const product = await f.call('/api/products', { method: 'POST', session, body: { nome: 'Novo produto' } }); assert.equal(product.status, 201);
  const createdProduct = await product.json();
  assert.equal(createdProduct.status, 'ativo');
  const { id } = createdProduct;
  assert.equal((await f.call(`/api/products/${id}`, { method: 'PUT', session, body: { nome: 'Editado' } })).status, 200);
  assert.equal((await f.call(`/api/products/${id}`, { method: 'DELETE', session })).status, 204);
});

test('last active administrator and own deletion are protected', async (t) => {
  const f = await fixture(t); const session = await f.login();
  for (const change of [{ role: 'cliente' }, { active: false }]) {
    assert.equal((await f.call(`/api/users/${f.admin.id}`, { method: 'PUT', session, body: { ...f.admin, ...change } })).status, 409);
  }
  assert.equal((await f.call(`/api/users/${f.admin.id}`, { method: 'DELETE', session })).status, 409);
  const second = await f.service.create({ name: 'Second', email: 'second@example.test', password: 'second-password', role: 'administrador' });
  const secondSession = await f.login(second.email, 'second-password');
  await f.service.update(second.id, { ...second, role: 'cliente' });
  assert.equal((await f.call('/api/users', { session: secondSession })).status, 401);
  assert.equal((await f.call(`/api/users/${f.admin.id}`, { method: 'DELETE', session: await f.login() })).status, 409);
});

test('blocking users, password reset, expiration and logout revoke sessions', async (t) => {
  const f = await fixture(t); let session = await f.login(f.client.email, 'client-password-123');
  await f.service.update(f.client.id, { ...f.client, active: false });
  assert.equal((await f.call('/api/auth/me', { session })).status, 401);
  const inactive = await f.call('/api/auth/login', { method: 'POST', body: { email: f.client.email, password: 'client-password-123' } });
  assert.equal(inactive.status, 403);
  assert.equal((await inactive.json()).code, 'ACCOUNT_INACTIVE');
  await f.service.update(f.client.id, { ...f.client, active: true });
  session = await f.login(f.client.email, 'client-password-123');
  await f.service.update(f.client.id, { ...f.client, password: 'changed-password' });
  assert.equal((await f.call('/api/auth/me', { session })).status, 401);
  session = await f.login(f.client.email, 'changed-password');
  f.database.prepare('UPDATE user_sessions SET expires_at = 0').run();
  assert.equal((await f.call('/api/auth/me', { session })).status, 401);
  session = await f.login(f.client.email, 'changed-password');
  const logout = await f.call('/api/auth/logout', { method: 'POST', session });
  assert.equal(logout.status, 204); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await f.call('/api/auth/me', { session })).status, 401);
});

test('CSRF, cross-origin login and malformed methods cannot bypass permissions', async (t) => {
  const f = await fixture(t); const session = await f.login();
  for (const headers of [{ 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'wrong' }, { Origin: 'https://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await f.call('/api/products', { method: 'POST', session, headers, body: { nome: 'Blocked' } })).status, 403);
  }
  assert.equal((await f.call('/api/auth/login', { method: 'POST', headers: { Origin: 'https://attacker.example' }, body: { email: f.admin.email, password: 'admin-password-123' } })).status, 403);
  assert.equal((await f.call('/api/auth/logout', { session })).status, 404);
  assert.equal((await f.call('/api/auth/me', { session })).status, 200);
  for (const route of ['/parceiros.html.', '/usuarios.html%20', '/%2570arceiros.html', '/usuarios.html:stream', '/foo%5cusuarios.html']) {
    assert.equal((await f.call(route, { session })).status, 403, route);
  }
});

test('local HTTP lookup accepts its own origin in development but production still requires HTTPS', async t => {
  for (const environment of ['development', 'production']) {
    const f = await fixture(t, environment);
    const session = await f.login(f.client.email, 'client-password-123');
    const route = '/api/products/lookup-ean';
    const local = await f.call(route, { method: 'POST', session,
      headers: { Origin: f.origin }, body: { ean: '3017620422003' } });
    assert.equal(local.status, environment === 'production' ? 403 : 503);
    assert.match((await local.json()).error, environment === 'production' ? /Origem não permitida/ : /DEEPSEEK_API_KEY/);
    const allowedOrigin = environment === 'production' ? f.origin.replace('http:', 'https:') : f.origin;
    const allowed = await f.call(route, { method: 'POST', session,
      headers: { Origin: allowedOrigin }, body: { ean: '3017620422003' } });
    assert.equal(allowed.status, 503); // Passed origin/CSRF checks and reached the unconfigured provider.
    for (const headers of [{ Origin: allowedOrigin, 'X-CSRF-Token': '' },
      { Origin: 'https://attacker.example' }, { Origin: allowedOrigin, 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await f.call(route, { method: 'POST', session, headers, body: { ean: '3017620422003' } })).status, 403);
    }
    assert.equal(session.setCookie.includes('; Secure'), environment === 'production');
  }
});

test('invalid login is generic and rate limited, production cookies are Secure', async (t) => {
  const f = await fixture(t, 'production');
  for (let i = 0; i < 10; i++) {
    const response = await f.call('/api/auth/login', { method: 'POST', body: { email: 'unknown@example.test', password: 'wrong-password' } });
    assert.equal(response.status, 401); assert.equal((await response.json()).error, 'E-mail ou senha inválidos.');
  }
  assert.equal((await f.call('/api/auth/login', { method: 'POST', body: { email: 'unknown@example.test', password: 'wrong-password' } })).status, 429);
  const session = await f.login(); assert.match(session.setCookie, /; Secure/);
});
