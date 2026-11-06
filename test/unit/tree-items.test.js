'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

let treeItems, TREE_NOTE_LIMIT;
test.before(async () => { ({ treeItems, TREE_NOTE_LIMIT } = await import('../../src/renderer/tree-items.ts')); });

const note = (id, folderId, pinned = false) => ({ id, title: id, folderId, pinned, locked: false, unlocked: false, sticky: false, fileKind: null, filePath: null, remindAt: null, live: null, createdAt: 1, updatedAt: 1, home: true });
const folder = (id, count) => ({ id, name: id, parentId: null, depth: 0, count, total: count, children: [], vaultId: null, isVaultRoot: false, book: false });
const notes = (n, folderId, from = 1) => Array.from({ length: n }, (_, i) => note('n' + (i + from), folderId));
const input = (over) => Object.assign({ outline: { notes: {}, pinned: [] }, tree: [], scope: null, open: new Set(), showAll: new Set(), here: new Set(), revealing: false, currentId: null, activeKey: null, headings: [] }, over);
const kinds = (items) => items.map((i) => (i.kind === 'more' ? 'more:' + i.hidden : i.kind === 'note' ? 'note' : i.kind));

test('an open folder shows ten notes, then one "more" row counting the rest', () => {
  const { items } = treeItems(input({ tree: [folder('f', 25)], open: new Set(['f']), outline: { notes: { f: notes(25, 'f') }, pinned: [] } }));
  assert.equal(TREE_NOTE_LIMIT, 10);
  assert.deepEqual(kinds(items), ['folder', ...Array(10).fill('note'), 'more:15']);
  const more = items[items.length - 1];
  assert.equal(more.key, 'm:f');
  assert.equal(more.folderId, 'f');
  assert.equal(more.depth, 1, 'the row sits with the notes it stands for');
  assert.equal(more.posInSet, 11);
});

test('ten notes or fewer need no "more" row; a folder marked show-all lists every note', () => {
  assert.deepEqual(kinds(treeItems(input({ tree: [folder('f', 10)], open: new Set(['f']), outline: { notes: { f: notes(10, 'f') }, pinned: [] } })).items), ['folder', ...Array(10).fill('note')]);
  assert.deepEqual(kinds(treeItems(input({ tree: [folder('f', 25)], open: new Set(['f']), showAll: new Set(['f']), outline: { notes: { f: notes(25, 'f') }, pinned: [] } })).items), ['folder', ...Array(25).fill('note')]);
});

test('the open note is never hidden behind the "more" row', () => {
  const { items, active } = treeItems(input({ tree: [folder('f', 25)], open: new Set(['f']), currentId: 'n20', outline: { notes: { f: notes(25, 'f') }, pinned: [] } }));
  assert.deepEqual(kinds(items), ['folder', ...Array(25).fill('note')]);
  assert.equal(items[active].note.id, 'n20');
});

test('pinned notes come first and do not count towards the ten', () => {
  const pinned = notes(3, 'f', 100).map((n) => ({ ...n, pinned: true }));
  const { items } = treeItems(input({ tree: [folder('f', 15)], open: new Set(['f']), outline: { notes: { f: [...pinned, ...notes(12, 'f')] }, pinned } }));
  assert.deepEqual(kinds(items), ['note', 'note', 'note', 'folder', ...Array(13).fill('note'), 'more:2'], 'the pinned notes also sit at the top of All notes');
});

test('the top level of All notes is capped the same way, with its own key', () => {
  const { items } = treeItems(input({ outline: { notes: { '': notes(12, null) }, pinned: [] } }));
  assert.deepEqual(kinds(items), [...Array(10).fill('note'), 'more:2']);
  assert.equal(items[10].key, 'm:');
  assert.equal(items[10].folderId, null);
  assert.deepEqual(kinds(treeItems(input({ showAll: new Set(['']), outline: { notes: { '': notes(12, null) }, pinned: [] } })).items), Array(12).fill('note'));
});

test('a folder viewed on its own is capped too', () => {
  const f = folder('f', 30);
  const { items } = treeItems(input({ tree: [f], scope: f, outline: { notes: { f: notes(30, 'f') }, pinned: [] } }));
  assert.deepEqual(kinds(items), [...Array(10).fill('note'), 'more:20']);
  assert.equal(items[10].depth, 0);
});
