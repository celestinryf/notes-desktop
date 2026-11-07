'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { webAddress, matchingNotes, linkChoices } = require('../../src/renderer/link-choices.ts');

const row = (id, title, extra) => Object.assign({ id, title, body: '', tags: [], updatedAt: 1, trashedAt: null, locked: false }, extra);
const rows = [row('a', 'Garden plan'), row('b', 'Groceries'), row('c', 'Plan for the garden shed'), row('d', 'Old', { trashedAt: 5 }), row('e', 'Secret plan', { locked: true })];

test('webAddress: a scheme or www. is surely an address; a bare domain only maybe; words are not', () => {
  assert.deepEqual(webAddress('https://example.com/a?b=1'), { href: 'https://example.com/a?b=1', certain: true });
  assert.deepEqual(webAddress('  mailto:me@example.com '), { href: 'mailto:me@example.com', certain: true });
  assert.deepEqual(webAddress('note://abc'), { href: 'note://abc', certain: true });
  assert.deepEqual(webAddress('www.example.com'), { href: 'https://www.example.com', certain: true });
  assert.deepEqual(webAddress('example.org/path'), { href: 'https://example.org/path', certain: false });
  assert.deepEqual(webAddress('localhost.dev:8080'), { href: 'https://localhost.dev:8080', certain: false });
  assert.deepEqual(webAddress('README.md'), { href: 'https://README.md', certain: false });
  for (const text of ['', '   ', 'garden plan', 'plan', 'a.b', '1.5', 'https://has space.com']) assert.equal(webAddress(text), null, JSON.stringify(text));
});

test('matchingNotes: skips the open note and the trash, keeps the given order without a query, and ranks a title that starts with the query first', () => {
  assert.deepEqual(matchingNotes(rows, '', 'b', 10).map((n) => n.id), ['a', 'c', 'e']);
  assert.deepEqual(matchingNotes(rows, '', null, 2).map((n) => n.id), ['a', 'b']);
  assert.deepEqual(matchingNotes(rows, 'plan', null, 10).map((n) => n.id), ['c', 'a', 'e']);
  assert.deepEqual(matchingNotes(rows, '  gar ', null, 10).map((n) => n.id)[0], 'a');
  assert.deepEqual(matchingNotes(rows, 'zzz', null, 10), []);
  assert.deepEqual(matchingNotes(rows, 'old', null, 10), [], 'a note in the trash is never offered');
});

test('linkChoices: notes link as note://, a locked one shows the lock, and the time is on the right', () => {
  const choices = linkChoices('plan', rows, null, 6);
  assert.deepEqual(choices.map((c) => c.href), ['note://c', 'note://a', 'note://e']);
  assert.equal(choices[2].icon, 'lock');
  assert.equal(choices[0].icon, 'notebook-text');
  assert.equal(choices[0].noteId, 'c');
  assert.ok(choices[0].keys.length > 0);
});

test('linkChoices: a sure address comes first; a bare domain comes after the notes; the address counts toward the limit', () => {
  const sure = linkChoices('https://garden.example', rows, null, 6);
  assert.deepEqual(sure.map((c) => [c.href, c.noteId]), [['https://garden.example', null]]);
  assert.equal(sure[0].keys, 'Web address');
  const many = Array.from({ length: 10 }, (_, i) => row('n' + i, 'readme.md notes ' + i));
  const maybe = linkChoices('readme.md', many, null, 6);
  assert.equal(maybe.length, 6);
  assert.deepEqual(maybe.slice(0, 5).map((c) => c.noteId), ['n0', 'n1', 'n2', 'n3', 'n4']);
  assert.equal(maybe[5].href, 'https://readme.md');
});

test('linkChoices: an empty field offers the most recent notes; nothing matching offers nothing', () => {
  assert.deepEqual(linkChoices('', rows, 'a', 6).map((c) => c.noteId), ['b', 'c', 'e']);
  assert.deepEqual(linkChoices('qqqq', rows, null, 6), []);
});
