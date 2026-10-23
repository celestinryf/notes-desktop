'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Store, MOVING_MARKER } = require('../../src/store.mts');
const { tmpDir } = require('../helpers/tmp');

const DAY = 24 * 60 * 60 * 1000;

function legacyLibrary() {
  const dataDir = tmpDir('notes-move-data-');
  const linkedDir = tmpDir('notes-move-linked-');
  const linkedFile = path.join(linkedDir, 'AGENTS.md');
  fs.writeFileSync(linkedFile, 'agent rules\n');
  const t0 = Date.UTC(2026, 0, 1);
  const folders = [
    { id: 'f-tennis', name: 'Tennis: Tennis', parentId: null, createdAt: t0 },
    { id: 'f-sub', name: 'Sub', parentId: 'f-tennis', createdAt: t0, book: true, pageOrder: ['n-page2', 'n-page1'] },
    { id: 'f-agent', name: 'Agent files', parentId: null, createdAt: t0 },
  ];
  const notes = [
    { id: 'n-todo', title: 'TODO', body: '- one\n- see [the plan](note://aaaaaaaa-0000-4000-8000-000000000001)\n- and [rules](note://bbbbbbbb-0000-4000-8000-000000000002)\n', tags: ['work'], folderId: 'f-tennis', pinned: true, createdAt: t0, updatedAt: t0 + DAY, remindAt: t0 + 9 * DAY },
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', title: '', body: '# The plan\nsteps', tags: [], folderId: null, createdAt: t0, updatedAt: t0 + 2 * DAY, sticky: { x: 10, y: 20, w: 300, h: 200, color: 'leaf', onTop: true } },
    { id: 'n-page1', title: 'Page one', body: 'p1', tags: [], folderId: 'f-sub', createdAt: t0, updatedAt: t0 },
    { id: 'n-page2', title: 'Page two', body: 'p2', tags: [], folderId: 'f-sub', createdAt: t0, updatedAt: t0 },
    { id: 'n-bin', title: 'Old idea', body: 'binned', tags: [], folderId: 'f-tennis', createdAt: t0, updatedAt: t0, trashedAt: t0 + DAY },
    { id: 'n-dup', title: 'TODO', body: 'second todo at the top', tags: [], folderId: null, createdAt: t0, updatedAt: t0 },
    { id: 'bbbbbbbb-0000-4000-8000-000000000002', title: 'AGENTS.md', body: 'agent rules\n', tags: ['agent'], folderId: 'f-agent', filePath: linkedFile, fileKind: 'text', fileMtime: fs.statSync(linkedFile).mtimeMs, createdAt: t0, updatedAt: t0 },
  ];
  fs.writeFileSync(path.join(dataDir, 'notes.json'), JSON.stringify({ schemaVersion: 2, settings: { lastFolderId: 'f-tennis' }, folders, notes, vaults: [] }));
  const store = new Store(dataDir).load();
  return { store, dataDir, linkedFile };
}

