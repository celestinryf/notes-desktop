import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { GitRun } from './git-run.mts';
import { isRecord } from './shared/helpers.mts';

type GitRunner = (args: string[], cwd: string, timeoutMs?: number, input?: string, env?: Record<string, string>) => Promise<GitRun>;

type UpdateCheck =
  | { state: 'current'; head: string }
  | { state: 'behind'; running: string; target: string; behind: number; lockChanged: boolean }
  | { state: 'diverged'; head: string; target: string }
  | { state: 'dirty'; head: string; target: string; files: string[] }
  | { state: 'error'; error: string };

interface UpdateResult { at: number; from: string; target: string; to: string; ok: boolean; error: string | null; transient: boolean; installed: boolean; noticed: boolean }

interface Relaunch { exe: string; args: string[]; env: NodeJS.ProcessEnv }
interface HelperTools { node: string | null; npm: { file: string; args: string[] } | null; git: { file: string; env: NodeJS.ProcessEnv } }

type Spawner = (file: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => { unref(): void };

const RESULT_FILE = 'self-update.json';
const JOB_FILE = 'self-update-job.json';
const BRANCH = 'main';
const FAILURE_BACKOFF_MS = 30 * 60 * 1000;
const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
const IN_PROGRESS = ['index.lock', 'MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD'];

function shortSha(sha: string) { return sha.slice(0, 7); }

function gitDirOf(root: string): string | null {
  const dotGit = path.join(root, '.git');
  try {
    if (fs.statSync(dotGit).isDirectory()) return dotGit;
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    return m ? path.resolve(root, m[1].trim()) : null;
  } catch (_) { return null; }
}

function inProgressOperation(gitDir: string): string | null {
  return IN_PROGRESS.find((name) => fs.existsSync(path.join(gitDir, name))) || null;
}

function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && k.toUpperCase() !== 'ELECTRON_RUN_AS_NODE') out[k] = v;
  return out;
}

function parseResult(text: string): UpdateResult | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch (_) { return null; }
  if (!isRecord(data)) return null;
  const { at, from, target, to, ok, error, transient, installed, noticed } = data;
  if (typeof at !== 'number' || typeof from !== 'string' || typeof to !== 'string' || typeof ok !== 'boolean') return null;
  return {
    at, from, to, ok, target: typeof target === 'string' ? target : to,
    error: typeof error === 'string' ? error : null, transient: transient === true, installed: installed === true, noticed: noticed === true,
  };
}

