import { DatabaseSync } from 'node:sqlite';
import { testSession } from './fixtures/auth.mjs';
const databases = [];
const clients = new Map();
function fetch(input, options = {}) {
  const client = clients.get(new URL(typeof input === 'string' ? input : input.url || input.href).origin);
  return client && (!client.authorization || new Headers(options.headers).has('Authorization')) ? client.fetch(input, options) : globalThis.fetch(input, options);
}
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { before, after, test } from 'node:test';
import vm from 'node:vm';
import { createApplication } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';
import { checkPwaDeployment } from './pwa-deployment-check.mjs';

const config = loadConfig({ APP_AUTH_ENABLED: 'false' });
const workerSource = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const clientSource = await readFile(new URL('../public/js/pwa.js', import.meta.url), 'utf8');
const servers = [];
let origin;

async function startServer(appConfig, simulateApache = false) {
  const database = new DatabaseSync(':memory:'); databases.push(database);
  const app = createApplication({ config: appConfig, database });
  const server = createServer((request, response) => {
    // Plesk/Apache can own /icons/ and serve unknown extensions without a MIME type.
    if (simulateApache && request.url.startsWith('/icons/')) {
      response.writeHead(404, { 'Content-Type': 'text/html' });
      response.end('<h1>Not Found</h1>');
      return;
    }
    if (simulateApache && request.url.startsWith('/manifest.webmanifest')) {
      response.writeHead(200);
      response.end('{"display":"standalone"}');
      return;
    }
    app(request, response);
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const authorization = appConfig.auth.enabled ? 'Basic ' + Buffer.from(`${appConfig.auth.username}:${appConfig.auth.password}`).toString('base64') : null;
  clients.set(url, { ...await testSession(database, url, { authorization }), authorization });
  return url;
}
before(async () => { origin = await startServer(config); });
after(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  })));
  databases.forEach((database) => database.close());
});

test('production requires user sessions without requiring legacy Basic credentials', async () => {
  const production = loadConfig({ NODE_ENV: 'production' });
  assert.equal(production.auth.enabled, false);
  const publicOrigin = await startServer(production);
  assert.equal((await globalThis.fetch(publicOrigin + '/', { redirect: 'manual' })).status, 302);
  assert.equal((await globalThis.fetch(publicOrigin + '/api/products')).status, 401);
  assert.equal((await globalThis.fetch(publicOrigin + '/login')).status, 200);
  for (const route of ['/', '/catalogo', '/artes/stories', '/artes/feed', '/artes/indoor-h', '/api/health', '/sw.js']) {
    const response = await fetch(publicOrigin + route);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get('www-authenticate'), null, route);
  }
  assert.equal(loadConfig({ NODE_ENV: 'production', APP_AUTH_ENABLED: 'false',
    APP_AUTH_USERNAME: 'old-user', APP_AUTH_PASSWORD: 'old-password' }).auth.enabled, false);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', APP_AUTH_ENABLED: 'true' }), /APP_AUTH_USERNAME/);
});

test('todas as entradas oferecem o manifesto e a marca; ícones têm dimensões reais', async () => {
  for (const route of ['/', '/catalogo', '/artes/stories', '/artes/feed', '/artes/indoor-h',
    '/index.html', '/catalogo.html', '/stories.html', '/feed.html', '/indoor-h.html']) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert.match(html, /rel="manifest" href="\/manifest.json\?v=3"/);
    assert.match(html, /src="\/js\/pwa.js" defer/);
    assert.match(html, /<header[\s\S]*src="\/branding\/stackmedia-wordmark.svg"[\s\S]*?<\/header>/);
    assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon.png\?v=3"/);
    assert.doesNotMatch(html, /(?:href|src)="\/icons\//);
  }
  const response = await fetch(origin + '/manifest.json?v=3');
  assert.match(response.headers.get('content-type'), /^application\/json/);
  const manifest = await response.json();
  assert.deepEqual(await (await fetch(origin + '/manifest.webmanifest')).json(), manifest, 'Manifesto antigo mantém os ícones atuais');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.id, '/');
  for (const icon of [...manifest.icons,
    { src: '/apple-touch-icon.png?v=3', sizes: '180x180' },
    { src: '/apple-touch-icon-precomposed.png', sizes: '180x180' },
  ]) {
    assert.ok(!icon.src.startsWith('/icons/'));
    const iconResponse = await fetch(origin + icon.src);
    assert.equal(iconResponse.status, 200);
    assert.equal(iconResponse.headers.get('content-type'), 'image/png');
    const png = Buffer.from(await iconResponse.arrayBuffer());
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
  const workerResponse = await fetch(origin + '/sw.js');
  assert.equal(workerResponse.status, 200);
  assert.match(workerResponse.headers.get('content-type'), /^text\/javascript/);
  assert.equal(workerResponse.headers.get('cache-control'), 'no-store');
});

