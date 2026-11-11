'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { gitBinary } = require('../../src/git-binary.mts');
const { run } = require('../../src/git-run.mts');
const { SelfUpdater, describe, parseResult, shortSha, RESULT_FILE, JOB_FILE } = require('../../src/self-update.mts');
const { sanitizeSettings } = require('../../src/store.mts');
const { tmpDir, cleanup } = require('../helpers/tmp');

const git = gitBinary();
const AUTHOR = ['-c', 'user.name=t', '-c', 'user.email=t@x', '-c', 'commit.gpgsign=false'];
function sh(args, cwd) { return execFileSync(git.file, AUTHOR.concat(args), { cwd, env: git.env, encoding: 'utf8', windowsHide: true }).trim(); }

function commitIn(repo, name, text, message) {
  fs.writeFileSync(path.join(repo, name), text);
  sh(['add', name], repo);
  sh(['commit', '-q', '-m', message || name], repo);
  return sh(['rev-parse', 'HEAD'], repo);
}

function makeRepos() {
  const base = tmpDir('notes-selfupdate-');
  const upstream = path.join(base, 'upstream');
  const checkout = path.join(base, 'checkout');
  fs.mkdirSync(upstream);
  sh(['init', '-q', '-b', 'main'], upstream);
  const first = commitIn(upstream, 'package-lock.json', '{"v":1}', 'first');
  sh(['clone', '-q', upstream, checkout], base);
  const dataDir = path.join(base, 'data');
  fs.mkdirSync(dataDir);
  return { base, upstream, checkout, dataDir, first };
}

function updater(repos, extra) {
  return new SelfUpdater(Object.assign({ root: repos.checkout, dataDir: repos.dataDir, git: run }, extra || {}));
}

test.after(cleanup);

test('check reports current when the checkout matches origin/main', async () => {
  const repos = makeRepos();
  const res = await updater(repos).check();
  assert.deepEqual(res, { state: 'current', head: repos.first });
});

test('check reports behind with the commit count, and whether the lock file changed', async () => {
  const repos = makeRepos();
  commitIn(repos.upstream, 'a.txt', 'a');
  const target = commitIn(repos.upstream, 'b.txt', 'b');
  const res = await updater(repos).check();
  assert.equal(res.state, 'behind');
  assert.equal(res.head, repos.first);
  assert.equal(res.target, target);
  assert.equal(res.behind, 2);
  assert.equal(res.lockChanged, false);

  const withLock = commitIn(repos.upstream, 'package-lock.json', '{"v":2}', 'deps');
  const again = await updater(repos).check();
  assert.equal(again.state, 'behind');
  assert.equal(again.target, withLock);
  assert.equal(again.behind, 3);
  assert.equal(again.lockChanged, true);
});

test('check refuses a checkout with local commits or uncommitted changes to tracked files', async () => {
  const repos = makeRepos();
  commitIn(repos.upstream, 'a.txt', 'a');
  fs.writeFileSync(path.join(repos.checkout, 'package-lock.json'), '{"v":"edited"}');
  fs.writeFileSync(path.join(repos.checkout, 'untracked.txt'), 'ignored by the check');
  const dirty = await updater(repos).check();
  assert.equal(dirty.state, 'dirty');
  assert.deepEqual(dirty.files, ['package-lock.json']);

  sh(['checkout', '-q', '--', 'package-lock.json'], repos.checkout);
  const local = commitIn(repos.checkout, 'mine.txt', 'mine');
  const diverged = await updater(repos).check();
  assert.equal(diverged.state, 'diverged');
  assert.equal(diverged.head, local);
});

test('check reports an error without a repository or without a reachable origin', async () => {
  const plain = tmpDir('notes-selfupdate-plain-');
  const noRepo = await new SelfUpdater({ root: plain, dataDir: plain, git: run }).check();
  assert.equal(noRepo.state, 'error');
  assert.match(noRepo.error, /git checkout/);

  const repos = makeRepos();
  fs.rmSync(repos.upstream, { recursive: true, force: true });
  const gone = await updater(repos).check();
  assert.equal(gone.state, 'error');
  assert.match(gone.error, /fetch failed/);
});

test('check runs git in the checkout, never anywhere else', async () => {
  const repos = makeRepos();
  const cwds = new Set();
  const spy = (args, cwd, timeoutMs) => { cwds.add(cwd); return run(args, cwd, timeoutMs); };
  await updater(repos, { git: spy }).check();
  assert.deepEqual(Array.from(cwds), [repos.checkout]);
});

test('lastResult, failedFor and markNoticed read and update the result file', () => {
  const repos = makeRepos();
  const u = updater(repos);
  assert.equal(u.lastResult(), null);
  assert.equal(u.failedFor('abc'), false);
  fs.writeFileSync(path.join(repos.dataDir, RESULT_FILE), 'not json');
  assert.equal(u.lastResult(), null);
  fs.writeFileSync(path.join(repos.dataDir, RESULT_FILE), JSON.stringify({ at: 5, from: 'a', to: 'abc', ok: false, error: 'pull failed' }));
  assert.deepEqual(u.lastResult(), { at: 5, from: 'a', to: 'abc', ok: false, error: 'pull failed', installed: false, noticed: false });
  assert.equal(u.failedFor('abc'), true);
  assert.equal(u.failedFor('other'), false);
  u.markNoticed();
  assert.equal(u.lastResult().noticed, true);
  fs.writeFileSync(path.join(repos.dataDir, RESULT_FILE), JSON.stringify({ at: 6, from: 'a', to: 'abc', ok: true, error: null, installed: true }));
  assert.equal(u.failedFor('abc'), false, 'a success for the same target is not a failure');
});

