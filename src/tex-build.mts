import path from 'node:path';
import { TEX_FILE, stemOf, type TexMagic, type TexOptions } from './shared/tex-magic.mts';

export { ENGINES, DEFAULT_TEX_OPTIONS, texOptionsFrom, texOptionsPatch, readMagic, stemOf, type TexMagic, type TexOptions } from './shared/tex-magic.mts';

export const ROOT_LEVELS_UP = 3;

const isInside = (dir: string, inner: string) => {
  const rel = path.relative(dir, inner);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
};

export function rootFor(filePath: string, magic: TexMagic): { root: string } | { error: string } {
  if (!magic.root) return { root: filePath };
  const named = path.resolve(path.dirname(filePath), magic.root);
  const root = TEX_FILE.test(named) ? named : named + '.tex';
  const here = path.dirname(filePath);
  let allowed = here;
  for (let i = 0; i < ROOT_LEVELS_UP && path.dirname(allowed) !== allowed; i++) allowed = path.dirname(allowed);
  const rootDir = path.dirname(root);
  const ancestorOfHere = isInside(rootDir, here) && isInside(allowed, rootDir);
  if (!ancestorOfHere && !isInside(here, rootDir)) return { error: 'The "% !TEX root" line names ' + root + ', which is outside this file\'s folder and the ' + ROOT_LEVELS_UP + ' folders above it, so Notes does not compile it.' };
  return { root };
}

export function engineFor(magic: TexMagic, options: TexOptions): TexEngineName {
  return magic.program || options.engine;
}

const flags = (options: TexOptions) => ['-interaction=nonstopmode', '-synctex=1', '-file-line-error'].concat(options.haltOnError ? ['-halt-on-error'] : []);

export function engineArgs(file: string, options: TexOptions) {
  return flags(options).concat(path.basename(file));
}

export function latexmkArgs(file: string, engine: TexEngineName, options: TexOptions) {
  const mode = engine === 'xelatex' ? '-pdfxe' : engine === 'lualatex' ? '-pdflua' : '-pdf';
  return [mode, '-norc'].concat(flags(options), path.basename(file));
}

export const BUILD_EXTENSIONS = ['aux', 'log', 'out', 'toc', 'lof', 'lot', 'fls', 'fdb_latexmk', 'synctex.gz', 'synctex', 'bbl', 'blg', 'bcf', 'run.xml', 'nav', 'snm', 'vrb', 'xdv', 'idx', 'ilg', 'ind'];

export function buildFiles(root: string) {
  const stem = stemOf(root);
  return BUILD_EXTENSIONS.map((ext) => stem + '.' + ext);
}

export function pdfFor(root: string) {
  return stemOf(root) + '.pdf';
}

export function needsBibtex(aux: string) {
  return /\\bibdata\{/.test(aux);
}

export function needsBiber(aux: string, log: string) {
  return /\\abx@aux@/.test(aux) || /Please \(re\)run Biber/.test(log);
}
