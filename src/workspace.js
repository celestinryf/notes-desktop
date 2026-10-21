// @ts-check
'use strict';
/* Workspace for the bot: a folder of Markdown files that mirrors the notes which do not already live on disk,
   so a coding agent can read and edit them with ordinary file tools. Export before a run, import after. */
const fs = require('fs');
const path = require('path');
const H = require('./shared/helpers');

const MANIFEST = '.notes-manifest.json';
// Office files among the notes (Word documents, spreadsheets, presentations) go along as read-only Markdown copies of
// their text, so the bot can read them. The files themselves are what count: an edit to a copy is ignored on import.
const DOCUMENTS_DIR = '_documents';
const isOfficeNote = (n) => !!H.CRAFT_OF[n.fileKind];

// The manifest lives inside the folder the agent edits, so nothing in it is trusted as a path: an entry
// may only name a file inside the workspace. Returns the absolute path, or null.
function insideWorkspace(dir, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) return null;
  const root = path.resolve(dir);
  const abs = path.resolve(root, rel);
  return abs.startsWith(root + path.sep) ? abs : null;
}

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

// Writes every live, non-file-backed note into dir, and the text of the office files among the notes under
// _documents (read-only). Returns the manifest { files: [{ id, rel, hash, readOnly? }] }.
function exportNotes(store, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const used = new Map(); // relDir -> Set(names)
  const files = [];
  // Oldest first, so a title clash gives the suffix to the newer note and names stay stable between runs.
  const byAge = (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  const live = store.notes.filter((n) => !n.trashedAt && !n.lock);
  const write = (n, relDir, content, extra) => {
    const dirKey = relDir.toLowerCase(); // Windows folders Work and work are one folder
    if (!used.has(dirKey)) used.set(dirKey, new Set());
    const name = uniqueIn(used.get(dirKey), H.safeFilename(H.deriveTitle(n)), '.md');
    const rel = relDir ? path.join(relDir, name) : name;
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    files.push(Object.assign({ id: n.id, rel, hash: hashOf(content), folderId: n.folderId || null, updatedAt: n.updatedAt }, extra));
  };
  for (const n of live.filter((n) => !n.filePath).sort(byAge)) write(n, n.folderId ? folderRelPath(store, n.folderId) : '', n.body);
  for (const n of live.filter((n) => n.filePath && isOfficeNote(n) && n.body).sort(byAge)) {
    write(n, DOCUMENTS_DIR, '<!-- The text of ' + n.filePath + ', as Notes reads it. Read-only: edits here are ignored; edit the file itself. -->\n\n' + n.body, { readOnly: true, filePath: n.filePath });
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
  if (!fs.existsSync(manifestPath)) return { updated: 0, created: 0, missing: 0, conflicts: 0, details: [] };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const known = new Map(manifest.files.map((f) => [f.rel.toLowerCase(), f]));
  let updated = 0, created = 0, missing = 0, conflicts = 0;
  const details = [];
  const updatedIds = [];
  for (const f of manifest.files) {
    const abs = insideWorkspace(dir, f.rel);
    if (!abs) { details.push('ignored (path outside the workspace): ' + String(f.rel)); continue; }
    if (!fs.existsSync(abs)) { missing++; details.push('missing: ' + f.rel); continue; }
    const content = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    const h = hashOf(content);
    if (h !== f.hash) {
      const note = store.get(f.id);
      if (f.readOnly || (note && note.filePath)) {
        // A copy of an office file's text: the file is what counts, and Notes does not write it from Markdown. The
        // note decides, not only the flag: the manifest sits in the folder the agent edits.
        details.push('ignored (read-only copy of ' + path.basename(String((note && note.filePath) || f.filePath || f.rel)) + '): ' + f.rel);
      } else if (note && note.lock) {
        // Locked since the export: its text must not come back in clear as a copy.
        details.push('skipped (note locked meanwhile): ' + f.rel);
      } else if (!note || note.trashedAt) {
        details.push('skipped (note trashed meanwhile): ' + f.rel);
      } else if (hashOf(note.body) !== f.hash && note.body !== content) {
        // The body changed in the app since the export (not just tags, pin or folder) and the agent's text
        // differs from it.
        // Edited in the app while the agent also edited the file: keep the person's text and save the
        // agent's version beside it, so nothing is lost and the choice stays with the person.
        const copy = store.create({ title: (H.deriveTitle(note) || 'Untitled') + ' (bot)', body: content, folderId: note.folderId, tags: note.tags });
        conflicts++;
        details.push('conflict: ' + f.rel + ' kept yours; agent version saved as "' + copy.title + '"');
      } else {
        store.update(f.id, { body: content }); updated++; updatedIds.push(f.id); details.push('updated: ' + f.rel);
      }
      f.hash = h; // the workspace now reflects this content; a later import must not re-apply it
    }
  }
  const walk = (d, relDir) => {
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
  // Persist what the workspace now maps to, so repeated imports (or a terminal session) are incremental.
  try { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8'); } catch (_) { /* best effort */ }
  return { updated, created, missing, conflicts, details, updatedIds };
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

// Pulls in whatever changed in the workspace since the last export (a terminal session, an earlier run),
// then writes a fresh export. Returns { imported, manifest }.
// If the import fails, nothing is exported: exporting starts by deleting the folder, which would throw
// away whatever the import could not read.
function refreshWorkspace(store, dir) {
  let imported = null;
  try { imported = importNotes(store, dir); } catch (err) { return { imported: { error: err.message }, manifest: null }; }
  const manifest = exportNotes(store, dir);
  return { imported, manifest };
}

// Removes a note's exported file and manifest entry, so a locked or deleted note leaves no clear copy behind.
function forgetNote(dir, noteId) {
  const manifestPath = path.join(dir, MANIFEST);
  if (!fs.existsSync(manifestPath)) return false;
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) { return false; }
  const entry = (manifest.files || []).find((f) => f.id === noteId);
  if (!entry) return false;
  const abs = insideWorkspace(dir, entry.rel);
  if (abs) { try { fs.rmSync(abs, { force: true }); } catch (_) { /* best effort */ } }
  manifest.files = manifest.files.filter((f) => f.id !== noteId);
  try { fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8'); } catch (_) { /* best effort */ }
  return true;
}

module.exports = { exportNotes, importNotes, refreshWorkspace, forgetNote, folderRelPath, MANIFEST, DOCUMENTS_DIR };
