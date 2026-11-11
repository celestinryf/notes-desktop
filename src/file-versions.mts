import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as H from './shared/helpers.mts';
import { pathKey } from './files.mts';

export const KEEP_FILE_VERSIONS = 30;
export const COALESCE_FILE_COPIES_MS = 120000;
const SAME_WRITE_MS = 1000;

type BackUpOptions = { coalesce?: boolean; now?: number };

export function createFileVersions(root: string, keep = KEEP_FILE_VERSIONS) {
  const sessionOriginals = new Map<string, string>();
  const ownWrites = new Map<string, number>();
  const lastCopyAt = new Map<string, number>();
  const dirFor = (file: string) => path.join(root, H.safeFilename(path.basename(file)) + ' ' + crypto.createHash('sha1').update(pathKey(file)).digest('hex').slice(0, 8));

  function backUpBeforeWrite(file: string, opts?: BackUpOptions) {
    const key = pathKey(file);
    const dir = dirFor(file);
    fs.mkdirSync(dir, { recursive: true });
    const now = opts && opts.now !== undefined ? opts.now : Date.now();
    const burst = opts && opts.coalesce ? burstCopy(file, key, now) : null;
    if (burst) return { first: false, name: burst, kept: false };
    const stamp = H.fileStamp();
    let name = stamp + path.extname(file);
    for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = stamp + '-' + n + path.extname(file);
    const copy = path.join(dir, name);
    const written = fs.statSync(file).mtime;
    fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
    fs.utimesSync(copy, written, written);
    lastCopyAt.set(key, now);
    const first = !sessionOriginals.has(key);
    if (first) sessionOriginals.set(key, name);
    const kept = sessionOriginals.get(key);
    const all = fs.readdirSync(dir).sort();
    for (const old of all.slice(0, Math.max(0, all.length - keep))) if (old !== kept) fs.rmSync(path.join(dir, old), { force: true });
    return { first, name, kept: true };
  }

  function burstCopy(file: string, key: string, now: number) {
    const own = ownWrites.get(key), copied = lastCopyAt.get(key);
    if (own === undefined || copied === undefined || !sessionOriginals.has(key)) return null;
    if (Math.abs(fs.statSync(file).mtimeMs - own) > SAME_WRITE_MS || now - copied >= COALESCE_FILE_COPIES_MS) return null;
    const names = list(file).map((v) => v.name).sort();
    return names.length ? names[names.length - 1] : null;
  }

  function noteWritten(file: string) {
    ownWrites.set(pathKey(file), fs.statSync(file).mtimeMs);
  }

  function list(file: string): FileVersion[] {
    const dir = dirFor(file);
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch (_) { return []; }
    const versions: FileVersion[] = [];
    for (const name of names) {
      let stat: fs.Stats;
      try { stat = fs.statSync(path.join(dir, name)); } catch (_) { continue; }
      if (stat.isFile()) versions.push({ name, at: stat.mtimeMs, bytes: stat.size });
    }
    return versions.sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
  }

  function pathOf(file: string, name: unknown) {
    if (typeof name !== 'string' || !list(file).some((v) => v.name === name)) return null;
    return path.join(dirFor(file), name);
  }

  return { backUpBeforeWrite, noteWritten, list, pathOf, dirFor };
}
