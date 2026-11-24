'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const envMs = (name, fallback) => Number(process.env[name]) || fallback;
const LOCK_RETRIES = 5;
const PULL_TIMEOUT_MS = 120000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

function readJob(file) {
  const job = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['root', 'dataDir', 'from', 'target', 'exe']) if (typeof job[k] !== 'string' || !job[k]) throw new Error('job is missing ' + k);
  if (typeof job.pid !== 'number' || !Array.isArray(job.args) || !Array.isArray(job.installers) || !job.git || typeof job.git.file !== 'string') throw new Error('job is malformed');
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

function installEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    const key = k.toUpperCase();
    if (key === 'NODE_ENV' || key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('NPM_CONFIG_') || key.startsWith('PNPM_CONFIG_')) continue;
    env[k] = v;
  }
  return env;
}

function result(job, fields) {
  return Object.assign({ at: Date.now(), from: job.from, target: job.target, to: job.from, ok: false, error: null, transient: false, installed: false }, fields);
}

function writeResult(job, res, log) {
  try { fs.writeFileSync(path.join(job.dataDir, 'self-update.json'), JSON.stringify(res)); }
  catch (err) { log('could not write self-update.json: ' + err.message); }
}

function startApp(job, log) {
  try {
    const child = spawn(job.exe, job.args, { cwd: job.root, detached: true, stdio: 'ignore', windowsHide: true, env: Object.assign({}, process.env) });
    child.on('error', (err) => log('start failed: ' + err.message));
    child.unref();
    log('started ' + job.exe + ' ' + job.args.join(' '));
  } catch (err) {
    log('start failed: ' + err.message);
  }
}

function electronInstaller(root) {
  try { return require.resolve('electron/install.js', { paths: [root] }); } catch (_) { return null; }
}

function tools(job, log) {
  const gitEnv = Object.assign({}, process.env, job.git.env || {});
  const runInstall = (file, args) => runTool(file, args, job.root, installEnv(), INSTALL_TIMEOUT_MS);
  return {
    git: (args, timeoutMs) => runTool(job.git.file, args, job.root, gitEnv, timeoutMs || 20000),
    install: async (installer) => {
      const installed = await runInstall(installer.file, installer.args);
      if (!installed.ok || fs.existsSync(job.exe)) return installed;
      log(path.basename(job.exe) + ' is missing after ' + installer.name + ' install, downloading Electron');
      const script = electronInstaller(job.root);
      if (!script) return { ok: false, error: 'Electron is not installed in ' + job.root };
      const downloaded = await runInstall(process.execPath, [script]);
      if (downloaded.ok && !fs.existsSync(job.exe)) return { ok: false, error: path.basename(job.exe) + ' is still missing after downloading Electron' };
      return downloaded;
    },
  };
}

function installerIn(job) {
  return job.installers.find((i) => fs.existsSync(path.join(job.root, i.lock))) || null;
}

async function indexLocked(git) {
  const dir = await git(['rev-parse', '--git-dir']);
  return dir.ok && fs.existsSync(path.join(dir.stdout.trim(), 'index.lock'));
}

async function pullFastForward(git, log) {
  const canFastForward = (await git(['merge-base', '--is-ancestor', 'HEAD', 'origin/main'])).ok;
  if (!canFastForward) return { ok: false, error: 'the checkout has commits that are not on origin/main', transient: false };
  let pulled = null;
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    pulled = await git(['pull', '--ff-only', '--quiet', 'origin', 'main'], PULL_TIMEOUT_MS);
    if (pulled.ok || !(await indexLocked(git))) break;
    log('pull is waiting for another git process: ' + pulled.error);
    await sleep(envMs('NOTES_UPDATE_LOCK_RETRY_MS', 2000));
  }
  return pulled.ok ? { ok: true } : { ok: false, error: 'pull failed: ' + pulled.error, transient: true };
}

