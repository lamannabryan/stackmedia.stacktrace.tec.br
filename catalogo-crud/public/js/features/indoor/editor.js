import { PRODUCT_LIMIT, addProduct, removeProduct, moveProduct, canContinue } from './model.js';
import { INDOOR_WIDTH, INDOOR_HEIGHT, INDOOR_DURATION, drawIndoorFrame } from './renderer.js';
import { bindPriceInput } from '../stories/price-input.js';

const byId = (id) => document.getElementById(`indoor-${id}`);
const ui = Object.fromEntries([
  'status', 'search', 'results', 'results-summary', 'load-more', 'selected', 'selection-count',
  'continue', 'backgrounds', 'reload-backgrounds', 'open-preview', 'canvas', 'preview-loading',
  'play', 'time', 'time-label', 'scenes', 'download', 'export-status', 'export-progress',
  'cancel-export', 'download-link', 'retry-preview', 'product-views', 'show-catalog', 'show-selection',
  'catalog', 'selection-panel', 'mobile-count', 'mobile-dock', 'mobile-hint', 'mobile-back', 'mobile-next',
].map((id) => [id, byId(id)]));
const stepButtons = [...document.querySelectorAll('[data-step]')];
const backButtons = [...document.querySelectorAll('[data-go]')];
const context = ui.canvas.getContext('2d');
const mobileViewport = window.matchMedia('(max-width: 900px)');
const state = {
  step: 'products', selection: [], products: [], page: 0, total: 0, hasMore: false,
  productRequest: null, productError: false, backgrounds: [], background: null,
  backgroundsLoading: false, backgroundsLoaded: false, snapshot: null, previewVersion: 0,
  seconds: 0, playing: false, frame: 0, exportController: null, downloadUrl: null, productView: 'catalog',
};
const images = new Map();
const productScroll = { catalog: 0, selection: 0 };
let searchTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function thumbnail(url, alt = '') {
  const image = element('img');
  image.alt = alt;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.src = url;
  return image;
}

