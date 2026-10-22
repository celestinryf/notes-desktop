import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { Store } from './store.mts';

type VaultTimers = { rescan?: NodeJS.Timeout, commit?: NodeJS.Timeout, pull?: NodeJS.Timeout };

type GitRun = { ok: true, stdout: string, stderr: string, error: null } | { ok: false, stdout: string, stderr: string, error: string };

function git(args: string[], cwd: string, timeoutMs?: number): Promise<GitRun> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: timeoutMs || 60000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = { stdout: String(stdout || ''), stderr: String(stderr || '') };
      resolve(err ? { ok: false, ...out, error: String(stderr || err.message).trim() } : { ok: true, ...out, error: null });
    });
  });
}

const AUTHOR = ['-c', 'user.name=Notes', '-c', 'user.email=notes@localhost'];

class VaultManager {
  store: Store;
  onChange: (vaultId: string, status: VaultStatus) => void;
  onNotesChanged: (vaultId: string, scan: VaultScan) => void;
  now: () => number;
  debounceMs: number;
  rescanDebounceMs: number;
  watchers: Map<string, fs.FSWatcher>;
  timers: Map<string, VaultTimers>;
  status: Map<string, VaultStatus>;
  busy: Map<string, Promise<VaultResult>>;
  queued: Map<string, Promise<VaultResult>>;
  changedPaths: Map<string, Set<string> | null>;
  constructor(store: Store, opts?: { onChange?: (vaultId: string, status: VaultStatus) => void, onNotesChanged?: (vaultId: string, scan: VaultScan) => void, now?: () => number, debounceMs?: number, rescanDebounceMs?: number }) {
    opts = opts || {};
    this.store = store;
    this.onChange = opts.onChange || (() => {});
    this.onNotesChanged = opts.onNotesChanged || (() => {});
    this.now = opts.now || Date.now;
    this.debounceMs = opts.debounceMs == null ? 8000 : opts.debounceMs;
    this.rescanDebounceMs = opts.rescanDebounceMs == null ? 700 : opts.rescanDebounceMs;
    this.watchers = new Map();
    this.timers = new Map();
    this.status = new Map();
    this.busy = new Map();
    this.queued = new Map();
    this.changedPaths = new Map();
  }

  _status(id: string): VaultStatus {
    let s = this.status.get(id);
    if (!s) {
      s = { isRepo: false, branch: '', remote: '', dirty: false, ahead: 0, behind: 0, lastSyncAt: null, lastError: null, syncing: false, conflict: false };
      this.status.set(id, s);
    }
    return s;
  }

  _set(id: string, patch: Partial<VaultStatus>) {
    Object.assign(this._status(id), patch);
    this.onChange(id, this.statusOf(id));
  }

  statusOf(id: string) {
    return Object.assign({}, this._status(id));
  }

  _timers(id: string): VaultTimers {
    let t = this.timers.get(id);
    if (!t) { t = {}; this.timers.set(id, t); }
    return t;
  }

  async start() {
    for (const v of this.store.vaults) await this.open(v.id, { pull: true });
  }

  async open(id: string, opts?: { pull?: boolean }) {
    opts = opts || {};
    const v = this.store.getVault(id);
    if (!v) return;
    await this.refreshRepoStatus(id);
    try { await this.store.scanVault(id); } catch (err) { this._set(id, { lastError: 'scan: ' + err.message }); }
    this.watch(id);
    this.schedulePull(id);
    if (opts.pull && v.remote && v.autoSync) this.sync(id, 'startup').catch(() => {});
  }

  close(id: string) {
    const w = this.watchers.get(id);
    if (w) { try { w.close(); } catch (_) {  } this.watchers.delete(id); }
    const t: Record<string, NodeJS.Timeout | undefined> = this.timers.get(id) || {};
    for (const k of Object.keys(t)) clearTimeout(t[k]);
    this.timers.delete(id);
    this.status.delete(id);
    this.changedPaths.delete(id);
  }

  closeAll() {
    for (const id of Array.from(this.watchers.keys())) this.close(id);
  }

  watch(id: string) {
    const v = this.store.getVault(id);
    if (!v || this.watchers.has(id)) return;
    try {
      const w = fs.watch(v.path, { recursive: true }, (_event, filename) => {
        const name = String(filename || '');
        if (/(^|[\\/])(\.git|\.trash|\.obsidian)([\\/]|$)/.test(name)) return;
        this.diskChanged(id, name ? [name] : null);
        this.scheduleRescan(id);
        if (v.autoSync) this.scheduleCommit(id);
      });
      w.on('error', () => { this.watchers.delete(id); });
      this.watchers.set(id, w);
    } catch (err) {
      this._set(id, { lastError: 'watch: ' + err.message });
    }
  }

