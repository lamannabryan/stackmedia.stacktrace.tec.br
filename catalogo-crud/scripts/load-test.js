// Run with k6, not Node.js. See docs/load-testing.md.
import http from 'k6/http';
import encoding from 'k6/encoding';
import { check, fail, sleep } from 'k6';

const baseUrl = String(__ENV.BASE_URL || '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/?#@]+$/.test(baseUrl)) {
  throw new Error('Defina BASE_URL com a origem da aplicação, sem credenciais, caminho ou query string.');
}
const vus = Number(__ENV.VUS || 5);
const rampSeconds = Number(__ENV.RAMP_SECONDS || 60);
if (!Number.isInteger(vus) || vus < 1 || !Number.isInteger(rampSeconds) || rampSeconds < 1) {
  throw new Error('VUS e RAMP_SECONDS devem ser inteiros positivos.');
}
const flow = __ENV.FLOW || 'mixed';
const assetMode = __ENV.ASSET_MODE || 'cached';
if (!['mixed', 'catalogue', 'stories', 'feed'].includes(flow)
    || !['cached', 'cold'].includes(assetMode)) throw new Error('FLOW ou ASSET_MODE inválido.');
if (Boolean(__ENV.APP_USER) !== Boolean(__ENV.APP_PASSWORD)) {
  throw new Error('Informe APP_USER e APP_PASSWORD juntos, ou omita ambos se não houver autenticação.');
}
const headers = __ENV.APP_USER ? {
  Authorization: `Basic ${encoding.b64encode(`${__ENV.APP_USER}:${__ENV.APP_PASSWORD}`)}`,
} : {};

export const options = {
  discardResponseBodies: true,
  batchPerHost: 6,
  scenarios: {
    warmup: {
      executor: 'ramping-vus', startVUs: 0,
      stages: [{ duration: `${rampSeconds}s`, target: vus }],
      gracefulRampDown: '0s', gracefulStop: '0s',
    },
    steady: {
      executor: 'constant-vus', vus, duration: __ENV.DURATION || '10m',
      startTime: `${rampSeconds}s`, gracefulStop: '90s',
    },
  },
  thresholds: {
    'http_req_failed{scenario:steady}': ['rate<0.01'],
    'http_req_failed{scenario:steady,kind:api}': ['rate<0.01'],
    'checks{scenario:steady}': ['rate>0.99'],
    'checks{scenario:steady,kind:api}': ['rate>0.99'],
    'http_req_duration{scenario:steady,kind:api}': ['p(95)<800'],
    'http_req_duration{scenario:steady,kind:image}': ['p(95)<2000'],
    // Cumulative emergency stop; watch the host and use Ctrl+C for sudden degradation.
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '1m' }],
  },
};

const editorFiles = [
  '/brand.css', '/styles.css', '/stories.css', '/stories-mobile.css', '/tour.css', '/stories.js',
  ...['editor', 'constants', 'formats', 'state', 'dom', 'auto-layout', 'price-input', 'mobile-editor', 'video-animation']
    .map((name) => `/js/features/stories/${name}.js`),
  ...['index', 'steps', 'storage'].map((name) => `/js/features/tour/${name}.js`),
];
const catalogueFiles = ['/brand.css', '/styles.css', '/catalogue.css', '/catalogue-stories-link.css', '/tour.css', '/app.js'];
// Per-VU approximation of the image cache, not a full browser cache.
const imageCache = new Set();
let videoModulesLoaded = false;

function parameters(name, kind, json = false) {
  return { headers, timeout: '15s', redirects: 0, responseType: json ? 'text' : 'none', tags: { name, kind } };
}

function getJson(path, name) {
  const response = http.get(baseUrl + path, parameters(name, 'api', true));
  let data = null;
  try { data = response.json(); } catch { /* A proxy error or login page is a failed API response. */ }
  const valid = check(response, {
    'API retorna 200 e JSON': (result) => result.status === 200 && data !== null && typeof data === 'object',
  }, { kind: 'api' });
  return valid ? data : null;
}

function listProducts(query = '', pageSize = 18, page = 1) {
  const data = getJson(`/api/products?imagem=com&status=ativo&page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(query)}`, 'products-list');
  if (!check(data, { 'Catálogo retorna produtos e paginação': (value) => Array.isArray(value?.items) && Boolean(value?.pagination) })) return null;
  return data;
}

function getPage(path, name, files) {
  const response = http.get(baseUrl + path, parameters(name, 'page', true));
  if (!check(response, { 'Página contém a aplicação': (result) => result.status === 200 && result.body.includes('<!doctype html>') })) return false;
  const responses = http.batch(files.map((file) => ({ method: 'GET', url: baseUrl + file, params: parameters(file, 'static') })));
  responses.forEach((result) => check(result, { 'Recurso estático retorna 200': (value) => value.status === 200 }));
  return true;
}

