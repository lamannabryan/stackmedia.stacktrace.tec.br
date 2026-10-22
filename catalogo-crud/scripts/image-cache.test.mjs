import { DatabaseSync } from 'node:sqlite';
import { testSession } from './fixtures/auth.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApplication } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';

test('background manifests detect additions, replacements and removals without invalidating other images', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'vidamix-cache-'));
  const config = { ...loadConfig({ APP_AUTH_ENABLED: 'false' }),
    storyBackgroundsDirectory: directory, feedBackgroundsDirectory: directory, indoorBackgroundsDirectory: directory };
  const database = new DatabaseSync(':memory:');
  const server = createServer(createApplication({ config, database }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { fetch } = await testSession(database, origin);
  try {
    await writeFile(path.join(directory, 'a.png'), 'first-image');
    for (const format of ['story', 'feed', 'indoor']) {
      const endpoint = `${origin}/api/${format}-backgrounds`;
      const initial = await fetch(endpoint);
      const etag = initial.headers.get('etag');
      const { items } = await initial.json();
      const imageUrl = items[0].url;
      assert.ok(new URL(imageUrl, origin).searchParams.get('v'));
      const conditional = await fetch(endpoint, { headers: { 'If-None-Match': etag } });
      assert.equal(conditional.status, 304);
      assert.equal(await conditional.text(), '');
      const image = await fetch(origin + imageUrl);
      assert.match(image.headers.get('cache-control'), /private.*immutable/);
      assert.equal(await image.text(), 'first-image');
      const head = await fetch(origin + imageUrl, { method: 'HEAD' });
      assert.equal(head.headers.get('content-length'), '11');
      assert.equal(await head.text(), '');
      assert.equal((await fetch(origin + imageUrl, {
        headers: { 'If-None-Match': image.headers.get('etag') },
      })).status, 304);
      const unversioned = await fetch(`${origin}/${format}-backgrounds/a.png`);
      assert.equal(unversioned.headers.get('cache-control'), 'private, no-cache');
      await writeFile(path.join(directory, 'b.webp'), 'new-image');
      const added = await fetch(endpoint, { headers: { 'If-None-Match': etag } });
      assert.equal(added.status, 200);
      const next = (await added.json()).items;
      assert.equal(next.length, 2);
      assert.equal(next.find((item) => item.arquivo === 'a.png').url, imageUrl);
      await writeFile(path.join(directory, 'a.png'), 'replacement-image');
      const replaced = (await (await fetch(endpoint)).json()).items;
      const replacementUrl = replaced.find((item) => item.arquivo === 'a.png').url;
      assert.notEqual(replacementUrl, imageUrl);
      assert.equal(await (await fetch(origin + replacementUrl)).text(), 'replacement-image');
      assert.doesNotMatch((await fetch(origin + imageUrl)).headers.get('cache-control'), /immutable/);
      await unlink(path.join(directory, 'b.webp'));
      assert.equal((await (await fetch(endpoint)).json()).items.length, 1);
      await writeFile(path.join(directory, 'a.png'), 'first-image');
    }
  } finally {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    for (const filename of ['a.png', 'b.webp']) await unlink(path.join(directory, filename)).catch(() => {});
    await rmdir(directory);
    database.close();
  }
});
