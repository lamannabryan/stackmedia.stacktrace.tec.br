import { createBarcodeDecoder } from './decoder.js';
import { isValidEan } from './code.js';

// Match the centered object-fit: cover preview, including after phone rotation.
export function visibleCameraFrame(video) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  const ratio = video.clientWidth > 0 && video.clientHeight > 0
    ? video.clientWidth / video.clientHeight : width / height;
  const cropWidth = Math.min(width, height * ratio);
  const cropHeight = Math.min(height, width / ratio);
  return { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight };
}

export function cameraErrorMessage(error, { allowManualEntry = true } = {}) {
  if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name)) {
    return allowManualEntry
      ? 'A câmera não foi autorizada. Permita o acesso nas configurações deste site ou digite o código.'
      : 'A câmera não foi autorizada. Permita o acesso nas configurações deste site e tente novamente.';
  }
  if (['NotFoundError', 'DevicesNotFoundError'].includes(error?.name)) {
    return allowManualEntry
      ? 'Nenhuma câmera foi encontrada. Digite o código para continuar.'
      : 'Nenhuma câmera foi encontrada. Verifique se a câmera está disponível e tente novamente.';
  }
  if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(error?.name)) {
    return 'Não foi possível abrir a câmera. Feche outros apps que estejam usando a câmera e tente novamente.';
  }
  return allowManualEntry
    ? 'Não foi possível iniciar a leitura. Tente novamente ou digite o código.'
    : 'Não foi possível iniciar a leitura. Tente abrir a câmera novamente.';
}

/** Owns one camera session, including permission requests that resolve after closing. */
export function createCameraScanner({
  video, onCode, onState = () => {}, onError = () => {},
  allowManualEntry = () => true,
  mediaDevices = globalThis.navigator?.mediaDevices,
  secureContext = globalThis.isSecureContext,
  loadDecoder = createBarcodeDecoder,
  createCanvas = () => document.createElement('canvas'),
  schedule = setTimeout, cancel = clearTimeout, now = Date.now,
}) {
  let generation = 0;
  let state = 'idle';
  let stream = null;
  let timer;
  let candidate = '';
  let candidateTime = 0;
  const setState = (value) => { state = value; onState(value); };
  const release = (media) => media?.getTracks().forEach((track) => track.stop());

  function stop() {
    generation += 1;
    cancel(timer);
    timer = undefined;
    candidate = '';
    release(stream);
    stream = null;
    video.pause();
    video.srcObject = null;
    setState('idle');
  }

  async function start() {
    if (state !== 'idle') return;
    if (!secureContext) {
      onError(allowManualEntry()
        ? 'A câmera precisa de uma conexão HTTPS. Abra o endereço seguro do aplicativo ou digite o código.'
        : 'A câmera precisa de uma conexão HTTPS. Abra o endereço seguro do aplicativo para continuar.');
      return;
    }
    if (!mediaDevices?.getUserMedia) {
      onError(allowManualEntry()
        ? 'Este navegador não disponibiliza a câmera. Abra no Safari ou Chrome atualizado, ou digite o código.'
        : 'Este navegador não disponibiliza a câmera. Abra no Safari ou Chrome atualizado para continuar.');
      return;
    }
    const session = ++generation;
    const current = () => session === generation;
    setState('starting');
    try {
      const decode = await loadDecoder();
      if (!current()) return;
      const portrait = video.clientHeight > video.clientWidth;
      const acquired = await mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: portrait ? 720 : 1280 }, height: { ideal: portrait ? 1280 : 720 } },
      });
      if (!current()) { release(acquired); return; }
      stream = acquired;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (!current()) return;
          stop();
          onError('A câmera foi interrompida. Tente abrir a câmera novamente.');
        }, { once: true });
      }
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      if (!current()) return;
      const canvas = createCanvas();
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas unavailable');
      setState('scanning');
      const scan = async () => {
        if (!current()) return;
        try {
          if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
            const visible = visibleCameraFrame(video);
            const scale = Math.min(1, 1280 / Math.max(visible.width, visible.height));
            const width = Math.max(1, Math.round(visible.width * scale));
            const height = Math.max(1, Math.round(visible.height * scale));
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;
            context.drawImage(video, visible.x, visible.y, visible.width, visible.height, 0, 0, width, height);
            const code = await decode(canvas);
            if (!current()) return;
            if (code && isValidEan(code)) {
              if (candidate === code && now() - candidateTime < 1500) {
                stop();
                onCode(code);
                return;
              }
              candidate = code;
              candidateTime = now();
            }
          }
          timer = schedule(scan, 180);
        } catch (error) {
          if (!current()) return;
          stop();
          onError(cameraErrorMessage(error, { allowManualEntry: allowManualEntry() }));
        }
      };
      timer = schedule(scan, 0);
    } catch (error) {
      if (!current()) return;
      stop();
      onError(cameraErrorMessage(error, { allowManualEntry: allowManualEntry() }));
    }
  }

  return { start, stop, get state() { return state; } };
}
