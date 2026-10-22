import assert from 'node:assert/strict';
import test from 'node:test';
import { createCameraScanner, visibleCameraFrame } from '../public/js/features/barcode/camera.js';

const ean = '7894900011517';
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function mediaStream() {
  const track = new EventTarget();
  track.stops = 0;
  track.stop = () => track.stops++;
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}
function setup(overrides = {}) {
  const stream = mediaStream();
  const requests = [], codes = [], states = [], errors = [];
  const timers = new Map();
  let id = 0;
  let time = 0;
  const video = { readyState: 4, videoWidth: 1920, videoHeight: 1080, srcObject: null, play: async () => {}, pause() {} };
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
  const scanner = createCameraScanner({
    video, secureContext: true,
    mediaDevices: { getUserMedia: async (options) => { requests.push(options); return stream; } },
    loadDecoder: async () => () => ean,
    createCanvas: () => canvas,
    onCode: (code) => codes.push(code), onState: (state) => states.push(state), onError: (error) => errors.push(error),
    schedule: (fn) => { timers.set(++id, fn); return id; }, cancel: (key) => timers.delete(key), now: () => time,
    ...overrides,
  });
  const tick = async (advance = 180) => {
    time += advance;
    const tasks = [...timers.values()];
    timers.clear();
    await Promise.all(tasks.map((fn) => fn()));
  };
  return { scanner, video, stream, canvas, requests, codes, states, errors, timers, tick };
}

test('camera requests rear video only, bounds decoding size and confirms a repeated valid code once', async () => {
  const f = setup();
  assert.equal(f.requests.length, 0);
  await f.scanner.start();
  await f.scanner.start();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].audio, false);
  assert.equal(f.requests[0].video.facingMode.ideal, 'environment');
  assert.equal(f.video.playsInline, true);
  assert.equal(f.video.muted, true);
  await f.tick();
  assert.equal(f.canvas.width, 1280);
  assert.equal(f.canvas.height, 720);
  assert.deepEqual(f.codes, []);
  await f.tick();
  assert.deepEqual(f.codes, [ean]);
  assert.equal(f.stream.track.stops, 1);
  assert.equal(f.video.srcObject, null);
  assert.equal(f.scanner.state, 'idle');
  await f.tick();
  assert.deepEqual(f.codes, [ean]);
});

test('camera cropping matches the visible portrait or landscape preview without stretching', () => {
  const video = { videoWidth: 1920, videoHeight: 1080, clientWidth: 360, clientHeight: 640 };
  const portrait = visibleCameraFrame(video);
  assert.equal(portrait.height, 1080);
  assert.equal(portrait.width, 607.5);
  assert.equal(portrait.x, 656.25);
  assert.equal(portrait.y, 0);
  Object.assign(video, { videoWidth: 1080, videoHeight: 1920, clientWidth: 640, clientHeight: 360 });
  const landscape = visibleCameraFrame(video);
  assert.equal(landscape.width, 1080);
  assert.equal(landscape.height, 607.5);
  assert.equal(landscape.x, 0);
  assert.equal(landscape.y, 656.25);
  Object.assign(video, { clientWidth: 0, clientHeight: 0 });
  assert.deepEqual(visibleCameraFrame(video), { x: 0, y: 0, width: 1080, height: 1920 });
});

test('portrait reader requests portrait video and decodes only the portion shown after rotation', async () => {
  const draws = [];
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args) => draws.push(args) }) };
  const f = setup({ createCanvas: () => canvas, loadDecoder: async () => () => null });
  Object.assign(f.video, { clientWidth: 360, clientHeight: 640 });
  await f.scanner.start();
  assert.equal(f.requests[0].video.width.ideal, 720);
  assert.equal(f.requests[0].video.height.ideal, 1280);
  await f.tick();
  assert.deepEqual(draws[0].slice(1), [656.25, 0, 607.5, 1080, 0, 0, 608, 1080]);
  Object.assign(f.video, { clientWidth: 640, clientHeight: 360 });
  await f.tick();
  assert.deepEqual(draws[1].slice(1), [0, 0, 1920, 1080, 0, 0, 1280, 720]);
  f.scanner.stop();
});

