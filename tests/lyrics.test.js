import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseStamp, formatStamp, parseLyrics, serializeLyrics,
  parseLrc, serializeLrc, buildWordPlan, stripMarkers,
  resolveLyricState, distributeEvenly
} from '../assets/js/lyrics.js';

test('parseStamp accepts mm:ss and raw seconds', () => {
  assert.equal(parseStamp('1:00'), 60);
  assert.equal(parseStamp('0:12.5'), 12.5);
  assert.equal(parseStamp('2:03.25'), 123.25);
  assert.equal(parseStamp('12.5'), 12.5);
  assert.equal(parseStamp('garbage'), null);
  assert.equal(parseStamp(''), null);
});

test('formatStamp round-trips through parseStamp', () => {
  for (const seconds of [0, 1.5, 12.5, 61.25, 3599.9]) {
    const stamp = formatStamp(seconds);
    const back = parseStamp(stamp);
    assert.ok(Math.abs(back - seconds) < 0.06, `${stamp} -> ${back} vs ${seconds}`);
  }
});

test('parseLyrics skips comments, blanks and untimed rows', () => {
  const lines = parseLyrics([
    '# a comment',
    '',
    '0:00.0|First line',
    'no timestamp here',
    '0:05.0|Second line|Translation',
    '  0:02.0|Out of order  '
  ].join('\n'));
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.text), ['First line', 'Out of order', 'Second line']);
  assert.equal(lines[2].trans, 'Translation');
});

test('parseLyrics sorts by time', () => {
  const lines = parseLyrics('0:10|x\n0:01|y\n0:05|z');
  assert.deepEqual(lines.map((l) => l.time), [1, 5, 10]);
});

test('serializeLyrics produces a parseable round trip', () => {
  const input = '0:01.0|one\n0:02.0|two|deux';
  const lines = parseLyrics(input);
  const reparsed = parseLyrics(serializeLyrics(lines));
  assert.deepEqual(reparsed, lines);
});

test('parseLrc reads tagged files and multiple stamps per row', () => {
  const lrc = [
    '[ar:Artist]',
    '[ti:Title]',
    '[00:12.50]Hello there',
    '[00:20.00]With translation / Terjemahan',
    '[00:30.00][00:35.00]Repeated line'
  ].join('\n');
  const lines = parseLrc(lrc);
  assert.equal(lines.length, 4);
  assert.equal(lines[0].time, 12.5);
  assert.equal(lines[0].text, 'Hello there');
  assert.equal(lines[1].trans, 'Terjemahan');
  assert.equal(lines[2].text, 'Repeated line');
  assert.equal(lines[3].time, 35);
});

test('serializeLrc writes a header and parseable rows', () => {
  const lines = [{ time: 12.5, text: 'Hello', trans: '' }, { time: 20, text: 'World', trans: 'Monde' }];
  const text = serializeLrc(lines, { artist: 'A', title: 'T' });
  assert.match(text, /\[ar:A\]/);
  assert.match(text, /\[ti:T\]/);
  const reparsed = parseLrc(text);
  assert.equal(reparsed.length, 2);
  assert.equal(reparsed[0].text, 'Hello');
  assert.equal(reparsed[1].trans, 'Monde');
});

test('buildWordPlan splits on asterisk emphasis and covers the line exactly', () => {
  const plan = buildWordPlan('sing *this* loud');
  const joined = plan.map((t) => t.text).join('');
  assert.equal(joined, 'sing this loud');
  assert.equal(plan[0].start, 0);
  assert.ok(Math.abs(plan[plan.length - 1].end - 1) < 1e-9);
  // emphasis tokens carry their own segment
  assert.ok(plan.some((t) => t.emphasis));
});

test('buildWordPlan produces contiguous non-overlapping shares', () => {
  const plan = buildWordPlan('a bb ccc dddd');
  for (let i = 1; i < plan.length; i++) {
    assert.ok(Math.abs(plan[i].start - plan[i - 1].end) < 1e-9);
    assert.ok(plan[i].end >= plan[i].start);
  }
});

test('buildWordPlan handles empty and marker-only input', () => {
  assert.equal(buildWordPlan('').length, 1);
  const plan = buildWordPlan('*only*');
  assert.equal(stripMarkers('*only*'), 'only');
  assert.equal(plan.length, 1);
  assert.equal(plan[0].text, 'only');
});

test('stripMarkers removes karaoke markers', () => {
  assert.equal(stripMarkers('a *b* c'), 'a b c');
});

test('resolveLyricState picks the active line and progress', () => {
  const lines = parseLyrics('0:00|one\n0:10|two\n0:20|three');
  const atStart = resolveLyricState(lines, 0, 40);
  assert.equal(atStart.activeIndex, 0);
  assert.equal(atStart.progress, 0);
  assert.equal(atStart.next.text, 'two');

  const mid = resolveLyricState(lines, 5, 40);
  assert.equal(mid.activeIndex, 0);
  assert.ok(Math.abs(mid.progress - 0.5) < 1e-6);

  const later = resolveLyricState(lines, 25, 40);
  assert.equal(later.activeIndex, 2);
  assert.equal(later.prev.text, 'two');
  assert.equal(later.next, null);
});

test('resolveLyricState clamps progress and handles an empty set', () => {
  const lines = parseLyrics('0:00|only');
  const state = resolveLyricState(lines, 999, 10);
  assert.equal(state.progress, 1);
  assert.equal(resolveLyricState([], 5, 10), null);
});

test('distributeEvenly spreads plain lyrics across a range', () => {
  const rows = distributeEvenly('a\nb\nc\nd', 0, 40);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].time, 0);
  assert.equal(rows[1].time, 10);
  assert.equal(rows[3].time, 30);
  assert.equal(distributeEvenly('', 0, 10).length, 0);
});

test('distributeEvenly keeps an inline translation', () => {
  const rows = distributeEvenly('hello|bonjour', 0, 10);
  assert.equal(rows[0].text, 'hello');
  assert.equal(rows[0].trans, 'bonjour');
});
