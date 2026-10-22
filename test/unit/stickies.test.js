'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, sanitizeSticky } = require('../../src/store.mts');

const { tmpDir } = require('../helpers/tmp');
const tmp = () => tmpDir('notes-sticky-');

test('sanitizeSticky clamps sizes, defaults colour and onTop, rejects junk', () => {
  assert.equal(sanitizeSticky(null), null);
  assert.equal(sanitizeSticky('yes'), null);
  assert.deepEqual(sanitizeSticky({}), { x: null, y: null, w: 280, h: 260, color: 'peach', onTop: true });
  assert.deepEqual(sanitizeSticky({ x: 10.6, y: -5, w: 10, h: 99999, color: 'neon', onTop: false }), { x: 11, y: -5, w: 180, h: 1600, color: 'peach', onTop: false });
  assert.equal(sanitizeSticky({ color: 'sky' }).color, 'sky');
});

test('setSticky persists across reload, merges patches, trash clears it, update() cannot set it', () => {
  const dir = tmp();
  let store = new Store(dir).load();
  const a = store.create({ title: 'Todo', body: '- [ ] milk' });
  const b = store.create({ title: 'Other', body: '' });
  assert.equal(a.sticky, null);
  store.setSticky(a.id, { x: 100, y: 50 });
  store.setSticky(a.id, { color: 'leaf' });
  store.setSticky(a.id, { w: 400, h: 300, onTop: false });
  store = new Store(dir).load();
  assert.deepEqual(store.get(a.id).sticky, { x: 100, y: 50, w: 400, h: 300, color: 'leaf', onTop: false });
  assert.deepEqual(store.stickies().map((n) => n.id), [a.id]);
  store.update(b.id, { sticky: { x: 1, y: 1 }, body: 'x' });
  assert.equal(store.get(b.id).sticky, null);
  store.setSticky(a.id, null);
  assert.equal(store.get(a.id).sticky, null);
  store.setSticky(a.id, { x: 1, y: 2 });
  store.trash(a.id);
  assert.equal(store.get(a.id).sticky, null);
  assert.deepEqual(store.stickies(), []);
  store.restore(a.id);
  assert.equal(store.get(a.id).sticky, null);
});
