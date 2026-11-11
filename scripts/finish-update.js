'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const EXIT_WAIT_MS = Number(process.env.NOTES_UPDATE_EXIT_WAIT_MS) || 60000;
const SETTLE_MS = Number(process.env.NOTES_UPDATE_SETTLE_MS) || 3000;
const lockRetryMs = () => Number(process.env.NOTES_UPDATE_LOCK_RETRY_MS) || 2000;
const LOCK_RETRIES = 5;
const PULL_TIMEOUT_MS = 120000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
const INSTALL_ARGS = ['install', '--no-audit', '--no-fund', '--no-progress', '--loglevel=error'];

function readJob(file) {
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['root', 'dataDir', 'from', 'target', 'exe', 'cwd']) if (typeof job[k] !== 'string' || !job[k]) throw new Error('job is missing ' + k);
  if (typeof job.pid !== 'number' || !Array.isArray(job.args) || !job.git || typeof job.git.file !== 'string') throw new Error('job is malformed');
  return job;
}

function makeLog(dir) {
  const file = path.join(dir, 'self-update.log');
  return (line) => { try { fs.appendFileSync(file, new Date().toISOString() + ' ' + line + '\n'); } catch (_) {  } };
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForExit(pid, maxMs) {
  const started = Date.now();
  while (alive(pid)) {
    if (Date.now() - started > maxMs) return false;
    await sleep(200);
  }
  return true;
}

function runTool(file, args, cwd, env, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, env, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const text = String(stderr || '').trim() || String(stdout || '').trim();
      resolve(err ? { ok: false, error: (text || err.message).split(/\r?\n/).slice(-3).join(' '), stdout: String(stdout || '') } : { ok: true, error: null, stdout: String(stdout || '') });
    });
  });
}

function npmEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    const key = k.toUpperCase();
    if (key === 'NODE_ENV' || key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('NPM_CONFIG_')) continue;
    env[k] = v;
  }
  return env;
}

function writeResult(dataDir, result, log) {
  try { fs.writeFileSync(path.join(dataDir, 'self-update.json'), JSON.stringify(result)); }
  catch (err) { log('could not write self-update.json: ' + err.message); }
}

function startApp(job, log) {
  try {
    const child = spawn(job.exe, job.args, { cwd: job.cwd, detached: true, stdio: 'ignore', windowsHide: true, env: Object.assign({}, process.env) });
    child.on('error', (err) => log('start failed: ' + err.message));
    child.unref();
    log('started ' + job.exe + ' ' + job.args.join(' '));
  } catch (err) {
    log('start failed: ' + err.message);
  }
}

function isLockError(error) { return /index\.lock/i.test(error || ''); }
function isFastForwardRefusal(error) { return /fast-forward|diverg|not possible/i.test(error || ''); }

