import { normalizeEan, isValidEan } from './js/features/barcode/code.js';
import { createCameraScanner } from './js/features/barcode/camera.js';

const eanOverlay = document.querySelector('#ean-scanner-overlay');
const eanOpenButton = document.querySelector('#ean-overlay-open');
const eanCloseButton = document.querySelector('#ean-overlay-close');
const eanForm = document.querySelector('#ean-launcher');
const eanInput = document.querySelector('#ean-input');
const eanStatus = document.querySelector('#ean-status');
const eanFormat = document.querySelector('#ean-format');
const eanSubmit = document.querySelector('#ean-submit');
const cameraStart = document.querySelector('#ean-camera-start');
const cameraLabel = document.querySelector('#ean-camera-label');
const cameraStop = document.querySelector('#ean-camera-stop');
const cameraPanel = document.querySelector('#ean-camera-panel');
const manualFields = document.querySelector('#ean-manual-fields');
const scannerTitle = document.querySelector('#ean-scanner-title');
const scannerDescription = document.querySelector('#ean-scanner-description');
const mobileLayout = window.matchMedia('(max-width: 900px)');

let scanTimer;
let lastSubmittedEan = '';
let lookupInProgress = false;
let lookupController;
const camera = createCameraScanner({
  video: document.querySelector('#ean-camera-video'),
  allowManualEntry: () => !mobileLayout.matches,
  onCode(code) {
    if (!eanOverlay.open || document.hidden) return;
    eanInput.value = code;
    openArtworkForEan(code);
  },
  onState(state) {
    renderCameraState(state);
    if (state === 'starting') setEanStatus('Preparando câmera… Autorize o acesso quando solicitado.');
    if (state === 'scanning') setEanStatus('Enquadre o código inteiro e mantenha o aparelho parado.');
  },
  onError(message) { setEanStatus(message, true); },
});

function renderCameraState(state) {
  const active = state !== 'idle';
  cameraPanel.hidden = !active;
  cameraStart.hidden = active;
  cameraStop.hidden = mobileLayout.matches;
  manualFields.hidden = mobileLayout.matches || active;
  eanInput.disabled = mobileLayout.matches || active;
  eanSubmit.disabled = mobileLayout.matches || active || lookupInProgress;
  eanOverlay.classList.toggle('camera-active', active);
  cameraStart.setAttribute('aria-expanded', String(active));
}

function syncScannerMode() {
  clearTimeout(scanTimer);
  cameraLabel.textContent = mobileLayout.matches ? 'Tentar câmera novamente' : 'Usar câmera';
  scannerTitle.textContent = mobileLayout.matches ? 'Ler com câmera' : 'Busque pelo código';
  if (scannerDescription) scannerDescription.textContent = mobileLayout.matches
    ? 'Escolha o formato e aponte a câmera para o código de barras do produto.'
    : 'Use a câmera, digite o código de barras ou utilize um leitor conectado para abrir o produto no editor.';
  if (eanOverlay.open) {
    camera.stop();
    setEanStatus(mobileLayout.matches ? 'Toque em Tentar câmera novamente para iniciar a leitura.' : 'Use a câmera, digite o código ou use um leitor conectado.');
    eanCloseButton.focus({ preventScroll: true });
  }
  renderCameraState(camera.state);
}

function startCamera() {
  if (!eanOverlay.open || document.hidden || lookupInProgress || camera.state !== 'idle') return;
  clearTimeout(scanTimer);
  lastSubmittedEan = '';
  document.activeElement?.blur();
  camera.start();
  if (mobileLayout.matches) eanCloseButton.focus({ preventScroll: true });
  else if (camera.state !== 'idle') cameraStop.focus({ preventScroll: true });
}

function setEanStatus(message = '', isError = false) {
  if (!eanStatus) return;
  eanStatus.textContent = message;
  eanStatus.classList.toggle('is-error', isError);
}

function closeScanner() {
  camera.stop();
  clearTimeout(scanTimer);
  lookupController?.abort();
  lookupController = null;
  lookupInProgress = false;
  eanOverlay.close();
  eanOverlay.hidden = true;
  document.body.classList.remove('scanner-open');
  eanOpenButton.focus();
}

