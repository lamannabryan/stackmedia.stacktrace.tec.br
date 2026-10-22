import { badRequest, HttpError } from '../../http/errors.mjs';
import { readMagazineUpload } from './import-xlsx.mjs';

const monthPattern = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/;
export function currentMagazineMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(date);
  return `${parts.find(part => part.type === 'year').value}-${parts.find(part => part.type === 'month').value}`;
}
function monthValue(value) {
  if (value?.date) value = value.date.slice(0, 7);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = /^(0?[1-9]|1[0-2])\/(20\d{2}|2100)$/.exec(trimmed);
  const month = match ? `${match[2]}-${match[1].padStart(2, '0')}` : trimmed;
  return monthPattern.test(month) ? month : null;
}
function priceValue(value) {
  if (typeof value === 'string') {
    value = value.trim().replace(/^R\$\s*/, '');
    if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(value) || /^\d+,\d{1,2}$/.test(value)) value = value.replaceAll('.', '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
    value = Number(value);
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 999999.99) return null;
  const cents = Math.round(value * 100);
  return Math.abs(value * 100 - cents) < 0.00001 ? cents : null;
}
function titleValue(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw badRequest('Informe um título de até 120 caracteres.');
  return value.trim();
}
function magazineId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw badRequest('Revista inválida.');
  return Number(value);
}

