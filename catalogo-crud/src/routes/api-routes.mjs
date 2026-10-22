import { readJsonBody, sendError, sendJson, sendNoContent, sendRevalidatedJson } from '../http/response.mjs';
import { createRouter } from '../http/router.mjs';
import { PARTNER_BODY_BYTES } from '../modules/partners/partner-service.mjs';
import { badRequest } from '../http/errors.mjs';
import { requireAdmin } from '../modules/users/session-service.mjs';
import { BACKGROUND_BODY_BYTES } from '../modules/stories/background-service.mjs';
import { MAGAZINE_BODY_BYTES } from '../modules/magazines/import-xlsx.mjs';
import { serveFile } from '../http/static-files.mjs';
import { createProductImageUpload, PRODUCT_IMAGE_BODY_BYTES } from '../modules/products/product-image-upload.mjs';
import { createGoogleImageSearch } from '../modules/products/google-image-search.mjs';
import { createDeepSeekClient } from '../integrations/deepseek-client.mjs';
import { createProductAiService } from '../modules/products/product-ai-service.mjs';
import { PRODUCT_IMPORT_BODY_BYTES } from '../modules/products/import-xlsx.mjs';
import { createProductHtmlImportService } from '../modules/products/product-html-import-service.mjs';
import { PRODUCT_HTML_BODY_BYTES } from '../modules/products/import-html.mjs';

function getRequestedProductId(productService, value) {
  return productService.productId(value);
}

