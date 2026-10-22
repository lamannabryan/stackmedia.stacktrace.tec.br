import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { magazineFixture, magazineWorkbook } from './fixtures/magazines.mjs';
import { initializeCatalogDatabase } from '../src/database/catalog-database.mjs';
import { currentMagazineMonth } from '../src/modules/magazines/magazine-service.mjs';
import { normalizeSpreadsheetNamespaces } from '../src/modules/magazines/xlsx-compat.mjs';
import { Worker } from 'node:worker_threads';

test('product lookup and search expose only active current magazine prices', async t => {
  const f = await magazineFixture(t);
  const readProduct = async () => (await f.call('/api/products/1')).json();
  assert.equal((await readProduct()).revista_preco_centavos, null);
  const saved = await (await f.call('/api/revistas/import', { method: 'POST', body: await f.payload() })).json();
  assert.equal((await readProduct()).revista_preco_centavos, 1990);
  const byEan = await (await f.call('/api/products/by-ean/0123456789012')).json();
  assert.equal(byEan.revista_preco_centavos, 1990);
  const list = await (await f.call('/api/products?q=0123456789012')).json();
  assert.equal(list.items[0].revista_preco_centavos, 1990);
  await f.call(`/api/revistas/${saved.id}`, { method: 'PUT', body: { title: saved.title, active: false, revision: saved.revision } });
  assert.equal((await readProduct()).revista_preco_centavos, null);
  f.database.prepare('UPDATE magazines SET active = 1, month = ? WHERE id = ?').run('2000-01', saved.id);
  assert.equal((await readProduct()).revista_preco_centavos, null);
  f.database.prepare('UPDATE magazines SET month = ? WHERE id = ?').run('2100-01', saved.id);
  assert.equal((await readProduct()).revista_preco_centavos, null);
  f.database.prepare('UPDATE magazines SET month = ? WHERE id = ?').run(f.month, saved.id);
  f.database.prepare("UPDATE products SET status = 'inativo' WHERE id = 1").run();
  assert.equal((await readProduct()).revista_preco_centavos, null);
});

test('partial imports require explicit consent, skip invalid rows and preserve monthly constraints', async t => {
  const f = await magazineFixture(t);
  const body = await f.payload([
    ['0123456789012', 19.9, f.period],
    ['9999999999999', 10, f.period],
    ['7891234567895', -1, f.period],
    ['0123456789012', 20, f.period],
  ]);
  const preview = await (await f.call('/api/revistas/preview', { method: 'POST', body })).json();
  assert.equal(preview.valid, false); assert.equal(preview.canImport, true);
  assert.equal(preview.skippedRows, 3); assert.equal(preview.items.length, 1);
  for (const ignoreErrors of [undefined, false, 'true']) {
    assert.equal((await f.call('/api/revistas/import', { method: 'POST', body: { ...body, ignoreErrors } })).status, 400);
  }
  const response = await f.call('/api/revistas/import', { method: 'POST', body: { ...body, ignoreErrors: true } });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.total, 1); assert.equal(saved.skippedRows, 3);
  assert.equal(saved.items[0].ean, '0123456789012'); assert.equal(saved.items[0].preco_sugerido, 19.9);
  for (const rows of [
    [['9999999999999', 10, f.period]],
    [['0123456789012', 10, '01/2025'], ['7891234567895', 10, '02/2025']],
  ]) {
    const invalid = { ...await f.payload(rows), ignoreErrors: true, expectedRevision: saved.revision };
    const check = await (await f.call('/api/revistas/preview', { method: 'POST', body: invalid })).json();
    assert.equal(check.canImport, false);
    assert.equal((await f.call('/api/revistas/import', { method: 'POST', body: invalid })).status, 400);
  }
  const unchanged = await (await f.call(`/api/revistas/${saved.id}`)).json();
  assert.equal(unchanged.revision, saved.revision); assert.equal(unchanged.total, 1);
});

