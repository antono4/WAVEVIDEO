# AGENTS.md

Repository-specific notes for agents and contributors working on Wavevideo
Studio. Keep this file current when the architecture or workflows change.

## What this project is

A browser-based music visualizer and lyric video maker. Static files, no build
step, no runtime dependencies, no backend. Audio is decoded locally and never
uploaded.

## Commands

```bash
python3 -m http.server 12000   # serve locally, then open http://localhost:12000
npm test                        # Node built-in test runner over tests/*.test.js
node --check assets/js/x.js     # syntax check a single module
```

There is no install step. `npm test` downloads nothing.

## Layout

```
index.html              shell, icon sprite, dialogs
assets/css/app.css      design tokens, layout, components
assets/js/schema.js     DEFAULT_SETTINGS + declarative inspector description
assets/js/store.js      state, undo/redo, autosave, settings JSON
assets/js/renderer.js   drawFrame(): the only place that draws a frame
assets/js/audio.js      Web Audio graph, FFT analysis, beat detection, peaks
assets/js/lyrics.js     parsing, timing, karaoke plans, LRC interchange
assets/js/timeline.js   waveform canvas, trim handles, lyric markers
assets/js/exporter.js   MediaRecorder capture of canvas + audio
assets/js/presets.js    built-in looks, colour extraction
assets/js/ui.js         inspector builder, toasts
assets/js/main.js       application controller
tests/                  pure-logic tests, no DOM
```

## Invariants worth preserving

**One renderer.** Canvas, preset thumbnails and PNG stills all go through
`Renderer.drawFrame()`. Never add a second drawing path, or thumbnails will
drift from the canvas.

**Schema drives the UI.** Adding a setting to `DEFAULT_SETTINGS` without adding
an inspector control makes `tests/schema.test.js` fail. That is intentional.
Composite controls declare `owns: [...]` to list the settings they manage.

**Controls get ids from their settings path.** The pane builder sets
`element.id = def.path`, which is how other code looks controls up and how
headless tests drive them.

**Do not mix playhead clocks.** `AudioEngine` picks either the audio clock or
the wall clock once, in `play()`, and keeps it for the whole run. Mixing them
mid-playback lets the playhead jump backwards when a suspended AudioContext
resumes.

**Never attach a recorder audio track from a suspended context.** It makes the
WebM muxer emit zero bytes, producing an empty file with no error. `play()`
never awaits `resume()` for the same reason: a frozen promise must not stall the
transport.

**Export pacing.** `captureStream(0)` plus explicit `videoTrack.requestFrame()`
gives deterministic frame pacing. Automatic capture silently produced no frames
in headless testing.

## Testing

`npm test` covers pure logic only: utils, lyrics and LRC, the store, and schema
integrity. Rendering, audio and export require a browser. When changing
`renderer.js` or `exporter.js`, verify in a browser that:

- all twelve visualizer styles draw something distinct
- a preset thumbnail matches the canvas after applying the preset
- playback advances and the seek bar tracks it
- an export produces a non-empty file (webm or mp4)

A quick way to drive the app headlessly is to copy `index.html` to a scratch
page, append a module script that talks to `window.wavevideo`, and load it. The
controller exposes `loadDemoTone()`, `startPlayback()`, `startExport()`,
`store`, `exporter` and `infoValue()` for this purpose. Delete the scratch page
before committing; `.gitignore` already ignores `test.html` and `probe*.html`.

## Gotchas

- `window.wavevideo` is only assigned after `main.js` finishes importing, so a
  test harness must poll for it rather than checking once.
- The AudioContext starts suspended. Playback still works because the wall
  clock drives it, but audio is silent and export is silent until the user
  interacts with the page. The app warns when it records a silent video.
- Background tabs throttle `requestAnimationFrame`, which is why the export
  pump falls back to `setTimeout` when `document.hidden`.
- `localStorage` does not hold `lyricsText` (size) or background media
  (`IndexedDB` is used for media instead).
- Lyric timestamps in the timeline come from `store` changes, not from polling.

## Style

Two-space indent, single quotes, semicolons, named exports, JSDoc on exported
functions. Comments explain why something non-obvious is the way it is. Do not
narrate code or restate the change history in comments.