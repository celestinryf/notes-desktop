import fs from 'node:fs';
import { resolveGitBinary, setupEnvironment } from 'dugite';

type GitBinary = { file: string, env: NodeJS.ProcessEnv, bundled: boolean };

function isFile(p: string) {
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

function gitBinary(processEnv: NodeJS.ProcessEnv = process.env, extra?: Record<string, string>): GitBinary {
  const bundledFile = resolveGitBinary(processEnv.LOCAL_GIT_DIRECTORY);
  if (!isFile(bundledFile)) return { file: 'git', env: extra ? Object.assign({}, processEnv, extra) : processEnv, bundled: false };
  const { env, gitLocation } = setupEnvironment(extra || {}, processEnv);
  return { file: gitLocation, env, bundled: true };
}

export type { GitBinary };
export { gitBinary };