test('insecure or unsupported browsers fail without loading the decoder or requesting permission', async () => {
  for (const override of [{ secureContext: false }, { mediaDevices: {} }]) {
    const f = setup({ ...override, loadDecoder: () => { throw new Error('Must not load'); } });
    await f.scanner.start();
    assert.equal(f.scanner.state, 'idle');
    assert.equal(f.requests.length, 0);
    assert.match(f.errors[0], /HTTPS|não disponibiliza/);
  }
});

test('closing during decoder loading prevents a permission request', async () => {
  const loading = deferred();
  const f = setup({ loadDecoder: () => loading.promise });
  const starting = f.scanner.start();
  f.scanner.stop();
  loading.resolve(() => ean);
  await starting;
  assert.equal(f.requests.length, 0);
  assert.equal(f.scanner.state, 'idle');
});

test('late permission from a cancelled session releases its stream without stopping a newer session', async () => {
  const permission = deferred();
  const oldStream = mediaStream(), newStream = mediaStream();
  let calls = 0;
  const f = setup({ mediaDevices: { getUserMedia: () => ++calls === 1 ? permission.promise : Promise.resolve(newStream) } });
  const starting = f.scanner.start();
  await flush();
  f.scanner.stop();
  await f.scanner.start();
  permission.resolve(oldStream);
  await starting;
  assert.equal(oldStream.track.stops, 1);
  assert.equal(newStream.track.stops, 0);
  assert.equal(f.video.srcObject, newStream);
  assert.equal(f.scanner.state, 'scanning');
  f.scanner.stop();
  assert.equal(newStream.track.stops, 1);
});

test('late decoding cannot navigate or schedule another frame after stopping', async () => {
  const pending = deferred();
  const f = setup({ loadDecoder: async () => () => pending.promise });
  await f.scanner.start();
  const decoding = f.tick();
  f.scanner.stop();
  pending.resolve(ean);
  await decoding;
  assert.deepEqual(f.codes, []);
  assert.equal(f.timers.size, 0);
  assert.equal(f.stream.track.stops, 1);
});

test('invalid codes and isolated or stale readings do not navigate', async () => {
  let value = '7894900011518';
  const f = setup({ loadDecoder: async () => () => value });
  await f.scanner.start();
  await f.tick(); await f.tick();
  value = ean;
  await f.tick(); await f.tick(1700);
  assert.deepEqual(f.codes, []);
  await f.tick();
  assert.deepEqual(f.codes, [ean]);
});

test('permission, missing camera and busy camera failures restore idle and allow retry', async () => {
  for (const [name, pattern] of [['NotAllowedError', /não foi autorizada/], ['NotFoundError', /Nenhuma câmera/], ['NotReadableError', /outros apps/]]) {
    const f = setup({ mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error(), { name }); } } });
    await f.scanner.start();
    assert.equal(f.scanner.state, 'idle');
    assert.match(f.errors[0], pattern);
    await f.scanner.start();
    assert.equal(f.errors.length, 2);
  }
});

test('playback and decoder failures release the camera', async () => {
  const f = setup();
  f.video.play = async () => { throw new Error('Playback blocked'); };
  await f.scanner.start();
  assert.equal(f.stream.track.stops, 1);
  assert.equal(f.scanner.state, 'idle');
  const g = setup({ loadDecoder: async () => () => { throw new Error('Decoder failure'); } });
  await g.scanner.start();
  await g.tick();
  assert.equal(g.stream.track.stops, 1);
  assert.equal(g.scanner.state, 'idle');
  assert.equal(g.errors.length, 1);
});

test('device disconnection stops decoding and explains how to resume', async () => {
  const f = setup();
  await f.scanner.start();
  f.stream.track.dispatchEvent(new Event('ended'));
  assert.equal(f.scanner.state, 'idle');
  assert.equal(f.timers.size, 0);
  assert.match(f.errors[0], /interrompida/);
  assert.equal(f.video.srcObject, null);
});
