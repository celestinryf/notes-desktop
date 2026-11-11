'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createFileVersions, KEEP_FILE_VERSIONS } = require('../../src/file-versions.mts');
const { tmpDir } = require('../helpers/tmp');

const setup = (keep) => {
  const dir = tmpDir('notes-file-versions-');
  const file = path.join(dir, 'quiz.pdf');
  fs.writeFileSync(file, '%PDF-1.4 v0');
  return { file, versions: createFileVersions(path.join(dir, 'backups'), keep) };
};

test('backUpBeforeWrite copies the file and reports the first copy of the session', () => {
  const { file, versions } = setup();
  const a = versions.backUpBeforeWrite(file);
  assert.equal(a.first, true);
  assert.equal(path.extname(a.name), '.pdf');
  fs.writeFileSync(file, '%PDF-1.4 v1');
  const b = versions.backUpBeforeWrite(file);
  assert.equal(b.first, false);
  const names = versions.list(file).map((v) => v.name).sort();
  assert.deepEqual(names, [a.name, b.name].sort());
  assert.equal(fs.readFileSync(versions.pathOf(file, a.name), 'utf8'), '%PDF-1.4 v0');
  assert.equal(fs.readFileSync(versions.pathOf(file, b.name), 'utf8'), '%PDF-1.4 v1');
});

test('list is newest first with the size of each copy', () => {
  const { file, versions } = setup();
  const first = versions.backUpBeforeWrite(file).name;
  const dir = versions.dirFor(file);
  const earlier = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(dir, first), earlier, earlier);
  fs.writeFileSync(file, '%PDF-1.4 a longer second version');
  const second = versions.backUpBeforeWrite(file).name;
  const listed = versions.list(file);
  assert.deepEqual(listed.map((v) => v.name), [second, first]);
  assert.equal(listed[0].bytes, '%PDF-1.4 a longer second version'.length);
  assert.ok(listed[0].at > listed[1].at);
});

test('list is empty for a file with no copies, and pathOf rejects unknown or unsafe names', () => {
  const { file, versions } = setup();
  assert.deepEqual(versions.list(file), []);
  for (const bad of ['nope.pdf', '..\\quiz.pdf', '../quiz.pdf', file, '', 42, null, undefined]) assert.equal(versions.pathOf(file, bad), null, String(bad));
  const kept = versions.backUpBeforeWrite(file).name;
  assert.equal(versions.pathOf(file, kept), path.join(versions.dirFor(file), kept));
});

test('a folder inside the copies folder is neither listed nor restorable', () => {
  const { file, versions } = setup();
  versions.backUpBeforeWrite(file);
  fs.mkdirSync(path.join(versions.dirFor(file), 'nested.pdf'));
  assert.equal(versions.list(file).length, 1);
  assert.equal(versions.pathOf(file, 'nested.pdf'), null);
});

test('a copy carries the time the file was last written, not the time of the copy', () => {
  const { file, versions } = setup();
  const written = new Date(Date.now() - 3600000);
  fs.utimesSync(file, written, written);
  const name = versions.backUpBeforeWrite(file).name;
  const [copy] = versions.list(file);
  assert.equal(copy.name, name);
  assert.equal(Math.round(copy.at / 1000), Math.round(written.getTime() / 1000));
});

test('copies written at the same second sort by name, newest stamp first', () => {
  const { file, versions } = setup();
  const same = new Date(Date.now() - 60000);
  fs.utimesSync(file, same, same);
  const a = versions.backUpBeforeWrite(file).name;
  fs.writeFileSync(file, '%PDF-1.4 v1');
  fs.utimesSync(file, same, same);
  const b = versions.backUpBeforeWrite(file).name;
  assert.deepEqual(versions.list(file).map((v) => v.name), [a, b].sort().reverse());
});

test('backing up a file that is gone throws and leaves no copy', () => {
  const { file, versions } = setup();
  fs.rmSync(file);
  assert.throws(() => versions.backUpBeforeWrite(file));
  assert.deepEqual(versions.list(file), []);
});

test('old copies are pruned to the limit, and the session original stays beyond it', () => {
  const { file, versions } = setup(3);
  const original = versions.backUpBeforeWrite(file).name;
  const later = [];
  for (let i = 1; i <= 5; i++) {
    fs.writeFileSync(file, '%PDF-1.4 v' + i);
    later.push(versions.backUpBeforeWrite(file).name);
  }
  const names = fs.readdirSync(versions.dirFor(file)).sort();
  assert.ok(names.includes(original));
  assert.equal(names.length, 4);
  assert.deepEqual(names.filter((n) => n !== original), later.slice(-3));
});

