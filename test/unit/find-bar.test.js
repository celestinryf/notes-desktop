'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

let findOffsets, isQueryText, queryRegExp;
test.before(async () => { ({ findOffsets, isQueryText, queryRegExp } = await import('../../src/renderer/find-text.ts')); });

test('findOffsets finds every occurrence, case-insensitively, measured on the original text', () => {
  assert.deepEqual(findOffsets('Cat cat CAT', 'cat'), [0, 4, 8]);
  assert.deepEqual(findOffsets('aaa', 'aa'), [0]);
  assert.deepEqual(findOffsets('İstanbul istanbul', 'istanbul'), [9]);
});

test('findOffsets treats regex characters in the query as text', () => {
  assert.deepEqual(findOffsets('1+1=2 and 1+1', '1+1'), [0, 10]);
  assert.deepEqual(findOffsets('a.c abc', 'a.c'), [0]);
  assert.deepEqual(findOffsets('[x] (y)', '[x]'), [0]);
});

test('findOffsets with an empty query or no match', () => {
  assert.deepEqual(findOffsets('anything', ''), []);
  assert.deepEqual(findOffsets('', 'x'), []);
  assert.deepEqual(findOffsets('abc', 'z'), []);
});

test('match case keeps only the exact case', () => {
  assert.deepEqual(findOffsets('Cat cat CAT', 'cat', { matchCase: true }), [4]);
  assert.deepEqual(findOffsets('Cat cat CAT', 'CAT', { matchCase: true }), [8]);
  assert.deepEqual(findOffsets('Cat cat CAT', 'cat', { matchCase: false }), [0, 4, 8]);
});

test('whole word needs a non-word character or an edge on both sides, with letters of any script counting as word characters', () => {
  assert.deepEqual(findOffsets('cat cats concat cat.', 'cat', { wholeWord: true }), [0, 16]);
  assert.deepEqual(findOffsets('café cafés', 'café', { wholeWord: true }), [0]);
  assert.deepEqual(findOffsets('caf café', 'caf', { wholeWord: true }), [0]);
  assert.deepEqual(findOffsets('x_cat cat cat2', 'cat', { wholeWord: true }), [6]);
  assert.deepEqual(findOffsets('(+1) +12', '+1', { wholeWord: true }), [1]);
  assert.deepEqual(findOffsets('a b ab a b', 'a b', { wholeWord: true }), [0, 7]);
  assert.deepEqual(findOffsets('line\ncat\n', 'cat', { wholeWord: true }), [5]);
  assert.deepEqual(findOffsets('Cat cats cat', 'cat', { matchCase: true, wholeWord: true }), [9]);
  assert.deepEqual(findOffsets('日本 日本語', '日本', { wholeWord: true }), [0]);
});

test('queryRegExp is case-insensitive by default, Unicode-aware, and global only when asked', () => {
  assert.equal(queryRegExp('a.b').flags, 'iu');
  assert.equal(queryRegExp('a.b', { matchCase: true }, true).flags, 'gu');
  assert.equal(queryRegExp('a.b').test('A.B'), true);
  assert.equal(queryRegExp('a.b').test('AxB'), false);
});

test('isQueryText says whether a slice really is the query, by the same case rule as findOffsets', () => {
  assert.equal(isQueryText('Cat', 'cat', { matchCase: true }), false);
  assert.equal(isQueryText('cat', 'cat', { matchCase: true, wholeWord: true }), true);
  assert.equal(isQueryText('cat ', 'cat', { wholeWord: true }), false);
  assert.equal(isQueryText('CAT', 'cat'), true);
  assert.equal(isQueryText('cats', 'cat'), false);
  assert.equal(isQueryText('a.c', 'a.c'), true);
  assert.equal(isQueryText('abc', 'a.c'), false);
  assert.equal(isQueryText('', ''), true);
});