test('moving the library writes every app note and folder as files, keeps ids, dates, tags and per-device state', () => {
  const { store, linkedFile, dataDir } = legacyLibrary();
  const dir = path.join(tmpDir('notes-move-home-'), 'Notes');
  const report = store.moveIntoHome(dir);
  const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
  assert.equal(report.notes, 6);
  assert.equal(report.folders, 3);
  assert.deepEqual(report.renamed, [{ kind: 'folder', from: 'Tennis: Tennis', to: 'Tennis Tennis' }]);
  assert.equal(read('Tennis Tennis', 'TODO.md'), '---\ntags:\n  - work\n---\n- one\n- see [the plan](../The%20plan.md)\n- and [rules](note://bbbbbbbb-0000-4000-8000-000000000002)\n');
  assert.equal(report.links, 1);
  assert.equal(read('The plan.md'), '# The plan\nsteps');
  assert.equal(read('TODO.md'), 'second todo at the top');
  assert.ok(fs.existsSync(path.join(dir, 'Tennis Tennis', 'Sub', 'Page one.md')));
  assert.equal(read('.trash', 'Old idea.md'), 'binned');
  assert.equal(fs.readFileSync(linkedFile, 'utf8'), 'agent rules\n', 'linked files are not touched');
  assert.ok(fs.existsSync(path.join(dir, 'Agent files')));
  assert.equal(fs.existsSync(path.join(dir, MOVING_MARKER)), false);

  const todo = store.get('n-todo');
  assert.equal(todo.vaultId, store.homeVault().id);
  assert.equal(todo.title, 'TODO');
  assert.deepEqual(todo.tags, ['work']);
  assert.equal(todo.pinned, true);
  assert.equal(todo.remindAt, Date.UTC(2026, 0, 10));
  assert.equal(todo.updatedAt, Date.UTC(2026, 0, 2));
  assert.equal(Math.round(fs.statSync(todo.filePath).mtimeMs / 1000), Math.round(todo.updatedAt / 1000), 'the file keeps the note\'s modified time');
  const plan = store.get('aaaaaaaa-0000-4000-8000-000000000001');
  assert.equal(plan.title, '');
  assert.deepEqual(plan.sticky, { x: 10, y: 20, w: 300, h: 200, color: 'leaf', onTop: true });
  assert.equal(store.get('n-bin').trashedFrom, path.join(dir, 'Tennis Tennis', 'Old idea.md'));
  assert.equal(store.get('bbbbbbbb-0000-4000-8000-000000000002').filePath, linkedFile);
  assert.equal(store.get('bbbbbbbb-0000-4000-8000-000000000002').folderId, 'f-agent');
  const sub = store.getFolder('f-sub');
  assert.equal(sub.parentId, 'f-tennis');
  assert.equal(sub.book, true);
  assert.deepEqual(sub.pageOrder, ['n-page2', 'n-page1']);
  assert.equal(store.getSettings().lastFolderId, 'f-tennis');
  assert.deepEqual(store.folderTree().map((f) => f.name), ['Agent files', 'Tennis Tennis']);

  const again = new Store(dataDir).load();
  assert.equal(again.homeVault().path, dir);
  assert.deepEqual(again.notes.map((n) => n.id).sort(), store.notes.map((n) => n.id).sort());
  assert.ok(again.notes.every((n) => n.filePath), 'every note is a file now');
  again.restore('n-bin');
  assert.ok(fs.existsSync(path.join(dir, 'Tennis Tennis', 'Old idea.md')));
});

test('a locked app note moves as an .mdlock file with no plaintext, and opens with its password', () => {
  const dataDir = tmpDir('notes-move-lock-');
  const store = new Store(dataDir).load();
  const n = store.create({ title: '', body: 'top secret words' });
  store.lockNote(n.id, 'pw');
  store.relockAll();
  const dir = path.join(tmpDir('notes-move-lockhome-'), 'Notes');
  store.moveIntoHome(dir);
  const files = fs.readdirSync(dir);
  assert.deepEqual(files, ['Locked note.mdlock']);
  assert.ok(!fs.readFileSync(path.join(dir, files[0]), 'utf8').includes('secret'));
  store.unlockNote(n.id, 'pw');
  assert.equal(store.publicNote(store.get(n.id)).body, 'top secret words');
  store.removeLock(n.id, 'pw');
  assert.equal(fs.readFileSync(path.join(dir, 'top secret words.md'), 'utf8'), 'top secret words');
});

test('a failed move leaves no files behind and the library as it was', () => {
  const { store, dataDir } = legacyLibrary();
  const dir = path.join(tmpDir('notes-move-fail-'), 'Notes');
  const before = fs.readFileSync(path.join(dataDir, 'notes.json'), 'utf8');
  const write = fs.writeFileSync;
  let calls = 0;
  fs.writeFileSync = function (file, ...rest) {
    if (String(file).startsWith(dir) && String(file).endsWith('.md') && ++calls === 3) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return write.call(this, file, ...rest);
  };
  try { assert.throws(() => store.moveIntoHome(dir), /disk full/); } finally { fs.writeFileSync = write; }
  assert.equal(store.homeVault(), null);
  assert.ok(store.notes.filter((n) => !n.filePath).length === 6, 'the notes are still app notes');
  assert.deepEqual(fs.readdirSync(dir), [], 'every written file and folder is removed');
  assert.equal(fs.readFileSync(path.join(dataDir, 'notes.json'), 'utf8').length > 0, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'notes.json'), 'utf8')).notes.length, JSON.parse(before).notes.length);
});

