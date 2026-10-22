import { Worker } from 'node:worker_threads';
import { badRequest } from '../../http/errors.mjs';

export const PRODUCT_IMPORT_BODY_BYTES = 15 * 1024 * 1024;
export const PRODUCT_IMPORT_MAX_ROWS = 10000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Check the ZIP directory before a bounded worker expands XML and shared strings.
function validateArchive(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  }
  if (end < 0) throw badRequest('Arquivo XLSX inválido.');
  const entries = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16), expanded = 0;
  if (!entries || entries > 500 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) {
    throw badRequest('Arquivo XLSX inválido ou complexo demais. Salve novamente como .xlsx.');
  }
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw badRequest('Arquivo XLSX inválido.');
    expanded += buffer.readUInt32LE(offset + 24);
    if (expanded > 64 * 1024 * 1024) throw badRequest('A planilha é grande demais. Divida os produtos em arquivos menores.');
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    if (offset > end) throw badRequest('Arquivo XLSX inválido.');
  }
}

export async function readProductUpload(payload) {
  if (!payload || typeof payload.file !== 'string' || payload.file.length > Math.ceil(MAX_FILE_BYTES / 3) * 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.file)) throw badRequest('Selecione uma planilha XLSX de até 10 MB.');
  const buffer = Buffer.from(payload.file, 'base64');
  if (buffer.length < 22 || buffer.length > MAX_FILE_BYTES) throw badRequest('Selecione uma planilha XLSX de até 10 MB.');
  validateArchive(buffer);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./product-xlsx-worker.mjs', import.meta.url), {
      workerData: buffer, resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let finished = false;
    function finish(error, data) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(badRequest(error)); else resolve(data);
    }
    const timer = setTimeout(() => finish('A leitura excedeu o tempo limite. Divida a planilha em arquivos menores.'), 20000);
    worker.on('message', result => {
      // Ignore node --watch dependency notifications on the worker channel.
      if (result?.type !== 'products:xlsx-result') return;
      if (result.error) { finish(result.error); return; }
      if (typeof result.sheet !== 'string' || !['ean', 'nome', 'fabricante'].every(field => /^[A-Z]{1,3}$/.test(result.columns?.[field] || ''))
        || !Array.isArray(result.rows) || result.rows.length > PRODUCT_IMPORT_MAX_ROWS
        || result.rows.some(row => !Number.isInteger(row.number) || row.number < 2 || !Array.isArray(row.values) || row.values.length !== 3)) {
        finish('Não foi possível ler os produtos da planilha.'); return;
      }
      finish(null, { sheet: result.sheet, columns: result.columns, rows: result.rows });
    });
    worker.once('error', () => finish('Não foi possível processar a planilha. Divida o arquivo ou salve novamente como .xlsx.'));
    worker.once('exit', () => { if (!finished) finish('A leitura da planilha foi interrompida.'); });
  });
}
