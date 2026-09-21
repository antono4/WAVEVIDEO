import { Store } from './store.js';
import { UI } from './ui.js';
import { AudioEngine } from './audio.js';
import { Renderer } from './renderer.js';
import { Exporter, pickMimeType, isSupported as recorderSupported } from './exporter.js';
import { Timeline } from './timeline.js';
import { PRESETS, matchPreset, extractColors } from './presets.js';
import { parseLyrics, resolveLyricState } from './lyrics.js';
import { createDemoTone, DEMO_NAME } from './demo-tone.js';
import {
  $, $$, clamp, formatTime, formatBytes, parseResolution, downloadBlob, debounce
} from './utils.js';

/**
 * Application controller.
 *
 * Owns the audio engine, renderer, timeline, exporter and inspector, and is
 * the single place that mutates state in response to user intent. Everything
 * else in the app is a pure component driven from here.
 */
class App {
  constructor() {
    this.store = new Store();
    this.ui = new UI(this);
    this.renderer = new Renderer();
    this.audio = new AudioEngine(() => this.onPlaybackEnded());
    this.presets = PRESETS;

    this.canvas = $('#stage');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.timelineCanvas = $('#timeline');

    this.peaks = null;
    this.backdrop = { source: null, width: 0, height: 0, ready: false, name: '', isVideo: false };
    this.logo = { source: null, width: 0, height: 0, ready: false, name: '' };
    this.mediaCache = { backdrop: null, logo: null };
    this.lyricLines = [];
    this.scratch = this.loadScratch();
    this.exportState = { running: false, lastBlob: null, lastUrl: null, lastName: '' };
    this._rafHandle = 0;
    this._objectUrls = new Set();

    this.timeline = new Timeline(this.timelineCanvas, (value, intent) => this.onTimelineInput(value, intent));
    this.exporter = new Exporter({
      canvas: this.canvas,
      audio: this.audio,
      onProgress: (p) => this.onExportProgress(p),
      onFrame: () => this.draw()
    });

    this.mode = 'backdrop';
  }

  /* ------------------------------------------------------------------ boot */

  init() {
    const restored = this.store.restore();
    this.store.on('change', (e) => this.onSettingsChange(e));
    this.store.on('history', (h) => this.setHistoryButtons(h));

    this.bindShell();
    this.bindDropping();
    this.restoreMediaFromCache();

    this.ui.showSection('presets');
    this.syncCanvasSize();
    this.setHistoryButtons(this.store.historyState());

    if (restored) this.ui.toast('Restored your last session', 'info');

    // Keep the frame loop alive; it is idle-cheap when nothing is playing.
    this.startLoop();
    this.draw();

    const mime = pickMimeType();
    const supported = recorderSupported();
    this.ui.toast(
      supported
        ? `Recorder ready · ${mime.split(';')[0].replace('video/', '').toUpperCase()}`
        : 'This browser cannot record video. Preview, PNG frames and settings still work.',
      supported ? 'info' : 'warn',
      supported ? 2600 : 6000
    );
    if (!supported) $('#btnExport').title = 'Recording is unavailable in this browser';
  }

  /* ------------------------------------------------------------- scratch pad */

  loadScratch() {
    try { return localStorage.getItem('wavevideo.scratch.v1') || ''; } catch { return ''; }
  }

  saveScratch(text) {
    try { localStorage.setItem('wavevideo.scratch.v1', text); } catch { /* ignore */ }
  }

  /* ------------------------------------------------------------ shell wiring */

