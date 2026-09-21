/**
 * Built-in looks.
 *
 * Each preset is a complete settings snapshot rather than a delta, which makes
 * "apply" predictable and lets a thumbnail be rendered from exactly the same
 * description the canvas will use.
 */

const base = {
  visType: 'bars',
  barCount: 64,
  gain: 1,
  bassBoost: 0.15,
  glow: 18,
  mirrorOn: false,
  beatScale: true,
  rotation: 0,
  lineWidth: 3,
  lineStyle: 'smooth',
  beatSensitivity: 1.25,
  // motion and reaction effects
  spin: 0,
  glowPulse: 0.35,
  chroma: 0,
  hueShift: 0,
  kaleido: 0,
  trail: 0,
  scanlines: 0,
  beatZoom: 0.03,
  colorMode: 'gradient',
  color1: '#8b5cf6',
  color2: '#06b6d4',
  bgType: 'linear',
  bgColor1: '#0a0b12',
  bgColor2: '#241a46',
  bgAngle: 160,
  bgBlur: 0,
  bgZoom: 115,
  bgMotion: true,
  bgDim: 0.25,
  vignette: true,
  screenFlash: 0,
  screenPulse: 0.06,
  titleText: '',
  subText: '',
  elGhostBars: true,
  elParticles: true,
  elRing: false,
  elTopSpec: false,
  elCenterLine: false,
  elGrid: false,
  elNoise: false,
  elOpacity: 0.5
};

/** Presets intentionally omit titles so applying one never wipes your text. */
const make = (name, description, cfg) => ({ name, description, settings: { ...base, ...cfg } });

