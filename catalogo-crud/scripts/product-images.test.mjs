import { testSession } from './fixtures/auth.mjs';
let fetch = globalThis.fetch;
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApplication } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';
import { initializeCatalogDatabase } from '../src/database/catalog-database.mjs';

const imagePath = (url) => new URL(url, 'http://localhost').pathname;

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH3sAAAAASUVORK5CYII=', 'base64');
const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const names = ['convertido.png', 'pendente.png', 'lote.png', 'Oferta verão #1.PNG',
  'nativo.webp', 'inexistente.png', 'diretorio.png', 'vazio.png', 'original.jpg'];
const servers = [];
let workspace, imagesDirectory, config, database, origin;

async function start(appConfig) {
  const server = createServer(createApplication({ config: appConfig, database }));
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'vidamix-webp-'));
  imagesDirectory = path.join(workspace, 'assets');
  await mkdir(path.join(imagesDirectory, 'imagens'), { recursive: true });
  for (const name of ['convertido.png', 'pendente.png', 'diretorio.png', 'vazio.png', 'original.jpg']) {
    await writeFile(path.join(imagesDirectory, 'imagens', name), png);
  }
  for (const name of ['convertido.webp', 'convertido_resultado.webp', 'lote_resultado.webp', 'Oferta verão #1.webp', 'nativo.webp']) {
    await writeFile(path.join(imagesDirectory, 'imagens', name), webp);
  }
  await mkdir(path.join(imagesDirectory, 'imagens/diretorio.webp'));
  await writeFile(path.join(imagesDirectory, 'imagens/vazio.webp'), '');
  const sourceCatalogPath = path.join(workspace, 'catalog.json');
  const sourceManifestPath = path.join(workspace, 'manifest.json');
  await writeFile(sourceCatalogPath, JSON.stringify({ produtos: names.map((name, index) => ({
    id: index + 1, nome: name, ean: String(7896007548400 + index),
  })) }));
  await writeFile(sourceManifestPath, JSON.stringify({ produtos: names.map((name, index) => ({
    produto_id: index + 1, arquivo: `imagens/${name}`, status: 'baixado',
  })) }));
  config = loadConfig({ APP_AUTH_ENABLED: 'false', CATALOG_STORAGE_ROOT: workspace,
    CATALOG_SOURCE: sourceCatalogPath, MANIFEST_SOURCE: sourceManifestPath, IMAGES_ROOT: imagesDirectory });
  database = await initializeCatalogDatabase(config);
  origin = await start(config);
  fetch = (await testSession(database, origin)).fetch;
});

after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => {
    server.close(resolve); server.closeAllConnections();
  })));
  database?.close();
  // Only this test's freshly created temporary workspace may be removed.
  if (workspace && path.dirname(workspace) === path.resolve(tmpdir()) && path.basename(workspace).startsWith('vidamix-webp-')) {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('list, detail and barcode lookup prefer WebP while preserving database and source references', async () => {
  for (const route of ['/api/products/1', '/api/products/by-ean/7896007548400']) {
    const product = await (await fetch(origin + route)).json();
    assert.equal(imagePath(product.imagem_local_url), '/assets/imagens/convertido.webp');
    assert.equal(product.imagem_arquivo, 'imagens/convertido.png');
  }
  const { items } = await (await fetch(origin + '/api/products?imagem=com')).json();
  assert.equal(items.length, names.length);
  assert.equal(imagePath(items.find((item) => item.id === 1).imagem_local_url), '/assets/imagens/convertido.webp');
  assert.equal(imagePath(items.find((item) => item.id === 2).imagem_local_url), '/assets/imagens/pendente.png');
  assert.equal(database.prepare('SELECT imagem_arquivo FROM products WHERE id = 1').get().imagem_arquivo, 'imagens/convertido.png');
  const manifest = JSON.parse(await readFile(config.sourceManifestPath, 'utf8'));
  assert.equal(manifest.produtos[0].arquivo, 'imagens/convertido.png');
});

test('legacy PNG GET/HEAD redirect to WebP with correct MIME, bytes and length', async () => {
  for (const method of ['GET', 'HEAD']) {
    const alias = await fetch(origin + '/assets/imagens/convertido.png?v=2', { method, redirect: 'manual' });
    assert.equal(alias.status, 302);
    assert.equal(alias.headers.get('location'), '/assets/imagens/convertido.webp?v=2');
    assert.equal(alias.headers.get('cache-control'), 'no-store');
    const image = await fetch(origin + '/assets/imagens/convertido.png', { method });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/webp');
    assert.equal(Number(image.headers.get('content-length')), webp.length);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), method === 'HEAD' ? Buffer.alloc(0) : webp);
  }
});

