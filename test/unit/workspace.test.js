'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../../src/store');
const W = require('../../src/workspace');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notes-ws-'));

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
