import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { MAX_TEXT_BYTES, isRecord } from './shared/helpers.mts';

const AUTHOR = ['-c', 'user.name=Notes', '-c', 'user.email=notes@localhost'];
const COPY_RETRIES = 8;
const NOTE_EXTS = ['md', 'markdown', 'mdx', 'txt', 'text', 'tex', 'latex', 'bib', 'org', 'rst', 'mdlock'];
const LINKED_DIR = '.linked';
const TREE_EXCLUDE = ['*', '!*/'].concat(NOTE_EXTS.map((ext) => '!*.' + ext), ['.trash/', '.obsidian/']).join('\n') + '\n';
const STALE_LOCK_MS = 10000;
const COMMIT_TIMEOUT_MS = 10 * 60 * 1000;
const HASH_BATCH = 500;
const RACY_MS = 3000;
const STAT_TIMEOUT_MS = 5000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const PLAIN_NAME = /^[^\u0000-\u001f/\\:*?"<>|]{1,200}$/;
const NAME_GIT_REFUSES = /^(\.+|\.git|git~\d+|(con|prn|aux|nul|com\d|lpt\d|conin\$|conout\$)(\..*)?)$|[. ]$/i;

type FileCommit = { hash: string; at: number; path: string };
type LinkedFile = { id: string; filePath: string };
type KeptOut = { id: string; filePath: string | null };
type SeenFile = { mtimeMs: number; size: number; hash: string };

type GitRun = { ok: boolean, code: string | number | null | undefined, stdout: string, stderr: string, error: string | null };

function run(args: string[], cwd: string, timeoutMs?: number, input?: string): Promise<GitRun> {
  return new Promise((resolve) => {
    const child = execFile('git', args, { cwd, timeout: timeoutMs || 20000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? String(stderr || err.message).trim() : null });
    });
    if (input !== undefined && child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}

const ignoreLine = (rel: string) => '/' + rel.replace(/[\\*?[\]!#]/g, '\\$&').replace(/ $/, '\\ ');

const KEPT_OUT_FIELDS = new Set(['body', 'title', 'tags']);

const withoutKeptOut = (doc: unknown, ids: Set<string>) => {
  if (!isRecord(doc) || !Array.isArray(doc.notes)) return doc;
  return Object.assign({}, doc, { notes: doc.notes.map((n: unknown) => (isRecord(n) && typeof n.id === 'string' && ids.has(n.id) ? Object.fromEntries(Object.entries(n).filter(([k]) => !KEPT_OUT_FIELDS.has(k))) : n)) });
};

const linkedDir = (id: string) => LINKED_DIR + '/' + id.slice(0, 2).toLowerCase() + '/' + id + '/';

function linkedPath(file: LinkedFile) {
  const name = path.basename(file.filePath);
  return linkedDir(file.id) + (PLAIN_NAME.test(name) && !NAME_GIT_REFUSES.test(name) ? name : 'file');
}

function lookAt(filePath: string): Promise<fs.Stats | 'gone' | 'unsure'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('unsure'), STAT_TIMEOUT_MS);
    fs.promises.stat(filePath).then(
      (s) => { clearTimeout(timer); resolve(s.isFile() && s.size <= MAX_TEXT_BYTES ? s : 'gone'); },
      (err: unknown) => { clearTimeout(timer); resolve(isRecord(err) && (err.code === 'ENOENT' || err.code === 'ENOTDIR') ? 'gone' : 'unsure'); },
    );
  });
}

