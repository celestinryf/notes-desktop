'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Store, readLibrary } = require('../../src/store.mts');
const { tmpDir } = require('../helpers/tmp');

function makeStore() {
  let t = 1_000_000;
  const store = new Store(tmpDir('notes-outside-'), { now: () => t }).load();
  return { store, tick: (ms) => { t += ms; } };
}

function homeStore() {
  let t = 1_000_000;
  const store = new Store(tmpDir('notes-outside-data-'), { now: () => (t += 1000) }).load();
  const home = store.addHomeVault(tmpDir('notes-outside-home-'));
  return { store, home };
}

function twoNotes() {
  const { store, tick } = makeStore();
  const a = store.create({ title: 'A', body: 'a' });
  const b = store.create({ title: 'B', body: 'b' });
  store.save();
  return { store, tick, a, b };
}

const readDoc = (store) => JSON.parse(fs.readFileSync(store.file, 'utf8'));
const rowOf = (doc, id) => doc.notes.find((n) => n.id === id);
const reload = (store) => new Store(store.dir).load();
const keptAside = (store) => fs.readdirSync(store.dir).filter((f) => f.startsWith('notes.json.outside-'));

function writeDoc(store, doc) {
  const tmp = store.file + '.writing';
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
  fs.renameSync(tmp, store.file);
}

function editOutside(store, edit) {
  const doc = readDoc(store);
  edit(doc);
  writeDoc(store, doc);
  return doc;
}

function listen(store) {
  const heard = { edits: [], index: [] };
  store.onOutsideEdit = (e) => heard.edits.push(e);
  store.onIndexChange = (u) => heard.index.push(u);
  return heard;
}

test('an outside edit is taken in and survives the next save and a restart (the stale-rows bug of 2026-11-05)', () => {
  const { store, a, b } = twoNotes();
  const heard = listen(store);
  editOutside(store, (doc) => { rowOf(doc, a.id).pinned = true; });
  const edit = store.syncWithDisk();
  assert.equal(edit.kind, 'merged');
  assert.deepEqual(edit.notes.map((n) => n.id), [a.id]);
  assert.deepEqual(heard.edits, [edit]);
  assert.deepEqual(heard.index.map((u) => u.notes.map((n) => n.id)), [[a.id]]);
  assert.equal(store.get(a.id).pinned, true);
  assert.equal(store.get(a.id), store.notes.find((n) => n.id === a.id), 'the row object is kept, so other modules holding it stay current');
  store.update(b.id, { body: 'b2' });
  store.save();
  const again = reload(store);
  assert.equal(again.get(a.id).pinned, true);
  assert.equal(again.get(b.id).body, 'b2');
  assert.deepEqual(keptAside(store), []);
});

test('an outside write in place with the same size is still seen, by its time', () => {
  const { store, a } = twoNotes();
  const doc = readDoc(store);
  rowOf(doc, a.id).title = 'Z';
  fs.writeFileSync(store.file, JSON.stringify(doc, null, 2));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(store.file, later, later);
  assert.equal(store.syncWithDisk().kind, 'merged');
  assert.equal(store.get(a.id).title, 'Z');
});

test('an outside file written in Notes\' clock tick at the same size is still seen, by its file id', () => {
  const { store, a } = twoNotes();
  const written = fs.statSync(store.file).mtimeMs;
  editOutside(store, (doc) => { rowOf(doc, a.id).title = 'Z'; });
  const realStat = fs.statSync;
  fs.statSync = function (file, ...rest) {
    const st = realStat.call(this, file, ...rest);
    return file === store.file ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { mtimeMs: written }) : st;
  };
  try {
    assert.equal(fs.statSync(store.file).size, store.base.stamp.size, 'same size');
    assert.equal(store.syncWithDisk().kind, 'merged');
  } finally { fs.statSync = realStat; }
  assert.equal(store.get(a.id).title, 'Z');
});

