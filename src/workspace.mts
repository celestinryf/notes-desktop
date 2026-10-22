import fs from 'node:fs';
import path from 'node:path';
import * as H from './shared/helpers.mts';
import { createHash } from 'node:crypto';
import type { Store } from './store.mts';

const MANIFEST = '.notes-manifest.json';
const DOCUMENTS_DIR = '_documents';
const isOfficeNote = (n: Note) => !!(n.fileKind && H.CRAFT_OF[n.fileKind]);

function insideWorkspace(dir: string, rel: unknown) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) return null;
  const root = path.resolve(dir);
  const abs = path.resolve(root, rel);
  return abs.startsWith(root + path.sep) ? abs : null;
}

function uniqueIn(used: Set<string>, base: string, ext: string) {
  let name = base + ext;
  let i = 2;
  while (used.has(name.toLowerCase())) { name = base + ' ' + i + ext; i++; }
  used.add(name.toLowerCase());
  return name;
}

function folderRelPath(store: Store, folderId: string) {
  const parts: string[] = [];
  let cur = folderId ? store.getFolder(folderId) : null;
  let guard = 0;
  while (cur && guard++ < 1000) { parts.unshift(H.safeFilename(cur.name)); cur = cur.parentId ? store.getFolder(cur.parentId) : null; }
  return parts.join(path.sep);
}

type ManifestFile = { id: string, rel: string, hash: string, folderId: string | null, updatedAt: number, readOnly?: boolean, filePath?: string };
type Manifest = { exportedAt: number, files: ManifestFile[] };
type ImportResult = { updated: number, created: number, missing: number, conflicts: number, details: string[], updatedIds?: string[] };

function exportNotes(store: Store, dir: string): Manifest {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const used = new Map();
  const files: ManifestFile[] = [];
  const byAge = (a: Note, b: Note) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  const live = store.notes.filter((n) => !n.trashedAt && !n.lock);
  const write = (n: Note, relDir: string, content: string, extra?: Pick<ManifestFile, 'readOnly' | 'filePath'>) => {
    const dirKey = relDir.toLowerCase();
    if (!used.has(dirKey)) used.set(dirKey, new Set());
    const name = uniqueIn(used.get(dirKey), H.safeFilename(H.deriveTitle(n)), '.md');
    const rel = relDir ? path.join(relDir, name) : name;
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    files.push(Object.assign({ id: n.id, rel, hash: hashOf(content), folderId: n.folderId || null, updatedAt: n.updatedAt }, extra));
  };
  for (const n of live.filter((n) => !n.filePath).sort(byAge)) write(n, n.folderId ? folderRelPath(store, n.folderId) : '', n.body);
  for (const n of live.filter((n): n is FileNote => !!n.filePath && isOfficeNote(n) && !!n.body).sort(byAge)) {
    write(n, DOCUMENTS_DIR, '<!-- The text of ' + n.filePath + ', as Notes reads it. Read-only: edits here are ignored; edit the file itself. -->\n\n' + n.body, { readOnly: true, filePath: n.filePath });
  }
  const manifest = { exportedAt: Date.now(), files };
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

function hashOf(text: string) {
  return createHash('sha1').update(String(text)).digest('hex');
}

function importNotes(store: Store, dir: string): ImportResult {
  const manifestPath = path.join(dir, MANIFEST);
  if (!fs.existsSync(manifestPath)) return { updated: 0, created: 0, missing: 0, conflicts: 0, details: [] };
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const known = new Map(manifest.files.map((f) => [f.rel.toLowerCase(), f]));
  let updated = 0, created = 0, missing = 0, conflicts = 0;
  const details: string[] = [];
  const updatedIds: string[] = [];
  for (const f of manifest.files) {
    const abs = insideWorkspace(dir, f.rel);
    if (!abs) { details.push('ignored (path outside the workspace): ' + String(f.rel)); continue; }
    if (!fs.existsSync(abs)) { missing++; details.push('missing: ' + f.rel); continue; }
    const content = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    const h = hashOf(content);
    if (h !== f.hash) {
      const note = store.get(f.id);
      if (f.readOnly || (note && note.filePath)) {
        details.push('ignored (read-only copy of ' + path.basename(String((note && note.filePath) || f.filePath || f.rel)) + '): ' + f.rel);
      } else if (note && note.lock) {
        details.push('skipped (note locked meanwhile): ' + f.rel);
      } else if (!note || note.trashedAt) {
        details.push('skipped (note trashed meanwhile): ' + f.rel);
      } else if (hashOf(note.body) !== f.hash && note.body !== content) {
        const copy = store.create({ title: (H.deriveTitle(note) || 'Untitled') + ' (bot)', body: content, folderId: note.folderId, tags: note.tags });
        conflicts++;
        details.push('conflict: ' + f.rel + ' kept yours; agent version saved as "' + copy.title + '"');
      } else {
        store.update(f.id, { body: content }); updated++; updatedIds.push(f.id); details.push('updated: ' + f.rel);
      }
      f.hash = h;
    }
  }
  const walk = (d: string, relDir: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === MANIFEST || e.name.startsWith('.')) continue;
      const rel = relDir ? path.join(relDir, e.name) : e.name;
      if (e.isDirectory()) { if (!relDir && e.name === DOCUMENTS_DIR) continue; walk(path.join(d, e.name), rel); continue; }
      if (!/\.(md|markdown|txt)$/i.test(e.name) || known.has(rel.toLowerCase())) continue;
      const content = fs.readFileSync(path.join(d, e.name), 'utf8').replace(/\r\n/g, '\n');
      const folderId = folderIdForRel(store, relDir);
      const note = store.create({ title: e.name.replace(/\.(md|markdown|txt)$/i, ''), body: content, folderId });
      created++;
      details.push('created: ' + rel);
      const entry = { id: note.id, rel, hash: hashOf(content), folderId, updatedAt: note.updatedAt };
      manifest.files.push(entry);
      known.set(rel.toLowerCase(), entry);
    }
  };
  walk(dir, '');
  try { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8'); } catch (_) {  }
  return { updated, created, missing, conflicts, details, updatedIds };
}

function folderIdForRel(store: Store, relDir: string) {
  if (!relDir) return null;
  let parentId: string | null = null;
  for (const seg of relDir.split(/[\\/]+/).filter(Boolean)) {
    const existing = store.folders.find((f) => (f.parentId || null) === parentId && !f.vaultId && H.safeFilename(f.name) === seg);
    parentId = existing ? existing.id : store.createFolder({ name: seg, parentId }).id;
  }
  return parentId;
}

function refreshWorkspace(store: Store, dir: string) {
  let imported: ImportResult;
  try { imported = importNotes(store, dir); } catch (err) { return { imported: { error: err.message }, manifest: null }; }
  const manifest = exportNotes(store, dir);
  return { imported, manifest };
}

function forgetNote(dir: string, noteId: string) {
  const manifestPath = path.join(dir, MANIFEST);
  if (!fs.existsSync(manifestPath)) return false;
  let manifest: Manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) { return false; }
  const entry = (manifest.files || []).find((f) => f.id === noteId);
  if (!entry) return false;
  const abs = insideWorkspace(dir, entry.rel);
  if (abs) { try { fs.rmSync(abs, { force: true }); } catch (_) {  } }
  manifest.files = manifest.files.filter((f) => f.id !== noteId);
  try { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8'); } catch (_) {  }
  return true;
}

export { exportNotes, importNotes, refreshWorkspace, forgetNote, folderRelPath, MANIFEST, DOCUMENTS_DIR };
export type { ImportResult, Manifest, ManifestFile };
