/** Small shared helpers. No dependencies. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mod = (n, m) => ((n % m) + m) % m;

/** Format seconds as m:ss.t with exact rounding at the requested precision. */
export function formatTime(seconds, decimals = 1) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const scale = Math.pow(10, decimals);
  // Round first, then split, so 125.99 with 2 decimals reads 2:05.99 rather
  // than 2:05.98 from accumulated floating point error.
  const total = Math.round(seconds * scale);
  const minutes = Math.floor(total / (60 * scale));
  const rest = total - minutes * 60 * scale;
  const whole = Math.floor(rest / scale);
  const frac = rest - whole * scale;
  return `${minutes}:${String(whole).padStart(2, '0')}.${String(frac).padStart(decimals, '0')}`;
}

/** Format seconds as mm:ss for compact labels. */
export function formatShort(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** "1920x1080" -> [1920, 1080] */
export function parseResolution(value) {
  const [w, h] = String(value).split('x').map(Number);
  return [w || 1920, h || 1080];
}

export function hexToRgb(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbCss([r, g, b], alpha) {
  return alpha === undefined ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

export function mixRgb(a, b, t) {
  return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
}

export function hslCss(h, s, l) {
  return `hsl(${mod(h, 360)},${clamp(s, 0, 100)}%,${clamp(l, 0, 100)}%)`;
}

/** Escape a string for safe insertion into HTML. */
export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** Trailing-edge debounce. */
export function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Relative luminance (WCAG) of an RGB triple, used to pick a readable
 * foreground for extracted backdrop colours.
 */
export function luminance([r, g, b]) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Download a Blob or string under the given filename. */
export function downloadBlob(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Percent 0..100 from a ratio, rounded to one decimal. */
export function pct(ratio) {
  return `${(clamp(ratio, 0, 1) * 100).toFixed(1)}%`;
}