test('nothing changed on disk: a sync returns nothing and writes nothing, and Notes\' own journal append is not an outside edit', () => {
  const { store, a } = twoNotes();
  const heard = listen(store);
  const before = fs.statSync(store.file);
  assert.equal(store.syncWithDisk(), null);
  store.update(a.id, { body: 'appended' });
  assert.equal(store.journalRecords, 1);
  assert.equal(store.syncWithDisk(), null);
  const after = fs.statSync(store.file);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);
  assert.deepEqual(heard.edits, []);
});

test('a row Notes changed since its last full save keeps Notes\' version; the outside edit\'s other rows are taken', () => {
  const { store, a, b } = twoNotes();
  store.update(a.id, { body: 'mine' });
  editOutside(store, (doc) => {
    Object.assign(rowOf(doc, a.id), { body: 'theirs', pinned: true });
    rowOf(doc, b.id).pinned = true;
  });
  const edit = store.syncWithDisk();
  assert.deepEqual(edit.notes.map((n) => n.id), [b.id]);
  assert.equal(store.get(a.id).body, 'mine');
  assert.equal(store.get(a.id).pinned, false);
  assert.equal(store.get(b.id).pinned, true);
  const again = reload(store);
  assert.equal(again.get(a.id).body, 'mine');
  assert.equal(again.get(b.id).pinned, true);
});

test('Notes\' journal append after an outside edit is kept when the edit is merged later', () => {
  const { store, a, b } = twoNotes();
  editOutside(store, (doc) => { rowOf(doc, a.id).pinned = true; });
  store.update(b.id, { body: 'typed meanwhile' });
  assert.equal(store.journalRecords, 1, 'the append does not overwrite notes.json');
  store.syncWithDisk();
  assert.equal(store.get(a.id).pinned, true);
  assert.equal(store.get(b.id).body, 'typed meanwhile');
  const again = reload(store);
  assert.equal(again.get(a.id).pinned, true);
  assert.equal(again.get(b.id).body, 'typed meanwhile');
});

test('a full save that finds an unmerged outside edit keeps a copy of it instead of overwriting it', () => {
  const { store, a } = twoNotes();
  editOutside(store, (doc) => { rowOf(doc, a.id).pinned = true; });
  const theirs = fs.readFileSync(store.file, 'utf8');
  const heard = listen(store);
  store.save();
  const kept = keptAside(store);
  assert.equal(kept.length, 1);
  assert.equal(fs.readFileSync(path.join(store.dir, kept[0]), 'utf8'), theirs);
  assert.deepEqual(heard.edits, [], 'not announced from inside the save');
  assert.equal(store.syncWithDisk(), null, 'the save wrote over it, so there is nothing left to merge');
  assert.deepEqual(heard.edits, [{ kind: 'set-aside', file: path.join(store.dir, kept[0]) }], 'announced at the next sync');
});

test('when the write after a merge fails, nothing is announced, nothing is merged or copied again, retries wait a moment, and the news comes once the write works', () => {
  const { store, tick, a } = twoNotes();
  const heard = listen(store);
  editOutside(store, (doc) => { delete doc.journalId; });
  const blocker = store.file + '.tmp';
  fs.mkdirSync(blocker);
  try {
    assert.throws(() => store.syncWithDisk());
    assert.equal(store.syncWithDisk(), null, 'no second try at once');
    tick(2000);
    assert.throws(() => store.syncWithDisk(), undefined, 'a later try writes again');
    assert.deepEqual(heard.edits, []);
    assert.equal(keptAside(store).length, 1, 'copied aside once, not on every try');
  } finally { fs.rmdirSync(blocker); }
  tick(2000);
  const edit = store.syncWithDisk();
  assert.equal(edit.kind, 'set-aside');
  assert.deepEqual(heard.edits, [edit]);
  assert.equal(store.syncWithDisk(), null);
  editOutside(store, (doc) => { rowOf(doc, a.id).pinned = true; });
  fs.mkdirSync(blocker);
  try { assert.throws(() => store.syncWithDisk()); } finally { fs.rmdirSync(blocker); }
  assert.equal(store.get(a.id).pinned, true, 'taken in memory');
  assert.equal(heard.edits.length, 1);
  store.update(a.id, { body: 'typed while the disk was failing' });
  store.save();
  assert.equal(keptAside(store).length, 1, 'a full save does not copy aside an edit already taken in');
  store.syncWithDisk();
  assert.deepEqual(heard.edits.slice(1).map((e) => [e.kind, e.notes.map((n) => n.id)]), [['merged', [a.id]]]);
  const again = reload(store);
  assert.equal(again.get(a.id).pinned, true);
  assert.equal(again.get(a.id).body, 'typed while the disk was failing');
});

