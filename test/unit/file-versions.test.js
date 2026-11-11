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

test('edit saves within two minutes of the last own write keep no new copy, so a burst leaves the copy from before it', () => {
  const { file, versions } = setup();
  const { COALESCE_FILE_COPIES_MS } = require('../../src/file-versions.mts');
  const t0 = Date.now();
  const first = versions.backUpBeforeWrite(file, { coalesceAfterOwnWriteAt: null, now: t0 });
  assert.equal(first.kept, true);
  fs.writeFileSync(file, '%PDF-1.4 v1');
  const written = fs.statSync(file).mtimeMs;
  const burst = versions.backUpBeforeWrite(file, { coalesceAfterOwnWriteAt: written, now: written + 5000 });
  assert.deepEqual(burst, { first: false, name: first.name, kept: false });
  assert.equal(versions.list(file).length, 1);
  const later = versions.backUpBeforeWrite(file, { coalesceAfterOwnWriteAt: written, now: written + COALESCE_FILE_COPIES_MS });
  assert.equal(later.kept, true);
  assert.equal(versions.list(file).length, 2);
});

test('a file last written by something other than Notes always gets a copy, and so does a save with no copy yet', () => {
  const { file, versions } = setup();
  const t0 = Date.now();
  const outsideFirst = versions.backUpBeforeWrite(file, { coalesceAfterOwnWriteAt: t0 - 100, now: t0 });
  assert.equal(outsideFirst.kept, true);
  fs.writeFileSync(file, '%PDF-1.4 outside');
  const written = fs.statSync(file).mtimeMs;
  const outside = versions.backUpBeforeWrite(file, { coalesceAfterOwnWriteAt: written - 60000, now: written + 1000 });
  assert.equal(outside.kept, true);
  assert.equal(versions.list(file).length, 2);
  const plain = versions.backUpBeforeWrite(file);
  assert.equal(plain.kept, true);
  assert.equal(versions.list(file).length, 3);
});
