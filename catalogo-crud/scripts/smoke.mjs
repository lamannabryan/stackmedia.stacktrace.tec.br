import { testSession } from './fixtures/auth.mjs';
import { rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApplication } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';
import { initializeCatalogDatabase } from '../src/database/catalog-database.mjs';
import { createStoryBackgroundService } from '../src/modules/stories/background-service.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

const smokeDirectory = await mkdtemp(path.join(tmpdir(), 'stackmedia-smoke-'));
const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  CATALOG_STORAGE_ROOT: smokeDirectory,
  CATALOG_DATABASE_PATH: path.join(smokeDirectory, 'catalogo.sqlite'),
  APP_AUTH_ENABLED: 'false',
});
assert.equal(
  loadConfig({ APP_AUTH_ENABLED: 'false' }).indoorBackgroundsDirectory,
  path.join(config.projectDirectory, 'camas-indoor-h'),
  'Indoor deve usar a pasta camas-indoor-h por padrão',
);
assert.equal(
  loadConfig({ APP_AUTH_ENABLED: 'false', INDOOR_BACKGROUNDS_ROOT: 'fundos/indoor' }).indoorBackgroundsDirectory,
  path.join(config.projectDirectory, 'fundos', 'indoor'),
  'Indoor deve aceitar um diretório configurado',
);
const database = await initializeCatalogDatabase(config);
const app = createApplication({ config, database, logger: { error() {} } });
const server = createServer(app);

