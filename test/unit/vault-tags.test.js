'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Store } = require('../../src/store.mts');
const { tmpDir } = require('../helpers/tmp');

async function vaultStore(files) {
  const dataDir = tmpDir('notes-vtags-data-');
  const dir = tmpDir('notes-vtags-vault-');
  for (const [name, text] of Object.entries(files || {})) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  const store = new Store(dataDir).load();
  const v = store.addVault({ path: dir });
  await store.scanVault(v.id);
  const byName = (name) => store.notes.find((n) => n.filePath && path.basename(n.filePath) === name);
  return { store, v, dir, byName, root: store.vaultRootFolder(v.id) };
}

test('a vault scan takes Markdown tags from front matter and inline tags; other text files have none', async () => {
  const { byName } = await vaultStore({
    'a.md': '---\ntags: [Work, plans]\n---\nBody #idea\n',
    'b.txt': '---\ntags: [x]\n---\n',
    'sub/c.md': 'Just #one tag\n',
  });
  assert.deepEqual(byName('a.md').tags, ['work', 'plans', 'idea']);
  assert.deepEqual(byName('b.txt').tags, []);
  assert.deepEqual(byName('c.md').tags, ['one']);
});

test('editing tags of a vault note writes them into its front matter, and the file is the truth on reload', async () => {
  const { store, byName, dir } = await vaultStore({ 'a.md': 'Body\n' });
  const note = byName('a.md');
  store.update(note.id, { tags: 'red, blue' });
  const file = path.join(dir, 'a.md');
  assert.equal(fs.readFileSync(file, 'utf8'), '---\ntags:\n  - red\n  - blue\n---\nBody\n');
  assert.deepEqual(store.get(note.id).tags, ['red', 'blue']);
  store.update(note.id, { tags: 'blue' });
  assert.equal(fs.readFileSync(file, 'utf8'), '---\ntags:\n  - blue\n---\nBody\n');
  store.update(note.id, { tags: '' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'Body\n');
  assert.deepEqual(store.get(note.id).tags, []);
});

test('a body edit derives tags from the text, and an unchanged tags field does not touch the file', async () => {
  const { store, byName, dir } = await vaultStore({ 'a.md': '---\ntags: [keep]\n---\nBody\n' });
  const note = byName('a.md');
  const file = path.join(dir, 'a.md');
  store.update(note.id, { body: '---\ntags: [keep, added]\n---\nBody #inline\n', tags: 'keep' });
  assert.equal(fs.readFileSync(file, 'utf8'), '---\ntags: [keep, added]\n---\nBody #inline\n');
  assert.deepEqual(store.get(note.id).tags, ['keep', 'added', 'inline']);
  const mtime = fs.statSync(file).mtimeMs;
  store.update(note.id, { tags: 'keep, added, inline' });
  assert.equal(fs.statSync(file).mtimeMs, mtime);
});

test('a body edit and a tag change in one patch both land in the file', async () => {
  const { store, byName, dir } = await vaultStore({ 'a.md': 'Old\n' });
  const note = byName('a.md');
  store.update(note.id, { body: 'New\n', tags: 'one' });
  assert.equal(fs.readFileSync(path.join(dir, 'a.md'), 'utf8'), '---\ntags:\n  - one\n---\nNew\n');
});

test('tags of a non-Markdown vault note stay in the app', async () => {
  const { store, byName, dir } = await vaultStore({ 'a.txt': 'plain\n' });
  const note = byName('a.txt');
  store.update(note.id, { tags: 'x' });
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'plain\n');
  assert.deepEqual(store.get(note.id).tags, ['x']);
});

test('a new vault note and an app note moved into a vault carry their tags in the file', async () => {
  const { store, root, dir } = await vaultStore({});
  const created = store.createVaultNote(root.id, { title: 'New', body: 'Hi\n', tags: ['t1'] });
  assert.equal(fs.readFileSync(path.join(dir, 'New.md'), 'utf8'), '---\ntags:\n  - t1\n---\nHi\n');
  assert.deepEqual(created.tags, ['t1']);
  const app = store.create({ title: 'Moved', body: 'Text #inline\n', tags: 'inline, out' });
  const moved = store.update(app.id, { folderId: root.id });
  assert.equal(fs.readFileSync(moved.filePath, 'utf8'), '---\ntags:\n  - out\n---\nText #inline\n');
  assert.deepEqual(moved.tags, ['out', 'inline']);
});

test('a rescan after an outside edit picks up the new tags', async () => {
  const { store, v, byName, dir } = await vaultStore({ 'a.md': 'Body\n' });
  const file = path.join(dir, 'a.md');
  fs.writeFileSync(file, '---\ntags: [outside]\n---\nBody\n');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  await store.scanVault(v.id, { paths: ['a.md'] });
  assert.deepEqual(byName('a.md').tags, ['outside']);
});

test('loading a version 1 library writes app-side tags of vault notes into their files once', async () => {
  const { store, byName, dir } = await vaultStore({ 'a.md': '---\ntags: [file]\n---\nBody\n', 'b.txt': 'plain\n' });
  const note = byName('a.md');
  const txt = byName('b.txt');
  note.tags = ['file', 'app'];
  txt.tags = ['kept'];
  store.save();
  const doc = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  doc.schemaVersion = 1;
  fs.writeFileSync(store.file, JSON.stringify(doc));
  fs.rmSync(store.journalFile, { force: true });
  const again = new Store(store.dir).load();
  assert.equal(fs.readFileSync(path.join(dir, 'a.md'), 'utf8'), '---\ntags: [file, app]\n---\nBody\n');
  assert.deepEqual(again.get(note.id).tags, ['file', 'app']);
  assert.deepEqual(again.get(txt.id).tags, ['kept']);
  assert.equal(JSON.parse(fs.readFileSync(again.file, 'utf8')).schemaVersion, 2);
});
