import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clamp, lerp, mod, formatTime, formatShort, formatBytes,
  parseResolution, hexToRgb, rgbCss, mixRgb, hslCss, escapeHtml, luminance
} from '../assets/js/utils.js';

test('clamp bounds values', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test('lerp and mod behave as expected', () => {
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(mod(-1, 3), 2);
  assert.equal(mod(4, 3), 1);
});

test('formatTime renders m:ss.t with configurable precision', () => {
  assert.equal(formatTime(0), '0:00.0');
  assert.equal(formatTime(65.4), '1:05.4');
  assert.equal(formatTime(125.99, 2), '2:05.99');
  assert.equal(formatTime(-5), '0:00.0');
  assert.equal(formatTime(Infinity), '0:00.0');
});

test('formatShort renders mm:ss without decimals', () => {
  assert.equal(formatShort(0), '0:00');
  assert.equal(formatShort(61), '1:01');
});

test('formatBytes scales units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
});

test('parseResolution falls back for malformed input', () => {
  assert.deepEqual(parseResolution('1920x1080'), [1920, 1080]);
  assert.deepEqual(parseResolution('1080x1920'), [1080, 1920]);
  assert.deepEqual(parseResolution('nonsense'), [1920, 1080]);
});

test('hexToRgb handles short and long forms', () => {
  assert.deepEqual(hexToRgb('#ff0000'), [255, 0, 0]);
  assert.deepEqual(hexToRgb('#0f0'), [0, 255, 0]);
  assert.deepEqual(hexToRgb('not-a-colour'), [255, 255, 255]);
});

test('rgbCss and mixRgb produce css colours', () => {
  assert.equal(rgbCss([1, 2, 3]), 'rgb(1,2,3)');
  assert.equal(rgbCss([1, 2, 3], 0.5), 'rgba(1,2,3,0.5)');
  assert.deepEqual(mixRgb([0, 0, 0], [10, 10, 10], 0.5), [5, 5, 5]);
});

test('hslCss wraps hue and clamps saturation and lightness', () => {
  assert.equal(hslCss(370, 50, 50), 'hsl(10,50%,50%)');
  assert.equal(hslCss(-10, 200, 200), 'hsl(350,100%,100%)');
});

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml('<b>"x" & \'y\'</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
});

test('luminance ranks light above dark', () => {
  assert.ok(luminance([255, 255, 255]) > luminance([0, 0, 0]));
  assert.ok(luminance([255, 255, 255]) > 0.9);
});