export function createMagazineService({ database, productService }) {
  function find(id) {
    const row = database.prepare('SELECT * FROM magazines WHERE id = ?').get(magazineId(id));
    if (!row) throw new HttpError(404, 'Revista não encontrada.');
    return row;
  }
  function serialize(row) {
    const current = currentMagazineMonth();
    return { ...row, active: Boolean(row.active), status: !row.active ? 'Pausada' : row.month < current ? 'Encerrada' : row.month > current ? 'Agendada' : 'Em destaque',
      total: database.prepare('SELECT COUNT(*) AS total FROM magazine_items WHERE magazine_id = ?').get(row.id).total };
  }
  function list() { return database.prepare('SELECT * FROM magazines ORDER BY month DESC').all().map(serialize); }
  function details(id) {
    const magazine = serialize(find(id));
    const items = database.prepare('SELECT * FROM magazine_items WHERE magazine_id = ? ORDER BY position').all(magazine.id)
      .map(item => ({ ...item, product: item.product_id ? productService.getProduct(item.product_id) : null, preco_sugerido: item.price_cents / 100 }));
    return { ...magazine, items };
  }
  function validate(rows) {
    if (!Array.isArray(rows)) throw badRequest('Não foi possível obter as linhas da planilha. Tente importar novamente.');
    const normalize = value => typeof value === 'string' ? value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() : '';
    if (!rows.length || rows[0].number !== 1 || rows[0].values.map(normalize).join('|') !== 'EAN|PRECO|VIGENCIA') {
      throw badRequest('A primeira linha deve conter EAN, PREÇO e VIGENCIA, nessa ordem.');
    }
    const items = [], errors = [], seen = new Set(), months = new Set();
    const error = (row, message) => { if (errors.length < 100) errors.push({ row, message }); };
    for (const row of rows.slice(1)) {
      const [rawEan, rawPrice, rawMonth] = row.values;
      const ean = typeof rawEan === 'number' && Number.isSafeInteger(rawEan) ? String(rawEan) : typeof rawEan === 'string' ? rawEan.trim() : '';
      const cents = priceValue(rawPrice), month = monthValue(rawMonth);
      let valid = true;
      if (!/^(\d{8}|\d{12,14})$/.test(ean)) { error(row.number, 'EAN inválido. Use 8, 12, 13 ou 14 dígitos, sem fórmulas.'); valid = false; }
      if (cents === null) { error(row.number, 'PREÇO deve ser maior que zero, até R$ 999.999,99, com no máximo duas casas decimais.'); valid = false; }
      if (!month) { error(row.number, 'VIGENCIA inválida. Use MM/AAAA (ex.: 10/2026).'); valid = false; } else months.add(month);
      if (seen.has(ean)) { error(row.number, `EAN ${ean} repetido na planilha.`); valid = false; }
      seen.add(ean);
      if (!valid) continue;
      const products = database.prepare('SELECT id, nome, status FROM products WHERE TRIM(ean) = ? LIMIT 2').all(ean);
      if (products.length !== 1) { error(row.number, products.length ? `EAN ${ean} está associado a mais de um produto no catálogo.` : `EAN ${ean} não encontrado no catálogo. Confira também os zeros iniciais.`); continue; }
      if (products[0].status !== 'ativo') { error(row.number, `O produto ${products[0].nome} está inativo no catálogo.`); continue; }
      items.push({ row: row.number, ean, product_id: products[0].id, nome: products[0].nome, price_cents: cents, preco_sugerido: cents / 100 });
    }
    if (months.size > 1) error(0, 'Use apenas um mês/ano por planilha. Importe uma revista por vez.');
    if (rows.length === 1) error(0, 'Preencha pelo menos um produto antes de importar.');
    const month = months.size === 1 ? [...months][0] : null;
    const existing = month ? database.prepare('SELECT * FROM magazines WHERE month = ?').get(month) : null;
    return { valid: errors.length === 0 && items.length > 0, canImport: Boolean(month) && items.length > 0,
      skippedRows: rows.length - 1 - items.length, month, items, errors, total: rows.length - 1,
      existing: existing ? serialize(existing) : null };
  }
  async function preview(payload) { return validate(await readMagazineUpload(payload)); }
  async function save(payload) {
    const rows = await readMagazineUpload(payload);
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = validate(rows);
      if (!result.valid && !(payload.ignoreErrors === true && result.canImport)) throw badRequest('A planilha contém erros. Faça uma nova prévia antes de importar.');
      const existing = result.existing;
      if ((existing?.revision ?? null) !== (payload.expectedRevision ?? null)) throw new HttpError(409, 'A revista mudou desde a prévia. Analise a planilha novamente antes de substituir.');
      const title = titleValue(payload.title), timestamp = new Date().toISOString();
      let id;
      if (existing) {
        id = existing.id;
        database.prepare('UPDATE magazines SET title = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(title, timestamp, id);
        database.prepare('DELETE FROM magazine_items WHERE magazine_id = ?').run(id);
      } else {
        id = Number(database.prepare('INSERT INTO magazines (month, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(result.month, title, timestamp, timestamp).lastInsertRowid);
      }
      const insert = database.prepare('INSERT INTO magazine_items (magazine_id, product_id, ean, price_cents, position) VALUES (?, ?, ?, ?, ?)');
      result.items.forEach((item, index) => insert.run(id, item.product_id, item.ean, item.price_cents, index));
      const saved = { ...details(id), skippedRows: result.skippedRows };
      database.exec('COMMIT'); return saved;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  function update(id, payload) {
    const current = find(id);
    if (current.revision !== payload?.revision) throw new HttpError(409, 'A revista foi alterada. Atualize a lista.');
    const title = titleValue(payload.title);
    if (typeof payload.active !== 'boolean') throw badRequest('Informe a situação da revista.');
    database.prepare('UPDATE magazines SET title = ?, active = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
      .run(title, Number(payload.active), new Date().toISOString(), current.id);
    return details(id);
  }
  function remove(id, revision) {
    const current = find(id);
    if (current.revision !== Number(revision)) throw new HttpError(409, 'A revista foi alterada. Atualize a lista antes de excluir.');
    database.prepare('DELETE FROM magazines WHERE id = ?').run(current.id);
  }
  function featured() {
    const row = database.prepare('SELECT id FROM magazines WHERE month = ? AND active = 1').get(currentMagazineMonth());
    if (!row) return null;
    const result = details(row.id);
    result.items = result.items.filter(item => item.product?.status === 'ativo');
    return result;
  }
  return { list, details, preview, save, update, remove, featured };
}
