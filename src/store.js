'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const H = require('./shared/helpers');
const F = require('./files');

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
    // File-backed notes: body mirrors the file; text files are written back in place, other kinds are read-only.
    filePath: typeof raw.filePath === 'string' && raw.filePath ? raw.filePath : null,
    fileKind: ['text', 'pdf', 'docx', 'binary'].includes(raw.fileKind) ? raw.fileKind : null,
    fileMtime: Number.isFinite(raw.fileMtime) ? raw.fileMtime : null,
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
    this.saveBlocked = false;
    this.recoveredFromBackup = false;
    this.backupSuspended = false;
    this.loadError = null;
    if (fs.existsSync(this.file)) {
      let text = null;
      let ioError = null;
      // A locked or busy file is not a corrupt file: retry the read briefly before deciding anything.
      for (let attempt = 0; attempt < 6 && text === null; attempt++) {
        try { text = fs.readFileSync(this.file, 'utf8'); ioError = null; } catch (err) { ioError = err; sleepSync(50 * (attempt + 1)); }
      }
      if (text === null) {
        // Still unreadable: never overwrite a file we could not read. Run with an empty view and refuse to save.
        this.loadError = ioError;
        this.saveBlocked = true;
      } else {
        try {
          raw = JSON.parse(text);
        } catch (err) {
          // Genuinely corrupt: keep the file for the user and start from the newest backup.
          this.loadError = err;
          const quarantined = this.file + '.corrupt-' + this.now();
          try { fs.renameSync(this.file, quarantined); } catch (_) {
            // The corrupt file is stuck in place: never copy it into backups/ or prune good ones for it.
            this.backupSuspended = true;
          }
          raw = this._loadNewestBackup();
          this.recoveredFromBackup = true;
        }
      }
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
    // Recovered from a backup: write it back now, so a quit without further edits does not start empty next time.
    if (this.recoveredFromBackup && !this.saveBlocked) {
      try { this.save(); } catch (_) { /* a later save will persist it; memory is correct */ }
    }
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
    if (this.saveBlocked) {
      const err = new Error('Your notes file could not be read when Notes started (it may be locked by another program). Saving is paused so nothing is overwritten; restart Notes once the file is free.');
      err.code = 'ESAVEBLOCKED';
      throw err;
    }
    fs.mkdirSync(this.dir, { recursive: true });
    this._maybeBackup();
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.serialize(), null, 2), 'utf8');
    replaceFile(tmp, this.file);
    this.backupSuspended = false; // the live file is known-good again
    return this;
  }

  _maybeBackup() {
    const now = this.now();
    if (this.backupSuspended) return; // the file on disk is the corrupt one we could not move aside
    if (!fs.existsSync(this.file) || now - this.lastBackupAt < BACKUP_MIN_INTERVAL_MS) return;
    fs.mkdirSync(this.backupDir, { recursive: true });
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(this.file, path.join(this.backupDir, 'notes-' + stamp + '.json'));
    this.lastBackupAt = now;
    const files = fs.readdirSync(this.backupDir).filter((f) => f.endsWith('.json')).sort();
    // Pruning must never block the note write itself; a backup held open by another program can wait.
    while (files.length > MAX_BACKUPS) { try { fs.unlinkSync(path.join(this.backupDir, files.shift())); } catch (_) { break; } }
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
    try {
      this.save();
    } catch (err) {
      // A note the disk refused must not linger in memory and ride along on a later, unrelated save.
      this.notes = this.notes.filter((n) => n !== note);
      throw err;
    }
    return note;
  }

  update(id, patch) {
    const note = this.get(id);
    if (!note) return null;
    patch = patch || {};
    const before = Object.assign({}, note, { tags: note.tags.slice() });
    let changed = false;
    let fileWritten = false;
    // File-backed: the file is the source of truth and is written first, before any field changes.
    if (typeof patch.body === 'string' && patch.body !== note.body && note.filePath) {
      if (note.fileKind !== 'text') throw Object.assign(new Error('This file type is read-only here.'), { code: 'EREADONLY' });
      note.fileMtime = F.writeTextInPlace(note.filePath, patch.body);
      fileWritten = true;
    }
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
        // Roll back so a retry with the same patch is a real change and gets written. When the file itself
        // was already written, the cache must keep mirroring the file: the user's text is safe on disk, only
        // the metadata write failed.
        if (fileWritten) {
          const keep = { body: note.body, fileMtime: note.fileMtime };
          Object.assign(note, before, keep);
        } else {
          Object.assign(note, before);
        }
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
    // A duplicate of a file-backed note is an ordinary note holding a copy of the text, not a second link.
    return this.create({ title: (note.title || path.basename(note.filePath || '')) + ' (copy)', body: note.body, tags: note.tags, folderId: note.folderId, pinned: false });
  }

  ensureFolder(name, parentId) {
    const found = this.folders.find((f) => (f.parentId || null) === (parentId || null) && f.name.toLowerCase() === String(name).toLowerCase());
    return found || this.createFolder({ name, parentId: parentId || null });
  }

  // Run a mutation and persist it; if the write fails, put memory back exactly as it was so the store
  // never claims a change the disk does not have.
  _commit(mutate) {
    const snapshot = {
      notes: this.notes.map((n) => Object.assign({}, n, { tags: n.tags.slice() })),
      folders: this.folders.map((f) => Object.assign({}, f)),
      settings: Object.assign({}, this.settings, { expandedFolders: this.settings.expandedFolders.slice() }),
    };
    try {
      const result = mutate();
      this.save();
      return result;
    } catch (err) {
      this.notes = snapshot.notes;
      this.folders = snapshot.folders;
      this.settings = snapshot.settings;
      throw err;
    }
  }

  trash(id) {
    const note = this.get(id);
    if (!note || note.trashedAt) return note;
    return this._commit(() => { note.trashedAt = this.now(); return note; }); // pinned is kept for restore
  }

  restore(id) {
    const note = this.get(id);
    if (!note || !note.trashedAt) return note;
    return this._commit(() => {
      note.trashedAt = null;
      if (note.folderId && !this.getFolder(note.folderId)) note.folderId = null;
      note.updatedAt = this.now();
      return note;
    });
  }

  destroy(id) {
    const idx = this.notes.findIndex((n) => n.id === id);
    if (idx === -1) return false;
    return this._commit(() => { this.notes.splice(idx, 1); return true; });
  }

  emptyTrash() {
    const before = this.notes.length;
    if (!this.notes.some((n) => n.trashedAt)) return 0;
    return this._commit(() => { this.notes = this.notes.filter((n) => !n.trashedAt); return before - this.notes.length; });
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

  // ---- file-backed notes -------------------------------------------------

  findByPath(filePath) {
    const key = F.pathKey(filePath);
    return this.notes.find((n) => n.filePath && F.pathKey(n.filePath) === key) || null;
  }

  // Links a file as a note. Text files load their contents; Word files are converted (read-only); PDFs and
  // other binaries are shown through the system viewer. Linking the same file twice returns the same note.
  async linkFile(filePath, opts) {
    opts = opts || {};
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw Object.assign(new Error('File not found: ' + abs), { code: 'ENOENT' });
    const existing = this.findByPath(abs);
    if (existing) {
      if (existing.trashedAt) this.restore(existing.id);
      await this.refreshFileNote(existing.id);
      return existing;
    }
    let kind = F.kindOf(abs);
    let body = '', mtime = F.mtimeOf(abs);
    if (kind === 'text') {
      try { ({ body, mtime } = F.readText(abs)); }
      catch (err) { if (err.code === 'EENCODING') { kind = 'binary'; body = ''; } else throw err; }
    } else if (kind === 'docx') ({ body, mtime } = await F.readDocxAsMarkdown(abs));
    return this.create({
      title: opts.title || path.basename(abs),
      body,
      tags: opts.tags || [],
      folderId: opts.folderId || null,
      filePath: abs,
      fileKind: kind,
      fileMtime: mtime,
    });
  }

  // Re-reads a file-backed note when the file changed on disk. Returns { changed, missing }.
  async refreshFileNote(id) {
    const note = this.get(id);
    if (!note || !note.filePath) return { changed: false, missing: false };
    if (!fs.existsSync(note.filePath)) return { changed: false, missing: true };
    const mtime = F.mtimeOf(note.filePath);
    if (mtime === note.fileMtime) return { changed: false, missing: false };
    let body = note.body;
    if (note.fileKind === 'text') body = F.readText(note.filePath).body;
    else if (note.fileKind === 'docx') body = (await F.readDocxAsMarkdown(note.filePath)).body;
    const changed = body !== note.body;
    // Cache update only: the file changed, the note's own edit time is not touched.
    this._commit(() => { note.body = body; note.fileMtime = mtime; });
    return { changed, missing: false };
  }

  fileNotes() {
    return this.notes.filter((n) => n.filePath && !n.trashedAt);
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

  // Nested tree; count is the number of live notes directly in the folder (what the folder view lists).
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
        const count = direct.get(f.id) || 0;
        const total = count + children.reduce((s, c) => s + c.total, 0);
        return { id: f.id, name: f.name, parentId: f.parentId, depth, count, total, children };
      });
    return build(null, 0);
  }

  createFolder(data) {
    data = data || {};
    const parentId = data.parentId && this.getFolder(data.parentId) ? data.parentId : null;
    const folder = { id: crypto.randomUUID(), name: cleanFolderName(data.name), parentId, createdAt: this.now() };
    this.folders.push(folder);
    try {
      this.save();
    } catch (err) {
      this.folders = this.folders.filter((f) => f !== folder);
      throw err;
    }
    return folder;
  }

  renameFolder(id, name) {
    const f = this.getFolder(id);
    if (!f) return null;
    const next = cleanFolderName(name);
    if (next !== f.name) this._commit(() => { f.name = next; });
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
    if ((f.parentId || null) !== parentId) this._commit(() => { f.parentId = parentId; });
    return { folder: f };
  }

  // Deleting a folder lifts its notes and subfolders into its parent; nothing is lost.
  deleteFolder(id) {
    const f = this.getFolder(id);
    if (!f) return null;
    const parent = f.parentId || null;
    return this._commit(() => {
      let movedNotes = 0, movedFolders = 0;
      for (const n of this.notes) if (n.folderId === id) { n.folderId = parent; movedNotes++; }
      for (const c of this.folders) if (c.parentId === id) { c.parentId = parent; movedFolders++; }
      this.folders = this.folders.filter((x) => x.id !== id);
      this.settings.expandedFolders = this.settings.expandedFolders.filter((x) => x !== id);
      return { movedNotes, movedFolders, parentId: parent };
    });
  }

  // ---- settings ----------------------------------------------------------

  getSettings() {
    return Object.assign({}, this.settings);
  }

  setSettings(patch) {
    const previous = this.settings;
    this.settings = sanitizeSettings(Object.assign({}, this.settings, patch || {}));
    try { this.save(); } catch (err) { this.settings = previous; throw err; }
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
