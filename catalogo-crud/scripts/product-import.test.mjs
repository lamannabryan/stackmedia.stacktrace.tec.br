import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { magazineFixture } from './fixtures/magazines.mjs';
import { readProductUpload } from '../src/modules/products/import-xlsx.mjs';
import { createProductImportService } from '../src/modules/products/product-import-service.mjs';
import { createProductService } from '../src/modules/products/product-service.mjs';

async function workbookPayload(rows, customize = () => {}, positions = [1, 14, 26]) {
  const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('Produtos');
  ['code', 'product_name_pt', 'brands'].forEach((value, field) => { sheet.getRow(1).getCell(positions[field]).value = value; });
  rows.forEach((values, index) => positions.forEach((column, field) => { sheet.getRow(index + 2).getCell(column).value = values[field] ?? null; }));
  customize(sheet, workbook);
  return { file: Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64') };
}

test('preview and import map A/N/Z, preserve EANs and existing products, and safely skip invalid rows', async t => {
  const f = await magazineFixture(t);
  const before = f.database.prepare('SELECT * FROM products ORDER BY id').all();
  const body = await workbookPayload([
    ['0001234567890', ' Café com açúcar ', ' Marca A '],
    [7890000000012, 'Produto numérico', 'Marca B'],
    ['0001234567890', 'Duplicado', 'Outra marca'],
    ['7891234567888', 'Não alterar o inativo', 'Outra marca'],
    ['7890000000013', '', 'Nome ausente'],
    ['7.890000000014E+12', 'Código como texto científico', 'Marca'],
    [{ formula: '7890000000015', result: 7890000000015 }, 'Código fórmula', 'Marca'],
    ['7890000000016', { formula: '"Nome"', result: 'Nome' }, 'Marca'],
    [12345670, 'Com máscara de zeros', 'Marca'],
    ['12345678', { richText: [{ text: 'Nome ' }, { text: 'formatado' }] }, ''],
    ['7890000000013', 'Nome corrigido em outra linha', 'Marca'],
  ], (sheet, workbook) => {
    sheet.getCell('A3').numFmt = '0.00E+00';
    sheet.getCell('A10').numFmt = '0000000000000';
    sheet.getCell('F2').value = 'Do not use the English name';
    sheet.getCell('AD2').value = 'Do not use the brand owner';
    workbook.addWorksheet('Outra aba').addRow(['ignored']);
  });
  const response = await f.call('/api/products/import/preview', { method: 'POST', body });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.deepEqual(preview.summary, { total: 11, newProducts: 5, existing: 1, duplicates: 1, invalid: 4 });
  assert.equal(preview.sheet, 'Produtos');
  assert.deepEqual(preview.columns, { ean: 'A', nome: 'N', fabricante: 'Z' });
  assert.deepEqual(preview.items[0], { row: 2, ean: '0001234567890', nome: 'Café com açúcar', fabricante: 'Marca A' });
  assert.equal(preview.items[1].ean, '7890000000012');
  assert.equal(preview.items[2].ean, '0000012345670');
  assert.equal(preview.items[3].nome, 'Nome formatado');
  assert.deepEqual(f.database.prepare('SELECT * FROM products ORDER BY id').all(), before);
  const savedResponse = await f.call('/api/products/import', { method: 'POST', body });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.imported, 5);
  assert.deepEqual(saved.summary, preview.summary);
  assert.deepEqual(f.database.prepare('SELECT * FROM products WHERE id <= 3 ORDER BY id').all(), before);
  const added = f.database.prepare('SELECT * FROM products WHERE ean = ?').get('0001234567890');
  assert.equal(added.nome, 'Café com açúcar'); assert.equal(added.fabricante, 'Marca A');
  assert.equal(added.status, 'ativo'); assert.equal(added.imagem_status, 'sem_imagem');
  assert.equal(added.imagem_arquivo, null); assert.ok(added.created_at);
  const repeat = await (await f.call('/api/products/import', { method: 'POST', body })).json();
  assert.equal(repeat.imported, 0);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM products').get().n, 8);
  const found = await (await f.call('/api/products?imagem=sem&q=0001234567890')).json();
  assert.equal(found.items.length, 1);
});

