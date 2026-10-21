'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

let findOffsets, isQueryText;
test.before(async () => { ({ findOffsets, isQueryText } = await import('../../src/renderer/find-text.js')); });

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

test('isQueryText says whether a slice really is the query, by the same case rule as findOffsets', () => {
  assert.equal(isQueryText('CAT', 'cat'), true);
  assert.equal(isQueryText('cats', 'cat'), false);
  assert.equal(isQueryText('a.c', 'a.c'), true);
  assert.equal(isQueryText('abc', 'a.c'), false);
  assert.equal(isQueryText('', ''), true);
});
