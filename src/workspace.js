'use strict';
/* Workspace for the bot: a folder of Markdown files that mirrors the notes which do not already live on disk,
   so a coding agent can read and edit them with ordinary file tools. Export before a run, import after. */
const fs = require('fs');
const path = require('path');
const H = require('./shared/helpers');

const MANIFEST = '.notes-manifest.json';

function uniqueIn(used, base, ext) {
  let name = base + ext;
  let i = 2;
  while (used.has(name.toLowerCase())) { name = base + ' ' + i + ext; i++; }
  used.add(name.toLowerCase());
  return name;
}

// Relative directory for a folder id, mirroring the folder tree (plain folders only).
function folderRelPath(store, folderId) {
  const parts = [];
  let cur = folderId ? store.getFolder(folderId) : null;
  let guard = 0;
  while (cur && guard++ < 1000) { parts.unshift(H.safeFilename(cur.name)); cur = cur.parentId ? store.getFolder(cur.parentId) : null; }
  return parts.join(path.sep);
}

// Writes every live, non-file-backed note into dir. Returns the manifest { files: [{ id, rel, hash }] }.
function exportNotes(store, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const used = new Map(); // relDir -> Set(names)
  const files = [];
  // Oldest first, so a title clash gives the suffix to the newer note and names stay stable between runs.
  const notes = store.notes.filter((n) => !n.trashedAt && !n.filePath).slice().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const n of notes) {
    const relDir = n.folderId ? folderRelPath(store, n.folderId) : '';
    if (!used.has(relDir)) used.set(relDir, new Set());
    const name = uniqueIn(used.get(relDir), H.safeFilename(H.deriveTitle(n)), '.md');
    const rel = relDir ? path.join(relDir, name) : name;
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const content = n.body;
    fs.writeFileSync(abs, content, 'utf8');
    files.push({ id: n.id, rel, hash: hashOf(content), folderId: n.folderId || null });
  }
  const manifest = { exportedAt: Date.now(), files };
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

function hashOf(text) {
  return require('crypto').createHash('sha1').update(String(text)).digest('hex');
}

// Reads the workspace back: changed files update their notes, new .md files become notes in the matching
// folder, deleted files are reported but the notes are kept (deleting is a decision for a person).
function importNotes(store, dir) {
  const manifestPath = path.join(dir, MANIFEST);
  if (!fs.existsSync(manifestPath)) return { updated: 0, created: 0, missing: 0, details: [] };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const known = new Map(manifest.files.map((f) => [f.rel.toLowerCase(), f]));
  let updated = 0, created = 0, missing = 0;
  const details = [];
  for (const f of manifest.files) {
    const abs = path.join(dir, f.rel);
    if (!fs.existsSync(abs)) { missing++; details.push('missing: ' + f.rel); continue; }
    const content = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    const h = hashOf(content);
    if (h !== f.hash) {
      const note = store.get(f.id);
      if (note && !note.trashedAt) { store.update(f.id, { body: content }); updated++; details.push('updated: ' + f.rel); }
      f.hash = h; // the workspace now reflects this content; a later import must not re-apply it
    }
  }
  const walk = (d, relDir) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === MANIFEST || e.name.startsWith('.')) continue;
      const rel = relDir ? path.join(relDir, e.name) : e.name;
      if (e.isDirectory()) { walk(path.join(d, e.name), rel); continue; }
      if (!/\.(md|markdown|txt)$/i.test(e.name) || known.has(rel.toLowerCase())) continue;
      const content = fs.readFileSync(path.join(d, e.name), 'utf8').replace(/\r\n/g, '\n');
      const folderId = folderIdForRel(store, relDir);
      const note = store.create({ title: e.name.replace(/\.(md|markdown|txt)$/i, ''), body: content, folderId });
      created++;
      details.push('created: ' + rel);
      const entry = { id: note.id, rel, hash: hashOf(content), folderId };
      manifest.files.push(entry);
      known.set(rel.toLowerCase(), entry);
    }
  };
  walk(dir, '');
  // Persist what the workspace now maps to, so repeated imports (or a terminal session) are incremental.
  try { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8'); } catch (_) { /* best effort */ }
  return { updated, created, missing, details };
}

// Finds (or creates) the plain folder chain matching a relative directory produced by folderRelPath.
function folderIdForRel(store, relDir) {
  if (!relDir) return null;
  let parentId = null;
  for (const seg of relDir.split(/[\\/]+/).filter(Boolean)) {
    const existing = store.folders.find((f) => (f.parentId || null) === parentId && !f.vaultId && H.safeFilename(f.name) === seg);
    parentId = existing ? existing.id : store.createFolder({ name: seg, parentId }).id;
  }
  return parentId;
}

module.exports = { exportNotes, importNotes, folderRelPath, MANIFEST };