test('a listener that throws does not cost the other edits their announcement', () => {
  const { store, tick, a, b } = twoNotes();
  const blocker = store.file + '.tmp';
  editOutside(store, (doc) => { rowOf(doc, a.id).pinned = true; });
  fs.mkdirSync(blocker);
  try {
    assert.throws(() => store.syncWithDisk());
    editOutside(store, (doc) => { rowOf(doc, b.id).pinned = true; });
    assert.throws(() => store.syncWithDisk(), undefined, 'a new outside write is taken in and tried at once');
  } finally { fs.rmdirSync(blocker); }
  tick(2000);
  const heard = [];
  store.onOutsideEdit = (e) => { heard.push(e.notes.map((n) => n.id)); if (heard.length === 1) throw new Error('listener failed'); };
  assert.throws(() => store.syncWithDisk(), /listener failed/);
  store.syncWithDisk();
  assert.deepEqual(heard, [[a.id], [b.id]]);
});

test('a notes.json that stays unreadable is read once, not on every sync, until it changes or the caller gives up waiting', () => {
  const { store } = twoNotes();
  fs.writeFileSync(store.file, '{ not json');
  const realRead = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (file, ...rest) { if (file === store.file) reads++; return realRead.call(this, file, ...rest); };
  try {
    for (let i = 0; i < 3; i++) assert.deepEqual(store.syncWithDisk(), { kind: 'unreadable' });
    assert.equal(reads, 1);
    fs.writeFileSync(store.file, '{ still not json }');
    assert.deepEqual(store.syncWithDisk(), { kind: 'unreadable' });
    assert.equal(reads, 2, 'read again once it changed');
    assert.equal(store.syncWithDisk({ unreadable: 'set-aside' }).kind, 'set-aside');
  } finally { fs.readFileSync = realRead; }
});

test('a merge that removes notes first backs up the library as Notes held it, so an outside file that empties it can be undone', () => {
  const { store, a, b } = twoNotes();
  store.update(a.id, { body: 'latest' });
  editOutside(store, (doc) => { doc.notes = []; });
  store.syncWithDisk();
  assert.deepEqual(store.notes.map((n) => n.id), [a.id], 'the note Notes changed stays; the other goes');
  const backups = fs.readdirSync(store.backupDir).map((f) => JSON.parse(fs.readFileSync(path.join(store.backupDir, f), 'utf8')));
  const before = backups.find((d) => d.notes.some((n) => n.id === a.id && n.body === 'latest'));
  assert.ok(before, 'a backup holds the library as it was just before the merge');
  assert.ok(before.notes.some((n) => n.id === b.id));
});

test('a merge that removes nothing writes no backup, so a tool that rewrites notes.json often cannot push the old backups out', () => {
  const { store, tick, a } = twoNotes();
  const count = () => fs.readdirSync(store.backupDir).length;
  const before = count();
  for (let i = 0; i < 3; i++) {
    tick(60_000);
    editOutside(store, (doc) => { rowOf(doc, a.id).pinned = i % 2 === 0; });
    assert.equal(store.syncWithDisk().kind, 'merged');
  }
  assert.equal(count(), before);
});

