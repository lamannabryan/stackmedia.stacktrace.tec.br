import { Worker } from 'node:worker_threads';
import { badRequest } from '../../http/errors.mjs';

// The caller decodes, rotates and limits the image to 2000 x 2000 first.
// Keep the color-mask work off the HTTP event loop and bound its runtime.
export function removeWhiteBackground(data, { width, height }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 2000 || height > 2000 || data.length !== width * height * 4) {
    throw badRequest('Não foi possível preparar a imagem para remover o fundo branco.');
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./white-background-worker.mjs', import.meta.url), {
      workerData: { data, width, height }, resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    let finished = false;
    function finish(error, output) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(badRequest(error)); else resolve(Buffer.from(output));
    }
    const timer = setTimeout(() => finish('A remoção do fundo demorou demais. Selecione outra imagem e tente novamente.'), 10000);
    worker.on('message', result => {
      // node --watch also sends dependency notifications through this channel.
      if (result?.type !== 'product:white-background') return;
      if (result.error === 'empty') {
        finish('Não foi possível separar o produto do fundo branco. Selecione outra imagem ou carregue uma imagem já recortada.');
      } else if (!(result.data instanceof Uint8Array) || result.data.length !== data.length) {
        finish('Não foi possível remover o fundo branco. Selecione outra imagem e tente novamente.');
      } else finish(null, result.data);
    });
    worker.once('error', () => finish('Não foi possível remover o fundo branco. Selecione outra imagem e tente novamente.'));
    worker.once('exit', () => { if (!finished) finish('O processamento da imagem foi interrompido. Tente novamente.'); });
  });
}
