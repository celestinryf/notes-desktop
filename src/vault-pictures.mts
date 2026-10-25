import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_EXT, extOf } from './shared/helpers.mts';

type Picture = { rel: string; dir: string; leaf: string };

const MAX_PICTURES = 20000;
const FRESH_MS = 30000;
const skipped = (name: string) => name.startsWith('.') || name === 'node_modules';
const isPicture = (name: string) => IMAGE_EXT.has(extOf(name));
const urlPath = (rel: string) => rel.split('/').map(encodeURIComponent).join('/');

async function listPictures(root: string) {
  const found: Picture[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (found.length >= MAX_PICTURES) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skipped(e.name)) await walk(full); }
      else if (e.isFile() && isPicture(e.name)) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        found.push({ rel, dir: path.posix.dirname(rel), leaf: e.name.toLowerCase() });
      }
    }
  };
  await walk(root);
  return found;
}

class VaultPictures {
  lists: Map<string, { at: number; list: Promise<Picture[]> }>;
  now: () => number;

  constructor(now?: () => number) {
    this.lists = new Map();
    this.now = now || Date.now;
  }

  _pictures(root: string) {
    const key = path.resolve(root).toLowerCase();
    const have = this.lists.get(key);
    if (have && this.now() - have.at < FRESH_MS) return have.list;
    const list = listPictures(root);
    this.lists.set(key, { at: this.now(), list });
    return list;
  }

  async resolve(root: string | null, notePath: string, names: readonly string[]): Promise<(string | null)[]> {
    const fromDir = path.dirname(notePath);
    if (!root) {
      return names.map((name) => {
        const leaf = path.basename(name.replace(/\\/g, '/'));
        return isPicture(leaf) && fs.existsSync(path.join(fromDir, leaf)) ? urlPath(leaf) : null;
      });
    }
    const list = await this._pictures(root);
    const here = path.relative(root, fromDir).split(path.sep).join('/') || '.';
    return names.map((name) => {
      const wanted = name.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
      const leaf = wanted.split('/').pop() || '';
      if (!isPicture(leaf)) return null;
      const found = list.filter((p) => p.leaf === leaf && (!wanted.includes('/') || p.rel.toLowerCase() === wanted || p.rel.toLowerCase().endsWith('/' + wanted)));
      if (!found.length) return null;
      const best = found.reduce((a, b) => {
        if ((a.dir === here) !== (b.dir === here)) return a.dir === here ? a : b;
        if (a.rel.length !== b.rel.length) return a.rel.length < b.rel.length ? a : b;
        return a.rel < b.rel ? a : b;
      });
      return urlPath(path.posix.relative('/' + here, '/' + best.rel));
    });
  }
}

export { VaultPictures };
