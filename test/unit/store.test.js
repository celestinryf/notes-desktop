'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, DEFAULT_SETTINGS, sanitizeSettings } = require('../../src/store');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'notes-store-'));
}

function makeStore(opts) {
  let t = 1_000_000;
  const clock = { now: () => t, tick: (ms) => { t += ms; } };
  const store = new Store(tmpDir(), Object.assign({ now: clock.now }, opts)).load();
  return { store, clock };
}

test('starts empty with default settings and creates the data file on first save', () => {
  const { store } = makeStore();
  assert.deepEqual(store.list(), []);
  assert.deepEqual(store.getSettings(), DEFAULT_SETTINGS);
  assert.equal(fs.existsSync(store.file), false);
  store.save();
  assert.equal(fs.existsSync(store.file), true);
  assert.equal(fs.existsSync(store.file + '.tmp'), false, 'temp file is renamed away');
});

test('create, update, and reload persist notes', () => {
  const { store, clock } = makeStore();
  const n = store.create({ title: 'Hello', body: 'world', tags: 'A, b' });
  assert.equal(n.title, 'Hello');
  assert.deepEqual(n.tags, ['a', 'b']);
  assert.equal(n.createdAt, n.updatedAt);
  clock.tick(1000);
  const u = store.update(n.id, { body: 'changed' });
  assert.equal(u.body, 'changed');
  assert.equal(u.updatedAt, n.createdAt + 1000);
  const reloaded = new Store(store.dir).load();
  assert.equal(reloaded.get(n.id).body, 'changed');
  assert.equal(reloaded.list().length, 1);
});

test('update with no effective change does not bump updatedAt or write', () => {
  const { store, clock } = makeStore();
  const n = store.create({ title: 'x', body: 'y', tags: ['t'] });
  const mtime = fs.statSync(store.file).mtimeMs;
  clock.tick(5000);
  store.update(n.id, { title: 'x', body: 'y', tags: 'T' });
  assert.equal(store.get(n.id).updatedAt, n.createdAt);
  assert.equal(fs.statSync(store.file).mtimeMs, mtime);
  assert.equal(store.update('missing', { title: 'z' }), null);
});

test('list filters by trash, pinned, tag, and query, and sorts pinned first', () => {
  const { store, clock } = makeStore();
  const a = store.create({ title: 'Alpha', body: 'first', tags: ['work'] });
  clock.tick(10);
  const b = store.create({ title: 'Beta', body: 'second', tags: ['home'] });
  clock.tick(10);
  const c = store.create({ title: 'Gamma', body: 'third', tags: ['work'] });
  store.togglePin(a.id);
  assert.deepEqual(store.list().map((n) => n.id), [a.id, c.id, b.id]);
  assert.deepEqual(store.list({ pinned: true }).map((n) => n.id), [a.id]);
  assert.deepEqual(store.list({ tag: 'WORK' }).map((n) => n.id), [a.id, c.id]);
  assert.deepEqual(store.list({ query: 'second' }).map((n) => n.id), [b.id]);
  store.trash(b.id);
  assert.deepEqual(store.list().map((n) => n.id), [a.id, c.id]);
  assert.deepEqual(store.list({ trashed: true }).map((n) => n.id), [b.id]);
  assert.deepEqual(store.list({ sort: 'title' }).map((n) => n.id), [a.id, c.id]);
});

test('trash keeps the pin, restore brings back, destroy removes, emptyTrash clears only trashed', () => {
  const { store } = makeStore();
  const a = store.create({ title: 'a' });
  const b = store.create({ title: 'b' });
  store.togglePin(a.id);
  store.trash(a.id);
  assert.equal(store.get(a.id).pinned, true, 'pin survives the trash');
  assert.ok(store.get(a.id).trashedAt);
  assert.deepEqual(store.list({ pinned: true }), [], 'but a trashed note is not in the pinned view');
  store.restore(a.id);
  assert.equal(store.get(a.id).trashedAt, null);
  assert.equal(store.get(a.id).pinned, true, 'restored note is pinned again');
  store.trash(a.id);
  store.trash(b.id);
  store.restore(b.id);
  assert.equal(store.emptyTrash(), 1);
  assert.equal(store.get(a.id), null);
  assert.ok(store.get(b.id));
  assert.equal(store.destroy(b.id), true);
  assert.equal(store.destroy(b.id), false);
  assert.deepEqual(store.counts(), { all: 0, pinned: 0, trash: 0 });
});

