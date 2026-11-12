import fs from 'node:fs';
import path from 'node:path';
import { detectTex, runQuietly, type TexDetection, type Runner } from './tex-engine.mts';
import { compileTex, isCompiling, stopCompile } from './tex-compile.mts';
import { buildFiles, pdfFor, readMagic, rootFor } from './tex-build.mts';
import { forwardSearch, inverseSearch, loadBoxes, syncFileFor } from './tex-sync.mts';
import { stemOf } from './shared/tex-magic.mts';

export const NO_TEX = 'Notes could not find TeX on this PC. It looked on PATH and in the MiKTeX and TeX Live folders. Install MiKTeX or TeX Live, then compile again.';

const readSource = (filePath: string) => { try { return fs.readFileSync(filePath, 'utf8'); } catch (_) { return null; } };
const failure = (message: string): TexCompileResult => ({ ok: false, root: null, reason: 'failed', message, log: null, ms: 0, steps: [] });

export class TexService {
  detection: Promise<TexDetection> | null = null;
  env: Record<string, string | undefined>;
  run: Runner;
  roots = new Map<string, string>();

  constructor(env: Record<string, string | undefined>, run: Runner = runQuietly) {
    this.env = env;
    this.run = run;
  }

  find(again?: boolean) {
    if (again || !this.detection) this.detection = detectTex(this.env, this.run);
    return this.detection;
  }

  async status(again?: boolean): Promise<TexStatus> {
    const found = await this.find(again);
    if (!found.install) return { found: false, looked: found.looked, problem: found.problem };
    return { found: true, distribution: found.install.distribution, dir: found.install.dir, latexmk: !!found.install.latexmk };
  }

  rootOf(filePath: string) {
    const source = readSource(filePath);
    if (source === null) return { error: 'The file ' + path.basename(filePath) + ' is no longer on disk.' };
    const magic = readMagic(source);
    const found = rootFor(filePath, magic);
    if ('error' in found) return found;
    if (!fs.existsSync(found.root)) return { error: 'The root file ' + path.basename(found.root) + ' named by "% !TEX root" does not exist.' };
    return { root: found.root, magic };
  }

  async compile(noteId: string, filePath: string, options: TexNoteOptions, capMs?: number): Promise<TexCompileResult> {
    const found = await this.find();
    if (!found.install) return { ok: false, root: null, reason: 'no-tex', message: found.problem || NO_TEX, log: null, ms: 0, steps: [] };
    const target = this.rootOf(filePath);
    if ('error' in target) return failure(target.error);
    this.roots.set(noteId, target.root);
    return compileTex({ root: target.root, magic: target.magic, install: found.install, options: { engine: options.engine, haltOnError: options.haltOnError }, capMs });
  }

  forward(filePath: string, line: number): TexBox | null {
    const target = this.rootOf(filePath);
    if ('error' in target) return null;
    const boxes = loadBoxes(target.root);
    const box = boxes ? forwardSearch(boxes, filePath, line) : null;
    return box ? Object.assign({ pdf: pdfFor(target.root) }, box) : null;
  }

  inverse(pdfPath: string, page: number, x: number, y: number): TexSource | null {
    const boxes = loadBoxes(pdfPath);
    const found = boxes ? inverseSearch(boxes, page, x, y) : null;
    return found && fs.existsSync(found.filePath) ? found : null;
  }

  sourceFor(pdfPath: string) {
    const stem = stemOf(pdfPath);
    const source = ['.tex', '.ltx', '.latex'].map((ext) => stem + ext).find((f) => fs.existsSync(f));
    return source && syncFileFor(pdfPath) ? source : null;
  }

  stop(noteId: string) {
    const root = this.roots.get(noteId);
    return root ? stopCompile(root) : false;
  }

  clean(noteId: string, filePath: string) {
    const current = this.rootOf(filePath);
    const known = this.roots.get(noteId);
    const target = 'error' in current && known ? { root: known } : current;
    if ('error' in target) throw new Error(target.error);
    if (isCompiling(target.root)) throw new Error('Stop the compile, or wait for it, before clearing its files.');
    let removed = 0;
    for (const f of buildFiles(target.root)) {
      try { fs.unlinkSync(f); removed += 1; } catch (_) {  }
    }
    return removed;
  }
}