function button(label, onClick, className = '') {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function status(message, error = false, node = ui.status) {
  node.textContent = message;
  node.classList.toggle('is-error', error);
  if (node === ui['export-status'] && state.step === 'preview') {
    ui['mobile-hint'].textContent = message;
    ui['mobile-hint'].classList.toggle('is-error', error);
  }
}

function syncMobileControls() {
  const mobile = mobileViewport.matches;
  const busy = Boolean(state.exportController);
  const complete = canContinue(state.selection);
  const count = state.selection.length;
  ui['product-views'].hidden = !mobile || state.step !== 'products';
  ui['mobile-dock'].hidden = !mobile;
  ui.catalog.hidden = state.step === 'pricing' || (mobile && state.productView !== 'catalog');
  ui['selection-panel'].hidden = state.step !== 'pricing' && mobile && state.productView !== 'selection';
  ui['show-catalog'].setAttribute('aria-pressed', String(state.productView === 'catalog'));
  ui['show-selection'].setAttribute('aria-pressed', String(state.productView === 'selection'));
  ui['mobile-count'].textContent = `${count}/${PRODUCT_LIMIT}`;
  ui['mobile-back'].hidden = false;
  ui['mobile-back'].disabled = false;
  ui['mobile-hint'].classList.remove('is-error');
  if (state.step === 'products') {
    const reviewing = state.productView === 'selection';
    ui['mobile-back'].textContent = reviewing ? '← Catálogo' : 'Buscar';
    ui['mobile-next'].textContent = reviewing ? 'Escolher fundo →' : 'Revisar seleção →';
    ui['mobile-next'].disabled = reviewing ? !complete : !count;
    ui['mobile-hint'].textContent = complete ? '5 de 5 · Confira a ordem e os preços opcionais.'
      : `${count} de 5 selecionados · Faltam ${PRODUCT_LIMIT - count}.`;
  } else if (state.step === 'pricing') {
    ui['mobile-back'].textContent = '? Produtos';
    ui['mobile-next'].textContent = 'Escolher fundo ?';
    ui['mobile-next'].disabled = !complete;
    ui['mobile-hint'].textContent = 'Ajuste os pre?os opcionais e a ordem.';
  } else if (state.step === 'background') {
    ui['mobile-back'].textContent = '← Produtos';
    ui['mobile-next'].textContent = 'Conferir vídeo →';
    ui['mobile-next'].disabled = !complete || !state.background || state.backgroundsLoading;
    ui['mobile-hint'].textContent = state.background ? `Fundo: ${state.background.nome}` : 'Escolha o fundo da sua campanha.';
  } else {
    ui['mobile-back'].textContent = busy ? 'Cancelar' : '← Fundo';
    ui['mobile-back'].disabled = busy && state.exportController.signal.aborted;
    ui['mobile-next'].textContent = busy ? 'Exportando…' : 'Baixar MP4';
    ui['mobile-next'].disabled = busy || !state.snapshot;
    ui['mobile-hint'].textContent = ui['export-status'].textContent;
    ui['mobile-hint'].classList.toggle('is-error', ui['export-status'].classList.contains('is-error'));
  }
}

function showProductView(view, { focus = true } = {}) {
  if (state.exportController || !['catalog', 'selection'].includes(view)) return;
  if (mobileViewport.matches) productScroll[state.productView] = window.scrollY;
  state.productView = view;
  syncMobileControls();
  if (!mobileViewport.matches) return;
  if (focus) byId(view === 'catalog' ? 'products-heading' : 'selected-heading').focus({ preventScroll: true });
  window.scrollTo({ top: productScroll[view], behavior: 'instant' });
}

function selectionStatus() {
  if (state.step === 'pricing') { status('Use as setas para ordenar os produtos e informe os pre?os opcionais.'); return; }
  const remaining = PRODUCT_LIMIT - state.selection.length;
  status(remaining ? `Escolha mais ${remaining} ${remaining === 1 ? 'produto' : 'produtos'} para completar o vídeo.`
    : 'Os cinco produtos estão selecionados. Continue para configurar pre?os e ordem.');
}

function syncControls() {
  const busy = Boolean(state.exportController);
  const complete = canContinue(state.selection);
  for (const node of stepButtons) {
    node.disabled = busy || (node.dataset.step !== 'products' && !complete)
      || (node.dataset.step === 'preview' && !state.background);
    if (node.dataset.step === state.step) node.setAttribute('aria-current', 'step');
    else node.removeAttribute('aria-current');
  }
  for (const node of backButtons) node.disabled = busy;
  ui.continue.disabled = busy || !complete;
  ui['open-preview'].disabled = busy || !complete || !state.background || state.backgroundsLoading;
  ui['reload-backgrounds'].disabled = busy || state.backgroundsLoading;
  ui.search.disabled = busy;
  ui['load-more'].disabled = busy || Boolean(state.productRequest);
  ui.play.disabled = ui.time.disabled = ui.download.disabled = busy || !state.snapshot;
  ui['retry-preview'].disabled = busy;
  for (const node of ui.scenes.querySelectorAll('button')) node.disabled = busy || !state.snapshot;
  syncMobileControls();
}

function clearDownload() {
  if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
  state.downloadUrl = null;
  ui['download-link'].hidden = true;
  ui['download-link'].removeAttribute('href');
}

function invalidatePreview() {
  pause();
  state.snapshot = null;
  state.previewVersion += 1;
  clearDownload();
  status('Confira a prévia antes de exportar.', false, ui['export-status']);
  syncControls();
}

function updateSelection(next) {
  if (state.exportController || next === state.selection) return;
  state.selection = next;
  invalidatePreview();
  renderSelected();
  renderResults();
  selectionStatus();
}

function renderSelected() {
  ui['selection-count'].textContent = `${state.selection.length} / ${PRODUCT_LIMIT}`;
  ui.selected.replaceChildren();
  for (let index = 0; index < PRODUCT_LIMIT; index += 1) {
    const entry = state.selection[index];
    const row = element('li', entry ? '' : 'indoor-slot-empty');
    row.append(element('span', 'indoor-slot', String(index + 1)));
    if (!entry) {
      row.append(element('p', '', 'Adicione um produto do catálogo'));
    } else {
      const { product } = entry;
      const details = element('div');
      const actions = element('div', 'indoor-item-actions');
      const reorder = (direction) => {
        updateSelection(moveProduct(state.selection, product.id, direction));
        const row = ui.selected.querySelector(`[data-product-id="${product.id}"]`);
        const action = row?.querySelector(`[data-move="${direction}"]:not(:disabled)`)
          || row?.querySelector('.indoor-item-actions button:not(:disabled)');
        action?.focus({ preventScroll: true });
      };
      const up = button('↑', () => reorder(-1));
      const down = button('↓', () => reorder(1));
      const remove = button('Remover', () => {
        updateSelection(removeProduct(state.selection, product.id));
        if (mobileViewport.matches) {
          const nextRow = ui.selected.children[Math.min(index, state.selection.length - 1)];
          const nextAction = nextRow?.querySelector('.indoor-item-actions button:not(:disabled)');
          (nextAction || byId('selected-heading')).focus({ preventScroll: true });
        } else ui.search.focus();
      });
      up.dataset.move = '-1';
      down.dataset.move = '1';
      up.setAttribute('aria-label', `Antecipar ${product.nome}`);
      down.setAttribute('aria-label', `Adiar ${product.nome}`);
      remove.setAttribute('aria-label', `Remover ${product.nome}`);
      up.disabled = index === 0;
      down.disabled = index === state.selection.length - 1;
      if (state.step === 'pricing') actions.append(up, down); else actions.append(remove);
      const priceLabel = element('label', 'indoor-price', 'Preço opcional (R$)');
      const input = element('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.placeholder = 'Sem preço';
      input.maxLength = 16;
      input.value = entry.price;
      input.setAttribute('aria-label', `Preço de ${product.nome}`);
      bindPriceInput(input, (price) => {
        if (price === entry.price) return;
        entry.price = price;
        invalidatePreview();
      });
      priceLabel.append(input);
      details.append(element('strong', '', product.nome), actions); if (state.step === 'pricing') details.append(priceLabel);
      row.dataset.productId = String(product.id);
      row.append(thumbnail(product.imagem_local_url), details);
    }
    ui.selected.append(row);
  }
  syncControls();
}

function renderResults() {
  ui.results.replaceChildren();
  for (const product of state.products) {
    const selected = state.selection.some((entry) => entry.product.id === product.id);
    const card = button('', () => {
      updateSelection(selected ? removeProduct(state.selection, product.id) : addProduct(state.selection, product));
      ui.results.querySelector(`[data-product-id="${product.id}"]`)?.focus({ preventScroll: true });
    }, 'indoor-product');
    card.dataset.productId = String(product.id);
    card.disabled = !product.imagem_local_url || (!selected && state.selection.length >= PRODUCT_LIMIT);
    card.setAttribute('aria-pressed', String(selected));
    if (product.imagem_local_url) card.append(thumbnail(product.imagem_local_url));
    card.append(element('strong', '', product.nome), element('small', '', selected ? '✓ Selecionado' : 'Adicionar ao vídeo'));
    ui.results.append(card);
  }
  if (!state.products.length) ui.results.append(element('p', 'indoor-empty', state.productRequest
    ? 'Buscando produtos…' : state.productError ? 'Não foi possível carregar o catálogo. Tente novamente.'
      : 'Nenhum produto com imagem encontrado. Tente outra busca.'));
  ui['results-summary'].textContent = `${state.products.length} de ${state.total} produtos com imagem`;
  ui['load-more'].hidden = !state.hasMore && !state.productError;
  ui['load-more'].textContent = state.productError ? 'Tentar carregar produtos novamente' : 'Carregar mais produtos';
  ui.results.setAttribute('aria-busy', String(Boolean(state.productRequest)));
  syncControls();
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(response.status === 401 ? 'Sua sessão expirou. Atualize a página para entrar novamente.'
    : 'Não foi possível carregar os dados. Tente novamente.');
  return response.json();
}

async function loadProducts(append = false) {
  state.productRequest?.abort();
  const controller = new AbortController();
  state.productRequest = controller;
  state.productError = false;
  if (!append) {
    state.products = [];
    state.page = 0;
    state.total = 0;
    state.hasMore = false;
  }
  renderResults();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const params = new URLSearchParams({ q: ui.search.value.trim(), imagem: 'com', status: 'ativo', pageSize: '18', page: String(state.page + 1) });
    const response = await fetchJson(`/api/products?${params}`, controller.signal);
    if (state.productRequest !== controller) return;
    state.products = append ? [...state.products, ...response.items] : response.items;
    state.page = response.pagination.page;
    state.total = response.pagination.total;
    state.hasMore = state.page < response.pagination.totalPages;
    if (state.step === 'products') selectionStatus();
  } catch (error) {
    if (state.productRequest !== controller) return;
    state.productError = true;
    status(error.name === 'AbortError' ? 'A busca demorou demais. Tente carregar os produtos novamente.' : error.message, true);
  } finally {
    clearTimeout(timeout);
    if (state.productRequest === controller) {
      state.productRequest = null;
      renderResults();
    }
  }
}

function renderBackgrounds() {
  ui.backgrounds.replaceChildren();
  for (const background of state.backgrounds) {
    const card = button('', () => {
      state.background = background;
      invalidatePreview();
      for (const option of ui.backgrounds.querySelectorAll('.indoor-background-option')) {
        option.setAttribute('aria-pressed', String(option === card));
      }
      ui.backgrounds.querySelector('[aria-pressed="true"]')?.focus();
      status('Fundo selecionado. Continue para conferir o vídeo.');
    }, 'indoor-background-option');
    card.setAttribute('aria-pressed', String(state.background?.url === background.url));
    card.append(thumbnail(background.thumbnail_url || background.url), element('span', '', background.nome));
    ui.backgrounds.append(card);
  }
  if (!state.backgrounds.length) ui.backgrounds.append(element('p', 'indoor-empty', state.backgroundsLoading
    ? 'Carregando fundos…' : 'Ainda não há fundos para TV Indoor. Assim que forem disponibilizados, clique em Atualizar fundos.'));
  ui.backgrounds.setAttribute('aria-busy', String(state.backgroundsLoading));
  ui['reload-backgrounds'].hidden = state.backgroundsLoading;
  syncControls();
}

async function loadBackgrounds() {
  if (state.backgroundsLoading) return;
  state.backgroundsLoading = true;
  renderBackgrounds();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchJson('/api/indoor-backgrounds', controller.signal);
    state.backgrounds = response.items.map((item) => ({ ...item, url: item.preview_url || item.url }));
    state.backgroundsLoaded = true;
    if (state.background && !state.backgrounds.some((item) => item.url === state.background.url)) {
      state.background = null;
      invalidatePreview();
    }
    if (state.step === 'background') status(state.backgrounds.length
      ? 'Escolha o fundo para sua campanha.' : 'Aguardando a disponibilização dos fundos para TV Indoor.');
  } catch (error) {
    if (state.step === 'background') status(error.name === 'AbortError'
      ? 'O carregamento dos fundos demorou demais. Tente atualizar a lista.' : error.message, true);
  } finally {
    clearTimeout(timeout);
    state.backgroundsLoading = false;
    renderBackgrounds();
  }
}