  diskChanged(id: string, names: readonly string[] | null) {
    const pending = this.changedPaths.get(id);
    if (names === null || pending === null) { this.changedPaths.set(id, null); return; }
    const next = pending || new Set<string>();
    for (const n of names) next.add(n);
    this.changedPaths.set(id, next);
  }

  scheduleRescan(id: string) {
    const t = this._timers(id);
    clearTimeout(t.rescan);
    t.rescan = setTimeout(async () => {
      const pending = this.changedPaths.get(id);
      this.changedPaths.delete(id);
      const paths = pending ? Array.from(pending) : null;
      try {
        const busy = this.busy.has(id);
        const r = await this.store.scanVault(id, { allowRemovals: !busy, paths: paths || undefined });
        if (r && (r.added || r.updated || r.removed)) this.onNotesChanged(id, r);
        if (busy) { this.diskChanged(id, paths); this.scheduleRescan(id); }
      } catch (err) { this._set(id, { lastError: 'scan: ' + err.message }); }
    }, this.rescanDebounceMs);
  }

  noteChanged(id: string) {
    const v = this.store.getVault(id);
    if (v && v.autoSync) this.scheduleCommit(id);
  }

  scheduleCommit(id: string) {
    const t = this._timers(id);
    clearTimeout(t.commit);
    t.commit = setTimeout(() => { this.sync(id, 'change').catch(() => {}); }, this.debounceMs);
  }

  schedulePull(id: string) {
    const v = this.store.getVault(id);
    const t = this._timers(id);
    clearTimeout(t.pull);
    if (!v || !v.remote || !v.autoSync) return;
    t.pull = setTimeout(() => { this.sync(id, 'interval').catch(() => {}).finally(() => this.schedulePull(id)); }, v.syncMinutes * 60 * 1000);
  }

