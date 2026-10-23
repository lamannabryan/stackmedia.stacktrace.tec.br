import { DatabaseSync } from 'node:sqlite';
import { testSession } from './fixtures/auth.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';
import vm from 'node:vm';
import sharp from 'sharp';
import { createApplication } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';

test('background thumbnails and artwork are bounded, cached on disk, versioned and isolated from originals', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'vidamix-backgrounds-'));
  const images = path.join(directory, 'originals');
  await mkdir(images);
  const source = path.join(images, 'Fundo grande.png');
  await sharp({ create: { width: 2400, height: 4000, channels: 3, background: '#00a080' } }).png().toFile(source);
  const original = await readFile(source);
  const config = { ...loadConfig({ APP_AUTH_ENABLED: 'false' }), storageDirectory: directory,
    storyBackgroundsDirectory: images, feedBackgroundsDirectory: images, encarteBackgroundsDirectory: images, indoorBackgroundsDirectory: images };
  const database = new DatabaseSync(':memory:');
  const server = createServer(createApplication({ config, database }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { fetch } = await testSession(database, origin);
  const cache = path.join(directory, 'background-cache');
  try {
    for (const [format, width, height] of [['story', 1080, 1920], ['feed', 1080, 1350], ['encarte', 1080, 1080], ['indoor', 1920, 1080]]) {
      const { items: [item] } = await (await fetch(`${origin}/api/${format}-backgrounds`)).json();
      const responses = await Promise.all(Array.from({ length: 4 }, () => fetch(origin + item.thumbnail_url)));
      const data = await Promise.all(responses.map((response) => response.arrayBuffer().then(Buffer.from)));
      for (const bytes of data) assert.deepEqual(bytes, data[0]);
      const thumb = await sharp(data[0]).metadata();
      assert.equal(thumb.format, 'webp');
      assert.ok(thumb.width <= 240 && thumb.height <= 240);
      assert.match(responses[0].headers.get('cache-control'), /immutable/);
      const response = await fetch(origin + item.preview_url);
      const preview = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      assert.ok(preview.width <= width && preview.height <= height);
      assert.ok(Math.abs(preview.width / preview.height - 2400 / 4000) < 0.002);
      assert.equal(preview.format, 'webp');
      const files = await readdir(cache);
      const modified = await Promise.all(files.map(async (name) => (await stat(path.join(cache, name))).mtimeMs));
      const again = await fetch(origin + item.preview_url, { method: 'HEAD' });
      assert.equal(again.status, 200);
      assert.equal(await again.text(), '');
      assert.deepEqual(await Promise.all(files.map(async (name) => (await stat(path.join(cache, name))).mtimeMs)), modified);
      assert.equal((await fetch(origin + item.thumbnail_url, { headers: {
        'If-None-Match': responses[0].headers.get('etag'),
      } })).status, 304);
      assert.deepEqual(await readFile(source), original);
    }
    assert.equal((await readdir(cache)).length, 8, 'one file per format/variant, despite concurrent requests');
    const previous = (await (await fetch(origin + '/api/story-backgrounds')).json()).items[0];
    await sharp({ create: { width: 1200, height: 2000, channels: 3, background: '#ff0080' } }).png().toFile(source);
    const changed = (await (await fetch(origin + '/api/story-backgrounds')).json()).items[0];
    assert.notEqual(changed.thumbnail_url, previous.thumbnail_url);
    assert.equal((await fetch(origin + changed.thumbnail_url)).status, 200);
    assert.equal((await readdir(cache)).length, 8, 'replacement discards obsolete generated thumbnail');
    assert.equal((await fetch(origin + changed.thumbnail_url.replace('thumb-v1', 'unlimited'))).status, 400);
    assert.equal((await fetch(origin + '/story-backgrounds/%2e%2e%2ffile.png?variant=thumb-v1')).status, 403);
    await writeFile(path.join(images, 'broken.png'), 'invalid');
    assert.equal((await fetch(origin + '/story-backgrounds/broken.png?variant=thumb-v1')).status, 422);
    assert.equal((await fetch(origin + changed.preview_url)).status, 200, 'one invalid source does not block the conversion queue');
  } finally {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    if (path.dirname(directory) === path.resolve(tmpdir()) && path.basename(directory).startsWith('vidamix-backgrounds-')) {
      database.close();
    await rm(directory, { recursive: true, force: true });
    }
  }
});

test('rapid background selections decode only the current and latest preview, without concurrent loads', async () => {
  const source = await readFile(new URL('../public/js/features/stories/editor.js', import.meta.url), 'utf8');
  const wrapper = source.slice(source.indexOf('function renderPreview()'), source.indexOf('async function renderPreviewOnce('));
  const loads = [];
  const releases = [];
  const state = { previewRequestId: 0, selectedBackground: 'first' };
  const context = vm.createContext({ state, updateAvailability() {}, renderPreviewOnce: async () => {
    loads.push(state.selectedBackground);
    await new Promise((resolve) => releases.push(resolve));
  } });
  vm.runInContext(`let previewTask = null; ${wrapper}`, context);
  const first = context.renderPreview();
  for (const selected of ['second', 'third', 'last']) {
    state.selectedBackground = selected;
    assert.equal(context.renderPreview(), first);
  }
  assert.deepEqual(loads, ['first']);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(loads, ['first', 'last']);
  releases.shift()();
  await first;
  state.selectedBackground = 'next';
  const next = context.renderPreview();
  assert.deepEqual(loads, ['first', 'last', 'next']);
  releases.shift()();
  await next;
});
