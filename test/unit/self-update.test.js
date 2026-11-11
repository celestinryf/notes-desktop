'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { run } = require('../../src/git-run.mts');
const { SelfUpdater, describe, parseResult, shortSha, cleanEnv, gitDirOf, inProgressOperation, RESULT_FILE, JOB_FILE, FAILURE_BACKOFF_MS } = require('../../src/self-update.mts');
const { sanitizeSettings } = require('../../src/store.mts');
const { sh, commitIn, makeRepos } = require('../helpers/git-repos');
const { tmpDir, cleanup } = require('../helpers/tmp');

const repos = () => makeRepos('notes-selfupdate-');
function updater(r, extra) {
  return new SelfUpdater(Object.assign({ root: r.checkout, dataDir: r.dataDir, git: run }, extra || {}));
}
const AUTO = { failed: false, auto: true };
const writeResult = (r, fields) => fs.writeFileSync(path.join(r.dataDir, RESULT_FILE), JSON.stringify(fields));

test.after(cleanup);

test('check reports current when the checkout matches origin/main', async () => {
  const r = repos();
  assert.deepEqual(await updater(r).check(), { state: 'current', head: r.first });
});

test('check reports behind with the commit count, and whether the lock file changed', async () => {
  const r = repos();
  commitIn(r.upstream, 'a.txt', 'a');
  const target = commitIn(r.upstream, 'b.txt', 'b');
  assert.deepEqual(await updater(r).check(), { state: 'behind', running: r.first, target, behind: 2, lockChanged: false });
  const withLock = commitIn(r.upstream, 'package-lock.json', '{"v":2}', 'deps');
  assert.deepEqual(await updater(r).check(), { state: 'behind', running: r.first, target: withLock, behind: 3, lockChanged: true });
});

test('check compares origin/main with the commit Notes is running, not with a checkout pulled underneath it', async () => {
  const r = repos();
  const u = updater(r);
  await u.rememberRunning();
  const target = commitIn(r.upstream, 'package-lock.json', '{"v":2}', 'deps');
  sh(['pull', '-q', '--ff-only', 'origin', 'main'], r.checkout);
  assert.deepEqual(await u.check(), { state: 'behind', running: r.first, target, behind: 1, lockChanged: true });
  assert.deepEqual(await updater(r).check(), { state: 'current', head: target }, 'a Notes started on the pulled checkout is current');
});

test('check refuses a checkout with local commits or uncommitted changes to tracked files', async () => {
  const r = repos();
  commitIn(r.upstream, 'a.txt', 'a');
  fs.writeFileSync(path.join(r.checkout, 'package-lock.json'), '{"v":"edited"}');
  fs.writeFileSync(path.join(r.checkout, 'untracked.txt'), 'ignored by the check');
  const dirty = await updater(r).check();
  assert.equal(dirty.state, 'dirty');
  assert.deepEqual(dirty.files, ['package-lock.json']);
  sh(['checkout', '-q', '--', 'package-lock.json'], r.checkout);
  const local = commitIn(r.checkout, 'mine.txt', 'mine');
  assert.deepEqual(await updater(r).check(), { state: 'diverged', head: local, target: sh(['rev-parse', 'origin/main'], r.checkout) });
});

test('check refuses another branch, a detached head and a git operation in progress', async () => {
  const r = repos();
  commitIn(r.upstream, 'a.txt', 'a');
  sh(['checkout', '-q', '-b', 'feature/x'], r.checkout);
  assert.match((await updater(r).check()).error, /not on main \(feature\/x\)/);
  sh(['checkout', '-q', '--detach'], r.checkout);
  assert.match((await updater(r).check()).error, /not on main/);
  sh(['checkout', '-q', 'main'], r.checkout);
  const lock = path.join(r.checkout, '.git', 'index.lock');
  fs.writeFileSync(lock, '');
  assert.match((await updater(r).check()).error, /in progress \(index\.lock\)/);
  fs.unlinkSync(lock);
  assert.equal((await updater(r).check()).state, 'behind');
});

test('gitDirOf follows a worktree .git file, and inProgressOperation names the marker', () => {
  const r = repos();
  const wt = path.join(r.base, 'wt');
  sh(['worktree', 'add', '-q', wt, '-b', 'wt-branch'], r.checkout);
  const dir = gitDirOf(wt);
  assert.ok(dir && fs.statSync(dir).isDirectory());
  assert.equal(inProgressOperation(dir), null);
  fs.writeFileSync(path.join(dir, 'MERGE_HEAD'), '');
  assert.equal(inProgressOperation(dir), 'MERGE_HEAD');
  assert.equal(gitDirOf(tmpDir('notes-nogit-')), null);
});

