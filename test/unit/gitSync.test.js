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

test('history of the notes folder survives a nested repository, a stale lock and a case-only rename, and leaves other files out', { skip: !gitAvailable && 'git not installed' }, async () => {
  const dir = tmp();
  const tree = tmpDir('notes-git-tree2-');
  const sync = new GitSync(dir, { debounceMs: 10, workTree: () => tree });
  await sync.configure({ gitEnabled: true, gitRemote: '' });
  for (const nested of ['proj', path.join('sub', 'p 2'), 'p[3]']) {
    fs.mkdirSync(path.join(tree, nested), { recursive: true });
    git(path.join(tree, nested), ['init', '-q']);
    fs.writeFileSync(path.join(tree, nested, 'inside.md'), 'their repo\n');
  }
  fs.writeFileSync(path.join(tree, 'case.md'), 'case one\n');
  fs.writeFileSync(path.join(tree, 'photo.png'), Buffer.alloc(64));
  assert.deepEqual(await sync.commit(), { ok: true });
  assert.equal(git(sync.dir, ['ls-tree', '-r', '--name-only', 'HEAD']), 'case.md', 'the image and the nested repository stay out');
  fs.writeFileSync(path.join(sync.gitDir, 'index.lock'), '');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(sync.gitDir, 'index.lock'), old, old);
  fs.renameSync(path.join(tree, 'case.md'), path.join(tree, 'Case.md'));
  fs.writeFileSync(path.join(tree, 'Case.md'), 'case one\ncase two\n');
  assert.deepEqual(await sync.commit(), { ok: true }, 'a stale index.lock does not block the commit');
  const commits = await sync.fileHistory('Case.md', 10);
  assert.equal(commits.length, 2, 'a case-only rename keeps the history');
});

test('files outside the notes folder keep their history by id at .linked, and a problem with them never blocks the notes folder', { skip: !gitAvailable && 'git not installed' }, async () => {
  const dir = tmp();
  const tree = tmpDir('notes-git-tree3-');
  const outside = tmpDir('notes-git-outside-');
  const at = (id, leaf) => '.linked/' + id.slice(0, 2) + '/' + id + '/' + leaf;
  const files = () => git(dir + '/history', ['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(Boolean).sort();
  const versions = async (sync, id) => { const commits = await sync.linkedHistory(id, 10); const texts = []; await sync.eachFileAt(commits, (i, text) => { texts[i] = text; }); return texts; };
  const A = 'a1111111-aaaa-4aaa-8aaa-111111111111', B = 'b2222222-bbbb-4bbb-8bbb-222222222222', G = 'c3333333-cccc-4ccc-8ccc-333333333333';
  fs.writeFileSync(path.join(tree, 'Home.md'), 'home one\n');
  const agents = path.join(outside, 'AGENTS.md'), memory = path.join(outside, 'memory.md'), big = path.join(outside, 'big.log');
  fs.writeFileSync(agents, '\uFEFFagents one\r\n');
  fs.writeFileSync(memory, 'memory one\n');
  fs.writeFileSync(big, Buffer.alloc(4 * 1024 * 1024 + 1, 0x61));
  let linked = [{ id: A, filePath: agents }, { id: B, filePath: memory }, { id: 'd4444444', filePath: big }, { id: '../escape', filePath: agents }];
  const sync = new GitSync(dir, { debounceMs: 10, workTree: () => tree, linkedFiles: () => linked });
  await sync.configure({ gitEnabled: true, gitRemote: '' });
  assert.deepEqual(await sync.commit(), { ok: true });
  assert.deepEqual(files(), [at(A, 'AGENTS.md'), at(B, 'memory.md'), 'Home.md'], 'readable files by id and name; over 4 MB and unsafe ids stay out');
  assert.deepEqual(await sync.commit(), { ok: true, nothingToCommit: true });

  fs.writeFileSync(agents, '\uFEFFagents two\r\n');
  assert.deepEqual(await sync.commit(), { ok: true }, 'an edit made outside Notes is a new version');
  const renamed = path.join(outside, 'AGENTS renamed.md');
  fs.renameSync(agents, renamed);
  fs.writeFileSync(renamed, 'agents three\n');
  fs.unlinkSync(memory);
  linked = [{ id: A, filePath: renamed }, { id: B, filePath: memory }];
  fs.mkdirSync(path.join(tree, '.linked'));
  fs.writeFileSync(path.join(tree, '.linked', 'own.md'), 'a real folder of that name\n');
  assert.deepEqual(await sync.commit(), { ok: true });
  assert.deepEqual(files(), [at(A, 'AGENTS renamed.md'), 'Home.md'], 'a missing file leaves the tree; a real .linked folder stays out');
  assert.deepEqual(await versions(sync, A), ['agents three\n', '\uFEFFagents two\r\n', '\uFEFFagents one\r\n'], 'history follows the id across a rename, byte for byte');
  assert.deepEqual(await versions(sync, B), ['memory one\n'], 'a removed file keeps its versions');

  const stage = sync._stageLinked;
  sync._stageLinked = async () => ({ ok: false, code: 1, stdout: '', stderr: 'boom', error: 'boom' });
  fs.writeFileSync(path.join(tree, 'Home.md'), 'home two\n');
  assert.deepEqual(await sync.commit(), { ok: true }, 'the notes folder still commits');
  assert.deepEqual(files(), [at(A, 'AGENTS renamed.md'), 'Home.md'], 'linked files keep their last good state');
  assert.match(sync.status().lastError || '', /outside the notes folder.*boom/);
  sync._stageLinked = stage;

  const realStat = fs.promises.stat;
  fs.promises.stat = (p, ...rest) => (p === renamed ? Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' })) : realStat.call(fs.promises, p, ...rest));
  fs.writeFileSync(path.join(tree, 'Home.md'), 'home busy\n');
  try { assert.deepEqual(await sync.commit(), { ok: true }); } finally { fs.promises.stat = realStat; }
  assert.deepEqual(files(), [at(A, 'AGENTS renamed.md'), 'Home.md'], 'a file that cannot be read for now keeps its last version');

  fs.writeFileSync(path.join(outside, '.git'), 'gitdir: elsewhere\n');
  linked = [{ id: G, filePath: path.join(outside, '.git') }];
  fs.writeFileSync(path.join(tree, 'Home.md'), 'home three\n');
  assert.deepEqual(await sync.commit(), { ok: true });
  assert.equal(sync.status().lastError, null, 'the error clears once linked files stage again');
  assert.deepEqual(files(), [at(G, 'file'), 'Home.md'], 'a name git refuses is kept under a plain leaf; unlinked files leave');
  assert.equal((await sync.fileHistory('Home.md', 10)).length, 4, 'the notes folder history is untouched');
  const hashed = await sync._hashFiles([renamed, path.join(outside, 'nope.md'), path.join(outside, '.git')]);
  assert.equal(hashed[1], null, 'a file that cannot be read costs its own slot');
  assert.match(hashed[0] + hashed[2], /^[0-9a-f]{80}$/, 'the rest of the batch is still hashed');
});
