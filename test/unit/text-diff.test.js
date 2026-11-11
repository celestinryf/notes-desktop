'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { diffText, diffCounts, diffSummary, WORD_TOKEN_LIMIT, MAX_EDIT_DISTANCE } = require('../../src/shared/text-diff.mts');

const joined = (segments, kind) => segments.filter((s) => s.kind === kind).map((s) => s.text).join('');
const rebuilt = (segments, side) => segments.filter((s) => s.kind === 'same' || s.kind === side).map((s) => s.text).join('');
const roundTrips = (segments, before, after) => { assert.equal(rebuilt(segments, 'del'), before); assert.equal(rebuilt(segments, 'add'), after); };

test('identical text is one same segment, and empty text is no segment', () => {
  assert.deepEqual(diffText('a b', 'a b'), [{ kind: 'same', text: 'a b' }]);
  assert.deepEqual(diffText('', ''), []);
});

test('an inserted word shows as added, a dropped word as removed, and both sides rebuild', () => {
  const segs = diffText('the cat sat', 'the black cat sat');
  assert.equal(joined(segs, 'add'), 'black ');
  assert.equal(joined(segs, 'del'), '');
  roundTrips(segs, 'the cat sat', 'the black cat sat');
  const gone = diffText('the black cat sat', 'the cat sat');
  assert.equal(joined(gone, 'del'), 'black ');
  assert.equal(joined(gone, 'add'), '');
});

test('a replaced word is a removal next to an addition, not a rewrite of the line', () => {
  const segs = diffText('I like tea.\nSecond line.', 'I like coffee.\nSecond line.');
  assert.deepEqual(segs.map((s) => s.kind), ['same', 'del', 'add', 'same']);
  assert.equal(joined(segs, 'del'), 'tea');
  assert.equal(joined(segs, 'add'), 'coffee');
});

test('all added and all removed', () => {
  assert.deepEqual(diffText('', 'new text'), [{ kind: 'add', text: 'new text' }]);
  assert.deepEqual(diffText('old text', ''), [{ kind: 'del', text: 'old text' }]);
});

test('a rewritten sentence is one replacement block, not a word-by-word braid', () => {
  const before = 'Budget review stays in February, with the hiring plan folded in.';
  const after = 'Budget review moved to the first week of March.';
  const segs = diffText(before, after);
  assert.deepEqual(segs.map((s) => s.kind), ['same', 'del', 'add', 'same']);
  assert.equal(segs[0].text, 'Budget review ');
  assert.equal(segs[1].text, 'stays in February, with the hiring plan folded in');
  assert.equal(segs[2].text, 'moved to the first week of March');
  roundTrips(segs, before, after);
});

test('isolated insertions stay separate instead of swallowing the words between them', () => {
  const segs = diffText('Hello world', 'Hello, big world!');
  assert.equal(joined(segs, 'del'), '');
  assert.equal(joined(segs, 'add').replace(/\s/g, ''), ',big!');
  roundTrips(segs, 'Hello world', 'Hello, big world!');
  for (let i = 1; i < segs.length; i++) assert.notEqual(segs[i].kind, segs[i - 1].kind);
});

test('two changed numbers three words apart stay separate; two words apart they group', () => {
  const apart = diffText('pay 10 on the 3rd and 20 after', 'pay 11 on the 3rd and 21 after');
  assert.equal(apart.filter((s) => s.kind === 'del').length, 2);
  const near = diffText('pay 10 on 20 after', 'pay 11 on 21 after');
  assert.deepEqual(near.map((s) => s.kind), ['same', 'del', 'add', 'same']);
  assert.equal(joined(near, 'del'), '10 on 20');
  roundTrips(near, 'pay 10 on 20 after', 'pay 11 on 21 after');
});

test('accented, Greek and CJK words are whole tokens and count as words', () => {
  const segs = diffText('Un café très chaud', 'Un café très froid');
  assert.equal(joined(segs, 'del'), 'chaud');
  assert.equal(joined(segs, 'add'), 'froid');
  assert.deepEqual(diffCounts(diffText('καλημέρα κόσμε', 'καλησπέρα κόσμε')), { added: 1, removed: 1, places: 1 });
  assert.deepEqual(diffCounts(diffText('', '日本語')), { added: 1, removed: 0, places: 1 });
});

test('unicode words and newlines survive the round trip', () => {
  const before = 'Ünïcode wörds\n\nand a paragraph.';
  const after = 'Ünïcode wörds\n\nand another paragraph.\nPlus one.';
  roundTrips(diffText(before, after), before, after);
});

test('a text over the word-token limit falls back to lines and still rebuilds both sides', () => {
  const lines = [];
  for (let i = 0; i < WORD_TOKEN_LIMIT / 4; i++) lines.push('line ' + i + ' word');
  const before = lines.join('\n');
  const after = lines.map((l, i) => (i === 10 ? 'changed line' : l)).join('\n') + '\nextra';
  const segs = diffText(before, after);
  roundTrips(segs, before, after);
  assert.equal(joined(segs, 'del'), 'line 10 word\nline 9999 word');
});

test('a shared head and tail do not count toward the token limit', () => {
  const same = Array.from({ length: WORD_TOKEN_LIMIT }, (_, i) => 'w' + i).join(' ');
  const segs = diffText(same + ' tea', same + ' coffee');
  assert.equal(joined(segs, 'del'), 'tea');
  assert.equal(joined(segs, 'add'), 'coffee');
});

test('two large unrelated texts finish quickly as one removal and one addition, within bounded memory', () => {
  const before = Array.from({ length: MAX_EDIT_DISTANCE * 3 }, (_, i) => 'old' + i).join(' ');
  const after = Array.from({ length: MAX_EDIT_DISTANCE * 3 }, (_, i) => 'new' + i).join(' ');
  const started = Date.now();
  const segs = diffText(before, after);
  assert.ok(Date.now() - started < 5000);
  assert.deepEqual(segs.map((s) => s.kind), ['del', 'add']);
  roundTrips(segs, before, after);
});

test('counts and summary are in words and places', () => {
  const segs = diffText('one two three', 'one four five six');
  assert.deepEqual(diffCounts(segs), { added: 3, removed: 2, places: 1 });
  assert.equal(diffSummary({ added: 3, removed: 2, places: 1 }), '3 words added, 2 removed.');
  assert.equal(diffSummary({ added: 1, removed: 0, places: 1 }), '1 word added.');
  assert.equal(diffSummary({ added: 0, removed: 1, places: 1 }), '1 word removed.');
  assert.equal(diffSummary({ added: 0, removed: 0, places: 0 }), 'No words differ.');
  assert.equal(diffSummary({ added: 0, removed: 0, places: 1 }), 'Only spacing or punctuation differs.');
  assert.equal(diffSummary({ added: 4, removed: 1, places: 3 }), '4 words added, 1 removed, in 3 places. F3 steps through them.');
  assert.deepEqual(diffCounts(diffText('a.', 'a!')), { added: 0, removed: 0, places: 1 });
  assert.equal(diffCounts(diffText('pay 10 on the 3rd and 20 after', 'pay 11 on the 3rd and 21 after')).places, 2);
});