test('a backups folder that cannot be made does not stop a merge', () => {
  const { store, a } = twoNotes();
  fs.rmSync(store.backupDir, { recursive: true, force: true });
  fs.writeFileSync(store.backupDir, 'not a folder');
  editOutside(store, (doc) => { doc.notes = doc.notes.filter((n) => n.id !== a.id); });
  assert.deepEqual(store.syncWithDisk().dropped, [a.id]);
  assert.equal(reload(store).get(a.id), null);
});

test('an outside edit that unlinks a linked file leaves the note without a file and reads nothing', async () => {
  const { store } = makeStore();
  const file = path.join(tmpDir('notes-outside-files-'), 'linked.txt');
  fs.writeFileSync(file, 'text');
  const n = await store.linkFile(file);
  store.save();
  editOutside(store, (doc) => { rowOf(doc, n.id).filePath = null; });
  const edit = store.syncWithDisk();
  assert.deepEqual(edit.notes.map((x) => x.id), [n.id]);
  assert.deepEqual(edit.refresh, []);
  assert.equal(store.get(n.id).filePath, null);
  assert.equal(store.get(n.id).fileMtime, null);
});

test('an outside edit is merged even when the journal was missing at the last start', () => {
  const { store, a } = twoNotes();
  fs.rmSync(store.journalFile);
  const restarted = new Store(store.dir, { now: () => 2_000_000 }).load();
  assert.equal(restarted.journalReady, false);
  editOutside(restarted, (doc) => { rowOf(doc, a.id).pinned = true; });
  assert.equal(restarted.syncWithDisk().kind, 'merged');
  assert.equal(restarted.get(a.id).pinned, true);
});

test('copies kept aside are pruned like stale journals: the newest three under 30 days stay, old ones go, and locking a note removes them all', () => {
  const { store, tick } = makeStore();
  const a = store.create({ title: 'A', body: 'a' });
  store.save();
  const made = [];
  for (let i = 0; i < 5; i++) {
    tick(1000);
    editOutside(store, (doc) => { delete doc.journalId; });
    made.push(path.basename(store.syncWithDisk().file));
  }
  assert.deepEqual(keptAside(store).sort(), made.slice(-3).sort());
  tick(31 * 24 * 60 * 60 * 1000);
  store.save();
  assert.deepEqual(keptAside(store), []);
  editOutside(store, (doc) => { delete doc.journalId; });
  store.syncWithDisk();
  assert.equal(keptAside(store).length, 1);
  store.lockNote(a.id, 'pw');
  assert.deepEqual(keptAside(store), []);
});

test('flush takes in an outside edit before it saves', () => {
  const { store, a, b } = twoNotes();
  store.update(b.id, { body: 'unsaved' });
  editOutside(store, (doc) => { rowOf(doc, a.id).pinned = true; });
  store.flush();
  assert.equal(store.journalRecords, 0);
  assert.deepEqual(keptAside(store), []);
  const again = reload(store);
  assert.equal(again.get(a.id).pinned, true);
  assert.equal(again.get(b.id).body, 'unsaved');
});

test('a row the outside edit removes is dropped and a row it adds is taken, in memory, in the index and on disk', () => {
  const { store, a, b } = twoNotes();
  const heard = listen(store);
  editOutside(store, (doc) => {
    doc.notes = doc.notes.filter((n) => n.id !== a.id);
    doc.notes.push(Object.assign({}, rowOf(doc, b.id), { id: 'from-outside', title: 'Added', body: 'hello' }));
  });
  const edit = store.syncWithDisk();
  assert.deepEqual(edit.dropped, [a.id]);
  assert.deepEqual(edit.notes.map((n) => n.id), ['from-outside']);
  assert.deepEqual(edit.refresh, []);
  assert.equal(store.get(a.id), null);
  assert.equal(store.get('from-outside').body, 'hello');
  assert.deepEqual(heard.index[0].dropped, [a.id]);
  const again = reload(store);
  assert.equal(again.get(a.id), null);
  assert.equal(again.get('from-outside').title, 'Added');
});

