/**
 * Single source of truth for every tunable parameter.
 *
 * DEFAULT_SETTINGS drives the initial state, undo/redo snapshots and the
 * settings JSON format. SECTIONS drives the inspector UI: each control names
 * the settings path it edits, so the pane builder and the defaults can never
 * drift apart.
 */

export const DEFAULT_SETTINGS = {
  // audio
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  trimEnabled: false,
  trimStart: 0,
  trimEnd: 0,
  // visualizer
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
  // colour
  colorMode: 'gradient',
  color1: '#8b5cf6',
  color2: '#06b6d4',
  // backdrop
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
  // titles
  titleText: 'YOUR TRACK TITLE',
  titleFont: 'Inter, system-ui, sans-serif',
  titleWeight: 800,
  titleSize: 64,
  titleColor: '#ffffff',
  titleX: 0,
  titleY: -0.62,
  titleSpacing: 2,
  titleShadow: true,
  subText: 'Artist Name',
  subSize: 26,
  subColor: '#cfd4e6',
  subX: 0,
  subY: -0.42,
  logoEnabled: false,
  logoSize: 0.14,
  logoX: 0.72,
  logoY: -0.72,
  // lyrics
  lyricsOn: false,
  lyricsText: '',
  lyricSize: 44,
  lyricY: 0.35,
  lyricColor: '#ffffff',
  lyricDim: '#ffffff',
  lyricKaraoke: true,
  lyricShowNeighbours: true,
  // layered elements
  elGhostBars: true,
  elParticles: true,
  elRing: false,
  elTopSpec: false,
  elCenterLine: false,
  elGrid: false,
  elNoise: false,
  elOpacity: 0.5,
  // export
  resPreset: '1920x1080',
  fps: '30',
  bitrate: '8000000'
};

/**
 * Inspector fields that hold transient UI scratch text rather than persisted
 * settings. Kept separate so the schema coverage test can tell the difference.
 */
export const SCRATCH_FIELDS = new Set(['autoLyrics']);

export const SECTION_META = {
  presets: { title: 'Presets', icon: 'i-wand' },
  audio: { title: 'Audio', icon: 'i-audio' },
  visualizer: { title: 'Visualizer', icon: 'i-wave' },
  backdrop: { title: 'Backdrop', icon: 'i-image' },
  titles: { title: 'Titles', icon: 'i-type' },
  lyrics: { title: 'Lyrics', icon: 'i-lyrics' },
  elements: { title: 'Layers', icon: 'i-layers' },
  export: { title: 'Export', icon: 'i-export' }
};

export const SECTION_ORDER = [
  'presets', 'audio', 'visualizer', 'backdrop', 'titles', 'lyrics', 'elements', 'export'
];

export const SWATCHES = [
  ['#8b5cf6', '#06b6d4'], ['#f43f5e', '#fb923c'], ['#0ea5e9', '#8b5cf6'],
  ['#ef4444', '#fde047'], ['#22c55e', '#0f766e'], ['#f59e0b', '#dc2626'],
  ['#a3e635', '#06b6d4'], ['#ffffff', '#94a3b8'], ['#0ea5e9', '#1e3a8a'],
  ['#f97316', '#dc2626'], ['#a855f7', '#ec4899'], ['#14b8a6', '#eab308']
];

export const FONTS = [
  'Inter, system-ui, sans-serif',
  'Arial Black, Arial, sans-serif',
  'Georgia, serif',
  '"Times New Roman", serif',
  'Impact, Charcoal, sans-serif',
  '"Courier New", monospace',
  'Verdana, sans-serif',
  '"Trebuchet MS", sans-serif'
];

