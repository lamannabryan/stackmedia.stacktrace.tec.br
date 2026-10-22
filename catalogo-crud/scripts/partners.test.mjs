import { testSession } from './fixtures/auth.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import test from 'node:test';
import sharp from 'sharp';
import { loadConfig } from '../src/config.mjs';
import { initializeCatalogDatabase } from '../src/database/catalog-database.mjs';
import { createApplication } from '../src/app.mjs';

const logoBuffer = await sharp({ create: { width: 400, height: 180, channels: 4, background: '#e21a5980' } }).png().toBuffer();
const logo = `data:image/png;base64,${logoBuffer.toString('base64')}`;

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'stackmedia-partners-'));
  const catalog = path.join(directory, 'products.json');
  const manifest = path.join(directory, 'manifest.json');
  await fs.writeFile(catalog, JSON.stringify({ produtos: [
    { id: 1, nome: 'Produto A', fabricante: 'Acme', status: 'ativo' },
    { id: 2, nome: 'Produto B', fabricante: ' Acme ', status: 'inativo' },
    { id: 3, nome: 'Produto C', fabricante: 'Beta', status: 'ativo' },
    { id: 4, nome: 'Produto D', fabricante: 'Gama', status: 'ativo' },
    { id: 5, nome: 'Acme no nome apenas', fabricante: 'Acme Extra', status: 'ativo' },
    { id: 6, nome: 'Sem fabricante', fabricante: ' ', status: 'ativo' },
  ] }));
  await fs.writeFile(manifest, JSON.stringify({ produtos: [] }));
  const config = loadConfig({ APP_AUTH_ENABLED: 'false', CATALOG_STORAGE_ROOT: directory, CATALOG_SOURCE: catalog, MANIFEST_SOURCE: manifest });
  const database = await initializeCatalogDatabase(config);
  const errors = [];
  const server = createServer(createApplication({ config, database, logger: { error: (e) => errors.push(e) } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    database.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('stackmedia-partners-'));
    await fs.rm(directory, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  const { fetch } = await testSession(database, origin);
  const call = (url, body, method = body ? 'PUT' : 'GET') => fetch(origin + url, {
    method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const save = (slot, fabricante, extra = { logo }) => call(`/api/featured-partners/${slot}`, { fabricante, ...extra });
  const list = async () => (await (await call('/api/featured-partners')).json()).items;
  return { directory, config, database, origin, call, save, list };
}

test('manufacturers come from products, ignore blank names and link to an exact catalogue filter', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.list(), []);
  const manufacturers = (await (await f.call('/api/manufacturers')).json()).items;
  assert.deepEqual(manufacturers, [{ nome: 'Acme', total: 2 }, { nome: 'Acme Extra', total: 1 }, { nome: 'Beta', total: 1 }, { nome: 'Gama', total: 1 }]);
  const products = await (await f.call('/api/products?fabricante=acme')).json();
  assert.equal(products.pagination.total, 2);
  assert.deepEqual(products.items.map((p) => p.id), [1, 2]);
});

test('three ordered highlights persist; replacement preserves alpha and removes old files; deletion keeps products', async (t) => {
  const f = await fixture(t);
  for (const [slot, name] of [[3, 'Gama'], [1, 'Acme'], [2, 'Beta']]) assert.equal((await f.save(slot, name)).status, 200);
  const items = await f.list();
  assert.deepEqual(items.map((p) => p.slot), [1, 2, 3]);
  assert.equal(items[0].total, 2);
  const reopened = await initializeCatalogDatabase(f.config);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM featured_partners').get().n, 3);
  reopened.close();
  const uploaded = await f.call(items[0].logo_url);
  assert.equal(uploaded.status, 200);
  assert.match(uploaded.headers.get('content-type'), /image\/webp/);
  assert.match(uploaded.headers.get('cache-control'), /immutable/);
  assert.equal((await sharp(Buffer.from(await uploaded.arrayBuffer())).metadata()).hasAlpha, true);
  const preserved = await (await f.save(1, 'Acme', {})).json();
  assert.equal(preserved.logo_url, items[0].logo_url);
  const replaced = await (await f.save(1, 'Acme')).json();
  assert.notEqual(replaced.logo_url, items[0].logo_url);
  assert.equal((await f.call(items[0].logo_url)).status, 404);
  assert.equal((await f.call('/api/featured-partners/1', null, 'DELETE')).status, 204);
  assert.equal((await f.list()).length, 2);
  assert.equal((await f.call(replaced.logo_url)).status, 404);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM products').get().n, 6);
});

test('invalid slots, duplicate and unknown manufacturers cannot bypass the limit or leave uploaded files', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.save(1, 'Acme')).status, 200);
  for (const slot of [0, 4, -1, '01', 'bad']) assert.equal((await f.save(slot, 'Beta')).status, 400);
  assert.equal((await f.save(2, 'acme')).status, 400);
  assert.equal((await f.save(2, 'Missing')).status, 400);
  assert.equal((await f.save(2, "Acme' OR 1=1 --")).status, 400);
  assert.equal((await f.save(2, 'Beta', {})).status, 400);
  assert.equal((await f.save(2, 'Beta', { logo_file: '../data.sqlite' })).status, 400);
  assert.equal((await fs.readdir(path.join(f.directory, 'partner-logos'))).length, 1);
  const results = await Promise.all([f.save(2, 'Beta'), f.save(3, 'Beta')]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  assert.equal((await f.list()).length, 2);
  assert.equal((await fs.readdir(path.join(f.directory, 'partner-logos'))).length, 2);
});

test('upload validation rejects corrupt, oversized and disguised vector content without changing saved data', async (t) => {
  const f = await fixture(t);
  const original = await (await f.save(1, 'Acme')).json();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>').toString('base64');
  for (const invalid of ['data:image/png;base64,aGVsbG8=', `data:image/png;base64,${svg}`, `data:image/svg+xml;base64,${svg}`, '', 123,
    `data:image/png;base64,${Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64')}`]) {
    assert.equal((await f.save(1, 'Acme', { logo: invalid })).status, 400);
  }
  assert.deepEqual(await f.list(), [original]);
  assert.equal((await f.call('/partner-logos/%2e%2e%2fcatalogo.sqlite')).status, 403);
  assert.equal((await fs.readdir(path.join(f.directory, 'partner-logos'))).length, 1);
});
