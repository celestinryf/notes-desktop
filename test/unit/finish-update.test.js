'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { cleanEnv, SelfUpdater } = require('../../src/self-update.mts');
const { git, sh, commitIn, makeRepos } = require('../helpers/git-repos');
const { tmpDir, cleanup } = require('../helpers/tmp');

const HELPER = path.join(__dirname, '..', '..', 'scripts', 'finish-update.js');
const { update, waitForExit, readJob, npmEnv } = require(HELPER);

const repos = () => makeRepos('notes-finishupdate-');
function fakeNpm(dir, { fail } = {}) {
  const log = path.join(dir, 'npm-calls.txt');
  const script = path.join(dir, 'npm.js');
  fs.writeFileSync(script, 'require("fs").appendFileSync(' + JSON.stringify(log) + ', process.argv.slice(2).join(" ") + "|" + (process.env.NODE_ENV || "") + "\\n"); if (' + (fail ? 'true' : 'false') + ') { console.error("npm ERR! boom"); process.exit(1); }');
  return { npm: { file: process.execPath, args: [script] }, calls: () => { try { return fs.readFileSync(log, 'utf8').trim().split('\n'); } catch (_) { return []; } } };
}
function job(r, extra) {
  return Object.assign({ pid: process.pid, root: r.checkout, dataDir: r.dataDir, from: r.first, target: 'x', git: { file: git.file, env: cleanEnv(git.env) }, npm: null, exe: process.execPath, args: [] }, extra || {});
}
const quiet = () => {};
const logOf = (r) => { try { return fs.readFileSync(path.join(r.dataDir, 'self-update.log'), 'utf8'); } catch (_) { return ''; } };
const resultOf = (r) => JSON.parse(fs.readFileSync(path.join(r.dataDir, 'self-update.json'), 'utf8'));
const INSTALL = 'install --no-audit --no-fund --no-progress --loglevel=error|';
const fastEnv = () => Object.assign({}, process.env, { NOTES_UPDATE_EXIT_WAIT_MS: '300', NOTES_UPDATE_SETTLE_MS: '50', NOTES_UPDATE_LOCK_RETRY_MS: '50' });
const startMarker = (r, name) => ({ marker: path.join(r.base, name), args: ['-e', 'require("fs").writeFileSync(process.argv[1], process.cwd())', path.join(r.base, name)] });
async function waitForFile(file) {
  for (let i = 0; i < 50 && !fs.existsSync(file); i++) await new Promise((res) => setTimeout(res, 100));
  return fs.existsSync(file);
}

test.after(cleanup);

test('update fast-forwards the checkout when the packages did not change', async () => {
  const r = repos();
  const target = commitIn(r.upstream, 'a.txt', 'a');
  const res = await update(job(r, { target }), quiet);
  assert.deepEqual(res, { at: res.at, from: r.first, target, to: target, ok: true, error: null, transient: false, installed: false });
  assert.equal(sh(['rev-parse', 'HEAD'], r.checkout), target);
});

test('update runs npm install when the lock file changed, with NODE_ENV and npm_config_* cleared', async () => {
  const r = repos();
  const target = commitIn(r.upstream, 'package-lock.json', '{"v":2}', 'deps');
  const npm = fakeNpm(r.base);
  process.env.NODE_ENV = 'production';
  try {
    const res = await update(job(r, { target, npm: npm.npm }), quiet);
    assert.equal(res.ok, true);
    assert.equal(res.installed, true);
    assert.equal(res.to, target);
    assert.deepEqual(npm.calls(), [INSTALL]);
  } finally { delete process.env.NODE_ENV; }
});

test('update installs when the checkout was already pulled by someone else but Notes ran an older lock file', async () => {
  const r = repos();
  const target = commitIn(r.upstream, 'package-lock.json', '{"v":2}', 'deps');
  sh(['pull', '-q', '--ff-only', 'origin', 'main'], r.checkout);
  const npm = fakeNpm(r.base);
  const res = await update(job(r, { target, npm: npm.npm }), quiet);
  assert.equal(res.ok, true);
  assert.equal(res.installed, true);
  assert.deepEqual(npm.calls(), [INSTALL]);
});

