import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { loadConfig } from '../src/config.mjs';
import { initializeCatalogDatabase } from '../src/database/catalog-database.mjs';
import { createProductService } from '../src/modules/products/product-service.mjs';
import { createProductImageUpload } from '../src/modules/products/product-image-upload.mjs';
import { createGoogleImageSearch } from '../src/modules/products/google-image-search.mjs';
import { removeWhiteBackground } from '../src/modules/products/white-background.mjs';

async function productOnWhite({ background = '#ffffff', format = 'png' } = {}) {
  const source = Buffer.from(`<svg width="80" height="100" xmlns="http://www.w3.org/2000/svg">
    <rect width="80" height="100" fill="${background}"/>
    <rect x="25" y="15" width="30" height="70" fill="#18366f"/>
    <rect x="30" y="35" width="20" height="30" fill="#ffffff"/>
  </svg>`);
  return sharp(source)[format]().toBuffer();
}

const alphaAt = (data, width, x, y) => data[(y * width + x) * 4 + 3];

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'stackmedia-image-upload-'));
  await writeFile(path.join(directory, 'products.json'), '{"produtos":[{"id":1,"nome":"Existing"}]}');
  await writeFile(path.join(directory, 'manifest.json'), '{"produtos":[]}');
  const config = loadConfig({ CATALOG_STORAGE_ROOT: directory, IMAGES_ROOT: directory,
    CATALOG_SOURCE: path.join(directory, 'products.json'), MANIFEST_SOURCE: path.join(directory, 'manifest.json') });
  const database = await initializeCatalogDatabase(config);
  const productService = createProductService({ database, imagesDirectory: directory });
  const image = await sharp({ create: { width: 30, height: 50, channels: 4, background: '#ff000080' } }).png().toBuffer();
  const service = createProductImageUpload({ imagesDirectory: directory });
  t.after(async () => {
    database.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('stackmedia-image-upload-'));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, database, service, productService, image, data: `data:image/png;base64,${image.toString('base64')}` };
}

test('a selected Google result is downloaded locally on save and remains pending until admin approval', async t => {
  const f = await fixture(t);
  const imageSearch = createGoogleImageSearch({ apiKey: 'test', download: async () => f.image,
    fetchImpl: async () => ({ ok: true, json: async () => ({ images_results: [{ original: 'https://example.com/image.png' }] }) }) });
  const service = createProductImageUpload({ imagesDirectory: f.directory, imageSearch });
  const [choice] = await imageSearch.search('3017620422003', 7);
  const payload = { nome: 'Google product', ean: '3017620422003', status: 'ativo', imagem_busca_token: choice.token };
  const save = data => f.productService.createProduct(data, { role: 'cliente' });
  await assert.rejects(service.saveWithImage(payload, save, 8), /inválida/);
  await assert.rejects(service.saveWithImage({ ...payload, imagem_upload: f.data }, save, 7), /apenas uma/);
  const product = await service.saveWithImage(payload, save, 7);
  assert.equal(product.status, 'pendente');
  assert.equal((await sharp(await readFile(path.join(f.directory, product.imagem_arquivo))).metadata()).format, 'webp');
  assert.equal(f.productService.getProduct(product.id, { role: 'cliente' }), null);
  f.productService.updateProduct(product.id, { status: 'ativo' });
  assert.ok(f.productService.getProduct(product.id, { role: 'cliente' }));
});

test('saving an uploaded image persists a transparent WebP and keeps client products pending', async t => {
  const f = await fixture(t);
  const product = await f.service.saveWithImage({ nome: 'New', ean: '3017620422003', status: 'ativo', imagem_upload: f.data },
    payload => f.productService.createProduct(payload, { role: 'cliente' }));
  assert.equal(product.status, 'pendente');
  assert.equal(product.imagem_creditos, null);
  assert.equal(product.imagem_status, 'manual');
  const metadata = await sharp(await readFile(path.join(f.directory, product.imagem_arquivo))).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.hasAlpha, true);
  assert.equal(f.productService.getProduct(product.id, { role: 'cliente' }), null);
  f.productService.updateProduct(product.id, { status: 'ativo' });
  assert.equal(f.productService.getProduct(product.id, { role: 'cliente' }).imagem_arquivo, product.imagem_arquivo);
});

test('failed product validation removes the new image; replacement keeps the old file intact', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.saveWithImage({ imagem_upload: f.data }, payload => f.productService.createProduct(payload)), /nome/);
  assert.deepEqual(await readdir(path.join(f.directory, 'imagens')), []);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM products').get().n, 1);
  const first = await f.service.saveWithImage({ nome: 'One', imagem_upload: f.data }, payload => f.productService.createProduct(payload));
  const second = await f.service.saveWithImage({ imagem_upload: f.data }, payload => f.productService.updateProduct(first.id, payload));
  assert.notEqual(first.imagem_arquivo, second.imagem_arquivo);
  assert.equal((await readdir(path.join(f.directory, 'imagens'))).length, 2);
});

test('rejects corrupt images, unsupported formats, URL-only inputs and old search tokens', async t => {
  const f = await fixture(t);
  let saved = false;
  for (const value of ['https://example.test/image.jpg', 'data:image/png;base64,YmFk', 'data:image/svg+xml;base64,PHN2Zy8+']) {
    await assert.rejects(f.service.saveWithImage({ imagem_upload: value }, () => { saved = true; }));
  }
  await assert.rejects(f.service.saveWithImage({ imagem_busca_token: 'old' }, () => { saved = true; }), /Atualize/);
  assert.equal(saved, false);
  assert.equal((await readdir(f.directory)).includes('imagens'), false);
});

