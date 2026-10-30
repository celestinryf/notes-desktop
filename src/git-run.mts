import { execFile } from 'node:child_process';

type GitRun = { ok: boolean, code: string | number | null | undefined, stdout: string, stderr: string, error: string | null };

const AUTHOR = ['-c', 'user.name=Notes', '-c', 'user.email=notes@localhost'];

function run(args: string[], cwd: string, timeoutMs?: number, input?: string, env?: Record<string, string>): Promise<GitRun> {
  return new Promise((resolve) => {
    const child = execFile('git', args, { cwd, timeout: timeoutMs || 20000, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: env ? Object.assign({}, process.env, env) : process.env }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? String(stderr || err.message).trim() : null });
    });
    if (input !== undefined && child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}

function runBytes(args: string[], cwd: string, maxBuffer: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 20000, windowsHide: true, maxBuffer, encoding: 'buffer' }, (err, stdout) => resolve(err ? null : stdout));
  });
}

export type { GitRun };
export { run, runBytes, AUTHOR };