const VIS_TYPES = [
  ['bars', 'Bars'], ['barsMirror', 'Bars mirror'], ['wave', 'Waveform line'],
  ['waveFill', 'Waveform filled'], ['blocks', 'Blocks'], ['dots', 'Dot matrix'],
  ['circular', 'Circular bars'], ['radial', 'Radial wave'], ['rings', 'Pulse rings'],
  ['led', 'LED meter'], ['mirrorSym', 'Symmetric mirror'], ['spectrum', 'Spectrum area'],
  ['aurora', 'Aurora ribbons'], ['lissajous', 'Lissajous curves'],
  ['starfield', 'Starfield tunnel'], ['spikes', 'Radial spikes'],
  ['dualWave', 'Dual waveform'], ['terrain', 'Terrain ridges'],
  ['web', 'Web mesh'], ['strobe', 'Strobe grid']
];

const COLOR_MODES = [
  ['gradient', 'Gradient (colour 1 to 2)'], ['solid', 'Solid (colour 1)'],
  ['rainbow', 'Rainbow'], ['fire', 'Fire'], ['ice', 'Ice'], ['neon', 'Neon'],
  ['sunset', 'Sunset'], ['toxic', 'Toxic'], ['candy', 'Candy'],
  ['gold', 'Gold'], ['deep', 'Deep sea']
];

export const RESOLUTIONS = [
  { value: '1280x720', label: 'Landscape 720p', detail: '1280 × 720' },
  { value: '1920x1080', label: 'Landscape 1080p', detail: '1920 × 1080' },
  { value: '1080x1080', label: 'Square', detail: '1080 × 1080' },
  { value: '1080x1920', label: 'Vertical 9:16', detail: '1080 × 1920' },
  { value: '1440x1080', label: 'Classic 4:3', detail: '1440 × 1080' },
  { value: '2560x1440', label: 'QHD 1440p', detail: '2560 × 1440' }
];

export const FPS_OPTIONS = ['24', '30', '60'];

export const BITRATE_OPTIONS = [
  { value: '4000000', label: '4 Mbps — small file' },
  { value: '8000000', label: '8 Mbps — balanced' },
  { value: '16000000', label: '16 Mbps — high quality' },
  { value: '26000000', label: '26 Mbps — maximum' }
];

const r = (path, label, min, max, step, unit) => ({ type: 'range', path, label, min, max, step, unit });
const t = (path, label) => ({ type: 'toggle', path, label });
const c = (path, label) => ({ type: 'color', path, label });
const g = (title, children, opts = {}) => ({ type: 'group', title, children, ...opts });

