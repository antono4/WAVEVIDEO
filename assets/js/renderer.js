import { hexToRgb, rgbCss, mixRgb, hslCss, clamp, mod } from './utils.js';
import { resolveLyricState, buildWordPlan, stripMarkers } from './lyrics.js';

/**
 * The rendering engine.
 *
 * Everything that draws a frame lives here, so the live canvas, preset
 * thumbnails and still exports are guaranteed to be pixel-identical. The
 * engine is stateless apart from particle positions, which are reseeded per
 * thumbnail so previews stay deterministic.
 */

const BACKGROUND = '#000';

/** Deterministic pseudo-random so thumbnails never flicker between renders. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Renderer {
  constructor() {
    this.particles = this._makeParticles(seeded(7));
    this._scratch = { gradient: null };
  }

  _makeParticles(rand) {
    return Array.from({ length: 90 }, () => ({
      x: rand(),
      y: rand(),
      r: rand() * 2.2 + 0.5,
      s: rand() * 0.4 + 0.08
    }));
  }

  /** Analyser output is absent in thumbnails; synthesise a plausible frame. */
  static syntheticAnalysis(count, tick = 0, seed = 11) {
    const rand = seeded(seed);
    const bins = new Float32Array(Math.max(count, 8));
    for (let i = 0; i < bins.length; i++) {
      const falloff = Math.pow(1 - i / bins.length, 1.4);
      const wobble = 0.5 + 0.5 * Math.sin(tick * 0.9 + i * 0.35 + rand() * 0.4);
      bins[i] = clamp(falloff * (0.35 + wobble * 0.75), 0, 1.4);
    }
    return { bins, bass: bins[1] ?? 0.5, energy: 0.45, beat: 0.2 };
  }

  /* ------------------------------------------------------------------ colour */

  /**
   * Colour for band `i` of `n`, honouring the active colour mode.
   * @returns {string} css colour
   */
  bandColor(settings, i, n, alpha) {
    const t = n > 1 ? i / (n - 1) : 0;
    const c1 = hexToRgb(settings.color1);
    const c2 = hexToRgb(settings.color2);
    switch (settings.colorMode) {
      case 'solid':
        return rgbCss(c1, alpha);
      case 'rainbow':
        return hslCss(t * 320, 85, 60 - 6 * (1 - t));
      case 'fire':
        return hslCss(50 - t * 50, 100, 38 + 22 * (1 - t));
      case 'ice':
        return hslCss(190 + t * 40, 90, 45 + 25 * t);
      case 'neon':
        return hslCss(280 + t * 120, 100, 62);
      default:
        return rgbCss(mixRgb(c1, c2, t), alpha);
    }
  }

  /* ------------------------------------------------------------------ layers */

  _roundRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  _drawBackdrop(ctx, w, h, o) {
    const s = o.settings;
    const backdrop = o.backdrop;
    if (backdrop && backdrop.ready) {
      const iw = backdrop.width || w;
      const ih = backdrop.height || h;
      const zoom = s.bgZoom / 100;
      const scale = Math.max(w / iw, h / ih) * zoom;
      const dw = iw * scale;
      const dh = ih * scale;
      let ox = (w - dw) / 2;
      let oy = (h - dh) / 2;
      if (s.bgMotion && !o.freezeMotion) {
        ox += Math.sin(o.t * 0.08) * Math.min(60, dw * 0.03);
        oy += Math.cos(o.t * 0.06) * Math.min(60, dh * 0.03);
      }
      const prevFilter = ctx.filter;
      if (s.bgBlur > 0) ctx.filter = `blur(${s.bgBlur}px)`;
      try { ctx.drawImage(backdrop.source, ox, oy, dw, dh); } catch { /* not ready */ }
      ctx.filter = prevFilter;
    } else {
      let paint;
      if (s.bgType === 'solid') {
        paint = s.bgColor1;
      } else if (s.bgType === 'radial') {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.72);
        g.addColorStop(0, s.bgColor2);
        g.addColorStop(1, s.bgColor1);
        paint = g;
      } else {
        const a = (s.bgAngle * Math.PI) / 180;
        const len = Math.max(w, h) * 0.75;
        const cx = w / 2 + Math.cos(a) * len;
        const cy = h / 2 + Math.sin(a) * len;
        const g = ctx.createLinearGradient(w - cx, h - cy, cx, cy);
        g.addColorStop(0, s.bgColor1);
        g.addColorStop(1, s.bgColor2);
        paint = g;
      }
      ctx.fillStyle = paint;
      ctx.fillRect(0, 0, w, h);
    }

    if (s.bgDim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${s.bgDim})`;
      ctx.fillRect(0, 0, w, h);
    }

    if (s.elGrid) {
      ctx.save();
      ctx.globalAlpha = 0.06 * (0.4 + s.elOpacity);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      const step = Math.max(40, w / 32);
      for (let x = 0; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.restore();
    }
  }

  _drawGhostBars(ctx, w, h, o) {
    const s = o.settings;
    const bins = o.bins;
    const n = 48;
    ctx.save();
    ctx.globalAlpha = 0.1 * (0.5 + s.elOpacity) * (0.6 + o.energy);
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      const v = bins[Math.floor((i * bins.length) / n)] || 0;
      const barH = h * 0.42 * v;
      ctx.fillStyle = this.bandColor(s, i, n, 0.5);
      ctx.fillRect(i * bw + bw * 0.25, h - barH, bw * 0.5, barH);
      ctx.fillRect(i * bw + bw * 0.25, 0, bw * 0.5, barH * 0.5);
    }
    ctx.restore();
  }

  _drawParticles(ctx, w, h, o) {
    const s = o.settings;
    ctx.save();
    ctx.globalAlpha = 0.22 * (0.5 + s.elOpacity);
    for (const p of this.particles) {
      if (!o.freezeMotion) {
        p.y -= p.s * (0.0012 + o.energy * 0.004);
        if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
      }
      ctx.fillStyle = this.bandColor(s, p.x, 1, 0.9);
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, p.r * (1 + o.energy * 2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawRing(ctx, w, h, o) {
    ctx.save();
    ctx.strokeStyle = this.bandColor(o.settings, 1, 3, 0.5);
    ctx.lineWidth = 3 + o.bass * 14;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) * (0.22 + o.bass * 0.22), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _drawVisualizer(ctx, w, h, o) {
    const s = o.settings;
    const bins = o.bins;
    const n = bins.length;
    const cx = w / 2;
    const cy = h / 2;
    const rot = s.rotation * o.t * 0.2;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (s.glow > 0) {
      ctx.shadowBlur = s.glow;
      ctx.shadowColor = s.color2;
    }

    switch (s.visType) {
      case 'bars':
      case 'barsMirror':
      case 'mirrorSym':
      case 'led':
        this._drawBars(ctx, w, h, o, n, rot);
        break;
      case 'blocks':
        this._drawMatrix(ctx, w, h, o, n, 'blocks');
        break;
      case 'dots':
        this._drawMatrix(ctx, w, h, o, n, 'dots');
        break;
      case 'circular':
        this._drawCircular(ctx, w, h, o, n, rot, cx, cy);
        break;
      case 'radial':
        this._drawRadial(ctx, w, h, o, n, rot, cx, cy);
        break;
      case 'rings':
        this._drawRings(ctx, w, h, o, cx, cy);
        break;
      case 'spectrum':
        this._drawSpectrum(ctx, w, h, o, n);
        break;
      default:
        this._drawWave(ctx, w, h, o, cx, cy);
    }
    ctx.restore();
  }

  _drawBars(ctx, w, h, o, n, rot) {
    const s = o.settings;
    const bins = o.bins;
    const type = s.visType;
    // Primary pass draws half the spectrum when a mirror variant is active so
    // the reflected pair covers the full width without overlapping.
    const doubled = type === 'barsMirror' || type === 'mirrorSym' || (type === 'bars' && s.mirrorOn);
    const count = doubled ? Math.ceil(n / 2) : n;
    const gap = w * 0.006;
    const bw = (w * 0.9 - gap * (count - 1)) / count;
    const base = h * 0.9;
    const maxH = base - h * 0.1;

    for (let i = 0; i < count; i++) {
      const v = bins[i] || 0;
      const barH = Math.max(2, maxH * v);
      const x = w * 0.05 + i * (bw + gap);
      ctx.fillStyle = this.bandColor(s, i, count, 0.95);
      if (type === 'led') {
        const seg = 26;
        const sh = barH / seg;
        for (let k = 0; k < seg; k++) {
          if (v * seg < k + 0.4) break;
          ctx.globalAlpha = 0.35 + 0.65 * (k / seg);
          this._roundRect(ctx, x, base - sh * (k + 0.85), bw, sh * 0.72, 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else {
        this._roundRect(ctx, x, base - barH, bw, barH, bw * 0.25);
        ctx.fill();
      }
    }

    if (doubled) {
      for (let i = 0; i < count; i++) {
        const v = bins[i] || 0;
        const barH = Math.max(2, maxH * v * 0.82);
        const x = w * 0.95 - bw - i * (bw + gap);
        ctx.fillStyle = this.bandColor(s, i, count, 0.5);
        this._roundRect(ctx, x, base - barH, bw, barH, bw * 0.25);
        ctx.fill();
      }
    }
  }

  _drawMatrix(ctx, w, h, o, n, mode) {
    const s = o.settings;
    const bins = o.bins;
    const cols = Math.max(4, Math.round(Math.sqrt(n * (w / h))));
    const rows = Math.max(3, Math.round(n / cols));
    const cw = (w * 0.86) / cols;
    const ch = (h * 0.66) / rows;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const v = bins[(row * cols + col) % n] || 0;
        if (mode === 'blocks') {
          const lit = v > 1 - (row + 1) / rows;
          ctx.globalAlpha = lit ? 0.95 : 0.1 + v * 0.25;
          ctx.fillStyle = this.bandColor(s, col, cols, 1);
          this._roundRect(ctx, w * 0.07 + col * cw, h * 0.17 + row * ch, cw * 0.82, ch * 0.78, 3);
          ctx.fill();
        } else {
          const rad = 2 + v * Math.min(cw, ch) * 0.45;
          ctx.globalAlpha = 0.25 + v * 0.75;
          ctx.fillStyle = this.bandColor(s, col * 2, cols * 2, 1);
          ctx.beginPath();
          ctx.arc(w * 0.07 + col * cw + cw / 2, h * 0.17 + row * ch + ch / 2, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawCircular(ctx, w, h, o, n, rot, cx, cy) {
    const s = o.settings;
    const bins = o.bins;
    const radius = Math.min(w, h) * 0.26;
    const inner = radius * (1 + 0.14 * o.bass);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rot;
      const v = bins[i] || 0;
      const len = radius * (0.25 + v * 1.05);
      ctx.strokeStyle = this.bandColor(s, i, n, 0.95);
      ctx.lineWidth = Math.max(3, ((Math.PI * 2 * inner) / n) * 0.42);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * (inner + len), cy + Math.sin(a) * (inner + len));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, inner * 0.94, 0, Math.PI * 2);
    ctx.strokeStyle = this.bandColor(s, 0, n, 0.35);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _drawRadial(ctx, w, h, o, n, rot, cx, cy) {
    const s = o.settings;
    const bins = o.bins;
    const radius = Math.min(w, h) * 0.3 * (1 + o.bass * 0.14);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2 + rot;
      const v = bins[i % n] || 0;
      const rad = radius + v * radius * 0.6;
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = this.bandColor(s, 1, 3, 0.18);
    ctx.fill();
    ctx.strokeStyle = s.color2;
    ctx.lineWidth = s.lineWidth;
    ctx.stroke();
  }

  _drawRings(ctx, w, h, o, cx, cy) {
    const s = o.settings;
    for (let k = 0; k < 5; k++) {
      const p = mod(o.t * 0.35 + k * 0.2, 1);
      const radius = Math.min(w, h) * (0.12 + p * 0.42) * (1 + o.bass * 0.25);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = this.bandColor(s, k, 5, (1 - p) * (0.35 + o.bass));
      ctx.lineWidth = s.lineWidth + 3;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(w, h) * 0.1 * (1 + o.bass * 0.4), 0, Math.PI * 2);
    ctx.fillStyle = this.bandColor(s, 0, 2, 0.85);
    ctx.fill();
  }

  _drawSpectrum(ctx, w, h, o, n) {
    const s = o.settings;
    const bins = o.bins;
    const base = h * 0.86;
    const span = h * 0.55;
    ctx.beginPath();
    ctx.moveTo(0, base);
    for (let i = 0; i < n; i++) {
      ctx.lineTo((i / Math.max(1, n - 1)) * w, base - span * (bins[i] || 0));
    }
    ctx.lineTo(w, base);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, base - span, 0, base);
    g.addColorStop(0, rgbCss(hexToRgb(s.color2), 0.9));
    g.addColorStop(1, rgbCss(hexToRgb(s.color2), 0.05));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = s.color1;
    ctx.lineWidth = s.lineWidth;
    ctx.stroke();
  }

  _drawWave(ctx, w, h, o, cx, cy) {
    const s = o.settings;
    const wave = o.wave;
    if (!wave || !wave.length) return;
    const amp = h * 0.2 * (1 + o.bass);
    const n = wave.length;
    const step = Math.max(1, Math.floor(n / 900));
    const yAt = (i) => cy + ((wave[i] - 128) / 128) * amp;

    ctx.beginPath();
    if (s.lineStyle === 'sharp' || s.visType === 'wave') {
      for (let i = 0; i < n; i += step) {
        const x = (i / (n - 1)) * w;
        if (i) ctx.lineTo(x, yAt(i));
        else ctx.moveTo(x, yAt(i));
      }
    } else {
      let prevY = yAt(0);
      ctx.moveTo(0, prevY);
      for (let i = step; i < n; i += step) {
        const x = (i / (n - 1)) * w;
        const y = yAt(i);
        const px = ((i - step) / (n - 1)) * w;
        ctx.quadraticCurveTo(px, prevY, (px + x) / 2, y);
        prevY = y;
      }
    }

    if (s.visType === 'waveFill') {
      ctx.lineTo(w, cy);
      ctx.lineTo(0, cy);
      ctx.closePath();
      ctx.fillStyle = rgbCss(hexToRgb(s.color1), 0.22);
      ctx.fill();
    }

    const stroke = ctx.createLinearGradient(0, 0, w, 0);
    stroke.addColorStop(0, s.color1);
    stroke.addColorStop(1, s.color2);
    ctx.strokeStyle = s.colorMode === 'solid' ? s.color1 : stroke;
    ctx.lineWidth = s.lineWidth * (1 + o.bass * 0.6);
    ctx.stroke();
  }

  _drawTopSpectrum(ctx, w, h, o) {
    const s = o.settings;
    const bins = o.bins;
    ctx.save();
    ctx.globalAlpha = 0.5;
    const n = 120;
    for (let i = 0; i < n; i++) {
      const v = bins[i % bins.length] || 0;
      ctx.fillStyle = this.bandColor(s, i, n, 0.7);
      ctx.fillRect((i / n) * w, 0, w / n - 1, h * 0.1 * v);
    }
    ctx.restore();
  }

  _drawTitles(ctx, w, h, o) {
    const s = o.settings;
    const beat = o.beat;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (s.titleText) {
      ctx.font = `${s.titleWeight} ${s.titleSize}px ${s.titleFont}`;
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = `${s.titleSpacing}px`;
      if (s.titleShadow) {
        ctx.shadowColor = 'rgba(0,0,0,.65)';
        ctx.shadowBlur = 22;
        ctx.shadowOffsetY = 4;
      }
      ctx.fillStyle = s.titleColor;
      ctx.globalAlpha = 0.92 + beat * 0.08;
      ctx.fillText(s.titleText, w / 2 + s.titleX * w * 0.5, h / 2 + s.titleY * h * 0.5);
      ctx.globalAlpha = 1;
    }

    if (s.subText) {
      ctx.font = `500 ${s.subSize}px ${s.titleFont}`;
      if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '1px';
      ctx.shadowBlur = s.titleShadow ? 14 : 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = s.subColor;
      ctx.globalAlpha = 0.9;
      ctx.fillText(s.subText, w / 2 + s.subX * w * 0.5, h / 2 + s.subY * h * 0.5);
      ctx.globalAlpha = 1;
    }

    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
    ctx.restore();
  }

  /** Draw the logo image sized against canvas height, using normalized coords. */
  _drawLogo(ctx, w, h, o) {
    const s = o.settings;
    if (!s.logoEnabled || !o.logo?.ready) return;
    const target = h * s.logoSize;
    const src = o.logo.source;
    const iw = o.logo.width || target;
    const ih = o.logo.height || target;
    const scale = target / Math.max(iw, ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const cx = w / 2 + s.logoX * w * 0.5;
    const cy = h / 2 + s.logoY * h * 0.5;
    ctx.save();
    ctx.globalAlpha = 0.9;
    try { ctx.drawImage(src, cx - dw / 2, cy - dh / 2, dw, dh); } catch { /* not ready */ }
    ctx.restore();
  }

  /** Karaoke lyric rendering with optional per-word fill. */
  _drawLyrics(ctx, w, h, o) {
    const s = o.settings;
    const state = o.lyricState;
    if (!state) return;
    const { active, prev, next, progress, appear } = state;
    const size = s.lyricSize;
    const baseY = h / 2 + s.lyricY * h * 0.5;
    const font = `700 ${size}px ${s.titleFont}`;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font;

    if (s.lyricShowNeighbours) {
      if (prev) {
        ctx.globalAlpha = 0.16 * s.elOpacity + 0.06;
        ctx.fillStyle = s.lyricDim;
        ctx.fillText(stripMarkers(prev.text), w / 2, baseY - size * 1.5);
      }
      if (next) {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = s.lyricDim;
        ctx.fillText(stripMarkers(next.text), w / 2, baseY + size * 1.5);
      }
    }

    ctx.globalAlpha = appear;
    ctx.translate(0, (1 - appear) * 22);
    ctx.shadowColor = 'rgba(0,0,0,.6)';
    ctx.shadowBlur = 24;

    const plain = stripMarkers(active.text);
    const metrics = ctx.measureText(plain);
    const left = w / 2 - metrics.width / 2;

    // Dim full line underneath, so unfilled text stays legible.
    ctx.globalAlpha = appear * (0.22 * (1 - progress) ** 2 + 0.1);
    ctx.fillStyle = s.lyricDim;
    ctx.fillText(plain, w / 2, baseY);

    ctx.globalAlpha = appear;
    ctx.fillStyle = s.lyricColor;

    if (s.lyricKaraoke) {
      const plan = buildWordPlan(active.text);
      let cursorX = left;
      ctx.save();
      ctx.beginPath();
      for (const token of plan) {
        const width = ctx.measureText(token.text).width;
        const local = clamp((progress - token.start) / Math.max(1e-6, token.end - token.start), 0, 1);
        if (local > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(cursorX, baseY - size, width * local, size * 2);
          ctx.clip();
          ctx.fillText(token.text, cursorX + width / 2, baseY);
          ctx.restore();
        }
        cursorX += width;
      }
      ctx.restore();
    } else {
      // Whole-line wipe, measured on the marker-free width so asterisks do not
      // shift the clip.
      const revealed = Math.max(size * 0.3, metrics.width * progress);
      ctx.save();
      ctx.beginPath();
      ctx.rect(left - size * 0.4, baseY - size, revealed + size * 0.8, size * 2);
      ctx.clip();
      ctx.fillText(plain, w / 2, baseY);
      ctx.restore();
    }

    if (active.trans) {
      ctx.font = `500 ${Math.max(14, size * 0.56)}px ${s.titleFont}`;
      ctx.shadowBlur = 14;
      ctx.globalAlpha = appear * 0.75;
      ctx.fillStyle = s.lyricDim;
      ctx.fillText(active.trans, w / 2, baseY + size * 0.95);
    }
    ctx.restore();
  }

  _drawVignette(ctx, w, h) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  _drawNoise(ctx, w, h, o) {
    ctx.save();
    ctx.globalAlpha = 0.035 + o.settings.elOpacity * 0.03;
    const rand = seeded(Math.floor(o.t * 60) + 1);
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = rand() > 0.5 ? '#fff' : '#000';
      ctx.fillRect(rand() * w, rand() * h, 1.6, 1.6);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------- frame */

  /**
   * Draw one frame.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} o
   * @param {number} o.w canvas width
   * @param {number} o.h canvas height
   * @param {number} o.t playhead seconds
   * @param {object} o.settings
   * @param {Float32Array} o.bins analysed bands
   * @param {Uint8Array} [o.wave] time-domain samples
   * @param {number} o.bass
   * @param {number} o.energy
   * @param {number} o.beat
   * @param {number} [o.duration]
   * @param {object} [o.backdrop] { source, width, height, ready }
   * @param {object} [o.logo]
   * @param {Array}  [o.lyricLines]
   * @param {boolean} [o.freezeMotion] deterministic render for thumbnails
   */
  drawFrame(ctx, o) {
    const { w, h, settings: s } = o;
    const lyricState = s.lyricsOn && o.lyricLines?.length
      ? resolveLyricState(o.lyricLines, o.t, o.duration)
      : null;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.filter = 'none';
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, w, h);

    const pulse = 1 + s.screenPulse * o.bass + (s.beatScale ? o.beat * 0.03 : 0);
    ctx.translate(w / 2, h / 2);
    ctx.scale(pulse, pulse);
    ctx.translate(-w / 2, -h / 2);

    this._drawBackdrop(ctx, w, h, o);
    if (s.elGhostBars) this._drawGhostBars(ctx, w, h, o);
    if (s.elParticles) this._drawParticles(ctx, w, h, o);

    if (s.elCenterLine) {
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = s.color2;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.restore();
    }

    if (s.elRing) this._drawRing(ctx, w, h, o);

    this._drawVisualizer(ctx, w, h, o);
    if (s.elTopSpec) this._drawTopSpectrum(ctx, w, h, o);

    if (lyricState) this._drawLyrics(ctx, w, h, { ...o, lyricState });

    this._drawTitles(ctx, w, h, o);
    this._drawLogo(ctx, w, h, o);
    if (s.vignette) this._drawVignette(ctx, w, h);
    if (s.elNoise) this._drawNoise(ctx, w, h, o);

    if (s.screenFlash > 0 && o.beat > 0.02) {
      ctx.save();
      ctx.globalAlpha = clamp(s.screenFlash * o.beat, 0, 1);
      ctx.fillStyle = s.color2;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    ctx.restore();
  }
}