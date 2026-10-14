'use strict';
/* Vault manager: watches vault directories for changes, keeps the store in step, and runs git sync
   (commit local changes, pull with rebase, push) the way the Obsidian git plugin does. Main process only. */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function git(args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: timeoutMs || 60000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? String(stderr || err.message).trim() : null });
    });
  });
}

const AUTHOR = ['-c', 'user.name=Notes', '-c', 'user.email=notes@localhost'];

class VaultManager {
  constructor(store, opts) {
    opts = opts || {};
    this.store = store;
    this.onChange = opts.onChange || (() => {});      // (vaultId, status) -> void
    this.onNotesChanged = opts.onNotesChanged || (() => {}); // after a scan changed anything
    this.now = opts.now || Date.now;
    this.debounceMs = opts.debounceMs == null ? 8000 : opts.debounceMs;
    this.rescanDebounceMs = opts.rescanDebounceMs == null ? 700 : opts.rescanDebounceMs;
    this.watchers = new Map();     // vaultId -> fs.FSWatcher
    this.timers = new Map();       // vaultId -> { rescan, commit, pull }
    this.status = new Map();       // vaultId -> status object
    this.busy = new Map();         // vaultId -> promise
    this.queued = new Map();       // vaultId -> promise of the follow-up sync
  }

  _status(id) {
    if (!this.status.has(id)) this.status.set(id, { isRepo: false, branch: '', remote: '', dirty: false, ahead: 0, behind: 0, lastSyncAt: null, lastError: null, syncing: false, conflict: false });
    return this.status.get(id);
  }

  _set(id, patch) {
    Object.assign(this._status(id), patch);
    this.onChange(id, this.statusOf(id));
  }

  statusOf(id) {
    return Object.assign({}, this._status(id));
  }

  _timers(id) {
    if (!this.timers.has(id)) this.timers.set(id, {});
    return this.timers.get(id);
  }

  // ---- lifecycle -----------------------------------------------------------

  async start() {
    for (const v of this.store.vaults) await this.open(v.id, { pull: true });
  }

  async open(id, opts) {
    opts = opts || {};
    const v = this.store.getVault(id);
    if (!v) return;
    await this.refreshRepoStatus(id);
    try { await this.store.scanVault(id); } catch (err) { this._set(id, { lastError: 'scan: ' + err.message }); }
    this.watch(id);
    this.schedulePull(id);
    if (opts.pull && v.remote && v.autoSync) this.sync(id, 'startup').catch(() => {});
  }

  close(id) {
    const w = this.watchers.get(id);
    if (w) { try { w.close(); } catch (_) { /* ignore */ } this.watchers.delete(id); }
    const t = this.timers.get(id) || {};
    for (const k of Object.keys(t)) clearTimeout(t[k]);
    this.timers.delete(id);
    this.status.delete(id);
  }

  closeAll() {
    for (const id of Array.from(this.watchers.keys())) this.close(id);
  }

  // ---- watching ------------------------------------------------------------

  watch(id) {
    const v = this.store.getVault(id);
    if (!v || this.watchers.has(id)) return;
    try {
      const w = fs.watch(v.path, { recursive: true }, (_event, filename) => {
        const name = String(filename || '');
        if (/(^|[\\/])(\.git|\.trash|\.obsidian)([\\/]|$)/.test(name)) return;
        this.scheduleRescan(id);
        if (v.autoSync) this.scheduleCommit(id);
      });
      w.on('error', () => { this.watchers.delete(id); });
      this.watchers.set(id, w);
    } catch (err) {
      this._set(id, { lastError: 'watch: ' + err.message });
    }
  }

  scheduleRescan(id) {
    const t = this._timers(id);
    clearTimeout(t.rescan);
    t.rescan = setTimeout(async () => {
      try {
        // While a sync is replaying commits, files come and go; never treat that as deletions.
        const r = await this.store.scanVault(id, { allowRemovals: !this.busy.has(id) });
        if (r && (r.added || r.updated || r.removed)) this.onNotesChanged(id, r);
        if (this.busy.has(id)) this.scheduleRescan(id);
      } catch (err) { this._set(id, { lastError: 'scan: ' + err.message }); }
    }, this.rescanDebounceMs);
  }

