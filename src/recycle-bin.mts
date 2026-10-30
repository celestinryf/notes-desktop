import fs from 'node:fs';
import path from 'node:path';
import * as F from './files.mts';

type Recycled = { recycled: false } | { recycled: true, from: string, binPath: string | null };
type BinRecord = { original: string, deletedAt: number };

const FILETIME_EPOCH_MS = 11644473600000;
const CLOCK_SLACK_MS = 5000;
const V1_PATH_BYTES = 520;

function readDir(dir: string) {
  try { return fs.readdirSync(dir); } catch (_) { return []; }
}

function readBinRecord(file: string): BinRecord | null {
  let buf: Buffer;
  try { buf = fs.readFileSync(file); } catch (_) { return null; }
  if (buf.length < 28) return null;
  const version = buf.readBigInt64LE(0);
  const deletedAt = Number(buf.readBigUInt64LE(16) / 10000n) - FILETIME_EPOCH_MS;
  let original = '';
  if (version === 2n) {
    const chars = buf.readInt32LE(24);
    if (chars <= 0 || 28 + chars * 2 > buf.length) return null;
    original = buf.toString('utf16le', 28, 28 + chars * 2);
  } else if (version === 1n) {
    original = buf.toString('utf16le', 24, Math.min(buf.length, 24 + V1_PATH_BYTES));
  } else return null;
  const end = original.indexOf('\0');
  return { original: end === -1 ? original : original.slice(0, end), deletedAt };
}

function binRecordOf(binPath: string) {
  return path.join(path.dirname(binPath), '$I' + path.basename(binPath).slice(2));
}

function findInBin(filePath: string, since: number) {
  const root = path.parse(filePath).root;
  const bin = path.join(root, '$Recycle.Bin');
  const key = F.pathKey(filePath);
  const ext = path.extname(filePath).toLowerCase();
  let best: { binPath: string, deletedAt: number } | null = null;
  for (const owner of readDir(bin)) {
    const dir = path.join(bin, owner);
    for (const name of readDir(dir)) {
      if (!name.startsWith('$I') || path.extname(name).toLowerCase() !== ext) continue;
      const record = readBinRecord(path.join(dir, name));
      if (!record || record.deletedAt < since - CLOCK_SLACK_MS || F.pathKey(record.original) !== key) continue;
      if (!best || record.deletedAt > best.deletedAt) best = { binPath: path.join(dir, '$R' + name.slice(2)), deletedAt: record.deletedAt };
    }
  }
  return best && fs.existsSync(best.binPath) ? best.binPath : null;
}

async function recycle(filePath: string, trashItem: (p: string) => Promise<void>): Promise<Recycled> {
  const root = path.parse(filePath).root;
  if (process.platform !== 'win32' || !/^[a-z]:\\$/i.test(root) || !fs.existsSync(path.join(root, '$Recycle.Bin'))) return { recycled: false };
  const since = Date.now();
  try { await trashItem(filePath); } catch (_) { return { recycled: false }; }
  if (fs.existsSync(filePath)) return { recycled: false };
  return { recycled: true, from: filePath, binPath: findInBin(filePath, since) };
}

function restoreFromBin(binPath: string, to: string) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(binPath, to);
  fs.rmSync(binRecordOf(binPath), { force: true });
}

function binReachable(binPath: string) {
  return fs.existsSync(path.dirname(binPath));
}

function removeFromBin(binPath: string) {
  fs.rmSync(binPath, { force: true, recursive: true });
  fs.rmSync(binRecordOf(binPath), { force: true });
}

export { recycle, restoreFromBin, removeFromBin, readBinRecord, binRecordOf, binReachable };
export type { Recycled };
