'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const H = require('./shared/helpers');

const SCHEMA_VERSION = 1;
const MAX_BACKUPS = 10;
const BACKUP_MIN_INTERVAL_MS = 10 * 60 * 1000;

const DEFAULT_SETTINGS = Object.freeze({
  hotkey: 'CommandOrControl+Alt+N',
  theme: 'system',          // system | light | dark
  fontSize: 16,
  openAtLogin: true,
  alwaysOnTop: false,
  sort: 'updated',          // updated | created | title
  sidebarCollapsed: false,
  sidebarWidth: H.PANE_LIMITS.sidebarWidth.def,
  listWidth: H.PANE_LIMITS.listWidth.def,
  expandedFolders: [],      // folder ids whose children are shown in the sidebar
  editorMode: 'rendered',   // rendered | source
  editorAlign: 'left',      // left | center | right: where the writing column sits in the editor pane
  editorWidth: 760,         // max width of the writing column in px; 0 means full width
  gitEnabled: true,         // commit notes.json to a git repo in the data folder after changes
  gitRemote: '',            // optional remote URL to push to after each commit
  window: null,             // { x, y, width, height }
});

const EDITOR_WIDTH = { min: 480, max: 1600 };

function clampEditorWidth(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.editorWidth;
  if (n <= 0) return 0;
  return Math.min(EDITOR_WIDTH.max, Math.max(EDITOR_WIDTH.min, Math.round(n)));
}

const FOLDER_NAME_MAX = 80;

function cleanFolderName(name) {
  const s = String(name == null ? '' : name).replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
  return (s || 'Untitled folder').slice(0, FOLDER_NAME_MAX);
}

function sanitizeFolder(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    name: cleanFolderName(raw.name),
    parentId: typeof raw.parentId === 'string' && raw.parentId ? raw.parentId : null,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
  };
}

// Atomic replace with retries. On Windows a reader (git, antivirus, a sync client) holding the target
// open makes rename fail with EPERM/EBUSY for a moment; wait briefly and try again before falling back to a copy.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function replaceFile(tmp, target) {
  // Short total wait (~300 ms): a reader's lock lasts milliseconds, and this blocks the main process.
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { fs.renameSync(tmp, target); return; } catch (err) {
      lastErr = err;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      sleepSync(20 * (attempt + 1));
    }
  }
  try {
    fs.copyFileSync(tmp, target);
    fs.unlinkSync(tmp);
  } catch (_) {
    throw lastErr;
  }
}

function clampFontSize(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_SETTINGS.fontSize;
  return Math.min(28, Math.max(12, Math.round(v)));
}

function sanitizeSettings(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const s = Object.assign({}, DEFAULT_SETTINGS, src);
  const acc = H.parseAccelerator(s.hotkey);
  s.hotkey = acc.ok ? acc.value : DEFAULT_SETTINGS.hotkey;
  s.theme = ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system';
  s.fontSize = clampFontSize(s.fontSize);
  s.openAtLogin = !!s.openAtLogin;
  s.alwaysOnTop = !!s.alwaysOnTop;
  s.sidebarCollapsed = !!s.sidebarCollapsed;
  s.sidebarWidth = H.clampPane('sidebarWidth', s.sidebarWidth);
  s.listWidth = H.clampPane('listWidth', s.listWidth);
  s.expandedFolders = Array.isArray(s.expandedFolders) ? s.expandedFolders.filter((x) => typeof x === 'string').slice(0, 5000) : [];
  s.editorMode = s.editorMode === 'source' ? 'source' : 'rendered';
  s.editorAlign = ['left', 'center', 'right'].includes(s.editorAlign) ? s.editorAlign : 'left';
  s.editorWidth = clampEditorWidth(s.editorWidth);
  s.gitEnabled = !!s.gitEnabled;
  s.gitRemote = typeof s.gitRemote === 'string' ? s.gitRemote.trim().slice(0, 500) : '';
  s.sort = ['updated', 'created', 'title'].includes(s.sort) ? s.sort : 'updated';
  if (s.window && typeof s.window === 'object') {
    const w = s.window;
    const ok = ['width', 'height'].every((k) => Number.isFinite(w[k]) && w[k] > 100) && ['x', 'y'].every((k) => Number.isFinite(w[k]));
    s.window = ok ? { x: Math.round(w.x), y: Math.round(w.y), width: Math.round(w.width), height: Math.round(w.height) } : null;
  } else s.window = null;
  return s;
}

