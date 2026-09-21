import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS, SECTIONS, SECTION_ORDER, SECTION_META, SCRATCH_FIELDS } from '../assets/js/schema.js';
import { PRESETS, matchPreset, FORMATS, extractColors } from '../assets/js/presets.js';

/** Collect every settings path the inspector schema references. */
function collectPaths(defs, out = new Set()) {
  for (const def of defs) {
    if (def.path) out.add(def.path);
    if (def.owns) def.owns.forEach((p) => out.add(p));
    if (def.children) collectPaths(def.children, out);
  }
  return out;
}

test('every section in the ordering has content and metadata', () => {
  assert.equal(SECTION_ORDER.length, 8);
  for (const key of SECTION_ORDER) {
    assert.ok(SECTIONS[key], `missing section ${key}`);
    assert.ok(SECTION_META[key], `missing meta for ${key}`);
    assert.ok(Array.isArray(SECTIONS[key]) && SECTIONS[key].length > 0, `empty section ${key}`);
  }
});

test('every schema path exists in DEFAULT_SETTINGS or is scratch state', () => {
  for (const key of SECTION_ORDER) {
    const paths = collectPaths(SECTIONS[key]);
    for (const path of paths) {
      const known = path in DEFAULT_SETTINGS || SCRATCH_FIELDS.has(path);
      assert.ok(known, `section ${key} references unknown setting "${path}"`);
    }
  }
});

test('every default setting is reachable from the inspector', () => {
  const reachable = new Set();
  for (const key of SECTION_ORDER) collectPaths(SECTIONS[key], reachable);
  const missing = Object.keys(DEFAULT_SETTINGS).filter((k) => !reachable.has(k));
  assert.deepEqual(missing, [], `settings with no UI control: ${missing.join(', ')}`);
});

test('export formats cover the common social shapes', () => {
  const values = FORMATS.map((f) => f.value);
  assert.ok(values.includes('1080x1920'), 'vertical is needed for shorts and reels');
  assert.ok(values.includes('1080x1080'), 'square is needed for feed posts');
  for (const format of FORMATS) {
    assert.ok(format.label && format.detail, 'formats need a label and detail');
  }
});

test('extractColors returns null instead of throwing without a canvas', () => {
  // No DOM here, so the guarded path must degrade rather than blow up.
  assert.equal(extractColors(null, 0, 0), null);
});

test('defaults have coherent types and ranges', () => {
  assert.equal(typeof DEFAULT_SETTINGS.volume, 'number');
  assert.ok(DEFAULT_SETTINGS.volume >= 0 && DEFAULT_SETTINGS.volume <= 1);
  assert.equal(typeof DEFAULT_SETTINGS.lyricsOn, 'boolean');
  assert.equal(typeof DEFAULT_SETTINGS.titleText, 'string');
  assert.ok(DEFAULT_SETTINGS.barCount >= 8);
});

test('presets are well formed and complete', () => {
  assert.ok(PRESETS.length >= 10);
  const names = new Set();
  for (const preset of PRESETS) {
    assert.ok(preset.name && typeof preset.name === 'string');
    assert.ok(preset.description, `${preset.name} needs a description`);
    assert.ok(!names.has(preset.name), `duplicate preset name ${preset.name}`);
    names.add(preset.name);
    // A preset must fully describe a look, never leave a key undefined.
    for (const [key, value] of Object.entries(preset.settings)) {
      assert.ok(key in DEFAULT_SETTINGS, `${preset.name} sets unknown key ${key}`);
      assert.equal(typeof value, typeof DEFAULT_SETTINGS[key], `${preset.name}.${key} type mismatch`);
    }
  }
});

test('presets never carry titles, which belong to the user', () => {
  for (const preset of PRESETS) {
    assert.equal(preset.settings.titleText, '', `${preset.name} should not set a title`);
    assert.equal(preset.settings.subText, '', `${preset.name} should not set a subtitle`);
  }
});

test('matchPreset finds an exact match and rejects near misses', () => {
  const preset = PRESETS[0];
  const exact = { ...DEFAULT_SETTINGS, ...preset.settings };
  assert.equal(matchPreset(exact, PRESETS)?.name, preset.name);

  const altered = { ...exact, barCount: exact.barCount + 1 };
  assert.equal(matchPreset(altered, PRESETS), null);
});

test('presets differ from each other', () => {
  const seen = new Set();
  for (const preset of PRESETS) {
    const signature = JSON.stringify(preset.settings);
    assert.ok(!seen.has(signature), `${preset.name} duplicates another preset`);
    seen.add(signature);
  }
});