test('a row Notes removed since its last full save stays removed, even though the outside copy still has it', async () => {
  const { store, home } = homeStore();
  const gone = store.create({ body: '# Gone\n' });
  store.save();
  fs.rmSync(gone.filePath);
  await store.scanVault(home.id);
  assert.equal(store.get(gone.id), null);
  assert.ok(store.journalRecords > 0, 'the removal was journaled, not a full save');
  editOutside(store, (doc) => { assert.ok(rowOf(doc, gone.id), 'the outside editor read the copy from before the removal'); });
  const edit = store.syncWithDisk();
  assert.deepEqual(edit.notes, []);
  assert.equal(store.get(gone.id), null);
  assert.equal(reload(store).get(gone.id), null);
});

test('a note on its way to the Recycle Bin is left alone', () => {
  const { store, a } = twoNotes();
  store.recycling.add(a.id);
  editOutside(store, (doc) => { doc.notes = doc.notes.filter((n) => n.id !== a.id); });
  assert.deepEqual(store.syncWithDisk().dropped, []);
  assert.ok(store.get(a.id));
});

test('a removed row stays while its file is still in a notes folder; one whose file is gone is dropped', () => {
  const { store } = homeStore();
  const keep = store.create({ body: '# Keep\n' });
  const gone = store.create({ body: '# Gone\n' });
  store.save();
  fs.rmSync(gone.filePath);
  editOutside(store, (doc) => { doc.notes = doc.notes.filter((n) => n.id !== keep.id && n.id !== gone.id); });
  const edit = store.syncWithDisk();
  assert.deepEqual(edit.dropped, [gone.id]);
  assert.ok(store.get(keep.id));
  assert.equal(store.get(gone.id), null);
});

test('the file decides a file note\'s text, name and place; its pin comes from the outside edit', () => {
  const { store } = homeStore();
  const n = store.create({ body: '# Plan\nreal text\n', tags: 'work' });
  store.save();
  const before = Object.assign({}, store.get(n.id));
  editOutside(store, (doc) => {
    Object.assign(rowOf(doc, n.id), { body: 'stale', title: 'Renamed', filePath: 'C:\\elsewhere\\Plan.md', folderId: 'nowhere', tags: ['other'], fileMtime: 1, pinned: true });
  });
  const edit = store.syncWithDisk();
  assert.deepEqual(edit.notes.map((x) => x.id), [n.id]);
  assert.deepEqual(edit.refresh, []);
  const after = store.get(n.id);
  for (const k of ['body', 'title', 'filePath', 'folderId', 'vaultId', 'tags', 'fileMtime', 'fileKind']) assert.deepEqual(after[k], before[k], k);
  assert.equal(after.pinned, true);
});

test('an outside relink of a linked file points the note at the new file, which is read again', async () => {
  const { store } = makeStore();
  const dir = tmpDir('notes-outside-files-');
  const oldFile = path.join(dir, 'old.txt');
  const newFile = path.join(dir, 'new.txt');
  fs.writeFileSync(oldFile, 'old text');
  fs.writeFileSync(newFile, 'new text');
  const n = await store.linkFile(oldFile);
  store.save();
  editOutside(store, (doc) => { rowOf(doc, n.id).filePath = newFile; });
  const edit = store.syncWithDisk();
  assert.deepEqual(edit.refresh, [n.id]);
  assert.equal(store.get(n.id).filePath, newFile);
  assert.equal(store.get(n.id).fileMtime, null);
  await store.refreshFileNote(n.id);
  assert.equal(store.get(n.id).body, 'new text');
});

test('a linked file added from outside is read from disk, not from the row\'s text', async () => {
  const { store, b } = twoNotes();
  const file = path.join(tmpDir('notes-outside-files-'), 'added.txt');
  fs.writeFileSync(file, 'on disk');
  editOutside(store, (doc) => {
    doc.notes.push(Object.assign({}, rowOf(doc, b.id), { id: 'linked', title: 'added.txt', body: 'stale', filePath: file, fileKind: 'text', fileMtime: 1 }));
  });
  const edit = store.syncWithDisk();
  assert.deepEqual(edit.refresh, ['linked']);
  await store.refreshFileNote('linked');
  assert.equal(store.get('linked').body, 'on disk');
});