function sanitizeNote(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : now;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    title: typeof raw.title === 'string' ? raw.title : '',
    body: typeof raw.body === 'string' ? raw.body : '',
    tags: H.parseTags(raw.tags || []),
    folderId: typeof raw.folderId === 'string' && raw.folderId ? raw.folderId : null,
    pinned: !!raw.pinned,
    createdAt,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt,
    trashedAt: Number.isFinite(raw.trashedAt) ? raw.trashedAt : null,
  };
}

class Store {
  constructor(dir, opts) {
    opts = opts || {};
    this.dir = dir;
    this.file = path.join(dir, 'notes.json');
    this.backupDir = path.join(dir, 'backups');
    this.now = opts.now || Date.now;
    this.notes = [];
    this.folders = [];
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    this.lastBackupAt = 0;
    this.loadError = null;
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    let raw = null;
    try {
      if (fs.existsSync(this.file)) raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      // Keep the corrupt file for the user and start from the newest backup.
      this.loadError = err;
      const quarantined = this.file + '.corrupt-' + this.now();
      try { fs.renameSync(this.file, quarantined); } catch (_) { /* ignore */ }
      raw = this._loadNewestBackup();
    }
    const now = this.now();
    const notes = Array.isArray(raw && raw.notes) ? raw.notes : [];
    const folders = Array.isArray(raw && raw.folders) ? raw.folders : [];
    this.notes = notes.map((n) => sanitizeNote(n, now)).filter(Boolean);
    this.folders = folders.map((f) => sanitizeFolder(f, now)).filter(Boolean);
    this._repairFolderGraph();
    this.settings = sanitizeSettings(raw && raw.settings);
    const ids = new Set(this.folders.map((f) => f.id));
    this.settings.expandedFolders = this.settings.expandedFolders.filter((id) => ids.has(id));
    return this;
  }

  // Drop duplicate ids, dangling parents, and cycles so the tree always renders.
  _repairFolderGraph() {
    const seen = new Set();
    this.folders = this.folders.filter((f) => { if (seen.has(f.id)) return false; seen.add(f.id); return true; });
    const byId = new Map(this.folders.map((f) => [f.id, f]));
    for (const f of this.folders) {
      if (f.parentId === f.id || (f.parentId && !byId.has(f.parentId))) f.parentId = null;
    }
    for (const f of this.folders) {
      const trail = new Set([f.id]);
      let cur = f;
      while (cur.parentId) {
        if (trail.has(cur.parentId)) { cur.parentId = null; break; }
        trail.add(cur.parentId);
        cur = byId.get(cur.parentId);
      }
    }
    for (const n of this.notes) if (n.folderId && !byId.has(n.folderId)) n.folderId = null;
  }

  _loadNewestBackup() {
    try {
      const files = fs.readdirSync(this.backupDir).filter((f) => f.endsWith('.json')).sort().reverse();
      for (const f of files) {
        try { return JSON.parse(fs.readFileSync(path.join(this.backupDir, f), 'utf8')); } catch (_) { /* try older */ }
      }
    } catch (_) { /* no backups */ }
    return null;
  }

