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

test('with a notes folder, history commits its files instead of a copy of notes.json, and follows renames', { skip: !gitAvailable && 'git not installed' }, async () => {
  const dir = tmp();
  const tree = tmpDir('notes-git-tree-');
  fs.writeFileSync(path.join(dir, 'notes.json'), '{"notes":[{"id":"a","body":"old"}]}');
  let home = null;
  const sync = new GitSync(dir, { debounceMs: 10, workTree: () => home, beforeSnapshot: () => { throw new Error('a tree commit never compacts the library'); } });
  await sync.configure({ gitEnabled: true, gitRemote: '' });
  sync.beforeSnapshot = () => {};
  assert.deepEqual(await sync.commit(), { ok: true });
  sync.beforeSnapshot = () => { throw new Error('a tree commit never compacts the library'); };
  home = tree;
  fs.mkdirSync(path.join(tree, 'Folder'));
  fs.mkdirSync(path.join(tree, '.trash'));
  const lines = Array.from({ length: 8 }, (_, i) => 'line ' + i + ' of a note long enough for git to see the rename').join('\n') + '\n';
  fs.writeFileSync(path.join(tree, 'Folder', 'Note.md'), 'first\n' + lines);
  fs.writeFileSync(path.join(tree, '.trash', 'Gone.md'), 'binned\n');
  fs.writeFileSync(path.join(tree, 'Write.md.tmp'), 'half written');
  assert.deepEqual(await sync.commit(), { ok: true });
  assert.equal(git(sync.dir, ['ls-tree', '-r', '--name-only', 'HEAD']), 'Folder/Note.md', 'notes.json is gone from the tree; trash and temp files stay out');
  assert.equal(fs.existsSync(path.join(sync.dir, 'notes.json')), false, 'the old snapshot copy is removed');
  fs.renameSync(path.join(tree, 'Folder', 'Note.md'), path.join(tree, 'Renamed.md'));
  fs.writeFileSync(path.join(tree, 'Renamed.md'), 'renamed\n' + lines);
  assert.deepEqual(await sync.commit(), { ok: true });
  const commits = await sync.fileHistory('Renamed.md', 10);
  assert.deepEqual(commits.map((c) => c.path), ['Renamed.md', 'Folder/Note.md']);
  const texts = [];
  await sync.eachFileAt(commits, (i, text) => { texts[i] = text; });
  assert.deepEqual(texts, ['renamed\n' + lines, 'first\n' + lines]);
  assert.equal((await sync.history(10, 'notes.json')).length, 2, 'the snapshot commits stay readable');
  assert.deepEqual(await sync.commit(), { ok: true, nothingToCommit: true });
});
