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

test('trash unpins, restore brings back, destroy removes, emptyTrash clears only trashed', () => {
  const { store } = makeStore();
  const a = store.create({ title: 'a' });
  const b = store.create({ title: 'b' });
  store.togglePin(a.id);
  store.trash(a.id);
  assert.equal(store.get(a.id).pinned, false);
  assert.ok(store.get(a.id).trashedAt);
  store.restore(a.id);
  assert.equal(store.get(a.id).trashedAt, null);
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