test('duplicate copies content, drops pin, and appends (copy)', () => {
  const { store } = makeStore();
  const a = store.create({ title: 'Orig', body: 'b', tags: ['t'], pinned: true });
  const d = store.duplicate(a.id);
  assert.equal(d.title, 'Orig (copy)');
  assert.equal(d.body, 'b');
  assert.deepEqual(d.tags, ['t']);
  assert.equal(d.pinned, false);
  assert.notEqual(d.id, a.id);
  assert.equal(store.duplicate('nope'), null);
});

test('tags counts exclude trashed notes and sort by count then name', () => {
  const { store } = makeStore();
  store.create({ tags: ['b', 'a'] });
  store.create({ tags: ['b'] });
  const t = store.create({ tags: ['z'] });
  store.trash(t.id);
  assert.deepEqual(store.tags(), [{ tag: 'b', count: 2 }, { tag: 'a', count: 1 }]);
});

test('settings are sanitized on load and on set', () => {
  assert.deepEqual(sanitizeSettings({ hotkey: 'garbage', theme: 'neon', fontSize: 'abc', sort: 'x', window: { width: 10 } }), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings('bad'), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings(['x']), DEFAULT_SETTINGS);
  assert.equal(sanitizeSettings({ fontSize: 900 }).fontSize, 28);
  assert.equal(sanitizeSettings({ fontSize: 3 }).fontSize, 12);
  assert.equal(sanitizeSettings({ sidebarWidth: 50 }).sidebarWidth, 160);
  assert.equal(sanitizeSettings({ sidebarWidth: 9999 }).sidebarWidth, 420);
  assert.equal(sanitizeSettings({ listWidth: 'wide' }).listWidth, 300);
  assert.equal(sanitizeSettings({ listWidth: 333.6 }).listWidth, 334);
  assert.equal(sanitizeSettings({ window: { width: 1100, height: 720 } }).window, null, 'a rectangle without x/y is dropped');
  assert.equal(sanitizeSettings({ window: { x: 'a', y: 0, width: 1100, height: 720 } }).window, null);
  assert.deepEqual(sanitizeSettings({ window: { x: 10.4, y: 20.6, width: 800, height: 600 } }).window, { x: 10, y: 21, width: 800, height: 600 });
  assert.equal(sanitizeSettings({ fontSize: '18' }).fontSize, 18);
  assert.equal(sanitizeSettings({ hotkey: 'ctrl+alt+k' }).hotkey, 'Control+Alt+K');
  const { store } = makeStore();
  const s = store.setSettings({ theme: 'dark', window: { x: 1, y: 2, width: 800, height: 600 } });
  assert.equal(s.theme, 'dark');
  assert.deepEqual(s.window, { x: 1, y: 2, width: 800, height: 600 });
  assert.equal(new Store(store.dir).load().getSettings().theme, 'dark');
});

test('corrupt data file is quarantined and the newest backup is used', () => {
  const { store, clock } = makeStore();
  const a = store.create({ title: 'keep me' });
  clock.tick(11 * 60 * 1000);
  store.create({ title: 'triggers backup' }); // save() copies the previous file into backups/
  assert.equal(fs.readdirSync(store.backupDir).length, 1);
  fs.writeFileSync(store.file, '{not json', 'utf8');
  const recovered = new Store(store.dir).load();
  assert.ok(recovered.loadError);
  assert.ok(recovered.get(a.id), 'note from backup survives');
  assert.ok(fs.readdirSync(store.dir).some((f) => f.startsWith('notes.json.corrupt-')));
});

test('backups are rate limited and capped', () => {
  const { store, clock } = makeStore();
  store.create({ title: 'seed' });
  for (let i = 0; i < 15; i++) {
    clock.tick(11 * 60 * 1000);
    store.create({ title: 'n' + i });
    store.create({ title: 'm' + i }); // second save inside the window: no extra backup
  }
  assert.equal(fs.readdirSync(store.backupDir).length, 10);
});

test('malformed notes in the file are repaired rather than crashing', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify({ notes: [null, 5, { title: 42, body: null, tags: 'a b', pinned: 'yes', createdAt: 'x' }], settings: 'bad' }));
  const store = new Store(dir).load();
  assert.equal(store.notes.length, 1);
  const n = store.notes[0];
  assert.equal(n.title, '');
  assert.equal(n.body, '');
  assert.deepEqual(n.tags, ['a', 'b']);
  assert.equal(n.pinned, true);
  assert.ok(Number.isFinite(n.createdAt));
  assert.ok(n.id);
  assert.deepEqual(store.getSettings(), DEFAULT_SETTINGS);
});

