import { parentPort, workerData } from 'node:worker_threads';
import ExcelJS from 'exceljs';
import { normalizeSpreadsheetNamespaces } from './xlsx-compat.mjs';

try {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await normalizeSpreadsheetNamespaces(Buffer.from(workerData)), { ignoreNodes: ['drawing', 'picture', 'extLst'] });
  const sheet = workbook.getWorksheet('Revista') || workbook.worksheets[0];
  if (!sheet) throw new Error('Arquivo sem planilhas.');
  if (sheet.rowCount > 2001) throw new Error('Use uma planilha com até 2.000 produtos.');
  const rows = [];
  sheet.eachRow((row, number) => {
    const values = [1, 2, 3].map(index => {
      const value = row.getCell(index).value;
      if (value instanceof Date) return { date: value.toISOString() };
      if (value && typeof value === 'object') return { invalid: true };
      return value;
    });
    if (values.some(value => value !== null && value !== '')) rows.push({ number, values });
  });
  parentPort.postMessage({ type: 'magazine:xlsx-result', rows });
} catch (error) {
  parentPort.postMessage({ type: 'magazine:xlsx-result', error: error.message === 'Use uma planilha com até 2.000 produtos.'
    ? error.message : 'Não foi possível ler o XLSX. Use o modelo disponibilizado e salve novamente no formato .xlsx.' });
}