  async refreshRepoStatus(id: string) {
    const v = this.store.getVault(id);
    if (!v) return null;
    const inside = await git(['rev-parse', '--is-inside-work-tree'], v.path, 10000);
    const isRepo = inside.ok && inside.stdout.trim() === 'true' && fs.existsSync(path.join(v.path, '.git'));
    if (!isRepo) { this._set(id, { isRepo: false, branch: '', remote: v.remote || '', dirty: false, ahead: 0, behind: 0 }); return this.statusOf(id); }
    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], v.path, 10000)).stdout.trim();
    const remoteUrl = (await git(['remote', 'get-url', 'origin'], v.path, 10000)).stdout.trim();
    if (remoteUrl && remoteUrl !== v.remote) this.store.updateVault(id, { remote: remoteUrl });
    const porcelain = await git(['status', '--porcelain'], v.path, 20000);
    let ahead = 0, behind = 0;
    const ab = await git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], v.path, 10000);
    if (ab.ok) { const m = ab.stdout.trim().split(/\s+/); ahead = parseInt(m[0], 10) || 0; behind = parseInt(m[1], 10) || 0; }
    const unmerged = porcelain.ok && /^(UU|AA|DD|AU|UA|DU|UD) /m.test(porcelain.stdout);
    const conflict = unmerged || fs.existsSync(path.join(v.path, '.git', 'rebase-merge')) || fs.existsSync(path.join(v.path, '.git', 'rebase-apply')) || fs.existsSync(path.join(v.path, '.git', 'MERGE_HEAD'));
    this._set(id, { isRepo: true, branch, remote: remoteUrl || v.remote || '', dirty: porcelain.ok && porcelain.stdout.trim().length > 0, ahead, behind, conflict });
    return this.statusOf(id);
  }

  async initRepo(id: string, remote?: string): Promise<VaultResult> {
    if (typeof remote === 'string') remote = remote.trim();
    const v = this.store.getVault(id);
    if (!v) return { ok: false, error: 'Vault not found' };
    if (!fs.existsSync(path.join(v.path, '.git'))) {
      const r = await git(['init', '-q', '-b', 'main'], v.path);
      if (!r.ok) return { ok: false, error: r.error };
    }
    const ignore = path.join(v.path, '.gitignore');
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '.trash/\n.obsidian/workspace*\n', 'utf8');
    if (remote) {
      const have = (await git(['remote', 'get-url', 'origin'], v.path)).stdout.trim();
      if (/^\s*-/.test(String(remote))) return { ok: false, error: 'That does not look like a repository URL.' };
      if (!have) await git(['remote', 'add', '--', 'origin', remote], v.path);
      else if (have !== remote) await git(['remote', 'set-url', '--', 'origin', remote], v.path);
      this.store.updateVault(id, { remote });
    } else if (remote === '') {
      const have = (await git(['remote', 'get-url', 'origin'], v.path)).stdout.trim();
      if (have) await git(['remote', 'remove', 'origin'], v.path);
      this.store.updateVault(id, { remote: '' });
      const t = this.timers.get(id); if (t && t.pull) { clearTimeout(t.pull); t.pull = undefined; }
    }
    await this.refreshRepoStatus(id);
    return { ok: true };
  }

  async sync(id: string, reason: string): Promise<VaultResult> {
    const v = this.store.getVault(id);
    if (!v) return { ok: false, error: 'Vault not found' };
    const running = this.busy.get(id);
    if (running) {
      let next = this.queued.get(id);
      if (!next) {
        next = running.catch(() => {}).then(() => { this.queued.delete(id); return this.sync(id, reason); });
        this.queued.set(id, next);
      }
      return next;
    }
    const work = (async (): Promise<VaultResult> => {
      this._set(id, { syncing: true });
      try {
        await this.refreshRepoStatus(id);
        const st = this._status(id);
        if (!st.isRepo) return { ok: false, skipped: 'not a git repository' };
        if (st.conflict) return { ok: false, error: 'A merge or rebase is in progress; resolve it in the vault folder first.' };
        if (st.dirty) {
          const add = await git(['add', '-A'], v.path);
          if (!add.ok) throw new Error(add.error);
          const stamp = new Date(this.now()).toISOString().replace('T', ' ').slice(0, 19);
          const commit = await git(AUTHOR.concat(['commit', '-q', '-m', 'notes: ' + stamp]), v.path);
          if (!commit.ok && !/nothing to commit/i.test(commit.error || '')) throw new Error(commit.error);
        }
        if (st.remote || v.remote) {
          const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], v.path, 10000)).stdout.trim() || 'main';
          const remoteHas = await git(['ls-remote', '--heads', 'origin', branch], v.path, 60000);
          const remoteHasBranch = remoteHas.ok && remoteHas.stdout.trim().length > 0;
          for (let attempt = 0; attempt < 2; attempt++) {
            const pull = remoteHasBranch ? await git(AUTHOR.concat(['pull', '--rebase', '--autostash', '-q', 'origin', branch]), v.path, 120000) : { ok: true } as const;
            if (!pull.ok) {
              await git(['rebase', '--abort'], v.path);
              await this.refreshRepoStatus(id);
              const msg = /CONFLICT|could not apply/i.test(pull.error) ? 'Conflicting changes from another device; open the folder and resolve them, then Sync again.' : pull.error;
              this._set(id, { lastError: 'pull: ' + msg, syncing: false });
              return { ok: false, error: msg };
            }
            const after = await git(['status', '--porcelain'], v.path, 20000);
            if (after.ok && /^(UU|AA|DD|AU|UA|DU|UD) /m.test(after.stdout)) {
              const msg = 'Conflicting changes from another device; open the folder and resolve them, then Sync again.';
              this._set(id, { lastError: 'pull: ' + msg, conflict: true, syncing: false });
              return { ok: false, error: msg };
            }
            try { const r = await this.store.scanVault(id); if (r && (r.added || r.updated || r.removed)) this.onNotesChanged(id, r); } catch (_) {  }
            const push = await git(['push', '-q', '-u', 'origin', 'HEAD'], v.path, 120000);
            if (push.ok) break;
            const rejected = /rejected|fetch first|non-fast-forward|failed to push some refs/i.test(push.error);
            if (rejected && attempt === 0) continue;
            this._set(id, { lastError: 'push: ' + push.error, syncing: false }); await this.refreshRepoStatus(id); return { ok: false, error: push.error };
          }
        }
        await this.refreshRepoStatus(id);
        this._set(id, { lastSyncAt: this.now(), lastError: null, syncing: false });
        return { ok: true, reason };
      } catch (err) {
        this._set(id, { lastError: String(err.message || err), syncing: false });
        return { ok: false, error: String(err.message || err) };
      }
    })();
    this.busy.set(id, work);
    try { return await work; } finally { if (this.busy.get(id) === work) this.busy.delete(id); }
  }

  async flushAll() {
    const ids = this.store.vaults.filter((v) => v.autoSync).map((v) => v.id);
    for (const id of ids) {
      const t = this._timers(id);
      if (t.commit) { clearTimeout(t.commit); await this.sync(id, 'quit'); }
    }
  }

  static async clone(url: string, destDir: string) {
    if (/^\s*-/.test(String(url))) return { ok: false, error: 'That does not look like a repository URL.' };
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    const r = await git(['clone', '-q', '--', url, destDir], path.dirname(destDir), 300000);
    return r.ok ? { ok: true, path: destDir } : { ok: false, error: r.error };
  }
}

export { VaultManager, git };
