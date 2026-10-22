import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { parseProductHtml, validateHtmlProduct } from '../src/modules/products/import-html.mjs';
import { htmlProductFixture } from './fixtures/html-products.mjs';

const html = await readFile(new URL('./fixtures/products-cosmos.html', import.meta.url), 'utf8');
const parsed = parseProductHtml({ html });
const photo = await sharp({ create: { width: 24, height: 40, channels: 4, background: '#123456' } }).png().toBuffer();
const product = { ean: '0123456789012', nome: 'Produto & teste', imagem_url: 'https://example.com/photo.png' };

test('parses the exact 30-product sample, explicit EANs, accents and generic photos', () => {
  assert.equal(parsed.total, 30);
  assert.ok(parsed.items.every(item => item.error === null));
  assert.deepEqual(parsed.items[0].product, { ean: '60003164', nome: 'ALVEJANTE YPE 1L DATA', fabricante: '', imagem_url: '' });
  assert.equal(parsed.items[2].product.nome, 'ÁGUA SANITÁRIA YPÊ FRASCO 1L');
  assert.equal(parsed.items[2].product.imagem_url, 'https://cdn-cosmos.bluesoft.com.br/products/7896098904671');
  assert.equal(parsed.items.filter(item => item.product.imagem_url).length, 11);
  assert.equal(parsed.items.at(-1).product.imagem_url, '');
  assert.ok(parsed.items.every(item => item.product.fabricante === ''));
});

test('HTML is data only; entities, leading zeros and explicit manufacturer survive; invalid rows are reported', () => {
  const input = html.replace('>60003164</a>', '>00003164</a>')
    .replace(/ALVEJANTE YPE 1L DATA\r?\n/, '&lt;img src=x onerror=alert(1)&gt; &amp; ÁGUA<script>bad()</script>\n')
    .replace('NCM:', 'Fabricante:')
    .replace('>17896098903077</a>', '>invalid</a>');
  const output = parseProductHtml({ html: input });
  assert.equal(output.items[0].product.ean, '00003164');
  assert.equal(output.items[0].product.nome, '<img src=x onerror=alert(1)> & ÁGUA');
  assert.equal(output.items[0].product.fabricante, '2828.90.11');
  assert.match(output.items[1].error, /EAN inválido/);
  assert.equal(output.items[2].error, null);
  assert.throws(() => parseProductHtml({ html: '<div>foo</div>' }), /Nenhum produto/);
  assert.throws(() => parseProductHtml({ html: 'a'.repeat(1024 * 1024 + 1) }), /até 1 MB/);
  const row = '<li class="product-list-item"></li>';
  assert.throws(() => parseProductHtml({ html: `<ul id="tbl-produtos">${row.repeat(501)}</ul>` }), /500 produtos/);
  assert.throws(() => validateHtmlProduct({ ...product, nome: ' ' }), /Nome ausente/);
  assert.throws(() => validateHtmlProduct({ ...product, imagem_url: 'http://example.com/x' }), /HTTPS/);
  assert.throws(() => validateHtmlProduct({ ...product, imagem_url: 'https://user:pass@example.com/x' }), /HTTPS/);
});

test('new page, aliases and APIs require an administrator and mutations require CSRF', async t => {
  const f = await htmlProductFixture(t);
  for (const route of ['/import-produtos', '/import-produtos/', '/import-produtos.html', '/IMPORT-PRODUTOS.HTML', '/%69mport-produtos.html']) {
    assert.equal((await f.call(route, { session: null })).status, 302);
    assert.equal((await f.call(route, { session: f.client })).status, 403);
  }
  const page = await f.call('/import-produtos'); assert.equal(page.status, 200);
  assert.equal(((await page.text()).match(/<textarea\b/g) || []).length, 1);
  for (const route of ['parse', 'item']) {
    const options = { method: 'POST', body: route === 'parse' ? { html } : product };
    assert.equal((await f.call('/api/products/import-html/' + route, { ...options, session: null })).status, 401);
    assert.equal((await f.call('/api/products/import-html/' + route, { ...options, session: f.client })).status, 403);
    assert.equal((await f.call('/api/products/import-html/' + route, { ...options, headers: { 'X-CSRF-Token': '' } })).status, 403);
  }
  const oversized = await f.call('/api/products/import-html/parse', { method: 'POST', body: { html: 'a'.repeat(2 * 1024 * 1024) } });
  assert.equal(oversized.status, 400);
  assert.match((await oversized.json()).error, /excede/);
});

test('sample imports real local WebP images, skips placeholders and repeated imports preserve every product', async t => {
  const downloads = [];
  const f = await htmlProductFixture(t, { download: async url => { downloads.push(url); return photo; } });
  const { items } = await f.post('parse', { html });
  assert.equal(f.database.prepare('SELECT count(*) AS n FROM products').get().n, 0);
  for (const item of items) assert.equal((await f.post('item', item.product)).status, 'imported');
  assert.equal(downloads.length, 11);
  assert.ok(downloads.every(url => url.startsWith('https://cdn-cosmos.bluesoft.com.br/products/')));
  const products = f.database.prepare('SELECT * FROM products ORDER BY id').all();
  assert.equal(products.length, 30);
  assert.equal(products[0].ean, '60003164'); assert.equal(products[0].imagem_arquivo, null);
  assert.equal(products[2].fabricante, null); assert.equal(products[2].categoria_nome, null);
  assert.ok(products.every(row => row.status === 'ativo'));
  const localImage = await readFile(path.join(f.config.imagesDirectory, products[2].imagem_arquivo));
  assert.equal((await sharp(localImage).metadata()).format, 'webp');
  const item = await (await f.call(`/api/products/${products[2].id}`)).json();
  const imageResponse = await f.call(item.imagem_local_url);
  assert.equal(imageResponse.status, 200);
  for (const row of items) assert.equal((await f.post('item', row.product)).status, 'ignored');
  assert.deepEqual(f.database.prepare('SELECT * FROM products ORDER BY id').all(), products);
  assert.equal(downloads.length, 11);
  assert.equal((await readdir(path.join(f.config.imagesDirectory, 'imagens'))).length, 11);
});