export const PRESETS = [
  make('Red Planet', 'Warm circular spectrum over a Mars-red radial glow', {
    visType: 'circular', colorMode: 'fire', color1: '#ff3b3b', color2: '#ffb703',
    bgType: 'radial', bgColor1: '#1a0505', bgColor2: '#3d0c05',
    glow: 26, barCount: 96, rotation: 0.4, bgDim: 0.2, elGhostBars: false
  }),
  make('Skyline', 'Classic mirrored city bars, cool blue gradient', {
    visType: 'bars', barCount: 72, color1: '#00d1ff', color2: '#8b5cf6',
    bgColor1: '#050a1a', bgColor2: '#122a4d', bgAngle: 200, glow: 22
  }),
  make('Mood Ring', 'Rotating rainbow radial bloom', {
    visType: 'radial', colorMode: 'rainbow', bgType: 'radial',
    bgColor1: '#08080f', bgColor2: '#1b1030', glow: 30, barCount: 120, rotation: 0.2
  }),
  make('Neon Grid', 'Synthwave LED meter with grid overlay', {
    visType: 'led', colorMode: 'neon', bgColor1: '#05030d', bgColor2: '#12002b',
    elGrid: true, glow: 34, barCount: 48, elCenterLine: true
  }),
  make('Studio Clean', 'Minimal white waveform on matte black', {
    visType: 'wave', color1: '#ffffff', color2: '#8ea2ff', bgType: 'solid',
    bgColor1: '#0b0c12', glow: 12, elGhostBars: false, elParticles: false, lineWidth: 2.5
  }),
  make('Dreamy', 'Soft pastel filled waveform with particles', {
    visType: 'waveFill', color1: '#ff8ad1', color2: '#8ad1ff', bgType: 'radial',
    bgColor1: '#0a0616', bgColor2: '#2b1550', glow: 40, lineWidth: 4, screenPulse: 0.1
  }),
  make('Fire Circle', 'Expanding ember rings, heavy glow', {
    visType: 'rings', colorMode: 'fire', bgType: 'solid', bgColor1: '#0d0503',
    glow: 34, elGhostBars: false
  }),
  make('Ice Bars', 'Frozen mirrored bars with cyan bloom', {
    visType: 'barsMirror', colorMode: 'ice', bgColor1: '#020a12', bgColor2: '#06324a',
    barCount: 88, glow: 24
  }),
  make('Dot Matrix', 'Grid of reactive dots on deep green', {
    visType: 'dots', color1: '#b6ff3c', color2: '#06b6d4', bgType: 'solid',
    bgColor1: '#04100c', barCount: 120, elGrid: true, glow: 16
  }),
  make('Spectrum Pro', 'Filled spectrum area with top readout', {
    visType: 'spectrum', color1: '#8b5cf6', color2: '#06b6d4',
    bgColor1: '#06070f', bgColor2: '#141a33', elTopSpec: true, glow: 18
  }),
  make('Block Party', 'Chunky blocks that light up by row', {
    visType: 'blocks', color1: '#22e08a', color2: '#00d1ff', bgType: 'solid',
    bgColor1: '#03070a', barCount: 96, elGrid: true, bgDim: 0.1, glow: 20
  }),
  make('Studio Mono', 'High-contrast monochrome with film grain', {
    visType: 'bars', colorMode: 'solid', color1: '#f8fafc', bgType: 'solid',
    bgColor1: '#000000', glow: 24, elNoise: true, elParticles: false, barCount: 84, bgDim: 0
  }),

  /* ---- effects-driven looks ---- */
  make('Hypnosis', 'Kaleidoscope wedges turning over a slow spin', {
    visType: 'radial', colorMode: 'candy', bgType: 'radial', bgColor1: '#0b0416',
    bgColor2: '#2a0b3d', kaleido: 8, spin: 0.6, glow: 26, barCount: 110, bgDim: 0.15
  }),
  make('Retro CRT', 'Scanlines, heavy trails and a warm amber trace', {
    visType: 'wave', colorMode: 'gold', bgType: 'solid', bgColor1: '#0a0703',
    scanlines: 0.62, trail: 0.72, chroma: 4, glow: 30, lineWidth: 2.5,
    elParticles: false, elGhostBars: false, bgDim: 0.1
  }),
  make('Vaporwave', 'Chromatic split with a sunset palette and grid', {
    visType: 'bars', colorMode: 'sunset', bgColor1: '#12002b', bgColor2: '#4a1050',
    bgAngle: 200, chroma: 7, elGrid: true, glow: 28, barCount: 64, bgDim: 0.2
  }),
  make('Prism', 'Hue-shifting gradient with a light trail', {
    visType: 'circular', colorMode: 'gradient', color1: '#ff5cf0', color2: '#5cf0ff',
    bgType: 'radial', bgColor1: '#04040a', bgColor2: '#141433',
    hueShift: 140, trail: 0.55, glow: 34, barCount: 128, elGhostBars: false
  }),
  make('Deep Space', 'Starfield tunnel with drifting particles', {
    visType: 'starfield', colorMode: 'deep', bgType: 'radial', bgColor1: '#01030a',
    bgColor2: '#06162e', glow: 20, elParticles: false, elGhostBars: false, bgDim: 0.05
  }),
  make('Sonic Web', 'Node mesh that tightens as the low end hits', {
    visType: 'web', colorMode: 'gradient', color1: '#22d3ee', color2: '#a78bfa',
    bgType: 'solid', bgColor1: '#04060d', glow: 26, spin: 0.3, barCount: 96, elGrid: true
  }),
  make('Aurora', 'Layered ribbons breathing above a dark horizon', {
    visType: 'aurora', colorMode: 'toxic', bgType: 'linear', bgColor1: '#01070a',
    bgColor2: '#062028', bgAngle: 180, glow: 32, elGhostBars: false,
    elParticles: false, bgDim: 0.1
  }),
  make('Tokyo Drift', 'Spikes punching out with an aggressive beat zoom', {
    visType: 'spikes', colorMode: 'neon', bgType: 'solid', bgColor1: '#04010a',
    glow: 30, spin: -0.5, barCount: 128, beatZoom: 0.12, elGhostBars: false
  }),
  make('Mountains', 'Receding ridge lines over a cold gradient', {
    visType: 'terrain', colorMode: 'ice', bgType: 'linear', bgColor1: '#010810',
    bgColor2: '#0b2c4a', bgAngle: 180, glow: 18, barCount: 90,
    elGhostBars: false, elParticles: false
  }),
  make('Double Wave', 'Twin waveforms wrapped around a ribbon of light', {
    visType: 'dualWave', colorMode: 'gradient', color1: '#38bdf8', color2: '#f472b6',
    bgType: 'solid', bgColor1: '#050510', glow: 26, lineWidth: 3.5,
    elGhostBars: false, elParticles: false
  }),
  make('Glitch Lab', 'Strobe grid with scanlines and hard chromatic tearing', {
    visType: 'strobe', colorMode: 'gradient', color1: '#f43f5e', color2: '#22d3ee',
    bgType: 'solid', bgColor1: '#020204', chroma: 11, scanlines: 0.45,
    glow: 14, barCount: 120, elGrid: false, elParticles: false, bgDim: 0
  }),
  make('Liquid Light', 'Lissajous figures with a long glowing trail', {
    visType: 'lissajous', colorMode: 'rainbow', bgType: 'radial', bgColor1: '#02030a',
    bgColor2: '#12082b', trail: 0.8, glow: 38, lineWidth: 3, spin: 0.25,
    elGhostBars: false, elParticles: false
  }),
  make('Butterfly', 'Symmetric mirror wings beating with the beat', {
    visType: 'mirrorSym', colorMode: 'candy', bgType: 'radial', bgColor1: '#0a0410',
    bgColor2: '#2b0f3a', glow: 30, barCount: 72, beatZoom: 0.08,
    elGhostBars: false, elParticles: false
  })
];