test('update installs and does not touch a dirty tree when the checkout already has the target', async () => {
  const r = repos();
  const target = commitIn(r.upstream, 'package-lock.json', '{"v":2}', 'deps');
  sh(['pull', '-q', '--ff-only', 'origin', 'main'], r.checkout);
  fs.writeFileSync(path.join(r.checkout, 'a.txt'), 'edited');
  sh(['add', 'a.txt'], r.checkout);
  const npm = fakeNpm(r.base);
  const res = await update(job(r, { target, npm: npm.npm }), quiet);
  assert.equal(res.ok, true);
  assert.equal(res.installed, true);
  assert.equal(res.to, target);
  assert.equal(fs.readFileSync(path.join(r.checkout, 'a.txt'), 'utf8'), 'edited');
});

test('update rolls the checkout back and restores the packages when npm install fails, naming the target it attempted', async () => {
  const r = repos();
  const target = commitIn(r.upstream, 'package-lock.json', '{"v":2}', 'deps');
  const npm = fakeNpm(r.base, { fail: true });
  const lines = [];
  const res = await update(job(r, { target, npm: npm.npm }), (l) => lines.push(l));
  assert.equal(res.ok, false);
  assert.equal(res.transient, false);
  assert.match(res.error, /npm install failed: npm ERR! boom/);
  assert.equal(res.target, target);
  assert.equal(res.to, r.first);
  assert.equal(sh(['rev-parse', 'HEAD'], r.checkout), r.first);
  assert.equal(fs.readFileSync(path.join(r.checkout, 'package-lock.json'), 'utf8'), '{"v":1}');
  assert.equal(npm.calls().length, 2, 'install for the update, then install to restore the old packages');
  assert.ok(lines.some((l) => /rolled the checkout back/.test(l)), lines.join('\n'));
  fs.writeFileSync(path.join(r.dataDir, 'self-update.json'), JSON.stringify(res));
  assert.equal(new SelfUpdater({ root: r.checkout, dataDir: r.dataDir, git: () => {} }).failedFor(target), true, 'the target is not retried on its own');
});

test('update does not roll back a pull someone else made when the install fails', async () => {
  const r = repos();
  const target = commitIn(r.upstream, 'package-lock.json', '{"v":2}', 'deps');
  sh(['pull', '-q', '--ff-only', 'origin', 'main'], r.checkout);
  const npm = fakeNpm(r.base, { fail: true });
  const res = await update(job(r, { target, npm: npm.npm }), quiet);
  assert.equal(res.ok, false);
  assert.equal(res.to, target);
  assert.equal(sh(['rev-parse', 'HEAD'], r.checkout), target);
  assert.equal(npm.calls().length, 1, 'no restore install for a checkout this helper did not move');
});

test('update refuses a package change without npm and rolls back', async () => {
  const r = repos();
  const target = commitIn(r.upstream, 'package-lock.json', '{"v":2}', 'deps');
  const res = await update(job(r, { target, npm: null }), quiet);
  assert.equal(res.ok, false);
  assert.match(res.error, /npm is not available/);
  assert.equal(sh(['rev-parse', 'HEAD'], r.checkout), r.first);
});

test('update refuses a checkout that became dirty since the check, and leaves the edit alone', async () => {
  const r = repos();
  const target = commitIn(r.upstream, 'a.txt', 'a');
  fs.writeFileSync(path.join(r.checkout, 'package-lock.json'), '{"v":"mine"}');
  const res = await update(job(r, { target }), quiet);
  assert.equal(res.ok, false);
  assert.match(res.error, /unsaved changes: .*package-lock\.json/);
  assert.equal(res.transient, true, 'an edit in the checkout is temporary');
  assert.equal(sh(['rev-parse', 'HEAD'], r.checkout), r.first);
  assert.equal(fs.readFileSync(path.join(r.checkout, 'package-lock.json'), 'utf8'), '{"v":"mine"}');
});

test('update reports local commits as a permanent failure, before any pull, and leaves the checkout alone', async () => {
  const r = repos();
  commitIn(r.upstream, 'a.txt', 'a');
  const mine = commitIn(r.checkout, 'mine.txt', 'mine');
  const res = await update(job(r, { from: mine }), quiet);
  assert.equal(res.ok, false);
  assert.equal(res.transient, false);
  assert.match(res.error, /commits that are not on origin\/main/);
  assert.equal(sh(['rev-parse', 'HEAD'], r.checkout), mine);
});

test('update waits out another git process holding index.lock, and reports a lock that never clears as transient', async () => {
  const r = repos();
  const target = commitIn(r.upstream, 'a.txt', 'a');
  const lock = path.join(r.checkout, '.git', 'index.lock');
  fs.writeFileSync(lock, '');
  process.env.NOTES_UPDATE_LOCK_RETRY_MS = '50';
  try {
    const stuck = await update(job(r, { target }), quiet);
    assert.equal(stuck.ok, false);
    assert.equal(stuck.transient, true, stuck.error);
    assert.equal(sh(['rev-parse', 'HEAD'], r.checkout), r.first);
  } finally { delete process.env.NOTES_UPDATE_LOCK_RETRY_MS; fs.unlinkSync(lock); }
});