function eachBlob(specs: string[], cwd: string, timeoutMs: number, visit: (index: number, text: string | null) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd, windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    let pending: Buffer[] = [], have = 0, need = -1, index = 0, done = false;
    const joined = () => { const all = pending.length === 1 ? pending[0] : Buffer.concat(pending, have); pending = [all]; return all; };
    const keepFrom = (all: Buffer, at: number) => { pending = [all.subarray(at)]; have = all.length - at; };
    const drain = () => {
      while (index < specs.length) {
        if (need < 0) {
          const all = joined();
          const eol = all.indexOf(10);
          if (eol === -1) return;
          const header = all.toString('utf8', 0, eol);
          keepFrom(all, eol + 1);
          const size = Number(header.slice(header.lastIndexOf(' ') + 1));
          if (/ (missing|ambiguous)$/.test(header) || !Number.isInteger(size)) { visit(index++, null); continue; }
          need = size + 1;
        }
        if (have < need) return;
        const all = joined();
        const text = all.toString('utf8', 0, need - 1);
        keepFrom(all, need);
        need = -1;
        visit(index++, text);
      }
    };
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      while (index < specs.length) visit(index++, null);
      resolve(ok);
    };
    child.stdout.on('data', (d: Buffer) => { pending.push(d); have += d.length; if (need < 0 || have >= need) drain(); });
    child.stdin.on('error', () => {});
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
    child.stdin.end(specs.map((s) => s + '\n').join(''));
  });
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
  beforeSnapshot: () => void;
  workTree: () => string | null;
  linkedFiles: () => LinkedFile[];
  keptOut: () => KeptOut[];
  linkedSeen: Map<string, SeenFile>;
  linkedError: string | null;
  gitDir: string;
  constructor(dataDir: string, opts?: { debounceMs?: number, now?: () => number, onChange?: (state: GitState) => void, beforeSnapshot?: () => void, workTree?: () => string | null, linkedFiles?: () => LinkedFile[], keptOut?: () => KeptOut[] }) {
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
    this.beforeSnapshot = opts.beforeSnapshot || (() => {});
    this.workTree = opts.workTree || (() => null);
    this.linkedFiles = opts.linkedFiles || (() => []);
    this.keptOut = opts.keptOut || (() => []);
    this.linkedSeen = new Map();
    this.linkedError = null;
    this.gitDir = path.join(this.dir, '.git');
  }

  _inTree(tree: string, args: string[], timeoutMs?: number, input?: string) {
    return run(['-c', 'core.quotePath=false', '-c', 'core.autocrlf=false', '-c', 'core.excludesFile=' + this._treeExclude(), '--git-dir', this.gitDir, '--work-tree', tree].concat(args), tree, timeoutMs, input);
  }

  _unstage(tree: string, rels: string[]) {
    return this._inTree(tree, ['rm', '--cached', '-q', '--ignore-unmatch', '--pathspec-from-file=-', '--pathspec-file-nul'], 120000, rels.map((rel) => ':(icase,literal)' + rel).join('\0'));
  }

  _treeExclude() {
    const file = path.join(this.dir, '.notes-tree-exclude');
    let have = '';
    try { have = fs.readFileSync(file, 'utf8'); } catch (_) {  }
    if (!have.startsWith(TREE_EXCLUDE)) fs.writeFileSync(file, TREE_EXCLUDE);
    return file;
  }

  async _addTree(tree: string) {
    for (let pass = 0; ; pass++) {
      const added = await this._inTree(tree, ['add', '-A', '--', '.', ':(exclude)' + LINKED_DIR], 120000);
      const file = this._treeExclude();
      const have = fs.readFileSync(file, 'utf8');
      const fresh = added.ok ? [] : Array.from(String(added.error).matchAll(/'([^'\n]+)\/' does not have a commit checked out/g), (m) => '/' + m[1].replace(/[\\*?[\]!#]/g, '\\$&') + '/').filter((line) => !have.split('\n').includes(line));
      if (!fresh.length || pass >= 50) return added;
      fs.appendFileSync(file, fresh.join('\n') + '\n');
    }
  }

  _clearStaleLock() {
    const lock = path.join(this.gitDir, 'index.lock');
    try { if (Date.now() - fs.statSync(lock).mtimeMs > STALE_LOCK_MS) fs.rmSync(lock, { force: true }); } catch (_) {  }
  }

  async _stage(): Promise<GitRun | null> {
    this._clearStaleLock();
    const tree = this.workTree();
    if (tree) {
      const cleared = await this._unstage(tree, ['notes.json'].concat(this._keptOutOf(tree)));
      if (!cleared.ok) return cleared;
      const added = await this._addTree(tree);
      if (!added.ok) return added;
      const keptNow = this._keptOutOf(tree);
      const recleared = keptNow.length ? await this._unstage(tree, keptNow) : added;
      if (!recleared.ok) return recleared;
      const linked = await this._stageLinked();
      this.linkedError = linked.ok ? null : linked.error || 'git could not stage them';
      if (!linked.ok) {
        this.linkedSeen.clear();
        await run(['reset', '-q', 'HEAD', '--', LINKED_DIR], this.dir);
      }
      return added;
    }
    if (!(await this.takeSnapshot())) return null;
    return run(['add', '-A', '--', 'notes.json'], this.dir);
  }

  _keptOutOf(tree: string) {
    const kept = this.keptOut().flatMap((k) => {
      if (!k.filePath) return [];
      const rel = path.relative(tree, k.filePath);
      return rel && !path.isAbsolute(rel) && rel.split(path.sep)[0] !== '..' ? [rel.split(path.sep).join('/')] : [];
    });
    const file = path.join(this.gitDir, 'info', 'exclude');
    const text = kept.map(ignoreLine).join('\n') + (kept.length ? '\n' : '');
    let have: string | null = null;
    try { have = fs.readFileSync(file, 'utf8'); } catch (_) {  }
    if (have !== text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
    return kept;
  }

  async _stageLinked(): Promise<GitRun> {
    const listed = await run(['ls-files', '-s', '-z', '--', LINKED_DIR], this.dir, 60000);
    if (!listed.ok) return listed;
    const staged = new Map<string, string>();
    for (const record of listed.stdout.split('\0')) {
      const m = /^\d+ ([0-9a-f]{40,64}) \d\t([\s\S]+)$/.exec(record);
      if (m) staged.set(m[2], m[1]);
    }
    const wanted = this.linkedFiles().filter((f) => SAFE_ID.test(f.id) && !/[\u0000-\u001f]/.test(f.filePath));
    const looks = await Promise.all(wanted.map((f) => lookAt(f.filePath)));
    const present = wanted.flatMap((file, i) => { const stat = looks[i]; return typeof stat === 'object' ? [{ file, stat }] : []; });
    const unsure = wanted.filter((_, i) => looks[i] === 'unsure');
    const keep = new Set(present.map((p) => p.file.filePath).concat(unsure.map((f) => f.filePath)));
    for (const filePath of this.linkedSeen.keys()) if (!keep.has(filePath)) this.linkedSeen.delete(filePath);
    const hashes = present.map(({ file, stat }) => {
      const seen = this.linkedSeen.get(file.filePath);
      return seen && seen.mtimeMs === stat.mtimeMs && seen.size === stat.size ? seen.hash : null;
    });
    const stale = present.flatMap((_, i) => (hashes[i] ? [] : [i]));
    const fresh = await this._hashFiles(stale.map((i) => present[i].file.filePath));
    const settled = Date.now() - RACY_MS;
    stale.forEach((at, k) => {
      const { file, stat } = present[at];
      const hash = fresh[k] || null;
      hashes[at] = hash;
      if (hash && stat.mtimeMs < settled) this.linkedSeen.set(file.filePath, { mtimeMs: stat.mtimeMs, size: stat.size, hash });
      else this.linkedSeen.delete(file.filePath);
    });
    const wantedPaths = new Map(present.flatMap((p, i) => { const hash = hashes[i]; return hash ? [[linkedPath(p.file), hash] as const] : []; }));
    for (const file of present.filter((_, i) => !hashes[i]).map((p) => p.file).concat(unsure)) {
      const was = staged.get(linkedPath(file));
      if (was) wantedPaths.set(linkedPath(file), was);
    }
    const changes = Array.from(wantedPaths).filter(([p, hash]) => staged.get(p) !== hash).map(([p, hash]) => '100644 ' + hash + '\t' + p + '\0')
      .concat(Array.from(staged.keys()).filter((p) => !wantedPaths.has(p)).map((p) => '0 ' + '0'.repeat(40) + '\t' + p + '\0'));
    if (!changes.length) return { ok: true, code: 0, stdout: '', stderr: '', error: null };
    return run(['update-index', '-z', '--index-info'], this.dir, 120000, changes.join(''));
  }

  async _hashFiles(paths: string[]): Promise<(string | null)[]> {
    const hashes: (string | null)[] = [];
    while (hashes.length < paths.length) {
      const batch = paths.slice(hashes.length, hashes.length + HASH_BATCH);
      const r = await run(['hash-object', '-w', '--no-filters', '--stdin-paths'], this.dir, 120000, batch.join('\n') + '\n');
      const got = r.stdout.split(/\r?\n/).filter((line) => /^[0-9a-f]{40,64}$/.test(line)).slice(0, batch.length);
      hashes.push(...got);
      if (got.length < batch.length) hashes.push(...new Array<null>(r.ok ? batch.length - got.length : 1).fill(null));
    }
    return hashes;
  }

  _keptError() {
    const last = this.state.lastError;
    return last && last.startsWith('push failed') ? last : this._linkedNotice();
  }

  _linkedNotice() {
    return this.linkedError ? 'Files outside the notes folder were not saved to history: ' + this.linkedError : null;
  }

  _staged() {
    const tree = this.workTree();
    return tree ? this._inTree(tree, ['diff', '--cached', '--quiet']) : run(['diff', '--cached', '--quiet'], this.dir);
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
    this.beforeSnapshot();
    let lastErr = null;
    for (let i = 0; i < COPY_RETRIES; i++) {
      try {
        if (!fs.existsSync(this.source)) return false;
        if (fs.existsSync(this.snapshot)) { try { fs.chmodSync(this.snapshot, 0o666); } catch (_) {  } }
        const ids = new Set(this.keptOut().map((k) => k.id));
        if (ids.size) fs.writeFileSync(this.snapshot, JSON.stringify(withoutKeptOut(JSON.parse(fs.readFileSync(this.source, 'utf8')), ids), null, 2));
        else fs.copyFileSync(this.source, this.snapshot);
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
      let add: GitRun | null;
      try { add = await this._stage(); }
      catch (err) { this._set({ lastError: 'snapshot failed: ' + err.message, pending: false }); return { ok: false, error: err.message }; }
      if (!add) { this._set({ pending: false, lastError: this._keptError() }); return { ok: true, nothingToCommit: true }; }
      if (!add.ok) { this._set({ lastError: add.error, pending: false }); return { ok: false, error: add.error }; }
      const staged = await this._staged();
      if (staged.ok) { this._set({ pending: false, lastError: this._keptError() }); return { ok: true, nothingToCommit: true }; }
      const stamp = new Date(this.now()).toISOString().replace('T', ' ').slice(0, 19);
      const r = await run(AUTHOR.concat(['commit', '-q', '-m', message || ('notes ' + stamp)]), this.dir, COMMIT_TIMEOUT_MS);
      if (!r.ok) { this.linkedSeen.clear(); this._set({ lastError: r.error, pending: false }); return { ok: false, error: r.error }; }
      if (this.workTree()) { try { fs.rmSync(this.snapshot, { force: true }); } catch (_) {  } }
      this._set({ lastError: this._linkedNotice(), pending: false });
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

  async history(limit?: number, onlyPath?: string) {
    if (!this.state.initialized) return [];
    const r = await run(['log', '--format=%H%x1f%ct%x1f%s', '-n', String(limit || 50)].concat(onlyPath ? ['--', onlyPath] : []), this.dir);
    if (!r.ok) return [];
    return r.stdout.split('\n').filter(Boolean).map((line) => {
      const [hash, ts, subject] = line.split('\x1f');
      return { hash, at: parseInt(ts, 10) * 1000, subject };
    });
  }

  async eachNotesAt(hashes: string[], visit: (index: number, text: string | null) => void) {
    if (!hashes.length) return true;
    return eachBlob(hashes.map((h) => h + ':notes.json'), this.dir, 20000, visit);
  }

  async _trackedPath(relPath: string) {
    const r = await run(['-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', '--name-only', 'HEAD'], this.dir, 60000);
    if (!r.ok) return relPath;
    const want = relPath.toLowerCase();
    return r.stdout.split('\0').find((p) => p === relPath) || r.stdout.split('\0').find((p) => p.toLowerCase() === want) || relPath;
  }

  async _fileLog(logArgs: string[], pathspec: string, limit?: number): Promise<FileCommit[]> {
    const r = await run(['-c', 'core.quotePath=false', 'log'].concat(logArgs, ['--format=%x1e%H%x1f%ct', '--name-only', '-n', String(limit || 50), '--', pathspec]), this.dir, 60000);
    if (!r.ok) return [];
    return r.stdout.split('\x1e').map((chunk) => chunk.trim()).filter(Boolean).map((chunk) => {
      const [head, ...rest] = chunk.split('\n');
      const [hash, ts] = head.split('\x1f');
      return { hash, at: parseInt(ts, 10) * 1000, path: rest.map((l) => l.trim()).find(Boolean) || pathspec };
    });
  }

  async fileHistory(relPath: string, limit?: number): Promise<FileCommit[]> {
    if (!this.state.initialized) return [];
    return this._fileLog(['--follow'], await this._trackedPath(relPath), limit);
  }

  async linkedHistory(id: string, limit?: number): Promise<FileCommit[]> {
    if (!this.state.initialized || !SAFE_ID.test(id)) return [];
    return this._fileLog(['--no-renames', '--diff-filter=AM'], linkedDir(id), limit);
  }

  async eachFileAt(commits: readonly FileCommit[], visit: (index: number, text: string | null) => void) {
    if (!commits.length) return true;
    return eachBlob(commits.map((c) => c.hash + ':' + c.path), this.dir, 20000, visit);
  }

  async versions(limit: number, skip: number): Promise<RawVersion[]> {
    if (!this.state.initialized) return [];
    const r = await run(['-c', 'core.quotePath=false', 'log', '-M', '-z', '--name-status', '--format=%x1e%H%x1f%ct', '-n', String(limit), '--skip=' + skip], this.dir, 60000);
    if (!r.ok) return [];
    return r.stdout.split('\x1e').filter((chunk) => chunk.trim()).map(parseVersion);
  }

  async blobBefore(hash: string, relPath: string, maxBytes: number): Promise<{ ok: true, data: Buffer } | { ok: false, reason: 'missing' | 'too large' }> {
    const spec = hash + '^:' + relPath;
    const size = await run(['cat-file', '-s', spec], this.dir);
    const bytes = size.ok ? parseInt(size.stdout.trim(), 10) : NaN;
    if (!Number.isInteger(bytes)) return { ok: false, reason: 'missing' };
    if (bytes > maxBytes) return { ok: false, reason: 'too large' };
    const data = await runBytes(['cat-file', 'blob', spec], this.dir, maxBytes + 1);
    return data ? { ok: true, data } : { ok: false, reason: 'missing' };
  }
}

type RawVersion = { hash: string, at: number, files: { status: string, path: string }[] };

function parseVersion(chunk: string): RawVersion {
  const tokens = chunk.split('\0');
  const [hash, ts] = tokens[0].trim().split('\x1f');
  const files: RawVersion['files'] = [];
  for (let i = 1; i < tokens.length; i++) {
    const status = tokens[i].trim();
    if (!/^[ACDMRTUXB]\d*$/.test(status)) continue;
    const step = status[0] === 'R' || status[0] === 'C' ? 2 : 1;
    const file = tokens[i + step];
    if (file === undefined) break;
    files.push({ status: status[0], path: file });
    i += step;
  }
  return { hash, at: parseInt(ts, 10) * 1000, files };
}

function runBytes(args: string[], cwd: string, maxBuffer: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 20000, windowsHide: true, maxBuffer, encoding: 'buffer' }, (err, stdout) => resolve(err ? null : stdout));
  });
}

export type { FileCommit, LinkedFile, KeptOut, RawVersion };
export { GitSync, LINKED_DIR, parseVersion };
