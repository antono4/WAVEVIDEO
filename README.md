# Wavevideo Studio

A music visualizer and lyric video maker that runs entirely in the browser.

No account, no upload, no watermark, and no build step. Open `index.html` and
start working. Audio is decoded locally with the Web Audio API and never leaves
your machine.

**[Open the app](https://antono4.github.io/WAVEVIDEO/)** · [Report a bug](https://github.com/antono4/WAVEVIDEO/issues)

---

## What it does

- **12 visualizer styles** — bars, mirrored bars, waveform line, filled waveform,
  blocks, dot matrix, circular bars, radial wave, pulse rings, LED meter,
  symmetric mirror and spectrum area.
- **12 built-in presets** — thumbnails are rendered by the same engine that
  draws the canvas, so a preset looks identical before and after you apply it.
  Applying a preset preserves your audio, trim points and titles.
- **Full colour control** — gradient, solid, rainbow, fire, ice and neon modes,
  unlimited palettes, plus one-click colour extraction from your own artwork.
- **Backdrops** — solid, linear gradient, radial gradient, or your own image and
  video with zoom, blur, drift motion, darkening and vignette.
- **Titles and logo** — title and subtitle with font, weight, size, colour,
  spacing, position and shadow, plus an optional own-brand logo overlay.
- **Lyric video** — timestamped lines with translation support, per-word karaoke
  fill, neighbouring-line preview, and plain `.lrc` import and export.
- **Overlay layers** — ghost bars, particles, reactive ring, top spectrum,
  centre line, grid, film grain and a layer opacity master.
- **Timeline** — real waveform with click-to-seek, draggable in and out trim
  handles that exports honour, and markers for every lyric timestamp.
- **Export** — 720p through 1440p, plus square and vertical 9:16 for shorts and
  reels. Choose 24, 30 or 60 fps and your bitrate. Still frames save as PNG.
- **Undo and redo**, autosave to local storage, and shareable settings JSON.

## Getting started

The app is static, so any static file server works.

```bash
# serve the folder, then open http://localhost:12000
python3 -m http.server 12000
```

Or with Node:

```bash
npx serve .
```

You can also just open `index.html` from disk. A server is recommended because
ES modules are blocked by the browser on `file://` URLs.

Press **Load demo tone** to generate a track and try everything without
supplying a file.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play or pause |
| `←` `→` | Seek 5 seconds |
| `Home` `End` | Jump to start or end |
| `Ctrl`+`Z` | Undo |
| `Ctrl`+`Shift`+`Z` | Redo |
| `Ctrl`+`E` | Open the export panel |
| `Ctrl`+`S` | Save settings as JSON |
| `1`…`8` | Jump to a section |
| `I` | Stamp a lyric line at the playhead |
| `F` | Fullscreen preview |

## Lyric format

One line per row: `time|text|optional translation`.

```text
0:00.0|Intro
0:12.5|Every *word* can carry a beat
0:18.0|Second line|Terjemahan baris kedua
```

Wrap words in `*asterisks*` to give them their own karaoke timing within a line.
Import and export standard `.lrc` files from the Lyrics section.

## Architecture

Plain ES modules, no framework, no bundler, no dependencies.

```
index.html              shell and markup
assets/css/app.css      design tokens and layout
assets/js/
  schema.js             every setting and the inspector description
  store.js              state, undo and redo, autosave, settings JSON
  renderer.js           the draw pipeline shared by canvas and thumbnails
  audio.js              Web Audio graph, analysis and beat detection
  lyrics.js             parsing, timing, karaoke plans, LRC interchange
  timeline.js           waveform, trim handles and lyric markers
  exporter.js           canvas and audio capture for video export
  presets.js            built-in looks and colour extraction
  ui.js                 inspector builder and toasts
  main.js               application controller
tests/                  Node test suite for the pure logic
```

Two design decisions are worth calling out.

**The renderer is a pure function of a frame description.** The live canvas,
preset thumbnails and still exports all call `Renderer.drawFrame()` with the
same object shape. A thumbnail cannot drift from the canvas because there is
only one drawing implementation.

**The inspector is generated from a declarative schema.** Each control names the
settings path it edits, and the test suite asserts that every setting has a
control and every control points at a real setting, so the defaults and the UI
cannot fall out of step.

## Testing

```bash
npm test
```

Roughly 54 tests cover the pure logic: utility formatting, lyric and LRC parsing
and round trips, karaoke word timing, the settings store including undo, redo,
autosave and JSON interchange, and schema integrity.

Rendering and export need a real browser, so they are verified manually. When
touching `renderer.js` or `exporter.js`, check that all twelve visualizer styles
still draw, that a preset thumbnail matches the canvas, and that an export
produces a non-empty file.

## Browser support

Chrome, Edge and other Chromium browsers are recommended. Video export uses
`MediaRecorder` and `canvas.captureStream()`, which Firefox supports and Safari
supports only partially. When recording is unavailable the app says so and the
preview, PNG frames and settings export keep working.

Export renders in realtime, so a three minute track takes about three minutes.
Keep the tab visible and in the foreground: browsers throttle hidden tabs, and
`requestAnimationFrame` pacing is what keeps frames in step with the audio.

One limitation to know about: browsers refuse to start audio before the user
interacts with the page. Starting an export is a click, so audio is normally
captured. If the audio context is still blocked the app records a silent video
and tells you rather than producing a corrupt file.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT. See [LICENSE](LICENSE).