test('settings merge key by key: an outside key is taken, a key Notes changed keeps Notes\' value', () => {
  const { store } = twoNotes();
  store.setSettings({ sidebarWidth: 300 });
  editOutside(store, (doc) => { doc.settings.fontSize = 18; doc.settings.sidebarWidth = 250; });
  const edit = store.syncWithDisk();
  assert.deepEqual(edit.settings, ['fontSize']);
  assert.equal(edit.settingsBefore.fontSize, 16);
  assert.equal(store.settings.fontSize, 18);
  assert.equal(store.settings.sidebarWidth, 300);
  const again = reload(store);
  assert.equal(again.settings.fontSize, 18);
  assert.equal(again.settings.sidebarWidth, 300);
});

test('an outside setting is cleaned like any other, and an unchanged one is not reported', () => {
  const { store } = twoNotes();
  editOutside(store, (doc) => { doc.settings.fontSize = 999; doc.settings.theme = doc.settings.theme; });
  const edit = store.syncWithDisk();
  assert.deepEqual(edit.settings, ['fontSize']);
  assert.ok(store.settings.fontSize < 999, 'clamped by sanitizeSettings');
});

test('an outside file without notes, folders or settings leaves those alone', () => {
  const { store } = twoNotes();
  store.createFolder({ name: 'Kept' });
  store.save();
  const settings = store.getSettings();
  editOutside(store, (doc) => { delete doc.notes; delete doc.folders; delete doc.settings; });
  const edit = store.syncWithDisk();
  assert.equal(edit.kind, 'merged');
  assert.deepEqual([edit.notes, edit.dropped, edit.settings, edit.folders], [[], [], [], false]);
  assert.equal(store.notes.length, 2);
  assert.equal(store.folders.length, 1);
  assert.deepEqual(store.getSettings(), settings);
});

test('an outside edit made from an older copy is kept aside, not merged, and Notes\' newer state is written', () => {
  const { store, a } = twoNotes();
  const heard = listen(store);
  const old = readDoc(store);
  store.update(a.id, { body: 'newer' });
  store.save();
  rowOf(old, a.id).pinned = true;
  writeDoc(store, old);
  const edit = store.syncWithDisk();
  assert.equal(edit.kind, 'set-aside');
  assert.deepEqual(heard.edits, [edit]);
  assert.equal(JSON.parse(fs.readFileSync(edit.file, 'utf8')).journalId, old.journalId);
  assert.equal(store.get(a.id).pinned, false);
  const again = reload(store);
  assert.equal(again.get(a.id).body, 'newer');
  assert.equal(again.get(a.id).pinned, false);
});

test('an outside file with no journal id is kept aside', () => {
  const { store, a } = twoNotes();
  editOutside(store, (doc) => { delete doc.journalId; rowOf(doc, a.id).pinned = true; });
  assert.equal(store.syncWithDisk().kind, 'set-aside');
  assert.equal(store.get(a.id).pinned, false);
});

test('two copies kept aside at the same moment get different names', () => {
  const { store, a } = twoNotes();
  editOutside(store, (doc) => { delete doc.journalId; });
  const first = store.syncWithDisk();
  editOutside(store, (doc) => { delete doc.journalId; rowOf(doc, a.id).pinned = true; });
  const second = store.syncWithDisk();
  assert.notEqual(first.file, second.file);
  assert.equal(keptAside(store).length, 2);
});

test('a half-written notes.json is left alone while it may still be written, then kept aside when asked', () => {
  const { store, a } = twoNotes();
  const heard = listen(store);
  const partial = '{"schemaVersion": 2, "notes": [';
  fs.writeFileSync(store.file, partial);
  assert.deepEqual(store.syncWithDisk(), { kind: 'unreadable' });
  assert.equal(fs.readFileSync(store.file, 'utf8'), partial);
  assert.deepEqual(heard.edits, [], 'nothing to tell anyone yet');
  const edit = store.syncWithDisk({ unreadable: 'set-aside' });
  assert.equal(edit.kind, 'set-aside');
  assert.equal(fs.readFileSync(edit.file, 'utf8'), partial);
  assert.equal(reload(store).get(a.id).title, 'A');
});

