'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { gitBinary } = require('../../src/git-binary.mts');
const { tmpDir, cleanup } = require('../helpers/tmp');

const HELPER = path.join(__dirname, '..', '..', 'scripts', 'finish-update.js');
const { update, waitForExit, readJob, npmEnv, isLockError } = require(HELPER);

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
  const base = tmpDir('notes-finishupdate-');
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
function gitEnv() {
  const env = {};
  for (const [k, v] of Object.entries(git.env)) if (typeof v === 'string') env[k] = v;
  return env;
}
function fakeNpm(dir, { fail } = {}) {
  const log = path.join(dir, 'npm-calls.txt');
  const script = path.join(dir, 'npm.js');
  fs.writeFileSync(script, 'require("fs").appendFileSync(' + JSON.stringify(log) + ', process.argv.slice(2).join(" ") + "|" + (process.env.NODE_ENV || "") + "\\n"); if (' + (fail ? 'true' : 'false') + ') { console.error("npm ERR! boom"); process.exit(1); }');
  return { npm: { file: process.execPath, args: [script] }, calls: () => { try { return fs.readFileSync(log, 'utf8').trim().split('\n'); } catch (_) { return []; } } };
}
function job(repos, extra) {
  return Object.assign({ pid: process.pid, root: repos.checkout, dataDir: repos.dataDir, from: repos.first, target: 'x', git: { file: git.file, env: gitEnv() }, npm: null, exe: process.execPath, args: [], cwd: repos.checkout }, extra || {});
}
const quiet = () => {};
const logOf = (repos) => { try { return fs.readFileSync(path.join(repos.dataDir, 'self-update.log'), 'utf8'); } catch (_) { return ''; } };
const INSTALL = 'install --no-audit --no-fund --no-progress --loglevel=error|';
const fastEnv = () => Object.assign({}, process.env, { NOTES_UPDATE_EXIT_WAIT_MS: '300', NOTES_UPDATE_SETTLE_MS: '50', NOTES_UPDATE_LOCK_RETRY_MS: '50' });

test.after(cleanup);

test('update fast-forwards the checkout when the packages did not change', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'a.txt', 'a');
  const res = await update(job(repos, { target }), quiet);
  assert.deepEqual(res, { at: res.at, from: repos.first, target, to: target, ok: true, error: null, transient: false, installed: false, noticed: false });
  assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), target);
});

test('update runs npm install when the lock file changed, with NODE_ENV and npm_config_* cleared', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'package-lock.json', '{"v":2}', 'deps');
  const npm = fakeNpm(repos.base);
  process.env.NODE_ENV = 'production';
  try {
    const res = await update(job(repos, { target, npm: npm.npm }), quiet);
    assert.equal(res.ok, true);
    assert.equal(res.installed, true);
    assert.equal(res.to, target);
    assert.deepEqual(npm.calls(), [INSTALL]);
  } finally { delete process.env.NODE_ENV; }
});

test('update installs when the checkout was already pulled by someone else but Notes ran an older lock file', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'package-lock.json', '{"v":2}', 'deps');
  sh(['pull', '-q', '--ff-only', 'origin', 'main'], repos.checkout);
  const npm = fakeNpm(repos.base);
  const res = await update(job(repos, { target, npm: npm.npm }), quiet);
  assert.equal(res.ok, true);
  assert.equal(res.installed, true);
  assert.deepEqual(npm.calls(), [INSTALL]);
});

