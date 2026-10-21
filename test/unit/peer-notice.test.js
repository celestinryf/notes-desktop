'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withPeerNotice } = require('../../src/renderer/peer-notice.ts');

const tick = () => new Promise((r) => setImmediate(r));

function fakeApi() {
  const calls = [];
  const fn = (name, result) => (...args) => { calls.push([name, args]); return result; };
  return {
    calls,
    raw: {
      notes: { create: fn('notes.create', Promise.resolve({ id: 'n1' })), get: fn('notes.get', Promise.resolve({ id: 'n1' })), list: fn('notes.list', [1, 2]) },
      files: { convert: fn('files.convert', Promise.resolve({ ok: true })), readOnlyThing: 'not a function' },
      app: { copy: fn('app.copy', Promise.resolve()), importMarkdown: fn('app.importMarkdown', Promise.resolve({ ok: true })) },
      extras: { anything: fn('extras.anything', 7) },
    },
  };
}

test('a write tells the peer once its promise settles, and returns the same result', async () => {
  const { raw } = fakeApi();
  let told = 0;
  const api = withPeerNotice(raw, () => { told++; });
  const r = await api.notes.create({ title: 'x' });
  assert.deepEqual(r, { id: 'n1' });
  await tick();
  assert.equal(told, 1);
});

test('a read never tells the peer and passes arguments through', async () => {
  const { raw, calls } = fakeApi();
  let told = 0;
  const api = withPeerNotice(raw, () => { told++; });
  await api.notes.get('n1');
  assert.equal(api.notes.list('all'), raw.notes.list('all'));
  await tick();
  assert.equal(told, 0);
  assert.deepEqual(calls.filter((c) => c[0] === 'notes.get')[0][1], ['n1']);
});

test('only the listed namespaces are wrapped; others are the same object', () => {
  const { raw } = fakeApi();
  const api = withPeerNotice(raw, () => {});
  assert.equal(api.extras, raw.extras);
  assert.notEqual(api.notes, raw.notes);
  assert.equal(api.notes.get, raw.notes.get);
  assert.notEqual(api.notes.create, raw.notes.create);
});

test('a listed write that is not a function is left alone', () => {
  const { raw } = fakeApi();
  raw.files.link = 'oddly a string';
  const api = withPeerNotice(raw, () => {});
  assert.equal(api.files.link, 'oddly a string');
  assert.equal(api.files.readOnlyThing, 'not a function');
});

test('a rejected write still rejects for the caller and does not tell the peer', async () => {
  const { raw } = fakeApi();
  raw.notes.trash = () => Promise.reject(new Error('disk full'));
  let told = 0;
  const api = withPeerNotice(raw, () => { told++; });
  await assert.rejects(api.notes.trash('n1'), /disk full/);
  await tick();
  assert.equal(told, 0);
});

test('a write that returns a plain value also tells the peer', async () => {
  const { raw } = fakeApi();
  raw.folders = { create: () => ({ id: 'f1' }) };
  let told = 0;
  const api = withPeerNotice(raw, () => { told++; });
  assert.deepEqual(api.folders.create('x'), { id: 'f1' });
  await tick();
  assert.equal(told, 1);
});

test('a missing bridge comes back as is', () => {
  assert.equal(withPeerNotice(null, () => {}), null);
  assert.equal(withPeerNotice(undefined, () => {}), undefined);
});
