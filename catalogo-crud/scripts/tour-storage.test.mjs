import assert from 'node:assert/strict';
import test from 'node:test';
import { createTourStorage, TOUR_STORAGE_KEY } from '../public/js/features/tour/storage.js';

function browserStorage(initialValue = null) {
  const entries = new Map(initialValue === null ? [] : [[TOUR_STORAGE_KEY, initialValue]]);
  return {
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) { entries.set(key, String(value)); },
    removeItem(key) { entries.delete(key); },
  };
}

test('a first visit has no completed sections or global dismissal', () => {
  const localStorage = browserStorage();
  const state = createTourStorage(1, () => localStorage);
  assert.deepEqual(state.read(), { version: 1, dismissed: false, pages: {} });
  assert.equal(localStorage.getItem(TOUR_STORAGE_KEY), null);
});

test('an interrupted tour restores its step in a new session', () => {
  const localStorage = browserStorage();
  const firstSession = createTourStorage(1, () => localStorage);
  firstSession.update('stories', 'in-progress', 'product');

  const restored = createTourStorage(1, () => localStorage).read();
  assert.equal(restored.pages.stories.status, 'in-progress');
  assert.equal(restored.pages.stories.stepId, 'product');
  assert.equal(Number.isNaN(Date.parse(restored.pages.stories.updatedAt)), false);
  assert.equal(restored.dismissed, false);
});

test('completion persists independently for each section', () => {
  const localStorage = browserStorage();
  const state = createTourStorage(1, () => localStorage);
  state.update('home', 'completed');
  state.update('catalogue', 'in-progress', 'filters');

  const restored = createTourStorage(1, () => localStorage).read();
  assert.equal(restored.pages.home.status, 'completed');
  assert.equal(restored.pages.home.stepId, null);
  assert.equal(restored.pages.catalogue.stepId, 'filters');
  assert.equal(restored.pages.stories, undefined);
  assert.equal(restored.dismissed, false);
});

test('skipping globally dismisses automatic tours, including after a manual replay', () => {
  const localStorage = browserStorage();
  const state = createTourStorage(1, () => localStorage);
  state.update('home', 'dismissed');
  state.update('stories', 'in-progress', 'composition');
  state.update('stories', 'completed');

  const restored = createTourStorage(1, () => localStorage).read();
  assert.equal(restored.dismissed, true);
  assert.equal(restored.pages.home.status, 'dismissed');
  assert.equal(restored.pages.stories.status, 'completed');
});

test('a new tour version resets earlier progress and dismissal', () => {
  const localStorage = browserStorage();
  createTourStorage(1, () => localStorage).update('home', 'dismissed');
  const nextVersion = createTourStorage(2, () => localStorage);
  assert.deepEqual(nextVersion.read(), { version: 2, dismissed: false, pages: {} });

  nextVersion.update('stories', 'in-progress', 'composition');
  const restored = createTourStorage(2, () => localStorage).read();
  assert.equal(restored.version, 2);
  assert.equal(restored.pages.home, undefined);
  assert.equal(restored.pages.stories.stepId, 'composition');
});

test('corrupted and malformed persisted values recover without blocking the tour', () => {
  for (const raw of ['{broken', 'null', '[]', '42', '{"version":1,"pages":[]}', '{"version":1,"pages":null}']) {
    const localStorage = browserStorage(raw);
    const state = createTourStorage(1, () => localStorage);
    assert.deepEqual(state.read(), { version: 1, dismissed: false, pages: {} });
    assert.equal(state.available, true);
    state.update('home', 'completed');
    assert.equal(createTourStorage(1, () => localStorage).read().pages.home.status, 'completed');
  }
});

test('blocked localStorage retains progress and dismissal for the current session', () => {
  const state = createTourStorage(1, () => { throw new Error('Storage access denied'); });
  assert.deepEqual(state.read(), { version: 1, dismissed: false, pages: {} });
  assert.equal(state.available, false);
  state.update('stories', 'in-progress', 'product');
  assert.equal(state.read().pages.stories.stepId, 'product');
  state.update('stories', 'dismissed');
  assert.equal(state.read().dismissed, true);
  assert.equal(state.available, false);
});

test('quota failures cannot overwrite newer progress with stale persisted data', () => {
  const localStorage = browserStorage();
  const state = createTourStorage(1, () => localStorage);
  state.update('stories', 'in-progress', 'composition');
  const setItem = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('Quota exceeded'); };

  state.update('stories', 'in-progress', 'product');
  assert.equal(state.available, false);
  assert.equal(state.read().pages.stories.stepId, 'product');
  state.update('home', 'dismissed');
  assert.equal(state.read().dismissed, true);
  assert.equal(state.read().pages.stories.stepId, 'product');
  assert.equal(JSON.parse(localStorage.getItem(TOUR_STORAGE_KEY)).pages.stories.stepId, 'composition');

  localStorage.setItem = setItem;
  state.update('catalogue', 'completed');
  assert.equal(state.available, true);
  const restored = createTourStorage(1, () => localStorage).read();
  assert.equal(restored.dismissed, true);
  assert.equal(restored.pages.stories.stepId, 'product');
  assert.equal(restored.pages.catalogue.status, 'completed');
});

test('changes and removal from another tab are reflected before the next update', () => {
  const localStorage = browserStorage();
  const firstTab = createTourStorage(1, () => localStorage);
  const secondTab = createTourStorage(1, () => localStorage);
  firstTab.update('home', 'completed');
  secondTab.update('stories', 'dismissed');
  assert.equal(firstTab.read().dismissed, true);
  assert.equal(firstTab.read().pages.home.status, 'completed');

  localStorage.removeItem(TOUR_STORAGE_KEY);
  assert.deepEqual(firstTab.read(), { version: 1, dismissed: false, pages: {} });
});
