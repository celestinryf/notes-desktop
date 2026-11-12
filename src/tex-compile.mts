import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { launchSpec } from './claude-bin.mts';
import { parseTexLog } from './shared/tex-log.mts';
import { engineFor, engineArgs, latexmkArgs, pdfFor, needsBibtex, needsBiber, stemOf, type TexMagic, type TexOptions } from './tex-build.mts';
import type { TexInstall } from './tex-engine.mts';

export const COMPILE_CAP_MS = 120 * 1000;
const MAX_ENGINE_RUNS = 4;
const CLOCK_SLACK_MS = 3000;

type Exe = NonNullable<TexInstall['latexmk']>;
type Running = { stop: () => void, done: Promise<void> };
export type CompileJob = { root: string, magic: TexMagic, install: TexInstall, options: TexOptions, capMs?: number };

const running = new Map<string, Running>();
const keyOf = (root: string) => (process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root));

function killTree(child: ChildProcess) {
  if (!child.pid) { child.kill(); return; }
  if (process.platform === 'win32') { execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => child.kill()); return; }
  try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { child.kill('SIGKILL'); }
}

type StepControl = { stopped: boolean, kill: (() => void) | null };

function step(exe: Exe, args: string[], cwd: string, deadline: number, control: StepControl) {
  return new Promise<number | null>((resolve, reject) => {
    const spec = launchSpec(exe, args);
    let child: ChildProcess;
    try {
      child = spawn(spec.file, spec.args, { cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore'], env: Object.assign({}, process.env, spec.env) });
    } catch (err) { reject(err); return; }
    const timer = setTimeout(() => killTree(child), Math.max(0, deadline - Date.now()));
    control.kill = () => killTree(child);
    child.on('error', (err) => { clearTimeout(timer); control.kill = null; reject(err); });
    child.on('close', (code) => { clearTimeout(timer); control.kill = null; resolve(code); });
  });
}

function writtenSince(file: string, since: number) {
  try { return fs.statSync(file).mtimeMs >= since - CLOCK_SLACK_MS; } catch (_) { return false; }
}

const readText = (file: string) => { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; } };
const readFresh = (file: string, since: number) => (writtenSince(file, since) ? readText(file) : '');
const noLog = (tool: string, code: number | null) => tool + ' stopped before writing its log' + (code === null ? '.' : ' (exit code ' + code + ').');

export function isCompiling(root: string) {
  return running.has(keyOf(root));
}

export function stopCompile(root: string) {
  const job = running.get(keyOf(root));
  if (job) job.stop();
  return !!job;
}

export function stopAllCompiles() {
  for (const job of Array.from(running.values())) job.stop();
}

export async function compileTex(job: CompileJob): Promise<TexCompileResult> {
  const { root, magic, install, options } = job;
  const key = keyOf(root);
  const steps: string[] = [];
  const control: StepControl = { stopped: false, kill: null };
  let finished = () => {};
  const done = new Promise<void>((resolve) => { finished = resolve; });
  const stop = () => { control.stopped = true; if (control.kill) control.kill(); };
  const mine: Running = { stop, done };
  const before = running.get(key);
  running.set(key, mine);
  let started = Date.now();
  const cwd = path.dirname(root);
  const stem = path.basename(stemOf(root));
  const logFile = path.join(cwd, stem + '.log');
  const engine = engineFor(magic, options);
  const capMs = job.capMs ?? COMPILE_CAP_MS;
  let deadline = started + capMs;
  const failed = (reason: 'stopped' | 'timeout' | 'failed', message: string): TexCompileResult => {
    const log = readFresh(logFile, started);
    return { ok: false, root, reason, message, log: log ? parseTexLog(log) : null, ms: Date.now() - started, steps };
  };
  const interrupted = () => {
    if (control.stopped) return failed('stopped', 'Compiling stopped.');
    if (Date.now() >= deadline) return failed('timeout', 'Compiling took longer than ' + Math.round(capMs / 60000) + ' minutes and was stopped.');
    return null;
  };
  try {
    if (before) { before.stop(); await before.done; }
    if (control.stopped || running.get(key) !== mine) return failed('stopped', 'Compiling stopped.');
    started = Date.now();
    deadline = started + capMs;
    const exe = install.engines[engine];
    if (install.latexmk) {
      steps.push('latexmk');
      const code = await step(install.latexmk, latexmkArgs(root, engine, options), cwd, deadline, control);
      const stopped = interrupted();
      if (stopped) return stopped;
      const upToDate = code === 0 && !writtenSince(logFile, started);
      const log = upToDate ? readText(logFile) : readFresh(logFile, started);
      if (!log) return failed('failed', noLog('latexmk', code));
      const pdf = pdfFor(root);
      return { ok: true, root, pdf: writtenSince(pdf, started) || (upToDate && fs.existsSync(pdf)) ? pdf : null, engine, log: parseTexLog(log), ms: Date.now() - started, steps };
    }
    if (!exe) return failed('failed', 'This TeX installation has no ' + engine + '.');
    let bibDone = false;
    for (let runs = 1; ; runs++) {
      steps.push(engine);
      const code = await step(exe, engineArgs(root, options), cwd, deadline, control);
      const stopped = interrupted();
      if (stopped) return stopped;
      const log = readFresh(logFile, started);
      if (!log) return failed('failed', noLog(engine, code));
      if (!bibDone) {
        bibDone = true;
        const aux = readFresh(path.join(cwd, stem + '.aux'), started);
        const bib = magic.bib || (needsBiber(aux, log) ? 'biber' : needsBibtex(aux) ? 'bibtex' : null);
        const tool = bib === 'biber' ? install.biber : bib === 'bibtex' ? install.bibtex : null;
        if (bib && tool) {
          steps.push(bib);
          await step(tool, [stem], cwd, deadline, control);
          const afterBib = interrupted();
          if (afterBib) return afterBib;
          continue;
        }
      }
      if (runs >= MAX_ENGINE_RUNS || !parseTexLog(log).rerun) break;
    }
    const pdf = pdfFor(root);
    return { ok: true, root, pdf: writtenSince(pdf, started) ? pdf : null, engine, log: parseTexLog(readFresh(logFile, started)), ms: Date.now() - started, steps };
  } catch (err) {
    return failed('failed', 'Could not run ' + engine + ': ' + (err instanceof Error ? err.message : String(err)));
  } finally {
    if (running.get(key) === mine) running.delete(key);
    finished();
  }
}