test('watch-mode dependency messages do not interrupt XLSX preview, import or parsing errors', async t => {
  const f = await magazineFixture(t), body = await f.payload();
  const previous = process.env.WATCH_REPORT_DEPENDENCIES;
  process.env.WATCH_REPORT_DEPENDENCIES = '1';
  try {
    // Confirm this Node runtime really emits the watch messages that triggered
    // the production failure, rather than only simulating a message shape.
    const hasWatchMessages = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../src/modules/magazines/xlsx-worker.mjs', import.meta.url), { workerData: Buffer.from(body.file, 'base64') });
      let observed = false;
      worker.on('message', message => { if (message?.['watch:import'] || message?.['watch:require']) observed = true; });
      worker.once('error', reject); worker.once('exit', () => resolve(observed));
    });
    assert.equal(hasWatchMessages, true);
    const previewResponse = await f.call('/api/revistas/preview', { method: 'POST', body });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json(); assert.equal(preview.valid, true); assert.equal(preview.items.length, 2);
    const imported = await f.call('/api/revistas/import', { method: 'POST', body });
    assert.equal(imported.status, 200); assert.equal((await imported.json()).total, 2);
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip(); zip.file('invalid.txt', 'This is a ZIP but not a workbook.');
    const invalid = { file: await zip.generateAsync({ type: 'base64' }) };
    const error = await f.call('/api/revistas/preview', { method: 'POST', body: invalid });
    assert.equal(error.status, 400); assert.match((await error.json()).error, /XLSX/);
  } finally {
    if (previous === undefined) delete process.env.WATCH_REPORT_DEPENDENCIES;
    else process.env.WATCH_REPORT_DEPENDENCIES = previous;
  }
});

test('template is downloadable by admins, preserves EAN text and round trips with real monthly rows', async t => {
  const f = await magazineFixture(t);
  const response = await f.call('/api/revistas/modelo'); assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /spreadsheetml/);
  assert.match(response.headers.get('content-disposition'), /modelo-revista.xlsx/);
  const original = Buffer.from(await response.arrayBuffer());
  const empty = await f.call('/api/revistas/preview', { method: 'POST', body: { file: original.toString('base64') } });
  assert.equal(empty.status, 200); assert.equal((await empty.json()).valid, false);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await normalizeSpreadsheetNamespaces(original));
  const sheet = workbook.getWorksheet('Revista');
  assert.deepEqual(sheet.getRow(1).values.slice(1, 4), ['EAN', 'PREÇO', 'VIGENCIA']);
  assert.equal(sheet.getCell('A2').numFmt, '@');
  sheet.getCell('A2').value = '0123456789012'; sheet.getCell('B2').value = 29.9;
  sheet.getCell('C2').value = new Date(`${f.month}-01T00:00:00Z`);
  const file = Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
  const preview = await f.call('/api/revistas/preview', { method: 'POST', body: { file } });
  const result = await preview.json(); assert.equal(preview.status, 200); assert.equal(result.valid, true);
  assert.equal(result.items[0].ean, '0123456789012'); assert.equal(result.month, f.month);
  assert.equal(result.items[0].price_cents, 2990);
});

test('monthly import persists, highlights only current active editions and replaces atomically with revision checks', async t => {
  const f = await magazineFixture(t), body = await f.payload();
  const preview = await (await f.call('/api/revistas/preview', { method: 'POST', body })).json();
  assert.equal(preview.valid, true); assert.equal(preview.existing, null);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM magazines').get().n, 0);
  let response = await f.call('/api/revistas/import', { method: 'POST', body }); assert.equal(response.status, 200);
  let magazine = await response.json(); assert.equal(magazine.total, 2); assert.equal(magazine.items[1].price_cents, 123456);
  assert.equal(magazine.status, 'Em destaque');
  const reopened = await initializeCatalogDatabase(f.config);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM magazine_items').get().n, 2); reopened.close();
  let featured = await (await f.call('/api/revistas/destaque', { session: f.client })).json();
  assert.equal(featured.revista.id, magazine.id); assert.equal(featured.revista.items[0].preco_sugerido, 19.9);
  assert.equal((await f.call('/api/revistas/import', { method: 'POST', body })).status, 409);
  const bad = await f.payload([['9999999999999', 12, f.period]]);
  assert.equal((await f.call('/api/revistas/import', { method: 'POST', body: { ...bad, expectedRevision: 1 } })).status, 400);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM magazine_items').get().n, 2);
  const replacement = { ...await f.payload([['7891234567895', 8.45, f.period]]), expectedRevision: 1 };
  const concurrent = await Promise.all([f.call('/api/revistas/import', { method: 'POST', body: replacement }), f.call('/api/revistas/import', { method: 'POST', body: replacement })]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  magazine = await (await f.call(`/api/revistas/${magazine.id}`)).json();
  assert.equal(magazine.total, 1); assert.equal(magazine.revision, 2);
  response = await f.call(`/api/revistas/${magazine.id}`, { method: 'PUT', body: { title: 'Revista pausada', active: false, revision: 2 } });
  assert.equal(response.status, 200); magazine = await response.json(); assert.equal(magazine.status, 'Pausada');
  featured = await (await f.call('/api/revistas/destaque', { session: f.client })).json(); assert.equal(featured.revista, null);
  assert.equal((await f.call(`/api/revistas/${magazine.id}?revision=2`, { method: 'DELETE' })).status, 409);
  assert.equal((await f.call(`/api/revistas/${magazine.id}?revision=3`, { method: 'DELETE' })).status, 204);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM magazine_items').get().n, 0);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM products').get().n, 3);
});

