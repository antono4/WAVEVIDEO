import { clamp, formatShort } from './utils.js';

/**
 * Waveform timeline with trim handles and lyric markers.
 *
 * Drawn on demand rather than per animation frame: the peak envelope and the
 * static chrome are cached to an offscreen canvas and only the playhead is
 * repainted, which keeps it cheap even on long tracks.
 */
export class Timeline {
  constructor(canvas, onSeek) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSeek = onSeek;
    this.peaks = null;
    this.duration = 0;
    this.playhead = 0;
    this.markers = [];
    this.trim = { enabled: false, start: 0, end: 0 };
    this._base = document.createElement('canvas');
    this._baseCtx = this._base.getContext('2d');
    this._drag = null;
    this._dpr = 1;

    this._bindPointer();
    this._observeResize();
  }

  /* ------------------------------------------------------------------ input */

  _bindPointer() {
    this.canvas.style.cursor = 'pointer';
    const posToTime = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      return ratio * this.duration;
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.duration) return;
      const t = posToTime(e);
      const { start, end } = this.trim;
      const handleReach = this.duration * 0.012;
      const nearStart = this.trim.enabled && Math.abs(t - start) < handleReach;
      const nearEnd = this.trim.enabled && Math.abs(t - end) < handleReach;
      if (nearStart || nearEnd) {
        this._drag = nearStart ? 'trimStart' : 'trimEnd';
      } else {
        this._drag = 'playhead';
        this.onSeek(t, 'seek');
      }
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = 'grabbing';
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.duration) return;
      const t = posToTime(e);
      if (this._drag === 'trimStart') this.onSeek(clamp(t, 0, Math.max(0, this.trim.end - 0.5)), 'trimStart');
      else if (this._drag === 'trimEnd') this.onSeek(clamp(t, this.trim.start + 0.5, this.duration), 'trimEnd');
      else if (this._drag === 'playhead') this.onSeek(t, 'seek');
      else {
        const { start, end } = this.trim;
        const handleReach = this.duration * 0.012;
        const near = this.trim.enabled && (Math.abs(t - start) < handleReach || Math.abs(t - end) < handleReach);
        this.canvas.style.cursor = near ? 'ew-resize' : 'pointer';
      }
    });

    const release = (e) => {
      if (this._drag) {
        const kind = this._drag;
        this._drag = null;
        this.canvas.style.cursor = 'pointer';
        if (kind !== 'playhead') this.onSeek(posToTime(e), `${kind}Commit`);
      }
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
  }

  _observeResize() {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.canvas);
  }

  /* ------------------------------------------------------------------ state */

  setPeaks(peaks, duration) {
    this.peaks = peaks;
    this.duration = duration || 0;
    this.resize();
  }

  setPlayhead(t) {
    if (!this.duration) return;
    const next = clamp(t, 0, this.duration);
    // Sub-pixel moves are not worth a repaint.
    if (Math.abs(next - this.playhead) * this._pxPerSecond() < 0.5) return;
    this.playhead = next;
    this._paint();
  }

  setMarkers(markers) {
    this.markers = markers || [];
    this._paint();
  }

  setTrim(trim) {
    this.trim = trim;
    this._paint();
  }

  _pxPerSecond() {
    return this._dpr ? this.canvas.width / Math.max(0.001, this.duration) : 1;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(320, Math.round(rect.width * dpr));
    const h = Math.max(48, Math.round((rect.height || 68) * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this._dpr = dpr;
    this._redrawBase();
    this._paint();
  }

  /* --------------------------------------------------------------- painting */

  _redrawBase() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    this._base.width = w;
    this._base.height = h;
    const ctx = this._baseCtx;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#0c0e15';
    ctx.fillRect(0, 0, w, h);

    // time ruler
    ctx.strokeStyle = '#232839';
    ctx.fillStyle = '#6f778d';
    ctx.font = `${Math.round(h * 0.17)}px ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    const targetTicks = 10;
    const rawStep = this.duration / targetTicks || 1;
    const niceSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = niceSteps.find((s) => s >= rawStep) || 600;
    if (this.duration) {
      for (let t = 0; t <= this.duration; t += step) {
        const x = (t / this.duration) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h * 0.18);
        ctx.stroke();
        ctx.fillText(formatShort(t), x + 4, h * 0.03);
      }
    }

    if (!this.peaks || !this.duration) {
      ctx.fillStyle = '#6f778d';
      ctx.font = `${Math.round(h * 0.22)}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText('Load audio to see the waveform', w / 2, h * 0.58);
      return;
    }

    // waveform
    const mid = h * 0.58;
    const amp = h * 0.34;
    const count = this.peaks.length / 2;
    const barW = w / count;
    ctx.fillStyle = '#3a4360';
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const max = this.peaks[i * 2 + 1];
      const min = this.peaks[i * 2];
      const x = i * barW;
      ctx.rect(x, mid - max * amp, Math.max(barW * 0.8, 1), Math.max(1, (max - min) * amp));
    }
    ctx.fill();

    // played portion tint
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#8b5cf6');
    grad.addColorStop(1, '#06b6d4');
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  _paint() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this._base, 0, 0);

    if (!this.duration) return;
    const x = (t) => (t / this.duration) * w;

    // playhead-driven highlight of the played region
    const px = x(this.playhead);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(px, 0, w - px, h);
    ctx.restore();

    // lyric markers
    if (this.markers.length) {
      ctx.save();
      ctx.fillStyle = '#06b6d4';
      ctx.globalAlpha = 0.75;
      for (const m of this.markers) {
        const mx = x(m);
        if (mx < -2 || mx > w + 2) continue;
        ctx.fillRect(mx, h * 0.82, Math.max(1, w / 1600), h * 0.16);
      }
      ctx.restore();
    }

    // trim handles
    if (this.trim.enabled) {
      const sx = x(clamp(this.trim.start, 0, this.duration));
      const ex = x(clamp(this.trim.end, 0, this.duration));
      ctx.save();
      ctx.fillStyle = '#8b5cf61a';
      ctx.fillRect(0, 0, sx, h);
      ctx.fillRect(ex, 0, w - ex, h);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = Math.max(1.5, h * 0.03);
      [sx, ex].forEach((hx) => {
        ctx.beginPath();
        ctx.moveTo(hx, 0);
        ctx.lineTo(hx, h);
        ctx.stroke();
      });
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(sx, h * 0.5, Math.max(3, h * 0.06), 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex, h * 0.5, Math.max(3, h * 0.06), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // playhead
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.5, h * 0.025);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(px - h * 0.07, 0);
    ctx.lineTo(px + h * 0.07, 0);
    ctx.lineTo(px, h * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}