  // Called by the app after it writes a vault file itself.
  noteChanged(id) {
    const v = this.store.getVault(id);
    if (v && v.autoSync) this.scheduleCommit(id);
  }

  scheduleCommit(id) {
    const t = this._timers(id);
    clearTimeout(t.commit);
    t.commit = setTimeout(() => { this.sync(id, 'change').catch(() => {}); }, this.debounceMs);
  }

  schedulePull(id) {
    const v = this.store.getVault(id);
    const t = this._timers(id);
    clearTimeout(t.pull);
    if (!v || !v.remote || !v.autoSync) return;
    t.pull = setTimeout(() => { this.sync(id, 'interval').catch(() => {}).finally(() => this.schedulePull(id)); }, v.syncMinutes * 60 * 1000);
  }

  // ---- git -----------------------------------------------------------------

  async refreshRepoStatus(id) {
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
    const conflict = fs.existsSync(path.join(v.path, '.git', 'rebase-merge')) || fs.existsSync(path.join(v.path, '.git', 'rebase-apply')) || fs.existsSync(path.join(v.path, '.git', 'MERGE_HEAD'));
    this._set(id, { isRepo: true, branch, remote: remoteUrl || v.remote || '', dirty: porcelain.ok && porcelain.stdout.trim().length > 0, ahead, behind, conflict });
    return this.statusOf(id);
  }

  async initRepo(id, remote) {
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
      if (!have) await git(['remote', 'add', 'origin', remote], v.path);
      else if (have !== remote) await git(['remote', 'set-url', 'origin', remote], v.path);
      this.store.updateVault(id, { remote });
    }
    await this.refreshRepoStatus(id);
    return { ok: true };
  }

  // Commit local changes, pull with rebase (autostash), push. Never destroys local work: a conflicting
  // rebase is aborted and reported, leaving the local commit in place for the user to resolve.
  async sync(id, reason) {
    const v = this.store.getVault(id);
    if (!v) return { ok: false, error: 'Vault not found' };
    // A sync asked for while one is running must not get that run's (possibly stale) result: it runs
    // again afterwards, once, however many callers queued up meanwhile.
    if (this.busy.has(id)) {
      if (!this.queued.has(id)) {
        this.queued.set(id, this.busy.get(id).catch(() => {}).then(() => { this.queued.delete(id); return this.sync(id, reason); }));
      }
      return this.queued.get(id);
    }
    const work = (async () => {
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
          // The branch name is only real after the first commit (before that HEAD is unborn).
          const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], v.path, 10000)).stdout.trim() || 'main';
          const remoteHas = await git(['ls-remote', '--heads', 'origin', branch], v.path, 60000);
          const remoteHasBranch = remoteHas.ok && remoteHas.stdout.trim().length > 0;
          // Rebase and autostash create commits too, so the identity goes on the pull as well.
          // Pull, then push. If the remote moved between the two (another device pushed just now), pull
          // once more and push again rather than reporting a rejection the next sync would clear anyway.
          for (let attempt = 0; attempt < 2; attempt++) {
            const pull = remoteHasBranch ? await git(AUTHOR.concat(['pull', '--rebase', '--autostash', '-q', 'origin', branch]), v.path, 120000) : { ok: true };
            if (!pull.ok) {
              await git(['rebase', '--abort'], v.path);
              await this.refreshRepoStatus(id);
              const msg = /CONFLICT|could not apply/i.test(pull.error) ? 'Conflicting changes from another device; open the folder and resolve them, then Sync again.' : pull.error;
              this._set(id, { lastError: 'pull: ' + msg, syncing: false });
              return { ok: false, error: msg };
            }
            // Pulled files may be new or changed: bring the notes in line before pushing.
            try { const r = await this.store.scanVault(id); if (r && (r.added || r.updated || r.removed)) this.onNotesChanged(id, r); } catch (_) { /* ignore */ }
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

  static async clone(url, destDir) {
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    const r = await git(['clone', '-q', url, destDir], path.dirname(destDir), 300000);
    return r.ok ? { ok: true, path: destDir } : { ok: false, error: r.error };
  }
}

module.exports = { VaultManager, git };
