import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';

const AUTHOR = ['-c', 'user.name=Notes', '-c', 'user.email=notes@localhost'];
const COPY_RETRIES = 8;

type GitRun = { ok: boolean, code: string | number | null | undefined, stdout: string, stderr: string, error: string | null };

function run(args: string[], cwd: string, timeoutMs?: number): Promise<GitRun> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: timeoutMs || 20000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? String(stderr || err.message).trim() : null });
    });
  });
}

function catBlobs(specs: string[], cwd: string, timeoutMs: number): Promise<(string | null)[] | null> {
  return new Promise((resolve) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd, windowsHide: true });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? parseBatch(Buffer.concat(chunks), specs.length) : null); });
    child.stdin.end(specs.map((s) => s + '\n').join(''));
  });
}

function parseBatch(out: Buffer, count: number) {
  const blobs: (string | null)[] = [];
  let at = 0;
  while (blobs.length < count && at < out.length) {
    const eol = out.indexOf(10, at);
    if (eol === -1) break;
    const header = out.toString('utf8', at, eol);
    at = eol + 1;
    const size = Number(header.slice(header.lastIndexOf(' ') + 1));
    if (/ (missing|ambiguous)$/.test(header) || !Number.isInteger(size)) { blobs.push(null); continue; }
    blobs.push(out.toString('utf8', at, at + size));
    at += size + 1;
  }
  while (blobs.length < count) blobs.push(null);
  return blobs;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

class GitSync {
  dataDir: string;
  source: string;
  dir: string;
  snapshot: string;
  debounceMs: number;
  now: () => number;
  timer: NodeJS.Timeout | null;
  busy: Promise<GitResult> | null;
  state: GitState;
  onChange: (state: GitState) => void;
  constructor(dataDir: string, opts?: { debounceMs?: number, now?: () => number, onChange?: (state: GitState) => void }) {
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

  _set(patch: Partial<GitState>) {
    Object.assign(this.state, patch);
    this.onChange(this.status());
  }

  async available() {
    if (this.state.available !== null) return this.state.available;
    const r = await run(['--version'], this.dataDir);
    this._set({ available: r.ok });
    return r.ok;
  }

  async configure(settings: Settings) {
    this.state.enabled = !!settings.gitEnabled;
    const wantedRemote = String(settings.gitRemote || '').trim();
    if (!this.state.enabled) { this._set({ pending: false }); return this.status(); }
    if (!(await this.available())) { this._set({ lastError: 'git is not installed or not on PATH.' }); return this.status(); }
    await this.ensureRepo();
    if (wantedRemote && /^-/.test(wantedRemote)) { this._set({ remote: '', lastError: 'That does not look like a repository URL.' }); await this.syncRemote(''); }
    else await this.syncRemote(wantedRemote);
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

  async syncRemote(url: string) {
    if (!this.state.initialized) return;
    const current = await run(['remote', 'get-url', 'origin'], this.dir);
    const have = current.ok ? current.stdout.trim() : '';
    if (url && /^\s*-/.test(String(url))) { this._set({ lastError: 'That does not look like a repository URL.' }); return; }
    if (!url && have) await run(['remote', 'remove', 'origin'], this.dir);
    else if (url && !have) await run(['remote', 'add', '--', 'origin', url], this.dir);
    else if (url && have !== url) await run(['remote', 'set-url', '--', 'origin', url], this.dir);
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

  async takeSnapshot() {
    let lastErr = null;
    for (let i = 0; i < COPY_RETRIES; i++) {
      try {
        if (!fs.existsSync(this.source)) return false;
        if (fs.existsSync(this.snapshot)) { try { fs.chmodSync(this.snapshot, 0o666); } catch (_) {  } }
        fs.copyFileSync(this.source, this.snapshot);
        try { fs.chmodSync(this.snapshot, 0o666); } catch (_) {  }
        return true;
      } catch (err) {
        lastErr = err;
        await wait(30 * (i + 1));
      }
    }
    throw lastErr;
  }

  noteChanged() {
    if (!this.state.enabled) return;
    this._set({ pending: true });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.commit().catch(() => {}); }, this.debounceMs);
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    if (this.state.pending) await this.commit();
    if (this.busy) await this.busy;
  }

  async commit(message?: string) {
    if (!this.state.enabled) return { ok: false, skipped: 'disabled' };
    const prev = this.busy;
    const work = (async () => {
      if (prev) { try { await prev; } catch (_) {  } }
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

  async history(limit?: number) {
    if (!this.state.initialized) return [];
    const r = await run(['log', '--format=%H%x1f%ct%x1f%s', '-n', String(limit || 50)], this.dir);
    if (!r.ok) return [];
    return r.stdout.split('\n').filter(Boolean).map((line) => {
      const [hash, ts, subject] = line.split('\x1f');
      return { hash, at: parseInt(ts, 10) * 1000, subject };
    });
  }

  async notesAt(hashes: string[]) {
    if (!hashes.length) return [];
    return (await catBlobs(hashes.map((h) => h + ':notes.json'), this.dir, 20000)) || hashes.map(() => null);
  }
}

export { GitSync };