function openScanner() {
  lastSubmittedEan = '';
  lookupInProgress = false;
  eanInput.value = '';
  if (eanSubmit) eanSubmit.disabled = mobileLayout.matches;
  cameraStart.disabled = false;
  setEanStatus(mobileLayout.matches ? 'Preparando câmera…' : 'Use a câmera, digite o código ou use um leitor conectado.');
  eanOverlay.hidden = false;
  eanOverlay.showModal();
  document.body.classList.add('scanner-open');
  if (mobileLayout.matches) startCamera();
  requestAnimationFrame(() => {
    if (mobileLayout.matches || window.matchMedia('(pointer: coarse)').matches) eanCloseButton.focus();
    else eanInput.focus();
  });
}

async function openArtworkForEan(ean) {
  if (lookupInProgress || ean === lastSubmittedEan) return;
  camera.stop();
  lookupInProgress = true;
  lastSubmittedEan = ean;
  const controller = new AbortController();
  lookupController = controller;
  if (eanSubmit) eanSubmit.disabled = true;
  cameraStart.disabled = true;
  const format = ['feed', 'encarte'].includes(eanFormat?.value) ? eanFormat.value : 'stories';
  setEanStatus('Localizando produto…');

  try {
    const response = await fetch(`/api/products/by-ean/${encodeURIComponent(ean)}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const product = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(product.error || 'Produto não encontrado para este EAN.');
    if (!controller.signal.aborted && eanOverlay.open) {
      window.location.assign(`/artes/${format}?productId=${encodeURIComponent(String(product.id))}`);
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    lastSubmittedEan = '';
    setEanStatus(error.message || 'Não foi possível localizar o produto.', true);
    if (!mobileLayout.matches) eanInput.focus();
  } finally {
    if (lookupController === controller) {
      lookupInProgress = false;
      if (eanSubmit) eanSubmit.disabled = mobileLayout.matches;
      cameraStart.disabled = false;
    }
  }
}

function submitEan({ showValidation = true } = {}) {
  if (mobileLayout.matches) return;
  const ean = normalizeEan(eanInput.value);
  eanInput.value = ean;
  if (!isValidEan(ean)) {
    if (showValidation) setEanStatus('Código não reconhecido. Tente novamente.', true);
    return;
  }
  openArtworkForEan(ean);
}

if (eanOverlay && eanOpenButton && eanCloseButton && eanForm && eanInput) {
  eanFormat?.addEventListener('change', () => {
    if (!mobileLayout.matches && camera.state === 'idle') eanInput.focus();
  });
  cameraStart.addEventListener('click', startCamera);
  cameraStop.addEventListener('click', () => {
    if (mobileLayout.matches) return;
    camera.stop();
    setEanStatus('Digite o código ou use o leitor.');
    eanInput.focus();
  });
  const pauseCamera = () => {
    if (camera.state === 'idle') return;
    camera.stop();
    setEanStatus(mobileLayout.matches
      ? 'Câmera pausada. Toque em Tentar câmera novamente para continuar.'
      : 'Câmera pausada. Toque em Usar câmera para continuar.');
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseCamera(); });
  window.addEventListener('pagehide', pauseCamera);
  eanOpenButton.addEventListener('click', openScanner);
  eanCloseButton.addEventListener('click', closeScanner);
  eanOverlay.addEventListener('click', (event) => {
    if (event.target === eanOverlay) closeScanner();
  });
  eanOverlay.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeScanner();
  });
  eanForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitEan();
  });
  eanInput.addEventListener('input', () => {
    if (mobileLayout.matches) return;
    clearTimeout(scanTimer);
    lookupController?.abort();
    lookupController = null;
    lookupInProgress = false;
    if (eanSubmit) eanSubmit.disabled = false;
    cameraStart.disabled = false;
    eanInput.value = normalizeEan(eanInput.value);
    lastSubmittedEan = '';
    setEanStatus('Digite o código ou use o leitor.');
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (!isValidEan(eanInput.value)) return;
    scanTimer = setTimeout(() => submitEan({ showValidation: false }), 120);
  });
  mobileLayout.addEventListener('change', syncScannerMode);
  syncScannerMode();
  if ((window.location.search || '').includes('openScanner=1')) {
    window.history.replaceState({}, '', window.location.pathname);
    if (document.documentElement?.classList.contains('app-is-loading')) {
      window.addEventListener('app-page-ready', openScanner, { once: true });
    } else requestAnimationFrame(openScanner);
  }
}
