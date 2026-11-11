import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { GitRun } from './git-run.mts';
import { isRecord } from './shared/helpers.mts';

type GitRunner = (args: string[], cwd: string, timeoutMs?: number) => Promise<GitRun>;

type UpdateCheck =
  | { state: 'current'; head: string }
  | { state: 'behind'; head: string; target: string; behind: number; lockChanged: boolean }
  | { state: 'diverged'; head: string; target: string }
  | { state: 'dirty'; head: string; target: string; files: string[] }
  | { state: 'error'; error: string };

interface UpdateResult { at: number; from: string; to: string; ok: boolean; error: string | null; installed: boolean; noticed: boolean }

interface Relaunch { exe: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }
interface HelperTools { node: string | null; npm: { file: string; args: string[] } | null; git: { file: string; env: NodeJS.ProcessEnv } }
interface HelperJob {
  pid: number; root: string; dataDir: string; from: string; target: string;
  git: { file: string; env: Record<string, string> }; npm: { file: string; args: string[] } | null;
  exe: string; args: string[]; cwd: string;
}

type Spawner = (file: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => { unref(): void };

const RESULT_FILE = 'self-update.json';
const LOG_FILE = 'self-update.log';
const JOB_FILE = 'self-update-job.json';
const LOCK_FILE = 'package-lock.json';
const BRANCH = 'main';

function shortSha(sha: string) { return sha.slice(0, 7); }

function hasRepo(root: string) {
  try { return fs.existsSync(path.join(root, '.git')); } catch (_) { return false; }
}

function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && k !== 'ELECTRON_RUN_AS_NODE') out[k] = v;
  return out;
}

function parseResult(text: string): UpdateResult | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch (_) { return null; }
  if (!isRecord(data)) return null;
  const { at, from, to, ok, error, installed, noticed } = data;
  if (typeof at !== 'number' || typeof from !== 'string' || typeof to !== 'string' || typeof ok !== 'boolean') return null;
  return { at, from, to, ok, error: typeof error === 'string' ? error : null, installed: installed === true, noticed: noticed === true };
}

function defaultSpawn(file: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) {
  const child = spawn(file, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {});
  return child;
}

class SelfUpdater {
  readonly root: string;
  readonly dataDir: string;
  private readonly git: GitRunner;
  private readonly spawnFn: Spawner;
  private readonly helperScript: string;

  constructor(opts: { root: string; dataDir: string; git: GitRunner; spawn?: Spawner; helperScript?: string }) {
    this.root = opts.root;
    this.dataDir = opts.dataDir;
    this.git = opts.git;
    this.spawnFn = opts.spawn || defaultSpawn;
    this.helperScript = opts.helperScript || path.join(opts.root, 'scripts', 'finish-update.js');
  }

  get resultFile() { return path.join(this.dataDir, RESULT_FILE); }
  get logFile() { return path.join(this.dataDir, LOG_FILE); }

  async check(): Promise<UpdateCheck> {
    if (!hasRepo(this.root)) return { state: 'error', error: 'Notes is not running from a git checkout' };
    const fetched = await this.git(['fetch', '--quiet', 'origin', BRANCH], this.root, 60000);
    if (!fetched.ok) return { state: 'error', error: 'fetch failed: ' + fetched.error };
    const head = await this.git(['rev-parse', 'HEAD'], this.root);
    const target = await this.git(['rev-parse', 'origin/' + BRANCH], this.root);
    if (!head.ok || !target.ok) return { state: 'error', error: (head.error || target.error || 'rev-parse failed') };
    const headSha = head.stdout.trim();
    const targetSha = target.stdout.trim();
    if (headSha === targetSha) return { state: 'current', head: headSha };
    const ancestor = await this.git(['merge-base', '--is-ancestor', headSha, targetSha], this.root);
    if (!ancestor.ok) return { state: 'diverged', head: headSha, target: targetSha };
    const status = await this.git(['status', '--porcelain', '--untracked-files=no'], this.root);
    if (!status.ok) return { state: 'error', error: 'status failed: ' + status.error };
    const files = status.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim());
    if (files.length) return { state: 'dirty', head: headSha, target: targetSha, files };
    const count = await this.git(['rev-list', '--count', headSha + '..' + targetSha], this.root);
    const lock = await this.git(['diff', '--name-only', headSha, targetSha, '--', LOCK_FILE], this.root);
    return {
      state: 'behind', head: headSha, target: targetSha,
      behind: count.ok ? Math.max(1, Number(count.stdout.trim()) || 1) : 1,
      lockChanged: lock.ok && lock.stdout.trim().length > 0,
    };
  }

  lastResult(): UpdateResult | null {
    let text: string;
    try { text = fs.readFileSync(this.resultFile, 'utf8'); } catch (_) { return null; }
    return parseResult(text);
  }

  failedFor(target: string) {
    const last = this.lastResult();
    return !!last && !last.ok && last.to === target;
  }

  markNoticed() {
    const last = this.lastResult();
    if (!last || last.noticed) return;
    try { fs.writeFileSync(this.resultFile, JSON.stringify({ ...last, noticed: true })); } catch (_) {  }
  }

  launchHelper(check: Extract<UpdateCheck, { state: 'behind' }>, relaunch: Relaunch, tools: HelperTools): { ok: true } | { ok: false; error: string } {
    if (!tools.node) return { ok: false, error: 'node was not found on PATH' };
    if (check.lockChanged && !tools.npm) return { ok: false, error: 'this update changes the packages, and npm was not found on PATH' };
    const job: HelperJob = {
      pid: process.pid, root: this.root, dataDir: this.dataDir, from: check.head, target: check.target,
      git: { file: tools.git.file, env: cleanEnv(tools.git.env) }, npm: check.lockChanged ? tools.npm : null,
      exe: relaunch.exe, args: relaunch.args, cwd: relaunch.cwd,
    };
    const jobFile = path.join(this.dataDir, JOB_FILE);
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(jobFile, JSON.stringify(job));
      const child = this.spawnFn(tools.node, [this.helperScript, jobFile], { cwd: this.root, env: cleanEnv(relaunch.env) });
      child.unref();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    return { ok: true };
  }
}

function describe(check: UpdateCheck, failed: boolean): string {
  switch (check.state) {
    case 'current': return 'Notes is up to date (' + shortSha(check.head) + ').';
    case 'behind': return failed
      ? 'The update to ' + shortSha(check.target) + ' failed last time. Try again from the command palette, or see self-update.log in the data folder.'
      : 'Notes has an update: ' + check.behind + (check.behind === 1 ? ' change' : ' changes') + ' behind main. It restarts on its own while hidden.';
    case 'diverged': return 'Notes is running from a branch with its own commits, so it was not updated.';
    case 'dirty': return 'Notes was not updated: the checkout has unsaved changes (' + check.files.slice(0, 3).join(', ') + (check.files.length > 3 ? ', …' : '') + ').';
    case 'error': return 'Could not check for updates: ' + check.error;
  }
}

export type { UpdateCheck, UpdateResult, Relaunch, HelperTools, HelperJob, GitRunner };
export { SelfUpdater, describe, parseResult, shortSha, RESULT_FILE, LOG_FILE, JOB_FILE, LOCK_FILE, BRANCH };