function images(paths) {
  const pending = [...new Set(paths.filter(Boolean))].filter((path) => {
    // Only the application's image routes may receive its Authorization header.
    if (!/^\/(assets|story-backgrounds|feed-backgrounds)\//.test(path)) {
      check(false, { 'Imagem pertence à aplicação': (value) => value });
      return false;
    }
    return assetMode === 'cold' || !imageCache.has(path);
  });
  if (!pending.length) return;
  const responses = http.batch(pending.map((path) => ({
    method: 'GET', url: baseUrl + path, params: parameters('image', 'image'),
  })));
  responses.forEach((response, index) => {
    const ok = check(response, { 'Imagem retorna conteúdo de imagem': (result) => result.status === 200 && /^image\//i.test(result.headers['Content-Type'] || '') });
    if (ok) imageCache.add(pending[index]);
  });
}

function productImages(products, count) {
  images(products.slice(0, count).map((product) => product.imagem_local_url));
}

function pause(min, max) { sleep(min + Math.random() * (max - min)); }
function sample(items) { return items[Math.floor(Math.random() * items.length)]; }

export function setup() {
  const health = getJson('/api/health', 'health');
  if (health?.status !== 'ok') fail('Falha na conexão ou autenticação. Confira BASE_URL e credenciais.');
  const products = listProducts('', 100);
  if (!products?.items.length) fail('O teste precisa de produtos ativos com imagens.');
  for (const format of ['story', 'feed']) {
    const backgrounds = getJson(`/api/${format}-backgrounds`, `${format}-backgrounds`);
    if (!backgrounds?.items?.length) fail(`Nenhum fundo disponível em ${format}.`);
  }
  const terms = [...new Set(products.items.map((product) => product.nome.split(/\s+/).find((word) => word.length >= 3)).filter(Boolean))];
  if (!terms.length) fail('Não foi possível obter termos de busca do catálogo.');
  return { terms };
}

export default function (data) {
  // 25% catalogue, 37.5% Stories, 37.5% Feed. Set FLOW to isolate one workflow.
  const choice = Math.random();
  const current = flow === 'mixed' ? (choice < 0.25 ? 'catalogue' : choice < 0.625 ? 'stories' : 'feed') : flow;
  if (current === 'catalogue') {
    if (!getPage('/catalogo', 'catalogue', catalogueFiles)) { sleep(2); return; }
    getJson('/api/categories', 'categories');
    const initial = listProducts('', 48);
    if (!initial) { sleep(2); return; }
    productImages(initial.items, 12);
    pause(3, 6);
    const search = listProducts(sample(data.terms), 48);
    if (search) productImages(search.items, 12);
    pause(3, 6);
    if (initial.pagination.totalPages > 1) {
      const page = 2 + Math.floor(Math.random() * (initial.pagination.totalPages - 1));
      const more = listProducts('', 48, page);
      if (more) productImages(more.items, 12);
    }
    pause(8, 15);
    return;
  }

  if (!getPage(`/artes/${current}`, current, current === 'feed' ? [...editorFiles, '/feed.css'] : editorFiles)) { sleep(2); return; }
  const backgrounds = getJson(`/api/${current === 'feed' ? 'feed' : 'story'}-backgrounds`, `${current}-backgrounds`);
  const initial = listProducts();
  if (!initial || !backgrounds?.items?.length) {
    check(false, { 'Editor recebe fundos e produtos': (value) => value });
    sleep(2);
    return;
  }
  images([...backgrounds.items.slice(0, 6), sample(backgrounds.items)].map((background) => background.url));
  productImages(initial.items, 8);
  pause(2, 5);
  const search = listProducts(sample(data.terms));
  if (search) productImages(search.items, 8);
  const selected = search?.items.length ? sample(search.items) : sample(initial.items);
  if (selected) {
    getJson(`/api/products/${selected.id}`, 'product-detail');
    images([selected.imagem_local_url]);
  }
  pause(3, 7);
  // A second selection represents a two-product composition or combo.
  if (Math.random() < 0.5) {
    const second = listProducts(sample(data.terms));
    if (second) productImages(second.items, 8);
  }
  // Editing and PNG/MP4 encoding run on the user's device, without an export API.
  pause(30, 60);
  if (!videoModulesLoaded || assetMode === 'cold') {
    const results = http.batch(['/js/features/stories/video-export.js', '/js/vendor/mp4-muxer-5.2.2.js'].map((file) => ({
      method: 'GET', url: baseUrl + file,
      params: parameters('video-module', 'static'),
    })));
    videoModulesLoaded = results.every((response) => check(response, { 'Módulo de exportação retorna 200': (result) => result.status === 200 }));
  }
  pause(5, 10);
}
