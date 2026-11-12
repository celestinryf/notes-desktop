import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { launchSpec } from './claude-bin.mts';
import { parseTexLog } from './shared/tex-log.mts';
import { readMagic, rootFor, engineFor, engineArgs, latexmkArgs, pdfFor, needsBibtex, needsBiber, type TexOptions } from './tex-build.mts';
import type { TexInstall } from './tex-engine.mts';

export const COMPILE_CAP_MS = 120 * 1000;
const MAX_ENGINE_RUNS = 4;

type Exe = NonNullable<TexInstall['latexmk']>;

const running = new Map<string, () => void>();

function killTree(child: ChildProcess) {
  if (process.platform === 'win32' && child.pid) execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => child.kill());
  else child.kill();
}

function step(exe: Exe, args: string[], cwd: string, deadline: number, stopped: { on: boolean, kill: (() => void) | null }) {
  return new Promise<number | null>((resolve, reject) => {
    const spec = launchSpec(exe, args);
    let child: ChildProcess;
    try {
      child = spawn(spec.file, spec.args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'], env: Object.assign({}, process.env, spec.env) });
    } catch (err) { reject(err); return; }
    const timer = setTimeout(() => killTree(child), Math.max(0, deadline - Date.now()));
    stopped.kill = () => killTree(child);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => { clearTimeout(timer); stopped.kill = null; resolve(code); });
  });
}

const readIfThere = (file: string) => { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; } };
const modifiedSince = (file: string, since: number) => { try { return fs.statSync(file).mtimeMs >= since - 1000; } catch (_) { return false; } };

export function stopAllCompiles() {
  for (const stop of Array.from(running.values())) stop();
}

export function stopCompile(root: string) {
  const stop = running.get(path.resolve(root).toLowerCase());
  if (stop) stop();
  return !!stop;
}

export async function compileTex(filePath: string, source: string, install: TexInstall, options: TexOptions): Promise<TexCompileResult> {
  const magic = readMagic(source);
  const root = rootFor(filePath, magic);
  const key = path.resolve(root).toLowerCase();
  stopCompile(root);
  const started = Date.now();
  const deadline = started + COMPILE_CAP_MS;
  const steps: string[] = [];
  const stopped: { on: boolean, kill: (() => void) | null } = { on: false, kill: null };
  const stop = () => { stopped.on = true; if (stopped.kill) stopped.kill(); };
  running.set(key, stop);
  const cwd = path.dirname(root);
  const stem = path.basename(root).replace(/\.[^.]+$/, '');
  const logFile = path.join(cwd, stem + '.log');
  const engine = engineFor(magic, options);
  const finish = (): TexCompileResult | null => {
    if (stopped.on) return { ok: false, root, reason: 'stopped', message: 'Compiling stopped.', log: null, ms: Date.now() - started, steps };
    if (Date.now() >= deadline) return { ok: false, root, reason: 'timeout', message: 'Compiling took longer than 2 minutes and was stopped.', log: parseTexLog(readIfThere(logFile)), ms: Date.now() - started, steps };
    return null;
  };
  try {
    if (!fs.existsSync(root)) return { ok: false, root, reason: 'failed', message: 'The root file ' + path.basename(root) + ' named by "% !TEX root" does not exist.', log: null, ms: 0, steps };
    const exe = install.engines[engine];
    if (install.latexmk) {
      steps.push('latexmk');
      await step(install.latexmk, latexmkArgs(root, engine, options), cwd, deadline, stopped);
    } else {
      if (!exe) return { ok: false, root, reason: 'failed', message: 'This TeX installation has no ' + engine + '.', log: null, ms: 0, steps };
      let runs = 0;
      let bibDone = false;
      for (;;) {
        steps.push(engine);
        await step(exe, engineArgs(root, options), cwd, deadline, stopped);
        runs += 1;
        const early = finish();
        if (early) return early;
        const log = readIfThere(logFile);
        if (!bibDone) {
          bibDone = true;
          const aux = readIfThere(path.join(cwd, stem + '.aux'));
          const bib = magic.bib || (needsBiber(aux, log) ? 'biber' : needsBibtex(aux) ? 'bibtex' : null);
          const tool = bib === 'biber' ? install.biber : bib === 'bibtex' ? install.bibtex : null;
          if (bib && tool) { steps.push(bib); await step(tool, [stem], cwd, deadline, stopped); const after = finish(); if (after) return after; continue; }
        }
        if (runs >= MAX_ENGINE_RUNS || !parseTexLog(log).rerun) break;
      }
    }
    const early = finish();
    if (early) return early;
    const pdf = pdfFor(root);
    return { ok: true, root, pdf: modifiedSince(pdf, started) ? pdf : null, engine, log: parseTexLog(readIfThere(logFile)), ms: Date.now() - started, steps };
  } catch (err) {
    return { ok: false, root, reason: 'failed', message: 'Could not run ' + engine + ': ' + (err instanceof Error ? err.message : String(err)), log: null, ms: Date.now() - started, steps };
  } finally {
    if (running.get(key) === stop) running.delete(key);
  }
}
