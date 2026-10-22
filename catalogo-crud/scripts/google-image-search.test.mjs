import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import sharp from 'sharp';
import { createGoogleImageSearch, downloadPublicImage, isPublicImageAddress } from '../src/modules/products/google-image-search.mjs';

const ean = '3017620422003';
const image = await sharp({ create: { width: 20, height: 30, channels: 4, background: '#abcdef80' } }).png().toBuffer();
const results = [1, 2, 3, 4].map(position => ({ title: `Produto ${position}`, source: 'Loja', original: `https://example.com/${position}.png`, thumbnail: `https://example.com/thumb-${position}.png` }));

test('uses Google Images with EAN and returns only the first three results, preserving order and caching', async () => {
  const urls = [], downloads = [];
  let time = 1000;
  const service = createGoogleImageSearch({ apiKey: 'test-secret', now: () => time,
    fetchImpl: async url => { urls.push(url); return { ok: true, json: async () => ({ images_results: results }) }; },
    download: async url => { downloads.push(url); return image; } });
  const items = await service.search(ean, 1);
  assert.equal(urls[0].hostname, 'serpapi.com');
  assert.equal(urls[0].searchParams.get('engine'), 'google_images');
  assert.equal(urls[0].searchParams.get('q'), ean);
  assert.deepEqual(items.map(item => item.title), ['Produto 1', 'Produto 2', 'Produto 3']);
  assert.equal(downloads.length, 3);
  assert.match(items[0].preview, /^data:image\/webp;base64,/);
  assert.ok(!JSON.stringify(items).includes('test-secret'));
  assert.ok(!JSON.stringify(items).includes('original'));
  assert.deepEqual(await service.search(ean, 1), items);
  assert.equal(urls.length, 1);
  assert.deepEqual(await service.resolveSelection(items[1].token, ean, 1), image);
  assert.equal(downloads.at(-1), results[1].original);
  await assert.rejects(service.resolveSelection(items[1].token, ean, 2), /inválida/);
  await assert.rejects(service.resolveSelection(items[1].token, '12345678', 1), /inválida/);
  await assert.rejects(service.resolveSelection('forged', ean, 1), /inválida/);
  time += 600_001;
  await assert.rejects(service.resolveSelection(items[1].token, ean, 1), /expirada/);
});

test('missing key, invalid EAN, provider errors, empty results and rate limits are explicit', async () => {
  await assert.rejects(createGoogleImageSearch().search(ean, 1), /SERPAPI_API_KEY/);
  await assert.rejects(createGoogleImageSearch().search('invalid', 1), /EAN/);
  const failing = createGoogleImageSearch({ apiKey: 'x', fetchImpl: async () => ({ ok: false }) });
  await assert.rejects(failing.search(ean, 1), /cota/);
  const empty = createGoogleImageSearch({ apiKey: 'x', fetchImpl: async () => ({ ok: true, json: async () => ({ images_results: [] }) }) });
  assert.deepEqual(await empty.search(ean, 1), []);
  for (let i = 0; i < 5; i++) await empty.search(`1234567${i}`, 1);
  await assert.rejects(empty.search('87654321', 1), error => error.statusCode === 429);
});

test('an unavailable preview keeps its position without substituting the fourth result', async () => {
  const service = createGoogleImageSearch({ apiKey: 'x',
    fetchImpl: async () => ({ ok: true, json: async () => ({ images_results: results }) }),
    download: async url => { if (url.includes('thumb-2')) throw new Error('Blocked'); return image; } });
  const items = await service.search(ean, 1);
  assert.equal(items.length, 3); assert.equal(items[1].token, null); assert.equal(items[2].title, 'Produto 3');
});

test('image downloads reject local/private networks, unsafe schemes, credentials and ports before connecting', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.0.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isPublicImageAddress(address), false);
  assert.equal(isPublicImageAddress('8.8.8.8'), true);
  let connected = false;
  const request = () => { connected = true; throw new Error('Should not connect'); };
  for (const url of ['http://example.com/a', 'file:///a', 'https://user:pass@example.com/a', 'https://example.com:444/a', 'https://127.0.0.1/a', 'https://example.com/a']) {
    await assert.rejects(downloadPublicImage(url, { request, resolve: async () => ['10.0.0.1'] }));
  }
  assert.equal(connected, false);
});

test('downloads pin resolved IPs, enforce byte limits and validate redirect targets', async () => {
  let mode = 'ok', connections = 0;
  const request = (url, options, callback) => {
    connections++;
    options.lookup(url.hostname, {}, (error, address) => { assert.equal(error, null); assert.equal(address, '8.8.8.8'); });
    const req = new EventEmitter();
    queueMicrotask(() => {
      const response = new EventEmitter(); response.destroy = () => {};
      response.statusCode = mode === 'redirect' ? 302 : 200;
      response.headers = mode === 'redirect' ? { location: 'https://127.0.0.1/secret' } : {};
      callback(response);
      if (mode !== 'redirect') { response.emit('data', image); response.emit('end'); }
    });
    return req;
  };
  const options = { request, resolve: async () => ['8.8.8.8'] };
  assert.deepEqual(await downloadPublicImage('https://example.com/a', options), image);
  await assert.rejects(downloadPublicImage('https://example.com/a', { ...options, maxBytes: 1 }), /large/);
  mode = 'redirect';
  await assert.rejects(downloadPublicImage('https://example.com/a', options), /Unsafe address/);
  assert.equal(connections, 3);
});
