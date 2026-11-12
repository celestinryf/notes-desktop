import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { isRecord } from './shared/helpers.mts';
import { stemOf } from './shared/tex-magic.mts';

const requireWhenNeeded = createRequire(import.meta.url);
const NEAR_LINES = 8;

export type SyncBox = { file: string, line: number, page: number, left: number, top: number, right: number, bottom: number };
type Parser = { parseSyncTex: (text: string) => unknown };

let parser: Parser | null = null;
function loadParser(): Parser {
  const file = requireWhenNeeded.resolve('synctex-js/lib/synctexParser.js');
  const sandbox: { module: { exports: unknown } } = { module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  const exported = sandbox.module.exports;
  const parse = isRecord(exported) && typeof exported.parseSyncTex === 'function' ? exported.parseSyncTex : null;
  if (!parse) throw new Error('the SyncTeX reader did not load');
  parser = { parseSyncTex: (text: string) => Reflect.apply(parse, exported, [text]) };
  return parser;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const keyOf = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

function boxOf(raw: unknown, base: string, offset: { x: number, y: number }): SyncBox | null {
  if (!isRecord(raw) || !isRecord(raw.file) || typeof raw.file.path !== 'string') return null;
  const left = num(raw.left) + offset.x;
  const bottom = num(raw.bottom) + offset.y;
  const height = num(raw.height);
  return { file: path.resolve(base, raw.file.path), line: num(raw.line), page: num(raw.page) - 1, left, top: bottom - height, right: left + num(raw.width), bottom };
}

export function boxesOf(text: string, base: string): SyncBox[] {
  const parsed = (parser || loadParser()).parseSyncTex(text);
  if (!isRecord(parsed)) return [];
  const offset = isRecord(parsed.offset) ? { x: num(parsed.offset.x), y: num(parsed.offset.y) } : { x: 0, y: 0 };
  const boxes: SyncBox[] = [];
  const add = (raw: unknown) => { const b = boxOf(raw, base, offset); if (b && b.line > 0 && b.page >= 0) boxes.push(b); };
  if (Array.isArray(parsed.hBlocks)) parsed.hBlocks.forEach(add);
  if (isRecord(parsed.blockNumberLine)) {
    for (const lines of Object.values(parsed.blockNumberLine)) {
      if (!isRecord(lines)) continue;
      for (const pages of Object.values(lines)) {
        if (!isRecord(pages)) continue;
        for (const elements of Object.values(pages)) if (Array.isArray(elements)) elements.forEach(add);
      }
    }
  }
  return boxes;
}

const cache = new Map<string, { mtime: number, boxes: SyncBox[] }>();

export function syncFileFor(pdfOrRoot: string) {
  const stem = stemOf(pdfOrRoot);
  for (const name of [stem + '.synctex.gz', stem + '.synctex']) if (fs.existsSync(name)) return name;
  return null;
}

export function loadBoxes(pdfOrRoot: string) {
  const file = syncFileFor(pdfOrRoot);
  if (!file) return null;
  const mtime = fs.statSync(file).mtimeMs;
  const known = cache.get(file);
  if (known && known.mtime === mtime) return known.boxes;
  const bytes = fs.readFileSync(file);
  const text = file.endsWith('.gz') ? zlib.gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
  const boxes = boxesOf(text, path.dirname(file));
  cache.set(file, { mtime, boxes });
  return boxes;
}

export function forwardSearch(boxes: SyncBox[], file: string, line: number) {
  const key = keyOf(file);
  const inFile = boxes.filter((b) => keyOf(b.file) === key);
  if (!inFile.length) return null;
  let hits: SyncBox[] = [];
  for (let d = 0; d <= NEAR_LINES && !hits.length; d++) {
    hits = inFile.filter((b) => b.line === line + d);
    if (!hits.length && d) hits = inFile.filter((b) => b.line === line - d);
  }
  if (!hits.length) return null;
  const page = Math.min(...hits.map((b) => b.page));
  const onPage = hits.filter((b) => b.page === page);
  return { page, left: Math.min(...onPage.map((b) => b.left)), top: Math.min(...onPage.map((b) => b.top)), right: Math.max(...onPage.map((b) => b.right)), bottom: Math.max(...onPage.map((b) => b.bottom)) };
}

export function inverseSearch(boxes: SyncBox[], page: number, x: number, y: number) {
  const onPage = boxes.filter((b) => b.page === page);
  if (!onPage.length) return null;
  const inside = onPage.filter((b) => x >= b.left && x <= Math.max(b.right, b.left) && y >= b.top && y <= b.bottom);
  const area = (b: SyncBox) => Math.max(1, b.right - b.left) * Math.max(1, b.bottom - b.top);
  const distance = (b: SyncBox) => (y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0);
  const best = inside.length
    ? inside.reduce((a, b) => (area(b) < area(a) ? b : a))
    : onPage.reduce((a, b) => (distance(b) < distance(a) ? b : a));
  return { filePath: best.file, line: best.line };
}
