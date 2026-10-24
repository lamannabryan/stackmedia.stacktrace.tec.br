import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApplication } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';
import { serveFile } from '../src/http/static-files.mjs';
import { testSession } from './fixtures/auth.mjs';

let server, database, origin, cookie, directory;
const errors = [];
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'stackmedia-static-'));
  database = new DatabaseSync(':memory:');
  const app = createApplication({ config: loadConfig({ APP_AUTH_ENABLED: 'false' }), database,
    logger: { error: error => errors.push(error) } });
  server = createServer((req, res) => {
    if (req.url === '/fixture.css') {
      serveFile({ request: req, response: res, rootDirectory: directory,
        urlPath: 'fixture.css', cacheControl: 'private, no-cache' }).catch(error => res.destroy(error));
    } else app(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  ({ cookie } = await testSession(database, origin));
});
after(async () => {
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  database.close();
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('stackmedia-static-'));
  await rm(directory, { recursive: true, force: true });
  assert.deepEqual(errors, []);
});

function read(url, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request(origin + url, { method, headers: { Cookie: cookie, ...headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('styles and modules return 304 across screens; documents, sessions and worker stay uncached', async () => {
  for (const url of ['/home.css', '/js/session.js', '/js/features/stories/editor.js', '/page-loading.css']) {
    const initial = await read(url);
    assert.equal(initial.status, 200);
    assert.equal(initial.headers['cache-control'], 'private, no-cache');
    const reused = await read(url, { 'If-None-Match': initial.headers.etag });
    assert.equal(reused.status, 304, url);
    assert.equal(reused.body.length, 0);
  }
  for (const url of ['/', '/catalogo', '/login', '/api/auth/me', '/sw.js']) {
    const response = await read(url);
    assert.equal(response.status, 200, url);
    assert.equal(response.headers['cache-control'], 'no-store', url);
    assert.equal((await read(url, { 'If-None-Match': response.headers.etag || '*' })).status, 200);
  }
  assert.equal((await read('/', { Cookie: '' })).status, 302);
  assert.equal((await read('/api/auth/me', { Cookie: '' })).status, 401);
});

test('gzip reduces first-download bytes and preserves the exact HTML, CSS and JavaScript', async t => {
  let originalBytes = 0, compressedBytes = 0;
  for (const url of ['/', '/home.css', '/brand.css', '/home.js', '/js/features/stories/editor.js']) {
    const original = await read(url, { 'Accept-Encoding': 'identity' });
    const compressed = await read(url, { 'Accept-Encoding': 'gzip' });
    assert.equal(compressed.headers['content-encoding'], 'gzip', url);
    assert.equal(compressed.headers.vary, 'Accept-Encoding');
    assert.equal(original.headers.vary, 'Accept-Encoding');
    assert.deepEqual(gunzipSync(compressed.body), original.body);
    assert.equal(compressed.headers.etag, original.headers.etag);
    assert.ok(compressed.body.length < original.body.length * 0.7, url);
    originalBytes += original.body.length;
    compressedBytes += compressed.body.length;
  }
  t.diagnostic(`Representative first downloads: ${originalBytes} -> ${compressedBytes} bytes (${Math.round(100 * (1 - compressedBytes / originalBytes))}% reduction).`);
  const head = await read('/home.css', { 'Accept-Encoding': 'gzip' }, 'HEAD');
  assert.equal(head.headers['content-encoding'], 'gzip');
  assert.equal(head.body.length, 0);
});

test('compression negotiation respects gzip refusal, and never recompresses images or fonts', async () => {
  for (const encoding of ['identity', 'gzip;q=0', '*;q=1, gzip;q=0', 'br', 'gzip;q=invalid']) {
    assert.equal((await read('/home.css', { 'Accept-Encoding': encoding })).headers['content-encoding'], undefined, encoding);
  }
  for (const encoding of ['br, gzip;q=0.5', '*;q=0.5', 'GZip']) {
    assert.equal((await read('/home.css', { 'Accept-Encoding': encoding })).headers['content-encoding'], 'gzip', encoding);
  }
  for (const url of ['/pwa-icons/icon-192.png', '/fonts/space-grotesk-latin-400-normal.woff2']) {
    const response = await read(url, { 'Accept-Encoding': 'gzip' });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-encoding'], undefined);
    assert.equal(Number(response.headers['content-length']), response.body.length);
  }
});

test('a changed file invalidates its validator and supplies fresh compressed content', async () => {
  await writeFile(path.join(directory, 'fixture.css'), 'body { color: red; }\n'.repeat(100));
  const first = await read('/fixture.css', { 'Accept-Encoding': 'gzip' });
  assert.equal((await read('/fixture.css', { 'If-None-Match': first.headers.etag, 'Accept-Encoding': 'gzip' })).status, 304);
  const changed = 'body { color: orange; }\n'.repeat(100);
  await writeFile(path.join(directory, 'fixture.css'), changed);
  const updated = await read('/fixture.css', { 'If-None-Match': first.headers.etag, 'Accept-Encoding': 'gzip' });
  assert.equal(updated.status, 200);
  assert.notEqual(updated.headers.etag, first.headers.etag);
  assert.equal(gunzipSync(updated.body).toString(), changed);
});