test('invalid and duplicate products, formulas, prices and mixed periods produce line-specific errors without saving', async t => {
  const f = await magazineFixture(t);
  const body = await f.payload([
    ['0123456789012', 0, f.period], ['7891234567895', 1.234, '13/2026'],
    ['7891234567888', 10, f.period], ['9999999999999', 20, f.period],
    ['0123456789012', 20, f.period], [{ formula: '1+1', result: 12345678 }, 20, f.period],
    ['7891234567895', 20, '11/2099'],
  ]);
  const result = await (await f.call('/api/revistas/preview', { method: 'POST', body })).json();
  assert.equal(result.valid, false);
  for (const row of [2, 3, 4, 5, 6, 7, 0]) assert.ok(result.errors.some(error => error.row === row), `Missing error on row ${row}`);
  assert.equal((await f.call('/api/revistas/import', { method: 'POST', body })).status, 400);
  const empty = await f.payload([]); assert.equal((await (await f.call('/api/revistas/preview', { method: 'POST', body: empty })).json()).valid, false);
  const corrupt = { file: Buffer.from('not an xlsx').toString('base64') };
  assert.equal((await f.call('/api/revistas/preview', { method: 'POST', body: corrupt })).status, 400);
  const wrongHeaders = { file: (await magazineWorkbook([], ['Produto', 'Valor', 'Mês'])).toString('base64') };
  assert.equal((await f.call('/api/revistas/preview', { method: 'POST', body: wrongHeaders })).status, 400);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM magazines').get().n, 0);
});

test('administration, aliases, import and template require administrator and mutations require CSRF', async t => {
  const f = await magazineFixture(t), body = await f.payload();
  for (const page of ['/revistas', '/revistas.html', '/REVISTAS.HTML', '/%72evistas.html', '/revistas/']) {
    assert.equal((await f.call(page, { session: f.client })).status, 403, page);
    assert.equal((await f.call(page, { session: null })).status, 302, page);
  }
  assert.equal((await f.call('/revistas')).status, 200);
  for (const route of ['/api/revistas', '/api/revistas/modelo', '/api/revistas/1']) {
    assert.equal((await f.call(route, { session: f.client })).status, 403);
    assert.equal((await f.call(route, { session: null })).status, 401);
  }
  for (const [route, method] of [['/api/revistas/preview', 'POST'], ['/api/revistas/import', 'POST'], ['/api/revistas/1', 'PUT'], ['/api/revistas/1', 'DELETE']]) {
    assert.equal((await f.call(route, { session: f.client, method, body })).status, 403);
    assert.equal((await f.call(route, { method, body, headers: { 'X-CSRF-Token': '' } })).status, 403);
  }
});

test('month boundaries follow São Paulo and future/past editions do not enter the current highlight', async t => {
  assert.equal(currentMagazineMonth(new Date('2026-11-01T02:59:59Z')), '2026-10');
  assert.equal(currentMagazineMonth(new Date('2026-11-01T03:00:00Z')), '2026-11');
  const f = await magazineFixture(t);
  for (const [period, status] of [['01/2000', 'Encerrada'], ['12/2099', 'Agendada']]) {
    const response = await f.call('/api/revistas/import', { method: 'POST', body: await f.payload([['0123456789012', 10, period]]) });
    assert.equal(response.status, 200); assert.equal((await response.json()).status, status);
  }
  assert.equal((await (await f.call('/api/revistas/destaque')).json()).revista, null);
});