test('converted images load with PNG removed, including converter suffix and encoded names', async () => {
  for (const [id, filename] of [[3, 'lote_resultado.webp'], [4, 'Oferta verão #1.webp']]) {
    const product = await (await fetch(origin + `/api/products/${id}`)).json();
    assert.equal(imagePath(product.imagem_local_url), '/assets/imagens/' + encodeURIComponent(filename));
    const image = await fetch(origin + '/assets/imagens/' + encodeURIComponent(names[id - 1]));
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/webp');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), webp);
  }
});

test('new conversions become available without restart and removal falls back to PNG', async () => {
  const target = path.join(imagesDirectory, 'imagens/pendente.webp');
  await writeFile(target, webp);
  const converted = await (await fetch(origin + '/api/products/2')).json();
  assert.equal(imagePath(converted.imagem_local_url), '/assets/imagens/pendente.webp');
  await unlink(target);
  const restored = await (await fetch(origin + '/api/products/2')).json();
  assert.equal(imagePath(restored.imagem_local_url), '/assets/imagens/pendente.png');
  const pngResponse = await fetch(origin + restored.imagem_local_url);
  assert.equal(pngResponse.status, 200);
  assert.equal(pngResponse.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await pngResponse.arrayBuffer()), png);
});

test('product edits accept old PNG paths after conversion and new native WebP paths', async () => {
  const updated = await fetch(origin + '/api/products/3', { method: 'PUT',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: 'Nome editado', imagem_arquivo: 'imagens/lote.png' }) });
  assert.equal(updated.status, 200);
  assert.equal(imagePath((await updated.json()).imagem_local_url), '/assets/imagens/lote_resultado.webp');
  for (const filename of ['lote.png', 'nativo.webp']) {
    const response = await fetch(origin + '/api/products', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: 'Novo produto', imagem_arquivo: `imagens/${filename}` }) });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.match(imagePath(created.imagem_local_url), /\.webp$/);
    await fetch(origin + `/api/products/${created.id}`, { method: 'DELETE' });
  }
});

test('empty files and directories are not selected as converted images; missing files still return 404', async () => {
  for (const id of [7, 8, 9]) {
    const product = await (await fetch(origin + `/api/products/${id}`)).json();
    assert.equal(imagePath(product.imagem_local_url), `/assets/imagens/${names[id - 1]}`);
  }
  assert.equal((await fetch(origin + '/assets/imagens/inexistente.png')).status, 404);
  const native = await fetch(origin + '/assets/imagens/nativo.webp');
  assert.equal(native.status, 200);
  assert.equal(native.headers.get('content-type'), 'image/webp');
});

test('image aliases preserve path restrictions and do not expose the manifest', async () => {
  for (const pathname of ['/assets/manifesto-imagens.json', '/assets/imagens/%2e%2e%2fmanifesto-imagens.json',
    '/assets/imagens/..%5cmanifesto-imagens.json', '/assets/imagens/.oculto.png', '/assets/imagens/%00.png',
    '/assets/imagens/%ZZ.png']) {
    assert.equal((await fetch(origin + pathname)).status, 403, pathname);
  }
  const rejected = await fetch(origin + '/api/products/1', { method: 'PUT',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagem_arquivo: 'imagens/../manifesto-imagens.json' }) });
  assert.equal(rejected.status, 400);
});

test('legacy and WebP URLs stay behind authentication and reject writes', async () => {
  const protectedOrigin = await start({ ...config, auth: { enabled: true, username: 'test', password: 'local-only', realm: 'Test' } });
  for (const extension of ['png', 'webp']) {
    assert.equal((await fetch(`${protectedOrigin}/assets/imagens/convertido.${extension}`)).status, 401);
  }
  const protectedFetch = (await testSession(database, protectedOrigin, { authorization: 'Basic ' + Buffer.from('test:local-only').toString('base64') })).fetch;
  const authorized = await protectedFetch(protectedOrigin + '/assets/imagens/convertido.png', {
    headers: { Authorization: 'Basic ' + Buffer.from('test:local-only').toString('base64') },
  });
  assert.equal(authorized.status, 200);
  assert.equal(authorized.headers.get('content-type'), 'image/webp');
  assert.equal((await fetch(origin + '/assets/imagens/convertido.png', { method: 'POST' })).status, 405);
});

test('product image versions remain stable and invalidate when the same filename is replaced', async () => {
  const get = async () => (await fetch(origin + '/api/products/5')).json();
  const first = await get();
  assert.ok(new URL(first.imagem_local_url, origin).searchParams.get('v'));
  assert.equal((await get()).imagem_local_url, first.imagem_local_url);
  const response = await fetch(origin + first.imagem_local_url);
  assert.match(response.headers.get('cache-control'), /private.*immutable/);
  await writeFile(path.join(imagesDirectory, 'imagens/nativo.webp'), Buffer.concat([webp, Buffer.from('changed')]));
  const changed = await get();
  assert.notEqual(changed.imagem_local_url, first.imagem_local_url);
  assert.equal((await fetch(origin + changed.imagem_local_url)).status, 200);
});
