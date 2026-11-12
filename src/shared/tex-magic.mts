export type TexMagic = { root: string | null, program: TexEngineName | null, bib: 'bibtex' | 'biber' | null };
export type TexOptions = Pick<TexNoteOptions, 'engine' | 'haltOnError'>;

export const ENGINES: readonly TexEngineName[] = ['pdflatex', 'xelatex', 'lualatex'];
export const ENGINE_LABELS: Record<TexEngineName, string> = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };
export const DEFAULT_TEX_OPTIONS: TexNoteOptions = { engine: 'pdflatex', haltOnError: false, compileOnSave: false };
export const TEX_FILE = /\.(tex|ltx|latex)$/i;

export const stemOf = (filePath: string) => filePath.replace(/\.[^./\\]+$/, '');

export function texOptionsPatch(raw: unknown): Partial<TexNoteOptions> {
  const patch: Partial<TexNoteOptions> = {};
  if (!raw || typeof raw !== 'object') return patch;
  const engine = 'engine' in raw ? ENGINES.find((e) => e === raw.engine) : undefined;
  if (engine) patch.engine = engine;
  if ('haltOnError' in raw && typeof raw.haltOnError === 'boolean') patch.haltOnError = raw.haltOnError;
  if ('compileOnSave' in raw && typeof raw.compileOnSave === 'boolean') patch.compileOnSave = raw.compileOnSave;
  return patch;
}

export function texOptionsFrom(raw: unknown): TexNoteOptions | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return Object.assign({}, DEFAULT_TEX_OPTIONS, texOptionsPatch(raw));
}

const MAGIC_LINES = 20;
const MAGIC = /^\s*%\s*!\s*TEX\s+(TS-program|program|root)\s*=\s*(.+?)\s*$/i;
const BIB_MAGIC = /^\s*%\s*!\s*BIB\s+(?:TS-)?program\s*=\s*(.+?)\s*$/i;

const asEngine = (name: string): TexEngineName | null => {
  const n = name.trim().toLowerCase().replace(/\.exe$/, '');
  return ENGINES.find((e) => e === n) || null;
};

export function readMagic(source: string): TexMagic {
  const magic: TexMagic = { root: null, program: null, bib: null };
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n').slice(0, MAGIC_LINES);
  for (const line of lines) {
    const bib = BIB_MAGIC.exec(line);
    if (bib) { const b = bib[1].trim().toLowerCase(); if (b === 'bibtex' || b === 'biber') magic.bib = b; continue; }
    const m = MAGIC.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === 'root' && !magic.root) magic.root = m[2];
    else if (key !== 'root' && !magic.program) magic.program = asEngine(m[2]);
  }
  return magic;
}
