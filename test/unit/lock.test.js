'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../../src/store.mts');
const L = require('../../src/lock.mts');

const { tmpDir } = require('../helpers/tmp');
const tmp = () => tmpDir('notes-lock-'); // removed when the test process exits

test('lock/unlock round-trips, rejects a wrong password, and sanitizes junk', () => {
  const { blob, key } = L.lock('secret body 🔐', 'pw');
  assert.equal(L.unlock(blob, 'pw').body, 'secret body 🔐');
  assert.equal(L.unlock(blob, 'PW'), null);
  assert.equal(L.unlock(Object.assign({}, blob, { ct: blob.ct.slice(0, -4) + 'AAAA' }), 'pw'), null, 'tampered ciphertext is refused');
  const again = L.encrypt('new text', key, blob.salt);
  assert.notEqual(again.iv, blob.iv, 'fresh IV each time');
  assert.equal(L.unlock(again, 'pw').body, 'new text');
  assert.equal(L.sanitizeLock({ salt: 'a' }), null);
  assert.equal(L.sanitizeLock(null), null);
  assert.deepEqual(Object.keys(L.sanitizeLock(blob)).sort(), ['N', 'ct', 'iv', 'kdf', 'salt', 'tag', 'v']);
});

test('a locked note keeps no plaintext on disk; edits while unlocked re-encrypt; relock forgets; file notes cannot be locked', () => {
  const dir = tmp();
  let store = new Store(dir).load();
  const n = store.create({ title: 'Diary', body: 'the secret is pelican' });
  const other = store.create({ title: 'Other', body: 'pelican soup' });
  assert.throws(() => store.lockNote(n.id, ''), /password/i);
  const locked = store.lockNote(n.id, 'hunter2');
  assert.equal(locked.locked, true);
  assert.equal(locked.unlocked, true, 'stays readable in this session right after locking');
  assert.equal(locked.body, 'the secret is pelican');
  const raw = fs.readFileSync(path.join(dir, 'notes.json'), 'utf8');
  assert.ok(!raw.includes('pelican') || raw.indexOf('pelican') === raw.indexOf('pelican soup'), 'only the other note mentions pelican on disk');
  assert.ok(!raw.includes('secret is pelican'), 'plaintext not on disk');
  // Editing while unlocked re-encrypts; still nothing on disk.
  store.update(n.id, { body: 'now about flamingos' });
  assert.equal(store.publicNote(store.get(n.id)).body, 'now about flamingos');
  assert.ok(!fs.readFileSync(path.join(dir, 'notes.json'), 'utf8').includes('flamingos'));
  // Search sees titles, not locked bodies.
  assert.deepEqual(store.list({ query: 'flamingos' }).map((x) => x.title), []);
  assert.deepEqual(store.list({ query: 'pelican' }).map((x) => x.title), ['Other']);
  assert.deepEqual(store.list({ query: 'Diary' }).map((x) => x.title), ['Diary']);
  // Relock: body hidden, edits refused, wrong password refused, right password works.
  store.relock(n.id);
  const view = store.publicNote(store.get(n.id));
  assert.equal(view.unlocked, false);
  assert.equal(view.body, '');
  assert.equal(view.lock, undefined, 'ciphertext is not handed to the renderer');
  assert.throws(() => store.update(n.id, { body: 'x' }), /locked/i);
  assert.throws(() => store.unlockNote(n.id, 'nope'), /wrong password/i);
  assert.equal(store.unlockNote(n.id, 'hunter2').body, 'now about flamingos');
  // Title and tags stay editable even while locked.
  store.relock(n.id);
  store.update(n.id, { title: 'Diary 2026', tags: 'private' });
  assert.equal(store.get(n.id).title, 'Diary 2026');
  // Reload from disk: still locked, still decryptable, remindAt etc. intact.
  store = new Store(dir).load();
  assert.equal(store.publicNote(store.get(n.id)).locked, true);
  assert.equal(store.unlockNote(n.id, 'hunter2').body, 'now about flamingos');
  // Duplicate of an unlocked locked note is itself locked with the same password; refused when relocked.
  const dup = store.duplicate(n.id);
  assert.equal(dup.locked, true);
  assert.equal(store.unlockNote(dup.id, 'hunter2').body, 'now about flamingos');
  store.relockAll();
  assert.throws(() => store.duplicate(n.id), /locked/i);
  assert.throws(() => store.exportNote(n.id), /locked/i);
  // Removing the lock needs the password and writes the body back in clear.
  assert.throws(() => store.removeLock(n.id, 'bad'), /wrong password/i);
  store.removeLock(n.id, 'hunter2');
  assert.equal(store.get(n.id).lock, null);
  assert.equal(store.get(n.id).body, 'now about flamingos');
  assert.ok(fs.readFileSync(path.join(dir, 'notes.json'), 'utf8').includes('flamingos'));
  // File-backed notes cannot be locked (the file would stay in clear anyway).
  const f = path.join(tmp(), 'f.md'); fs.writeFileSync(f, 'file');
  return store.linkFile(f).then((fileNote) => { assert.throws(() => store.lockNote(fileNote.id, 'pw'), /file/i); });
});

test('a save failure while editing an unlocked note rolls the in-memory plaintext back too', () => {
  const store = new Store(tmp()).load();
  const n = store.create({ title: 'L', body: 'v1' });
  store.lockNote(n.id, 'pw');
  const realSave = store.save.bind(store);
  store.save = () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); };
  assert.throws(() => store.update(n.id, { body: 'v2' }), /ENOSPC/);
  assert.equal(store.publicNote(store.get(n.id)).body, 'v1', 'plaintext cache matches what is on disk');
  store.save = realSave;
  store.update(n.id, { body: 'v2' });
  store.relock(n.id);
  assert.equal(store.unlockNote(n.id, 'pw').body, 'v2');
});

test('locked notes: title edits with an empty body are accepted, vault moves are refused, trash and emptyTrash forget the key, duplicate is one write', () => {
  const dir = tmp();
  const store = new Store(dir).load();
  const n = store.create({ title: 'T', body: 'secret' });
  store.lockNote(n.id, 'pw');
  store.relock(n.id);
  // What a locked view sends: title/tags plus an empty body.
  store.update(n.id, { title: 'T2', body: '', tags: 'a' });
  assert.equal(store.get(n.id).title, 'T2');
  assert.equal(store.unlockNote(n.id, 'pw').body, 'secret', 'body untouched by the empty-body patch');
  assert.throws(() => { store.relock(n.id); store.update(n.id, { body: 'x' }); }, /locked/i);
  // Vault move refused for a locked note.
  const vdir = tmp();
  const v = store.addVault({ path: vdir });
  const root = store.vaultRootFolder(v.id);
  assert.throws(() => store.update(n.id, { folderId: root.id }), /locked/i);
  assert.equal(fs.readdirSync(vdir).length, 0, 'nothing written to the vault');
  // Trash forgets the key; emptyTrash too.
  store.unlockNote(n.id, 'pw');
  store.trash(n.id);
  assert.equal(store.publicNote(store.get(n.id)).unlocked, false);
  store.restore(n.id);
  store.unlockNote(n.id, 'pw');
  const dup = store.duplicate(n.id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'notes.json'), 'utf8')).notes.filter((x) => x.title === 'T2 (copy)').length, 1);
  assert.ok(dup.locked && dup.unlocked);
  store.trash(dup.id);
  store.unlockNote(dup.id, 'pw');
  store.emptyTrash();
  assert.equal(store.plain.has(dup.id), false);
});
