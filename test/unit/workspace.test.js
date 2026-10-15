'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../../src/store');
const W = require('../../src/workspace');

const { tmpDir } = require('../helpers/tmp');
const tmp = () => tmpDir('notes-ws-'); // removed when the test process exits

test('exportNotes mirrors plain notes and folders; file-backed and trashed notes are left out', () => {
  const store = new Store(tmp()).load();
  const work = store.createFolder({ name: 'Work' });
  const clients = store.createFolder({ name: 'Clients: A/B', parentId: work.id });
  const a = store.create({ title: 'Plan', body: 'plan body', folderId: work.id });
  const b = store.create({ title: 'Plan', body: 'second plan', folderId: work.id }); // same title -> suffixed file
  const c = store.create({ title: '', body: 'first line as title\nmore', folderId: clients.id });
  const t = store.create({ title: 'gone', body: 'x' }); store.trash(t.id);
  const file = path.join(tmp(), 'ext.md'); fs.writeFileSync(file, 'ext');
  const dir = tmp();
  const manifest = W.exportNotes(store, dir);
  const rels = manifest.files.map((f) => f.rel).sort();
  assert.deepEqual(rels, [path.join('Work', 'Clients AB', 'first line as title.md'), path.join('Work', 'Plan 2.md'), path.join('Work', 'Plan.md')]);
  assert.equal(fs.readFileSync(path.join(dir, 'Work', 'Plan.md'), 'utf8'), 'plan body');
  assert.equal(fs.readFileSync(path.join(dir, 'Work', 'Plan 2.md'), 'utf8'), 'second plan');
  assert.ok(fs.existsSync(path.join(dir, W.MANIFEST)));
  assert.ok(!manifest.files.some((f) => f.id === t.id), 'trashed note not exported');
  assert.equal(manifest.files.find((f) => f.id === a.id).folderId, work.id);
  assert.ok(manifest.files.find((f) => f.id === b.id) && manifest.files.find((f) => f.id === c.id));
});

test('importNotes applies edits, creates notes for new files in the right folder, keeps notes whose files vanished', () => {
  const store = new Store(tmp()).load();
  const work = store.createFolder({ name: 'Work' });
  const a = store.create({ title: 'Plan', body: 'plan body', folderId: work.id });
  const keep = store.create({ title: 'Untouched', body: 'same' });
  const dir = tmp();
  W.exportNotes(store, dir);
  fs.writeFileSync(path.join(dir, 'Work', 'Plan.md'), 'plan body\r\n\r\n- edited by the agent\r\n', 'utf8');
  fs.mkdirSync(path.join(dir, 'Work', 'Sub'));
  fs.writeFileSync(path.join(dir, 'Work', 'Sub', 'Fresh idea.md'), 'new note', 'utf8');
  fs.writeFileSync(path.join(dir, 'notes.json'), '{}', 'utf8'); // not a note file: ignored
  fs.rmSync(path.join(dir, 'Untouched.md'));
  const r = W.importNotes(store, dir);
  assert.equal(r.updated, 1);
  assert.equal(r.created, 1);
  assert.equal(r.missing, 1);
  assert.equal(store.get(a.id).body, 'plan body\n\n- edited by the agent\n', 'CRLF from the agent normalised');
  assert.equal(store.get(keep.id).body, 'same', 'note kept although its file was deleted');
  const fresh = store.notes.find((n) => n.title === 'Fresh idea');
  const sub = store.folders.find((f) => f.name === 'Sub');
  assert.ok(fresh && sub && fresh.folderId === sub.id && sub.parentId === work.id, 'new file became a note in a mirrored folder');
  // A second import with no further changes is a no-op.
  const r2 = W.importNotes(store, dir);
  assert.deepEqual([r2.updated, r2.created], [0, 0]);
});

test('importNotes keeps the person\'s edit on a conflict and saves the agent\'s version beside it; refreshWorkspace imports before it rewrites', () => {
  const store = new Store(tmp()).load();
  const a = store.create({ title: 'Plan', body: 'v1' });
  const dir = tmp();
  W.exportNotes(store, dir);
  // Both sides change: the app saves first (later updatedAt than the export), the agent edits the file.
  store.update(a.id, { body: 'v2 (mine)' });
  fs.writeFileSync(path.join(dir, 'Plan.md'), 'v2 (agent)', 'utf8');
  const r = W.importNotes(store, dir);
  assert.equal(r.conflicts, 1);
  assert.equal(r.updated, 0);
  assert.equal(store.get(a.id).body, 'v2 (mine)', 'my text kept');
  const copy = store.notes.find((n) => n.title === 'Plan (bot)');
  assert.ok(copy && copy.body === 'v2 (agent)', 'agent text saved beside it');
  assert.match(r.details.join('\n'), /conflict: Plan\.md/);
  // Metadata-only changes in the app (pin, tags, folder) are not a conflict: the agent's edit applies.
  const b = store.create({ title: 'Meta', body: 'm1' });
  W.exportNotes(store, dir);
  store.update(b.id, { pinned: true, tags: 'work' });
  fs.writeFileSync(path.join(dir, 'Meta.md'), 'm2 (agent)', 'utf8');
  const r1 = W.importNotes(store, dir);
  assert.equal(r1.conflicts, 0);
  assert.equal(store.get(b.id).body, 'm2 (agent)');
  assert.equal(store.get(b.id).pinned, true);
  // A note trashed mid-run is skipped, not resurrected.
  const t = store.create({ title: 'Doomed', body: 'x' });
  W.exportNotes(store, dir);
  store.trash(t.id);
  fs.writeFileSync(path.join(dir, 'Doomed.md'), 'agent wrote', 'utf8');
  const r2 = W.importNotes(store, dir);
  assert.equal(r2.updated, 0);
  assert.ok(store.get(t.id).trashedAt, 'still trashed');
  assert.match(r2.details.join('\n'), /skipped \(note trashed meanwhile\): Doomed\.md/);
  // refreshWorkspace: edits made in the folder since the last export (a terminal session) survive the rewrite.
  W.exportNotes(store, dir);
  fs.writeFileSync(path.join(dir, 'Plan.md'), 'v3 from terminal', 'utf8');
  fs.writeFileSync(path.join(dir, 'Terminal note.md'), 'typed in a terminal', 'utf8');
  const { imported, manifest } = W.refreshWorkspace(store, dir);
  assert.equal(imported.updated, 1);
  assert.equal(imported.created, 1);
  assert.equal(store.get(a.id).body, 'v3 from terminal');
  assert.ok(store.notes.find((n) => n.title === 'Terminal note'));
  assert.ok(manifest.files.some((f) => f.rel === 'Terminal note.md'), 're-exported with the new note');
  assert.equal(fs.readFileSync(path.join(dir, 'Plan.md'), 'utf8'), 'v3 from terminal');
});