function loadImage(url) {
  if (images.has(url)) return images.get(url);
  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    const timeout = setTimeout(() => finish(new Error('O carregamento de uma imagem demorou demais. Tente novamente.')), 20000);
    function finish(error) {
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      if (error) reject(error);
      else resolve(image);
    }
    image.onload = () => finish(image.naturalWidth && image.naturalHeight ? null : new Error('Uma imagem está vazia ou inválida.'));
    image.onerror = () => finish(new Error('Não foi possível carregar uma das imagens. Confira o fundo e os produtos e tente novamente.'));
    image.src = url;
  });
  images.set(url, promise);
  promise.catch(() => images.delete(url));
  return promise;
}

function paint() {
  if (!state.snapshot) return;
  const carousel = drawIndoorFrame(context, state.snapshot, state.seconds);
  ui.time.value = String(state.seconds);
  ui['time-label'].textContent = `${state.seconds.toFixed(1).replace('.', ',')} / 15 s`;
  [...ui.scenes.children].forEach((node, index) => node.setAttribute('aria-pressed', String(index === carousel.index)));
}

function pause() {
  state.playing = false;
  cancelAnimationFrame(state.frame);
  ui.play.textContent = 'Reproduzir';
}

function play() {
  if (!state.snapshot || state.exportController) return;
  state.playing = true;
  ui.play.textContent = 'Pausar';
  const origin = performance.now() - state.seconds * 1000;
  function tick(now) {
    if (!state.playing) return;
    state.seconds = ((now - origin) / 1000) % INDOOR_DURATION;
    paint();
    state.frame = requestAnimationFrame(tick);
  }
  state.frame = requestAnimationFrame(tick);
}

