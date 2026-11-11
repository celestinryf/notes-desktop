'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const EXIT_WAIT_MS = Number(process.env.NOTES_UPDATE_EXIT_WAIT_MS) || 60000;
const PULL_TIMEOUT_MS = 120000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

function readJob(file) {
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['root', 'dataDir', 'from', 'target', 'exe', 'cwd']) if (typeof job[k] !== 'string' || !job[k]) throw new Error('job is missing ' + k);
  if (typeof job.pid !== 'number' || !Array.isArray(job.args) || !job.git || typeof job.git.file !== 'string') throw new Error('job is malformed');
  return job;
}

function makeLog(dataDir) {
  const file = path.join(dataDir, 'self-update.log');
  return (line) => { try { fs.appendFileSync(file, new Date().toISOString() + ' ' + line + '\n'); } catch (_) {  } };
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

function waitForExit(pid, maxMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (!alive(pid)) return resolve(true);
      if (Date.now() - started > maxMs) return resolve(false);
      setTimeout(tick, 200);
    };
    tick();
  });
}

function runTool(file, args, cwd, env, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, env, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const text = String(stderr || '').trim() || String(stdout || '').trim();
      resolve(err ? { ok: false, error: (text || err.message).split(/\r?\n/).slice(-3).join(' ') } : { ok: true, error: null, stdout: String(stdout || '') });
    });
  });
}

function lockHash(root) {
  try { return crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'package-lock.json'))).digest('hex'); } catch (_) { return ''; }
}

function writeResult(dataDir, result) {
  try { fs.writeFileSync(path.join(dataDir, 'self-update.json'), JSON.stringify(result)); } catch (_) {  }
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

async function update(job, log) {
  const git = (args, timeoutMs) => runTool(job.git.file, args, job.root, Object.assign({}, process.env, job.git.env || {}), timeoutMs);
  const result = { at: Date.now(), from: job.from, to: job.target, ok: false, error: null, installed: false, noticed: false };
  const lockBefore = lockHash(job.root);
  const pulled = await git(['pull', '--ff-only', '--quiet', 'origin', 'main'], PULL_TIMEOUT_MS);
  if (!pulled.ok) { result.error = 'pull failed: ' + pulled.error; log(result.error); return result; }
  const head = await git(['rev-parse', 'HEAD'], 20000);
  if (head.ok) result.to = head.stdout.trim();
  log('pulled ' + job.from.slice(0, 7) + ' to ' + result.to.slice(0, 7));
  if (lockHash(job.root) === lockBefore) { result.ok = true; return result; }
  if (!job.npm) { result.error = 'the packages changed and npm is not available'; log(result.error); await rollBack(); return result; }
  log('packages changed, running npm install');
  const installed = await runTool(job.npm.file, job.npm.args.concat(['install', '--no-audit', '--no-fund', '--no-progress', '--loglevel=error']), job.root, process.env, INSTALL_TIMEOUT_MS);
  if (installed.ok) { result.ok = true; result.installed = true; log('npm install done'); return result; }
  result.error = 'npm install failed: ' + installed.error;
  log(result.error);
  await rollBack();
  return result;

  async function rollBack() {
    const back = await git(['reset', '--hard', '--quiet', job.from], 20000);
    log(back.ok ? 'rolled the checkout back to ' + job.from.slice(0, 7) : 'roll back failed: ' + back.error);
    if (back.ok) result.to = job.from;
    if (back.ok && job.npm && lockHash(job.root) !== lockBefore) return;
    if (back.ok && job.npm) {
      const restore = await runTool(job.npm.file, job.npm.args.concat(['install', '--no-audit', '--no-fund', '--no-progress', '--loglevel=error']), job.root, process.env, INSTALL_TIMEOUT_MS);
      log(restore.ok ? 'restored the packages of ' + job.from.slice(0, 7) : 'restoring the packages failed: ' + restore.error);
    }
  }
}

async function main() {
  const jobFile = process.argv[2];
  if (!jobFile) { console.error('usage: finish-update.js <job.json>'); process.exit(2); }
  const job = readJob(jobFile);
  const log = makeLog(job.dataDir);
  log('update job: ' + job.from.slice(0, 7) + ' to ' + job.target.slice(0, 7) + ', waiting for pid ' + job.pid);
  const exited = await waitForExit(job.pid, EXIT_WAIT_MS);
  if (!exited) {
    log('Notes (pid ' + job.pid + ') did not exit; nothing changed');
    writeResult(job.dataDir, { at: Date.now(), from: job.from, to: job.target, ok: false, error: 'Notes did not exit for the update', installed: false, noticed: false });
    return;
  }
  const result = await update(job, log);
  writeResult(job.dataDir, result);
  startApp(job, log);
  try { fs.unlinkSync(jobFile); } catch (_) {  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { update, waitForExit, lockHash, readJob, EXIT_WAIT_MS };
