'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, highlight, ipcErrorText } = require('../../src/renderer/text.ts');

test('escapeHtml escapes the five characters and nothing else', () => {
  assert.equal(escapeHtml('<a href="x">Tom & Jerry\'s</a>'), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
  assert.equal(escapeHtml('plain text, no change'), 'plain text, no change');
  assert.equal(escapeHtml(''), '');
});

test('escapeHtml takes non-strings', () => {
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml(null), 'null');
  assert.equal(escapeHtml(undefined), 'undefined');
});

test('highlight wraps each query token in a mark, case-insensitively', () => {
  assert.equal(highlight('Buy milk and Milk', 'milk'), 'Buy <span class="mark">milk</span> and <span class="mark">Milk</span>');
  assert.equal(highlight('one two three', 'three one'), '<span class="mark">one</span> two <span class="mark">three</span>');
});

test('highlight with no query only escapes', () => {
  assert.equal(highlight('<b>', ''), '&lt;b&gt;');
  assert.equal(highlight('<b>', '   '), '&lt;b&gt;');
});

test('highlight escapes the text outside and inside marks', () => {
  assert.equal(highlight('a <tag> b', 'tag'), 'a &lt;<span class="mark">tag</span>&gt; b');
  assert.equal(highlight('x & <y>', '<y>'), 'x &amp; <span class="mark">&lt;y&gt;</span>');
});

test('highlight never splits an entity in the source text', () => {
  const out = highlight('fish &amp; chips', 'amp');
  assert.equal(out, 'fish &amp;<span class="mark">amp</span>; chips');
});

test('highlight treats regex characters in the query as text', () => {
  assert.equal(highlight('price (1.50) [x]', '(1.50)'), 'price <span class="mark">(1.50)</span> [x]');
  assert.equal(highlight('a.c abc', 'a.c'), '<span class="mark">a.c</span> abc');
});

test('highlight takes a non-string text', () => {
  assert.equal(highlight(12345, '23'), '1<span class="mark">23</span>45');
});

test('ipcErrorText strips Electron\'s remote-method prefix, with or without the Error: part', () => {
  assert.equal(ipcErrorText(new Error("Error invoking remote method 'notes:update': Error: disk full")), 'disk full');
  assert.equal(ipcErrorText(new Error("Error invoking remote method 'notes:update': disk full")), 'disk full');
});

test('ipcErrorText leaves other messages alone and takes non-errors', () => {
  assert.equal(ipcErrorText(new Error('plain')), 'plain');
  assert.equal(ipcErrorText('a string'), 'a string');
  assert.equal(ipcErrorText({ message: 'from an object' }), 'from an object');
  assert.equal(ipcErrorText(null), 'null');
  assert.equal(ipcErrorText(undefined), 'undefined');
});

test('ipcErrorText only strips the prefix at the start', () => {
  const inner = "note said: Error invoking remote method 'x': y";
  assert.equal(ipcErrorText(new Error(inner)), inner);
});
