# Contributing

Thanks for taking a look. This project is intentionally small: plain ES
modules, no framework, no bundler, no runtime dependencies. Please keep it that
way unless there is a strong reason.

## Getting set up

```bash
git clone https://github.com/antono4/WAVEVIDEO.git
cd WAVEVIDEO
python3 -m http.server 12000   # then open http://localhost:12000
npm test                        # runs the Node test suite
```

There is no install step. `npm test` uses the Node built-in test runner, so no
packages are downloaded.

## Ground rules

**No build step.** The files served are the files in the repository. If a change
would require a bundler or a transpiler, it needs a discussion first.

**No runtime dependencies.** Everything is written against browser APIs.

**Keep modules single-purpose.** The existing split is described in the README.
New behaviour should usually extend an existing module rather than add a new
one.

**Comment the why, not the what.** Comments in this codebase explain non-obvious
constraints, such as why the playhead clock is chosen once per playback or why
an audio track is skipped when the context is suspended. Do not narrate the
code.

## Where things live

| Task | File |
| --- | --- |
| Add or change a setting | `assets/js/schema.js`, plus the control entry in `SECTIONS` |
| Add a visualizer style | `assets/js/renderer.js`, then register it in `VIS_TYPES` |
| Add a preset | `assets/js/presets.js` |
| Change the timeline | `assets/js/timeline.js` |
| Change export behaviour | `assets/js/exporter.js` |

If you add a setting, the test suite will fail until it has an inspector
control. That is deliberate.

## Testing

```bash
npm test
```

The suite covers pure logic. Anything touching the canvas, Web Audio or
`MediaRecorder` needs manual verification in a browser. Before opening a pull
request, please confirm:

- all twelve visualizer styles still draw
- a preset thumbnail matches what the canvas shows after applying it
- playback, seeking and trim handles behave
- an export finishes and produces a non-empty file
- the browser console is free of errors

## Pull requests

- One logical change per pull request.
- Explain what problem it solves, not just what it changes.
- Note anything you could not test and why.
- Match the existing code style: two-space indent, single quotes, semicolons,
  named exports, JSDoc on exported functions.

## Reporting bugs

Include the browser and version, what you did, what you expected, what happened,
and any console output. For rendering or export problems, a screenshot and the
settings JSON (Export section, "Save settings JSON") make it much faster to
reproduce.

## Licence

By contributing you agree that your work is released under the MIT licence in
this repository.