'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Store } = require('../../src/store.mts');
const { tmpDir } = require('../helpers/tmp');

function homeStore() {
  let t = 1_000_000;
  const store = new Store(tmpDir('notes-home-data-'), { now: () => (t += 1000) }).load();
  const dir = tmpDir('notes-home-');
  const home = store.addHomeVault(dir);
  const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
  const has = (...p) => fs.existsSync(path.join(dir, ...p));
  return { store, dir, home, read, has };
}

test('a note with no folder becomes a Markdown file at the top of the notes folder, named by its first line', () => {
  const { store, read, has, home } = homeStore();
  const n = store.create({ body: '# Shopping\n- eggs\n', tags: 'food' });
  assert.equal(n.vaultId, home.id);
  assert.equal(n.folderId, null);
  assert.equal(n.title, '');
  assert.equal(path.basename(n.filePath), 'Shopping.md');
  assert.equal(read('Shopping.md'), '---\ntags:\n  - food\n---\n# Shopping\n- eggs\n');
  assert.deepEqual(n.tags, ['food']);
  assert.equal(store.publicNote(n).home, true);
  assert.equal(store.rows()[0].home, true);
  store.update(n.id, { body: n.body.replace('# Shopping', '# Groceries') });
  assert.ok(has('Groceries.md') && !has('Shopping.md'), 'the file follows the first line');
  assert.equal(store.get(n.id).title, '');
});

test('an explicit title names the file, and a numbered name does not keep moving', () => {
  const { store, has } = homeStore();
  const a = store.create({ title: 'Plan', body: 'one' });
  const b = store.create({ title: 'Plan', body: 'two' });
  assert.equal(a.title, 'Plan');
  assert.equal(b.title, 'Plan 2');
  store.update(b.id, { body: 'two, edited', title: 'Plan 2' });
  store.update(b.id, { body: 'two, edited again' });
  assert.equal(path.basename(store.get(b.id).filePath), 'Plan 2.md');
  store.update(a.id, { title: 'Trip' });
  assert.ok(has('Trip.md') && !has('Plan.md'));
  assert.equal(store.get(a.id).title, 'Trip');
  const c = store.create({ body: '' });
  const d = store.create({ body: '' });
  store.update(d.id, { body: '' });
  assert.equal(path.basename(store.get(c.id).filePath), 'Untitled.md');
  assert.equal(path.basename(store.get(d.id).filePath), 'Untitled 2.md');
});

test('top-level folders are directories in the notes folder and look like plain folders', () => {
  const { store, dir, has } = homeStore();
  const work = store.createFolder({ name: 'Work: 2026' });
  assert.equal(work.parentId, null);
  assert.equal(work.dirPath, path.join(dir, 'Work 2026'));
  const sub = store.createFolder({ name: 'Ideas', parentId: work.id });
  const n = store.create({ title: 'Inside', body: 'x', folderId: sub.id });
  assert.ok(has('Work 2026', 'Ideas', 'Inside.md'));
  const node = store.folderTree().find((f) => f.id === work.id);
  assert.equal(node.vaultId, null);
  assert.equal(node.isVaultRoot, false);
  store.renameFolder(work.id, 'Job');
  assert.ok(has('Job', 'Ideas', 'Inside.md'));
  assert.equal(store.get(n.id).filePath, path.join(dir, 'Job', 'Ideas', 'Inside.md'));
  assert.deepEqual(store.moveFolder(sub.id, null), { folder: sub });
  assert.ok(has('Ideas', 'Inside.md'));
  assert.equal(sub.parentId, null);
  store.deleteFolder(sub.id);
  assert.ok(has('Inside.md'));
  assert.equal(store.get(n.id).folderId, null);
  assert.equal(store.removeVault(store.homeVault().id), false);
});

test('a note moves between the top and folders, and from the notes folder into another vault', async () => {
  const { store, has } = homeStore();
  const f = store.createFolder({ name: 'F' });
  const n = store.create({ title: 'Move me', body: 'b' });
  store.update(n.id, { folderId: f.id });
  assert.ok(has('F', 'Move me.md'));
  store.update(n.id, { folderId: null });
  assert.ok(has('Move me.md'));
  assert.equal(store.get(n.id).folderId, null);
  const other = tmpDir('notes-home-other-');
  const v = store.addVault({ path: other });
  await store.scanVault(v.id);
  store.update(n.id, { folderId: store.vaultRootFolder(v.id).id });
  assert.ok(fs.existsSync(path.join(other, 'Move me.md')) && !has('Move me.md'));
  assert.equal(store.get(n.id).vaultId, v.id);
  assert.throws(() => store.update(n.id, { folderId: null }), /only move within its vault/);
});