  serialize() {
    return { schemaVersion: SCHEMA_VERSION, savedAt: this.now(), settings: this.settings, folders: this.folders, notes: this.notes };
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    this._maybeBackup();
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.serialize(), null, 2), 'utf8');
    replaceFile(tmp, this.file);
    return this;
  }

  _maybeBackup() {
    const now = this.now();
    if (!fs.existsSync(this.file) || now - this.lastBackupAt < BACKUP_MIN_INTERVAL_MS) return;
    fs.mkdirSync(this.backupDir, { recursive: true });
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(this.file, path.join(this.backupDir, 'notes-' + stamp + '.json'));
    this.lastBackupAt = now;
    const files = fs.readdirSync(this.backupDir).filter((f) => f.endsWith('.json')).sort();
    while (files.length > MAX_BACKUPS) fs.unlinkSync(path.join(this.backupDir, files.shift()));
  }

  // ---- notes -------------------------------------------------------------

  list(opts) {
    opts = opts || {};
    const trashed = !!opts.trashed;
    let out = this.notes.filter((n) => !!n.trashedAt === trashed);
    if (opts.pinned) out = out.filter((n) => n.pinned);
    if (opts.tag) out = out.filter((n) => n.tags.includes(String(opts.tag).toLowerCase()));
    if (opts.folderId !== undefined) {
      const fid = opts.folderId || null;
      if (opts.recursive && fid) {
        const inside = this.descendantIds(fid);
        inside.add(fid);
        out = out.filter((n) => n.folderId && inside.has(n.folderId));
      } else {
        out = out.filter((n) => (n.folderId || null) === fid);
      }
    }
    if (opts.query) out = out.filter((n) => H.matchesQuery(n, opts.query));
    return H.sortNotes(out, opts.sort || this.settings.sort);
  }

  get(id) {
    return this.notes.find((n) => n.id === id) || null;
  }

  create(data) {
    data = data || {};
    const now = this.now();
    const note = sanitizeNote(Object.assign({}, data, { id: crypto.randomUUID(), createdAt: now, updatedAt: now, trashedAt: null }), now);
    if (note.folderId && !this.getFolder(note.folderId)) note.folderId = null;
    this.notes.unshift(note);
    this.save();
    return note;
  }

  update(id, patch) {
    const note = this.get(id);
    if (!note) return null;
    patch = patch || {};
    const before = Object.assign({}, note, { tags: note.tags.slice() });
    let changed = false;
    if (typeof patch.title === 'string' && patch.title !== note.title) { note.title = patch.title; changed = true; }
    if (typeof patch.body === 'string' && patch.body !== note.body) { note.body = patch.body; changed = true; }
    if (patch.tags !== undefined) {
      const tags = H.parseTags(patch.tags);
      if (tags.join(',') !== note.tags.join(',')) { note.tags = tags; changed = true; }
    }
    if (typeof patch.pinned === 'boolean' && patch.pinned !== note.pinned) { note.pinned = patch.pinned; changed = true; }
    if (patch.folderId !== undefined) {
      const fid = patch.folderId && this.getFolder(patch.folderId) ? patch.folderId : null;
      if (fid !== (note.folderId || null)) { note.folderId = fid; changed = true; }
    }
    if (changed) {
      note.updatedAt = this.now();
      try {
        this.save();
      } catch (err) {
        // Roll back so a retry with the same patch is a real change and gets written.
        Object.assign(note, before);
        throw err;
      }
    }
    return note;
  }

  togglePin(id) {
    const note = this.get(id);
    if (!note) return null;
    return this.update(id, { pinned: !note.pinned });
  }

  duplicate(id) {
    const note = this.get(id);
    if (!note) return null;
    return this.create({ title: note.title ? note.title + ' (copy)' : '', body: note.body, tags: note.tags, folderId: note.folderId, pinned: false });
  }

  trash(id) {
    const note = this.get(id);
    if (!note || note.trashedAt) return note;
    note.trashedAt = this.now();
    note.pinned = false;
    this.save();
    return note;
  }

  restore(id) {
    const note = this.get(id);
    if (!note || !note.trashedAt) return note;
    note.trashedAt = null;
    if (note.folderId && !this.getFolder(note.folderId)) note.folderId = null;
    note.updatedAt = this.now();
    this.save();
    return note;
  }

  destroy(id) {
    const idx = this.notes.findIndex((n) => n.id === id);
    if (idx === -1) return false;
    this.notes.splice(idx, 1);
    this.save();
    return true;
  }

  emptyTrash() {
    const before = this.notes.length;
    this.notes = this.notes.filter((n) => !n.trashedAt);
    if (this.notes.length !== before) this.save();
    return before - this.notes.length;
  }

  tags() {
    const counts = new Map();
    for (const n of this.notes) {
      if (n.trashedAt) continue;
      for (const t of n.tags) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  counts() {
    let all = 0, pinned = 0, trash = 0;
    for (const n of this.notes) {
      if (n.trashedAt) trash++;
      else { all++; if (n.pinned) pinned++; }
    }
    return { all, pinned, trash };
  }

  // ---- folders -----------------------------------------------------------

  getFolder(id) {
    return this.folders.find((f) => f.id === id) || null;
  }

  descendantIds(id) {
    const out = new Set();
    const walk = (pid) => {
      for (const f of this.folders) if (f.parentId === pid && !out.has(f.id)) { out.add(f.id); walk(f.id); }
    };
    walk(id);
    return out;
  }

  folderPath(id) {
    const path = [];
    let cur = this.getFolder(id);
    let guard = 0;
    while (cur && guard++ < 10000) { path.unshift({ id: cur.id, name: cur.name }); cur = cur.parentId ? this.getFolder(cur.parentId) : null; }
    return path;
  }

  // Nested tree with recursive live-note counts, children sorted by name.
  folderTree() {
    const direct = new Map();
    for (const n of this.notes) {
      if (n.trashedAt || !n.folderId) continue;
      direct.set(n.folderId, (direct.get(n.folderId) || 0) + 1);
    }
    const byParent = new Map();
    for (const f of this.folders) {
      const key = f.parentId || null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(f);
    }
    const build = (pid, depth) => (byParent.get(pid) || [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.createdAt - b.createdAt)
      .map((f) => {
        const children = build(f.id, depth + 1);
        const count = (direct.get(f.id) || 0) + children.reduce((s, c) => s + c.count, 0);
        return { id: f.id, name: f.name, parentId: f.parentId, depth, count, children };
      });
    return build(null, 0);
  }

  createFolder(data) {
    data = data || {};
    const parentId = data.parentId && this.getFolder(data.parentId) ? data.parentId : null;
    const folder = { id: crypto.randomUUID(), name: cleanFolderName(data.name), parentId, createdAt: this.now() };
    this.folders.push(folder);
    this.save();
    return folder;
  }

  renameFolder(id, name) {
    const f = this.getFolder(id);
    if (!f) return null;
    const next = cleanFolderName(name);
    if (next !== f.name) { f.name = next; this.save(); }
    return f;
  }

  moveFolder(id, parentId) {
    const f = this.getFolder(id);
    if (!f) return { error: 'Folder not found.' };
    parentId = parentId || null;
    if (parentId) {
      if (parentId === id) return { error: 'A folder cannot be moved into itself.' };
      if (!this.getFolder(parentId)) return { error: 'Target folder not found.' };
      if (this.descendantIds(id).has(parentId)) return { error: 'A folder cannot be moved into one of its own subfolders.' };
    }
    if ((f.parentId || null) !== parentId) { f.parentId = parentId; this.save(); }
    return { folder: f };
  }

  // Deleting a folder lifts its notes and subfolders into its parent; nothing is lost.
  deleteFolder(id) {
    const f = this.getFolder(id);
    if (!f) return null;
    const parent = f.parentId || null;
    let movedNotes = 0, movedFolders = 0;
    for (const n of this.notes) if (n.folderId === id) { n.folderId = parent; movedNotes++; }
    for (const c of this.folders) if (c.parentId === id) { c.parentId = parent; movedFolders++; }
    this.folders = this.folders.filter((x) => x.id !== id);
    this.settings.expandedFolders = this.settings.expandedFolders.filter((x) => x !== id);
    this.save();
    return { movedNotes, movedFolders, parentId: parent };
  }

  // ---- settings ----------------------------------------------------------

  getSettings() {
    return Object.assign({}, this.settings);
  }

  setSettings(patch) {
    this.settings = sanitizeSettings(Object.assign({}, this.settings, patch || {}));
    this.save();
    return this.getSettings();
  }

  // ---- import / export ---------------------------------------------------

  exportNote(id) {
    const note = this.get(id);
    if (!note) return null;
    return { filename: H.safeFilename(H.deriveTitle(note)) + '.md', content: H.noteToMarkdown(note) };
  }

  exportAll() {
    return JSON.stringify({ exportedAt: this.now(), folders: this.folders, notes: this.notes.filter((n) => !n.trashedAt) }, null, 2);
  }

  importMarkdown(filename, content) {
    const parsed = H.markdownToNote(filename, content);
    return this.create(parsed);
  }
}

module.exports = { Store, DEFAULT_SETTINGS, EDITOR_WIDTH, sanitizeSettings, sanitizeNote, sanitizeFolder, cleanFolderName };