test('refreshWorkspace does not export (and so delete) when the import failed', () => {
  const store = new Store(tmp()).load();
  store.create({ title: 'A', body: 'a' });
  const dir = tmp();
  W.exportNotes(store, dir);
  fs.writeFileSync(path.join(dir, 'A.md'), 'edited in a terminal');
  fs.writeFileSync(path.join(dir, W.MANIFEST), '{ not json');
  const r = W.refreshWorkspace(store, dir);
  assert.equal(r.manifest, null);
  assert.match(r.imported.error, /JSON/i);
  assert.equal(fs.readFileSync(path.join(dir, 'A.md'), 'utf8'), 'edited in a terminal', 'the folder was left alone');
});

test('forgetNote removes a note\'s exported file and manifest entry', () => {
  const store = new Store(tmp()).load();
  const a = store.create({ title: 'Secret', body: 'the secret' });
  const b = store.create({ title: 'Other', body: 'o' });
  const dir = tmp();
  W.exportNotes(store, dir);
  assert.ok(fs.existsSync(path.join(dir, 'Secret.md')));
  assert.equal(W.forgetNote(dir, a.id), true);
  assert.ok(!fs.existsSync(path.join(dir, 'Secret.md')));
  assert.ok(fs.existsSync(path.join(dir, 'Other.md')));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, W.MANIFEST), 'utf8'));
  assert.deepEqual(manifest.files.map((f) => f.id), [b.id]);
  assert.equal(W.forgetNote(dir, a.id), false, 'already gone');
  // A note locked after export is skipped on import rather than copied back in clear.
  W.exportNotes(store, dir);
  store.lockNote(b.id, 'pw');
  fs.writeFileSync(path.join(dir, 'Other.md'), 'agent edit');
  const r = W.importNotes(store, dir);
  assert.equal(r.conflicts, 0);
  assert.match(r.details.join('\n'), /skipped \(note locked meanwhile\)/);
  assert.ok(!store.notes.some((n) => n.title === 'Other (bot)'));
});

test('exportNotes keeps notes apart when two folders differ only by case (one folder on Windows)', () => {
  const store = new Store(tmp()).load();
  const upper = store.createFolder({ name: 'Work' });
  const lower = store.createFolder({ name: 'work' });
  const x = store.create({ title: 'T', body: 'X body', folderId: upper.id });
  const y = store.create({ title: 'T', body: 'Y body', folderId: lower.id });
  const dir = tmp();
  const manifest = W.exportNotes(store, dir);
  const rels = manifest.files.map((f) => f.rel.toLowerCase());
  assert.equal(new Set(rels).size, 2, 'two distinct files: ' + rels.join(', '));
  const r = W.importNotes(store, dir);
  assert.equal(r.updated, 0, 'an import with no edits changes nothing');
  assert.equal(store.get(x.id).body, 'X body');
  assert.equal(store.get(y.id).body, 'Y body');
});

test('manifest paths that point outside the workspace are ignored by import and forgetNote', () => {
  const store = new Store(tmp()).load();
  const a = store.create({ title: 'A', body: 'a body' });
  const dir = tmp();
  W.exportNotes(store, dir);
  const outside = path.join(tmp(), 'victim.txt');
  fs.writeFileSync(outside, 'private');
  const manifestPath = path.join(dir, W.MANIFEST);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const rel = path.relative(dir, outside); // ..\..\victim.txt
  manifest.files.push({ id: a.id, rel, hash: 'nope', folderId: null });
  manifest.files.push({ id: a.id, rel: outside, hash: 'nope', folderId: null }); // absolute
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const r = W.importNotes(store, dir);
  assert.equal(store.get(a.id).body, 'a body', 'nothing read from outside');
  assert.equal(r.details.filter((d) => /outside the workspace/.test(d)).length, 2);
  assert.ok(!store.notes.some((n) => n.body === 'private'));
  W.forgetNote(dir, a.id);
  assert.ok(fs.existsSync(outside), 'file outside the workspace untouched');
});