test('locking writes an encrypted .mdlock file and removes the plain one; unlocking writes it back', () => {
  const { store, dir, read, has } = homeStore();
  const n = store.create({ body: 'secret first line\nmore', tags: 'private' });
  store.lockNote(n.id, 'pw');
  const locked = store.get(n.id);
  assert.equal(path.basename(locked.filePath), 'Locked note.mdlock', 'a derived title does not leak into the name');
  assert.ok(!has('secret first line.md'));
  const sealed = read('Locked note.mdlock');
  assert.ok(!sealed.includes('secret'), 'no plaintext in the file');
  assert.deepEqual(JSON.parse(sealed).tags, ['private']);
  store.relock(n.id);
  assert.throws(() => store.update(n.id, { body: 'secret changed' }), /locked/);
  assert.equal(read('Locked note.mdlock'), sealed, 'a locked note without its key cannot be written');
  store.unlockNote(n.id, 'pw');
  store.update(n.id, { body: 'secret changed while unlocked' });
  const resealed = read('Locked note.mdlock');
  assert.notEqual(resealed, sealed);
  assert.ok(!resealed.includes('secret'));
  store.update(n.id, { tags: 'private, two' });
  assert.deepEqual(JSON.parse(read('Locked note.mdlock')).tags, ['private', 'two']);
  store.removeLock(n.id, 'pw');
  const open = store.get(n.id);
  assert.equal(path.basename(open.filePath), 'secret changed while unlocked.md');
  assert.ok(!fs.existsSync(path.join(dir, 'Locked note.mdlock')));
  assert.equal(read('secret changed while unlocked.md'), '---\ntags:\n  - private\n  - two\n---\nsecret changed while unlocked');
  const titled = store.create({ title: 'Diary', body: 'x' });
  store.lockNote(titled.id, 'pw');
  assert.ok(has('Diary.mdlock'));
});

test('a scan of the notes folder maps its top to no folder, reads .mdlock files, and keeps derived titles empty', async () => {
  const { store, dir, home } = homeStore();
  const n = store.create({ body: '# Hello\nworld' });
  fs.mkdirSync(path.join(dir, 'Sub'));
  fs.writeFileSync(path.join(dir, 'Sub', 'Outside.md'), 'Written elsewhere\n');
  fs.writeFileSync(path.join(dir, 'Named.md'), 'A different first line\n');
  const locked = store.create({ body: 'to lock' });
  store.lockNote(locked.id, 'pw');
  fs.copyFileSync(store.get(locked.id).filePath, path.join(dir, 'Copied.mdlock'));
  await store.scanVault(home.id);
  const sub = store.folders.find((f) => f.name === 'Sub');
  assert.equal(sub.parentId, null);
  assert.equal(sub.vaultId, home.id);
  const outside = store.notes.find((x) => x.filePath === path.join(dir, 'Sub', 'Outside.md'));
  assert.equal(outside.folderId, sub.id);
  assert.equal(outside.title, 'Outside');
  assert.equal(store.notes.find((x) => x.filePath === path.join(dir, 'Named.md')).title, 'Named');
  assert.equal(store.get(n.id).folderId, null);
  const copied = store.notes.find((x) => x.filePath === path.join(dir, 'Copied.mdlock'));
  assert.ok(copied.lock && copied.body === '');
  assert.equal(store.notes.length, 5);
});

test('trash and restore keep a note at the top of the notes folder', () => {
  const { store, has } = homeStore();
  const n = store.create({ title: 'Bin me', body: 'x' });
  store.trash(n.id);
  assert.ok(has('.trash', 'Bin me.md') && !has('Bin me.md'));
  store.restore(n.id);
  assert.ok(has('Bin me.md'));
  assert.equal(store.get(n.id).folderId, null);
});

