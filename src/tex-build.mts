import path from 'node:path';
import type { TexMagic, TexOptions } from './shared/tex-magic.mts';

export { ENGINES, DEFAULT_TEX_OPTIONS, texOptionsFrom, texOptionsPatch, readMagic, type TexMagic, type TexOptions } from './shared/tex-magic.mts';

export function rootFor(filePath: string, magic: TexMagic) {
  if (!magic.root) return filePath;
  const root = path.resolve(path.dirname(filePath), magic.root);
  return /\.(tex|ltx|latex)$/i.test(root) ? root : root + '.tex';
}

export function engineFor(magic: TexMagic, options: TexOptions): TexEngineName {
  return magic.program || options.engine;
}

export function engineArgs(file: string, options: TexOptions) {
  return ['-interaction=nonstopmode', '-synctex=1', '-file-line-error'].concat(options.haltOnError ? ['-halt-on-error'] : [], [path.basename(file)]);
}

export function latexmkArgs(file: string, engine: TexEngineName, options: TexOptions) {
  const mode = engine === 'xelatex' ? '-pdfxe' : engine === 'lualatex' ? '-pdflua' : '-pdf';
  return [mode, '-interaction=nonstopmode', '-synctex=1', '-file-line-error'].concat(options.haltOnError ? ['-halt-on-error'] : [], [path.basename(file)]);
}

export const BUILD_EXTENSIONS = ['aux', 'log', 'out', 'toc', 'lof', 'lot', 'fls', 'fdb_latexmk', 'synctex.gz', 'synctex', 'bbl', 'blg', 'bcf', 'run.xml', 'nav', 'snm', 'vrb', 'xdv', 'idx', 'ilg', 'ind'];

export function buildFiles(root: string) {
  const dir = path.dirname(root);
  const stem = path.basename(root).replace(/\.[^.]+$/, '');
  return BUILD_EXTENSIONS.map((ext) => path.join(dir, stem + '.' + ext));
}

export function pdfFor(root: string) {
  return root.replace(/\.[^./\\]+$/, '') + '.pdf';
}

export function needsBibtex(aux: string) {
  return /\\bibdata\{/.test(aux);
}

export function needsBiber(aux: string, log: string) {
  return /\\abx@aux@/.test(aux) || /Please \(re\)run Biber/.test(log);
}