test('check reports an error without a repository or without a reachable origin', async () => {
  const plain = tmpDir('notes-selfupdate-plain-');
  assert.match((await new SelfUpdater({ root: plain, dataDir: plain, git: run }).check()).error, /git checkout/);
  const r = repos();
  fs.rmSync(r.upstream, { recursive: true, force: true });
  assert.match((await updater(r).check()).error, /fetch failed/);
});

test('check runs git in the checkout only, and fetches without a credential prompt', async () => {
  const r = repos();
  const calls = [];
  const spy = (args, cwd, timeoutMs, input, env) => { calls.push({ args, cwd, env }); return run(args, cwd, timeoutMs, input, env); };
  await updater(r, { git: spy }).check();
  assert.deepEqual(Array.from(new Set(calls.map((c) => c.cwd))), [r.checkout]);
  assert.deepEqual(calls.find((c) => c.args[0] === 'fetch').env, { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' });
});

test('lastResult caches by the file time, and failedFor and markNoticed read and update it', () => {
  const r = repos();
  const u = updater(r);
  assert.equal(u.lastResult(), null);
  fs.writeFileSync(path.join(r.dataDir, RESULT_FILE), 'not json');
  assert.equal(u.lastResult(), null);
  writeResult(r, { at: 5, from: 'a', target: 'abc', to: 'a', ok: false, error: 'npm install failed' });
  assert.deepEqual(u.lastResult(), { at: 5, from: 'a', target: 'abc', to: 'a', ok: false, error: 'npm install failed', transient: false, installed: false, noticed: false });
  assert.equal(u.lastResult(), u.lastResult(), 'the same object while the file is unchanged');
  assert.equal(u.failedFor('abc'), true, 'a rolled-back failure still names the target it attempted');
  assert.equal(u.failedFor('a'), false);
  u.markNoticed();
  assert.equal(u.lastResult().noticed, true);
  writeResult(r, { at: 6, from: 'a', target: 'abc', to: 'a', ok: false, error: 'index.lock', transient: true });
  assert.equal(u.failedFor('abc'), false, 'a transient failure may be retried');
  writeResult(r, { at: 7, from: 'a', to: 'abc', ok: true, error: null, installed: true });
  assert.equal(u.failedFor('abc'), false, 'a success for the same target is not a failure');
  fs.unlinkSync(path.join(r.dataDir, RESULT_FILE));
  assert.equal(u.lastResult(), null, 'a removed file clears the cache');
});

test('holdOff keeps a permanent failure for its target, and any failure for half an hour', () => {
  const r = repos();
  const u = updater(r);
  const at = 1000000;
  assert.equal(u.holdOff('b', at), null);
  writeResult(r, { at, from: 'a', target: 'b', to: 'a', ok: false, error: 'npm install failed' });
  assert.match(u.holdOff('b', at + FAILURE_BACKOFF_MS * 10), /retried by hand/);
  assert.match(u.holdOff('c', at + 1000), /less than half an hour/);
  assert.equal(u.holdOff('c', at + FAILURE_BACKOFF_MS), null);
  writeResult(r, { at, from: 'a', target: 'b', to: 'a', ok: false, error: 'Permission denied', transient: true });
  assert.match(u.holdOff('b', at + FAILURE_BACKOFF_MS - 1), /less than half an hour/);
  assert.equal(u.holdOff('b', at + FAILURE_BACKOFF_MS), null);
  writeResult(r, { at, from: 'a', target: 'b', to: 'b', ok: true, error: null });
  assert.equal(u.holdOff('b', at + 1000), null);
});

test('parseResult rejects malformed results and falls back to "to" for an old result without a target', () => {
  assert.equal(parseResult('[]'), null);
  assert.equal(parseResult('{"at":"x","from":"a","to":"b","ok":true}'), null);
  assert.equal(parseResult('{"at":1,"from":"a","to":"b"}'), null);
  assert.deepEqual(parseResult('{"at":1,"from":"a","to":"b","ok":true,"error":7,"installed":"yes","noticed":true}'), { at: 1, from: 'a', target: 'b', to: 'b', ok: true, error: null, transient: false, installed: false, noticed: true });
});

test('launchHelper writes the job and starts the helper detached with node, without ELECTRON_RUN_AS_NODE', () => {
  const r = repos();
  const spawned = [];
  let unrefs = 0;
  const spawn = (file, args, opts) => { spawned.push({ file, args, opts }); return { unref() { unrefs++; } }; };
  const u = updater(r, { spawn, helperScript: 'C:/helper.js' });
  const check = { running: 'aaa', target: 'bbb', lockChanged: false };
  const relaunch = { exe: 'electron.exe', args: ['root', '--hidden'], env: { PATH: 'p', electron_run_as_node: '1', NUM: 3 } };
  const tools = { node: 'node.exe', npm: { file: 'node.exe', args: ['npm-cli.js'] }, git: { file: 'git.exe', env: { GIT_EXEC_PATH: 'g', ELECTRON_RUN_AS_NODE: '1' } } };
  assert.deepEqual(u.launchHelper(check, relaunch, tools), { ok: true });
  assert.equal(unrefs, 1);
  assert.deepEqual(spawned, [{ file: 'node.exe', args: ['C:/helper.js', path.join(r.dataDir, JOB_FILE)], opts: { cwd: r.checkout, env: { PATH: 'p' } } }]);
  const job = JSON.parse(fs.readFileSync(path.join(r.dataDir, JOB_FILE), 'utf8'));
  assert.deepEqual(job, {
    pid: process.pid, root: r.checkout, dataDir: r.dataDir, from: 'aaa', target: 'bbb',
    git: { file: 'git.exe', env: { GIT_EXEC_PATH: 'g', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } },
    npm: { file: 'node.exe', args: ['npm-cli.js'] }, exe: 'electron.exe', args: ['root', '--hidden'],
  });
});

test('launchHelper refuses without node, and without npm when the packages changed', () => {
  const r = repos();
  let spawned = 0;
  const u = updater(r, { spawn: () => { spawned++; return { unref() {} }; } });
  const relaunch = { exe: 'e', args: [], env: {} };
  const gitTool = { file: 'git', env: {} };
  const check = { running: 'a', target: 'b', lockChanged: true };
  assert.match(u.launchHelper(check, relaunch, { node: null, npm: null, git: gitTool }).error, /node/);
  assert.match(u.launchHelper(check, relaunch, { node: 'node', npm: null, git: gitTool }).error, /npm/);
  assert.equal(spawned, 0);
  assert.equal(u.launchHelper({ ...check, lockChanged: false }, relaunch, { node: 'node', npm: null, git: gitTool }).ok, true);
  assert.equal(spawned, 1);
});

test('launchHelper reports a spawn failure instead of throwing', () => {
  const r = repos();
  const u = updater(r, { spawn: () => { throw new Error('ENOENT node'); } });
  assert.deepEqual(u.launchHelper({ running: 'a', target: 'b', lockChanged: false }, { exe: 'e', args: [], env: {} }, { node: 'node', npm: null, git: { file: 'git', env: {} } }), { ok: false, error: 'ENOENT node' });
});

test('cleanEnv keeps only strings and drops ELECTRON_RUN_AS_NODE in any case', () => {
  assert.deepEqual(cleanEnv({ A: 'a', B: undefined, Electron_Run_As_Node: '1', C: '' }), { A: 'a', C: '' });
});

test('describe puts every state into one plain sentence', () => {
  assert.equal(describe({ state: 'current', head: '0123456789' }, AUTO), 'Notes is up to date (0123456).');
  assert.equal(describe({ state: 'behind', running: 'a', target: 'bcdefgh123', behind: 1, lockChanged: false }, AUTO), 'Notes has an update: 1 change behind main. It restarts on its own while hidden.');
  assert.equal(describe({ state: 'behind', running: 'a', target: 'b', behind: 3, lockChanged: false }, { failed: false, auto: false }), 'Notes has an update: 3 changes behind main. Restart when you are ready.');
  assert.match(describe({ state: 'behind', running: 'a', target: 'bcdefgh123', behind: 3, lockChanged: false }, { failed: true, auto: true }), /update to bcdefgh failed last time\. Retry it from the command palette/);
  assert.match(describe({ state: 'diverged', head: 'a', target: 'b' }, AUTO), /its own commits/);
  assert.equal(describe({ state: 'dirty', head: 'a', target: 'b', files: ['x', 'y', 'z', 'w'] }, AUTO), 'Notes was not updated: the checkout has unsaved changes (x, y, z, …).');
  assert.equal(describe({ state: 'error', error: 'fetch failed: offline' }, AUTO), 'Could not check for updates: fetch failed: offline');
  assert.equal(shortSha('abcdefghijk'), 'abcdefg');
});

test('the autoUpdate setting defaults on and takes only a boolean', () => {
  assert.equal(sanitizeSettings({}).autoUpdate, true);
  assert.equal(sanitizeSettings({ autoUpdate: false }).autoUpdate, false);
  assert.equal(sanitizeSettings({ autoUpdate: 0 }).autoUpdate, false);
  assert.equal(sanitizeSettings({ autoUpdate: 'yes' }).autoUpdate, true);
});