test('HTML imports remove white backgrounds before saving WebP images and preserve enclosed white labels', async t => {
  let source;
  const f = await htmlProductFixture(t, { download: async () => source });
  let index = 0;
  for (const background of ['#ffffff', '#fafafa']) {
    for (const format of ['png', 'jpeg', 'webp']) {
      source = await sharp(Buffer.from(`<svg width="80" height="100" xmlns="http://www.w3.org/2000/svg">
        <rect width="80" height="100" fill="${background}"/>
        <rect x="25" y="15" width="30" height="70" fill="#18366f"/>
        <rect x="30" y="35" width="20" height="30" fill="white"/>
      </svg>`))[format]().toBuffer();
      const result = await f.post('item', { ...product, ean: String(12345670 + index++) });
      assert.equal(result.status, 'imported');
      assert.equal(result.image, true);
      const saved = f.database.prepare('SELECT imagem_arquivo FROM products WHERE id = ?').get(result.id);
      const buffer = await readFile(path.join(f.config.imagesDirectory, saved.imagem_arquivo));
      assert.equal((await sharp(buffer).metadata()).format, 'webp');
      const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
      assert.equal(alphaAt(0, 0), 0);
      assert.equal(alphaAt(79, 99), 0);
      assert.equal(alphaAt(28, 50), 255, 'colored product remains opaque');
      assert.equal(alphaAt(40, 50), 255, 'enclosed white label remains opaque');
      assert.ok(data[(50 * info.width + 40) * 4] > 235, 'label stays white');
    }
  }
});

test('HTML imports preserve existing transparency and colored backgrounds', async t => {
  let source;
  const f = await htmlProductFixture(t, { download: async () => source });
  const cutout = await sharp(Buffer.from(`<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">
    <rect x="5" y="5" width="30" height="30" fill="white"/>
  </svg>`)).png().toBuffer();
  for (const [index, input] of [cutout, photo].entries()) {
    source = input;
    const result = await f.post('item', { ...product, ean: String(12345670 + index) });
    assert.equal(result.status, 'imported');
    const saved = f.database.prepare('SELECT imagem_arquivo FROM products WHERE id = ?').get(result.id);
    const { data, info } = await sharp(await readFile(path.join(f.config.imagesDirectory, saved.imagem_arquivo)))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const original = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, original.info.width);
    assert.equal(info.height, original.info.height);
    for (let offset = 3; offset < data.length; offset += 4) assert.equal(data[offset], original.data[offset]);
  }
});

test('download, image and cutout failures leave no product or image; the same EAN can be retried successfully', async t => {
  let mode = 'network';
  const blank = await sharp({ create: { width: 30, height: 30, channels: 3, background: 'white' } }).png().toBuffer();
  const f = await htmlProductFixture(t, { download: async () => {
    if (mode === 'network') throw new Error('Unavailable');
    if (mode === 'blank') return blank;
    return mode === 'invalid' ? Buffer.from('<html>Blocked</html>') : photo;
  } });
  for (const kind of ['network', 'invalid', 'blank']) {
    mode = kind;
    const result = await f.post('item', product);
    assert.equal(result.status, 'error');
    assert.equal(result.image, false);
    if (kind === 'blank') assert.match(result.message, /separar o produto do fundo branco/);
    assert.equal(f.database.prepare('SELECT count(*) AS n FROM products').get().n, 0);
    const files = await readdir(path.join(f.config.imagesDirectory, 'imagens')).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    assert.deepEqual(files, []);
  }
  mode = 'ok';
  assert.equal((await f.post('item', product)).status, 'imported');
  assert.equal(f.database.prepare('SELECT ean FROM products').get().ean, product.ean);
});

test('concurrent imports of the same EAN only save one product and leave one image file', async t => {
  let release, arrivals = 0, ready;
  const bothStarted = new Promise(resolve => { ready = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await htmlProductFixture(t, { download: async () => { if (++arrivals === 2) ready(); await gate; return photo; } });
  const pending = [f.post('item', product), f.post('item', product)];
  await bothStarted; release();
  const results = await Promise.all(pending);
  assert.deepEqual(results.map(item => item.status).sort(), ['ignored', 'imported']);
  assert.equal(f.database.prepare('SELECT count(*) AS n FROM products').get().n, 1);
  assert.equal((await readdir(path.join(f.config.imagesDirectory, 'imagens'))).length, 1);
});

test('existing inactive EANs are untouched and incoming HTML cannot set other catalogue fields', async t => {
  const f = await htmlProductFixture(t, { products: [{ id: 1, nome: 'Original', ean: product.ean, status: 'inativo', fabricante: 'Original' }] });
  assert.equal((await f.post('item', product)).status, 'ignored');
  assert.equal(f.database.prepare('SELECT nome FROM products WHERE id = 1').get().nome, 'Original');
  const result = await f.post('item', { ...product, ean: '00003164', imagem_url: '', fabricante: 'Marca informada',
    imagem_arquivo: '../../outside.png', status: 'pendente', id: 1 });
  assert.equal(result.status, 'imported');
  const saved = f.database.prepare('SELECT * FROM products WHERE id = ?').get(result.id);
  assert.equal(saved.imagem_arquivo, null); assert.equal(saved.status, 'ativo'); assert.equal(saved.fabricante, 'Marca informada');
});
