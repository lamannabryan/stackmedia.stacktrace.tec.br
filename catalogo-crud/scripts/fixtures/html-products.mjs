import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.mjs';
import { initializeCatalogDatabase } from '../../src/database/catalog-database.mjs';
import { createApplication } from '../../src/app.mjs';
import { createUserService } from '../../src/modules/users/user-service.mjs';
import { testSession } from './auth.mjs';

export async function htmlProductFixture(t, { download, products = [] } = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'stackmedia-html-import-'));
  const catalog = path.join(directory, 'products.json'), manifest = path.join(directory, 'manifest.json');
  await fs.writeFile(catalog, JSON.stringify({ produtos: products }));
  await fs.writeFile(manifest, '{"produtos":[]}');
  const config = loadConfig({ NODE_ENV: 'test', CATALOG_STORAGE_ROOT: directory, CATALOG_SOURCE: catalog,
    MANIFEST_SOURCE: manifest, IMAGES_ROOT: path.join(directory, 'images'),
    STORY_BACKGROUNDS_ROOT: path.join(directory, 'stories'), FEED_BACKGROUNDS_ROOT: path.join(directory, 'feed'),
    INDOOR_BACKGROUNDS_ROOT: path.join(directory, 'indoor') });
  const database = await initializeCatalogDatabase(config), errors = [];
  // The default test downloader never contacts the internet.
  const server = createServer(createApplication({ config, database,
    productImageDownload: download || (async () => { throw new Error('No test image'); }),
    logger: { error: error => errors.push(error) } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    database.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('stackmedia-html-import-'));
    await fs.rm(directory, { recursive: true, force: true });
    assert.deepEqual(errors, []);
  });
  const admin = await testSession(database, origin);
  await createUserService({ database }).create({ name: 'Cliente', email: 'client@html.test', password: 'client-password-123', role: 'cliente' });
  const login = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'client@html.test', password: 'client-password-123' }) });
  const client = { ...await login.json(), cookie: login.headers.get('set-cookie').split(';')[0] };
  const call = (route, { session = admin, body, headers, ...options } = {}) => fetch(origin + route, { redirect: 'manual', ...options,
    headers: { ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const post = async (route, body) => {
    const response = await call('/api/products/import-html/' + route, { method: 'POST', body });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  return { directory, config, database, origin, admin, client, call, post, errors };
}
