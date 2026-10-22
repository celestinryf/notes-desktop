import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { resolveExecutable, launchSpec } from './claude-bin.mts';

const EXT = new Set(['xlsx', 'xls', 'epub', 'msg', 'zip']);
const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 2 * 60 * 1000;
const NAMES = process.platform === 'win32' ? ['markitdown.exe', 'markitdown'] : ['markitdown'];

let found: ReturnType<typeof resolveExecutable> | undefined;
function executable() {
  if (found === undefined) {
    const override = process.env.NOTES_APP_MARKITDOWN_BIN;
    found = override ? resolveExecutable([], { override }) : resolveExecutable(NAMES);
  }
  return found;
}
const available = () => !!executable();
const reads = (ext: string) => EXT.has(ext);

async function toMarkdown(filePath: string) {
  const exe = executable();
  if (!exe) throw new Error('MarkItDown is not installed (pip install "markitdown[all]").');
  if (fs.statSync(filePath).size > MAX_INPUT_BYTES) throw new Error('This file is larger than 100 MB.');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-markitdown-'));
  const out = path.join(outDir, 'out.md');
  try {
    await run(exe, [filePath, '-o', out]);
    if (fs.statSync(out).size > MAX_OUTPUT_BYTES) throw new Error('The converted text is larger than 20 MB.');
    return { markdown: fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n'), warning: '' };
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) {  }
  }
}

function run(exe: NonNullable<typeof found>, args: string[]) {
  const spec = launchSpec(exe, args);
  return (new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(spec.file, spec.args, {
        shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
        env: Object.assign({}, process.env, spec.env, { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }),
      });
    } catch (err) { reject(err); return; }
    let err = '';
    let timedOut = false;
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('MarkItDown took longer than 2 minutes.'));
      else if (code === 0) resolve();
      else reject(new Error('MarkItDown could not read this file' + (err.trim() ? ': ' + lastLine(err) : '.')));
    });
  }) as Promise<void>);
}
function killTree(child: ChildProcess) {
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => child.kill());
  else child.kill();
}
const lastLine = (s: string) => (s.trim().split(/\r?\n/).pop() || '').slice(0, 300);

export { EXT, available, reads, toMarkdown };
