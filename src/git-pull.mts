import fs from 'node:fs';
import path from 'node:path';
import { run, runBytes, AUTHOR } from './git-run.mts';

type PullContext = {
  dir: string;
  gitDir: string;
  tree: string;
  now: () => number;
  discard: (absPath: string) => Promise<void>;
};
type PullResult = { ok: true, changed: string[], copies: string[], merged: boolean } | { ok: false, error: string };
type StageEntry = { mode: string, oid: string, stage: number, path: string };
type TreeChange = { path: string, oldOid: string | null, newOid: string | null, mode: string };

const REMOTE_REF = 'refs/remotes/origin/main';
const ZERO_OID = /^0+$/;
const MAX_BLOB_BYTES = 256 * 1024 * 1024;

const isTracked = (rel: string) => rel !== 'notes.json' && !rel.split('/')[0].startsWith('.');

async function commitOf(dir: string, ref: string) {
  const r = await run(['rev-parse', '--verify', '-q', ref + '^{commit}'], dir);
  return r.ok ? r.stdout.trim() : null;
}

async function isAncestor(dir: string, older: string, newer: string) {
  return (await run(['merge-base', '--is-ancestor', older, newer], dir)).ok;
}

function stampOf(at: number) {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + '-' + two(d.getMinutes());
}

function conflictName(rel: string, stamp: string, taken: (candidate: string) => boolean) {
  const slash = rel.lastIndexOf('/');
  const dir = slash >= 0 ? rel.slice(0, slash + 1) : '';
  const base = rel.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let n = 1; ; n++) {
    const candidate = dir + stem + ' (conflict ' + stamp + (n > 1 ? ' ' + n : '') + ')' + ext;
    if (!taken(candidate)) return candidate;
  }
}

function parseMergeTree(out: string) {
  const tokens = out.split('\0');
  const entries: StageEntry[] = [];
  for (let i = 1; i < tokens.length && tokens[i] !== ''; i++) {
    const m = /^(\d+) ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(tokens[i]);
    if (m) entries.push({ mode: m[1], oid: m[2], stage: Number(m[3]), path: m[4] });
  }
  return { tree: tokens[0].trim(), entries };
}

function parseDiffTree(out: string): TreeChange[] {
  const tokens = out.split('\0');
  const changes: TreeChange[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const m = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])/.exec(tokens[i]);
    if (!m) continue;
    changes.push({ path: tokens[i + 1], oldOid: ZERO_OID.test(m[3]) ? null : m[3], newOid: ZERO_OID.test(m[4]) ? null : m[4], mode: ZERO_OID.test(m[4]) ? m[1] : m[2] });
  }
  return changes;
}

function parseLsTree(out: string): TreeChange[] {
  return out.split('\0').flatMap((line) => {
    const m = /^(\d+) blob ([0-9a-f]+)\t([\s\S]+)$/.exec(line);
    return m ? [{ path: m[3], oldOid: null, newOid: m[2], mode: m[1] }] : [];
  });
}

async function treePaths(dir: string, tree: string) {
  const r = await run(['ls-tree', '-r', '-z', '--name-only', tree], dir, 60000);
  return new Set(r.ok ? r.stdout.split('\0').filter(Boolean).map((p) => p.toLowerCase()) : []);
}

async function resolveConflicts(ctx: PullContext, mergedTree: string, entries: StageEntry[], stamp: string) {
  const sides = new Map<string, { ours?: StageEntry, theirs?: StageEntry }>();
  for (const e of entries) {
    const side = sides.get(e.path) || {};
    if (e.stage === 2) side.ours = e;
    if (e.stage === 3) side.theirs = e;
    sides.set(e.path, side);
  }
  const taken = await treePaths(ctx.dir, mergedTree);
  const onDisk = (rel: string) => fs.existsSync(path.join(ctx.tree, ...rel.split('/')));
  const lines: string[] = [];
  const copies: string[] = [];
  for (const [rel, { ours, theirs }] of sides) {
    const keep = ours || theirs;
    if (!keep) { lines.push('0 ' + '0'.repeat(40) + '\t' + rel); continue; }
    lines.push(keep.mode + ' ' + keep.oid + ' 0\t' + rel);
    if (ours && theirs && ours.oid !== theirs.oid && isTracked(rel)) {
      const copy = conflictName(rel, stamp, (c) => taken.has(c.toLowerCase()) || onDisk(c));
      taken.add(copy.toLowerCase());
      lines.push(theirs.mode + ' ' + theirs.oid + ' 0\t' + copy);
      copies.push(copy);
    }
  }
  const env = { GIT_INDEX_FILE: path.join(ctx.gitDir, 'notes-sync-index') };
  try {
    if (!(await run(['read-tree', mergedTree], ctx.dir, 60000, undefined, env)).ok) return null;
    if (!(await run(['update-index', '-z', '--index-info'], ctx.dir, 60000, lines.map((l) => l + '\0').join(''), env)).ok) return null;
    const written = await run(['write-tree'], ctx.dir, 60000, undefined, env);
    return written.ok ? { tree: written.stdout.trim(), copies } : null;
  } finally {
    fs.rmSync(env.GIT_INDEX_FILE, { force: true });
  }
}

