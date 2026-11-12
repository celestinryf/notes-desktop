import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { isRecord } from './shared/helpers.mts';
import { stemOf } from './shared/tex-magic.mts';

const requireWhenNeeded = createRequire(import.meta.url);
const NEAR_LINES = 8;
const MAX_SYNCTEX_BYTES = 256 * 1024 * 1024;
const CACHED_FILES = 8;

export type SyncBox = { file: string, key: string, line: number, page: number, left: number, top: number, right: number, bottom: number };
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

function boxOf(raw: unknown, fileOf: (written: string) => { file: string, key: string }, offset: { x: number, y: number }): SyncBox | null {
  if (!isRecord(raw) || !isRecord(raw.file) || typeof raw.file.path !== 'string') return null;
  const left = num(raw.left) + offset.x;
  const bottom = num(raw.bottom) + offset.y;
  const height = num(raw.height);
  return Object.assign({ line: num(raw.line), page: num(raw.page) - 1, left, top: bottom - height, right: left + num(raw.width), bottom }, fileOf(raw.file.path));
}

export function boxesOf(text: string, base: string): SyncBox[] {
  const parsed = (parser || loadParser()).parseSyncTex(text);
  if (!isRecord(parsed)) return [];
  const offset = isRecord(parsed.offset) ? { x: num(parsed.offset.x), y: num(parsed.offset.y) } : { x: 0, y: 0 };
  const boxes: SyncBox[] = [];
  const files = new Map<string, { file: string, key: string }>();
  const fileOf = (written: string) => {
    let known = files.get(written);
    if (!known) { const file = path.resolve(base, written); known = { file, key: keyOf(file) }; files.set(written, known); }
    return known;
  };
  const add = (raw: unknown) => { const b = boxOf(raw, fileOf, offset); if (b && b.line > 0 && b.page >= 0) boxes.push(b); };
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
  let boxes: SyncBox[];
  try {
    if (fs.statSync(file).size > MAX_SYNCTEX_BYTES) return null;
    const bytes = fs.readFileSync(file);
    const text = file.endsWith('.gz') ? zlib.gunzipSync(bytes, { maxOutputLength: MAX_SYNCTEX_BYTES }).toString('utf8') : bytes.toString('utf8');
    boxes = boxesOf(text, path.dirname(file));
  } catch (_) { return null; }
  cache.delete(file);
  cache.set(file, { mtime, boxes });
  for (const old of cache.keys()) { if (cache.size <= CACHED_FILES) break; cache.delete(old); }
  return boxes;
}

export function forwardSearch(boxes: SyncBox[], file: string, line: number) {
  const key = keyOf(file);
  const inFile = boxes.filter((b) => b.key === key);
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
