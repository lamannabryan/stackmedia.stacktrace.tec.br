import { Worker } from 'node:worker_threads';
import { badRequest } from '../../http/errors.mjs';

export const MAGAZINE_BODY_BYTES = 6 * 1024 * 1024;

// Reject oversized archives before parsing XML in a bounded worker.
function validateArchive(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw badRequest('Arquivo XLSX inválido.');
  const entries = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16), expanded = 0;
  if (entries > 300) throw badRequest('A planilha contém muitos arquivos internos. Use o modelo.');
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw badRequest('Arquivo XLSX inválido.');
    expanded += buffer.readUInt32LE(offset + 24);
    if (expanded > 32 * 1024 * 1024) throw badRequest('A planilha é grande demais. Limite a lista a 2.000 produtos.');
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}

export async function readMagazineUpload(payload) {
  if (!payload || typeof payload.file !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.file)) {
    throw badRequest('Selecione uma planilha XLSX.');
  }
  const buffer = Buffer.from(payload.file, 'base64');
  if (buffer.length < 22 || buffer.length > 4 * 1024 * 1024) throw badRequest('Envie um XLSX de até 4 MB.');
  validateArchive(buffer);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./xlsx-worker.mjs', import.meta.url), {
      workerData: buffer, resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    let finished = false;
    function finish(error, rows) {
      if (finished) return;
      finished = true; clearTimeout(timer); void worker.terminate();
      if (error) reject(badRequest(error)); else resolve(rows);
    }
    const timer = setTimeout(() => finish('A leitura excedeu o tempo limite. Reduza a planilha e tente novamente.'), 10000);
    worker.on('message', result => {
      // node --watch also sends watch:import/watch:require on this channel.
      // Those messages are not completion and must not terminate the worker.
      if (result?.type !== 'magazine:xlsx-result') return;
      if (typeof result.error === 'string' && result.error) { finish(result.error); return; }
      if (!Array.isArray(result.rows) || result.rows.some(row => !row || !Number.isInteger(row.number)
        || row.number < 1 || !Array.isArray(row.values) || row.values.length !== 3)) {
        finish('A leitura da planilha retornou dados inválidos. Tente importar novamente.');
        return;
      }
      finish(null, result.rows);
    });
    worker.once('error', () => finish('Não foi possível processar a planilha. Use o modelo e tente novamente.'));
    worker.once('exit', () => { if (!finished) finish('A leitura da planilha foi interrompida.'); });
  });
}
