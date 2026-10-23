import path from 'node:path';
import * as H from './shared/helpers.mts';
import { pathKey } from './files.mts';

type Member = { note: Note; rel: string; relStem: string; name: string; stem: string; dir: string; key: string };
type Cached = { filePath: string; root: string; member: Member };

const cache = new WeakMap<Note, Cached>();

function memberOf(note: Note, root: string): Member | null {
  if (!note.filePath) return null;
  const hit = cache.get(note);
  if (hit && hit.filePath === note.filePath && hit.root === root) return hit.member;
  const rel = path.relative(root, note.filePath).replace(/\\/g, '/').toLowerCase();
  const name = H.linkLeaf(rel);
  const stem = H.stemOf(name);
  const slash = rel.lastIndexOf('/');
  const member = { note, rel, relStem: rel.slice(0, rel.length - name.length) + stem, name, stem, dir: slash === -1 ? '' : rel.slice(0, slash), key: pathKey(note.filePath) };
  cache.set(note, { filePath: note.filePath, root, member });
  return member;
}

const endsAt = (rel: string, name: string) => rel === name || rel.endsWith('/' + name);
const byPath = (a: Member, b: Member) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);

class VaultLinker {
  root: string;
  byLeaf: Map<string, Member[]>;
  byKey: Map<string, Member>;

  constructor(vault: Vault, notes: readonly Note[]) {
    this.root = vault.path;
    this.byLeaf = new Map();
    this.byKey = new Map();
    for (const n of notes) {
      if (n.vaultId !== vault.id || n.trashedAt || !n.filePath) continue;
      const m = memberOf(n, vault.path);
      if (!m) continue;
      for (const leaf of new Set([m.name, m.stem])) {
        const list = this.byLeaf.get(leaf);
        if (list) list.push(m); else this.byLeaf.set(leaf, [m]);
      }
      if (!this.byKey.has(m.key)) this.byKey.set(m.key, m);
    }
  }

  resolveName(source: Note, name: string): Note | null {
    const clean = name.replace(/^\/+/, '');
    let found = this.byLeaf.get(H.linkLeaf(clean)) || [];
    if (clean.includes('/')) found = found.filter((m) => endsAt(m.rel, clean) || endsAt(m.relStem, clean));
    if (found.length < 2) return found.length ? found[0].note : null;
    const from = memberOf(source, this.root);
    const here = from ? from.dir : null;
    return found.slice().sort((a, b) => (Number(b.dir === here) - Number(a.dir === here)) || (a.rel.length - b.rel.length) || byPath(a, b))[0].note;
  }

  resolvePath(source: Note, href: string): Note | null {
    if (!source.filePath) return null;
    const abs = href.startsWith('/') ? path.join(this.root, href) : path.resolve(path.dirname(source.filePath), href);
    const m = this.byKey.get(pathKey(abs));
    return m ? m.note : null;
  }

  targets(source: Note) {
    const links = H.vaultLinks(source.body);
    const out: Note[] = [];
    const add = (n: Note | null) => { if (n && !out.includes(n)) out.push(n); };
    for (const name of links.names) add(this.resolveName(source, name));
    for (const href of links.paths) add(this.resolvePath(source, href));
    return out;
  }

  linksTo(source: Note, target: Note) {
    return this.targets(source).includes(target);
  }
}

function linkNamesOf(note: Note) {
  if (!note.vaultId || !note.filePath) return [];
  const name = H.linkLeaf(note.filePath.replace(/\\/g, '/'));
  return Array.from(new Set([name, H.stemOf(name)]));
}

export { VaultLinker, linkNamesOf };
