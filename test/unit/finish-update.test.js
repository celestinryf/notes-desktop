'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { gitBinary } = require('../../src/git-binary.mts');
const { tmpDir, cleanup } = require('../helpers/tmp');

const HELPER = path.join(__dirname, '..', '..', 'scripts', 'finish-update.js');
const { update, waitForExit, lockHash, readJob } = require(HELPER);

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
  fs.writeFileSync(script, 'require("fs").appendFileSync(' + JSON.stringify(log) + ', process.argv.slice(2).join(" ") + "\\n"); if (' + (fail ? 'true' : 'false') + ') { console.error("npm ERR! boom"); process.exit(1); }');
  return { npm: { file: process.execPath, args: [script] }, calls: () => { try { return fs.readFileSync(log, 'utf8').trim().split('\n'); } catch (_) { return []; } } };
}
function job(repos, extra) {
  return Object.assign({ pid: process.pid, root: repos.checkout, dataDir: repos.dataDir, from: repos.first, target: 'x', git: { file: git.file, env: gitEnv() }, npm: null, exe: process.execPath, args: [], cwd: repos.checkout }, extra || {});
}
const quiet = () => {};
const logOf = (repos) => { try { return fs.readFileSync(path.join(repos.dataDir, 'self-update.log'), 'utf8'); } catch (_) { return ''; } };

test.after(cleanup);

test('update fast-forwards the checkout when the packages did not change', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'a.txt', 'a');
  const res = await update(job(repos, { target }), quiet);
  assert.deepEqual(res, { at: res.at, from: repos.first, to: target, ok: true, error: null, installed: false, noticed: false });
  assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), target);
});

test('update runs npm install when the lock file changed', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'package-lock.json', '{"v":2}', 'deps');
  const npm = fakeNpm(repos.base);
  const res = await update(job(repos, { target, npm: npm.npm }), quiet);
  assert.equal(res.ok, true);
  assert.equal(res.installed, true);
  assert.equal(res.to, target);
  assert.deepEqual(npm.calls(), ['install --no-audit --no-fund --no-progress --loglevel=error']);
});

test('update rolls the checkout back and restores the packages when npm install fails', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'package-lock.json', '{"v":2}', 'deps');
  const npm = fakeNpm(repos.base, { fail: true });
  const lines = [];
  const res = await update(job(repos, { target, npm: npm.npm }), (l) => lines.push(l));
  assert.equal(res.ok, false);
  assert.match(res.error, /npm install failed: npm ERR! boom/);
  assert.equal(res.to, repos.first);
  assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), repos.first);
  assert.equal(fs.readFileSync(path.join(repos.checkout, 'package-lock.json'), 'utf8'), '{"v":1}');
  assert.equal(npm.calls().length, 2, 'install for the update, then install to restore the old packages');
  assert.ok(lines.some((l) => /rolled the checkout back/.test(l)), lines.join('\n'));
});

test('update refuses a package change without npm and rolls back', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'package-lock.json', '{"v":2}', 'deps');
  const res = await update(job(repos, { target, npm: null }), quiet);
  assert.equal(res.ok, false);
  assert.match(res.error, /npm is not available/);
  assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), repos.first);
});

test('update reports a pull that cannot fast-forward and leaves the checkout alone', async () => {
  const repos = makeRepos();
  commitIn(repos.upstream, 'a.txt', 'a');
  const mine = commitIn(repos.checkout, 'mine.txt', 'mine');
  const res = await update(job(repos, { from: mine }), quiet);
  assert.equal(res.ok, false);
  assert.match(res.error, /pull failed/);
  assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), mine);
});

test('waitForExit resolves when the process is gone and times out while it lives', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 400)'], { stdio: 'ignore' });
  assert.equal(await waitForExit(child.pid, 100), false);
  assert.equal(await waitForExit(child.pid, 5000), true);
  assert.equal(await waitForExit(child.pid, 100), true, 'a pid that is gone resolves at once');
});

test('lockHash changes with the file and is empty without it', () => {
  const dir = tmpDir('notes-lockhash-');
  assert.equal(lockHash(dir), '');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), 'a');
  const a = lockHash(dir);
  fs.writeFileSync(path.join(dir, 'package-lock.json'), 'b');
  assert.notEqual(lockHash(dir), a);
});

test('readJob rejects a malformed job file', () => {
  const dir = tmpDir('notes-job-');
  const file = path.join(dir, 'job.json');
  fs.writeFileSync(file, JSON.stringify({ pid: 1, root: 'r' }));
  assert.throws(() => readJob(file), /missing dataDir/);
  fs.writeFileSync(file, JSON.stringify({ pid: '1', root: 'r', dataDir: 'd', from: 'a', target: 'b', exe: 'e', cwd: 'c', args: [], git: { file: 'g' } }));
  assert.throws(() => readJob(file), /malformed/);
});

test('the helper run as a script waits for the pid, updates, writes the result, starts the app and removes the job', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'a.txt', 'a');
  const marker = path.join(repos.base, 'started.txt');
  const waiter = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], { stdio: 'ignore' });
  const jobFile = path.join(repos.dataDir, 'self-update-job.json');
  fs.writeFileSync(jobFile, JSON.stringify(job(repos, { pid: waiter.pid, target, args: ['-e', 'require("fs").writeFileSync(process.argv[1], process.cwd())', marker] })));
  const out = execFileSync(process.execPath, [HELPER, jobFile], { encoding: 'utf8', cwd: repos.base, env: Object.assign({}, process.env) });
  assert.equal(out, '');
  const result = JSON.parse(fs.readFileSync(path.join(repos.dataDir, 'self-update.json'), 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(result.to, target);
  assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), target);
  for (let i = 0; i < 50 && !fs.existsSync(marker); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.readFileSync(marker, 'utf8'), repos.checkout, 'the app was started in the checkout');
  assert.equal(fs.existsSync(jobFile), false);
  assert.match(logOf(repos), /waiting for pid \d+[\s\S]*pulled [0-9a-f]{7} to [0-9a-f]{7}[\s\S]*started /);
});

test('the helper gives up without touching the checkout when Notes does not exit', async () => {
  const repos = makeRepos();
  const target = commitIn(repos.upstream, 'a.txt', 'a');
  const jobFile = path.join(repos.dataDir, 'job.json');
  fs.writeFileSync(jobFile, JSON.stringify(job(repos, { pid: process.pid, target })));
  const env = Object.assign({}, process.env, { NOTES_UPDATE_EXIT_WAIT_MS: '300' });
  execFileSync(process.execPath, [HELPER, jobFile], { encoding: 'utf8', env });
  const result = JSON.parse(fs.readFileSync(path.join(repos.dataDir, 'self-update.json'), 'utf8'));
  assert.equal(result.ok, false);
  assert.match(result.error, /did not exit/);
  assert.equal(sh(['rev-parse', 'HEAD'], repos.checkout), repos.first);
  assert.equal(fs.existsSync(jobFile), true, 'the job file stays for the log');
});