test('a deleted notes.json is written again from what Notes holds', () => {
  const { store, a } = twoNotes();
  store.update(a.id, { body: 'journaled' });
  fs.rmSync(store.file);
  assert.deepEqual(store.syncWithDisk(), { kind: 'restored' });
  assert.equal(reload(store).get(a.id).body, 'journaled');
});

test('a journal removed from outside is rewritten on the next sync', () => {
  const { store, a } = twoNotes();
  store.update(a.id, { body: 'journaled' });
  fs.rmSync(store.journalFile);
  assert.deepEqual(store.syncWithDisk(), { kind: 'restored' });
  assert.ok(fs.readFileSync(store.journalFile, 'utf8').startsWith('{"journalId"'));
  assert.equal(reload(store).get(a.id).body, 'journaled');
});

test('a journal removed from outside makes the next change a full save, so the change outlives a restart', () => {
  const { store, a } = twoNotes();
  fs.rmSync(store.journalFile);
  store.update(a.id, { body: 'after' });
  assert.equal(store.journalRecords, 0, 'not appended to a journal with no header');
  assert.ok(fs.readFileSync(store.journalFile, 'utf8').startsWith('{"journalId"'));
  assert.equal(reload(store).get(a.id).body, 'after');
});

test('a journal emptied or rewritten outside is not appended to: the next change is a full save that outlives a restart', () => {
  for (const outsideText of ['', '{"journalId":"someone-else"}']) {
    const { store, a } = twoNotes();
    store.update(a.id, { body: 'before' });
    fs.writeFileSync(store.journalFile, outsideText);
    store.update(a.id, { body: 'after' });
    assert.equal(store.journalRecords, 0, 'not appended after ' + JSON.stringify(outsideText));
    assert.equal(reload(store).get(a.id).body, 'after');
  }
});

test('a library that could not be read at start is never synced', () => {
  const { store, a } = twoNotes();
  editOutside(store, (doc) => { rowOf(doc, a.id).pinned = true; });
  store.saveBlocked = true;
  assert.equal(store.syncWithDisk(), null);
  assert.equal(store.get(a.id).pinned, false);
});

test('after a restart with an unsaved journal, the rows in it count as changed by Notes', () => {
  const { store, a, b } = twoNotes();
  store.update(a.id, { body: 'journaled' });
  const restarted = new Store(store.dir, { now: () => 2_000_000 }).load();
  editOutside(restarted, (doc) => {
    rowOf(doc, a.id).body = 'theirs';
    rowOf(doc, b.id).pinned = true;
  });
  restarted.syncWithDisk();
  assert.equal(restarted.get(a.id).body, 'journaled');
  assert.equal(restarted.get(b.id).pinned, true);
});

test('an outside editor that read the journal too is merged the same way', () => {
  const { store, a, b } = twoNotes();
  store.update(a.id, { body: 'journaled' });
  const doc = readLibrary(store.dir);
  assert.equal(rowOf(doc, a.id).body, 'journaled');
  rowOf(doc, b.id).pinned = true;
  writeDoc(store, doc);
  store.syncWithDisk();
  assert.equal(store.get(a.id).body, 'journaled');
  assert.equal(store.get(b.id).pinned, true);
});

test('a locked note whose sealed text changes outside is locked again for the session, and the index is purged', () => {
  const { store } = makeStore();
  const secret = store.create({ title: 'Secret', body: 'hidden' });
  const other = store.create({ title: 'Other', body: 'also hidden' });
  store.lockNote(secret.id, 'pw');
  store.lockNote(other.id, 'pw2');
  store.save();
  assert.equal(store.publicNote(store.get(secret.id)).unlocked, true);
  const heard = listen(store);
  editOutside(store, (doc) => { rowOf(doc, secret.id).lock = rowOf(doc, other.id).lock; });
  store.syncWithDisk();
  assert.equal(store.publicNote(store.get(secret.id)).unlocked, false);
  assert.equal(store.publicNote(store.get(other.id)).unlocked, true);
  assert.equal(heard.index[0].purge, true);
});

