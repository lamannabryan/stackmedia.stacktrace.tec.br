import { HttpError } from './http/errors.mjs';
import path from 'node:path';
import { backgroundVariant } from './modules/stories/background-variants.mjs';
import { isRequestAuthorized, sendUnauthorized } from './http/auth.mjs';
import { defaultSecurityHeaders, sendError, sendJson, readJsonBody } from './http/response.mjs';
import { createUserService } from './modules/users/user-service.mjs';
import { createSessionService, requireAdmin, requireSuperAdmin, validateMutation } from './modules/users/session-service.mjs';
import { serveFile } from './http/static-files.mjs';
import { createProductService } from './modules/products/product-service.mjs';
import { createProductImportService } from './modules/products/product-import-service.mjs';
import { createPartnerService } from './modules/partners/partner-service.mjs';
import { createMagazineService } from './modules/magazines/magazine-service.mjs';
import { productImageUrl, resolveProductImage } from './modules/products/product-images.mjs';
import {
  createStoryBackgroundService,
  isSupportedStoryBackground,
} from './modules/stories/background-service.mjs';
import { createApiRouter } from './routes/api-routes.mjs';
import { resolvePageRoute } from './routes/page-routes.mjs';

// Installation metadata contains no application data. Home Screen icon fetches
// must work without the browser's HTTP Basic session, including HEAD requests.
const publicPwaFiles = new Set([
  '/manifest.json',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png',
  '/pwa-icons/apple-touch-icon.png',
  '/pwa-icons/icon-192.png',
  '/pwa-icons/icon-512.png',
  '/pwa-icons/icon-maskable-512.png',
]);

const publicPresentationFiles = new Set([
  '/apresentacao.css',
  '/apresentacao.js',
  '/apresentacao-tema.js',
  '/apresentacao-imagens/desktop-central.webp',
  '/apresentacao-imagens/desktop-catalogo.webp',
  '/apresentacao-imagens/desktop-stories.webp',
  '/apresentacao-imagens/desktop-feed.webp',
  '/apresentacao-imagens/desktop-tv.webp',
  '/apresentacao-imagens/mobile-central.webp',
  '/apresentacao-imagens/mobile-catalogo.webp',
  '/apresentacao-imagens/mobile-stories.webp',
  '/branding/stackmedia-icon.svg',
  '/branding/stackmedia-wordmark.svg',
  '/branding/stackmedia-wordmark-dark.svg',
  '/fonts/archivo-black-latin-400-normal.woff2',
  '/fonts/space-grotesk-latin-400-normal.woff2',
  '/fonts/space-grotesk-latin-500-normal.woff2',
  '/fonts/space-grotesk-latin-600-normal.woff2',
  '/fonts/space-grotesk-latin-700-normal.woff2',
]);

function isSafeStaticMethod(method) {
  return method === 'GET' || method === 'HEAD';
}

function requestUrl(request) {
  // Only the pathname and query string are needed by this local application.
  // Avoid using a client-controlled Host header as the base URL.
  const target = request.url || '/';
  if (!target.startsWith('/')) throw new HttpError(400, 'Endereço inválido.');
  return new URL(`http://localhost${target}`);
}

