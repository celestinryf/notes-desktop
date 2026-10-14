'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../src/shared/helpers');

test('deriveTitle prefers explicit title, then first body line, then Untitled', () => {
  assert.equal(H.deriveTitle({ title: '  Groceries ', body: 'milk' }), 'Groceries');
  assert.equal(H.deriveTitle({ title: '', body: '\n\n# Heading line\nmore' }), 'Heading line');
  assert.equal(H.deriveTitle({ title: '', body: '   ' }), 'Untitled');
  assert.equal(H.deriveTitle(null), 'Untitled');
});

test('deriveTitle truncates long first lines with an ellipsis', () => {
  const t = H.deriveTitle({ body: 'x'.repeat(100) });
  assert.equal(t.length, 60);
  assert.ok(t.endsWith('…'));
});

test('snippet skips the first line only when it became the title', () => {
  assert.equal(H.snippet({ title: '', body: 'First\nSecond line' }), 'Second line');
  assert.equal(H.snippet({ title: 'T', body: 'First\nSecond line' }), 'First Second line');
  assert.equal(H.snippet({ title: '', body: '- [ ] task **bold**' }), '');
  assert.equal(H.snippet({ title: 'T', body: 'a'.repeat(200) }, 20).length, 20);
});

test('relativeTime buckets', () => {
  const now = Date.UTC(2026, 9, 13, 12, 0, 0);
  assert.equal(H.relativeTime(now - 10e3, now), 'just now');
  assert.equal(H.relativeTime(now - 5 * 60e3, now), '5 min ago');
  assert.equal(H.relativeTime(now - 60 * 60e3, now), '1 hour ago');
  assert.equal(H.relativeTime(now - 3 * 3600e3, now), '3 hours ago');
  assert.equal(H.relativeTime(now - 2 * 86400e3, now), '2 days ago');
  assert.match(H.relativeTime(now - 30 * 86400e3, now), /Sep/);
  assert.match(H.relativeTime(Date.UTC(2024, 0, 5), now), /2024/);
});

test('parseTags normalizes, dedupes, strips #, accepts arrays and strings', () => {
  assert.deepEqual(H.parseTags('Work, #work  ideas,,  Ideas'), ['work', 'ideas']);
  assert.deepEqual(H.parseTags(['A', 'b']), ['a', 'b']);
  assert.deepEqual(H.parseTags(''), []);
  assert.deepEqual(H.parseTags(null), []);
});

test('toggleTaskAt flips the nth task line and leaves others untouched', () => {
  const body = 'intro\n- [ ] one\n- [x] two\n  * [ ] nested\n1. [ ] numbered';
  assert.equal(H.toggleTaskAt(body, 0).split('\n')[1], '- [x] one');
  assert.equal(H.toggleTaskAt(body, 1).split('\n')[2], '- [ ] two');
  assert.equal(H.toggleTaskAt(body, 2).split('\n')[3], '  * [x] nested');
  assert.equal(H.toggleTaskAt(body, 3).split('\n')[4], '1. [x] numbered');
  assert.equal(H.toggleTaskAt(body, 9), body);
  assert.equal(H.toggleTaskAt('', 0), '');
});

test('countWords', () => {
  assert.equal(H.countWords(''), 0);
  assert.equal(H.countWords('   '), 0);
  assert.equal(H.countWords('one two\nthree'), 3);
});

test('matchesQuery requires every token across title, body, and tags', () => {
  const n = { title: 'Meeting notes', body: 'Discuss roadmap', tags: ['work'] };
  assert.equal(H.matchesQuery(n, ''), true);
  assert.equal(H.matchesQuery(n, 'ROADMAP meeting'), true);
  assert.equal(H.matchesQuery(n, 'work'), true);
  assert.equal(H.matchesQuery(n, 'meeting budget'), false);
});