test('a locked note removed outside is forgotten for the session too', () => {
  const { store } = makeStore();
  const secret = store.create({ title: 'Secret', body: 'hidden' });
  store.lockNote(secret.id, 'pw');
  store.save();
  editOutside(store, (doc) => { doc.notes = doc.notes.filter((n) => n.id !== secret.id); });
  store.syncWithDisk();
  assert.equal(store.plain.has(secret.id), false);
  assert.equal(store.keys.has(secret.id), false);
});

test('folders: an outside rename is taken, a folder removed outside frees its notes, and a new one is added', () => {
  const { store } = makeStore();
  const work = store.createFolder({ name: 'Work' });
  const old = store.createFolder({ name: 'Old' });
  const n = store.create({ title: 'In old', folderId: old.id });
  store.setSettings({ expandedFolders: [old.id] });
  store.save();
  editOutside(store, (doc) => {
    doc.folders.find((f) => f.id === work.id).name = 'Jobs';
    doc.folders = doc.folders.filter((f) => f.id !== old.id);
    doc.folders.push(Object.assign({}, doc.folders[0], { id: 'outside-folder', name: 'New' }));
  });
  const edit = store.syncWithDisk();
  assert.equal(edit.folders, true);
  assert.equal(store.getFolder(work.id).name, 'Jobs');
  assert.equal(store.getFolder(old.id), null);
  assert.equal(store.getFolder('outside-folder').name, 'New');
  assert.equal(store.get(n.id).folderId, null);
  assert.deepEqual(store.settings.expandedFolders, []);
  assert.equal(reload(store).getFolder(work.id).name, 'Jobs');
});

test('folders: one Notes changed since its last full save keeps Notes\' version', () => {
  const { store } = makeStore();
  const f = store.createFolder({ name: 'Work' });
  store.save();
  store.renameFolder(f.id, 'Mine');
  editOutside(store, (doc) => { doc.folders.find((x) => x.id === f.id).name = 'Theirs'; });
  assert.equal(store.syncWithDisk().folders, false);
  assert.equal(store.getFolder(f.id).name, 'Mine');
});

test('folders: a folder in a notes folder on disk is decided by the disk', () => {
  const { store } = homeStore();
  const f = store.createFolder({ name: 'Projects' });
  store.save();
  editOutside(store, (doc) => {
    doc.folders.find((x) => x.id === f.id).name = 'Renamed';
    doc.folders.push(Object.assign({}, doc.folders.find((x) => x.id === f.id), { id: 'outside-vault-folder' }));
  });
  assert.equal(store.syncWithDisk().folders, false);
  assert.equal(store.getFolder(f.id).name, 'Projects');
  assert.equal(store.getFolder('outside-vault-folder'), null);
});

test('folders: an outside edit cannot remove a folder that lives on disk', () => {
  const { store } = homeStore();
  const f = store.createFolder({ name: 'Projects' });
  store.save();
  editOutside(store, (doc) => { doc.folders = doc.folders.filter((x) => x.id !== f.id); });
  store.syncWithDisk();
  assert.ok(store.getFolder(f.id));
});

test('vaults are Notes\' own: an outside change to them is ignored', () => {
  const { store, home } = homeStore();
  store.save();
  editOutside(store, (doc) => { doc.vaults[0].name = 'Elsewhere'; doc.vaults.push(Object.assign({}, doc.vaults[0], { id: 'outside-vault', home: false })); });
  store.syncWithDisk();
  assert.deepEqual(store.vaults.map((v) => v.id), [home.id]);
  assert.equal(store.getVault(home.id).name, home.name);
});
