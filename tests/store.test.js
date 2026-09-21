import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Store, STORAGE_KEY } from '../assets/js/store.js';
import { DEFAULT_SETTINGS } from '../assets/js/schema.js';

/** Minimal localStorage stand-in so the store can be exercised in Node. */
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
});

test('a fresh store starts at the defaults', () => {
  const store = new Store();
  assert.deepEqual(store.settings, { ...DEFAULT_SETTINGS });
  assert.equal(store.historyState().canUndo, false);
});

test('set applies a patch and emits a change event', () => {
  const store = new Store();
  const events = [];
  store.on('change', (e) => events.push(e));
  const changed = store.set({ barCount: 99 }, { label: 'bars' });
  assert.equal(changed, true);
  assert.equal(store.get('barCount'), 99);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].keys, ['barCount']);
  assert.equal(events[0].label, 'bars');
});

test('set ignores no-op writes', () => {
  const store = new Store();
  let calls = 0;
  store.on('change', () => calls++);
  assert.equal(store.set({ barCount: DEFAULT_SETTINGS.barCount }), false);
  assert.equal(calls, 0);
  assert.equal(store.historyState().canUndo, false);
});

test('undo and redo restore previous values', () => {
  const store = new Store();
  store.set({ titleText: 'A' }, { label: 'a' });
  store.set({ titleText: 'B' }, { label: 'b' });
  assert.equal(store.get('titleText'), 'B');

  assert.equal(store.undo(), true);
  assert.equal(store.get('titleText'), 'A');
  assert.equal(store.undo(), true);
  assert.equal(store.get('titleText'), DEFAULT_SETTINGS.titleText);

  assert.equal(store.redo(), true);
  assert.equal(store.get('titleText'), 'A');
  assert.equal(store.redo(), true);
  assert.equal(store.get('titleText'), 'B');
  assert.equal(store.redo(), false);
});

test('a new change clears the redo stack', () => {
  const store = new Store();
  store.set({ titleText: 'A' });
  store.undo();
  assert.equal(store.historyState().canRedo, true);
  store.set({ titleText: 'C' });
  assert.equal(store.historyState().canRedo, false);
});

test('a transaction collapses many writes into one undo step', () => {
  const store = new Store();
  store.begin();
  for (let i = 1; i <= 20; i++) store.set({ barCount: 20 + i }, { history: false, silent: true });
  store.end('drag slider');

  assert.equal(store.get('barCount'), 40);
  assert.equal(store.undo(), true);
  assert.equal(store.get('barCount'), DEFAULT_SETTINGS.barCount, 'one undo should revert the whole drag');
});

test('an empty transaction records no history', () => {
  const store = new Store();
  store.begin();
  store.end('nothing happened');
  assert.equal(store.historyState().canUndo, false);
});

test('replace merges a partial object over the defaults', () => {
  const store = new Store();
  store.replace({ barCount: 12, color1: '#123456' }, 'preset');
  assert.equal(store.get('barCount'), 12);
  assert.equal(store.get('color1'), '#123456');
  assert.equal(store.get('visType'), DEFAULT_SETTINGS.visType, 'untouched keys keep defaults');
  assert.equal(store.undo(), true);
  assert.equal(store.get('barCount'), DEFAULT_SETTINGS.barCount);
});

test('resetSection only resets the listed keys', () => {
  const store = new Store();
  store.set({ barCount: 100, color1: '#abcdef' }, { label: 'x' });
  store.resetSection(['barCount'], 'reset');
  assert.equal(store.get('barCount'), DEFAULT_SETTINGS.barCount);
  assert.equal(store.get('color1'), '#abcdef', 'unlisted keys are preserved');
});

test('resetAll restores every default', () => {
  const store = new Store();
  store.set({ barCount: 100, color1: '#abcdef', lyricsOn: true });
  store.resetAll();
  assert.deepEqual(store.settings, { ...DEFAULT_SETTINGS });
});

test('reports modified and default keys accurately', () => {
  const store = new Store();
  assert.equal(store.modifiedKeys().length, 0);
  assert.equal(store.isDefault('barCount'), true);
  store.set({ barCount: 33 });
  assert.deepEqual(store.modifiedKeys(), ['barCount']);
  assert.equal(store.isDefault('barCount'), false);
});

test('persist and restore round trip through localStorage', () => {
  const first = new Store();
  first.set({ barCount: 77, color1: '#010203', lyricsOn: true });

  const second = new Store();
  assert.equal(second.restore(), true);
  assert.equal(second.get('barCount'), 77);
  assert.equal(second.get('color1'), '#010203');
  assert.equal(second.get('lyricsOn'), true);
});

test('restore ignores unknown keys and coerces types', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    settings: { barCount: '42', lyricsOn: 'not a bool', totallyUnknown: 1, color1: '#aabbcc' }
  }));
  const store = new Store();
  assert.equal(store.restore(), true);
  assert.equal(store.get('barCount'), 42, 'numeric strings are coerced');
  assert.equal(store.get('lyricsOn'), false, 'non-boolean is rejected');
  assert.equal(store.get('color1'), '#aabbcc');
  assert.equal('totallyUnknown' in store.settings, false);
});

test('restore tolerates corrupt storage', () => {
  localStorage.setItem(STORAGE_KEY, '{not json');
  const store = new Store();
  assert.equal(store.restore(), false);
  assert.deepEqual(store.settings, { ...DEFAULT_SETTINGS });
});

test('lyrics text is kept out of localStorage because of its size', () => {
  const store = new Store();
  store.set({ lyricsText: '0:01|a very long lyric line' });
  const raw = localStorage.getItem(STORAGE_KEY);
  assert.ok(raw);
  assert.equal(JSON.parse(raw).settings.lyricsText, undefined);
  assert.equal(store.get('lyricsText'), '0:01|a very long lyric line', 'still present in memory');
});

test('toJSON and fromJSON round trip', () => {
  const store = new Store();
  store.set({ barCount: 55, titleText: 'Roundtrip', color2: '#00ff00' });
  const json = store.toJSON({ track: 'song.mp3' });

  const other = new Store();
  const count = other.fromJSON(json);
  assert.ok(count > 0);
  assert.equal(other.get('barCount'), 55);
  assert.equal(other.get('titleText'), 'Roundtrip');
  assert.equal(other.get('color2'), '#00ff00');
});

test('fromJSON rejects unusable payloads', () => {
  const store = new Store();
  assert.throws(() => store.fromJSON('{nope'), /JSON|Unexpected/);
  assert.throws(() => store.fromJSON(JSON.stringify({ settings: 'nope' })), /No settings|No recognised/);
  assert.throws(() => store.fromJSON(JSON.stringify({ settings: { unknownKey: 1 } })), /No recognised/);
});

test('history is capped so long sessions cannot grow without bound', () => {
  const store = new Store();
  for (let i = 0; i < 200; i++) store.set({ barCount: 20 + (i % 100) }, { silent: true });
  assert.ok(store._undo.length <= 80);
});