test('a fresh session treats the oldest surviving copy like any other', () => {
  const { file, versions } = setup(2);
  const names = [];
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(file, '%PDF-1.4 v' + i);
    names.push(versions.backUpBeforeWrite(file).name);
  }
  const next = createFileVersions(path.dirname(versions.dirFor(file)), 2);
  fs.writeFileSync(file, '%PDF-1.4 v3');
  const fresh = next.backUpBeforeWrite(file);
  assert.equal(fresh.first, true);
  assert.deepEqual(fs.readdirSync(next.dirFor(file)).sort(), [names[2], fresh.name].sort());
});

test('the default limit keeps thirty copies', () => {
  assert.equal(KEEP_FILE_VERSIONS, 30);
});

test('files with the same name in different folders get separate copies', () => {
  const dir = tmpDir('notes-file-versions-');
  const versions = createFileVersions(path.join(dir, 'backups'));
  const a = path.join(dir, 'one', 'quiz.pdf');
  const b = path.join(dir, 'two', 'quiz.pdf');
  fs.mkdirSync(path.dirname(a)); fs.mkdirSync(path.dirname(b));
  fs.writeFileSync(a, 'A'); fs.writeFileSync(b, 'B');
  versions.backUpBeforeWrite(a);
  assert.equal(versions.list(a).length, 1);
  assert.deepEqual(versions.list(b), []);
  assert.notEqual(versions.dirFor(a), versions.dirFor(b));
});

const saveAt = (versions, file, body, now, coalesce = true) => { const r = versions.backUpBeforeWrite(file, { coalesce, now }); fs.writeFileSync(file, body); versions.noteWritten(file); return r; };

test('edit saves within two minutes of the last copy keep no new copy, so a burst leaves the copy from before it', () => {
  const { file, versions } = setup();
  const { COALESCE_FILE_COPIES_MS } = require('../../src/file-versions.mts');
  const t0 = Date.now();
  const first = saveAt(versions, file, '%PDF-1.4 v1', t0);
  assert.equal(first.kept, true);
  assert.equal(first.first, true);
  const burst = saveAt(versions, file, '%PDF-1.4 v2', t0 + 5000);
  assert.deepEqual(burst, { first: false, name: first.name, kept: false });
  const again = saveAt(versions, file, '%PDF-1.4 v3', t0 + 60000);
  assert.equal(again.kept, false);
  assert.equal(versions.list(file).length, 1);
  const later = saveAt(versions, file, '%PDF-1.4 v4', t0 + COALESCE_FILE_COPIES_MS);
  assert.equal(later.kept, true);
  assert.equal(versions.list(file).length, 2);
  assert.equal(fs.readFileSync(versions.pathOf(file, later.name), 'utf8'), '%PDF-1.4 v3');
});

test('the window counts from the last copy, not from the last save, so saves every minute still give a copy every two minutes', () => {
  const { file, versions } = setup();
  const t0 = Date.now();
  saveAt(versions, file, 'v1', t0);
  for (let i = 1; i <= 6; i++) saveAt(versions, file, 'v' + (i + 1), t0 + i * 60000);
  assert.equal(versions.list(file).length, 4);
});

test('a file written by something other than Notes since its last save always gets a copy', () => {
  const { file, versions } = setup();
  const t0 = Date.now();
  saveAt(versions, file, 'v1', t0);
  fs.writeFileSync(file, 'outside');
  const outsideAt = new Date(fs.statSync(file).mtimeMs + 5000);
  fs.utimesSync(file, outsideAt, outsideAt);
  const r = saveAt(versions, file, 'v2', t0 + 10000);
  assert.equal(r.kept, true);
  assert.equal(fs.readFileSync(versions.pathOf(file, r.name), 'utf8'), 'outside');
});

test('the first save of a session always keeps a copy, even right after an earlier session wrote the file', () => {
  const { file, versions } = setup();
  const { createFileVersions } = require('../../src/file-versions.mts');
  const root = path.dirname(versions.dirFor(file));
  const t0 = Date.now();
  saveAt(versions, file, 'v1', t0);
  const fresh = createFileVersions(root);
  const r = saveAt(fresh, file, 'v2', t0 + 1000);
  assert.equal(r.kept, true);
  assert.equal(r.first, true);
  assert.equal(fresh.list(file).length, 2);
});

test('a save that does not ask to coalesce always keeps a copy, as page turns and restores do', () => {
  const { file, versions } = setup();
  const t0 = Date.now();
  saveAt(versions, file, 'v1', t0);
  const turn = saveAt(versions, file, 'v2', t0 + 1000, false);
  assert.equal(turn.kept, true);
  assert.equal(versions.list(file).length, 2);
  assert.equal(fs.readFileSync(versions.pathOf(file, turn.name), 'utf8'), 'v1');
});