test('sortNotes puts pinned first then applies the chosen order', () => {
  const notes = [
    { id: 'a', title: 'Banana', pinned: false, createdAt: 1, updatedAt: 5 },
    { id: 'b', title: 'apple', pinned: false, createdAt: 3, updatedAt: 2 },
    { id: 'c', title: 'Cherry', pinned: true, createdAt: 2, updatedAt: 1 },
  ];
  assert.deepEqual(H.sortNotes(notes, 'updated').map((n) => n.id), ['c', 'a', 'b']);
  assert.deepEqual(H.sortNotes(notes, 'created').map((n) => n.id), ['c', 'b', 'a']);
  assert.deepEqual(H.sortNotes(notes, 'title').map((n) => n.id), ['c', 'b', 'a']);
  assert.deepEqual(H.sortNotes(notes, 'bogus').map((n) => n.id), ['c', 'a', 'b']);
  assert.equal(notes[0].id, 'a', 'does not mutate input');
});

test('parseAccelerator validates and normalizes', () => {
  assert.deepEqual(H.parseAccelerator('ctrl+alt+n'), { ok: true, value: 'Control+Alt+N' });
  assert.deepEqual(H.parseAccelerator('CommandOrControl+Shift+F9'), { ok: true, value: 'CommandOrControl+Shift+F9' });
  assert.deepEqual(H.parseAccelerator('Control+Alt+Space'), { ok: true, value: 'Control+Alt+Space' });
  assert.equal(H.parseAccelerator('N').ok, false);
  assert.equal(H.parseAccelerator('Bogus+N').ok, false);
  assert.equal(H.parseAccelerator('Control+NotAKey').ok, false);
  assert.equal(H.parseAccelerator('').ok, false);
});

test('displayAccelerator reads naturally', () => {
  assert.equal(H.displayAccelerator('CommandOrControl+Alt+N'), 'Ctrl + Alt + N');
  assert.equal(H.displayAccelerator('Control+Shift+F9'), 'Ctrl + Shift + F9');
});

test('markdown export and import round-trip', () => {
  const note = { title: 'Plan', body: 'Step one\n\n- [ ] do it  \n', tags: ['work', 'q4'] };
  const md = H.noteToMarkdown(note);
  assert.equal(md, '# Plan\n\nStep one\n\n- [ ] do it\n\nTags: #work #q4\n');
  const back = H.markdownToNote('plan.md', md);
  assert.deepEqual(back, { title: 'Plan', body: 'Step one\n\n- [ ] do it', tags: ['work', 'q4'] });
});

test('markdownToNote falls back to the filename when there is no heading', () => {
  assert.deepEqual(H.markdownToNote('Shopping list.txt', 'eggs\r\nmilk\r\n'), { title: 'Shopping list', body: 'eggs\nmilk', tags: [] });
});

test('clampPane keeps pane widths inside their limits', () => {
  assert.equal(H.clampPane('sidebarWidth', 100), 160);
  assert.equal(H.clampPane('sidebarWidth', 1000), 420);
  assert.equal(H.clampPane('listWidth', NaN), 300);
  assert.equal(H.clampPane('listWidth', '250'), 250);
  assert.equal(H.clampPane('unknown', 7), 7);
  assert.ok(H.EDITOR_MIN >= 300);
});

test('safeFilename strips characters Windows rejects', () => {
  assert.equal(H.safeFilename('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
  assert.equal(H.safeFilename('   '), 'Untitled');
  assert.equal(H.safeFilename('con'), 'note-con');
  assert.equal(H.safeFilename('NUL.txt'), 'note-NUL.txt');
  assert.equal(H.safeFilename('COM1'), 'note-COM1');
  assert.equal(H.safeFilename('console'), 'console');
  assert.equal(H.safeFilename('ends with dot.'), 'ends with dot');
  assert.ok(!/[. ]$/.test(H.safeFilename('x'.repeat(79) + '. tail')), 'no trailing dot after truncation');
  assert.equal(H.safeFilename('x'.repeat(100)).length, 80);
});