test('update rolls the checkout back and restores the packages when npm install fails, naming the target it attempted', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'package-lock.json', '{"v":2}', 'deps');
  const npm = fakeNpm(repos.base, { fail: true });
  const lines = [];
  const res = await update(job(repos, { target, npm: npm.npm }), (l) => lines.push(l));
  assert.equal(res.ok, false);
  assert.equal(res.transient, false);
  assert.match(res.error, /npm install failed: npm ERR! boom/);
  assert.equal(res.target, target);
  assert.equal(res.to, repos.first);
  assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), repos.first);
  assert.equal(fs.readFileSync(path.join(repos.checkout, 'package-lock.json'), 'utf8'), '{"v":1}');
  assert.equal(npm.calls().length, 2, 'install for the update, then install to restore the old packages');
  assert.ok(lines.some((l) => /rolled the checkout back/.test(l)), lines.join('\n'));
  const { SelfUpdater } = require('../../src/self-update.mts');
  fs.writeFileSync(path.join(repos.dataDir, 'self-update.json'), JSON.stringify(res));
  assert.equal(new SelfUpdater({ root: repos.checkout, dataDir: repos.dataDir, git: () => {} }).failedFor(target), true, 'the target is not retried on its own');
});

test('update refuses a package change without npm and rolls back', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'package-lock.json', '{"v":2}', 'deps');
  const res = await update(job(repos, { target, npm: null }), quiet);
  assert.equal(res.ok, false);
  assert.match(res.error, /npm is not available/);
  assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), repos.first);
});

test('update refuses a checkout that became dirty since the check, and leaves the edit alone', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'a.txt', 'a');
  fs.writeFileSync(path.join(repos.checkout, 'package-lock.json'), '{"v":"mine"}');
  const res = await update(job(repos, { target }), quiet);
  assert.equal(res.ok, false);
  assert.match(res.error, /unsaved changes: .*package-lock\.json/);
  assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), repos.first);
  assert.equal(fs.readFileSync(path.join(repos.checkout, 'package-lock.json'), 'utf8'), '{"v":"mine"}');
});

test('update reports a pull that cannot fast-forward and leaves the checkout alone', async () => {
  const repos = makeRepos();
  commitIn(repos.upstream, 'a.txt', 'a');
  const mine = commitIn(repos.checkout, 'mine.txt', 'mine');
  const res = await update(job(repos, { from: mine }), quiet);
  assert.equal(res.ok, false);
  assert.equal(res.transient, false);
  assert.match(res.error, /pull failed/);
  assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), mine);
});

test('update waits out another git process holding index.lock, and reports a lock that never clears as transient', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'a.txt', 'a');
  const lock = path.join(repos.checkout, '.git', 'index.lock');
  fs.writeFileSync(lock, '');
  process.env.NOTES_UPDATE_LOCK_RETRY_MS = '50';
  try {
    const stuck = await update(job(repos, { target }), quiet);
    assert.equal(stuck.ok, false);
    assert.equal(stuck.transient, true, stuck.error);
    assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), repos.first);
  } finally { delete process.env.NOTES_UPDATE_LOCK_RETRY_MS; fs.unlinkSync(lock); }
  assert.equal(isLockError('fatal: Unable to create .git/index.lock: File exists.'), true);
  assert.equal(isLockError('npm ERR! boom'), false);
});

test('waitForExit resolves when the process is gone and times out while it lives', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 400)'], { stdio: 'ignore' });
  assert.equal(await waitForExit(child.pid, 100), false);
  assert.equal(await waitForExit(child.pid, 5000), true);
  assert.equal(await waitForExit(child.pid, 100), true, 'a pid that is gone resolves at once');
});

test('npmEnv drops NODE_ENV, npm_config_* and ELECTRON_RUN_AS_NODE', () => {
  const saved = { ...process.env };
  Object.assign(process.env, { NODE_ENV: 'production', npm_config_omit: 'dev', ELECTRON_RUN_AS_NODE: '1', KEEP_ME: 'yes' });
  try {
    const env = npmEnv();
    assert.equal(env.NODE_ENV, undefined);
    assert.equal(env.npm_config_omit, undefined);
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(env.KEEP_ME, 'yes');
  } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; }
});