test('invalid layouts, malformed uploads, excessive rows, formulas and empty sheets cannot write data', async t => {
  const f = await magazineFixture(t);
  const validRow = ['7890000000012', 'Produto', 'Marca'];
  for (const [column, header] of [['A1', 'code'], ['N1', 'product_name_pt'], ['Z1', 'brands']]) {
    const body = await workbookPayload([validRow], sheet => { sheet.getCell(column).value = 'wrong_header'; });
    const response = await f.call('/api/products/import', { method: 'POST', body });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, new RegExp(`"${header}" não foi encontrado`));
  }
  const zip = new JSZip(); zip.file('other.txt', 'Not a workbook');
  for (const body of [{}, { file: 'invalid!' }, { file: Buffer.from('not a zip').toString('base64') },
    { file: await zip.generateAsync({ type: 'base64' }) }, await workbookPayload([]),
    await workbookPayload([validRow], sheet => { sheet.getCell('A10002').value = '12345678'; })]) {
    assert.equal((await f.call('/api/products/import', { method: 'POST', body })).status, 400);
  }
  const invalid = await workbookPayload([[123.5, 'Decimal', 'Marca'], ['12345678', 'x'.repeat(256), 'Marca'], ['12345679', 'Nome', true]]);
  const result = await (await f.call('/api/products/import', { method: 'POST', body: invalid })).json();
  assert.equal(result.imported, 0); assert.equal(result.summary.invalid, 3);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM products').get().n, 3);
});

test('the second layout maps A/F/L, reports its columns and deduplicates against the first layout', async t => {
  const f = await magazineFixture(t);
  const first = await workbookPayload([['7892840823580', 'Nome original', 'Fabricante original']]);
  const savedFirst = await (await f.call('/api/products/import', { method: 'POST', body: first })).json();
  assert.equal(savedFirst.imported, 1);
  const body = await workbookPayload([
    ['7892840823580', 'Nome diferente', 'Outra marca'],
    ['0012345678905', 'TORCIDA CHURRASCO 210G PEPSICO', 'pepsico'],
    ['7892840823559', '', 'pepsico'],
    ['invalid', 'Código inválido', 'pepsico'],
    ['7892840822699', 'Marca inválida', true],
  ], sheet => {
    sheet.getCell('N1').value = 'categories'; sheet.getCell('N2').value = 'Do not use this category';
    sheet.getCell('Z1').value = 'manufacturing_places'; sheet.getCell('Z2').value = 'Do not use this place';
    sheet.getCell('D1').value = 'product_name_en'; sheet.getCell('D4').value = 'Do not replace missing Portuguese name';
  }, [1, 6, 12]);
  const response = await f.call('/api/products/import/preview', { method: 'POST', body });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.deepEqual(preview.columns, { ean: 'A', nome: 'F', fabricante: 'L' });
  assert.deepEqual(preview.summary, { total: 5, newProducts: 1, existing: 1, duplicates: 0, invalid: 3 });
  assert.deepEqual(preview.items[0], { row: 3, ean: '0012345678905', nome: 'TORCIDA CHURRASCO 210G PEPSICO', fabricante: 'pepsico' });
  assert.match(preview.issues.find(issue => issue.row === 4).message, /coluna F \(product_name_pt\)/);
  assert.match(preview.issues.find(issue => issue.row === 5).message, /coluna A \(code\)/);
  assert.match(preview.issues.find(issue => issue.row === 6).message, /coluna L \(brands\)/);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM products').get().n, 4);
  const saved = await (await f.call('/api/products/import', { method: 'POST', body })).json();
  assert.equal(saved.imported, 1);
  assert.deepEqual(saved.columns, preview.columns);
  const product = f.database.prepare('SELECT nome, fabricante, status FROM products WHERE ean = ?').get('0012345678905');
  assert.equal(product.nome, 'TORCIDA CHURRASCO 210G PEPSICO');
  assert.equal(product.fabricante, 'pepsico'); assert.equal(product.status, 'ativo');
  assert.equal(f.database.prepare('SELECT nome FROM products WHERE ean = ?').get('7892840823580').nome, 'Nome original');
  assert.equal((await (await f.call('/api/products/import', { method: 'POST', body })).json()).imported, 0);
});

