import { parentPort, workerData } from 'node:worker_threads';
import ExcelJS from 'exceljs';
import { normalizeSpreadsheetNamespaces } from '../magazines/xlsx-compat.mjs';
import { PRODUCT_IMPORT_MAX_ROWS } from './import-xlsx.mjs';

function valueOf(cell, ean = false) {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (ean && (!Number.isSafeInteger(value) || value < 0)) return null;
    // A numeric EAN may use a custom zero-padding format. Scientific display
    // formats must never replace the underlying integer with a rounded value.
    if (ean && /^0{8,14}$/.test(cell.numFmt || '')) return String(value).padStart(cell.numFmt.length, '0');
    return String(value);
  }
  if (value && Array.isArray(value.richText)) return value.richText.map(part => part.text).join('').trim();
  // Do not evaluate formulas, follow links, or use potentially stale cached results.
  return null;
}

try {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await normalizeSpreadsheetNamespaces(Buffer.from(workerData)), { ignoreNodes: ['drawing', 'picture', 'extLst'] });
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Arquivo sem planilhas.');
  const required = { ean: 'code', nome: 'product_name_pt', fabricante: 'brands' };
  const indexes = {}, columns = {};
  sheet.getRow(1).eachCell((cell, index) => {
    const header = valueOf(cell)?.replace(/^\uFEFF/, '').trim().toLowerCase();
    const field = Object.keys(required).find(key => required[key] === header);
    if (!field) return;
    const column = cell.address.replace(/\d+$/, '');
    if (indexes[field]) throw new Error(`Layout inválido: o cabeçalho "${header}" está repetido nas colunas ${columns[field]} e ${column}. Mantenha apenas uma coluna com esse cabeçalho.`);
    indexes[field] = index;
    columns[field] = column;
  });
  for (const [field, header] of Object.entries(required)) {
    if (!indexes[field]) throw new Error(`Layout inválido: o cabeçalho "${header}" não foi encontrado na linha 1. A planilha deve conter code, product_name_pt e brands, em qualquer ordem.`);
  }
  if (sheet.rowCount > PRODUCT_IMPORT_MAX_ROWS + 1) throw new Error('Use uma planilha com até 10.000 linhas de produtos.');
  const rows = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    rows.push({ number, values: [valueOf(row.getCell(indexes.ean), true), valueOf(row.getCell(indexes.nome)), valueOf(row.getCell(indexes.fabricante))] });
  });
  if (!rows.length) throw new Error('A planilha não contém produtos.');
  parentPort.postMessage({ type: 'products:xlsx-result', sheet: sheet.name, columns, rows });
} catch (error) {
  const known = /^(Layout inválido:|Use uma planilha|Arquivo sem planilhas|A planilha não contém)/.test(error.message);
  parentPort.postMessage({ type: 'products:xlsx-result', error: known ? error.message : 'Não foi possível ler o XLSX. Salve o arquivo novamente como .xlsx e tente importar.' });
}
