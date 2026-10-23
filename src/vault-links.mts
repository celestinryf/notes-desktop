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

type Links = ReturnType<typeof H.vaultLinks>;
const parsed = new WeakMap<Note, { body: string; links: Links }>();

function linksOf(note: Note) {
  const hit = parsed.get(note);
  if (hit && hit.body === note.body) return hit.links;
  const links = H.vaultLinks(note.body);
  parsed.set(note, { body: note.body, links });
  return links;
}

const endsAt = (rel: string, name: string) => rel === name || rel.endsWith('/' + name);
const ENCODABLE_RUN = /[^\s!-\/:-@\[-`{-~]+/g;

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
    const better = (a: Member, b: Member) => (a.dir === here) !== (b.dir === here) ? a.dir === here : a.rel.length !== b.rel.length ? a.rel.length < b.rel.length : a.rel < b.rel;
    let best = found[0];
    for (const m of found) if (better(m, best)) best = m;
    return best.note;
  }

  resolvePath(source: Note, href: string): Note | null {
    if (!source.filePath) return null;
    const abs = href.startsWith('/') ? path.join(this.root, href) : path.resolve(path.dirname(source.filePath), href);
    const m = this.byKey.get(pathKey(abs));
    return m ? m.note : null;
  }

  targets(source: Note) {
    const links = linksOf(source);
    const out = new Set<Note>();
    for (const name of links.names) { const n = this.resolveName(source, name); if (n) out.add(n); }
    for (const href of links.paths) { const n = this.resolvePath(source, href); if (n) out.add(n); }
    return Array.from(out);
  }

  linkText(source: Note, target: Note) {
    if (!target.filePath || target.vaultId !== source.vaultId) return null;
    const rel = path.relative(this.root, target.filePath).replace(/\\/g, '/');
    const name = rel.split('/').pop() || rel;
    const stem = H.stemOf(name);
    const relStem = rel.slice(0, rel.length - name.length) + stem;
    return [stem, relStem, rel].find((text) => this.resolveName(source, text.toLowerCase()) === target) || null;
  }

  linksTo(source: Note, target: Note) {
    const links = linksOf(source);
    return links.names.some((name) => this.resolveName(source, name) === target) || links.paths.some((href) => this.resolvePath(source, href) === target);
  }
}

function linkNamesOf(note: Note) {
  if (!note.vaultId || !note.filePath) return [];
  const name = H.linkLeaf(note.filePath.replace(/\\/g, '/'));
  return Array.from(new Set([name, H.stemOf(name)]));
}

function nameHints(note: Note) {
  const names = linkNamesOf(note);
  if (!names.length) return null;
  const runs = H.stemOf(names[0]).match(ENCODABLE_RUN) || [];
  const longest = runs.reduce((a, b) => (b.length > a.length ? b : a), '');
  return longest ? Array.from(new Set([longest, encodeURIComponent(longest).toLowerCase()])) : null;
}

export { VaultLinker, linkNamesOf, nameHints };