test('metadados e ícones aceitam GET/HEAD sem senha; páginas e API continuam protegidas', async () => {
  const protectedOrigin = await startServer({ ...config,
    auth: { enabled: true, username: 'pwa-test', password: 'test-only', realm: 'PWA' },
  });
  const headers = { Authorization: `Basic ${Buffer.from('pwa-test:test-only').toString('base64')}` };
  for (const route of ['/', '/catalogo', '/artes/stories', '/api/health', '/sw.js', '/offline.html', '/js/pwa.js']) {
    assert.equal((await fetch(protectedOrigin + route)).status, 401, route);
    assert.equal((await fetch(protectedOrigin + route, { headers })).status, 200, route);
  }
  for (const route of ['/manifest.json?v=3', '/manifest.webmanifest', '/apple-touch-icon.png?v=3',
    '/apple-touch-icon-precomposed.png', '/pwa-icons/icon-192.png', '/pwa-icons/icon-512.png',
    '/pwa-icons/icon-maskable-512.png', '/pwa-icons/apple-touch-icon.png']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(protectedOrigin + route, { method });
      assert.equal(response.status, 200, `${method} ${route}`);
      assert.equal(response.headers.get('www-authenticate'), null);
      assert.ok(Number(response.headers.get('content-length')) > 0);
      if (method === 'HEAD') assert.equal(await response.text(), '');
    }
    assert.equal((await fetch(protectedOrigin + route, { method: 'POST' })).status, 401);
  }
  for (const route of ['/pwa-icons/private.json', '/pwa-icons/%2e%2e%2findex.html', '/manifest.json/extra']) {
    assert.equal((await fetch(protectedOrigin + route)).status, route.includes('%2e') ? 403 : 401, route);
  }
  const report = await checkPwaDeployment(protectedOrigin);
  assert.deepEqual(report.issues, []);
  assert.equal(report.warnings.length, 1);
});

test('instalação independe do alias /icons/ e do MIME de .webmanifest no proxy', async () => {
  const proxyOrigin = await startServer(config, true);
  const report = await checkPwaDeployment(proxyOrigin);
  assert.deepEqual(report.issues, []);
  assert.ok(report.checked.includes('/manifest.json?v=3'));
  assert.ok(report.checked.includes('/apple-touch-icon.png?v=3'));
  assert.ok(report.checked.every((url) => !url.startsWith('/icons/') && !url.endsWith('.webmanifest')));
});

function workerHarness({ preload = true } = {}) {
  const handlers = new Map();
  const stores = new Map([['another-app-cache', new Map()], ['vidamix-offline-old', new Map()]]);
  const state = { fetch: (request) => fetch(request), claimed: false, stores, preloadEnabled: false };
  const key = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        addAll: async (requests) => {
          for (const request of requests) {
            assert.equal(request.credentials, 'same-origin');
            const response = await state.fetch(request);
            assert.ok(response.ok, `Precache indisponível: ${request.url}`);
            store.set(key(request), response);
          }
        },
        match: async (request) => store.get(key(request))?.clone(),
        keys: async () => [...store.keys()].map((url) => ({ url })),
        put: async (request, response) => { store.set(key(request), response); },
        delete: async (request) => store.delete(key(request)),
      };
    },
  };
  vm.runInNewContext(workerSource, {
    URL, Response, caches,
    Request: class extends Request {
      constructor(url, options) { super(new URL(url, origin), options); }
    },
    fetch: (request) => state.fetch(request),
    self: {
      location: { origin },
      registration: { ...(preload ? { navigationPreload: { enable: async () => { state.preloadEnabled = true; } } } : {}) },
      addEventListener: (type, handler) => handlers.set(type, handler),
      clients: { claim: async () => { state.claimed = true; } },
    },
  });
  state.lifecycle = async (type) => {
    let work;
    handlers.get(type)({ waitUntil: (promise) => { work = promise; } });
    await work;
  };
  state.request = (pathname, { preloadResponse, ...options } = {}) => {
    let response = null;
    handlers.get('fetch')({
      request: { url: new URL(pathname, origin).href, method: 'GET', mode: 'navigate', ...options },
      preloadResponse,
      respondWith: (promise) => { response = promise; },
    });
    return response;
  };
  return state;
}

