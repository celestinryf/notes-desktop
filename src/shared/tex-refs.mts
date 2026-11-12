import { fileNameOf } from './helpers.mts';

const NOT_ENTRIES = new Set(['string', 'comment', 'preamble']);
const DETAIL_CHARS = 120;

export const EMPTY_REFERENCES: TexReferences = { citations: [], labels: [], commands: [], environments: [], files: [] };

export const withoutComments = (text: string) => text.replace(/(^|[^\\])%.*$/gm, '$1');

function rawFieldOf(body: string, name: string) {
  const f = new RegExp('(?:^|[,\\s])' + name + '\\s*=\\s*(?:\\{((?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*)\\}|"([^"]*)"|(\\w+))', 'i').exec(body);
  return f ? (f[1] || f[2] || f[3] || '').trim() : '';
}

const cleanField = (raw: string) => raw.replace(/\\[a-zA-Z]+\s*|\\./g, '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
const fieldOf = (body: string, name: string) => cleanField(rawFieldOf(body, name));

function firstAuthor(raw: string) {
  if (/^\{[^{}]*\}$/.test(raw)) return cleanField(raw);
  const first = cleanField(raw).split(/\s+and\s+/i)[0].trim();
  return first.includes(',') ? first.split(',')[0].trim() : first.split(' ').pop() || '';
}

export function bibEntries(text: string): TexEntry[] {
  const out: TexEntry[] = [];
  const keys = new Set<string>();
  const starts = [...text.matchAll(/@\s*(\w+)\s*[{(]\s*([^,\s{}()]+)\s*,/g)];
  starts.forEach((m, i) => {
    const key = m[2];
    if (NOT_ENTRIES.has(m[1].toLowerCase()) || keys.has(key)) return;
    keys.add(key);
    const body = text.slice((m.index || 0) + m[0].length, i + 1 < starts.length ? starts[i + 1].index : text.length);
    const surname = firstAuthor(rawFieldOf(body, 'author') || rawFieldOf(body, 'editor'));
    const year = fieldOf(body, 'year') || fieldOf(body, 'date').slice(0, 4);
    out.push({ key, detail: [surname, year, fieldOf(body, 'title')].filter(Boolean).join(', ').slice(0, DETAIL_CHARS) });
  });
  return out;
}

export function labelsIn(text: string, file: string): TexLabel[] {
  const out: TexLabel[] = [];
  const name = fileNameOf(file);
  withoutComments(text).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\\label\{([^}\n]+)\}/g)) {
      const key = m[1].trim();
      if (key) out.push({ key, detail: name + ':' + (i + 1), file, line: i + 1 });
    }
  });
  return out;
}

export function definitionsIn(text: string) {
  const plain = withoutComments(text);
  const commands = new Set<string>();
  const environments = new Set<string>();
  for (const m of plain.matchAll(/\\(?:(?:re)?newcommand|providecommand|DeclareMathOperator|DeclareRobustCommand|NewDocumentCommand|RenewDocumentCommand)\*?\s*\{?\s*\\([A-Za-z@]+)/g)) commands.add(m[1]);
  for (const m of plain.matchAll(/\\[gex]?def\s*\\([A-Za-z@]+)/g)) commands.add(m[1]);
  for (const m of plain.matchAll(/\\(?:(?:re)?newenvironment|NewDocumentEnvironment|newtheorem)\*?\s*\{([A-Za-z*]+)\}/g)) environments.add(m[1]);
  return { commands: [...commands], environments: [...environments] };
}

function uniqueBy<T>(items: T[], keyOf: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => { const k = keyOf(item); if (seen.has(k)) return false; seen.add(k); return true; });
}

export function mergeReferences(parts: Omit<TexReferences, 'files'>, files: string[]): TexReferences {
  return {
    citations: uniqueBy(parts.citations, (c) => c.key),
    labels: uniqueBy(parts.labels, (l) => l.key),
    commands: uniqueBy(parts.commands, (c) => c),
    environments: uniqueBy(parts.environments, (e) => e),
    files,
  };
}

export function withBuffer(refs: TexReferences, text: string, file: string, isSame: (a: string, b: string) => boolean): TexReferences {
  const own = definitionsIn(text);
  return mergeReferences({
    citations: refs.citations,
    labels: [...labelsIn(text, file), ...refs.labels.filter((l) => !isSame(l.file, file))],
    commands: [...own.commands, ...refs.commands],
    environments: [...own.environments, ...refs.environments],
  }, refs.files);
}