async function update(job, log) {
  const gitEnv = Object.assign({}, process.env, job.git.env || {}, NO_PROMPT);
  const git = (args, timeoutMs) => runTool(job.git.file, args, job.root, gitEnv, timeoutMs || 20000);
  const npm = () => runTool(job.npm.file, job.npm.args.concat(INSTALL_ARGS), job.root, npmEnv(), INSTALL_TIMEOUT_MS);
  const result = { at: Date.now(), from: job.from, target: job.target, to: job.from, ok: false, error: null, transient: false, installed: false, noticed: false };
  const fail = (error, transient) => { result.error = error; result.transient = !!transient; log(error); return result; };

  const before = await git(['rev-parse', 'HEAD']);
  if (!before.ok) return fail('rev-parse failed: ' + before.error, true);
  const headBefore = before.stdout.trim();
  const alreadyThere = (await git(['merge-base', '--is-ancestor', job.target, headBefore])).ok;
  if (alreadyThere) {
    log('the checkout already has ' + job.target.slice(0, 7));
    result.to = headBefore;
  } else {
    const status = await git(['status', '--porcelain', '--untracked-files=no']);
    if (!status.ok) return fail('status failed: ' + status.error, true);
    if (status.stdout.trim()) return fail('the checkout has unsaved changes: ' + status.stdout.trim().split(/\r?\n/).slice(0, 3).join(', '), true);
    let pulled = null;
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
      pulled = await git(['pull', '--ff-only', '--quiet', 'origin', 'main'], PULL_TIMEOUT_MS);
      if (pulled.ok || !isLockError(pulled.error)) break;
      log('pull is waiting for another git process: ' + pulled.error);
      await sleep(lockRetryMs());
    }
    if (!pulled.ok) return fail('pull failed: ' + pulled.error, !isFastForwardRefusal(pulled.error));
    const head = await git(['rev-parse', 'HEAD']);
    if (head.ok) result.to = head.stdout.trim();
  }
  log('checkout at ' + result.to.slice(0, 7) + ' (Notes ran ' + job.from.slice(0, 7) + ')');

  const lock = await git(['diff', '--name-only', job.from, result.to, '--', 'package-lock.json']);
  if (lock.ok && !lock.stdout.trim()) { result.ok = true; return result; }
  if (!job.npm) { await rollBack(); return fail('the packages changed and npm is not available'); }
  log('packages changed since ' + job.from.slice(0, 7) + ', running npm install');
  let installed = await npm();
  if (!installed.ok && !fs.existsSync(job.exe)) { log('npm install failed and ' + path.basename(job.exe) + ' is missing, trying once more: ' + installed.error); await sleep(SETTLE_MS); installed = await npm(); }
  if (installed.ok) { result.ok = true; result.installed = true; log('npm install done'); return result; }
  await rollBack();
  return fail('npm install failed: ' + installed.error);

  async function rollBack() {
    if (result.to === headBefore) return;
    const back = await git(['reset', '--keep', '--quiet', headBefore]);
    log(back.ok ? 'rolled the checkout back to ' + headBefore.slice(0, 7) : 'roll back failed: ' + back.error);
    if (!back.ok) return;
    result.to = headBefore;
    if (!job.npm) return;
    const restore = await npm();
    log(restore.ok ? 'restored the packages of ' + headBefore.slice(0, 7) : 'restoring the packages failed: ' + restore.error);
  }
}

async function main() {
  const jobFile = process.argv[2];
  if (!jobFile) { console.error('usage: finish-update.js <job.json>'); process.exit(2); }
  const log = makeLog(path.dirname(jobFile));
  let job;
  try { job = readJob(jobFile); } catch (err) { log('bad job file: ' + err.message); throw err; }
  log('update job: Notes ran ' + job.from.slice(0, 7) + ', target ' + job.target.slice(0, 7) + ', waiting for pid ' + job.pid);
  let exited = await waitForExit(job.pid, EXIT_WAIT_MS);
  if (!exited) { await sleep(SETTLE_MS); exited = !alive(job.pid); }
  if (!exited) {
    log('Notes (pid ' + job.pid + ') did not exit; nothing changed');
    writeResult(job.dataDir, { at: Date.now(), from: job.from, target: job.target, to: job.from, ok: false, error: 'Notes did not exit for the update', transient: true, installed: false, noticed: false }, log);
    startApp(job, log);
    return;
  }
  await sleep(SETTLE_MS);
  let result = null;
  try {
    result = await update(job, log);
  } catch (err) {
    log('update failed unexpectedly: ' + (err && err.stack || err));
    result = { at: Date.now(), from: job.from, target: job.target, to: job.from, ok: false, error: String(err && err.message || err), transient: false, installed: false, noticed: false };
  } finally {
    if (result) writeResult(job.dataDir, result, log);
    startApp(job, log);
    try { fs.unlinkSync(jobFile); } catch (_) {  }
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { update, waitForExit, readJob, npmEnv, isLockError, isFastForwardRefusal, EXIT_WAIT_MS };