try {
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const { fetch } = await testSession(database, baseUrl);
  const checks = [
    ['/', 200, 'text/html'],
    ['/js/features/barcode/camera.js', 200, 'text/javascript'],
    ['/js/features/barcode/decoder.js', 200, 'text/javascript'],
    ['/js/features/barcode/code.js', 200, 'text/javascript'],
    ['/js/vendor/zxing-library-0.23.0.js', 200, 'text/javascript'],
    ['/catalogo', 200, 'text/html'],
    ['/parceiros', 200, 'text/html'],
    ['/partners.css', 200, 'text/css'],
    ['/js/features/partners/admin.js', 200, 'text/javascript'],
    ['/js/features/partners/carousel.js', 200, 'text/javascript'],
    ['/api/manufacturers', 200, 'application/json'],
    ['/api/featured-partners', 200, 'application/json'],
    ['/catalogue.css', 200, 'text/css'],
    ['/tour.css', 200, 'text/css'],
    ['/artes/stories', 200, 'text/html'],
    ['/artes/stories?productId=1', 200, 'text/html'],
    ['/stories.html', 200, 'text/html'],
    ['/artes/feed', 200, 'text/html'],
    ['/artes/feed/', 200, 'text/html'],
    ['/artes/feed?productId=1', 200, 'text/html'],
    ['/feed.html', 200, 'text/html'],
    ['/feed.css', 200, 'text/css'],
    ['/artes/indoor-h', 200, 'text/html'],
    ['/artes/indoor-h/', 200, 'text/html'],
    ['/indoor-h.html', 200, 'text/html'],
    ['/indoor-h.css', 200, 'text/css'],
    ['/js/features/indoor/editor.js', 200, 'text/javascript'],
    ['/js/features/indoor/model.js', 200, 'text/javascript'],
    ['/js/features/indoor/renderer.js', 200, 'text/javascript'],
    ['/api/story-backgrounds', 200, 'application/json'],
    ['/api/feed-backgrounds', 200, 'application/json'],
    ['/api/indoor-backgrounds', 200, 'application/json'],
    ['/js/features/stories/formats.js', 200, 'text/javascript'],
    ['/stories-mobile.css', 200, 'text/css'],
    ['/api/health', 200, 'application/json'],
    ['/api/summary', 200, 'application/json'],
    ['/api/products?imagem=com&status=ativo&page=1&pageSize=2', 200, 'application/json'],
    ['/js/features/stories/editor.js', 200, 'text/javascript'],
    ['/js/features/stories/mobile-editor.js', 200, 'text/javascript'],
    ['/js/features/stories/auto-layout.js', 200, 'text/javascript'],
    ['/js/features/stories/price-input.js', 200, 'text/javascript'],
    ['/js/features/stories/video-animation.js', 200, 'text/javascript'],
    ['/js/features/stories/video-export.js', 200, 'text/javascript'],
    ['/js/vendor/mp4-muxer-5.2.2.js', 200, 'text/javascript'],
    ['/js/features/tour/index.js', 200, 'text/javascript'],
    ['/js/features/tour/steps.js', 200, 'text/javascript'],
    ['/js/features/tour/storage.js', 200, 'text/javascript'],
    ['/api/inexistente', 404, 'application/json'],
    ['/assets/arquivo-fora-do-escopo.png', 403, 'application/json'],
    ['/story-backgrounds/imagens%20originais/arquivo.png', 403, 'application/json'],
    ['/feed-backgrounds/subpasta/arquivo.png', 403, 'application/json'],
    ['/feed-backgrounds/%2e%2e%2f.env', 403, 'application/json'],
    ['/feed-backgrounds/arquivo.svg', 403, 'application/json'],
    ['/indoor-backgrounds/subpasta/arquivo.png', 403, 'application/json'],
    ['/indoor-backgrounds/%2e%2e%2f.env', 403, 'application/json'],
    ['/indoor-backgrounds/arquivo.svg', 403, 'application/json'],
  ];

  for (const [pathname, expectedStatus, expectedContentType] of checks) {
    const response = await fetch(baseUrl + pathname);
    if (pathname === '/') {
      assert.match(response.headers.get('permissions-policy'), /camera=\(self\)/);
      assert.match(response.headers.get('permissions-policy'), /microphone=\(\)/);
      assert.match(response.headers.get('content-security-policy'), /media-src 'self' blob:/);
    }
    assert.equal(response.status, expectedStatus, `${pathname} retornou ${response.status}`);
    assert.match(
      response.headers.get('content-type') || '',
      new RegExp('^' + expectedContentType.replace('/', '\\/')),
      `${pathname} retornou Content-Type inesperado`,
    );
  }

  for (const [format, directory] of [
    ['story', config.storyBackgroundsDirectory],
    ['feed', config.feedBackgroundsDirectory],
    ['indoor', config.indoorBackgroundsDirectory],
  ]) {
    const { items } = await (await fetch(`${baseUrl}/api/${format}-backgrounds`)).json();
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (format === 'indoor' && error.code === 'ENOENT') return [];
      throw error;
    });
    const files = entries.filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name)).map((entry) => entry.name);
    assert.deepEqual(items.map((item) => item.arquivo).sort(), files.sort(), `${format}: lista completa de fundos`);
    if (format !== 'indoor') assert.ok(items.length > 0);
    for (const item of items) {
      assert.ok(item.url.startsWith(`/${format}-backgrounds/`), 'Fundos dos formatos devem permanecer separados');
      const response = await fetch(baseUrl + item.url);
      assert.equal(response.status, 200, item.url);
      assert.match(response.headers.get('content-type'), /^image\//);
      assert.ok((await response.arrayBuffer()).byteLength > 0);
    }
  }

  const indoorFixtureDirectory = await mkdtemp(path.join(tmpdir(), 'vidamix-indoor-backgrounds-'));
  const fixtureFilename = 'Gabarito Oferta da Semana_indoor-h.png';
  const fixturePath = path.join(indoorFixtureDirectory, fixtureFilename);
  const tvFixtureFilename = 'GABARITO BLACK FRIDAY_DF - PREC TV.png';
  const tvFixturePath = path.join(indoorFixtureDirectory, tvFixtureFilename);
  const indoorFixtureServer = createServer(createApplication({
    config: { ...config, indoorBackgroundsDirectory: indoorFixtureDirectory },
    database,
    logger: { error() {} },
  }));
  try {
    const fixturePort = await listen(indoorFixtureServer);
    const fixtureBaseUrl = `http://127.0.0.1:${fixturePort}`;
    const emptyResponse = await fetch(fixtureBaseUrl + '/api/indoor-backgrounds');
    assert.equal(emptyResponse.status, 200);
    assert.deepEqual(await emptyResponse.json(), { items: [] }, 'Pasta vazia deve permitir abrir o editor Indoor');

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
    await writeFile(fixturePath, png);
    const populatedResponse = await fetch(fixtureBaseUrl + '/api/indoor-backgrounds');
    const { items } = await populatedResponse.json();
    assert.ok(new URL(items[0].url, fixtureBaseUrl).searchParams.get('v'), 'Background deve possuir versão de cache');
    assert.deepEqual(items.map((item) => ({ arquivo: item.arquivo, nome: item.nome, url: new URL(item.url, fixtureBaseUrl).pathname })), [{
      arquivo: fixtureFilename,
      nome: 'Oferta DA Semana',
      url: `/indoor-backgrounds/${encodeURIComponent(fixtureFilename)}`,
    }], 'Indoor deve listar nomes limpos e URLs próprias');
    const backgroundResponse = await fetch(fixtureBaseUrl + items[0].url);
    assert.equal(backgroundResponse.status, 200);
    assert.match(backgroundResponse.headers.get('content-type'), /^image\/png/);
    assert.match(backgroundResponse.headers.get('cache-control'), /max-age=31536000, immutable/);
    assert.deepEqual(Buffer.from(await backgroundResponse.arrayBuffer()), png);
    for (const format of ['story', 'feed']) {
      const otherFormatResponse = await fetch(fixtureBaseUrl + `/${format}-backgrounds/${encodeURIComponent(fixtureFilename)}`);
      assert.equal(otherFormatResponse.status, 404, `Indoor não deve expor arquivos na rota de ${format}`);
    }
    await writeFile(tvFixturePath, png);
    for (const [format, expectedLabel] of [
      ['indoor-h', 'Black Friday'],
      ['stories', 'Black Friday DF - Prec TV'],
      ['feed', 'Black Friday DF - Prec TV'],
    ]) {
      const service = createStoryBackgroundService({ storyBackgroundsDirectory: indoorFixtureDirectory, format });
      const background = (await service.listStoryBackgrounds()).find((item) => item.arquivo === tvFixtureFilename);
      assert.equal(background.nome, expectedLabel, `Sufixo técnico de TV deve ser removido apenas de Indoor: ${format}`);
    }
    await unlink(fixturePath);
    await unlink(tvFixturePath);
    await rmdir(indoorFixtureDirectory);
    const missingResponse = await fetch(fixtureBaseUrl + '/api/indoor-backgrounds');
    assert.equal(missingResponse.status, 200);
    assert.deepEqual(await missingResponse.json(), { items: [] }, 'Pasta ainda inexistente deve retornar lista vazia');
  } finally {
    await close(indoorFixtureServer);
    await unlink(fixturePath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await unlink(tvFixturePath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(indoorFixtureDirectory).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }

  const feedPage = await (await fetch(baseUrl + '/artes/feed')).text();
  const storiesPage = await (await fetch(baseUrl + '/artes/stories')).text();
  const indoorPage = await (await fetch(baseUrl + '/artes/indoor-h')).text();
  assert.match(feedPage, /data-artwork-format="feed"/);
  assert.match(feedPage, /width="1080" height="1350"/);
  assert.doesNotMatch(feedPage, /1920/, 'Feed deve mostrar as dimensões corretas também nos textos');
  assert.match(storiesPage, /width="1080" height="1920"/);
  assert.match(indoorPage, /width="1920" height="1080"/, 'Indoor deve usar resolução Full HD horizontal');
  const ids = (html) => [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(ids(feedPage), ids(storiesPage), 'Feed deve oferecer todos os controles do editor de Stories');

  const eanProductsResponse = await fetch(baseUrl + '/api/products?page=1&pageSize=100');
  const eanProducts = await eanProductsResponse.json();
  const productWithEan = eanProducts.items.find((product) => /^\d{8,14}$/.test(String(product.ean || '')));
  if (productWithEan) {
    const eanResponse = await fetch(baseUrl + `/api/products/by-ean/${encodeURIComponent(productWithEan.ean)}`);
    const eanProduct = await eanResponse.json();
    assert.equal(eanResponse.status, 200, 'Consulta de produto por EAN falhou');
    assert.equal(eanProduct.id, productWithEan.id, 'Consulta por EAN retornou produto incorreto');
  }

  const rejectedWrite = await fetch(baseUrl + '/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}',
  });
  assert.equal(rejectedWrite.status, 400, 'API aceitou conteúdo não JSON');

  const authenticatedConfig = {
    ...config,
    auth: {
      enabled: true,
      username: 'smoke-user',
      password: 'smoke-password',
      realm: 'Smoke Test',
    },
  };
  const authenticatedServer = createServer(
    createApplication({ config: authenticatedConfig, database, logger: { error() {} } }),
  );

  try {
    const authenticatedPort = await listen(authenticatedServer);
    const authenticatedBaseUrl = 'http://127.0.0.1:' + authenticatedPort;
    const deniedResponse = await fetch(authenticatedBaseUrl + '/api/health');
    assert.equal(deniedResponse.status, 401, 'Aplicação protegida aceitou acesso sem credenciais');
    assert.match(
      deniedResponse.headers.get('www-authenticate') || '',
      /^Basic /,
      'Aplicação protegida não informou desafio Basic',
    );
    for (const pathname of ['/artes/indoor-h', '/api/indoor-backgrounds', '/indoor-backgrounds/teste.png']) {
      const indoorDeniedResponse = await fetch(authenticatedBaseUrl + pathname);
      assert.equal(indoorDeniedResponse.status, 401, `Indoor deve manter autenticação em ${pathname}`);
    }

    const authorization = 'Basic ' + Buffer.from('smoke-user:smoke-password').toString('base64');
    const acceptedResponse = await fetch(authenticatedBaseUrl + '/api/health', {
      headers: { Authorization: authorization },
    });
    assert.equal(acceptedResponse.status, 200, 'Aplicação protegida rejeitou credenciais válidas');
  } finally {
    await close(authenticatedServer);
  }

  console.log(`Smoke test aprovado em ${checks.length} rotas e controles de produção.`);
} finally {
  await close(server);
  database.close();
  assert.equal(path.dirname(path.resolve(smokeDirectory)), path.resolve(tmpdir()));
  assert.ok(path.basename(smokeDirectory).startsWith('stackmedia-smoke-'));
  await rm(smokeDirectory, { recursive: true, force: true });
}