test('folders: create, nest, tree with recursive counts, path', () => {
  const { store } = makeStore();
  const work = store.createFolder({ name: '  Work  ' });
  const clients = store.createFolder({ name: 'Clients', parentId: work.id });
  const acme = store.createFolder({ name: 'Acme', parentId: clients.id });
  store.createFolder({ name: 'Home' });
  assert.equal(work.name, 'Work');
  store.create({ title: 'a', folderId: work.id });
  store.create({ title: 'b', folderId: acme.id });
  const t = store.create({ title: 'c', folderId: acme.id });
  store.trash(t.id);
  store.create({ title: 'loose' });
  const tree = store.folderTree();
  assert.deepEqual(tree.map((f) => f.name), ['Home', 'Work']);
  const w = tree[1];
  assert.equal(w.count, 1, 'direct count: what the folder view lists');
  assert.equal(w.total, 2, 'total includes subfolders and excludes trashed');
  assert.equal(w.children[0].name, 'Clients');
  assert.equal(w.children[0].children[0].name, 'Acme');
  assert.equal(w.children[0].children[0].depth, 2);
  assert.deepEqual(store.folderPath(acme.id).map((p) => p.name), ['Work', 'Clients', 'Acme']);
  assert.deepEqual(store.folderPath('nope'), []);
  assert.deepEqual(store.list({ folderId: work.id }).map((n) => n.title), ['a']);
  assert.deepEqual(store.list({ folderId: work.id, recursive: true }).map((n) => n.title).sort(), ['a', 'b']);
  assert.deepEqual(store.list({ folderId: null }).map((n) => n.title), ['loose']);
});

test('folders: rename, move with cycle protection, delete lifts contents to parent', () => {
  const { store } = makeStore();
  const a = store.createFolder({ name: 'A' });
  const b = store.createFolder({ name: 'B', parentId: a.id });
  const c = store.createFolder({ name: 'C', parentId: b.id });
  const n = store.create({ title: 'in b', folderId: b.id });
  assert.equal(store.renameFolder(b.id, '  Bee ').name, 'Bee');
  assert.equal(store.renameFolder(b.id, '').name, 'Untitled folder');
  assert.equal(store.renameFolder('nope', 'x'), null);
  assert.ok(store.moveFolder(a.id, c.id).error, 'cannot move into own descendant');
  assert.ok(store.moveFolder(a.id, a.id).error, 'cannot move into itself');
  assert.ok(store.moveFolder(a.id, 'missing').error);
  assert.equal(store.moveFolder(c.id, null).folder.parentId, null);
  assert.equal(store.moveFolder(c.id, a.id).folder.parentId, a.id);
  const res = store.deleteFolder(b.id);
  assert.deepEqual(res, { movedNotes: 1, movedFolders: 0, parentId: a.id });
  assert.equal(store.get(n.id).folderId, a.id);
  assert.equal(store.getFolder(b.id), null);
  assert.equal(store.deleteFolder('nope'), null);
  store.deleteFolder(a.id);
  assert.equal(store.get(n.id).folderId, null);
  assert.equal(store.getFolder(c.id).parentId, null);
});

test('folders: note updates validate folderId; restore drops a deleted folder; duplicate keeps folder', () => {
  const { store } = makeStore();
  const f = store.createFolder({ name: 'F' });
  const n = store.create({ title: 'n' });
  store.update(n.id, { folderId: f.id });
  assert.equal(store.get(n.id).folderId, f.id);
  assert.equal(store.duplicate(n.id).folderId, f.id);
  store.update(n.id, { folderId: 'missing' });
  assert.equal(store.get(n.id).folderId, null);
  store.update(n.id, { folderId: f.id });
  store.trash(n.id);
  store.folders = store.folders.filter((x) => x.id !== f.id);
  store.restore(n.id);
  assert.equal(store.get(n.id).folderId, null);
  assert.equal(store.create({ title: 'x', folderId: 'ghost' }).folderId, null);
});

test('folders: load repairs cycles, dangling parents, duplicates, and orphaned notes', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify({
    folders: [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'c', name: 'C', parentId: 'zzz' },
      { id: 'c', name: 'C dup' },
      { id: 'd', name: 'D', parentId: 'd' },
      { id: 'e', name: '', parentId: 'a' },
      'junk',
    ],
    notes: [{ id: 'n1', title: 'n1', folderId: 'gone' }, { id: 'n2', title: 'n2', folderId: 'a' }],
    settings: { expandedFolders: ['a', 'gone', 7] },
  }));
  const store = new Store(dir).load();
  const byId = Object.fromEntries(store.folders.map((f) => [f.id, f]));
  assert.deepEqual(Object.keys(byId).sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.ok(byId.a.parentId === null || byId.b.parentId === null, 'cycle broken');
  assert.equal(byId.c.parentId, null);
  assert.equal(byId.d.parentId, null);
  assert.equal(byId.e.name, 'Untitled folder');
  assert.equal(store.get('n1').folderId, null);
  assert.equal(store.get('n2').folderId, 'a');
  assert.deepEqual(store.getSettings().expandedFolders, ['a']);
  assert.ok(store.folderTree().length >= 1, 'tree renders after repair');
});

