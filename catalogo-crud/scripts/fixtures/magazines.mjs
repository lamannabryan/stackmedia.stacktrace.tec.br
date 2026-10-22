import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { loadConfig } from '../../src/config.mjs';
import { initializeCatalogDatabase } from '../../src/database/catalog-database.mjs';
import { createApplication } from '../../src/app.mjs';
import { testSession } from './auth.mjs';
import { createUserService } from '../../src/modules/users/user-service.mjs';
import { currentMagazineMonth } from '../../src/modules/magazines/magazine-service.mjs';

export async function magazineWorkbook(rows, headers = ['EAN', 'PREÇO', 'VIGENCIA']) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Revista'); sheet.addRow(headers);
  rows.forEach(row => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function magazineFixture(t) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'stackmedia-magazines-'));
  const catalog = path.join(directory, 'products.json'), manifest = path.join(directory, 'manifest.json');
  await fs.writeFile(catalog, JSON.stringify({ produtos: [
    { id: 1, nome: 'Produto com zero inicial', ean: '0123456789012', status: 'ativo' },
    { id: 2, nome: 'Produto de teste', ean: '7891234567895', status: 'ativo' },
    { id: 3, nome: 'Produto inativo', ean: '7891234567888', status: 'inativo' },
  ] }));
  await fs.writeFile(manifest, '{"produtos":[]}');
  const config = loadConfig({ NODE_ENV: 'test', CATALOG_STORAGE_ROOT: directory, CATALOG_SOURCE: catalog, MANIFEST_SOURCE: manifest });
  const database = await initializeCatalogDatabase(config), errors = [];
  const server = createServer(createApplication({ config, database, logger: { error: error => errors.push(error) } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const admin = await testSession(database, origin);
  await createUserService({ database }).create({ name: 'Cliente', email: 'client@magazine.test', password: 'client-password-123', role: 'cliente' });
  const login = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'client@magazine.test', password: 'client-password-123' }) });
  const client = { ...await login.json(), cookie: login.headers.get('set-cookie').split(';')[0] };
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); database.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('stackmedia-magazines-'));
    await fs.rm(directory, { recursive: true, force: true }); assert.deepEqual(errors, []);
  });
  const call = (url, { session = admin, body, headers, ...options } = {}) => fetch(origin + url, { redirect: 'manual', ...options,
    headers: { ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const month = currentMagazineMonth(), period = `${month.slice(5)}/${month.slice(0, 4)}`;
  async function payload(rows = [['0123456789012', 19.9, period], ['7891234567895', '1.234,56', period]]) {
    return { file: (await magazineWorkbook(rows)).toString('base64'), title: 'Revista de teste' };
  }
  return { directory, database, config, origin, admin, client, call, month, period, payload };
}