test('an unfinished move (crash before the save) is cleaned up and done again in the same folder', () => {
  const { store } = legacyLibrary();
  const dir = path.join(tmpDir('notes-move-crash-'), 'Notes');
  fs.mkdirSync(path.join(dir, 'Tennis Tennis'), { recursive: true });
  const at = Date.UTC(2026, 0, 2);
  const half = path.join(dir, 'Tennis Tennis', 'TODO.md');
  fs.writeFileSync(half, 'half written');
  fs.utimesSync(half, new Date(at), new Date(at));
  fs.writeFileSync(path.join(dir, 'Mine.md'), 'a file the move did not write');
  fs.writeFileSync(path.join(dir, 'Edited since.md'), 'listed, but changed after the crash');
  fs.writeFileSync(path.join(dir, MOVING_MARKER), JSON.stringify({ files: [{ rel: 'Tennis Tennis/TODO.md', at }, { rel: 'Edited since.md', at }, { rel: '../outside.md', at }, 'The plan.md'], dirs: ['Tennis Tennis'] }));
  store.moveIntoHome(dir);
  assert.equal(fs.readFileSync(half, 'utf8'), '---\ntags:\n  - work\n---\n- one\n- see [the plan](../The%20plan.md)\n- and [rules](note://bbbbbbbb-0000-4000-8000-000000000002)\n', 'written again, not as TODO 2');
  assert.ok(!fs.existsSync(path.join(dir, 'Tennis Tennis 2')));
  assert.equal(fs.readFileSync(path.join(dir, 'Mine.md'), 'utf8'), 'a file the move did not write');
  assert.equal(fs.readFileSync(path.join(dir, 'Edited since.md'), 'utf8'), 'listed, but changed after the crash', 'a listed file edited since is kept');
});

test('the move keeps titles Windows cannot hold as file names, and leaves links in code and images alone', () => {
  const dataDir = tmpDir('notes-move-titles-');
  const id = 'cccccccc-0000-4000-8000-000000000003';
  const long = 'A title that goes on for far longer than eighty characters, so the file name has to be cut short: END';
  const notes = [
    { id, title: 'Plan: v2?', body: 'target', tags: [], folderId: null, createdAt: 1, updatedAt: 1 },
    { id: 'dddddddd-0000-4000-8000-000000000004', title: long, body: 'Link [ok](note://' + id + '), code `[c](note://' + id + ')`, image ![i](note://' + id + ')\n```\n[f](note://' + id + ')\n```\n', tags: [], folderId: null, createdAt: 1, updatedAt: 1 },
  ];
  fs.writeFileSync(path.join(dataDir, 'notes.json'), JSON.stringify({ schemaVersion: 2, settings: {}, folders: [], notes, vaults: [] }));
  const store = new Store(dataDir).load();
  const dir = path.join(tmpDir('notes-move-titleshome-'), 'Notes');
  const report = store.moveIntoHome(dir);
  assert.deepEqual(report.renamed, []);
  assert.equal(store.get(id).title, 'Plan: v2?');
  assert.equal(path.basename(store.get(id).filePath), 'Plan v2.md');
  const other = store.get('dddddddd-0000-4000-8000-000000000004');
  assert.equal(other.title, long);
  assert.equal(other.body, 'Link [ok](Plan%20v2.md), code `[c](note://' + id + ')`, image ![i](note://' + id + ')\n```\n[f](note://' + id + ')\n```\n');
  store.update(id, { title: 'Plan: v2?', body: 'target, edited' });
  assert.equal(store.get(id).title, 'Plan: v2?', 'an edit keeps the title');
  assert.equal(path.basename(store.get(id).filePath), 'Plan v2.md');
});

test('moving twice is refused, and new notes after the move are files', () => {
  const { store } = legacyLibrary();
  const dir = path.join(tmpDir('notes-move-twice-'), 'Notes');
  store.moveIntoHome(dir);
  assert.throws(() => store.moveIntoHome(dir), /already/);
  const n = store.create({ body: 'After the move' });
  assert.ok(fs.existsSync(path.join(dir, 'After the move.md')));
  assert.equal(n.folderId, null);
});
