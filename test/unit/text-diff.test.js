'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { diffText, diffCounts, diffSummary, WORD_TOKEN_LIMIT } = require('../../src/shared/text-diff.mts');

const joined = (segments, kind) => segments.filter((s) => s.kind === kind).map((s) => s.text).join('');
const rebuilt = (segments, side) => segments.filter((s) => s.kind === 'same' || s.kind === side).map((s) => s.text).join('');

test('identical text is one same segment, and empty text is no segment', () => {
  assert.deepEqual(diffText('a b', 'a b'), [{ kind: 'same', text: 'a b' }]);
  assert.deepEqual(diffText('', ''), []);
});

test('an inserted word shows as added, a dropped word as removed, and both sides rebuild', () => {
  const segs = diffText('the cat sat', 'the black cat sat');
  assert.equal(joined(segs, 'add'), 'black ');
  assert.equal(joined(segs, 'del'), '');
  assert.equal(rebuilt(segs, 'del'), 'the cat sat');
  assert.equal(rebuilt(segs, 'add'), 'the black cat sat');
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

test('adjacent changes of one kind merge into one segment, and punctuation is its own token', () => {
  const segs = diffText('Hello world', 'Hello, big world!');
  assert.equal(joined(segs, 'add').replace(/\s/g, ''), ',big!');
  assert.equal(joined(segs, 'del'), '');
  assert.equal(rebuilt(segs, 'add'), 'Hello, big world!');
  assert.equal(rebuilt(segs, 'del'), 'Hello world');
  for (let i = 1; i < segs.length; i++) assert.notEqual(segs[i].kind, segs[i - 1].kind);
});

test('unicode words and newlines survive the round trip', () => {
  const before = 'Ünïcode wörds\n\nand a paragraph.';
  const after = 'Ünïcode wörds\n\nand another paragraph.\nPlus one.';
  const segs = diffText(before, after);
  assert.equal(rebuilt(segs, 'del'), before);
  assert.equal(rebuilt(segs, 'add'), after);
});

test('a text over the word-token limit falls back to lines and still rebuilds both sides', () => {
  const lines = [];
  for (let i = 0; i < WORD_TOKEN_LIMIT / 4; i++) lines.push('line ' + i + ' word');
  const before = lines.join('\n');
  const after = lines.map((l, i) => (i === 10 ? 'changed line' : l)).join('\n') + '\nextra';
  const segs = diffText(before, after);
  assert.equal(rebuilt(segs, 'del'), before);
  assert.equal(rebuilt(segs, 'add'), after);
  assert.equal(joined(segs, 'del'), 'line 10 word\nline 9999 word');
  assert.equal(joined(segs, 'add'), 'changed line\nline 9999 word\nextra');
});

test('counts and summary are in words', () => {
  const segs = diffText('one two three', 'one four five six');
  assert.deepEqual(diffCounts(segs), { added: 3, removed: 2 });
  assert.equal(diffSummary({ added: 3, removed: 2 }), '3 words added, 2 removed.');
  assert.equal(diffSummary({ added: 1, removed: 0 }), '1 word added.');
  assert.equal(diffSummary({ added: 0, removed: 1 }), '1 word removed.');
  assert.equal(diffSummary({ added: 0, removed: 0 }), 'No words differ.');
  assert.deepEqual(diffCounts(diffText('a.', 'a!')), { added: 0, removed: 0 });
});