/** Format presets for social platforms, applied on top of any look. */
export const FORMATS = [
  { value: '1920x1080', label: 'YouTube 16:9', detail: '1920 × 1080' },
  { value: '1080x1920', label: 'Shorts / Reels / TikTok', detail: '1080 × 1920' },
  { value: '1080x1080', label: 'Instagram square', detail: '1080 × 1080' },
  { value: '1280x720', label: 'Lightweight 720p', detail: '1280 × 720' }
];

/** Find the preset whose look exactly matches the current settings. */
export function matchPreset(settings, presets = PRESETS) {
  return presets.find((p) =>
    Object.entries(p.settings).every(([k, v]) => {
      const current = settings[k];
      if (typeof v === 'number' && typeof current === 'number') return Math.abs(v - current) < 1e-6;
      return v === current;
    })
  ) || null;
}

/**
 * Pull a dominant and secondary colour out of an image or video frame.
 * Falls back to the current palette when the source is not readable (for
 * example a cross-origin video), so callers never have to branch.
 *
 * @returns {{primary:string, secondary:string, contrast:string}|null}
 */
export function extractColors(source, width, height) {
  try {
    const size = 32;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const buckets = new Map();
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let counted = 0;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      rSum += r; gSum += g; bSum += b;
      counted++;
      // Coarse quantisation gives stable buckets across similar pixels.
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      const entry = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      entry.r += r; entry.g += g; entry.b += b; entry.n++;
      buckets.set(key, entry);
    }
    if (!counted || !buckets.size) return null;

    const ranked = Array.from(buckets.values())
      .map((e) => ({ r: Math.round(e.r / e.n), g: Math.round(e.g / e.n), b: Math.round(e.b / e.n), n: e.n }))
      .sort((a, b) => b.n - a.n);

    const toHex = ({ r, g, b }) =>
      `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;

    const primary = ranked[0];
    // Secondary should differ visibly from the primary so gradients read well.
    const secondary = ranked.find((e) =>
      Math.abs(e.r - primary.r) + Math.abs(e.g - primary.g) + Math.abs(e.b - primary.b) > 90
    ) || ranked[Math.min(1, ranked.length - 1)];

    const avg = { r: Math.round(rSum / counted), g: Math.round(gSum / counted), b: Math.round(bSum / counted) };
    const lum = (0.2126 * avg.r + 0.7152 * avg.g + 0.0722 * avg.b) / 255;

    return {
      primary: toHex(primary),
      secondary: toHex(secondary),
      contrast: lum > 0.55 ? '#111318' : '#ffffff'
    };
  } catch {
    return null;
  }
}