async function preparePreview() {
  invalidatePreview();
  const version = state.previewVersion;
  ui['preview-loading'].hidden = false;
  ui['preview-loading'].textContent = 'Preparando as imagens…';
  ui['retry-preview'].hidden = true;
  ui.scenes.replaceChildren();
  const selected = state.selection.map((entry) => ({ product: { ...entry.product }, price: entry.price ? `R$ ${entry.price}` : '' }));
  const backgroundUrl = state.background.url;
  const needed = new Set([backgroundUrl, ...selected.map((entry) => entry.product.imagem_local_url)]);
  for (const url of images.keys()) if (!needed.has(url)) images.delete(url);
  try {
    if (!context) throw new Error('Este navegador não conseguiu abrir a prévia. Tente novamente no Chrome ou Edge.');
    const [background, ...loaded] = await Promise.all([loadImage(backgroundUrl), ...selected.map((entry) => loadImage(entry.product.imagem_local_url))]);
    if (state.previewVersion !== version || state.step !== 'preview') return;
    state.snapshot = { background, products: selected.map((entry, index) => ({ ...entry, image: loaded[index] })) };
    state.seconds = 0;
    selected.forEach((entry, index) => {
      const node = button('', () => {
        pause();
        state.seconds = index * INDOOR_DURATION / PRODUCT_LIMIT;
        paint();
      });
      node.setAttribute('aria-label', `Ver produto ${index + 1}: ${entry.product.nome}`);
      node.append(thumbnail(entry.product.imagem_local_url), element('span', '', `${index + 1} · ${index * 3}–${(index + 1) * 3} s`));
      ui.scenes.append(node);
    });
    paint();
    ui['preview-loading'].hidden = true;
    status('Prévia pronta. Reproduza o vídeo e baixe o MP4 quando estiver tudo certo.');
  } catch (error) {
    if (state.previewVersion !== version || state.step !== 'preview') return;
    state.snapshot = null;
    ui['preview-loading'].textContent = error.message;
    ui['retry-preview'].hidden = false;
    status(error.message, true);
  } finally {
    syncControls();
  }
}

