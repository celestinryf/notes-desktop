'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { GitSync } = require('../../src/gitSync.mts');

let gitAvailable = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (_) { gitAvailable = false; }

const { tmpDir } = require('../helpers/tmp');
const tmp = () => tmpDir('notes-git-');
const git = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

test('commits snapshots of notes.json into <data>/history, skips empty commits, keeps the data folder repo-free', { skip: !gitAvailable && 'git not installed' }, async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'notes.json'), '{"v":1}');
  fs.writeFileSync(path.join(dir, 'runtime.json'), '{}');
  const sync = new GitSync(dir, { debounceMs: 10 });
  const status = await sync.configure({ gitEnabled: true, gitRemote: '' });
  assert.equal(status.initialized, true);
  assert.equal(status.repoDir, path.join(dir, 'history'));
  assert.equal(fs.existsSync(path.join(dir, '.git')), false);

  assert.deepEqual(await sync.commit(), { ok: true });
  assert.equal(sync.status().commits, 1);
  assert.deepEqual(await sync.commit(), { ok: true, nothingToCommit: true });
  assert.equal(git(sync.dir, ['ls-files']), 'notes.json', 'only the snapshot is tracked');

  fs.writeFileSync(path.join(dir, 'notes.json'), '{"v":2}');
  sync.noteChanged();
  assert.equal(sync.status().pending, true);
  await sync.flush();
  assert.equal(sync.status().commits, 2);
  assert.equal(sync.status().pending, false);
  assert.ok(sync.status().lastCommitAt);

  const history = await sync.history(10);
  assert.equal(history.length, 2);
  assert.match(history[0].subject, /^notes \d{4}-/);
  const notesAt = async (hashes) => { const out = []; const ok = await sync.eachNotesAt(hashes, (i, text) => { out[i] = text; }); return { ok, out }; };
  assert.deepEqual(await notesAt([history[1].hash, history[0].hash]), { ok: true, out: ['{"v":1}', '{"v":2}'] });
  assert.deepEqual(await notesAt([history[0].hash, 'f'.repeat(40)]), { ok: true, out: ['{"v":2}', null] });
  assert.deepEqual(await notesAt([]), { ok: true, out: [] });
});

test('does nothing while disabled', { skip: !gitAvailable && 'git not installed' }, async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'notes.json'), '{}');
  const sync = new GitSync(dir, { debounceMs: 10 });
  await sync.configure({ gitEnabled: false });
  sync.noteChanged();
  await sync.flush();
  assert.deepEqual(await sync.commit(), { ok: false, skipped: 'disabled' });
  assert.equal(fs.existsSync(path.join(dir, 'history', '.git')), false);
});

test('a read-only notes file does not poison later snapshots', { skip: !gitAvailable && 'git not installed' }, async () => {
  const dir = tmp();
  const file = path.join(dir, 'notes.json');
  fs.writeFileSync(file, '{"v":1}');
  fs.chmodSync(file, 0o444);
  const sync = new GitSync(dir, { debounceMs: 10 });
  await sync.configure({ gitEnabled: true });
  assert.deepEqual(await sync.commit(), { ok: true }, 'snapshot of a read-only source commits');
  fs.chmodSync(file, 0o666);
  fs.writeFileSync(file, '{"v":2}');
  assert.deepEqual(await sync.commit(), { ok: true }, 'second snapshot overwrites the first');
  assert.equal(sync.status().commits, 2);
  assert.equal(sync.status().lastError, null);
});

test('a missing notes file is not an error', { skip: !gitAvailable && 'git not installed' }, async () => {
  const dir = tmp();
  const sync = new GitSync(dir, { debounceMs: 10 });
  await sync.configure({ gitEnabled: true });
  assert.deepEqual(await sync.commit(), { ok: true, nothingToCommit: true });
});

test('pushes to a remote after committing and reports push failures', { skip: !gitAvailable && 'git not installed' }, async () => {
  const dir = tmp();
  const bare = tmp();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  fs.writeFileSync(path.join(dir, 'notes.json'), '{"v":1}');
  const sync = new GitSync(dir, { debounceMs: 10 });
  await sync.configure({ gitEnabled: true, gitRemote: bare });
  assert.equal(git(sync.dir, ['remote', 'get-url', 'origin']), bare);
  assert.deepEqual(await sync.commit(), { ok: true });
  assert.ok(sync.status().lastPushAt, 'pushed after commit');
  assert.equal(git(bare, ['rev-list', '--count', 'main']), '1');

  await sync.configure({ gitEnabled: true, gitRemote: path.join(bare, 'does-not-exist') });
  fs.writeFileSync(path.join(dir, 'notes.json'), '{"v":2}');
  await sync.commit();
  assert.match(sync.status().lastError || '', /push failed/);

  await sync.configure({ gitEnabled: true, gitRemote: '' });
  assert.throws(() => git(sync.dir, ['remote', 'get-url', 'origin']), 'remote removed when cleared');
});