async function diskOids(dir: string, files: string[]) {
  const oids = new Map<string, string>();
  const present = files.filter((f) => { try { return fs.statSync(f).isFile(); } catch (_) { return false; } });
  if (!present.length) return oids;
  const r = await run(['hash-object', '--no-filters', '--stdin-paths'], dir, 120000, present.join('\n') + '\n');
  if (!r.ok) throw new Error('could not read the notes folder: ' + r.error);
  const got = r.stdout.split(/\r?\n/).filter((l) => /^[0-9a-f]{40,64}$/.test(l));
  present.forEach((f, i) => { if (got[i]) oids.set(f, got[i]); });
  return oids;
}

function writeAtomic(file: string, data: Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.notes-sync-' + process.pid + '.tmp';
  fs.writeFileSync(tmp, data);
  try { fs.renameSync(tmp, file); } catch (err) { fs.rmSync(tmp, { force: true }); throw err; }
}

function freeCopyPath(file: string, stamp: string) {
  const dir = path.dirname(file);
  const name = conflictName(path.basename(file), stamp, (c) => fs.existsSync(path.join(dir, c)));
  return path.join(dir, name);
}

async function applyChanges(ctx: PullContext, changes: TreeChange[], stamp: string) {
  const relevant = changes.filter((c) => isTracked(c.path));
  const absOf = (rel: string) => path.join(ctx.tree, ...rel.split('/'));
  const oids = await diskOids(ctx.dir, relevant.map((c) => absOf(c.path)));
  const changed: string[] = [];
  const copies: string[] = [];
  for (const c of relevant) {
    const file = absOf(c.path);
    const onDisk = oids.get(file) || null;
    const untouched = onDisk === c.oldOid;
    if (untouched && !c.newOid) {
      if (onDisk) await ctx.discard(file);
      changed.push(c.path);
      continue;
    }
    if (!c.newOid) continue;
    const data = await runBytes(['cat-file', 'blob', c.newOid], ctx.dir, MAX_BLOB_BYTES);
    if (!data) throw new Error('could not read ' + c.path + ' from the repository');
    if (untouched) {
      writeAtomic(file, data);
      changed.push(c.path);
    } else if (onDisk !== c.newOid) {
      const copy = freeCopyPath(file, stamp);
      writeAtomic(copy, data);
      copies.push(path.relative(ctx.tree, copy).split(path.sep).join('/'));
    }
  }
  return { changed, copies };
}

async function fetchRemote(dir: string) {
  const r = await run(['fetch', '-q', 'origin', '+refs/heads/main:' + REMOTE_REF], dir, 120000);
  if (r.ok) return { ok: true as const, empty: false };
  if (/couldn't find remote ref|could not find remote ref/i.test(r.error || '')) return { ok: true as const, empty: true };
  return { ok: false as const, error: r.error || 'fetch failed' };
}

async function pullInto(ctx: PullContext): Promise<PullResult> {
  const fetched = await fetchRemote(ctx.dir);
  if (!fetched.ok) return { ok: false, error: fetched.error };
  const none = { ok: true as const, changed: [], copies: [], merged: false };
  if (fetched.empty) return none;
  const theirs = await commitOf(ctx.dir, REMOTE_REF);
  if (!theirs) return none;
  const ours = await commitOf(ctx.dir, 'HEAD');
  if (ours === theirs || (ours && await isAncestor(ctx.dir, theirs, ours))) return none;
  const stamp = stampOf(ctx.now());
  let target = theirs;
  let merged = false;
  let mergeCopies: string[] = [];
  if (ours && !(await isAncestor(ctx.dir, ours, theirs))) {
    const m = await run(['merge-tree', '--write-tree', '-z', '--allow-unrelated-histories', ours, theirs], ctx.dir, 120000);
    if (m.code !== 0 && m.code !== 1) return { ok: false, error: /write-tree|unknown option/i.test(m.error || '') ? 'this git is too old to merge (Notes needs git 2.38 or newer)' : m.error || 'merge failed' };
    const { tree, entries } = parseMergeTree(m.stdout);
    if (!/^[0-9a-f]{40,64}$/.test(tree)) return { ok: false, error: 'merge failed: ' + (m.error || 'no tree') };
    const resolved = entries.length ? await resolveConflicts(ctx, tree, entries, stamp) : { tree, copies: [] };
    if (!resolved) return { ok: false, error: 'could not settle the conflicts' };
    const commit = await run(AUTHOR.concat(['commit-tree', resolved.tree, '-p', ours, '-p', theirs, '-m', 'sync ' + stamp]), ctx.dir, 60000);
    if (!commit.ok) return { ok: false, error: commit.error || 'could not record the merge' };
    target = commit.stdout.trim();
    merged = true;
    mergeCopies = resolved.copies;
  }
  const diff = ours
    ? await run(['diff-tree', '-r', '-z', '--no-renames', '--raw', ours, target], ctx.dir, 120000)
    : await run(['ls-tree', '-r', '-z', target], ctx.dir, 120000);
  if (!diff.ok) return { ok: false, error: diff.error || 'could not compare versions' };
  const applied = await applyChanges(ctx, ours ? parseDiffTree(diff.stdout) : parseLsTree(diff.stdout), stamp);
  const moved = await run(['update-ref', '-m', 'notes sync', 'HEAD', target].concat(ours ? [ours] : []), ctx.dir);
  if (!moved.ok) return { ok: false, error: moved.error || 'could not move to the new version' };
  const reset = await run(['read-tree', target], ctx.dir, 120000);
  if (!reset.ok) return { ok: false, error: reset.error || 'could not reset the index' };
  return { ok: true, changed: applied.changed, copies: mergeCopies.concat(applied.copies), merged };
}

export type { PullContext, PullResult };
export { pullInto, conflictName, parseMergeTree, parseDiffTree, stampOf };