async function rollBack(job, git, install, headBefore, res, log) {
  if (res.to === headBefore) return;
  const back = await git(['reset', '--keep', '--quiet', headBefore]);
  log(back.ok ? 'rolled the checkout back to ' + headBefore.slice(0, 7) : 'roll back failed: ' + back.error);
  if (!back.ok) return;
  res.to = headBefore;
  const installer = install && installerIn(job);
  if (!installer || !installer.file) return;
  const restore = await install(installer);
  log(restore.ok ? 'restored the packages of ' + headBefore.slice(0, 7) : 'restoring the packages failed: ' + restore.error);
}

async function update(job, log) {
  const { git, install } = tools(job, log);
  const res = result(job, {});
  const fail = (error, transient) => { res.error = error; res.transient = !!transient; log(error); return res; };

  const before = await git(['rev-parse', 'HEAD']);
  if (!before.ok) return fail('rev-parse failed: ' + before.error, true);
  const headBefore = before.stdout.trim();
  res.to = headBefore;
  if ((await git(['merge-base', '--is-ancestor', job.target, headBefore])).ok) {
    log('the checkout already has ' + job.target.slice(0, 7));
  } else {
    const status = await git(['status', '--porcelain', '--untracked-files=no']);
    if (!status.ok) return fail('status failed: ' + status.error, true);
    if (status.stdout.trim()) return fail('the checkout has unsaved changes: ' + status.stdout.trim().split(/\r?\n/).slice(0, 3).join(', '), true);
    const pulled = await pullFastForward(git, log);
    if (!pulled.ok) return fail(pulled.error, pulled.transient);
    const head = await git(['rev-parse', 'HEAD']);
    if (head.ok) res.to = head.stdout.trim();
  }
  log('checkout at ' + res.to.slice(0, 7) + ' (Notes ran ' + job.from.slice(0, 7) + ')');

  const lock = await git(['diff', '--name-only', job.from, res.to, '--', ...job.installers.map((i) => i.lock)]);
  if (lock.ok && !lock.stdout.trim()) { res.ok = true; return res; }
  const installer = installerIn(job);
  if (!installer || !installer.file) {
    await rollBack(job, git, null, headBefore, res, log);
    return fail('the packages changed and ' + (installer ? installer.name + ' is not available' : 'the checkout has no lock file'));
  }
  log('packages changed since ' + job.from.slice(0, 7) + ', running ' + installer.name + ' install');
  let installed = await install(installer);
  if (!installed.ok && !fs.existsSync(job.exe)) {
    log(installer.name + ' install failed and ' + path.basename(job.exe) + ' is missing, trying once more: ' + installed.error);
    await sleep(envMs('NOTES_UPDATE_SETTLE_MS', 3000));
    installed = await install(installer);
  }
  if (installed.ok) { res.ok = true; res.installed = true; log(installer.name + ' install done'); return res; }
  await rollBack(job, git, install, headBefore, res, log);
  return fail(installer.name + ' install failed: ' + installed.error);
}

async function main() {
  const jobFile = process.argv[2];
  if (!jobFile) { console.error('usage: finish-update.js <job.json>'); process.exit(2); }
  const log = makeLog(path.dirname(jobFile));
  let job;
  try { job = readJob(jobFile); } catch (err) { log('bad job file: ' + err.message); throw err; }
  log('update job: Notes ran ' + job.from.slice(0, 7) + ', target ' + job.target.slice(0, 7) + ', waiting for pid ' + job.pid);
  const settleMs = envMs('NOTES_UPDATE_SETTLE_MS', 3000);
  if (!(await waitForExit(job.pid, envMs('NOTES_UPDATE_EXIT_WAIT_MS', 60000) + settleMs))) {
    log('Notes (pid ' + job.pid + ') did not exit; nothing changed');
    writeResult(job, result(job, { error: 'Notes did not exit for the update', transient: true }), log);
    startApp(job, log);
    return;
  }
  await sleep(settleMs);
  let res = null;
  try {
    res = await update(job, log);
  } catch (err) {
    log('update failed unexpectedly: ' + (err && err.stack || err));
    res = result(job, { error: String(err && err.message || err) });
  } finally {
    writeResult(job, res, log);
    startApp(job, log);
    try { fs.unlinkSync(jobFile); } catch (_) {  }
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { update, waitForExit, readJob, installEnv };