function goTo(step) {
  if (state.exportController || !['products', 'pricing', 'background', 'preview'].includes(step)) return;
  if (step !== 'products' && !canContinue(state.selection)) return;
  if (step === 'preview' && (!state.background || state.backgroundsLoading)) return;
  pause();
  state.previewVersion += 1;
  state.step = step;
  for (const name of ['products', 'background', 'preview']) byId(`${name}-panel`).hidden = name !== (step === 'pricing' ? 'products' : step);
  byId('products-panel').classList.toggle('is-pricing', step === 'pricing');
  byId('selected-heading').textContent = step === 'pricing' ? 'Pre?os e ordem' : 'Produtos selecionados';
  ui.continue.textContent = step === 'pricing' ? 'Escolher fundo ?' : 'Pre?os e ordem ?';
  renderSelected();
  syncControls();
  const heading = byId(step === 'pricing' || (step === 'products' && mobileViewport.matches && state.productView === 'selection')
    ? 'selected-heading' : `${step}-heading`);
  heading.focus({ preventScroll: mobileViewport.matches });
  if (mobileViewport.matches) window.scrollTo({ top: 0, behavior: 'instant' });
  if (step === 'products' || step === 'pricing') selectionStatus();
  else if (step === 'background') {
    status(state.backgroundsLoaded && !state.backgrounds.length
      ? 'Aguardando a disponibilização dos fundos para TV Indoor.' : 'Escolha o fundo para sua campanha.');
    if (!state.backgroundsLoaded) void loadBackgrounds();
  } else void preparePreview();
}

