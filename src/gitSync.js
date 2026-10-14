'use strict';
/* Keeps a git history of notes.json with an optional remote to push to.
   The repository lives in <dataDir>/history and holds a snapshot copy of notes.json. Git therefore never
   opens the live file, which matters on Windows where an open file cannot be replaced by the atomic save. */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const AUTHOR = ['-c', 'user.name=Notes', '-c', 'user.email=notes@localhost'];
const COPY_RETRIES = 8;

function run(args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: timeoutMs || 20000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? String(stderr || err.message).trim() : null });
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class GitSync {
  constructor(dataDir, opts) {
    opts = opts || {};
    this.dataDir = dataDir;
    this.source = path.join(dataDir, 'notes.json');
    this.dir = path.join(dataDir, 'history');
    this.snapshot = path.join(this.dir, 'notes.json');
    this.debounceMs = opts.debounceMs == null ? 4000 : opts.debounceMs;
    this.now = opts.now || Date.now;
    this.timer = null;
    this.busy = null;
    this.state = { available: null, enabled: false, initialized: false, repoDir: this.dir, remote: '', commits: 0, lastCommitAt: null, lastPushAt: null, lastError: null, pending: false };
    this.onChange = opts.onChange || (() => {});
  }

  status() {
    return Object.assign({}, this.state);
  }

  _set(patch) {
    Object.assign(this.state, patch);
    this.onChange(this.status());
  }

  async available() {
    if (this.state.available !== null) return this.state.available;
    const r = await run(['--version'], this.dataDir);
    this._set({ available: r.ok });
    return r.ok;
  }

  async configure(settings) {
    this.state.enabled = !!settings.gitEnabled;
    this.state.remote = settings.gitRemote || '';
    if (!this.state.enabled) { this._set({ pending: false }); return this.status(); }
    if (!(await this.available())) { this._set({ lastError: 'git is not installed or not on PATH.' }); return this.status(); }
    await this.ensureRepo();
    await this.syncRemote(this.state.remote);
    await this.refreshCounts();
    return this.status();
  }

  async ensureRepo() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(path.join(this.dir, '.git'))) {
      const r = await run(['init', '-q', '-b', 'main'], this.dir);
      if (!r.ok) { this._set({ lastError: r.error }); return false; }
    }
    this._set({ initialized: true });
    return true;
  }

  async syncRemote(url) {
    if (!this.state.initialized) return;
    const current = await run(['remote', 'get-url', 'origin'], this.dir);
    const have = current.ok ? current.stdout.trim() : '';
    if (!url && have) await run(['remote', 'remove', 'origin'], this.dir);
    else if (url && !have) await run(['remote', 'add', 'origin', url], this.dir);
    else if (url && have !== url) await run(['remote', 'set-url', 'origin', url], this.dir);
    this._set({ remote: url || '' });
  }

  async refreshCounts() {
    if (!this.state.initialized) return;
    const count = await run(['rev-list', '--count', 'HEAD'], this.dir);
    const last = await run(['log', '-1', '--format=%ct'], this.dir);
    this._set({
      commits: count.ok ? parseInt(count.stdout.trim(), 10) || 0 : 0,
      lastCommitAt: last.ok && last.stdout.trim() ? parseInt(last.stdout.trim(), 10) * 1000 : null,
    });
  }

  // Copy the live file into the repo. The live file may be mid-replace for a few ms; retry briefly.
  async takeSnapshot() {
    let lastErr = null;
    for (let i = 0; i < COPY_RETRIES; i++) {
      try {
        if (!fs.existsSync(this.source)) return false;
        // Windows copies the read-only attribute along with the file; a read-only snapshot would make
        // every later copy fail and stop history silently. Keep the snapshot writable.
        if (fs.existsSync(this.snapshot)) { try { fs.chmodSync(this.snapshot, 0o666); } catch (_) { /* ignore */ } }
        fs.copyFileSync(this.source, this.snapshot);
        try { fs.chmodSync(this.snapshot, 0o666); } catch (_) { /* ignore */ }
        return true;
      } catch (err) {
        lastErr = err;
        await wait(30 * (i + 1));
      }
    }
    throw lastErr;
  }

  // Called after every content save; coalesces a burst of edits into one commit.
  noteChanged() {
    if (!this.state.enabled) return;
    this._set({ pending: true });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.commit().catch(() => {}); }, this.debounceMs);
  }

  async flush() {
    clearTimeout(this.timer);
    if (this.state.pending) await this.commit();
    if (this.busy) await this.busy;
  }

  async commit(message) {
    if (!this.state.enabled) return { ok: false, skipped: 'disabled' };
    // Chain on whatever is running so two callers can never run git at the same time in this repo.
    const prev = this.busy;
    const work = (async () => {
      if (prev) { try { await prev; } catch (_) { /* previous failure already recorded */ } }
      if (!(await this.available())) return { ok: false, error: 'git unavailable' };
      if (!this.state.initialized && !(await this.ensureRepo())) return { ok: false, error: this.state.lastError };
      try { if (!(await this.takeSnapshot())) { this._set({ pending: false }); return { ok: true, nothingToCommit: true }; } }
      catch (err) { this._set({ lastError: 'snapshot failed: ' + err.message }); return { ok: false, error: err.message }; }
      const add = await run(['add', '-A', '--', 'notes.json'], this.dir);
      if (!add.ok) { this._set({ lastError: add.error, pending: false }); return { ok: false, error: add.error }; }
      const staged = await run(['diff', '--cached', '--quiet'], this.dir);
      if (staged.ok) { this._set({ pending: false }); return { ok: true, nothingToCommit: true }; }
      const stamp = new Date(this.now()).toISOString().replace('T', ' ').slice(0, 19);
      const r = await run(AUTHOR.concat(['commit', '-q', '-m', message || ('notes ' + stamp)]), this.dir);
      if (!r.ok) { this._set({ lastError: r.error, pending: false }); return { ok: false, error: r.error }; }
      this._set({ lastError: null, pending: false });
      await this.refreshCounts();
      if (this.state.remote) await this.push();
      return { ok: true };
    })();
    this.busy = work;
    try { return await work; } finally { if (this.busy === work) this.busy = null; }
  }

  async push() {
    if (!this.state.enabled || !this.state.remote) return { ok: false, skipped: 'no remote' };
    const r = await run(['push', '-q', '-u', 'origin', 'HEAD:main'], this.dir, 60000);
    if (!r.ok) { this._set({ lastError: 'push failed: ' + r.error }); return { ok: false, error: r.error }; }
    this._set({ lastPushAt: this.now(), lastError: null });
    return { ok: true };
  }

  async history(limit) {
    if (!this.state.initialized) return [];
    const r = await run(['log', '--format=%H%x1f%ct%x1f%s', '-n', String(limit || 50)], this.dir);
    if (!r.ok) return [];
    return r.stdout.split('\n').filter(Boolean).map((line) => {
      const [hash, ts, subject] = line.split('\x1f');
      return { hash, at: parseInt(ts, 10) * 1000, subject };
    });
  }

  async showNotesAt(hash) {
    const r = await run(['show', hash + ':notes.json'], this.dir);
    return r.ok ? r.stdout : null;
  }
}

module.exports = { GitSync };