export function createApplication({ config, database, logger = console, integrationFetch = fetch, productImageDownload }) {
  const userService = createUserService({ database });
  const sessionService = createSessionService({ database, config });
  const productService = createProductService({ database, imagesDirectory: config.imagesDirectory });
  const productImportService = createProductImportService({ database, productService });
  const logosDirectory = path.join(config.storageDirectory, 'partner-logos');
  const partnerService = createPartnerService({ database, logosDirectory });
  const magazineService = createMagazineService({ database, productService });
  const storyBackgroundService = createStoryBackgroundService({
    storyBackgroundsDirectory: config.storyBackgroundsDirectory,
  });
  const feedBackgroundService = createStoryBackgroundService({
    storyBackgroundsDirectory: config.feedBackgroundsDirectory,
    format: 'feed',
    urlPrefix: '/feed-backgrounds',
  });
  const encarteBackgroundService = createStoryBackgroundService({
    storyBackgroundsDirectory: config.encarteBackgroundsDirectory,
    format: 'encarte',
    urlPrefix: '/encarte-backgrounds',
  });
  const indoorBackgroundService = createStoryBackgroundService({
    storyBackgroundsDirectory: config.indoorBackgroundsDirectory,
    format: 'indoor-h',
    urlPrefix: '/indoor-backgrounds',
  });
  const apiRouter = createApiRouter({
    productService, productImportService, partnerService, magazineService, config, storyBackgroundService, feedBackgroundService, encarteBackgroundService, indoorBackgroundService,
    database, userService, sessionService, integrationFetch, productImageDownload,
  });
  const backgroundRoutes = [
    ['/story-backgrounds/', config.storyBackgroundsDirectory, 'stories'],
    ['/feed-backgrounds/', config.feedBackgroundsDirectory, 'feed'],
    ['/encarte-backgrounds/', config.encarteBackgroundsDirectory, 'encarte'],
    ['/indoor-backgrounds/', config.indoorBackgroundsDirectory, 'indoor-h'],
  ];

  return async function requestHandler(request, response) {
    try {
      const url = requestUrl(request);
      let decodedPath;
      try { decodedPath = decodeURIComponent(url.pathname); } catch { throw new HttpError(403, 'Endereço inválido.'); }
      // Canonicalize before authorization, including file aliases on Windows.
      if (/[\\%\x00-\x1f:]/.test(decodedPath) || decodedPath.split('/').some((part) => /[ .]$/.test(part))) {
        throw new HttpError(403, 'Caminho não permitido.');
      }
      const pathname = '/' + decodedPath.split('/').filter(Boolean).join('/');
      url.pathname = pathname;
      if (publicPwaFiles.has(url.pathname) && isSafeStaticMethod(request.method)) {
        await serveFile({
          request,
          response,
          rootDirectory: config.publicDirectory,
          urlPath: url.pathname.slice(1),
          cacheControl: 'public, max-age=0, must-revalidate',
        });
        return;
      }

      // The product presentation and its local assets are public so prospective
      // customers can read it even when application sign-in protection is enabled.
      const presentationFile = url.pathname === '/apresentacao'
        ? 'apresentacao.html'
        : publicPresentationFiles.has(url.pathname) ? url.pathname.slice(1) : null;
      if (presentationFile && isSafeStaticMethod(request.method)) {
        await serveFile({
          request,
          response,
          rootDirectory: config.publicDirectory,
          urlPath: presentationFile,
          cacheControl: 'public, max-age=0, must-revalidate',
        });
        return;
      }

      if (!isRequestAuthorized(request, config.auth)) {
        sendUnauthorized(response, config.auth);
        return;
      }

      const loginPage = ['/login', '/login.html'].includes(pathname);
      const publicResource = publicPwaFiles.has(pathname) || pathname === '/offline.html'
        || /^\/[a-z0-9-]+\.(css|js)$/.test(pathname)
        || /^\/(js|fonts|branding)\/[a-zA-Z0-9_./-]+\.(js|woff2|svg)$/.test(pathname);
      if (isSafeStaticMethod(request.method) && (loginPage || publicResource)) {
        await serveFile({ request, response, rootDirectory: config.publicDirectory,
          urlPath: loginPage ? 'login.html' : pathname.slice(1),
          // Reuse unchanged assets on every screen, while checking each deployment.
          // HTML and the worker itself must always come from the server.
          cacheControl: loginPage || pathname === '/offline.html' || pathname === '/sw.js'
            ? 'no-store' : 'private, no-cache' });
        return;
      }
      if (pathname === '/api/health' && request.method === 'GET') {
        sendJson(response, 200, { status: 'ok' });
        return;
      }
      if (pathname === '/api/auth/login' && request.method === 'POST') {
        validateMutation(request, null, { login: true, production: config.environment === 'production' });
        const result = await sessionService.login(request, await readJsonBody(request, { maxBytes: 4096 }));
        response.setHeader('Set-Cookie', result.cookie);
        sendJson(response, 200, { user: result.user, csrfToken: result.csrfToken });
        return;
      }
      const session = sessionService.current(request);
      if (!session) {
        if (pathname.startsWith('/api/') || !isSafeStaticMethod(request.method)) {
          sendError(response, 401, 'Faça login para continuar.');
        } else {
          response.writeHead(302, { ...defaultSecurityHeaders, 'Cache-Control': 'no-store',
            Location: `/login?next=${encodeURIComponent(pathname + url.search)}` });
          response.end();
        }
        return;
      }
      if (['/superadmin', '/superadmin.html'].includes(pathname.toLowerCase())) requireSuperAdmin(session);
      if (['/parceiros', '/parceiros.html', '/usuarios', '/usuarios.html', '/backgrounds', '/backgrounds.html', '/revistas', '/revistas.html', '/import-produtos', '/import-produtos.html'].includes(pathname.toLowerCase())
        || pathname.toLowerCase().startsWith('/api/users')) requireAdmin(session);
      if (!isSafeStaticMethod(request.method)) {
        const isProductCreation = request.method === 'POST' && pathname === '/api/products';
        const isProductLookup = request.method === 'POST' && pathname === '/api/products/lookup-ean';
        const isArtworkGeneration = request.method === 'POST' && pathname === '/api/artworks/generations';
        if (pathname !== '/api/auth/logout' && !isProductCreation && !isProductLookup && !isArtworkGeneration) requireAdmin(session);
        validateMutation(request, session, { production: config.environment === 'production' });
      }
      if (url.pathname.startsWith('/api/')) {
        const handled = await apiRouter.dispatch({ request, response, url, session });
        if (!handled) sendError(response, 404, 'Endpoint não encontrado.');
        return;
      }

      if (!isSafeStaticMethod(request.method)) {
        sendError(response, 405, 'Método não permitido.');
        return;
      }

      if (url.pathname.startsWith('/partner-logos/')) {
        const filename = url.pathname.slice('/partner-logos/'.length);
        if (!/^[\da-f-]{36}\.webp$/.test(filename)) {
          sendError(response, 404, 'Logotipo não encontrado.');
          return;
        }
        await serveFile({ request, response, rootDirectory: logosDirectory, urlPath: filename,
          cacheControl: 'private, max-age=31536000, immutable' });
        return;
      }

      if (url.pathname.startsWith('/assets/')) {
        const assetPath = url.pathname.slice('/assets/'.length);
        if (!assetPath.startsWith('imagens/')) {
          sendError(response, 403, 'Caminho de imagem não permitido.');
          return;
        }
        let decodedPath;
        try { decodedPath = decodeURIComponent(assetPath); } catch { decodedPath = null; }
        const imageFile = resolveProductImage(config.imagesDirectory, decodedPath);
        if (!imageFile) {
          sendError(response, 403, 'Caminho de imagem não permitido.');
          return;
        }
        if (imageFile !== decodedPath) {
          // Existing tabs and saved PNG URLs continue working after conversion.
          // Do not cache the alias: files may still be uploaded or rolled back.
          response.writeHead(302, {
            ...defaultSecurityHeaders,
            Location: productImageUrl(imageFile) + url.search,
            'Cache-Control': 'no-store',
            'Content-Length': 0,
          });
          response.end();
          return;
        }
        await serveFile({
          request,
          response,
          rootDirectory: config.imagesDirectory,
          urlPath: assetPath,
          cacheControl: 'private, no-cache',
          versioned: true,
        });
        return;
      }

      const backgroundRoute = backgroundRoutes.find(([prefix]) => url.pathname.startsWith(prefix));
      if (backgroundRoute) {
        const [prefix, rootDirectory, format] = backgroundRoute;
        const backgroundPath = url.pathname.slice(prefix.length);
        if (!isSupportedStoryBackground(backgroundPath)) {
          sendError(response, 403, 'Formato de background não permitido.');
          return;
        }
        const variant = url.searchParams.get('variant');
        const file = variant ? await backgroundVariant({
          rootDirectory, urlPath: backgroundPath, variant, format,
          cacheDirectory: path.join(config.storageDirectory, 'background-cache'),
        }) : { rootDirectory, urlPath: backgroundPath };
        await serveFile({
          request,
          response,
          ...file,
          cacheControl: 'private, no-cache',
          versioned: true,
        });
        return;
      }

      const pageFile = resolvePageRoute(url.pathname);
      const requestedFile = pageFile || url.pathname.slice(1);
      await serveFile({
        request,
        response,
        rootDirectory: config.publicDirectory,
        urlPath: requestedFile,
      });
    } catch (error) {
      if (!(error instanceof HttpError)) logger.error(error);
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const message = error instanceof HttpError && error.expose
        ? error.message
        : 'Erro interno do servidor.';

      if (!response.headersSent) sendError(response, statusCode, message, {
        code: error instanceof HttpError && error.expose ? error.code : undefined,
      });
      else response.destroy();
    }
  };
}