test('service worker instala recursos existentes e oferece fallback offline nas rotas e aliases', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  await worker.lifecycle('activate');
  assert.ok(worker.claimed);
  assert.ok(worker.stores.has('another-app-cache'));
  assert.ok(!worker.stores.has('vidamix-offline-old'));
  worker.fetch = async () => { throw new TypeError('offline'); };
  for (const pathname of ['/', '/catalogo', '/artes/feed?productId=42', '/artes/stories/', '/artes/indoor-h', '/feed.html']) {
    const response = await worker.request(pathname);
    assert.match(await response.text(), /Vamos reconectar/);
  }
  for (const pathname of ['/brand.css', '/pwa.css', '/branding/stackmedia-wordmark.svg', '/js/pwa.js']) {
    assert.equal((await worker.request(pathname, { mode: 'cors' })).status, 200);
  }
});

test('navigation preload reuses the document request including auth failures without a second fetch', async () => {
  const worker = workerHarness();
  await worker.lifecycle('activate');
  assert.equal(worker.preloadEnabled, true);
  let requests = 0;
  worker.fetch = async () => { requests++; return new Response('fallback'); };
  for (const status of [200, 401, 403, 500]) {
    const response = await worker.request('/', { preloadResponse: Promise.resolve(new Response('preloaded', { status })) });
    assert.equal(response.status, status);
    assert.equal(await response.text(), 'preloaded');
  }
  assert.equal(requests, 0);
  for (const pathname of ['/login', '/usuarios', '/revistas', '/backgrounds', '/import-produtos']) {
    const response = await worker.request(pathname, { preloadResponse: Promise.resolve(new Response('preloaded page')) });
    assert.equal(await response.text(), 'preloaded page');
  }
  assert.equal(requests, 0);
  assert.equal(await (await worker.request('/', { preloadResponse: Promise.reject(new Error('preload unavailable')) })).text(), 'fallback');
  assert.equal(requests, 1);
  const unsupported = workerHarness({ preload: false });
  await unsupported.lifecycle('activate');
  assert.equal(unsupported.claimed, true);
  assert.equal(unsupported.preloadEnabled, false);
});

test('worker mantém respostas online e erros de autenticação; não intercepta APIs, gravações ou imagens de produtos', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  for (const status of [200, 401, 403, 500]) {
    worker.fetch = async () => new Response(`server-${status}`, { status });
    const response = await worker.request('/catalogo');
    assert.equal(response.status, status);
    assert.equal(await response.text(), `server-${status}`);
  }
  for (const path of ['/api/products', '/assets/imagens/product.png', '/story-backgrounds/a.png', 'https://example.com/']) {
    assert.equal(worker.request(path), null);
  }
  assert.equal(worker.request('/catalogo', { method: 'POST' }), null);
  for (const cache of worker.stores.values()) assert.ok(!cache.has(origin + '/catalogo'));
});

test('versioned images persist across navigation, coalesce downloads and fetch only new versions', async () => {
  const worker = workerHarness();
  let downloads = 0;
  worker.fetch = async () => {
    downloads++;
    return new Response(`image-${downloads}`, { headers: {
      'Content-Type': 'image/webp', 'Content-Length': '7',
      'Cache-Control': 'private, max-age=31536000, immutable',
    } });
  };
  const request = (path) => worker.request(path, { mode: 'cors' });
  const url = '/story-backgrounds/a.webp?v=1';
  const pair = await Promise.all([request(url), request(url)]);
  assert.equal(downloads, 1);
  assert.equal(await pair[0].text(), await pair[1].text());
  await request(url);
  assert.equal(downloads, 1);
  await request('/story-backgrounds/b.webp?v=1');
  await request(url);
  assert.equal(downloads, 2, 'adding a background preserves the existing download');
  await request('/story-backgrounds/a.webp?v=3');
  assert.equal(downloads, 3);
  const cache = worker.stores.get('vidamix-images-v1');
  assert.ok(!cache.has(origin + url), 'obsolete version is evicted');
  await request('/assets/imagens/product.webp?v=1');
  worker.fetch = async () => { throw new Error('offline'); };
  assert.equal((await request('/assets/imagens/product.webp?v=1')).status, 200);
  await worker.lifecycle('activate');
  assert.ok(worker.stores.has('vidamix-images-v1'), 'shell updates preserve images');
});

