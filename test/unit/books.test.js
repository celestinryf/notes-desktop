'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../../src/store');
const H = require('../../src/shared/helpers.ts');

const { tmpDir } = require('../helpers/tmp');
const tmp = () => tmpDir('notes-books-'); // removed when the test process exits

test('books: setBook fixes the current order, reorderPages persists, new pages go last, list follows reading order', () => {
  const dir = tmp();
  let now = 1000;
  let store = new Store(dir, { now: () => now }).load();
  const f = store.createFolder({ name: 'Novel' });
  const a = store.create({ title: 'A', body: '', folderId: f.id }); now += 10;
  const b = store.create({ title: 'B', body: '', folderId: f.id }); now += 10;
  const c = store.create({ title: 'C', body: '', folderId: f.id }); now += 10;
  // Not a book: the usual sort (most recently updated first).
  assert.deepEqual(store.list({ folderId: f.id, sort: 'updated' }).map((n) => n.title), ['C', 'B', 'A']);
  store.setBook(f.id, true);
  assert.deepEqual(store.getFolder(f.id).pageOrder, [a.id, b.id, c.id], 'order fixed when it became a book');
  assert.deepEqual(store.list({ folderId: f.id, sort: 'updated' }).map((n) => n.title), ['A', 'B', 'C'], 'reading order, whatever the sort');
  // Editing a page does not move it.
  store.update(a.id, { body: 'edited' });
  assert.deepEqual(store.bookPages(f.id).map((n) => n.title), ['A', 'B', 'C']);
  // Reorder, with an unknown id and a duplicate ignored and a missing page kept after.
  store.reorderPages(f.id, [c.id, 'nope', c.id, a.id]);
  assert.deepEqual(store.bookPages(f.id).map((n) => n.title), ['C', 'A', 'B']);
  // A new page goes last.
  now += 10;
  const d = store.create({ title: 'D', body: '', folderId: f.id });
  assert.deepEqual(store.bookPages(f.id).map((n) => n.title), ['C', 'A', 'B', 'D']);
  // Survives a reload; trashed pages drop out; search is not reordered.
  store = new Store(dir, { now: () => now }).load();
  assert.equal(store.getFolder(f.id).book, true);
  store.trash(b.id);
  assert.deepEqual(store.list({ folderId: f.id }).map((n) => n.title), ['C', 'A', 'D']);
  assert.equal(store.folderTree().find((x) => x.id === f.id).book, true);
  // Turning it back into a folder keeps the stored order for next time but lists normally.
  store.setBook(f.id, false);
  assert.equal(store.reorderPages(f.id, [a.id]), null, 'no reordering outside a book');
  assert.deepEqual(store.list({ folderId: f.id, sort: 'title' }).map((n) => n.title), ['A', 'C', 'D']);
  void d;
});

test('related: links out, backlinks, deleted targets, shared tags, and locked bodies only while unlocked', () => {
  const store = new Store(tmp()).load();
  const a = store.create({ title: 'A', body: '', tags: ['x', 'y'] });
  const b = store.create({ title: 'B', body: 'back to [a](note://' + a.id + ')' });
  const c = store.create({ title: 'C', body: '', tags: ['x', 'y'] });
  const d = store.create({ title: 'D', body: '', tags: ['y'] });
  store.update(a.id, { body: 'to [b](note://' + b.id + ') and [gone](note://deadbeef-0000) and [b again](note://' + b.id + ')' });
  const r = store.related(a.id);
  assert.deepEqual(r.outgoing.map((x) => x.title), ['B', 'Deleted note']);
  assert.equal(r.outgoing[1].missing, true);
  assert.deepEqual(r.incoming.map((x) => x.title), ['B']);
  assert.deepEqual(r.byTags.map((x) => x.title), ['C', 'D'], 'more shared tags first');
  assert.deepEqual(r.byTags[0].sharedTags, ['x', 'y']);
  // A locked note's links are invisible once relocked, visible while unlocked.
  const e = store.create({ title: 'E', body: 'secret [a](note://' + a.id + ')' });
  store.lockNote(e.id, 'pw');
  assert.ok(store.related(a.id).incoming.some((x) => x.title === 'E'), 'unlocked: counted');
  store.relock(e.id);
  assert.ok(!store.related(a.id).incoming.some((x) => x.title === 'E'), 'locked: body not read');
  // Trashed notes are not backlinks.
  store.trash(b.id);
  assert.deepEqual(store.related(a.id).incoming, []);
  assert.equal(store.related('missing'), null);
  void c; void d;
});

test('noteLinkIds finds note:// ids once each, case-insensitively', () => {
  assert.deepEqual(H.noteLinkIds('[x](note://ABCDEF12-1) [y](note://abcdef12-1) note://12345678'), ['abcdef12-1', '12345678']);
  assert.deepEqual(H.noteLinkIds('no links https://x.y'), []);
  assert.deepEqual(H.noteLinkIds(null), []);
});