test('update reports an unreachable origin as transient', async () => {
  const r = repos();
  const target = commitIn(r.upstream, 'a.txt', 'a');
  sh(['fetch', '-q', 'origin'], r.checkout);
  fs.rmSync(r.upstream, { recursive: true, force: true });
  const res = await update(job(r, { target }), quiet);
  assert.equal(res.ok, false);
  assert.equal(res.transient, true);
  assert.match(res.error, /pull failed/);
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
  fs.writeFileSync(file, JSON.stringify({ pid: '1', root: 'r', dataDir: 'd', from: 'a', target: 'b', exe: 'e', args: [], git: { file: 'g' } }));
  assert.throws(() => readJob(file), /malformed/);
});

test('the helper run as a script waits for the pid, updates, writes the result, starts the app in the checkout and removes the job', async () => {
  const r = repos();
  const target = commitIn(r.upstream, 'a.txt', 'a');
  const { marker, args } = startMarker(r, 'started.txt');
  const waiter = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], { stdio: 'ignore' });
  const jobFile = path.join(r.dataDir, 'self-update-job.json');
  fs.writeFileSync(jobFile, JSON.stringify(job(r, { pid: waiter.pid, target, args })));
  assert.equal(execFileSync(process.execPath, [HELPER, jobFile], { encoding: 'utf8', cwd: r.base, env: fastEnv() }), '');
  assert.equal(resultOf(r).ok, true);
  assert.equal(resultOf(r).to, target);
  assert.equal(sh(['rev-parse', 'HEAD'], r.checkout), target);
  assert.ok(await waitForFile(marker));
  assert.equal(fs.readFileSync(marker, 'utf8'), r.checkout);
  assert.equal(fs.existsSync(jobFile), false);
  assert.match(logOf(r), /waiting for pid \d+[\s\S]*checkout at [0-9a-f]{7}[\s\S]*started /);
});

test('the helper starts the app again even when the update itself throws', async () => {
  const r = repos();
  const { marker, args } = startMarker(r, 'started.txt');
  const jobFile = path.join(r.dataDir, 'job.json');
  const waiter = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 100)'], { stdio: 'ignore' });
  fs.writeFileSync(jobFile, JSON.stringify(job(r, { pid: waiter.pid, target: 'x', git: { file: path.join(r.base, 'no-such-git.exe'), env: {} }, args })));
  execFileSync(process.execPath, [HELPER, jobFile], { encoding: 'utf8', env: fastEnv() });
  assert.equal(resultOf(r).ok, false);
  assert.match(resultOf(r).error, /rev-parse failed/);
  assert.ok(await waitForFile(marker), 'Notes came back');
  assert.equal(sh(['rev-parse', 'HEAD'], r.checkout), r.first);
});

test('the helper gives up without touching the checkout when Notes does not exit, records that as transient, and starts the app anyway', async () => {
  const r = repos();
  const target = commitIn(r.upstream, 'a.txt', 'a');
  const { marker, args } = startMarker(r, 'started.txt');
  const jobFile = path.join(r.dataDir, 'job.json');
  fs.writeFileSync(jobFile, JSON.stringify(job(r, { pid: process.pid, target, args })));
  execFileSync(process.execPath, [HELPER, jobFile], { encoding: 'utf8', env: fastEnv() });
  assert.equal(resultOf(r).ok, false);
  assert.equal(resultOf(r).transient, true);
  assert.match(resultOf(r).error, /did not exit/);
  assert.equal(sh(['rev-parse', 'HEAD'], r.checkout), r.first);
  assert.equal(fs.existsSync(jobFile), true, 'the job file stays for the log');
  assert.ok(await waitForFile(marker), 'a second copy exits on the single-instance lock');
});

test('the helper logs a bad job file next to it and exits non-zero', () => {
  const dir = tmpDir('notes-badjob-');
  const jobFile = path.join(dir, 'job.json');
  fs.writeFileSync(jobFile, '{"pid":1}');
  assert.throws(() => execFileSync(process.execPath, [HELPER, jobFile], { encoding: 'utf8', stdio: 'pipe' }));
  assert.match(fs.readFileSync(path.join(dir, 'self-update.log'), 'utf8'), /bad job file: job is missing root/);
});