test('selected SerpAPI images lose white and near-white backgrounds before saving, preserving white labels', async t => {
  const f = await fixture(t);
  for (const format of ['png', 'jpeg', 'webp']) {
    const source = await productOnWhite({ background: '#fafafa', format });
    const imageSearch = createGoogleImageSearch({ apiKey: 'test', download: async () => source,
      fetchImpl: async () => ({ ok: true, json: async () => ({ images_results: [{ original: `https://example.com/product.${format}` }] }) }) });
    const service = createProductImageUpload({ imagesDirectory: f.directory, imageSearch });
    const [choice] = await imageSearch.search('3017620422003', 7);
    const product = await service.saveWithImage({ nome: `Product ${format}`, ean: '3017620422003', imagem_busca_token: choice.token },
      data => f.productService.createProduct(data), 7);
    const saved = await readFile(path.join(f.directory, product.imagem_arquivo));
    const { data, info } = await sharp(saved).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal((await sharp(saved).metadata()).hasAlpha, true);
    assert.equal(alphaAt(data, info.width, 0, 0), 0);
    assert.equal(alphaAt(data, info.width, 79, 99), 0);
    assert.equal(alphaAt(data, info.width, 28, 50), 255, 'colored product remains opaque');
    assert.equal(alphaAt(data, info.width, 40, 50), 255, 'enclosed white label remains opaque');
    assert.ok(data[(50 * info.width + 40) * 4] > 235, 'label stays white');
    assert.equal(product.imagem_status, 'manual');
    assert.ok(new URL(product.imagem_local_url, 'https://example.test').pathname.endsWith('.webp'));
  }
});

test('background selection reaches every edge while keeping colored backgrounds and transparent cutouts intact', async () => {
  const source = Buffer.from(`<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" fill="white"/><rect x="15" width="10" height="40" fill="#186688"/>
  </svg>`);
  const raw = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const removed = await removeWhiteBackground(raw.data, raw.info);
  assert.equal(alphaAt(removed, 40, 2, 20), 0);
  assert.equal(alphaAt(removed, 40, 38, 20), 0);
  assert.equal(alphaAt(removed, 40, 20, 0), 255);
  assert.equal(alphaAt(removed, 40, 20, 39), 255);
  for (const background of ['#dddddd', '#ffebc8', '#e21a59', '#ffffff80']) {
    const image = await sharp({ create: { width: 20, height: 20, channels: 4, background } }).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual(await removeWhiteBackground(image.data, image.info), image.data);
  }
  const whiteCutout = await sharp(Buffer.from(`<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="30" height="30" fill="white"/></svg>`))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(await removeWhiteBackground(whiteCutout.data, whiteCutout.info), whiteCutout.data);
});

test('manual uploads retain their background and an empty automatic cutout never creates a file or changes the product', async t => {
  const f = await fixture(t);
  const source = await productOnWhite();
  const product = await f.service.saveWithImage({ nome: 'Manual', imagem_upload: `data:image/png;base64,${source.toString('base64')}` },
    data => f.productService.createProduct(data));
  const saved = await sharp(await readFile(path.join(f.directory, product.imagem_arquivo))).ensureAlpha().raw().toBuffer();
  assert.equal(alphaAt(saved, 80, 0, 0), 255);
  const before = f.productService.getProduct(product.id);
  const files = await readdir(path.join(f.directory, 'imagens'));
  const blank = await sharp({ create: { width: 30, height: 30, channels: 3, background: 'white' } }).png().toBuffer();
  const service = createProductImageUpload({ imagesDirectory: f.directory, imageSearch: { resolveSelection: async () => blank } });
  await assert.rejects(service.saveWithImage({ nome: 'Should not change', imagem_busca_token: 'selected' },
    data => f.productService.updateProduct(product.id, data)), /separar o produto/);
  assert.deepEqual(f.productService.getProduct(product.id), before);
  assert.deepEqual(await readdir(path.join(f.directory, 'imagens')), files);
});

test('a white product with a faint gray outline keeps its white body', async () => {
  const source = Buffer.from(`<svg width="100" height="150" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="150" fill="white"/>
    <rect x="20" y="10" width="60" height="130" rx="28" fill="white" stroke="#f3f3f3" stroke-width="2"/>
    <rect x="30" y="75" width="40" height="40" fill="#18366f"/>
  </svg>`);
  const raw = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = await removeWhiteBackground(raw.data, raw.info);
  assert.equal(alphaAt(result, 100, 0, 0), 0);
  assert.equal(alphaAt(result, 100, 99, 149), 0);
  assert.equal(alphaAt(result, 100, 50, 40), 255, 'white body above the label remains opaque');
  assert.equal(alphaAt(result, 100, 50, 90), 255, 'colored label remains opaque');
  assert.equal(alphaAt(result, 100, 50, 125), 255, 'white body below the label remains opaque');
});

test('white-background worker ignores watch notifications and rejects images outside its pixel bounds', async () => {
  assert.throws(() => removeWhiteBackground(Buffer.alloc(4), { width: 2001, height: 1 }), /preparar/);
  const raw = await sharp(await productOnWhite()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const previous = process.env.WATCH_REPORT_DEPENDENCIES;
  process.env.WATCH_REPORT_DEPENDENCIES = '1';
  try {
    const result = await removeWhiteBackground(raw.data, raw.info);
    assert.equal(alphaAt(result, raw.info.width, 0, 0), 0);
  } finally {
    if (previous === undefined) delete process.env.WATCH_REPORT_DEPENDENCIES;
    else process.env.WATCH_REPORT_DEPENDENCIES = previous;
  }
});
