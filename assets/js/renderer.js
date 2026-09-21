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

/** Solid primaries used to isolate a colour channel for chromatic aberration. */
const TINTS = ['#ff0000', '#00ff00', '#0000ff'];

/** Deterministic pseudo-random so thumbnails never flicker between renders. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Rotate an RGB triple around the hue wheel.
 *
 * Verified against the HSL round trip so the solid and gradient colour modes
 * respond to the hue shift control the same way the HSL-based modes do.
 */
export function rotateHue([r, g, b], degrees) {
  const shift = ((degrees % 360) + 360) % 360;
  if (!shift) return [r, g, b];
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  h = (((h * 360 + shift) % 360) + 360) % 360 / 360;

  const hue2rgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  if (!s) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  ];
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
    // A static hue rotation keeps the preset palettes intact while letting the
    // hue shift effect drift the whole scheme over time.
    const shift = settings.hueShift || 0;
    switch (settings.colorMode) {
      case 'solid':
        return rgbCss(rotateHue(c1, shift), alpha);
      case 'rainbow':
        return hslCss(t * 320 + shift, 85, 60 - 6 * (1 - t));
      case 'fire':
        return hslCss(50 - t * 50 + shift, 100, 38 + 22 * (1 - t));
      case 'ice':
        return hslCss(190 + t * 40 + shift, 90, 45 + 25 * t);
      case 'neon':
        return hslCss(280 + t * 120 + shift, 100, 62);
      case 'sunset':
        return hslCss(330 - t * 60 + shift, 92, 42 + 30 * t);
      case 'toxic':
        return hslCss(90 + t * 60 + shift, 95, 38 + 26 * (1 - t));
      case 'candy':
        return hslCss(310 + Math.sin(t * Math.PI) * 60 + shift, 90, 68 - 10 * t);
      case 'gold':
        return hslCss(45 - t * 15 + shift, 85, 52 + 22 * (1 - t));
      case 'deep':
        return hslCss(200 + t * 60 + shift, 80, 30 + 32 * t);
      default:
        return rgbCss(mixRgb(rotateHue(c1, shift), rotateHue(c2, shift), t), alpha);
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
      case 'aurora':
        this._drawAurora(ctx, w, h, o, n);
        break;
      case 'lissajous':
        this._drawLissajous(ctx, w, h, o, cx, cy);
        break;
      case 'starfield':
        this._drawStarfield(ctx, w, h, o, cx, cy);
        break;
      case 'spikes':
        this._drawSpikes(ctx, w, h, o, n, cx, cy, rot);
        break;
      case 'dualWave':
        this._drawDualWave(ctx, w, h, o, cx, cy);
        break;
      case 'terrain':
        this._drawTerrain(ctx, w, h, o, n);
        break;
      case 'web':
        this._drawWeb(ctx, w, h, o, n, cx, cy);
        break;
      case 'strobe':
        this._drawStrobe(ctx, w, h, o, n);
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

  /** Overlapping translucent ribbons that drift with the spectrum. */
  _drawAurora(ctx, w, h, o, n) {
    const s = o.settings;
    const bins = o.bins;
    const layers = 5;
    for (let layer = 0; layer < layers; layer++) {
      const phase = layer * 0.7 + o.t * (0.25 + layer * 0.05);
      const alpha = 0.16 + 0.06 * (layers - layer);
      const amp = h * (0.1 + layer * 0.035) * (0.7 + o.energy);
      ctx.beginPath();
      ctx.moveTo(0, h * 0.5);
      for (let i = 0; i <= n; i++) {
        const v = bins[i % n] || 0;
        const x = (i / n) * w;
        const y = h * (0.45 + layer * 0.05) + Math.sin(i * 0.16 + phase) * amp * (0.4 + v);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, h * 0.2, 0, h);
      const top = this.bandColor(s, layer * 3, n, alpha * 2.2);
      const bottom = this.bandColor(s, layer * 3 + 1, n, 0);
      try {
        g.addColorStop(0, top);
        g.addColorStop(1, bottom);
        ctx.fillStyle = g;
      } catch {
        ctx.fillStyle = top;
      }
      ctx.globalAlpha = 0.85;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Lissajous figure traced from the time-domain signal against itself. */
  _drawLissajous(ctx, w, h, o, cx, cy) {
    const s = o.settings;
    const wave = o.wave;
    if (!wave || !wave.length) return;
    const rx = Math.min(w, h) * 0.34 * (1 + o.bass * 0.16);
    const ry = rx * 0.72;
    const step = Math.max(1, Math.floor(wave.length / 700));
    ctx.beginPath();
    for (let i = 0; i < wave.length; i += step) {
      const a = (wave[i] - 128) / 128;
      const b = (wave[(i * 3) % wave.length] - 128) / 128;
      const aa = a * Math.PI * (1 + s.bassBoost * 0.2) + o.t * s.spin;
      const bb = (b + a * 0.4) * Math.PI + o.t * 0.35;
      const x = cx + Math.sin(aa) * rx;
      const y = cy + Math.sin(bb) * ry;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = this.bandColor(s, 1, 3, 0.9);
    ctx.lineWidth = s.lineWidth * (1 + o.bass * 0.5);
    ctx.stroke();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = this.bandColor(s, 2, 3, 0.8);
    ctx.lineWidth = s.lineWidth * 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Stars streaming outward, speed driven by the low end. */
  _drawStarfield(ctx, w, h, o, cx, cy) {
    const s = o.settings;
    if (!this.stars) {
      const rand = seeded(31);
      this.stars = Array.from({ length: 220 }, () => ({
        a: rand() * Math.PI * 2,
        d: rand(),
        speed: 0.25 + rand() * 0.9
      }));
    }
    const maxR = Math.hypot(w, h) * 0.6;
    const drift = o.freezeMotion ? 0 : 0.0016 + o.energy * 0.012;
    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      star.d += drift * star.speed;
      if (star.d > 1) star.d -= 1;
      const r = star.d * maxR;
      const x = cx + Math.cos(star.a) * r;
      const y = cy + Math.sin(star.a) * r * 0.62;
      const size = 0.6 + star.d * 3.4;
      ctx.globalAlpha = Math.min(1, star.d * 1.5);
      ctx.fillStyle = this.bandColor(s, i, this.stars.length, 1);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** Radial spikes whose length tracks each band. */
  _drawSpikes(ctx, w, h, o, n, cx, cy, rot) {
    const s = o.settings;
    const bins = o.bins;
    const inner = Math.min(w, h) * 0.08 * (1 + o.bass * 0.3);
    const outer = Math.min(w, h) * 0.42;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rot;
      const v = bins[i] || 0;
      const len = inner + (outer - inner) * v;
      ctx.strokeStyle = this.bandColor(s, i, n, 0.9);
      ctx.lineWidth = Math.max(2, (Math.PI * 2 * inner) / n * 0.7);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
    }
  }

  /** Two mirrored waveforms with a filled gap between them. */
  _drawDualWave(ctx, w, h, o, cx, cy) {
    const s = o.settings;
    const wave = o.wave;
    if (!wave || !wave.length) return;
    const amp = h * 0.17 * (1 + o.bass);
    const n = wave.length;
    const step = Math.max(1, Math.floor(n / 600));
    const yAt = (i, sign) => cy + sign * ((wave[i] - 128) / 128) * amp;

    const trace = (sign) => {
      ctx.beginPath();
      for (let i = 0; i < n; i += step) {
        const x = (i / (n - 1)) * w;
        const y = yAt(i, sign);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
    };

    // Filled band between the two traces.
    ctx.beginPath();
    for (let i = 0; i < n; i += step) {
      const x = (i / (n - 1)) * w;
      const y = yAt(i, 1);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    for (let i = n - step; i >= 0; i -= step) {
      ctx.lineTo((i / (n - 1)) * w, yAt(i, -1));
    }
    ctx.closePath();
    ctx.fillStyle = rgbCss(hexToRgb(s.color2), 0.16);
    ctx.fill();

    trace(1);
    ctx.strokeStyle = this.bandColor(s, 0, 2, 0.95);
    ctx.lineWidth = s.lineWidth;
    ctx.stroke();
    trace(-1);
    ctx.strokeStyle = this.bandColor(s, 2, 2, 0.95);
    ctx.lineWidth = s.lineWidth;
    ctx.stroke();
  }

  /** Layered ridges receding into the distance. */
  _drawTerrain(ctx, w, h, o, n) {
    const s = o.settings;
    const bins = o.bins;
    const rows = 14;
    for (let row = rows - 1; row >= 0; row--) {
      const depth = row / (rows - 1);
      const baseY = h * (0.34 + depth * 0.6);
      const amp = h * 0.16 * (0.35 + o.energy) * (1 - depth * 0.5);
      ctx.beginPath();
      ctx.moveTo(0, baseY);
      for (let i = 0; i <= n; i++) {
        const v = bins[i % n] || 0;
        const phase = i * 0.22 + row * 0.6 + o.t * 0.6;
        const x = (i / n) * w;
        const y = baseY - (Math.sin(phase) * 0.5 + 0.5) * amp * (0.4 + v);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = this.bandColor(s, row, rows, 0.1 + depth * 0.5);
      ctx.fill();
      ctx.strokeStyle = this.bandColor(s, row, rows, 0.75);
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  /** Nodes arranged in a ring, joined by lines that light up with the beat. */
  _drawWeb(ctx, w, h, o, n, cx, cy) {
    const s = o.settings;
    const bins = o.bins;
    const nodes = Math.max(12, Math.min(48, Math.round(n * 0.5)));
    const baseR = Math.min(w, h) * 0.3;
    const points = [];
    for (let i = 0; i < nodes; i++) {
      const a = (i / nodes) * Math.PI * 2 + o.t * s.spin * 0.4;
      const v = bins[Math.floor((i / nodes) * n)] || 0;
      const r = baseR * (0.62 + v * 0.7);
      points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, v });
    }
    ctx.globalAlpha = 0.28 + o.energy * 0.4;
    for (let i = 0; i < nodes; i++) {
      const a = points[i];
      const b = points[(i + 3) % nodes];
      ctx.strokeStyle = this.bandColor(s, i, nodes, 0.7);
      ctx.lineWidth = 1 + a.v * 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < nodes; i++) {
      ctx.fillStyle = this.bandColor(s, i, nodes, 0.95);
      ctx.beginPath();
      ctx.arc(points[i].x, points[i].y, 2 + points[i].v * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Grid of cells that flash on transients. */
  _drawStrobe(ctx, w, h, o, n) {
    const s = o.settings;
    const bins = o.bins;
    const cols = 12;
    const rows = 7;
    const cw = w / cols;
    const ch = h / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const v = bins[(row * cols + col) % n] || 0;
        const flash = v > 0.55 ? (v - 0.55) / 0.45 : 0;
        ctx.globalAlpha = 0.06 + flash * 0.9;
        ctx.fillStyle = this.bandColor(s, col + row, cols + rows, 1);
        ctx.fillRect(col * cw + 2, row * ch + 2, cw - 4, ch - 4);
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Offscreen buffer used by the effects that have to read back the frame:
   * chromatic aberration, kaleidoscope, trails and scanlines.
   *
   * Resized lazily to match the canvas so a resolution change is picked up
   * without the caller having to tell the renderer about it.
   */
  _buffer(w, h) {
    if (!this._fx) this._fx = document.createElement('canvas');
    if (this._fx.width !== w || this._fx.height !== h) {
      this._fx.width = w;
      this._fx.height = h;
    }
    return this._fx;
  }

  /**
   * Apply the post-processing stack.
   *
   * Trails and kaleidoscope have to sample the frame that was just drawn, so
   * everything happens through an offscreen buffer. Each effect is skipped
   * entirely when its amount is zero, which keeps the default path free of any
   * extra work.
   */
  _applyEffects(ctx, w, h, o) {
    const s = o.settings;
    const hasKaleido = s.kaleido >= 1;
    const hasChroma = s.chroma > 0;
    const hasScan = s.scanlines > 0;

    // Accumulate a fading copy of the previous frame before anything samples it.
    if (s.trail > 0 && !o.freezeMotion) {
      if (!this._trail) this._trail = document.createElement('canvas');
      if (this._trail.width !== w || this._trail.height !== h) {
        this._trail.width = w;
        this._trail.height = h;
        this._trail.getContext('2d').clearRect(0, 0, w, h);
      }
      const tctx = this._trail.getContext('2d');
      tctx.save();
      // Decay what is already there, then stamp the fresh frame on top.
      tctx.globalCompositeOperation = 'source-over';
      tctx.globalAlpha = 1 - s.trail;
      tctx.drawImage(this._trail, 0, 0);
      tctx.globalAlpha = 1;
      tctx.restore();
      tctx.globalCompositeOperation = 'source-over';
      tctx.drawImage(ctx.canvas, 0, 0);
      ctx.save();
      ctx.globalAlpha = s.trail;
      ctx.drawImage(this._trail, 0, 0);
      ctx.restore();
    }

    if (!hasKaleido && !hasChroma && !hasScan) return;

    const buf = this._buffer(w, h);
    const bctx = buf.getContext('2d');
    bctx.clearRect(0, 0, w, h);
    bctx.drawImage(ctx.canvas, 0, 0);

    // Kaleidoscope: mirror wedges taken from the centre of the frame.
    if (hasKaleido) {
      const wedges = Math.round(clamp(s.kaleido, 1, 12));
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, w, h);
      const radius = Math.hypot(w, h);
      const step = (Math.PI * 2) / wedges;
      for (let i = 0; i < wedges; i++) {
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(step * i);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius, -step / 2, step / 2);
        ctx.closePath();
        ctx.clip();
        if (i % 2) ctx.scale(1, -1);
        ctx.drawImage(buf, -w / 2, -h / 2);
        ctx.restore();
      }
      ctx.restore();
      // Refresh the buffer so chromatic aberration sees the mirrored frame.
      bctx.clearRect(0, 0, w, h);
      bctx.drawImage(ctx.canvas, 0, 0);
    }

    // Chromatic aberration: isolate each colour channel and offset it.
    if (hasChroma) {
      const shifted = this._channel(w, h, buf, 0, -s.chroma);
      const shiftedB = this._channel(w, h, buf, 2, s.chroma);
      const green = this._channel(w, h, buf, 1, 0);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BACKGROUND;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(shifted, 0, 0);
      ctx.drawImage(green, 0, 0);
      ctx.drawImage(shiftedB, 0, 0);
      ctx.restore();
      bctx.clearRect(0, 0, w, h);
      bctx.drawImage(ctx.canvas, 0, 0);
    }

    // Scanlines: dark horizontal bands with a slow roll.
    if (hasScan) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.5 * s.scanlines;
      ctx.fillStyle = '#000';
      const gap = 4;
      const offset = o.freezeMotion ? 0 : (o.t * 30) % gap;
      for (let y = -gap + offset; y < h; y += gap) {
        ctx.fillRect(0, y, w, gap / 2);
      }
      ctx.restore();
    }
  }

  /**
   * Build a single-colour-channel copy of the frame, shifted horizontally.
   *
   * Used by chromatic aberration. The channel is isolated by multiplying the
   * frame with a solid primary using `multiply`, then the alpha is carried over
   * from the source with `destination-in`.
   *
   * @param {number} channel 0 red, 1 green, 2 blue
   * @param {number} dx horizontal offset in pixels
   */
  _channel(w, h, source, channel, dx) {
    if (!this._channels) this._channels = [null, null, null];
    if (!this._channels[channel]) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      this._channels[channel] = { canvas: c, tint: TINTS[channel] };
    }
    const entry = this._channels[channel];
    const c = entry.canvas;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const cc = c.getContext('2d');
    cc.setTransform(1, 0, 0, 1, 0, 0);
    cc.globalCompositeOperation = 'source-over';
    cc.clearRect(0, 0, w, h);
    cc.drawImage(source, dx, 0);
    cc.globalCompositeOperation = 'multiply';
    cc.fillStyle = entry.tint;
    cc.fillRect(0, 0, w, h);
    cc.globalCompositeOperation = 'destination-in';
    cc.drawImage(source, dx, 0);
    cc.globalCompositeOperation = 'source-over';
    return c;
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

    // Screen pulse, beat zoom and auto spin all compose into one transform so
    // they stack predictably instead of fighting over setTransform.
    const pulse = 1 + s.screenPulse * o.bass + (s.beatScale ? o.beat * (s.beatZoom ?? 0.03) : 0);
    ctx.translate(w / 2, h / 2);
    ctx.scale(pulse, pulse);
    if (s.spin) ctx.rotate(s.spin * o.t * 0.25);
    ctx.translate(-w / 2, -h / 2);

    // Glow flares with the beat when asked, otherwise holds steady.
    const baseGlow = s.glow;
    if (s.glowPulse > 0) {
      o = { ...o, settings: { ...s, glow: baseGlow * (1 + s.glowPulse * o.beat * 1.6 + s.glowPulse * o.bass * 0.4) } };
    }

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
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = clamp(s.screenFlash * o.beat, 0, 1);
      ctx.fillStyle = s.color2;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    ctx.restore();

    // Effects run outside the content transform so they sample the whole frame.
    this._applyEffects(ctx, w, h, o);
  }
}