export function createApiRouter({ database, productService, productImportService, partnerService, magazineService, config, storyBackgroundService, feedBackgroundService, indoorBackgroundService, userService, sessionService, integrationFetch = fetch, productImageDownload }) {
  const router = createRouter();
  const productAi = createProductAiService({ client: createDeepSeekClient({ ...config.deepseek, fetchImpl: integrationFetch }) });
  router.post('/api/products/lookup-ean', async ({ request, response, session }) => {
    const payload = await readJsonBody(request, { maxBytes: 1024 });
    sendJson(response, 200, await productAi.lookup(payload?.ean, session.user.id));
  });
  const imageSearch = createGoogleImageSearch({ apiKey: config.serpApiKey });
  const imageUpload = createProductImageUpload({ imagesDirectory: config.imagesDirectory, imageSearch });
  const htmlImport = createProductHtmlImportService({ database, productService, imageUpload, download: productImageDownload });
  router.post('/api/products/import-html/parse', async ({ request, response, session }) => {
    requireAdmin(session);
    sendJson(response, 200, htmlImport.parse(await readJsonBody(request, { maxBytes: PRODUCT_HTML_BODY_BYTES })));
  });
  router.post('/api/products/import-html/item', async ({ request, response, session }) => {
    requireAdmin(session);
    sendJson(response, 200, await htmlImport.save(await readJsonBody(request, { maxBytes: 8192 })));
  });
  router.get('/api/product-images/search/:ean', async ({ params, response, session }) => {
    sendJson(response, 200, { items: await imageSearch.search(params.ean, session.user.id) });
  });
  router.get('/api/revistas/destaque', ({ response }) => sendJson(response, 200, { revista: magazineService.featured() }));
  router.get('/api/revistas/modelo', async ({ request, response, session }) => {
    requireAdmin(session);
    response.setHeader('Content-Disposition', 'attachment; filename="modelo-revista.xlsx"');
    await serveFile({ request, response, rootDirectory: config.projectDirectory, urlPath: 'resources/modelo-revista.xlsx' });
  });
  router.get('/api/revistas', ({ response, session }) => {
    requireAdmin(session); sendJson(response, 200, { items: magazineService.list() });
  });
  router.post('/api/revistas/preview', async ({ request, response, session }) => {
    requireAdmin(session); sendJson(response, 200, await magazineService.preview(await readJsonBody(request, { maxBytes: MAGAZINE_BODY_BYTES })));
  });
  router.post('/api/revistas/import', async ({ request, response, session }) => {
    requireAdmin(session); sendJson(response, 200, await magazineService.save(await readJsonBody(request, { maxBytes: MAGAZINE_BODY_BYTES })));
  });
  router.get('/api/revistas/:id', ({ response, params, session }) => {
    requireAdmin(session); sendJson(response, 200, magazineService.details(params.id));
  });
  router.put('/api/revistas/:id', async ({ request, response, params, session }) => {
    requireAdmin(session); sendJson(response, 200, magazineService.update(params.id, await readJsonBody(request, { maxBytes: 4096 })));
  });
  router.delete('/api/revistas/:id', ({ response, params, url, session }) => {
    requireAdmin(session); magazineService.remove(params.id, url.searchParams.get('revision')); sendNoContent(response);
  });
  for (const [route, service] of [['story-backgrounds', storyBackgroundService], ['feed-backgrounds', feedBackgroundService], ['indoor-backgrounds', indoorBackgroundService]]) {
    router.post(`/api/${route}`, async ({ request, response, session }) => {
      requireAdmin(session);
      sendJson(response, 201, await service.addBackground(await readJsonBody(request, { maxBytes: BACKGROUND_BODY_BYTES })));
    });
    router.delete(`/api/${route}/:filename`, async ({ response, params, session }) => {
      requireAdmin(session);
      await service.removeBackground(params.filename);
      sendNoContent(response);
    });
  }
  const userId = (value) => {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw badRequest('Usuário inválido.');
    return Number(value);
  };
  router.get('/api/auth/me', ({ response, session }) => sendJson(response, 200, session));
  router.post('/api/auth/logout', ({ request, response }) => {
    response.setHeader('Set-Cookie', sessionService.logout(request));
    sendNoContent(response);
  });
  router.get('/api/users', ({ response, session }) => {
    requireAdmin(session);
    sendJson(response, 200, { items: userService.list() });
  });
  router.post('/api/users', async ({ request, response, session }) => {
    requireAdmin(session);
    sendJson(response, 201, await userService.create(await readJsonBody(request, { maxBytes: 8192 })));
  });
  router.put('/api/users/:id', async ({ request, response, params, session }) => {
    requireAdmin(session);
    sendJson(response, 200, await userService.update(userId(params.id), await readJsonBody(request, { maxBytes: 8192 })));
  });
  router.delete('/api/users/:id', ({ response, params, session }) => {
    requireAdmin(session);
    userService.remove(userId(params.id), session.user.id);
    sendNoContent(response);
  });

  router.get('/api/health', ({ response }) => {
    sendJson(response, 200, { status: 'ok' });
  });

  router.get('/api/manufacturers', ({ response }) => {
    sendJson(response, 200, { items: partnerService.listManufacturers() });
  });
  router.get('/api/featured-partners', ({ response }) => {
    sendJson(response, 200, { items: partnerService.listPartners() });
  });
  router.put('/api/featured-partners/:slot', async ({ request, response, params }) => {
    const payload = await readJsonBody(request, { maxBytes: PARTNER_BODY_BYTES });
    sendJson(response, 200, await partnerService.savePartner(params.slot, payload));
  });
  router.delete('/api/featured-partners/:slot', async ({ response, params }) => {
    await partnerService.deletePartner(params.slot);
    sendNoContent(response);
  });

  router.get('/api/summary', ({ response, session }) => {
    sendJson(response, 200, productService.getSummary({ role: session?.user?.role }));
  });

  router.get('/api/categories', ({ response, session }) => {
    sendJson(response, 200, { items: productService.listCategories({ role: session?.user?.role }) });
  });

  router.get('/api/story-backgrounds', async ({ request, response }) => {
    sendRevalidatedJson(request, response, { items: await storyBackgroundService.listStoryBackgrounds() });
  });

  router.get('/api/feed-backgrounds', async ({ request, response }) => {
    sendRevalidatedJson(request, response, { items: await feedBackgroundService.listStoryBackgrounds() });
  });

  router.get('/api/indoor-backgrounds', async ({ request, response }) => {
    sendRevalidatedJson(request, response, { items: await indoorBackgroundService.listStoryBackgrounds() });
  });

  router.get('/api/products', ({ response, url, session }) => {
    sendJson(response, 200, productService.listProducts(url.searchParams, { role: session?.user?.role }));
  });

  router.post('/api/products/import/preview', async ({ request, response, session }) => {
    requireAdmin(session);
    sendJson(response, 200, await productImportService.preview(await readJsonBody(request, { maxBytes: PRODUCT_IMPORT_BODY_BYTES })));
  });

  router.post('/api/products/import', async ({ request, response, session }) => {
    requireAdmin(session);
    sendJson(response, 200, await productImportService.save(await readJsonBody(request, { maxBytes: PRODUCT_IMPORT_BODY_BYTES })));
  });

  router.get('/api/products/by-ean/:ean', ({ params, response, session }) => {
    const product = productService.getProductByEan(params.ean, { role: session?.user?.role });
    if (!product) {
      sendError(response, 404, 'Produto não encontrado para este EAN.');
      return;
    }
    sendJson(response, 200, product);
  });

  router.get('/api/products/:id', ({ params, response, session }) => {
    const id = getRequestedProductId(productService, params.id);
    const product = id ? productService.getProduct(id, { role: session?.user?.role }) : null;
    if (!product) {
      sendError(response, 404, 'Produto não encontrado.');
      return;
    }
    sendJson(response, 200, product);
  });

  router.post('/api/products', async ({ request, response, session }) => {
    const product = await imageUpload.saveWithImage(await readJsonBody(request, { maxBytes: PRODUCT_IMAGE_BODY_BYTES }),
      payload => productService.createProduct(payload, { role: session.user.role }), session.user.id);
    sendJson(response, 201, product);
  });

  router.put('/api/products/:id', async ({ params, request, response, session }) => {
    requireAdmin(session);
    const id = getRequestedProductId(productService, params.id);
    const product = id ? await imageUpload.saveWithImage(await readJsonBody(request, { maxBytes: PRODUCT_IMAGE_BODY_BYTES }),
      payload => productService.updateProduct(id, payload), session.user.id) : null;
    if (!product) {
      sendError(response, 404, 'Produto não encontrado.');
      return;
    }
    sendJson(response, 200, product);
  });

  router.delete('/api/products/:id', ({ params, response, session }) => {
    requireAdmin(session);
    const id = getRequestedProductId(productService, params.id);
    if (!id || !productService.deleteProduct(id)) {
      sendError(response, 404, 'Produto não encontrado.');
      return;
    }
    sendNoContent(response);
  });

  return router;
}