test('background thumbnail and render variants coexist in persistent cache', async () => {
  const worker = workerHarness();
  let downloads = 0;
  worker.fetch = async () => {
    downloads++;
    return new Response('image', { headers: { 'Content-Type': 'image/webp',
      'Content-Length': '5', 'Cache-Control': 'private, max-age=31536000, immutable' } });
  };
  const request = (variant, version = 1) => worker.request(`/story-backgrounds/a.webp?v=${version}&variant=${variant}`, { mode: 'cors' });
  await request('thumb-v1');
  await request('render-v1');
  await request('thumb-v1');
  await request('render-v1');
  assert.equal(downloads, 2);
  assert.equal(worker.stores.get('vidamix-images-v1').size, 2);
  await request('thumb-v1', 2);
  await request('render-v1');
  assert.equal(downloads, 3);
  assert.equal(worker.stores.get('vidamix-images-v1').size, 2);
});

test('image cache rejects errors and unversioned responses, bounds storage and tolerates write failures', async () => {
  const worker = workerHarness();
  let downloads = 0;
  let status = 401;
  worker.fetch = async () => {
    downloads++;
    return new Response('image', { status, headers: {
      'Content-Type': 'image/webp', 'Content-Length': String(12 * 1024 * 1024),
      'Cache-Control': 'private, max-age=31536000, immutable',
    } });
  };
  const request = (path) => worker.request(path, { mode: 'cors' });
  const url = '/feed-backgrounds/a.webp?v=1';
  for (status of [401, 403, 404, 500]) {
    assert.equal((await request(url)).status, status);
    assert.equal((await request(url)).status, status);
  }
  assert.equal(downloads, 8);
  status = 200;
  for (let i = 0; i < 10; i++) await request(`/indoor-backgrounds/${i}.webp?v=1`);
  assert.equal(worker.stores.get('vidamix-images-v1').size, 8, '96 MiB limit');
  worker.stores.get('vidamix-images-v1').set = () => { throw new Error('quota'); };
  assert.equal((await request(url)).status, 200, 'storage failure does not break an image');
  assert.equal(worker.request('/story-backgrounds/a.webp'), null);
});

function clientHarness({ apple = false, standalone = false, secure = true } = {}) {
  const eventHost = () => {
    const listeners = new Map();
    return {
      addEventListener: (name, listener) => listeners.set(name, listener),
      dispatch: async (name, event = {}) => listeners.get(name)?.(event),
    };
  };
  const button = { ...eventHost(), hidden: true, disabled: false };
  const help = { hidden: true, textContent: '' };
  const media = { ...eventHost(), matches: standalone };
  const registrations = [];
  const window = { ...eventHost(), matchMedia: () => media, isSecureContext: secure };
  vm.runInNewContext(clientSource, {
    window, console: { warn() {} },
    navigator: {
      userAgent: apple ? 'iPhone' : 'Chrome',
      serviceWorker: { register: async (...args) => { registrations.push(args); } },
    },
    document: {
      readyState: 'complete',
      querySelector: (selector) => ({ '[data-pwa-install]': button, '[data-pwa-help]': help })[selector],
    },
  });
  return { window, button, help, media, registrations };
}

test('instalação só oferece prompt disponível, trata recusa e oculta o botão quando instalado', async () => {
  const client = clientHarness();
  assert.equal(client.button.hidden, true);
  assert.equal(client.registrations[0][0], '/sw.js');
  let prompts = 0;
  const event = (outcome) => ({
    preventDefault() {},
    prompt: async () => { prompts++; },
    userChoice: Promise.resolve({ outcome }),
  });
  await client.window.dispatch('beforeinstallprompt', event('dismissed'));
  assert.equal(client.button.hidden, false);
  await client.button.dispatch('click');
  assert.equal(prompts, 1);
  assert.equal(client.button.hidden, true);
  await client.window.dispatch('beforeinstallprompt', event('accepted'));
  await client.button.dispatch('click');
  assert.equal(prompts, 2);
  assert.equal(client.button.hidden, true);
  assert.equal(client.button.disabled, false);
});

test('iOS recebe instruções e standalone/HTTP inseguro não oferece instalação', async () => {
  const apple = clientHarness({ apple: true });
  assert.equal(apple.button.hidden, false);
  await apple.button.dispatch('click');
  assert.equal(apple.help.hidden, false);
  assert.match(apple.help.textContent, /Adicionar à Tela de Início/);
  await apple.window.dispatch('appinstalled');
  assert.equal(apple.button.hidden, true);
  assert.equal(apple.help.hidden, true);
  assert.equal(clientHarness({ apple: true, standalone: true }).button.hidden, true);
  const insecure = clientHarness({ secure: false, apple: true });
  assert.equal(insecure.button.hidden, true);
  assert.equal(insecure.registrations.length, 0);
});