test('header matching tolerates whitespace and case, supports reordered columns, and rejects ambiguous duplicates', async t => {
  const f = await magazineFixture(t);
  const body = await workbookPayload([['0001234567890', 'Produto reordenado', 'Marca']], sheet => {
    sheet.getCell('AD1').value = '\uFEFF CODE ';
    sheet.getCell('B1').value = ' PRODUCT_NAME_PT ';
    sheet.getCell('G1').value = ' Brands ';
  }, [30, 2, 7]);
  const preview = await (await f.call('/api/products/import/preview', { method: 'POST', body })).json();
  assert.deepEqual(preview.columns, { ean: 'AD', nome: 'B', fabricante: 'G' });
  assert.equal(preview.items[0].nome, 'Produto reordenado');
  assert.equal(preview.items[0].ean, '0001234567890');
  for (const header of ['code', 'product_name_pt', 'brands']) {
    const duplicate = await workbookPayload([['7892840823580', 'Produto', 'Marca']], sheet => {
      sheet.getCell('AB1').value = ` ${header.toUpperCase()} `;
    }, [1, 6, 12]);
    const response = await f.call('/api/products/import', { method: 'POST', body: duplicate });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, new RegExp(`"${header}" está repetido`));
  }
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM products').get().n, 3);
});

test('both endpoints enforce authentication, administrator role and CSRF', async t => {
  const f = await magazineFixture(t);
  const body = await workbookPayload([['7890000000012', 'Produto', 'Marca']]);
  for (const endpoint of ['/api/products/import/preview', '/api/products/import']) {
    assert.equal((await f.call(endpoint, { method: 'POST', body, session: null })).status, 401);
    assert.equal((await f.call(endpoint, { method: 'POST', body, session: f.client })).status, 403);
    assert.equal((await f.call(endpoint, { method: 'POST', body, headers: { 'X-CSRF-Token': 'wrong' } })).status, 403);
  }
});

test('concurrent imports and a database change after preview never duplicate an EAN', async t => {
  const f = await magazineFixture(t);
  const body = await workbookPayload([['7890000000012', 'Produto', 'Marca']]);
  await f.call('/api/products/import/preview', { method: 'POST', body });
  const results = await Promise.all([1, 2].map(async () => (await f.call('/api/products/import', { method: 'POST', body })).json()));
  assert.equal(results.reduce((sum, result) => sum + result.imported, 0), 1);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM products WHERE ean = ?').get('7890000000012').n, 1);
});

test('any insertion failure rolls back all products from the batch', async t => {
  const f = await magazineFixture(t), productService = createProductService({ database: f.database, imagesDirectory: f.config.imagesDirectory });
  let calls = 0;
  const service = createProductImportService({ database: f.database, productService: { createProduct(payload) {
    if (++calls === 2) throw new Error('Simulated write failure');
    return productService.createProduct(payload);
  } } });
  const body = await workbookPayload([['7890000000012', 'Primeiro', 'Marca'], ['7890000000013', 'Segundo', 'Marca']]);
  await assert.rejects(service.save(body), /Simulated write failure/);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM products').get().n, 3);
  assert.equal(f.database.isTransaction, false);
});

test('preview caps display only, imports all valid rows, and ignores watch-mode notifications', async t => {
  const f = await magazineFixture(t);
  const body = await workbookPayload(Array.from({ length: 105 }, (_, i) => [String(7890000000100 + i), `Produto ${i}`, 'Marca']));
  const previous = process.env.WATCH_REPORT_DEPENDENCIES;
  process.env.WATCH_REPORT_DEPENDENCIES = '1';
  try {
    const parsed = await readProductUpload(body);
    assert.equal(parsed.rows.length, 105);
  } finally {
    if (previous === undefined) delete process.env.WATCH_REPORT_DEPENDENCIES;
    else process.env.WATCH_REPORT_DEPENDENCIES = previous;
  }
  const preview = await (await f.call('/api/products/import/preview', { method: 'POST', body })).json();
  assert.equal(preview.items.length, 100); assert.equal(preview.summary.newProducts, 105);
  const saved = await (await f.call('/api/products/import', { method: 'POST', body })).json();
  assert.equal(saved.imported, 105);
});