test('readJob rejects a malformed job file', () => {
  const dir = tmpDir('notes-job-');
  const file = path.join(dir, 'job.json');
  fs.writeFileSync(file, JSON.stringify({ pid: 1, root: 'r' }));
  assert.throws(() => readJob(file), /missing dataDir/);
  fs.writeFileSync(file, JSON.stringify({ pid: '1', root: 'r', dataDir: 'd', from: 'a', target: 'b', exe: 'e', cwd: 'c', args: [], git: { file: 'g' } }));
  assert.throws(() => readJob(file), /malformed/);
});

async function waitForFile(file) {
  for (let i = 0; i < 50 && !fs.existsSync(file); i++) await new Promise((r) => setTimeout(r, 100));
  return fs.existsSync(file);
}

test('the helper run as a script waits for the pid, updates, writes the result, starts the app and removes the job', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'a.txt', 'a');
  const marker = path.join(repos.base, 'started.txt');
  const waiter = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], { stdio: 'ignore' });
  const jobFile = path.join(repos.dataDir, 'self-update-job.json');
  fs.writeFileSync(jobFile, JSON.stringify(job(repos, { pid: waiter.pid, target, args: ['-e', 'require("fs").writeFileSync(process.argv[1], process.cwd())', marker] })));
  const out = execFileSync(process.execPath, [HELPER, jobFile], { encoding: 'utf8', cwd: repos.base, env: fastEnv() });
  assert.equal(out, '');
  const result = JSON.parse(fs.readFileSync(path.join(repos.dataDir, 'self-update.json'), 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(result.to, target);
  assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), target);
  assert.ok(await waitForFile(marker));
  assert.equal(fs.readFileSync(marker, 'utf8'), repos.checkout, 'the app was started in the checkout');
  assert.equal(fs.existsSync(jobFile), false);
  assert.match(logOf(repos), /waiting for pid \d+[\s\S]*checkout at [0-9a-f]{7}[\s\S]*started /);
});

test('the helper starts the app again even when the update itself throws', async () => {
  const repos = makeRepos();
  const marker = path.join(repos.base, 'started.txt');
  const jobFile = path.join(repos.dataDir, 'job.json');
  const waiter = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 100)'], { stdio: 'ignore' });
  fs.writeFileSync(jobFile, JSON.stringify(job(repos, { pid: waiter.pid, target: 'x', git: { file: path.join(repos.base, 'no-such-git.exe'), env: {} }, args: ['-e', 'require("fs").writeFileSync(process.argv[1], "up")', marker] })));
  execFileSync(process.execPath, [HELPER, jobFile], { encoding: 'utf8', env: fastEnv() });
  const result = JSON.parse(fs.readFileSync(path.join(repos.dataDir, 'self-update.json'), 'utf8'));
  assert.equal(result.ok, false);
  assert.match(result.error, /status failed/);
  assert.ok(await waitForFile(marker), 'Notes came back');
  assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), repos.first);
});

test('the helper gives up without touching the checkout when Notes does not exit, and records that as transient', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'a.txt', 'a');
  const jobFile = path.join(repos.dataDir, 'job.json');
  fs.writeFileSync(jobFile, JSON.stringify(job(repos, { pid: process.pid, target })));
  execFileSync(process.execPath, [HELPER, jobFile], { encoding: 'utf8', env: fastEnv() });
  const result = JSON.parse(fs.readFileSync(path.join(repos.dataDir, 'self-update.json'), 'utf8'));
  assert.equal(result.ok, false);
  assert.equal(result.transient, true);
  assert.match(result.error, /did not exit/);
  assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), repos.first);
  assert.equal(fs.existsSync(jobFile), true, 'the job file stays for the log');
});

test('the helper logs a bad job file next to it and exits non-zero', () => {
  const dir = tmpDir('notes-badjob-');
  const jobFile = path.join(dir, 'job.json');
  fs.writeFileSync(jobFile, '{"pid":1}');
  assert.throws(() => execFileSync(process.execPath, [HELPER, jobFile], { encoding: 'utf8', stdio: 'pipe' }));
  assert.match(fs.readFileSync(path.join(dir, 'self-update.log'), 'utf8'), /bad job file: job is missing root/);
});