test('parseResult rejects malformed results', () => {
  assert.equal(parseResult('[]'), null);
  assert.equal(parseResult('{"at":"x","from":"a","to":"b","ok":true}'), null);
  assert.equal(parseResult('{"at":1,"from":"a","to":"b"}'), null);
  assert.deepEqual(parseResult('{"at":1,"from":"a","to":"b","ok":true,"error":7,"installed":"yes","noticed":true}'), { at: 1, from: 'a', to: 'b', ok: true, error: null, installed: false, noticed: true });
});

test('launchHelper writes the job and starts the helper detached with node, without ELECTRON_RUN_AS_NODE', () => {
  const repos = makeRepos();
  const spawned = [];
  let unrefs = 0;
  const spawn = (file, args, opts) => { spawned.push({ file, args, opts }); return { unref() { unrefs++; } }; };
  const u = updater(repos, { spawn, helperScript: 'C:/helper.js' });
  const check = { state: 'behind', head: 'aaa', target: 'bbb', behind: 1, lockChanged: false };
  const relaunch = { exe: 'electron.exe', args: ['root', '--hidden'], cwd: 'root', env: { PATH: 'p', ELECTRON_RUN_AS_NODE: '1', NUM: 3 } };
  const tools = { node: 'node.exe', npm: { file: 'node.exe', args: ['npm-cli.js'] }, git: { file: 'git.exe', env: { GIT_EXEC_PATH: 'g', ELECTRON_RUN_AS_NODE: '1' } } };
  assert.deepEqual(u.launchHelper(check, relaunch, tools), { ok: true });
  assert.equal(unrefs, 1);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].file, 'node.exe');
  assert.deepEqual(spawned[0].args, ['C:/helper.js', path.join(repos.dataDir, JOB_FILE)]);
  assert.deepEqual(spawned[0].opts, { cwd: repos.checkout, env: { PATH: 'p' } });
  const job = JSON.parse(fs.readFileSync(path.join(repos.dataDir, JOB_FILE), 'utf8'));
  assert.equal(job.pid, process.pid);
  assert.equal(job.root, repos.checkout);
  assert.equal(job.from, 'aaa');
  assert.equal(job.target, 'bbb');
  assert.deepEqual(job.git, { file: 'git.exe', env: { GIT_EXEC_PATH: 'g' } });
  assert.equal(job.npm, null, 'npm is not needed when the lock file did not change');
  assert.deepEqual(job.args, ['root', '--hidden']);

  const withLock = u.launchHelper({ ...check, lockChanged: true }, relaunch, tools);
  assert.deepEqual(withLock, { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(repos.dataDir, JOB_FILE), 'utf8')).npm, { file: 'node.exe', args: ['npm-cli.js'] });
});

test('launchHelper refuses without node, and without npm when the packages changed', () => {
  const repos = makeRepos();
  let spawned = 0;
  const u = updater(repos, { spawn: () => { spawned++; return { unref() {} }; } });
  const relaunch = { exe: 'e', args: [], cwd: 'c', env: {} };
  const gitTool = { file: 'git', env: {} };
  const check = { state: 'behind', head: 'a', target: 'b', behind: 1, lockChanged: true };
  assert.match(u.launchHelper(check, relaunch, { node: null, npm: null, git: gitTool }).error, /node/);
  assert.match(u.launchHelper(check, relaunch, { node: 'node', npm: null, git: gitTool }).error, /npm/);
  assert.equal(spawned, 0);
  assert.equal(u.launchHelper({ ...check, lockChanged: false }, relaunch, { node: 'node', npm: null, git: gitTool }).ok, true);
  assert.equal(spawned, 1);
});

test('launchHelper reports a spawn failure instead of throwing', () => {
  const repos = makeRepos();
  const u = updater(repos, { spawn: () => { throw new Error('ENOENT node'); } });
  const res = u.launchHelper({ state: 'behind', head: 'a', target: 'b', behind: 1, lockChanged: false }, { exe: 'e', args: [], cwd: 'c', env: {} }, { node: 'node', npm: null, git: { file: 'git', env: {} } });
  assert.deepEqual(res, { ok: false, error: 'ENOENT node' });
});

test('describe puts every state into one plain sentence', () => {
  assert.equal(describe({ state: 'current', head: '0123456789' }, false), 'Notes is up to date (0123456).');
  assert.equal(describe({ state: 'behind', head: 'a', target: 'bcdefgh123', behind: 1, lockChanged: false }, false), 'Notes has an update: 1 change behind main. It restarts on its own while hidden.');
  assert.match(describe({ state: 'behind', head: 'a', target: 'b', behind: 3, lockChanged: false }, false), /3 changes behind/);
  assert.match(describe({ state: 'behind', head: 'a', target: 'bcdefgh123', behind: 3, lockChanged: false }, true), /update to bcdefgh failed last time/);
  assert.match(describe({ state: 'diverged', head: 'a', target: 'b' }, false), /its own commits/);
  assert.equal(describe({ state: 'dirty', head: 'a', target: 'b', files: ['x', 'y', 'z', 'w'] }, false), 'Notes was not updated: the checkout has unsaved changes (x, y, z, …).');
  assert.equal(describe({ state: 'error', error: 'fetch failed: offline' }, false), 'Could not check for updates: fetch failed: offline');
  assert.equal(shortSha('abcdefghijk'), 'abcdefg');
});

test('the autoUpdate setting defaults on and takes only a boolean', () => {
  assert.equal(sanitizeSettings({}).autoUpdate, true);
  assert.equal(sanitizeSettings({ autoUpdate: false }).autoUpdate, false);
  assert.equal(sanitizeSettings({ autoUpdate: 0 }).autoUpdate, false);
  assert.equal(sanitizeSettings({ autoUpdate: 'yes' }).autoUpdate, true);
});