test('a note in the notes folder splits into a book of page files, and the split can be undone', () => {
  const { store, has, read } = homeStore();
  const n = store.create({ title: 'Guide', body: '---\ntags: [doc]\n---\n# Guide\n## One\nfirst\n## Two\nsecond\n' });
  const r = store.splitIntoBook(n.id, {});
  assert.equal(r.originalTrashed, true);
  assert.ok(has('Guide', 'One.md') && has('Guide', 'Two.md'));
  assert.match(read('Guide', 'One.md'), /^---\ntags:\n  - doc\n---\n/);
  assert.ok(has('.trash', 'Guide.md') && !has('Guide.md'));
  assert.equal(r.folder.parentId, null);
  store.undoSplit(r.folder.id, r.pageIds, n.id);
  assert.ok(!has('Guide'), 'the book folder is gone');
  assert.ok(has('Guide.md'));
  assert.equal(store.get(n.id).trashedAt, null);
});

test('duplicating a note gives a titled copy, and a linked file can sit in a folder of the notes folder', () => {
  const { store, has } = homeStore();
  const n = store.create({ body: 'Recipe\nflour' });
  const copy = store.duplicate(n.id);
  assert.equal(copy.title, 'Recipe (copy)');
  assert.ok(has('Recipe (copy).md'));
  const f = store.createFolder({ name: 'Linked' });
  const outside = path.join(tmpDir('notes-home-linked-'), 'agent.md');
  fs.writeFileSync(outside, 'agent');
  const linked = store.create({ title: 'agent.md', body: 'agent', filePath: outside, fileKind: 'text' });
  store.update(linked.id, { folderId: f.id });
  assert.equal(store.get(linked.id).folderId, f.id);
  assert.equal(store.get(linked.id).filePath, outside, 'the linked file stays where it is');
});

test('review fixes: an outside edit blocks undoing a split; an explicit retitle to a shorter name works; names read back as before', async () => {
  const { store, dir, has, home } = homeStore();
  const n = store.create({ title: 'Book', body: '# Book\n## One\nfirst\n## Two\nsecond\n' });
  const r = store.splitIntoBook(n.id, {});
  const page = store.get(r.pageIds[0]);
  fs.writeFileSync(page.filePath, 'edited elsewhere\n');
  fs.utimesSync(page.filePath, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  assert.throws(() => store.undoSplit(r.folder.id, r.pageIds, n.id), /edited outside Notes/);
  assert.ok(fs.existsSync(page.filePath), 'the edited page stays');

  const report = store.create({ title: 'Report 2024', body: 'x' });
  store.update(report.id, { title: 'Report' });
  assert.ok(has('Report.md') && !has('Report 2024.md'));

  store.create({ body: 'Same first line' });
  const second = store.create({ body: 'Same first line' });
  const sealed = store.create({ body: 'hidden' });
  store.lockNote(sealed.id, 'pw');
  const again = new Store(store.dir).load();
  await again.scanVault(home.id);
  assert.equal(again.get(second.id).title, '');
  assert.equal(again.get(sealed.id).title, '');
  assert.equal(path.basename(again.get(second.id).filePath), 'Same first line 2.md');
  assert.equal(again.addVault({ path: tmpDir('notes-home-plain-'), home: true }).home, false, 'the page cannot make a second home vault');
  assert.equal(again.homeVault().id, home.id);
});

test('review fixes: an .mdlock file in an ordinary vault is not a note', async () => {
  const { store } = homeStore();
  const other = tmpDir('notes-home-plainvault-');
  fs.writeFileSync(path.join(other, 'Stray.mdlock'), JSON.stringify({ notesLock: 1, tags: [], lock: { v: 1, kdf: 'scrypt', N: 16384, salt: 'AA==', iv: 'AA==', tag: 'AA==', ct: 'AA==' } }));
  fs.writeFileSync(path.join(other, 'Real.md'), 'real');
  const v = store.addVault({ path: other });
  await store.scanVault(v.id);
  assert.deepEqual(store.notes.filter((n) => n.vaultId === v.id).map((n) => path.basename(n.filePath)), ['Real.md']);
});

test('re-sending a title that collides keeps the numbered name instead of moving the file each save', () => {
  const { store, has } = homeStore();
  store.create({ title: 'Plan', body: 'a' });
  const b = store.create({ title: 'Plan', body: 'b' });
  for (const body of ['b1', 'b2', 'b3']) store.update(b.id, { title: 'Plan', body });
  assert.equal(path.basename(store.get(b.id).filePath), 'Plan 2.md');
  assert.ok(!has('Plan 3.md'));
});