test('an unreadable (not corrupt) notes file pauses saving instead of loading a stale backup over it', () => {
  const dir = tmpDir();
  // A directory where the file should be makes every read fail with an I/O error, never a parse error.
  fs.mkdirSync(path.join(dir, 'notes.json'));
  const store = new Store(dir).load();
  assert.equal(store.saveBlocked, true);
  assert.ok(store.loadError);
  assert.deepEqual(store.notes, []);
  assert.throws(() => store.create({ title: 'x' }), /Saving is paused/);
  assert.deepEqual(store.notes, [], 'the refused create did not linger');
  assert.ok(!fs.readdirSync(dir).some((f) => f.startsWith('notes.json.corrupt-')), 'not quarantined as corrupt');
});

test('trash, restore, destroy, empty trash, folder ops, and settings roll back when the save fails', () => {
  const { store } = makeStore();
  const a = store.create({ title: 'a' });
  const b = store.create({ title: 'b' });
  const f = store.createFolder({ name: 'F' });
  const g = store.createFolder({ name: 'G', parentId: f.id });
  store.update(a.id, { folderId: g.id });
  store.trash(b.id);
  const snapshot = JSON.stringify(store.serialize());
  store.save = () => { throw Object.assign(new Error('EPERM: locked'), { code: 'EPERM' }); };
  assert.throws(() => store.trash(a.id), /EPERM/);
  assert.throws(() => store.restore(b.id), /EPERM/);
  assert.throws(() => store.destroy(b.id), /EPERM/);
  assert.throws(() => store.emptyTrash(), /EPERM/);
  assert.throws(() => store.renameFolder(g.id, 'H'), /EPERM/);
  assert.throws(() => store.moveFolder(g.id, null), /EPERM/);
  assert.throws(() => store.deleteFolder(g.id), /EPERM/);
  assert.throws(() => store.setSettings({ theme: 'dark' }), /EPERM/);
  assert.equal(JSON.stringify(store.serialize()), snapshot, 'memory identical after every failed mutation');
});

test('a failed save during create leaves nothing behind in memory', () => {
  const { store } = makeStore();
  store.create({ title: 'existing' });
  const realSave = store.save.bind(store);
  store.save = () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); };
  assert.throws(() => store.create({ title: 'ghost' }), /ENOSPC/);
  assert.throws(() => store.createFolder({ name: 'ghost folder' }), /ENOSPC/);
  store.save = realSave;
  store.setSettings({ theme: 'dark' }); // an unrelated later save
  const reloaded = new Store(store.dir).load();
  assert.deepEqual(reloaded.notes.map((n) => n.title), ['existing']);
  assert.deepEqual(reloaded.folders, []);
});

test('a failed save rolls the note back so the retry really writes', () => {
  const { store } = makeStore();
  const n = store.create({ title: 'orig', body: 'one' });
  const realSave = store.save.bind(store);
  let fail = true;
  store.save = () => { if (fail) throw Object.assign(new Error('EPERM: locked'), { code: 'EPERM' }); return realSave(); };
  assert.throws(() => store.update(n.id, { body: 'two' }), /EPERM/);
  assert.equal(store.get(n.id).body, 'one', 'memory rolled back');
  fail = false;
  const after = store.update(n.id, { body: 'two' });
  assert.equal(after.body, 'two');
  assert.equal(new Store(store.dir).load().get(n.id).body, 'two', 'retry reached disk');
});

test('export and import markdown', () => {
  const { store } = makeStore();
  const a = store.create({ title: 'Re: plan?', body: 'body', tags: ['x'] });
  const out = store.exportNote(a.id);
  assert.equal(out.filename, 'Re plan.md');
  assert.equal(out.content, '# Re: plan?\n\nbody\n\nTags: #x\n');
  const imported = store.importMarkdown('other.md', '# Imported\n\ntext\n');
  assert.equal(imported.title, 'Imported');
  assert.equal(store.list().length, 2);
  const all = JSON.parse(store.exportAll());
  assert.equal(all.notes.length, 2);
  assert.equal(store.exportNote('nope'), null);
});