/** Declarative description of the inspector panes. */
export const SECTIONS = {
  presets: [
    { type: 'presets' },
    g('How presets work', [
      { type: 'note', text: 'Each thumbnail is rendered by the same engine that draws the canvas, so a preset looks the same before and after you apply it. Applying a preset keeps your audio, audio trim and timeline untouched.' }
    ])
  ],

  audio: [
    { type: 'audioSource' },
    g('Track', [
      { type: 'info', id: 'audioInfo' },
      { type: 'actions', buttons: [
        { label: 'Remove audio', kind: 'danger', action: 'clearAudio' }
      ] }
    ]),
    g('Playback', [
      r('volume', 'Volume', 0, 1, 0.01),
      r('fadeIn', 'Fade in', 0, 10, 0.1, 's'),
      r('fadeOut', 'Fade out', 0, 10, 0.1, 's'),
      { type: 'note', text: 'Volume and fades are applied at preview and export time. Fades are measured against the export range.' }
    ]),
    g('Trim', [
      t('trimEnabled', 'Limit export range'),
      { type: 'range', path: 'trimStart', label: 'Start', min: 0, max: 600, step: 0.1, seconds: true },
      { type: 'range', path: 'trimEnd', label: 'End', min: 0, max: 600, step: 0.1, seconds: true },
      { type: 'actions', buttons: [
        { label: 'Set start to playhead', action: 'trimStartHere' },
        { label: 'Set end to playhead', action: 'trimEndHere' },
        { label: 'Clear trim', action: 'trimClear' }
      ] }
    ])
  ],

  visualizer: [
    g('Style', [
      { type: 'select', path: 'visType', label: 'Visualizer type', options: VIS_TYPES }
    ]),
    g('Shape', [
      r('barCount', 'Bar count', 12, 160, 1),
      r('gain', 'Level', 0.2, 3, 0.05),
      r('bassBoost', 'Bass weight', 0, 2, 0.05),
      r('glow', 'Glow', 0, 40, 1),
      r('rotation', 'Rotation', -3, 3, 0.05),
      t('mirrorOn', 'Mirror secondary bars'),
      t('beatScale', 'Scale pulse on beat')
    ]),
    g('Waveform', [
      { type: 'select', path: 'lineStyle', label: 'Line style', options: [['smooth', 'Smooth curve'], ['sharp', 'Sharp']] },
      r('lineWidth', 'Line width', 1, 14, 0.5)
    ]),
    g('Motion', [
      r('spin', 'Auto spin', -2, 2, 0.05),
      r('beatZoom', 'Beat zoom', 0, 0.35, 0.005),
      r('glowPulse', 'Glow pulse on beat', 0, 1, 0.02)
    ]),
    g('Effects', [
      r('chroma', 'Chromatic aberration', 0, 14, 0.5, 'px'),
      r('kaleido', 'Kaleidoscope', 0, 12, 1),
      r('hueShift', 'Hue shift', 0, 360, 1, 'deg'),
      r('trail', 'Motion trail', 0, 0.9, 0.02),
      r('scanlines', 'Scanlines', 0, 1, 0.02),
      { type: 'note', text: 'Effects stack on top of the visualizer. Kaleidoscope mirrors the frame into wedges, chromatic aberration splits the colour channels, and trail leaves light behind fast movement.' }
    ]),
    g('Reactivity', [
      r('beatSensitivity', 'Beat sensitivity', 0.6, 2.4, 0.05),
      r('screenPulse', 'Screen pulse', 0, 0.25, 0.01),
      r('screenFlash', 'Beat flash', 0, 0.6, 0.02)
    ]),
    g('Colour', [
      { type: 'select', path: 'colorMode', label: 'Colour mode', options: COLOR_MODES },
      { type: 'row', children: [c('color1', 'Primary'), c('color2', 'Secondary')] },
      { type: 'swatches' },
      { type: 'actions', buttons: [
        { label: 'Pull colours from backdrop', action: 'extractColors' }
      ] }
    ])
  ],

  backdrop: [
    g('Background', [
      { type: 'select', path: 'bgType', label: 'Type', options: [
        ['linear', 'Linear gradient'], ['radial', 'Radial gradient'], ['solid', 'Solid colour'],
        ['image', 'Image'], ['video', 'Video']
      ] },
      { type: 'row', children: [c('bgColor1', 'Colour A'), c('bgColor2', 'Colour B')] },
      r('bgAngle', 'Gradient angle', 0, 360, 1, 'deg')
    ]),
    g('Media', [
      { type: 'backdropMedia' },
      r('bgZoom', 'Zoom', 100, 250, 1, '%'),
      r('bgBlur', 'Blur', 0, 30, 1, 'px'),
      t('bgMotion', 'Slow drift motion'),
      { type: 'actions', buttons: [{ label: 'Remove media', kind: 'danger', action: 'clearBackdrop' }] }
    ]),
    g('Grade', [
      r('bgDim', 'Darken overlay', 0, 0.85, 0.01),
      t('vignette', 'Vignette')
    ])
  ],

  titles: [
    g('Title', [
      { type: 'text', path: 'titleText', label: 'Text' },
      { type: 'select', path: 'titleFont', label: 'Font', options: FONTS.map((f) => [f, f.split(',')[0].replace(/"/g, '')]) },
      { type: 'row', children: [r('titleSize', 'Size', 12, 200, 1, 'px'), r('titleWeight', 'Weight', 300, 900, 100)] },
      { type: 'row', children: [c('titleColor', 'Colour'), r('titleSpacing', 'Spacing', 0, 20, 0.5, 'px')] },
      { type: 'row', children: [r('titleX', 'X', -1, 1, 0.01), r('titleY', 'Y', -1, 1, 0.01)] },
      t('titleShadow', 'Drop shadow')
    ]),
    g('Subtitle', [
      { type: 'text', path: 'subText', label: 'Text' },
      { type: 'row', children: [r('subSize', 'Size', 10, 90, 1, 'px'), c('subColor', 'Colour')] },
      { type: 'row', children: [r('subX', 'X', -1, 1, 0.01), r('subY', 'Y', -1, 1, 0.01)] }
    ]),
    g('Logo', [
      t('logoEnabled', 'Show logo watermark'),
      { type: 'backdropMedia', kind: 'logo', label: 'Logo image' },
      { type: 'note', text: 'Optional own-brand mark. Wavevideo never adds a watermark of its own.' },
      { type: 'row', children: [r('logoSize', 'Size', 0.03, 0.4, 0.01), r('logoX', 'X', -1, 1, 0.01)] },
      { type: 'row', children: [r('logoY', 'Y', -1, 1, 0.01)] }
    ])
  ],

  lyrics: [
    g('Lyric track', [
      t('lyricsOn', 'Enable lyrics'),
      { type: 'lyricEditor', owns: ['lyricsText'] },
      { type: 'lyricStatus' },
      { type: 'actions', buttons: [
        { label: 'Insert line at playhead', action: 'lyricStamp', key: 'I' },
        { label: 'Import LRC', action: 'lyricImport' },
        { label: 'Export LRC', action: 'lyricExport' },
        { label: 'Clear', kind: 'danger', action: 'lyricClear' }
      ] }
    ]),
    g('Auto timings', [
      { type: 'note', text: 'Paste plain lyrics, one line per row, with no timestamps. The studio spreads them evenly across the export range as a starting point, then you can nudge individual lines.' },
      { type: 'textarea', path: 'autoLyrics', label: 'Plain lyrics', rows: 6, placeholder: 'First line\nSecond line\nThird line' },
      { type: 'actions', buttons: [{ label: 'Distribute evenly', action: 'lyricAuto' }] }
    ]),
    g('Style', [
      { type: 'row', children: [r('lyricSize', 'Size', 16, 140, 1, 'px'), r('lyricY', 'Y', -1, 1, 0.01)] },
      { type: 'row', children: [c('lyricColor', 'Active'), c('lyricDim', 'Inactive')] },
      t('lyricKaraoke', 'Per-word karaoke fill'),
      t('lyricShowNeighbours', 'Show neighbouring lines'),
      { type: 'note', text: 'Wrap words in *asterisks* to give them their own karaoke timing within a line.' }
    ])
  ],

  elements: [
    g('Overlay layers', [
      t('elGhostBars', 'Ghost bars'),
      t('elParticles', 'Drifting particles'),
      t('elRing', 'Reactive ring'),
      t('elTopSpec', 'Top spectrum'),
      t('elCenterLine', 'Centre guide line'),
      t('elGrid', 'Grid'),
      t('elNoise', 'Film grain'),
      r('elOpacity', 'Layer opacity', 0, 1, 0.02)
    ])
  ],

  export: [
    g('Output', [
      { type: 'exportGrid', owns: ['resPreset', 'fps', 'bitrate'] }
    ]),
    g('Recording', [
      { type: 'note', text: 'Rendering is realtime: a three minute track takes about three minutes. Keep this tab visible and in the foreground, otherwise the browser throttles the canvas and frames are dropped.' },
      { type: 'exportActions' },
      { type: 'exportProgress' }
    ]),
    g('Stills and data', [
      { type: 'actions', buttons: [
        { label: 'Save current frame PNG', action: 'saveFrame' },
        { label: 'Save settings JSON', action: 'saveSettings', key: 'Ctrl+S' },
        { label: 'Load settings JSON', action: 'loadSettings' }
      ] }
    ]),
    g('Last export', [
      { type: 'info', id: 'lastExport' },
      { type: 'actions', buttons: [{ label: 'Download again', action: 'downloadLast' }] }
    ])
  ]
};
