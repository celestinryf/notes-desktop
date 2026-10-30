import { execFile, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { gitBinary } from './git-binary.mts';

type GitRun =
  { ok: true, code: 0, stdout: string, stderr: string, error: null } |
  { ok: false, code: string | number | null | undefined, stdout: string, stderr: string, error: string };

const AUTHOR = ['-c', 'user.name=Notes', '-c', 'user.email=notes@localhost'];

function run(args: string[], cwd: string, timeoutMs?: number, input?: string, env?: Record<string, string>): Promise<GitRun> {
  const git = gitBinary(process.env, env);
  return new Promise((resolve) => {
    const child = execFile(git.file, args, { cwd, timeout: timeoutMs || 20000, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: git.env }, (err, stdout, stderr) => {
      const out = { stdout: String(stdout || ''), stderr: String(stderr || '') };
      resolve(err ? { ok: false, code: err.code, ...out, error: String(stderr || err.message).trim() } : { ok: true, code: 0, ...out, error: null });
    });
    if (input !== undefined && child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}

function runBytes(args: string[], cwd: string, maxBuffer: number): Promise<Buffer | null> {
  const git = gitBinary();
  return new Promise((resolve) => {
    execFile(git.file, args, { cwd, timeout: 20000, windowsHide: true, maxBuffer, encoding: 'buffer', env: git.env }, (err, stdout) => resolve(err ? null : stdout));
  });
}

function spawnGit(args: string[], cwd: string): ChildProcessWithoutNullStreams {
  const git = gitBinary();
  return spawn(git.file, args, { cwd, windowsHide: true, env: git.env });
}

export type { GitRun };
export { run, runBytes, spawnGit, AUTHOR };
