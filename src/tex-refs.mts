import fs from 'node:fs';
import path from 'node:path';
import { bibEntries, labelsIn, definitionsIn, mergeReferences, withoutComments } from './shared/tex-refs.mts';

const MAX_TEX_FILES = 40;
const MAX_BIB_FILES = 10;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_LISTED = 500;
const MAX_VISITED = 3000;
const MAX_DEPTH = 4;
const LISTED = /\.(tex|ltx|bib|png|jpe?g|pdf|eps|svg)$/i;
const SKIPPED_DIRS = new Set(['node_modules', 'build', 'out', '_minted']);

type Reader = (file: string) => Promise<string | null>;

const isInside = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
};
const withTex = (name: string) => (/\.(tex|ltx|latex)$/i.test(name) ? name : name + '.tex');

export function projectReader(dir: string, budget = MAX_TOTAL_BYTES): Reader {
  let left = budget;
  let realDir: Promise<string> | null = null;
  return async (file) => {
    try {
      realDir = realDir || fs.promises.realpath(dir);
      const real = await fs.promises.realpath(file);
      if (!isInside(await realDir, real)) return null;
      const { size } = await fs.promises.stat(real);
      if (size > MAX_FILE_BYTES || size > left) return null;
      left -= size;
      return await fs.promises.readFile(real, 'utf8');
    } catch (_) { return null; }
  };
}

export async function texFilesOf(root: string, read: Reader) {
  const dir = path.dirname(path.resolve(root));
  const seen = new Set<string>();
  const found: { file: string, text: string }[] = [];
  const visit = async (file: string) => {
    const key = file.toLowerCase();
    if (seen.has(key) || found.length >= MAX_TEX_FILES || !isInside(dir, file)) return;
    seen.add(key);
    const text = await read(file);
    if (text === null) return;
    found.push({ file, text });
    for (const m of withoutComments(text).matchAll(/\\(?:input|include|subfile)\s*\{([^}\n]+)\}/g)) await visit(path.resolve(dir, withTex(m[1].trim())));
  };
  await visit(path.resolve(root));
  return found;
}

export async function bibFilesOf(root: string, texts: string[]) {
  const dir = path.dirname(path.resolve(root));
  const named: string[] = [];
  for (const text of texts) {
    for (const m of withoutComments(text).matchAll(/\\(?:bibliography|addbibresource|addglobalbib)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim();
        if (!name) continue;
        const full = path.resolve(dir, /\.bib$/i.test(name) ? name : name + '.bib');
        if (isInside(dir, full) && !named.some((f) => f.toLowerCase() === full.toLowerCase())) named.push(full);
      }
    }
  }
  if (named.length) return named.slice(0, MAX_BIB_FILES);
  try { return (await fs.promises.readdir(dir)).filter((f) => /\.bib$/i.test(f)).sort().slice(0, MAX_BIB_FILES).map((f) => path.join(dir, f)); } catch (_) { return []; }
}

export async function projectFilesOf(dir: string, maxVisited = MAX_VISITED) {
  const out: string[] = [];
  let visited = 0;
  const walk = async (at: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(at, { withFileTypes: true }); } catch (_) { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= MAX_LISTED || visited >= maxVisited) return;
      visited++;
      if (e.name.startsWith('.')) continue;
      const full = path.join(at, e.name);
      if (e.isDirectory()) { if (depth < MAX_DEPTH && !SKIPPED_DIRS.has(e.name)) await walk(full, depth + 1); }
      else if (e.isFile() && LISTED.test(e.name)) out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  await walk(dir, 0);
  return out;
}

export async function referencesFor(root: string): Promise<TexReferences> {
  const dir = path.dirname(path.resolve(root));
  const read = projectReader(dir);
  const texFiles = await texFilesOf(root, read);
  const citations: TexEntry[] = [];
  for (const bib of await bibFilesOf(root, texFiles.map((t) => t.text))) {
    const text = await read(bib);
    if (text !== null) citations.push(...bibEntries(text));
  }
  const labels: TexLabel[] = [];
  const commands: string[] = [];
  const environments: string[] = [];
  for (const t of texFiles) {
    labels.push(...labelsIn(t.text, t.file));
    const defs = definitionsIn(t.text);
    commands.push(...defs.commands);
    environments.push(...defs.environments);
  }
  return mergeReferences({ citations, labels, commands, environments }, await projectFilesOf(dir));
}
