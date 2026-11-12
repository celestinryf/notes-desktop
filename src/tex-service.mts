import fs from 'node:fs';
import { detectTex, runQuietly, type TexDetection, type Runner } from './tex-engine.mts';
import { compileTex, stopCompile } from './tex-compile.mts';
import { buildFiles, readMagic, rootFor } from './tex-build.mts';

export const NO_TEX = 'Notes could not find TeX on this PC. It looked on PATH and in the MiKTeX and TeX Live folders. Install MiKTeX or TeX Live, then compile again.';

const readSource = (filePath: string) => { try { return fs.readFileSync(filePath, 'utf8'); } catch (_) { return ''; } };
const rootOf = (filePath: string) => rootFor(filePath, readMagic(readSource(filePath)));

export class TexService {
  detection: Promise<TexDetection> | null = null;
  env: Record<string, string | undefined>;
  run: Runner;

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

  async compile(filePath: string, options: TexNoteOptions): Promise<TexCompileResult> {
    const found = await this.find();
    if (!found.install) {
      return { ok: false, root: null, reason: 'no-tex', message: found.problem || NO_TEX, log: null, ms: 0, steps: [] };
    }
    return compileTex(filePath, readSource(filePath), found.install, { engine: options.engine, haltOnError: options.haltOnError });
  }

  stop(filePath: string) {
    return stopCompile(rootOf(filePath));
  }

  clean(filePath: string) {
    let removed = 0;
    for (const f of buildFiles(rootOf(filePath))) {
      try { fs.unlinkSync(f); removed += 1; } catch (_) {  }
    }
    return removed;
  }
}
