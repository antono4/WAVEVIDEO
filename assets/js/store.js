import { DEFAULT_SETTINGS } from './schema.js';
import { clamp } from './utils.js';

const STORAGE_KEY = 'wavevideo.settings.v1';
const MAX_HISTORY = 80;

/** Settings whose values are too large or non-serializable for localStorage. */
const NON_PERSISTED = new Set(['lyricsText']);

/**
 * Central application state.
 *
 * Holds the settings object, undo/redo history and change notification.
 * Deliberately dependency-free so it can be unit-reasoned about in isolation.
 */
export class Store {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this._undo = [];
    this._redo = [];
    this._listeners = new Map();
    this._suspend = 0;
  }

  /* ---------------------------------------------------------------- events */

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this._listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    this._listeners.get(event)?.forEach((fn) => fn(payload));
  }

  /* --------------------------------------------------------------- reading */

  get(key, fallback) {
    const v = this.settings[key];
    return v === undefined ? fallback : v;
  }

  snapshot() {
    return structuredClone(this.settings);
  }

  /** Keys of settings that differ from their default. */
  modifiedKeys() {
    return Object.keys(DEFAULT_SETTINGS).filter((k) => {
      const a = this.settings[k];
      const b = DEFAULT_SETTINGS[k];
      if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > 1e-9;
      return a !== b;
    });
  }

  isDefault(key) {
    const a = this.settings[key];
    const b = DEFAULT_SETTINGS[key];
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
    return a === b;
  }

  /* ---------------------------------------------------------------- writing */

  /**
   * Merge a patch into the settings.
   * @param {object} patch
   * @param {{history?: boolean, silent?: boolean, label?: string}} opts
   */
  set(patch, opts = {}) {
    const { history = true, silent = false, label = '' } = opts;
    let changed = false;
    for (const [key, value] of Object.entries(patch)) {
      if (this.settings[key] !== value) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;

    if (history && !this._suspend) this._pushUndo(label);
    Object.assign(this.settings, patch);
    if (!silent) {
      this.emit('change', { patch, keys: Object.keys(patch), label });
      this.persist();
    }
    return true;
  }

  /**
   * Begin a transaction: many set() calls collapse into one undo step.
   * Safe to nest.
   */
  begin() {
    if (this._suspend === 0) this._pending = this.snapshot();
    this._suspend += 1;
  }

  end(label = '') {
    this._suspend = Math.max(0, this._suspend - 1);
    if (this._suspend === 0 && this._pending) {
      const before = this._pending;
      this._pending = null;
      if (JSON.stringify(before) !== JSON.stringify(this.settings)) {
        this._undo.push({ state: before, label });
        if (this._undo.length > MAX_HISTORY) this._undo.shift();
        this._redo.length = 0;
        this.emit('history', this.historyState());
      }
    }
    this.emit('change', { patch: this.settings, keys: Object.keys(this.settings), label, bulk: true });
    this.persist();
  }

  /** Replace the entire settings object (preset apply, JSON load, reset). */
  replace(settings, label = '') {
    if (label) this._pushUndo(label);
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.emit('change', { patch: this.settings, keys: Object.keys(this.settings), label, bulk: true });
    this.persist();
  }

  resetSection(keys, label = '') {
    const patch = {};
    keys.forEach((k) => {
      if (k in DEFAULT_SETTINGS) patch[k] = DEFAULT_SETTINGS[k];
    });
    this.set(patch, { label });
  }

  resetAll() {
    this.replace({}, 'Reset everything');
  }

  /* ---------------------------------------------------------------- history */

  _pushUndo(label) {
    this._undo.push({ state: this.snapshot(), label });
    if (this._undo.length > MAX_HISTORY) this._undo.shift();
    this._redo.length = 0;
    this.emit('history', this.historyState());
  }

  historyState() {
    return { canUndo: this._undo.length > 0, canRedo: this._redo.length > 0 };
  }

  undo() {
    const entry = this._undo.pop();
    if (!entry) return false;
    this._redo.push({ state: this.snapshot(), label: entry.label });
    this.settings = entry.state;
    this.emit('change', { patch: this.settings, keys: Object.keys(this.settings), label: `Undo ${entry.label}`, bulk: true });
    this.emit('history', this.historyState());
    this.persist();
    return true;
  }

  redo() {
    const entry = this._redo.pop();
    if (!entry) return false;
    this._undo.push({ state: this.snapshot(), label: entry.label });
    this.settings = entry.state;
    this.emit('change', { patch: this.settings, keys: Object.keys(this.settings), label: `Redo ${entry.label}`, bulk: true });
    this.emit('history', this.historyState());
    this.persist();
    return true;
  }

  /* ------------------------------------------------------------- persistence */

  persist() {
    try {
      const data = {};
      for (const [k, v] of Object.entries(this.settings)) {
        if (NON_PERSISTED.has(k)) continue;
        data[k] = v;
      }
      const payload = JSON.stringify({ version: 1, settings: data });
      // Guard against quota errors on very large lyric sets.
      if (payload.length < 4_000_000) localStorage.setItem(STORAGE_KEY, payload);
    } catch {
      /* storage unavailable (private mode, quota) — autosave is best effort */
    }
  }

  /** Restore autosaved settings. Returns true when something was restored. */
  restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      const saved = data?.settings;
      if (!saved || typeof saved !== 'object') return false;
      for (const [k, v] of Object.entries(saved)) {
        if (!(k in DEFAULT_SETTINGS) || NON_PERSISTED.has(k)) continue;
        const def = DEFAULT_SETTINGS[k];
        if (typeof def === 'boolean' && typeof v !== 'boolean') continue;
        if (typeof def === 'number' && !Number.isFinite(Number(v))) continue;
        this.settings[k] = typeof def === 'number' ? clamp(Number(v), -1e6, 1e6) : v;
      }
      return true;
    } catch {
      return false;
    }
  }

  clearPersisted() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  /** Settings JSON for export. */
  toJSON(extra = {}) {
    return JSON.stringify({
      app: 'wavevideo-studio',
      version: 1,
      savedAt: new Date().toISOString(),
      settings: this.settings,
      ...extra
    }, null, 2);
  }

  /** Load a settings JSON document produced by toJSON(). */
  fromJSON(text) {
    const data = JSON.parse(text);
    const incoming = data?.settings ?? data;
    if (!incoming || typeof incoming !== 'object') throw new Error('No settings object found');
    const merged = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      const def = DEFAULT_SETTINGS[k];
      if (typeof def === 'number' && !Number.isFinite(Number(v))) continue;
      if (typeof def === 'boolean' && typeof v !== 'boolean') continue;
      merged[k] = typeof def === 'number' ? Number(v) : v;
    }
    if (!Object.keys(merged).length) throw new Error('No recognised settings');
    this.replace(merged, 'Load settings');
    return Object.keys(merged).length;
  }
}

export { STORAGE_KEY };