  bindShell() {
    // section navigation
    $('#rail').addEventListener('click', (e) => {
      const btn = e.target.closest('.rail-btn');
      if (btn) this.showSection(btn.dataset.section);
    });

    $('#btnPanelReset').addEventListener('click', () => this.resetCurrentSection());
    $('#btnUndo').addEventListener('click', () => this.store.undo());
    $('#btnRedo').addEventListener('click', () => this.store.redo());
    $('#btnReset').addEventListener('click', () => this.resetEverything());
    $('#btnHelp').addEventListener('click', () => $('#helpDialog').showModal());
    $('#btnExport').addEventListener('click', () => this.showSection('export'));
    $('#btnFullscreen').addEventListener('click', () => this.toggleFullscreen());

    $('#btnPlay').addEventListener('click', () => this.togglePlay());
    $('#btnStop').addEventListener('click', () => this.stopPlayback());
    $('#btnClearAudio').addEventListener('click', () => this.runAction('clearAudio'));

    $('#previewFit').addEventListener('change', (e) => {
      this.canvas.style.objectFit = e.target.value;
    });

    $('#btnPickAudio').addEventListener('click', () => this.pickAudio());
    $('#btnLoadDemo').addEventListener('click', () => this.loadDemoTone());

    // seek slider (the visible timeline canvas draws its own playhead)
    const seek = $('#seek');
    seek.addEventListener('input', () => {
      const duration = this.audioDuration();
      if (duration) this.audio.seek((Number(seek.value) / 1000) * duration);
    });
    seek.addEventListener('pointerdown', () => { this._draggingSeek = true; });
    ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach((ev) => {
      seek.addEventListener(ev, () => { this._draggingSeek = false; });
    });

    // hidden file inputs
    $('#audioInput').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this.loadAudioFile(file);
      e.target.value = '';
    });
    $('#settingsInput').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this.loadSettingsFile(file);
      e.target.value = '';
    });
    $('#lrcInput').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this.importLrcFile(file);
      e.target.value = '';
    });

    window.addEventListener('resize', debounce(() => this.timeline.resize(), 120));

    // keyboard shortcuts
    document.addEventListener('keydown', (e) => this.onKeyDown(e));

    // warn before leaving mid-export
    window.addEventListener('beforeunload', (e) => {
      if (this.exporter.recording) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  bindDropping() {
    const zone = $('#canvasWrap');
    const empty = $('#emptyState');
    ['dragenter', 'dragover'].forEach((ev) => window.addEventListener(ev, (e) => {
      e.preventDefault();
      empty?.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach((ev) => window.addEventListener(ev, () => empty?.classList.remove('is-over')));
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(file.name)) {
        this.loadAudioFile(file);
      } else if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        this.loadMediaFile(file, this.mode);
      } else {
      }
    });
    zone.addEventListener('dblclick', () => {
      const el = document.fullscreenElement;
      if (!el) this.toggleFullscreen();
    });
  }

  onKeyDown(e) {
    const tag = e.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
    const meta = e.ctrlKey || e.metaKey;

    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }
    if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); this.store.redo(); return; }
    if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); this.runAction('saveSettings'); return; }
    if (meta && e.key.toLowerCase() === 'e') { e.preventDefault(); this.showSection('export'); return; }

    if (typing) return;

    if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); this.audio.seek(this.audio.currentTime - 5); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); this.audio.seek(this.audio.currentTime + 5); return; }
    if (e.key === 'Home') { e.preventDefault(); this.audio.seek(0); return; }
    if (e.key === 'End') { e.preventDefault(); this.audio.seek(this.audioDuration()); return; }
    if (e.key === 'f' || e.key === 'F') { this.toggleFullscreen(); return; }
    if (e.key === 'i' || e.key === 'I') { this.runAction('lyricStamp'); return; }
    if (/^[1-8]$/.test(e.key)) {
      const order = ['presets', 'audio', 'visualizer', 'backdrop', 'titles', 'lyrics', 'elements', 'export'];
      this.showSection(order[Number(e.key) - 1]);
    }
    if (e.key === 'Escape' && document.fullscreenElement) document.exitFullscreen();
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else this.canvas.requestFullscreen?.().catch(() => this.ui.toast('Fullscreen was blocked', 'warn'));
  }

  /* --------------------------------------------------------------- sections */

  showSection(section) {
    if (!section) return;
    $$('.rail-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.section === section));
    this.ui.showSection(section);
  }

  resetCurrentSection() {
    const keysBySection = {
      audio: ['volume', 'fadeIn', 'fadeOut', 'trimEnabled', 'trimStart', 'trimEnd'],
      visualizer: ['visType', 'barCount', 'gain', 'bassBoost', 'glow', 'mirrorOn', 'beatScale',
        'rotation', 'lineWidth', 'lineStyle', 'beatSensitivity', 'screenPulse', 'screenFlash',
        'colorMode', 'color1', 'color2'],
      backdrop: ['bgType', 'bgColor1', 'bgColor2', 'bgAngle', 'bgBlur', 'bgZoom', 'bgMotion', 'bgDim', 'vignette'],
      titles: ['titleText', 'titleFont', 'titleWeight', 'titleSize', 'titleColor', 'titleX', 'titleY',
        'titleSpacing', 'titleShadow', 'subText', 'subSize', 'subColor', 'subX', 'subY',
        'logoEnabled', 'logoSize', 'logoX', 'logoY'],
      lyrics: ['lyricsOn', 'lyricsText', 'lyricSize', 'lyricY', 'lyricColor', 'lyricDim',
        'lyricKaraoke', 'lyricShowNeighbours'],
      elements: ['elGhostBars', 'elParticles', 'elRing', 'elTopSpec', 'elCenterLine', 'elGrid',
        'elNoise', 'elOpacity'],
      export: ['resPreset', 'fps', 'bitrate']
    };
    const keys = keysBySection[this.ui.currentSection];
    if (!keys) {
      this.ui.toast('This section has nothing to reset', 'info');
      return;
    }
    this.store.resetSection(keys, `Reset ${this.ui.currentSection}`);
    this.ui.toast(`Reset ${this.ui.currentSection}`, 'ok');
  }

  resetEverything() {
    if (!confirm('Reset every setting to its default? Your audio stays loaded.')) return;
    this.store.resetAll();
    this.clearMedia('backdrop');
    this.clearMedia('logo');
    this.ui.showSection(this.ui.currentSection);
    this.ui.toast('Everything reset', 'ok');
  }

  /* --------------------------------------------------------------- settings */

  onSettingsChange(e) {
    const keys = e.keys || [];
    keys.forEach((k) => this.ui.refreshPath(k));
    this.ui.refreshPresets();
    this.syncCanvasSize();
    this.timeline.setTrim(this.trimRange());
    if (keys.includes('trimEnabled') || keys.includes('trimStart') || keys.includes('trimEnd')) {
      this.updateTrimUI();
    }
    if (keys.includes('lyricsText') || keys.includes('lyricsOn')) {
      this.lyricLines = parseLyrics(this.store.get('lyricsText'));
      this.timeline.setMarkers(this.lyricLines.map((l) => l.time));
    }
    this.applyGain();
    this.draw();
  }

  onLiveChange() {
    this.applyGain();
  }

  setHistoryButtons({ canUndo, canRedo }) {
    const u = $('#btnUndo');
    const r = $('#btnRedo');
    if (u) u.disabled = !canUndo;
    if (r) r.disabled = !canRedo;
  }

  /* ------------------------------------------------------------------ audio */

  audioDuration() {
    return this.audio.duration;
  }

  /** Effective export range, honouring the trim controls. */
  trimRange() {
    const duration = this.audioDuration();
    const enabled = !!this.store.get('trimEnabled');
    const start = enabled ? clamp(this.store.get('trimStart'), 0, duration) : 0;
    const end = enabled ? clamp(this.store.get('trimEnd') || duration, start + 0.5, duration) : duration;
    return { enabled, start, end: end || duration };
  }

  updateTrimUI() {
    const duration = this.audioDuration();
    const start = this.store.get('trimStart');
    const end = this.store.get('trimEnd');
    // Keep the end point glued to the track once audio is known.
    if (duration && (!end || end > duration)) this.store.set({ trimEnd: duration }, { history: false });
    if (duration && start > duration) this.store.set({ trimStart: 0 }, { history: false });
    this.ui.refreshPath('trimStart');
    this.ui.refreshPath('trimEnd');
  }

  applyGain() {
    const range = this.trimRange();
    this.audio.applyGain({
      volume: Number(this.store.get('volume')),
      fadeIn: Number(this.store.get('fadeIn')),
      fadeOut: Number(this.store.get('fadeOut')),
      start: range.start,
      end: range.end
    });
  }

  pickAudio() {
    $('#audioInput').click();
  }

  async loadAudioFile(file) {
    this.setStatus('loading', `Decoding ${file.name}…`);
    try {
      const buffer = await file.arrayBuffer();
      try {
        await this.audio.decode(buffer);
      } catch {
        // Containers the decoder rejects fall back to an element source, which
        // still feeds the analyser.
        const url = this.trackUrl(URL.createObjectURL(file));
        this.audio.useElement(url);
        this.ui.toast('Decoded via media element fallback', 'warn');
      }
      this.afterAudioLoad(file.name);
    } catch (err) {
      this.setStatus('idle', 'Could not load audio');
      this.ui.toast(`Could not load audio: ${err.message}`, 'error');
    }
  }

  async loadAudioUrl(url) {
    this.setStatus('loading', 'Fetching audio…');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      await this.audio.decode(buffer);
      this.afterAudioLoad(decodeURIComponent(url.split('/').pop() || 'remote track'));
    } catch (err) {
      // Cross-origin files often cannot be fetched but can still be streamed.
      try {
        this.audio.useElement(url);
        this.afterAudioLoad(decodeURIComponent(url.split('/').pop() || 'remote track'));
        this.ui.toast('Streaming via media element', 'info');
      } catch {
        this.setStatus('idle', 'Could not load audio');
        this.ui.toast(`Could not load from URL: ${err.message}`, 'error');
      }
    }
  }

  loadDemoTone() {
    const blob = createDemoTone(12, 100);
    const file = new File([blob], DEMO_NAME, { type: 'audio/wav' });
    this.loadAudioFile(file);
    this.ui.toast('Loaded a 12 second demo tone', 'ok');
  }

  async afterAudioLoad(name) {
    const duration = this.audioDuration();
    this.trackName = name;
    this.peaks = this.audio.buildPeaks(1200);
    this.timeline.setPeaks(this.peaks, duration);
    this.store.set({ trimStart: 0, trimEnd: duration }, { history: false });
    this.lyricLines = parseLyrics(this.store.get('lyricsText'));
    this.timeline.setMarkers(this.lyricLines.map((l) => l.time));
    this.timeline.setTrim(this.trimRange());
    this.refreshAudioChrome();
    this.updateTrimUI();
    this.setStatus('ready', 'Ready');
    this.draw();
    const fallback = this.audio.usingElement ? ' (element fallback)' : '';
    this.ui.toast(`Loaded ${name} · ${formatTime(duration)}${fallback}`, 'ok');
  }

  refreshAudioChrome() {
    const duration = this.audioDuration();
    const has = !!this.trackName;
    $('#trackChip').hidden = !has;
    $('#emptyState').hidden = has;
    $('#btnPlay').disabled = !has;
    $('#btnStop').disabled = !has;
    $('#trackName').textContent = this.trackName || '—';
    const buffer = this.audio.buffer;
    $('#trackMeta').textContent = buffer
      ? `${formatTime(duration)} · ${(buffer.sampleRate / 1000).toFixed(1)} kHz`
      : has ? formatTime(duration) : '';
    $('#timeLabel').textContent = `${formatTime(this.audio.currentTime)} / ${formatTime(duration)}`;
    this.ui.refreshPath('trimStart');
    this.ui.refreshPath('trimEnd');
  }

  clearAudio() {
    this.audio.clear();
    this.trackName = '';
    this.peaks = null;
    this.timeline.setPeaks(null, 0);
    this.timeline.setMarkers([]);
    this.refreshAudioChrome();
    this.setStatus('idle', 'Ready');
    this.draw();
    this.ui.toast('Audio removed', 'info');
  }

  /* -------------------------------------------------------------- transport */

  async togglePlay() {
    if (!this.trackName) return;
    if (this.audio.playing) this.pausePlayback();
    else await this.startPlayback();
  }

  async startPlayback(from) {
    if (!this.trackName) return;
    const range = this.trimRange();
    let offset = from === undefined ? this.audio.currentTime : from;
    if (range.enabled && (offset < range.start - 0.05 || offset > range.end - 0.02)) offset = range.start;
    await this.audio.play(offset);
    this.applyGain();
    this.setStatus('playing', 'Playing');
    $('#playLabel').textContent = 'Pause';
    $('#playIcon')?.querySelector('use')?.setAttribute('href', '#i-pause');
  }

  pausePlayback() {
    this.audio.pause();
    this.setStatus('ready', 'Paused');
    $('#playLabel').textContent = 'Play';
    $('#playIcon')?.querySelector('use')?.setAttribute('href', '#i-play');
  }

  stopPlayback() {
    this.audio.stop();
    this.setStatus('ready', 'Ready');
    $('#playLabel').textContent = 'Play';
    $('#playIcon')?.querySelector('use')?.setAttribute('href', '#i-play');
  }

  onPlaybackEnded() {
    this.setStatus('ready', 'Finished');
    $('#playLabel').textContent = 'Play';
    $('#playIcon')?.querySelector('use')?.setAttribute('href', '#i-play');
  }

  onTimelineInput(value, intent) {
    const duration = this.audioDuration();
    if (!duration) return;
    if (intent === 'trimStart') {
      this.store.begin();
      this.store.set({ trimStart: value, trimEnabled: true }, { history: false, silent: true });
      this.timeline.setTrim({ enabled: true, start: value, end: this.store.get('trimEnd') });
      return;
    }
    if (intent === 'trimEnd') {
      this.store.begin();
      this.store.set({ trimEnd: value, trimEnabled: true }, { history: false, silent: true });
      this.timeline.setTrim({ enabled: true, start: this.store.get('trimStart'), end: value });
      return;
    }
    if (intent === 'trimStartCommit' || intent === 'trimEndCommit') {
      this.store.end('Adjust trim');
      this.ui.refreshPath('trimStart');
      this.ui.refreshPath('trimEnd');
      this.ui.refreshPath('trimEnabled');
      return;
    }
    this.audio.seek(value).then(() => this.refreshAudioChrome());
  }

  /* ------------------------------------------------------------------ media */

  pickMedia(kind) {
    this.mode = kind === 'logo' ? 'logo' : 'backdrop';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'logo' ? 'image/*' : 'image/*,video/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) this.loadMediaFile(file, this.mode);
    });
    input.click();
  }

  trackUrl(url) {
    this._objectUrls.add(url);
    return url;
  }

  releaseUrl(url) {
    if (!url) return;
    URL.revokeObjectURL(url);
    this._objectUrls.delete(url);
  }

  /**
   * Load an image or video into the backdrop or logo slot.
   * Also stores the file in IndexedDB so a reload does not lose the artwork.
   */
  loadMediaFile(file, kind) {
    const target = kind === 'logo' ? this.logo : this.backdrop;
    const isVideo = file.type.startsWith('video/');
    if (kind === 'logo' && isVideo) {
      this.ui.toast('The logo overlay accepts images only', 'warn');
      return;
    }
    const url = this.trackUrl(URL.createObjectURL(file));
    const done = (source, width, height) => {
      target.source = source;
      target.width = width;
      target.height = height;
      target.ready = true;
      target.name = file.name;
      target.isVideo = isVideo;
      this.ui.refreshPath('#mediaInfo');
      this.ui.refreshPath('#logoInfo');
      this.draw();
      this.ui.toast(`Loaded ${file.name}`, 'ok');
      this.cacheMedia(file, kind);
    };

    if (isVideo) {
      const video = document.createElement('video');
      video.src = url;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.addEventListener('loadeddata', () => {
        video.play().catch(() => {});
        done(video, video.videoWidth, video.videoHeight);
      });
      video.addEventListener('error', () => this.ui.toast('Could not read that video', 'error'));
    } else {
      const img = new Image();
      img.onload = () => done(img, img.naturalWidth, img.naturalHeight);
      img.onerror = () => this.ui.toast('Could not read that image', 'error');
      img.src = url;
    }

    if (kind === 'backdrop') {
      const type = isVideo ? 'video' : 'image';
      this.store.set({ bgType: type }, { label: 'Backdrop media' });
    }
  }

  clearMedia(kind = 'backdrop') {
    const target = kind === 'logo' ? this.logo : this.backdrop;
    if (target.source && target.isVideo) {
      try { target.source.pause(); } catch { /* ignore */ }
    }
    this.releaseUrl(target.source?.src);
    target.source = null;
    target.ready = false;
    target.name = '';
    target.isVideo = false;
    this.mediaCache[kind] = null;
    this.ui.refreshPath('#mediaInfo');
    this.ui.refreshPath('#logoInfo');
    this.draw();
  }

  /** Persist the chosen artwork so a reload restores the look. */
  async cacheMedia(file, kind) {
    this.mediaCache[kind] = file;
    try {
      const db = await this.openDb();
      const tx = db.transaction('media', 'readwrite');
      tx.objectStore('media').put({ kind, file, name: file.name, savedAt: Date.now() });
    } catch {
      /* private mode or no IndexedDB — non-fatal */
    }
  }

  openDb() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('wavevideo', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'kind' });
      };
      req.onsuccess = () => { this._db = req.result; resolve(req.result); };
      req.onerror = () => reject(req.error);
    });
  }

  async restoreMediaFromCache() {
    try {
      const db = await this.openDb();
      const tx = db.transaction('media', 'readonly');
      const store = tx.objectStore('media');
      const req = store.getAll();
      req.onsuccess = () => {
        (req.result || []).forEach((entry) => {
          if (!entry?.file) return;
          this.loadMediaFile(entry.file, entry.kind);
        });
      };
    } catch {
      /* nothing cached */
    }
  }

  /* ----------------------------------------------------------------- lyrics */

  lyricStamp() {
    if (!this.trackName) { this.ui.toast('Load audio before stamping lyrics', 'warn'); return; }
    const t = this.audio.currentTime;
    const text = prompt(`Lyric text at ${formatTime(t)}:`, '');
    if (!text) return;
    const current = this.store.get('lyricsText') || '';
    const stamp = `${formatTime(t)}|${text}`;
    this.store.set({ lyricsText: current.trim() ? `${current.trimEnd()}\n${stamp}` : stamp, lyricsOn: true },
      { label: 'Add lyric line' });
    this.ui.toast('Lyric line added', 'ok');
  }

  lyricAuto() {
    const raw = this.scratch;
    if (!raw.trim()) { this.ui.toast('Paste plain lyrics first', 'warn'); return; }
    const duration = this.audioDuration();
    if (!duration) { this.ui.toast('Load audio so the duration is known', 'warn'); return; }
    const range = this.trimRange();
    const start = range.enabled ? range.start : 1;
    const end = Math.max(start + 1, (range.enabled ? range.end : duration) - 2);
    const rows = raw.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    const step = (end - start) / rows.length;
    const text = rows.map((row, i) => `${formatTime(start + step * i)}|${row}`).join('\n');
    this.store.set({ lyricsText: text, lyricsOn: true }, { label: 'Distribute lyrics' });
    this.ui.toast(`${rows.length} lines distributed`, 'ok');
  }

  lyricClear() {
    this.store.set({ lyricsText: '' }, { label: 'Clear lyrics' });
    this.ui.toast('Lyrics cleared', 'info');
  }

  lyricImport() {
    $('#lrcInput').click();
  }

  importLrcFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      const { parseLrc, serializeLyrics } = await import('./lyrics.js');
      const lines = parseLrc(reader.result);
      if (!lines.length) { this.ui.toast('No timestamps found in that file', 'warn'); return; }
      this.store.set({ lyricsText: serializeLyrics(lines), lyricsOn: true }, { label: 'Import LRC' });
      this.ui.toast(`Imported ${lines.length} lyric lines`, 'ok');
    };
    reader.readAsText(file);
  }

  async exportLrc() {
    const lines = parseLyrics(this.store.get('lyricsText'));
    if (!lines.length) { this.ui.toast('There are no timed lyrics to export', 'warn'); return; }
    const { serializeLrc } = await import('./lyrics.js');
    const text = serializeLrc(lines, {
      artist: this.store.get('subText'),
      title: this.store.get('titleText')
    });
    downloadBlob(text, `${safeName(this.trackName || 'lyrics')}.lrc`, 'text/plain');
    this.ui.toast('LRC exported', 'ok');
  }

  /* --------------------------------------------------------------- presets */

  applyPreset(preset) {
    // Preserve the user's titles and logo, which are identity rather than look.
    const keep = {
      titleText: this.store.get('titleText'),
      subText: this.store.get('subText'),
      titleFont: this.store.get('titleFont'),
      logoEnabled: this.store.get('logoEnabled')
    };
    this.store.set({ ...preset.settings, ...keep }, { label: `Preset ${preset.name}` });
    this.ui.toast(`Applied ${preset.name}`, 'ok');
  }

  matchCurrentPreset() {
    return matchPreset(this.store.settings, this.presets);
  }

  /**
   * Render a preset thumbnail with the real engine using a synthetic spectrum,
   * so previews match the canvas and cost no audio.
   */
  renderPresetThumbnail(canvas, preset) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const analysis = Renderer.syntheticAnalysis(preset.settings.barCount, 3, preset.name.length * 17);
    const merged = {
      ...preset.settings,
      titleText: '',
      subText: '',
      lyricsOn: false,
      screenFlash: 0
    };
    this.renderer.drawFrame(ctx, {
      w, h, t: 2.4,
      settings: merged,
      bins: analysis.bins,
      wave: null,
      bass: analysis.bass,
      energy: analysis.energy,
      beat: analysis.beat,
      backdrop: null,
      logo: null,
      lyricLines: [],
      freezeMotion: true
    });
  }

  /* ------------------------------------------------------------- rendering */

  syncCanvasSize() {
    const [w, h] = parseResolution(this.store.get('resPreset'));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    $('#canvasInfo').textContent = `${w} × ${h} · ${this.store.get('fps')} fps`;
    this.timeline.resize();
  }

  onResolutionChange() {
    this.syncCanvasSize();
    this.draw();
  }

  startLoop() {
    const loop = () => {
      this.tick();
      this._rafHandle = requestAnimationFrame(loop);
    };
    this._rafHandle = requestAnimationFrame(loop);
  }

  tick() {
    const t = this.audio.currentTime;
    if (this.audio.playing) {
      this.timeline.setPlayhead(t);
      if (!this._draggingSeek) {
        const duration = this.audioDuration();
        if (duration) $('#seek').value = String(Math.round((t / duration) * 1000));
      }
      this.applyGain();
      this.draw();
      this.updateTimeLabel(t);
      const range = this.trimRange();
      if (range.enabled && t >= range.end - 0.05) {
        this.audio.pause();
        this.onPlaybackEnded();
      }
    } else if (this._needsRedraw) {
      this.draw();
      this._needsRedraw = false;
    }
    if (this.exporter.recording) this.draw();
  }

  updateTimeLabel(t) {
    $('#timeLabel').textContent = `${formatTime(t ?? this.audio.currentTime)} / ${formatTime(this.audioDuration())}`;
  }

  draw() {
    const analysis = this.audio.analyse({
      barCount: Number(this.store.get('barCount')),
      smoothing: 0.78,
      bassBoost: Number(this.store.get('bassBoost')),
      gain: Number(this.store.get('gain')),
      beatSensitivity: Number(this.store.get('beatSensitivity'))
    });

    this.renderer.drawFrame(this.ctx, {
      w: this.canvas.width,
      h: this.canvas.height,
      t: this.audio.currentTime,
      settings: this.store.settings,
      bins: analysis,
      wave: this.audio.wave,
      bass: this.audio.bass,
      energy: this.audio.energy,
      beat: this.audio.beat,
      duration: this.audioDuration(),
      backdrop: this.backdrop,
      logo: this.logo,
      lyricLines: this.lyricLines
    });
  }

  /* ----------------------------------------------------------------- export */

  exportRange() {
    const range = this.trimRange();
    const duration = this.audioDuration();
    const start = range.enabled ? range.start : 0;
    const end = range.enabled ? range.end : duration;
    return { start, end: Math.max(start + 0.5, end) };
  }

  async startExport() {
    if (!this.trackName) {
      this.ui.toast('Load audio before exporting', 'warn');
      this.showSection('audio');
      return;
    }
    if (!recorderSupported()) {
      this.ui.toast('This browser cannot record video', 'error');
      return;
    }
    const { start, end } = this.exportRange();
    this.exportState.running = true;
    this.refreshExportButtons();
    this.setStatus('recording', 'Recording');

    // Frame the canvas at final resolution before capture begins.
    this.syncCanvasSize();

    // Resume the context while the click that started the export still grants
    // user activation, otherwise the recorder can only capture silent video.
    this.audio.ensureContext();
    const resumed = await this.audio.resume();
    if (resumed !== 'running') {
      this.ui.toast('Audio is blocked until you interact with the page — recording silent video', 'warn', 5000);
    }

    await this.audio.seek(start);

    try {
      const result = await this.exporter.start({
        fps: Number(this.store.get('fps')),
        bitrate: Number(this.store.get('bitrate')),
        start,
        end,
        currentTime: () => this.audio.currentTime,
        onStart: async () => {
          await this.startPlayback(start);
        }
      });
      this.finishExport(result);
    } catch (err) {
      this.failExport(err);
    }
  }

  finishExport(result) {
    const ext = result.mimeType.includes('mp4') ? 'mp4' : 'webm';
    const base = safeName(this.trackName || 'visualizer');
    const name = `${base}-visualizer.${ext}`;
    if (this.exportState.lastUrl) this.releaseUrl(this.exportState.lastUrl);
    const url = this.trackUrl(URL.createObjectURL(result.blob));
    this.exportState = { running: false, lastBlob: result.blob, lastUrl: url, lastName: name };

    downloadBlob(result.blob, name);
    this.ui.refreshPath('#lastExport');
    this.setStatus('ready', 'Export complete');
    this.refreshExportButtons();
    this.ui.toast(
      result.hasAudio
        ? `Exported ${formatBytes(result.blob.size)} with audio`
        : `Exported ${formatBytes(result.blob.size)} (silent)`,
      'ok'
    );
    this.draw();
  }

  failExport(err) {
    this.exportState.running = false;
    this.audio.pause();
    this.audio.detachRecorder();
    this.refreshExportButtons();
    this.setStatus('ready', 'Export failed');
    this.ui.toast(`Export failed: ${err.message}`, 'error');
  }

  stopExport() {
    this.exporter.stop();
    this.ui.toast('Finishing export…', 'info');
  }

  cancelExport() {
    this.exporter.cancel();
    this.exportState.running = false;
    this.audio.pause();
    this.refreshExportButtons();
    this.setStatus('ready', 'Export cancelled');
    this.ui.toast('Export cancelled', 'warn');
  }

  onExportProgress(p) {
    const bar = $('#exportBar');
    const text = $('#exportStatusText');
    if (bar) bar.style.width = `${(p.ratio * 100).toFixed(1)}%`;
    if (text) {
      text.textContent = `${formatTime(p.playhead)} of ${formatTime(p.end)} · ${p.frames} frames · ${formatTime(Math.max(0, p.eta))} left`;
    }
  }

  refreshExportButtons() {
    const start = document.getElementById('btnStartExport');
    const stop = document.getElementById('btnStopExport');
    const cancel = document.getElementById('btnCancelExport');
    const running = this.exporter.recording;
    if (start) { start.disabled = running; start.textContent = running ? 'Recording…' : 'Start recording'; }
    if (stop) stop.disabled = !running;
    if (cancel) cancel.disabled = !running;
  }

  refreshExportProgress() { /* progress is pushed by the exporter */ }

  /* ------------------------------------------------------------ misc actions */

  saveFrame() {
    this.draw();
    const a = document.createElement('a');
    a.href = this.canvas.toDataURL('image/png');
    a.download = `${safeName(this.trackName || 'visualizer')}-frame.png`;
    a.click();
    this.ui.toast('Frame saved as PNG', 'ok');
  }

  saveSettings() {
    downloadBlob(this.store.toJSON({ track: this.trackName || '' }), 'wavevideo-settings.json', 'application/json');
    this.ui.toast('Settings exported', 'ok');
  }

  loadSettings() {
    $('#settingsInput').click();
  }

  loadSettingsFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const count = this.store.fromJSON(reader.result);
        this.ui.showSection(this.ui.currentSection);
        this.syncCanvasSize();
        this.ui.toast(`Loaded ${count} settings`, 'ok');
      } catch (err) {
        this.ui.toast(`Invalid settings file: ${err.message}`, 'error');
      }
    };
    reader.readAsText(file);
  }

  downloadLast() {
    if (!this.exportState.lastBlob) {
      this.ui.toast('There is no finished export yet', 'warn');
      return;
    }
    downloadBlob(this.exportState.lastBlob, this.exportState.lastName || 'visualizer.webm');
  }

  extractColors() {
    if (!this.backdrop.ready) {
      this.ui.toast('Load a backdrop image or video first', 'warn');
      return;
    }
    const colors = extractColors(this.backdrop.source, this.backdrop.width, this.backdrop.height);
    if (!colors) {
      this.ui.toast('That backdrop cannot be sampled (cross-origin)', 'warn');
      return;
    }
    this.store.set(
      { color1: colors.primary, color2: colors.secondary, colorMode: 'gradient' },
      { label: 'Extract colours' }
    );
    this.ui.refreshPath('color1');
    this.ui.refreshPath('color2');
    this.ui.refreshPath('colorMode');
    this.ui.toast('Colours pulled from the backdrop', 'ok');
  }

  applySwatch(a, b) {
    this.store.set({ color1: a, color2: b }, { label: 'Palette' });
    this.ui.refreshPath('color1');
    this.ui.refreshPath('color2');
  }

  /** Dispatch table used by the inspector action buttons. */
  runAction(action, args) {
    const table = {
      clearAudio: () => this.clearAudio(),
      clearBackdrop: () => this.clearMedia('backdrop'),
      trimStartHere: () => this.store.set({ trimStart: this.audio.currentTime, trimEnabled: true }, { label: 'Trim start' }),
      trimEndHere: () => this.store.set({ trimEnd: this.audio.currentTime, trimEnabled: true }, { label: 'Trim end' }),
      trimClear: () => this.store.set({ trimEnabled: false, trimStart: 0, trimEnd: this.audioDuration() }, { label: 'Clear trim' }),
      lyricStamp: () => this.lyricStamp(),
      lyricAuto: () => this.lyricAuto(),
      lyricClear: () => this.lyricClear(),
      lyricImport: () => this.lyricImport(),
      lyricExport: () => this.exportLrc(),
      saveFrame: () => this.saveFrame(),
      saveSettings: () => this.saveSettings(),
      loadSettings: () => this.loadSettings(),
      downloadLast: () => this.downloadLast(),
      extractColors: () => this.extractColors(),
      applySwatch: () => this.applySwatch(args?.[0], args?.[1]),
      applyPreset: () => args && this.applyPreset(args)
    };
    const fn = table[action];
    if (fn) fn();
    else this.ui.toast(`Unknown action: ${action}`, 'warn');
  }

  /* ---------------------------------------------------------------- helpers */

  setStatus(state, text) {
    $('#statusDot').dataset.state = state;
    $('#statusText').textContent = text;
  }

  /** Values for read-only info rows in the inspector. */
  infoValue(id) {
    switch (id) {
      case 'audioInfo': {
        if (!this.trackName) return 'No audio loaded.';
        const b = this.audio.buffer;
        const mode = this.audio.usingElement ? 'element fallback' : 'decoded buffer';
        return b
          ? `${this.trackName} · ${formatTime(this.audioDuration())} · ${(b.sampleRate / 1000).toFixed(1)} kHz · ${b.numberOfChannels} ch · ${mode}`
          : `${this.trackName} · ${formatTime(this.audioDuration())} · ${mode}`;
      }
      case 'mediaInfo':
        return this.backdrop.ready
          ? `${this.backdrop.name} · ${this.backdrop.width}×${this.backdrop.height}${this.backdrop.isVideo ? ' · video' : ''}`
          : 'No media selected.';
      case 'logoInfo':
        return this.logo.ready ? `${this.logo.name} · ${this.logo.width}×${this.logo.height}` : 'No logo selected.';
      case 'lyricStatus': {
        const lines = parseLyrics(this.store.get('lyricsText'));
        if (!lines.length) return 'No timed lines yet.';
        const active = resolveLyricState(lines, this.audio.currentTime, this.audioDuration());
        const idx = active ? active.activeIndex + 1 : 0;
        return `${lines.length} lines · currently line ${idx}`;
      }
      case 'lastExport':
        return this.exportState.lastBlob
          ? `${this.exportState.lastName} · ${formatBytes(this.exportState.lastBlob.size)}`
          : 'No export yet.';
      default:
        return undefined;
    }
  }
}

function safeName(name) {
  return String(name || 'visualizer')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'visualizer';
}

const app = new App();
app.init();

// Exposed for debugging and for integration tests driving the real UI.
window.wavevideo = app;