function defaultSpawn(file: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) {
  const child = spawn(file, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  return child;
}

class SelfUpdater {
  readonly root: string;
  readonly dataDir: string;
  private readonly gitDir: string | null;
  private readonly git: GitRunner;
  private readonly spawnFn: Spawner;
  private readonly helperScript: string;
  private running: string | null = null;
  private cached: { stamp: string; result: UpdateResult | null } | null = null;

  constructor(opts: { root: string; dataDir: string; git: GitRunner; spawn?: Spawner; helperScript?: string }) {
    this.root = opts.root;
    this.dataDir = opts.dataDir;
    this.gitDir = gitDirOf(opts.root);
    this.git = opts.git;
    this.spawnFn = opts.spawn || defaultSpawn;
    this.helperScript = opts.helperScript || path.join(opts.root, 'scripts', 'finish-update.js');
  }

  get resultFile() { return path.join(this.dataDir, RESULT_FILE); }

  async rememberRunning() {
    if (!this.gitDir) return;
    const head = await this.git(['rev-parse', 'HEAD'], this.root);
    this.running = head.ok ? head.stdout.trim() : null;
  }

  async check(): Promise<UpdateCheck> {
    if (!this.gitDir) return { state: 'error', error: 'Notes is not running from a git checkout' };
    const busy = inProgressOperation(this.gitDir);
    if (busy) return { state: 'error', error: 'a git operation is in progress (' + busy + ')' };
    const branch = await this.git(['symbolic-ref', '--short', '-q', 'HEAD'], this.root);
    if (!branch.ok || branch.stdout.trim() !== BRANCH) return { state: 'error', error: 'the checkout is not on ' + BRANCH + (branch.ok ? ' (' + branch.stdout.trim() + ')' : '') };
    const fetched = await this.git(['fetch', '--quiet', 'origin', BRANCH], this.root, 60000, undefined, NO_PROMPT);
    if (!fetched.ok) return { state: 'error', error: 'fetch failed: ' + fetched.error };
    const heads = await this.git(['rev-parse', 'HEAD', 'origin/' + BRANCH], this.root);
    if (!heads.ok) return { state: 'error', error: heads.error };
    const [head, target] = heads.stdout.trim().split(/\r?\n/);
    const running = this.running || head;
    if (running === target) return { state: 'current', head };
    const [ancestor, status] = await Promise.all([
      this.git(['merge-base', '--is-ancestor', head, target], this.root),
      this.git(['status', '--porcelain', '--untracked-files=no'], this.root),
    ]);
    if (!ancestor.ok) return { state: 'diverged', head, target };
    if (!status.ok) return { state: 'error', error: 'status failed: ' + status.error };
    const files = status.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim());
    if (files.length) return { state: 'dirty', head, target, files };
    const [count, lock] = await Promise.all([
      this.git(['rev-list', '--count', running + '..' + target], this.root),
      this.git(['diff', '--name-only', running, target, '--', 'package-lock.json'], this.root),
    ]);
    return { state: 'behind', running, target, behind: count.ok ? Math.max(1, Number(count.stdout.trim()) || 1) : 1, lockChanged: lock.ok && lock.stdout.trim().length > 0 };
  }

  lastResult(): UpdateResult | null {
    let stamp: string;
    try { const s = fs.statSync(this.resultFile); stamp = s.mtimeMs + ':' + s.size; } catch (_) { this.cached = null; return null; }
    if (!this.cached || this.cached.stamp !== stamp) {
      let text = '';
      try { text = fs.readFileSync(this.resultFile, 'utf8'); } catch (_) {  }
      this.cached = { stamp, result: parseResult(text) };
    }
    return this.cached.result;
  }

  failedFor(target: string) {
    const last = this.lastResult();
    return !!last && !last.ok && !last.transient && last.target === target;
  }

  holdOff(target: string, now = Date.now()): string | null {
    const last = this.lastResult();
    if (!last || last.ok) return null;
    if (!last.transient && last.target === target) return 'the update to ' + shortSha(target) + ' failed and waits to be retried by hand';
    if (now - last.at < FAILURE_BACKOFF_MS) return 'the last update failed less than half an hour ago';
    return null;
  }

  markNoticed() {
    const last = this.lastResult();
    if (!last || last.noticed) return;
    try { fs.writeFileSync(this.resultFile, JSON.stringify({ ...last, noticed: true })); this.cached = null; } catch (_) {  }
  }

  launchHelper(check: { running: string; target: string; lockChanged: boolean }, relaunch: Relaunch, tools: HelperTools): { ok: true } | { ok: false; error: string } {
    if (!tools.node) return { ok: false, error: 'node was not found on PATH' };
    if (check.lockChanged && !tools.npm) return { ok: false, error: 'this update changes the packages, and npm was not found on PATH' };
    const job = {
      pid: process.pid, root: this.root, dataDir: this.dataDir, from: check.running, target: check.target,
      git: { file: tools.git.file, env: { ...cleanEnv(tools.git.env), ...NO_PROMPT } }, npm: tools.npm,
      exe: relaunch.exe, args: relaunch.args,
    };
    const jobFile = path.join(this.dataDir, JOB_FILE);
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(jobFile, JSON.stringify(job));
      this.spawnFn(tools.node, [this.helperScript, jobFile], { cwd: this.root, env: cleanEnv(relaunch.env) }).unref();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    return { ok: true };
  }
}

function describe(check: UpdateCheck, opts: { failed: boolean; auto: boolean }): string {
  switch (check.state) {
    case 'current': return 'Notes is up to date (' + shortSha(check.head) + ').';
    case 'behind': {
      if (opts.failed) return 'The update to ' + shortSha(check.target) + ' failed last time. Retry it from the command palette, or see self-update.log in the data folder.';
      const count = check.behind + (check.behind === 1 ? ' change' : ' changes') + ' behind main.';
      return 'Notes has an update: ' + count + (opts.auto ? ' It restarts on its own while hidden.' : ' Restart when you are ready.');
    }
    case 'diverged': return 'Notes is running from a branch with its own commits, so it was not updated.';
    case 'dirty': return 'Notes was not updated: the checkout has unsaved changes (' + check.files.slice(0, 3).join(', ') + (check.files.length > 3 ? ', …' : '') + ').';
    case 'error': return 'Could not check for updates: ' + check.error;
  }
}

export type { UpdateCheck, UpdateResult };
export { SelfUpdater, describe, parseResult, shortSha, cleanEnv, gitDirOf, inProgressOperation, RESULT_FILE, JOB_FILE, FAILURE_BACKOFF_MS };
