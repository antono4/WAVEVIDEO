import { $, escapeHtml, formatTime, clamp } from './utils.js';
import { SECTIONS, SECTION_META, SWATCHES, RESOLUTIONS, FPS_OPTIONS, BITRATE_OPTIONS } from './schema.js';

/**
 * Inspector construction and transient notifications.
 *
 * Controls are generated from the declarative schema, and every control keyed
 * by a settings path registers a refresher so the panel can be re-synced after
 * a preset apply, an undo or a JSON load without rebuilding the DOM.
 */
export class UI {
  /**
   * @param {object} app application facade exposing store, actions and renderer
   */
  constructor(app) {
    this.app = app;
    this.refreshers = new Map();
    this.currentSection = 'presets';
    this.toastHost = $('#toasts');
  }

  /* ----------------------------------------------------------------- toasts */

  toast(message, kind = 'info', ttl = 3200) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.kind = kind;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span>${escapeHtml(message)}</span>`;
    this.toastHost.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 260);
    }, ttl);
    return el;
  }

  /* ------------------------------------------------------------- pane build */

  /** Build (or rebuild) the inspector for a section. */
  showSection(section) {
    const defs = SECTIONS[section];
    if (!defs) return;
    this.currentSection = section;
    this.refreshers.clear();
    $('#inspectorTitle').textContent = SECTION_META[section]?.title || section;
    const body = $('#inspectorBody');
    body.innerHTML = '';
    defs.forEach((def) => {
      const node = this._buildNode(def);
      if (node) body.appendChild(node);
    });
    this.refreshAll();
  }

  _buildNode(def) {
    switch (def.type) {
      case 'group': return this._buildGroup(def);
      case 'row': return this._buildRow(def);
      case 'note': return this._buildNote(def);
      case 'info': return this._buildInfo(def);
      case 'actions': return this._buildActions(def);
      case 'range': return this._buildRange(def);
      case 'toggle': return this._buildToggle(def);
      case 'color': return this._buildColor(def);
      case 'text': return this._buildText(def);
      case 'textarea': return this._buildTextarea(def);
      case 'select': return this._buildSelect(def);
      case 'swatches': return this._buildSwatches();
      case 'presets': return this._buildPresets();
      case 'audioSource': return this._buildAudioSource();
      case 'backdropMedia': return this._buildMedia(def);
      case 'lyricEditor': return this._buildLyricEditor();
      case 'lyricStatus': return this._buildLyricStatus();
      case 'exportGrid': return this._buildExportGrid();
      case 'exportActions': return this._buildExportActions();
      case 'exportProgress': return this._buildExportProgress();
      default: return null;
    }
  }

  _buildGroup(def) {
    const el = document.createElement('section');
    el.className = 'group';
    if (def.title) {
      const h = document.createElement('h3');
      h.textContent = def.title;
      el.appendChild(h);
    }
    def.children.forEach((child) => {
      const node = this._buildNode(child);
      if (node) el.appendChild(node);
    });
    return el;
  }

  _buildRow(def) {
    const el = document.createElement('div');
    el.className = 'grid-2';
    def.children.forEach((child) => {
      const node = this._buildNode(child);
      if (node) el.appendChild(node);
    });
    return el;
  }

  _buildNote(def) {
    const p = document.createElement('p');
    p.className = 'group-sub';
    p.textContent = def.text;
    return p;
  }

  _buildInfo(def) {
    const p = document.createElement('p');
    p.className = 'group-sub';
    p.id = def.id;
    p.textContent = '—';
    this.refreshers.set(`#${def.id}`, () => {
      const text = this.app.infoValue(def.id);
      if (text !== undefined) p.textContent = text;
    });
    return p;
  }

  _buildActions(def) {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px';
    def.buttons.forEach((btn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn small${btn.kind === 'danger' ? ' danger' : ''}`;
      b.textContent = btn.label;
      if (btn.key) b.title = `${btn.key}`;
      b.dataset.action = btn.action;
      b.addEventListener('click', () => this.app.runAction(btn.action));
      el.appendChild(b);
    });
    return el;
  }

  /* --------------------------------------------------------------- controls */

  /**
   * Wire a control to a settings path.
   * commit=true writes history on every input; otherwise history is coalesced
   * at the end of the interaction so dragging a slider is one undo step.
   */
  _bind(path, read, write, { commit = false } = {}) {
    const store = this.app.store;

    const apply = (final) => {
      const value = read();
      if (final || commit) store.set({ [path]: value }, { label: `Change ${path}` });
      else {
        if (!this._live) { store.begin(); this._live = true; }
        store.set({ [path]: value }, { history: false, silent: true });
        this.app.onLiveChange(path);
      }
    };

    const finalize = () => {
      if (this._live) {
        this._live = false;
        store.end(`Change ${path}`);
      }
    };

    return { apply, finalize };
  }

  _buildRange(def) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const head = document.createElement('span');
    head.className = 'field-h';
    const label = document.createElement('span');
    label.textContent = def.label;
    const val = document.createElement('span');
    val.className = 'val';
    head.append(label, val);
    const input = document.createElement('input');
    input.type = 'range';
    input.id = def.path;
    input.min = def.min;
    input.max = def.max;
    input.step = def.step;
    wrap.append(head, input);

    const { apply, finalize } = this._bind(def.path, () => parseFloat(input.value), null);
    input.addEventListener('input', () => apply(false));
    input.addEventListener('change', () => { apply(true); finalize(); });
    input.addEventListener('pointerup', finalize);
    input.addEventListener('keyup', finalize);
    input.addEventListener('blur', finalize);

    const fmt = (v) => {
      if (def.seconds) return `${formatTime(v, 1)} s`;
      if (def.unit === '%') return `${Math.round(v)}%`;
      if (def.unit === 'px') return `${Math.round(v)}px`;
      if (def.unit === 'deg') return `${Math.round(v)}°`;
      return Number.isInteger(parseFloat(def.step)) ? String(Math.round(v)) : v.toFixed(2);
    };

    this.refreshers.set(def.path, () => {
      const v = this.app.store.get(def.path);
      const max = def.seconds ? Math.max(def.min + 1, this.app.audioDuration() || def.max) : def.max;
      if (Number(input.max) !== max) input.max = max;
      const bounded = clamp(Number(v), Number(input.min), max);
      if (document.activeElement !== input) input.value = String(bounded);
      val.textContent = fmt(bounded);
      wrap.style.opacity = def.seconds && max <= def.min + 2 ? '.5' : '1';
    });
    return wrap;
  }

  _buildToggle(def) {
    const label = document.createElement('label');
    label.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = def.path;
    const text = document.createElement('span');
    text.textContent = def.label;
    label.append(input, text);

    const { apply } = this._bind(def.path, () => input.checked, null);
    input.addEventListener('change', () => { apply(true); this.app.store.end(`Toggle ${def.path}`); });

    this.refreshers.set(def.path, () => {
      input.checked = !!this.app.store.get(def.path);
    });
    return label;
  }

  _buildColor(def) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const cap = document.createElement('span');
    cap.textContent = def.label;
    const input = document.createElement('input');
    input.type = 'color';
    input.id = def.path;
    wrap.append(cap, input);

    const { apply, finalize } = this._bind(def.path, () => input.value, null);
    input.addEventListener('input', () => apply(false));
    input.addEventListener('change', () => { apply(true); finalize(); });

    this.refreshers.set(def.path, () => {
      const v = this.app.store.get(def.path);
      if (document.activeElement !== input) input.value = v;
    });
    return wrap;
  }

  _buildText(def) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const cap = document.createElement('span');
    cap.textContent = def.label;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = def.path;
    input.placeholder = def.placeholder || '';
    wrap.append(cap, input);

    const { apply, finalize } = this._bind(def.path, () => input.value, null);
    input.addEventListener('input', () => apply(false));
    input.addEventListener('change', () => { apply(true); finalize(); });
    input.addEventListener('blur', finalize);

    this.refreshers.set(def.path, () => {
      const v = this.app.store.get(def.path);
      if (document.activeElement !== input) input.value = v ?? '';
    });
    return wrap;
  }

  _buildTextarea(def) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const cap = document.createElement('span');
    cap.textContent = def.label;
    const input = document.createElement('textarea');
    input.id = def.path;
    if (def.rows) input.rows = def.rows;
    input.placeholder = def.placeholder || '';
    wrap.append(cap, input);

    const { apply, finalize } = this._bind(def.path, () => input.value, null);
    input.addEventListener('input', () => apply(false));
    input.addEventListener('change', () => { apply(true); finalize(); });
    input.addEventListener('blur', finalize);

    // The auto-lyrics scratch pad is not a persisted setting.
    if (def.path === 'autoLyrics') input.value = this._autoLyrics || '';
    else {
      this.refreshers.set(def.path, () => {
        const v = this.app.store.get(def.path);
        if (document.activeElement !== input) input.value = v ?? '';
      });
    }
    return wrap;
  }

  _buildSelect(def) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    const cap = document.createElement('span');
    cap.textContent = def.label;
    const select = document.createElement('select');
    select.id = def.path;
    def.options.forEach(([value, label]) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      select.appendChild(o);
    });
    wrap.append(cap, select);

    const { apply } = this._bind(def.path, () => select.value, null);
    select.addEventListener('change', () => { apply(true); this.app.store.end(`Change ${def.path}`); });

    this.refreshers.set(def.path, () => {
      select.value = String(this.app.store.get(def.path));
    });
    return wrap;
  }

  _buildSwatches() {
    const el = document.createElement('div');
    el.className = 'swatches';
    SWATCHES.forEach(([a, b]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.background = `linear-gradient(135deg,${a},${b})`;
      btn.title = `${a} to ${b}`;
      btn.setAttribute('aria-label', `Palette ${a} and ${b}`);
      btn.addEventListener('click', () => this.app.runAction('applySwatch', [a, b]));
      el.appendChild(btn);
    });
    return el;
  }

  /* ---------------------------------------------------------------- presets */

  _buildPresets() {
    const grid = document.createElement('div');
    grid.className = 'presets';
    this.app.presets.forEach((preset) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'preset';
      card.dataset.preset = preset.name;
      card.title = preset.description;

      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 135;
      const label = document.createElement('span');
      label.textContent = preset.name;

      card.append(canvas, label);
      card.addEventListener('click', () => this.app.runAction('applyPreset', preset));
      grid.appendChild(card);
      this.app.renderPresetThumbnail(canvas, preset);
    });

    this.refreshers.set('__presets', () => {
      const match = this.app.matchCurrentPreset();
      Array.from(grid.children).forEach((card) => {
        card.classList.toggle('is-active', !!match && card.dataset.preset === match.name);
      });
    });
    return grid;
  }

  /* ------------------------------------------------------------ audio source */

  _buildAudioSource() {
    const el = document.createElement('div');
    el.className = 'field';
    el.innerHTML = `
      <span>Source</span>
      <div class="dropzone" id="audioDrop" tabindex="0" role="button" aria-label="Choose or drop an audio file">
        <strong>Drop audio here</strong>
        <em>or click to browse · MP3, WAV, OGG, M4A, FLAC</em>
      </div>
      <div style="display:flex;gap:7px;margin-top:8px">
        <input type="text" id="audioUrl" placeholder="https://example.com/track.mp3" aria-label="Audio URL" />
        <button class="btn small" id="btnLoadUrl" type="button">Load</button>
      </div>
      <button class="btn small" id="btnDemo" type="button" style="margin-top:7px;align-self:flex-start">Load demo tone</button>
    `;

    const drop = el.querySelector('#audioDrop');
    drop.addEventListener('click', () => this.app.pickAudio());
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.app.pickAudio(); }
    });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) this.app.loadAudioFile(file);
    });
    el.querySelector('#btnLoadUrl').addEventListener('click', () => {
      const value = el.querySelector('#audioUrl').value.trim();
      if (value) this.app.loadAudioUrl(value);
    });
    el.querySelector('#audioUrl').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.querySelector('#btnLoadUrl').click();
    });
    el.querySelector('#btnDemo').addEventListener('click', () => this.app.loadDemoTone());
    return el;
  }

  _buildMedia(def) {
    const el = document.createElement('div');
    el.className = 'field';
    const kind = def.kind === 'logo' ? 'logo' : 'backdrop';
    const cap = document.createElement('span');
    cap.textContent = def.label || 'Image or video';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:7px';
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'btn small';
    pick.textContent = 'Choose file';
    pick.addEventListener('click', () => this.app.pickMedia(kind));
    row.appendChild(pick);
    if (kind === 'backdrop') {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'btn small danger';
      clear.textContent = 'Clear';
      clear.addEventListener('click', () => this.app.runAction('clearBackdrop'));
      row.appendChild(clear);
    }
    const info = document.createElement('p');
    info.className = 'group-sub';
    info.id = kind === 'logo' ? 'logoInfo' : 'mediaInfo';
    info.textContent = 'No media selected.';
    this.refreshers.set(`#${info.id}`, () => {
      info.textContent = this.app.infoValue(info.id);
    });
    el.append(cap, row, info);
    return el;
  }

  /* ----------------------------------------------------------------- lyrics */

  _buildLyricEditor() {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.innerHTML = `
      <span>Lyric rows</span>
      <textarea id="lyricsText" rows="10" spellcheck="false"
        placeholder="0:00.0|Intro&#10;0:12.5|First line|Primera linea&#10;0:18.0|Second *emphasis* line"></textarea>
      <p class="group-sub" style="font-size:11.5px">One row per line: <code>time|text|translation</code>. Use <code>*asterisks*</code> for per-word karaoke.</p>
    `;
    const ta = wrap.querySelector('#lyricsText');
    const { apply, finalize } = this._bind('lyricsText', () => ta.value, null);
    ta.addEventListener('input', () => apply(false));
    ta.addEventListener('change', () => { apply(true); finalize(); });
    ta.addEventListener('blur', finalize);

    this.refreshers.set('lyricsText', () => {
      const v = this.app.store.get('lyricsText');
      if (document.activeElement !== ta) ta.value = v ?? '';
    });
    return wrap;
  }

  _buildLyricStatus() {
    const p = document.createElement('p');
    p.className = 'group-sub';
    p.id = 'lyricStatus';
    this.refreshers.set('#lyricStatus', () => {
      p.textContent = this.app.infoValue('lyricStatus');
    });
    return p;
  }

  /* ----------------------------------------------------------------- export */

  _buildExportGrid() {
    const el = document.createElement('div');
    el.className = 'export-grid';

    const mk = (labelText, options, path) => {
      const wrap = document.createElement('label');
      wrap.className = 'field';
      const cap = document.createElement('span');
      cap.textContent = labelText;
      const select = document.createElement('select');
      options.forEach((opt) => {
        const o = document.createElement('option');
        o.value = typeof opt === 'string' ? opt : opt.value;
        o.textContent = typeof opt === 'string' ? opt : (opt.detail ? `${opt.label} — ${opt.detail}` : opt.label);
        select.appendChild(o);
      });
      wrap.append(cap, select);
      const { apply } = this._bind(path, () => select.value, null);
      select.addEventListener('change', () => {
        apply(true);
        this.app.store.end(`Change ${path}`);
        this.app.onResolutionChange();
      });
      this.refreshers.set(path, () => { select.value = String(this.app.store.get(path)); });
      return wrap;
    };

    el.append(
      mk('Resolution', RESOLUTIONS, 'resPreset'),
      mk('Frame rate', FPS_OPTIONS.map((f) => ({ value: f, label: `${f} fps`, detail: `capture ${f} fps` })), 'fps'),
      mk('Bitrate', BITRATE_OPTIONS, 'bitrate')
    );
    return el;
  }

  _buildExportActions() {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap';
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'btn primary small';
    start.id = 'btnStartExport';
    start.textContent = 'Start recording';
    start.addEventListener('click', () => this.app.startExport());

    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'btn small';
    stop.id = 'btnStopExport';
    stop.textContent = 'Stop and save';
    stop.disabled = true;
    stop.addEventListener('click', () => this.app.stopExport());

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn small ghost';
    cancel.id = 'btnCancelExport';
    cancel.textContent = 'Cancel';
    cancel.disabled = true;
    cancel.addEventListener('click', () => this.app.cancelExport());

    row.append(start, stop, cancel);
    this.refreshers.set('__exportButtons', () => this.app.refreshExportButtons());
    return row;
  }

  _buildExportProgress() {
    const wrap = document.createElement('div');
    wrap.className = 'progress';
    wrap.id = 'exportProgress';
    wrap.hidden = true;
    wrap.innerHTML = '<div class="progress-bar"><i id="exportBar"></i></div><p class="progress-text" id="exportStatusText">Ready</p>';
    this.refreshers.set('__exportProgress', () => this.app.refreshExportProgress());
    return wrap;
  }

  /* ------------------------------------------------------------------ refresh */

  refreshAll() {
    this.refreshers.forEach((fn) => fn());
    if (this.currentSection === 'presets') this.refreshPresets();
  }

  refreshPresets() {
    this.refreshers.get('__presets')?.();
  }

  /** The inspector body scrolls independently; keep position stable. */
  refreshPath(path) {
    const fn = this.refreshers.get(path);
    if (fn) fn();
  }

  setAutoLyrics(text) {
    this._autoLyrics = text;
    const el = document.getElementById('autoLyrics');
    if (el) el.value = text;
  }
}

export { $, formatTime, RESOLUTIONS, FPS_OPTIONS, BITRATE_OPTIONS };