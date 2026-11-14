import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { resolveExecutable, launchSpec } from './claude-bin.mts';
import { ENGINES } from './tex-build.mts';

type Exe = NonNullable<ReturnType<typeof resolveExecutable>>;
export type TexInstall = {
  dir: string,
  distribution: string,
  engines: Partial<Record<TexEngineName, Exe>>,
  latexmk: Exe | null,
  bibtex: Exe | null,
  biber: Exe | null,
};
export type TexDetection = { install: TexInstall | null, looked: string[], problem: string | null };
export type RunResult = { code: number | null, stdout: string };
export type Runner = (exe: Exe, args: string[]) => Promise<RunResult>;
type Env = Record<string, string | undefined>;

const PROBE_FILE = 'article.cls';
const names = (name: string) =>(process.platform === 'win32' ? [name + '.exe', name + '.cmd', name] : [name]);
const find = (dir: string, name: string) => resolveExecutable(names(name), { pathDirs: [dir] });

function isDir(p: string) {
  try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
}

function texLiveDirs(drive: string) {
  const top = path.join(drive + path.sep, 'texlive');
  let years: string[] = [];
  try { years = fs.readdirSync(top).filter((y) => /^\d{4}$/.test(y)).sort().reverse(); } catch (_) { return []; }
  return years.flatMap((y) => ['windows', 'win64', 'win32'].map((b) => path.join(top, y, 'bin', b)));
}

export function candidateDirs(env: Env) {
  if (env.NOTES_APP_TEX_DIR) return [path.resolve(env.NOTES_APP_TEX_DIR)];
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'));
  if (env.ProgramFiles) dirs.push(path.join(env.ProgramFiles, 'MiKTeX', 'miktex', 'bin', 'x64'));
  dirs.push(...texLiveDirs(env.SystemDrive || 'C:'));
  const seen = new Set<string>();
  return dirs.filter((d) => { const k = path.resolve(d).toLowerCase(); if (seen.has(k) || !isDir(d)) return false; seen.add(k); return true; });
}

export const runQuietly: Runner = (exe, args) => new Promise((resolve) => {
  const spec = launchSpec(exe, args);
  execFile(spec.file, spec.args, { windowsHide: true, timeout: 15000, env: Object.assign({}, process.env, spec.env), encoding: 'utf8' }, (err, stdout) => {
    const code = err ? (typeof err.code === 'number' ? err.code : null) : 0;
    resolve({ code, stdout: String(stdout || '') });
  });
});

export function distributionOf(versionLine: string) {
  const first = String(versionLine || '').split('\n')[0];
  const m = /\((MiKTeX [\d.]+|TeX Live \d{4}[^)]*)\)/.exec(first) || /\(([^)]+)\)/.exec(first);
  return m ? m[1] : first.trim().slice(0, 80) || 'TeX';
}

export async function detectTex(env: Env, run: Runner = runQuietly): Promise<TexDetection> {
  const looked = candidateDirs(env);
  for (const dir of looked) {
    const engines: Partial<Record<TexEngineName, Exe>> = {};
    for (const e of ENGINES) { const exe = find(dir, e); if (exe) engines[e] = exe; }
    const first = ENGINES.map((e) => engines[e]).find((x) => !!x);
    if (!first) continue;
    const kpsewhich = find(dir, 'kpsewhich');
    if (!kpsewhich) return { install: null, looked, problem: 'Found ' + path.join(dir, 'pdflatex') + ' but no kpsewhich beside it, so the TeX installation looks incomplete.' };
    const check = await run(kpsewhich, [PROBE_FILE]);
    if (check.code === null) return { install: null, looked, problem: 'Found TeX in ' + dir + ', but kpsewhich did not run. Repair the installation with its own console.' };
    if (check.code !== 0 || !check.stdout.trim()) return { install: null, looked, problem: 'Found TeX in ' + dir + ', but it cannot find ' + PROBE_FILE + ', so LaTeX itself looks missing. Repair the installation with its own console.' };
    const version = await run(first, ['--version']);
    const latexmk = find(dir, 'latexmk');
    const latexmkWorks = latexmk ? (await run(latexmk, ['-v'])).code === 0 : false;
    return {
      install: { dir, distribution: distributionOf(version.stdout), engines, latexmk: latexmkWorks ? latexmk : null, bibtex: find(dir, 'bibtex'), biber: find(dir, 'biber') },
      looked,
      problem: null,
    };
  }
  return { install: null, looked, problem: null };
}