async function download() {
  if (!state.snapshot || state.exportController) return;
  pause();
  clearDownload();
  const snapshot = state.snapshot;
  const controller = new AbortController();
  state.exportController = controller;
  const canvas = document.createElement('canvas');
  canvas.width = INDOOR_WIDTH;
  canvas.height = INDOOR_HEIGHT;
  ui['export-progress'].hidden = false;
  ui['export-progress'].value = 0;
  ui['cancel-export'].hidden = false;
  ui['cancel-export'].disabled = false;
  syncControls();
  status('Preparando a exportação MP4…', false, ui['export-status']);
  try {
    const { exportStoryVideo } = await import('../stories/video-export.js');
    const exportContext = canvas.getContext('2d');
    if (!exportContext) throw new Error('Não foi possível preparar o vídeo neste navegador.');
    const blob = await exportStoryVideo({
      canvas, signal: controller.signal,
      renderFrame: (seconds) => drawIndoorFrame(exportContext, snapshot, seconds),
      onProgress: (fraction) => {
        const percentage = Math.round(fraction * 100);
        ui['export-progress'].value = percentage;
        status(`Exportando vídeo: ${percentage}%`, false, ui['export-status']);
      },
    });
    if (controller.signal.aborted) return;
    state.downloadUrl = URL.createObjectURL(blob);
    ui['download-link'].href = state.downloadUrl;
    ui['download-link'].download = `stackmedia-indoor-h-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;
    ui['download-link'].hidden = false;
    ui['download-link'].click();
    status('Vídeo pronto! Se o download não começar, use Baixar vídeo novamente.', false, ui['export-status']);
  } catch (error) {
    status(error.name === 'AbortError' ? 'Exportação cancelada. Você pode tentar novamente.' : error.message,
      error.name !== 'AbortError', ui['export-status']);
  } finally {
    canvas.width = canvas.height = 0;
    state.exportController = null;
    ui['export-progress'].hidden = true;
    ui['cancel-export'].hidden = true;
    syncControls();
  }
}

for (const node of stepButtons) node.addEventListener('click', () => goTo(node.dataset.step));
for (const node of backButtons) node.addEventListener('click', () => goTo(node.dataset.go));
ui['show-catalog'].addEventListener('click', () => showProductView('catalog'));
ui['show-selection'].addEventListener('click', () => showProductView('selection'));
ui['mobile-back'].addEventListener('click', () => {
  if (state.exportController) {
    state.exportController.abort();
    ui['cancel-export'].disabled = true;
    syncMobileControls();
  } else if (state.step === 'products') {
    if (state.productView === 'selection') showProductView('catalog');
    else ui.search.focus();
  } else goTo(state.step === 'preview' ? 'background' : state.step === 'background' ? 'pricing' : 'products');
});
ui['mobile-next'].addEventListener('click', () => {
  if (state.step === 'products') {
    if (state.productView === 'catalog') showProductView('selection');
    else goTo('pricing');
  } else if (state.step === 'pricing') goTo('background');
  else if (state.step === 'background') goTo('preview');
  else void download();
});
mobileViewport.addEventListener('change', () => {
  const focused = document.activeElement;
  if (ui['selection-panel'].contains(focused)) state.productView = 'selection';
  else if (ui.catalog.contains(focused)) state.productView = 'catalog';
  syncMobileControls();
  if (!mobileViewport.matches && (ui['mobile-dock'].contains(focused) || ui['product-views'].contains(focused))) {
    byId(state.step === 'pricing' ? 'selected-heading' : `${state.step}-heading`).focus({ preventScroll: true });
  }
});
ui.continue.addEventListener('click', () => goTo(state.step === 'pricing' ? 'background' : 'pricing'));
ui['open-preview'].addEventListener('click', () => goTo('preview'));
ui['reload-backgrounds'].addEventListener('click', () => void loadBackgrounds());
ui['retry-preview'].addEventListener('click', () => void preparePreview());
ui.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  state.productRequest?.abort();
  state.productRequest = null;
  state.products = [];
  state.page = state.total = 0;
  state.hasMore = state.productError = false;
  renderResults();
  ui.results.replaceChildren(element('p', 'indoor-empty', 'Buscando produtos…'));
  ui.results.setAttribute('aria-busy', 'true');
  searchTimer = setTimeout(() => void loadProducts(), 200);
});
ui['load-more'].addEventListener('click', () => void loadProducts(state.page > 0));
ui.play.addEventListener('click', () => state.playing ? pause() : play());
ui.time.addEventListener('input', () => {
  pause();
  state.seconds = Math.min(INDOOR_DURATION - 1 / 30, Math.max(0, Number(ui.time.value) || 0));
  paint();
});
ui.download.addEventListener('click', () => void download());
ui['cancel-export'].addEventListener('click', () => {
  state.exportController?.abort();
  ui['cancel-export'].disabled = true;
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('pagehide', () => {
  pause();
  clearTimeout(searchTimer);
  state.previewVersion += 1;
  state.productRequest?.abort();
  state.productRequest = null;
  state.exportController?.abort();
  clearDownload();
});
renderSelected();
void loadProducts();
