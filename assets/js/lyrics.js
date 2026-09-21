import { clamp } from './utils.js';

/**
 * Lyric parsing, timing and interchange.
 *
 * Internal format is one line per row: `time|text|translation` where time is
 * `m:ss.d` or plain seconds. Import/export speaks standard LRC.
 */

const STAMP_RE = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/;

/** Parse a single timestamp. Returns null when unrecognised. */
export function parseStamp(value) {
  const s = String(value ?? '').trim();
  const m = s.match(STAMP_RE);
  if (!m) return null;
  return (m[1] ? parseInt(m[1], 10) * 60 : 0) + parseFloat(m[2]);
}

/** Format seconds as `m:ss.d`. */
export function formatStamp(seconds) {
  const s = Math.max(0, seconds || 0);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

/**
 * Parse the internal lyric textarea format.
 * @returns {Array<{time:number, text:string, trans:string}>} sorted by time
 */
export function parseLyrics(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const row = raw.trim();
    if (!row || row.startsWith('#')) return;
    const parts = row.split('|');
    const time = parseStamp(parts[0]);
    if (time === null) return;
    const body = (parts[1] ?? '').trim();
    if (!body) return;
    out.push({ time, text: body, trans: (parts[2] ?? '').trim() });
  });
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** Serialise lyrics back to the internal textarea format. */
export function serializeLyrics(lines) {
  return lines.map((l) => `${formatStamp(l.time)}|${l.text}${l.trans ? `|${l.trans}` : ''}`).join('\n');
}

/* ------------------------------------------------------------------ LRC I/O */

/**
 * Parse LRC text.
 *
 * Supports several timestamps on one row (`[00:30][00:35]Chorus`), which is how
 * many editors mark a repeated line, and ignores `[ar:]`-style metadata tags.
 */
export function parseLrc(text) {
  const out = [];
  const stampRe = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g;

  String(text || '').split(/\r?\n/).forEach((row) => {
    stampRe.lastIndex = 0;
    const stamps = [];
    let match;
    while ((match = stampRe.exec(row)) !== null) {
      const seconds = parseInt(match[1], 10) * 60 + parseFloat(match[2].replace(':', '.'));
      if (Number.isFinite(seconds)) stamps.push({ seconds, end: stampRe.lastIndex });
    }
    if (!stamps.length) return;

    const body = row.slice(stamps[stamps.length - 1].end).trim();
    if (!body) return;

    // An embedded translation separated by a pipe or slash is preserved.
    const [main, trans] = body.split(/\s*[|/]\s*/, 2);
    for (const stamp of stamps) {
      out.push({ time: stamp.seconds, text: main.trim(), trans: (trans || '').trim() });
    }
  });

  out.sort((a, b) => a.time - b.time);
  return out;
}

/** Serialise lyrics as LRC. */
export function serializeLrc(lines, { artist = '', title = '' } = {}) {
  const head = [];
  if (artist) head.push(`[ar:${artist}]`);
  if (title) head.push(`[ti:${title}]`);
  head.push('[by:Wavevideo Studio]');
  const body = lines.map((l) => {
    const t = Math.max(0, l.time);
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    const stamp = `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
    const line = l.trans ? `${l.text} / ${l.trans}` : l.text;
    return `[${stamp}]${line}`;
  });
  return `${head.join('\n')}\n${body.join('\n')}\n`;
}

/* -------------------------------------------------------------------- timing */

/**
 * Tokenise a lyric line into timed segments.
 *
 * Words wrapped in *asterisks* become their own segment so a single long line
 * can be sung across several beats. Remaining text is split on whitespace and
 * each token receives a share of the line's duration proportional to its
 * character count, which tracks real singing closely enough for karaoke.
 *
 * @returns {Array<{text:string, start:number, end:number}>} fractions of the line
 */
export function buildWordPlan(text) {
  const segments = [];
  const source = String(text || '');
  const starRe = /\*([^*]+)\*/g;
  let cursor = 0;
  let m;
  while ((m = starRe.exec(source)) !== null) {
    if (m.index > cursor) segments.push({ text: source.slice(cursor, m.index), emphasis: false });
    segments.push({ text: m[1], emphasis: true });
    cursor = m.index + m[0].length;
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor), emphasis: false });
  if (!segments.length) segments.push({ text: source, emphasis: false });

  const tokens = [];
  segments.forEach((seg) => {
    if (seg.emphasis) {
      tokens.push({ text: seg.text, weight: 1, emphasis: true });
      return;
    }
    // Keep whitespace attached to the preceding word so measurement is exact.
    const parts = seg.text.split(/(\s+)/).filter((p) => p !== '');
    parts.forEach((p) => tokens.push({ text: p, weight: p.trim() === '' ? 0 : p.length, emphasis: false }));
  });
  // An empty or whitespace-only line still needs one segment so callers can
  // always index into the plan.
  if (!tokens.length) tokens.push({ text: '', weight: 0, emphasis: false });

  const total = tokens.reduce((sum, tk) => sum + Math.max(tk.weight, tk.text.length * 0.15), 0) || 1;
  let acc = 0;
  return tokens.map((tk) => {
    const share = Math.max(tk.weight, tk.text.length * 0.15) / total;
    const start = acc;
    acc += share;
    return { text: tk.text, emphasis: tk.emphasis, start, end: acc };
  });
}

/** Strip karaoke markers for measurement and plain rendering. */
export function stripMarkers(text) {
  return String(text || '').replace(/\*/g, '');
}

/**
 * Resolve which lines are on screen at time `t` and how far through they are.
 *
 * @param {Array} lines parsed lyrics
 * @param {number} t playhead seconds
 * @param {number} totalDuration used to bound the final line
 */
export function resolveLyricState(lines, t, totalDuration) {
  if (!lines.length) return null;
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (t >= lines[i].time - 1e-3) index = i;
    else break;
  }
  const activeIndex = index < 0 ? 0 : index;
  const active = lines[activeIndex];
  const next = lines[activeIndex + 1];
  const end = next ? next.time : Math.max(active.time + 4, totalDuration || active.time + 4);
  const span = Math.max(0.15, end - active.time);
  const progress = clamp((t - active.time) / span, 0, 1);
  // Small lead-in so a line fades up rather than popping in.
  const appear = clamp((t - active.time) / 0.22, 0, 1);
  return {
    lines,
    activeIndex,
    active,
    progress,
    appear,
    prev: activeIndex > 0 ? lines[activeIndex - 1] : null,
    next: next || null
  };
}

/**
 * Map a lyric set onto an even distribution across a time range.
 * Used by the "distribute evenly" helper.
 */
export function distributeEvenly(rawText, start, end) {
  const rows = String(rawText || '')
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean);
  if (!rows.length) return [];
  const span = Math.max(1, end - start);
  const step = span / rows.length;
  return rows.map((row, i) => {
    const [main, trans] = row.split('|');
    return {
      time: start + step * i,
      text: (main || '').trim(),
      trans: (trans || '').trim()
    };
  });
}