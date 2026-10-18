'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const H = require('./shared/helpers');
const F = require('./files');
const L = require('./lock');

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
  listCollapsed: false,      // note list hidden (only while a note is open)
  lastFolderId: null,       // folder the list showed last, restored at start
  sidebarWidth: H.PANE_LIMITS.sidebarWidth.def,
  listWidth: H.PANE_LIMITS.listWidth.def,
  expandedFolders: [],      // folder ids whose children are shown in the sidebar
  editorMode: 'rendered',   // rendered | source
  editorAlign: 'center',    // left | center | right: where the writing column sits in the editor pane
  editorWidth: 0,           // max width of the writing column in px; 0 means full width
  columnLayout: 2,          // 2: the defaults above; settings saved before had 760px, left, written out as if chosen
  panes: null,              // open tabs on each side of the editor and the split; see sanitizePanes
  gitEnabled: true,         // commit notes.json to a git repo in the data folder after changes
  gitRemote: '',            // optional remote URL to push to after each commit
  ttsVoice: '',             // speechSynthesis voice name; '' = system default
  ttsRate: 1,               // 0.5 .. 2
  zoomLevel: 0,             // main window zoom (Chromium levels, -3 .. 5); Ctrl+= / Ctrl+- / Ctrl+0
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

function stem(fileName) {
  const ext = path.extname(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

function cleanFolderName(name) {
  const s = String(name == null ? '' : name).replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
  return (s || 'Untitled folder').slice(0, FOLDER_NAME_MAX);
}

// The longest reading order a book keeps, and so the most pages a split may make.
const MAX_BOOK_PAGES = 5000;

function sanitizeFolder(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    name: cleanFolderName(raw.name),
    parentId: typeof raw.parentId === 'string' && raw.parentId ? raw.parentId : null,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    // Vault folders mirror a directory on disk.
    vaultId: typeof raw.vaultId === 'string' && raw.vaultId ? raw.vaultId : null,
    dirPath: typeof raw.dirPath === 'string' && raw.dirPath ? raw.dirPath : null,
    // A book is a folder whose notes are pages, read in this order (ids not listed follow, oldest first).
    book: !!raw.book,
    pageOrder: Array.isArray(raw.pageOrder) ? raw.pageOrder.filter((x) => typeof x === 'string' && x).slice(0, MAX_BOOK_PAGES) : [],
  };
}

// A vault is a folder on disk (optionally a git repository) whose text files are notes.
function sanitizeVault(raw, now) {
  if (!raw || typeof raw !== 'object' || typeof raw.path !== 'string' || !raw.path) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    name: cleanFolderName(raw.name || path.basename(raw.path)),
    path: path.resolve(raw.path),
    remote: typeof raw.remote === 'string' ? raw.remote.trim().slice(0, 500) : '',
    autoSync: raw.autoSync !== false,
    syncMinutes: Number.isFinite(Number(raw.syncMinutes)) ? Math.min(240, Math.max(1, Math.round(Number(raw.syncMinutes)))) : 5,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
  };
}

const VAULT_EXT = new Set(['md', 'markdown', 'mdx', 'txt', 'text', 'tex', 'latex', 'bib', 'org', 'rst']);
const VAULT_SKIP_DIRS = new Set(['.git', '.trash', '.obsidian', 'node_modules', '.vscode', '.idea']);

// Directories the scan skips must not be creatable or renamable from the app: their notes would vanish
// from view while staying on disk.
function assertVaultDirName(name) {
  const safe = H.safeFilename(name);
  if (/^\./.test(safe) || VAULT_SKIP_DIRS.has(safe.toLowerCase())) throw Object.assign(new Error('A vault folder cannot be named "' + safe + '": the app does not scan folders with that name.'), { code: 'ENAME' });
}

function uniqueName(dir, base, ext) {
  let candidate = base + ext;
  let i = 2;
  while (fs.existsSync(path.join(dir, candidate))) { candidate = base + ' ' + i + ext; i++; }
  return candidate;
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

const TABS_MAX = 50;

// The editor's tabs: { split, ratio (left side's share), active ('left' | 'right'), left, right }, each side
// { ids: note ids in tab order, current: the id shown }. Unknown ids are dropped when a tab is opened.
function sanitizePanes(raw) {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const side = (v) => {
    const o = v && typeof v === 'object' ? v : {};
    const ids = Array.isArray(o.ids) ? Array.from(new Set(o.ids.filter((x) => typeof x === 'string' && x && x.length <= 100))).slice(0, TABS_MAX) : [];
    return { ids, current: ids.includes(o.current) ? o.current : null };
  };
  const left = side(p.left);
  const right = side(p.right);
  right.ids = right.ids.filter((id) => !left.ids.includes(id)); // a note is open on one side only
  if (!right.ids.includes(right.current)) right.current = null;
  const ratio = Number(p.ratio);
  return {
    split: !!p.split,
    ratio: Number.isFinite(ratio) ? Math.min(0.8, Math.max(0.2, Math.round(ratio * 1000) / 1000)) : 0.5,
    active: p.split && p.active === 'right' ? 'right' : 'left',
    left,
    right: p.split ? right : { ids: [], current: null },
  };
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
  s.listCollapsed = !!s.listCollapsed;
  s.lastFolderId = typeof s.lastFolderId === 'string' && s.lastFolderId ? s.lastFolderId : null;
  s.zoomLevel = Number.isFinite(Number(s.zoomLevel)) ? Math.max(-3, Math.min(5, Math.round(Number(s.zoomLevel) * 2) / 2)) : 0;
  s.sidebarWidth = H.clampPane('sidebarWidth', s.sidebarWidth);
  s.listWidth = H.clampPane('listWidth', s.listWidth);
  s.expandedFolders = Array.isArray(s.expandedFolders) ? s.expandedFolders.filter((x) => typeof x === 'string').slice(0, 5000) : [];
  s.editorMode = s.editorMode === 'source' ? 'source' : 'rendered';
  s.editorAlign = ['left', 'center', 'right'].includes(s.editorAlign) ? s.editorAlign : DEFAULT_SETTINGS.editorAlign;
  s.editorWidth = clampEditorWidth(s.editorWidth);
  // Every save wrote the old defaults (760px, left) whether or not they were picked, so those move to the new ones once.
  if (src.columnLayout !== 2 && s.editorWidth === 760 && s.editorAlign === 'left') {
    s.editorWidth = DEFAULT_SETTINGS.editorWidth;
    s.editorAlign = DEFAULT_SETTINGS.editorAlign;
  }
  s.columnLayout = 2;
  s.panes = s.panes == null ? null : sanitizePanes(s.panes);
  s.gitEnabled = !!s.gitEnabled;
  s.gitRemote = typeof s.gitRemote === 'string' ? s.gitRemote.trim().slice(0, 500) : '';
  s.ttsVoice = typeof s.ttsVoice === 'string' ? s.ttsVoice.slice(0, 200) : '';
  s.ttsRate = Number.isFinite(Number(s.ttsRate)) ? Math.min(2, Math.max(0.5, Math.round(Number(s.ttsRate) * 10) / 10)) : 1;
  s.sort = ['updated', 'created', 'title'].includes(s.sort) ? s.sort : 'updated';
  if (s.window && typeof s.window === 'object') {
    const w = s.window;
    const ok = ['width', 'height'].every((k) => Number.isFinite(w[k]) && w[k] > 100) && ['x', 'y'].every((k) => Number.isFinite(w[k]));
    s.window = ok ? { x: Math.round(w.x), y: Math.round(w.y), width: Math.round(w.width), height: Math.round(w.height) } : null;
  } else s.window = null;
  return s;
}

const STICKY_COLORS = ['peach', 'cream', 'leaf', 'sky', 'rose', 'ink'];

// A note shown as a desktop sticky: where it sits, how big, which tint, whether it floats above other windows.
function sanitizeSticky(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v, d) => (Number.isFinite(v) ? Math.round(v) : d);
  return {
    x: num(raw.x, null), y: num(raw.y, null),
    w: Math.max(180, Math.min(1600, num(raw.w, 280))), h: Math.max(140, Math.min(1600, num(raw.h, 260))),
    color: STICKY_COLORS.includes(raw.color) ? raw.color : 'peach',
    onTop: raw.onTop !== false,
  };
}

// A live-share session recorded on a note so it can be resumed after a restart.
function sanitizeLive(raw) {
  if (!raw || typeof raw !== 'object' || (raw.role !== 'host' && raw.role !== 'guest') || typeof raw.url !== 'string') return null;
  return { role: raw.role, url: raw.url, token: typeof raw.token === 'string' ? raw.token : undefined, port: Number.isFinite(raw.port) ? raw.port : undefined, pending: raw.pending ? true : undefined };
}

function sanitizeNote(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : now;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    title: typeof raw.title === 'string' ? raw.title : '',
    body: typeof raw.body === 'string' && !L.sanitizeLock(raw.lock) ? raw.body : '',
    tags: H.parseTags(raw.tags || []),
    folderId: typeof raw.folderId === 'string' && raw.folderId ? raw.folderId : null,
    // File-backed notes: body mirrors the file; text files are written back in place, other kinds are read-only.
    filePath: typeof raw.filePath === 'string' && raw.filePath ? raw.filePath : null,
    fileKind: ['text', 'pdf', 'docx', 'binary'].includes(raw.fileKind) ? raw.fileKind : null,
    fileMtime: Number.isFinite(raw.fileMtime) ? raw.fileMtime : null,
    vaultId: typeof raw.vaultId === 'string' && raw.vaultId ? raw.vaultId : null,
    trashedFrom: typeof raw.trashedFrom === 'string' && raw.trashedFrom ? raw.trashedFrom : undefined,
    sticky: sanitizeSticky(raw.sticky),
    live: sanitizeLive(raw.live),
    // A locked note stores only ciphertext; its body field is always empty on disk.
    lock: L.sanitizeLock(raw.lock),
    remindAt: Number.isFinite(raw.remindAt) ? Math.round(raw.remindAt) : null,
    remindedAt: Number.isFinite(raw.remindedAt) ? Math.round(raw.remindedAt) : null,
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
    this.plain = new Map(); // noteId -> decrypted body, for notes unlocked this session
    this.keys = new Map();  // noteId -> derived key, so edits can be re-encrypted without the password
    this.folders = [];
    this.vaults = [];
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
          // Nothing to recover from and the damaged file cannot be moved aside: never write over it.
          if (!raw && this.backupSuspended) this.saveBlocked = true;
        }
      }
    }
    const now = this.now();
    const notes = Array.isArray(raw && raw.notes) ? raw.notes : [];
    const folders = Array.isArray(raw && raw.folders) ? raw.folders : [];
    const vaults = Array.isArray(raw && raw.vaults) ? raw.vaults : [];
    this.notes = notes.map((n) => sanitizeNote(n, now)).filter(Boolean);
    this.folders = folders.map((f) => sanitizeFolder(f, now)).filter(Boolean);
    this.vaults = vaults.map((v) => sanitizeVault(v, now)).filter(Boolean);
    const vaultIds = new Set(this.vaults.map((v) => v.id));
    for (const f of this.folders) if (f.vaultId && !vaultIds.has(f.vaultId)) { f.vaultId = null; f.dirPath = null; }
    for (const n of this.notes) if (n.vaultId && !vaultIds.has(n.vaultId)) n.vaultId = null;
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
    return { schemaVersion: SCHEMA_VERSION, savedAt: this.now(), settings: this.settings, vaults: this.vaults, folders: this.folders, notes: this.notes };
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
    const stamp = H.fileStamp(now);
    // A backup that cannot be written must never block the note save itself.
    try { fs.copyFileSync(this.file, path.join(this.backupDir, 'notes-' + stamp + '.json')); } catch (_) { return; }
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
    if (opts.reminders) out = out.filter((n) => n.remindAt);
    if (opts.query) out = out.filter((n) => H.matchesQuery(n, opts.query));
    if (opts.reminders) return out.slice().sort((a, b) => a.remindAt - b.remindAt); // soonest first
    // A book lists its pages in reading order, whatever the sort setting.
    if (opts.folderId && !opts.recursive && !opts.query && !trashed) {
      const f = this.getFolder(opts.folderId);
      if (f && f.book) return this._orderPages(f, out);
    }
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
    let fileWritten = false; // the body landed in the file
    let plainBefore;          // the cached plaintext to restore if the save fails
    if (note.lock && typeof patch.body === 'string') {
      // A locked view can only ever send an empty body (that is all it has): ignore it, so title and tag
      // edits still save. Any other body while locked is a mistake.
      if (!this.plain.has(id) && patch.body !== '') throw Object.assign(new Error('This note is locked. Unlock it first.'), { code: 'ELOCKED' });
      if (this.plain.has(id) && patch.body !== this.plain.get(id)) {
        plainBefore = this.plain.get(id);
        note.lock = L.encrypt(patch.body, this.keys.get(id), note.lock.salt);
        this.plain.set(id, patch.body);
        changed = true;
      }
      patch = Object.assign({}, patch); delete patch.body; // the record's body stays empty
    }
    let fileMoved = false;   // the file was renamed, moved, or created on disk
    // Refusals first, before anything touches the disk.
    if (patch.folderId !== undefined && note.vaultId && note.filePath && !patch.folderId && (note.folderId || null) !== null) throw Object.assign(new Error('A vault note can only move within its vault.'), { code: 'EVAULT' });
    if (patch.folderId && note.filePath && !note.vaultId) {
      const t = this.getFolder(patch.folderId);
      if (t && t.vaultId) throw Object.assign(new Error('A linked file cannot be moved into a vault; copy its text into a new note there instead.'), { code: 'EVAULT' });
    }
    // File-backed: the file is the source of truth and is written first, before any field changes.
    if (typeof patch.body === 'string' && patch.body !== note.body && note.filePath) {
      if (note.fileKind !== 'text') throw Object.assign(new Error('This file type is read-only here.'), { code: 'EREADONLY' });
      // Someone else (git, another editor) changed the file since it was last read: do not overwrite them.
      if (!patch.force && note.fileMtime !== null) {
        const diskM = F.mtimeOf(note.filePath);
        if (diskM !== null && diskM !== note.fileMtime) {
          let onDisk = null;
          try { onDisk = F.readText(note.filePath).body; } catch (_) { /* unreadable: treat as changed */ }
          if (onDisk !== note.body && onDisk !== patch.body) throw Object.assign(new Error('This file changed on disk since it was opened.'), { code: 'ECONFLICT' });
        }
      }
      note.fileMtime = F.writeTextInPlace(note.filePath, patch.body);
      fileWritten = true;
    }
    if (typeof patch.title === 'string' && patch.title !== note.title) {
      // In a vault the title is the file name: rename the file first, then record what it became.
      if (note.vaultId && note.filePath && note.fileKind === 'text') {
        try { note.title = this._renameVaultFile(note, patch.title); fileMoved = true; }
        catch (err) { if (fileWritten) { note.body = patch.body; } throw err; } // the body did land; keep memory honest
      } else note.title = patch.title;
      changed = true;
    }
    if (typeof patch.body === 'string' && patch.body !== note.body) { note.body = patch.body; changed = true; }
    if (patch.folderId !== undefined && note.vaultId && note.filePath) {
      const fid = patch.folderId || null;
      if (fid !== (note.folderId || null)) {
        if (!fid) throw Object.assign(new Error('A vault note can only move within its vault.'), { code: 'EVAULT' });
        note.filePath = this._moveVaultFile(note, fid);
        note.folderId = fid; changed = true; fileMoved = true;
      }
      delete patch.folderId;
    } else if (patch.folderId && !note.filePath) {
      // A plain note dropped into a vault folder becomes a file there, so it is synced like the others.
      const target = this.getFolder(patch.folderId);
      if (target && target.vaultId && note.lock) throw Object.assign(new Error('A locked note cannot move into a vault: it would be written to disk in clear. Remove the lock first.'), { code: 'ELOCKED' });
      if (target && target.vaultId && target.dirPath) {
        fs.mkdirSync(target.dirPath, { recursive: true });
        const name = uniqueName(target.dirPath, H.safeFilename(H.deriveTitle(note)), '.md');
        const full = path.join(target.dirPath, name);
        fs.writeFileSync(full, note.body, 'utf8');
        note.filePath = full; note.fileKind = 'text'; note.fileMtime = F.mtimeOf(full); note.vaultId = target.vaultId;
        note.title = stem(name); note.folderId = target.id; changed = true; fileMoved = true;
        delete patch.folderId;
      }
    }
    if (patch.tags !== undefined) {
      const tags = H.parseTags(patch.tags);
      if (tags.join(',') !== note.tags.join(',')) { note.tags = tags; changed = true; }
    }
    if (typeof patch.pinned === 'boolean' && patch.pinned !== note.pinned) { note.pinned = patch.pinned; changed = true; }
    if (patch.remindAt !== undefined) {
      const at = Number.isFinite(patch.remindAt) ? Math.round(patch.remindAt) : null;
      if (at !== note.remindAt) { note.remindAt = at; note.remindedAt = null; changed = true; } // a new time rings again
    }
    if (patch.folderId !== undefined) {
      const fid = patch.folderId && this.getFolder(patch.folderId) ? patch.folderId : null;
      if (fid !== (note.folderId || null)) { note.folderId = fid; changed = true; }
    }
    if (changed) {
      note.updatedAt = this.now();
      try {
        this.save();
      } catch (err) {
        // Roll back so a retry with the same patch is a real change and gets written. Whatever already
        // happened on disk (a written body, a renamed or moved file) must stay reflected in memory: the
        // user's text and the file's location are the truth, only the metadata write failed.
        const keep = {};
        if (fileWritten) Object.assign(keep, { body: note.body, fileMtime: note.fileMtime });
        if (fileMoved) Object.assign(keep, { filePath: note.filePath, title: note.title, folderId: note.folderId, vaultId: note.vaultId, fileKind: note.fileKind, fileMtime: note.fileMtime });
        Object.assign(note, before, keep);
        if (plainBefore !== undefined) this.plain.set(id, plainBefore);
        throw err;
      }
    }
    return note;
  }

  // ---- locking ----------------------------------------------------------------

  // What leaves the store: never the ciphertext; the body only while unlocked this session.
  publicNote(n) {
    if (!n) return n;
    if (n.lock === undefined && typeof n.locked === 'boolean') return n; // already a public view: idempotent
    const out = Object.assign({}, n);
    delete out.lock;
    out.locked = !!n.lock;
    out.unlocked = !!n.lock && this.plain.has(n.id);
    if (n.lock) out.body = out.unlocked ? this.plain.get(n.id) : '';
    return out;
  }

  lockNote(id, password) {
    const note = this.get(id);
    if (!note) return null;
    if (note.filePath || note.vaultId) throw Object.assign(new Error('A file-backed note cannot be locked: the file itself would stay readable.'), { code: 'EFILE' });
    if (!password || !String(password).length) throw Object.assign(new Error('Enter a password.'), { code: 'EPASS' });
    if (note.lock) throw Object.assign(new Error('This note is already locked.'), { code: 'ELOCKED' });
    const body = note.body;
    const { blob, key } = L.lock(body, password);
    this._commit(() => { note.lock = blob; note.body = ''; note.sticky = null; note.updatedAt = this.now(); return note; });
    this.plain.set(id, body);
    this.keys.set(id, key);
    return this.publicNote(note);
  }

  unlockNote(id, password) {
    const note = this.get(id);
    if (!note) return null;
    if (!note.lock) return this.publicNote(note);
    const r = L.unlock(note.lock, password);
    if (!r) throw Object.assign(new Error('Wrong password.'), { code: 'EPASS' });
    this.plain.set(id, r.body);
    this.keys.set(id, r.key);
    return this.publicNote(note);
  }

  relock(id) {
    const was = this.plain.has(id);
    this.plain.delete(id);
    this.keys.delete(id);
    return was;
  }

  // Forgets every unlocked body; returns the ids that were unlocked.
  relockAll() {
    const ids = Array.from(this.plain.keys());
    this.plain.clear();
    this.keys.clear();
    return ids;
  }

  removeLock(id, password) {
    const note = this.get(id);
    if (!note || !note.lock) return this.publicNote(note);
    const r = L.unlock(note.lock, password);
    if (!r) throw Object.assign(new Error('Wrong password.'), { code: 'EPASS' });
    this._commit(() => { note.lock = null; note.body = r.body; note.updatedAt = this.now(); return note; });
    this.relock(id);
    return this.publicNote(note);
  }

  // Called by the reminder scheduler when a reminder has been announced.
  markReminded(id, at) {
    const note = this.get(id);
    if (!note) return null;
    return this._commit(() => { note.remindedAt = at; return note; });
  }

  // Desktop stickies. Only this path changes the field; update() ignores it.
  setSticky(id, sticky) {
    const note = this.get(id);
    if (!note) return null;
    const next = sticky ? sanitizeSticky(Object.assign({}, note.sticky || {}, sticky)) : null;
    if (JSON.stringify(next) === JSON.stringify(note.sticky || null)) return note;
    return this._commit(() => { note.sticky = next; return note; });
  }

  // ---- books -------------------------------------------------------------------

  _orderPages(folder, notes) {
    const rank = new Map((folder.pageOrder || []).map((id, i) => [id, i]));
    return notes.slice().sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : Infinity, rb = rank.has(b.id) ? rank.get(b.id) : Infinity;
      if (ra !== rb) return ra - rb;
      return (a.createdAt - b.createdAt) || a.id.localeCompare(b.id); // unlisted pages: oldest first, i.e. new pages go last
    });
  }

  // Live pages of a book, in reading order.
  bookPages(folderId) {
    const f = this.getFolder(folderId);
    if (!f) return [];
    return this._orderPages(f, this.notes.filter((n) => !n.trashedAt && n.folderId === folderId));
  }

  setBook(folderId, on) {
    const f = this.getFolder(folderId);
    if (!f) return null;
    if (!!f.book === !!on) return f;
    return this._commit(() => {
      f.book = !!on;
      // Turning a folder into a book fixes the current order (oldest first) so it stays put.
      if (f.book && !(f.pageOrder || []).length) f.pageOrder = this.bookPages(folderId).map((n) => n.id);
      return f;
    });
  }

  // ids: the new reading order. Unknown ids are dropped; pages missing from the list keep their relative order after it.
  reorderPages(folderId, ids) {
    const f = this.getFolder(folderId);
    if (!f || !f.book) return null;
    const pages = this.bookPages(folderId).map((n) => n.id);
    const wanted = (Array.isArray(ids) ? ids : []).filter((id, i, a) => pages.includes(id) && a.indexOf(id) === i);
    const next = wanted.concat(pages.filter((id) => !wanted.includes(id)));
    // Pages in the trash keep their place, so restoring one puts it back where it was.
    const old = f.pageOrder || [];
    old.forEach((id, i) => {
      if (next.includes(id)) return;
      const n = this.get(id);
      if (!n || !n.trashedAt || n.folderId !== folderId) return;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) { const k = next.indexOf(old[j]); if (k !== -1) { at = k + 1; break; } }
      next.splice(at, 0, id);
    });
    return this._commit(() => { f.pageOrder = next; return f; });
  }

  // ---- related notes --------------------------------------------------------------

  // What a note links to, what links to it, and notes that share its tags. Locked bodies are only read
  // while unlocked this session (their stored body is empty); titles are always visible.
  related(id, limit) {
    const note = this.get(id);
    if (!note) return null;
    const bodyOf = (n) => (n.lock ? (this.plain.get(n.id) || '') : n.body);
    const view = (n) => ({ id: n.id, title: H.deriveTitle(this.publicNote(n)) || 'Untitled', trashed: !!n.trashedAt, locked: !!n.lock });
    const outgoing = H.noteLinkIds(bodyOf(note)).filter((x) => x !== id).map((x) => {
      const t = this.get(x);
      return t ? view(t) : { id: x, title: 'Deleted note', missing: true };
    });
    const needle = 'note://' + id.toLowerCase();
    const incoming = this.notes.filter((n) => n.id !== id && !n.trashedAt && bodyOf(n).toLowerCase().includes(needle)).map(view);
    const seen = new Set([id].concat(outgoing.map((x) => x.id), incoming.map((x) => x.id)));
    const tags = new Set(note.tags || []);
    const byTags = tags.size ? this.notes
      .filter((n) => !n.trashedAt && !seen.has(n.id) && (n.tags || []).some((t) => tags.has(t)))
      .map((n) => ({ n, shared: n.tags.filter((t) => tags.has(t)) }))
      .sort((a, b) => (b.shared.length - a.shared.length) || (b.n.updatedAt - a.n.updatedAt))
      .slice(0, limit || 5)
      .map(({ n, shared }) => Object.assign(view(n), { sharedTags: shared })) : [];
    return { outgoing, incoming, byTags };
  }

  setLive(id, live) {
    const note = this.get(id);
    if (!note) return null;
    const next = sanitizeLive(live);
    if (JSON.stringify(next) === JSON.stringify(note.live || null)) return note;
    return this._commit(() => { note.live = next; return note; });
  }

  stickies() {
    return this.notes.filter((n) => n.sticky && !n.trashedAt);
  }

  togglePin(id) {
    const note = this.get(id);
    if (!note) return null;
    return this.update(id, { pinned: !note.pinned });
  }

  duplicate(id) {
    const note = this.get(id);
    if (!note) return null;
    if (note.lock) {
      if (!this.plain.has(id)) throw Object.assign(new Error('This note is locked. Unlock it first.'), { code: 'ELOCKED' });
      const key = this.keys.get(id);
      // One write: the copy is created already locked (a failed save leaves nothing behind).
      const copy = this.create({ title: note.title + ' (copy)', body: '', tags: note.tags, folderId: note.folderId, pinned: false, lock: L.encrypt(this.plain.get(id), key, note.lock.salt) });
      this.plain.set(copy.id, this.plain.get(id));
      this.keys.set(copy.id, key);
      return this.publicNote(copy);
    }
    // A duplicate inside a vault is a new file there; of any other file-backed note, an ordinary note holding a copy.
    const folder = note.folderId ? this.getFolder(note.folderId) : null;
    if (note.vaultId && folder && folder.vaultId && folder.dirPath) return this.createVaultNote(folder.id, { title: note.title + ' (copy)', body: note.body, tags: note.tags });
    return this.create({ title: (note.title || path.basename(note.filePath || '')) + ' (copy)', body: note.body, tags: note.tags, folderId: note.folderId, pinned: false });
  }

  // Turns a note into a book: a new folder (next to the note) whose pages are the note's sections, cut at its
  // headings (H.splitAtHeadings). One write. opts: { name, keepOriginal }. The original goes to the trash unless
  // kept. Returns { folder, pageIds, originalTrashed }.
  splitIntoBook(id, opts) {
    opts = opts || {};
    const note = this.get(id);
    if (!note || note.trashedAt) throw new Error('Note not found');
    if (note.lock) throw new Error('This note is locked. Remove the lock to split it.');
    if (note.filePath) throw new Error('This note is a file on disk; only notes kept in the app can be split.');
    const plan = H.splitAtHeadings(note.body, H.deriveTitle(note));
    if (plan.pages.length < 2) throw new Error('This note needs at least two headings (lines starting with #) to split.');
    if (plan.pages.length > MAX_BOOK_PAGES) throw new Error('This note would make more than ' + MAX_BOOK_PAGES + ' pages, the most a book holds.');
    const now = this.now();
    const parent = note.folderId ? this.getFolder(note.folderId) : null;
    const parentId = parent && !parent.vaultId ? parent.id : null; // a vault folder holds files; the book sits at the top
    const folder = { id: crypto.randomUUID(), name: cleanFolderName(String(opts.name || '').trim() || plan.name), parentId, createdAt: now, book: true, pageOrder: [] };
    const pages = plan.pages.map((p) => sanitizeNote({ id: crypto.randomUUID(), title: p.title, body: p.body, tags: note.tags.slice(), folderId: folder.id, pinned: false, createdAt: now, updatedAt: now, trashedAt: null }, now));
    folder.pageOrder = pages.map((p) => p.id);
    const originalTrashed = !opts.keepOriginal;
    return this._commit(() => {
      this.folders.push(folder);
      this.notes.unshift(...pages);
      if (originalTrashed) { note.trashedAt = now; note.sticky = null; }
      return { folder, pageIds: folder.pageOrder.slice(), originalTrashed };
    });
  }

  // Takes back splitIntoBook: deletes the pages it made and the emptied book folder, and restores the original
  // note if it was trashed. All or nothing: it refuses, changing nothing, when a page was edited since (undo would
  // lose the edit) or the trashed original is gone (undo would lose everything). Only pages still in that book
  // are touched; pages moved out meanwhile are left alone. Returns { restored, removedIds }.
  undoSplit(folderId, pageIds, originalId) {
    const folder = typeof folderId === 'string' ? this.getFolder(folderId) : null;
    if (!folder || !folder.book || folder.vaultId) throw new Error('That book is gone, so there is nothing to undo.');
    const ids = new Set(Array.isArray(pageIds) ? pageIds.filter((x) => typeof x === 'string') : []);
    const pages = this.notes.filter((n) => ids.has(n.id) && n.folderId === folder.id);
    if (pages.some((n) => n.lock || n.filePath)) throw new Error('A page of that book is locked or a file on disk, so the split cannot be undone.');
    if (pages.some((n) => n.updatedAt !== n.createdAt)) throw new Error('A page was edited after the split, and undoing would lose the edit. Delete the book yourself if you want it gone.');
    const orig = originalId != null ? this.get(originalId) : null;
    if (originalId != null && !orig) throw new Error('The original note was deleted, so the split cannot be undone.');
    return this._commit(() => {
      this.notes = this.notes.filter((n) => !pages.includes(n));
      if (!this.notes.some((n) => n.folderId === folder.id) && !this.folders.some((f) => f.parentId === folder.id)) this.folders = this.folders.filter((f) => f !== folder);
      if (orig && orig.trashedAt) orig.trashedAt = null;
      return { restored: !!orig, removedIds: pages.map((n) => n.id) };
    });
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
      vaults: this.vaults.map((v) => Object.assign({}, v)),
      settings: Object.assign({}, this.settings, { expandedFolders: this.settings.expandedFolders.slice() }),
    };
    try {
      const result = mutate();
      this.save();
      return result;
    } catch (err) {
      this.notes = snapshot.notes;
      this.folders = snapshot.folders;
      this.vaults = snapshot.vaults;
      this.settings = snapshot.settings;
      throw err;
    }
  }

  // ---- vaults: folders on disk mirrored as notes ---------------------------

  getVault(id) {
    return this.vaults.find((v) => v.id === id) || null;
  }

  vaultRootFolder(vaultId) {
    return this.folders.find((f) => f.vaultId === vaultId && f.parentId === null) || null;
  }

  folderDir(folderId) {
    const f = this.getFolder(folderId);
    return f && f.vaultId ? f.dirPath : null;
  }

  addVault(data) {
    const vault = sanitizeVault(Object.assign({}, data, { id: crypto.randomUUID(), createdAt: this.now() }), this.now());
    if (!vault) throw new Error('A vault needs a folder path.');
    if (!fs.existsSync(vault.path) || !fs.statSync(vault.path).isDirectory()) throw Object.assign(new Error('Folder not found: ' + vault.path), { code: 'ENOENT' });
    const dup = this.vaults.find((v) => F.pathKey(v.path) === F.pathKey(vault.path));
    if (dup) return dup;
    const inside = (a, b) => (F.pathKey(a) + path.sep).startsWith(F.pathKey(b) + path.sep);
    const overlap = this.vaults.find((v) => inside(vault.path, v.path) || inside(v.path, vault.path));
    if (overlap) throw Object.assign(new Error('That folder overlaps the vault "' + overlap.name + '"; one vault cannot sit inside another.'), { code: 'EOVERLAP' });
    return this._commit(() => {
      this.vaults.push(vault);
      this.folders.push({ id: crypto.randomUUID(), name: vault.name, parentId: null, createdAt: this.now(), vaultId: vault.id, dirPath: vault.path });
      return vault;
    });
  }

  updateVault(id, patch) {
    const v = this.getVault(id);
    if (!v) return null;
    return this._commit(() => {
      const next = sanitizeVault(Object.assign({}, v, patch || {}, { id: v.id, path: v.path, createdAt: v.createdAt }), this.now());
      Object.assign(v, next);
      const root = this.vaultRootFolder(id);
      if (root && patch && patch.name) root.name = v.name;
      return v;
    });
  }

  // Removes the vault from the app. Files on disk are never touched.
  removeVault(id) {
    const v = this.getVault(id);
    if (!v) return false;
    return this._commit(() => {
      this.notes = this.notes.filter((n) => n.vaultId !== id);
      this.folders = this.folders.filter((f) => f.vaultId !== id);
      this.vaults = this.vaults.filter((x) => x.id !== id);
      this.settings.expandedFolders = this.settings.expandedFolders.filter((fid) => this.folders.some((f) => f.id === fid));
      return true;
    });
  }

  // Makes the folder tree and notes match the directory. Returns counts. Idempotent and safe to call often.
  // opts.allowRemovals=false keeps mirrors of files that are momentarily absent (e.g. during a git rebase).
  async scanVault(id, opts) {
    opts = opts || {};
    const allowRemovals = opts.allowRemovals !== false;
    const vault = this.getVault(id);
    if (!vault) return null;
    // An unplugged drive or an unmounted share is not an empty vault: touch nothing until it is back.
    let rootEntries = null;
    try { rootEntries = fs.readdirSync(vault.path, { withFileTypes: true }); } catch (_) { return { added: 0, updated: 0, removed: 0, unavailable: true }; }
    const root = this.vaultRootFolder(id) || this._commit(() => { const f = { id: crypto.randomUUID(), name: vault.name, parentId: null, createdAt: this.now(), vaultId: id, dirPath: vault.path }; this.folders.push(f); return f; });
    const seenFolders = new Set([root.id]);
    const seenNotes = new Set();
    let added = 0, updated = 0, removed = 0;
    const walk = async (dir, folderId) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (VAULT_SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
          let sub = this.folders.find((f) => f.vaultId === id && f.dirPath && F.pathKey(f.dirPath) === F.pathKey(full));
          if (!sub) {
            sub = this._commit(() => { const f = { id: crypto.randomUUID(), name: e.name, parentId: folderId, createdAt: this.now(), vaultId: id, dirPath: full }; this.folders.push(f); return f; });
          } else if (sub.parentId !== folderId || sub.name !== e.name) {
            this._commit(() => { sub.parentId = folderId; sub.name = e.name; });
          }
          seenFolders.add(sub.id);
          await walk(full, sub.id);
        } else if (e.isFile()) {
          if (!VAULT_EXT.has(F.extOf(e.name))) continue;
          let note = this.findByPath(full);
          if (!note) {
            // A file renamed or moved outside the app: the note whose file vanished and whose text matches
            // keeps its id, tags, pin, reminder and sticky instead of being deleted and re-created.
            let text = null;
            try { text = F.readText(full).body; } catch (_) { continue; }
            const orphan = this.notes.find((n) => n.vaultId === id && !n.trashedAt && n.filePath && !seenNotes.has(n.id) && n.body === text && !fs.existsSync(n.filePath));
            if (orphan) {
              this._commit(() => { orphan.filePath = full; orphan.title = stem(e.name); orphan.folderId = folderId; orphan.fileMtime = F.mtimeOf(full); });
              note = orphan; updated++;
            } else {
              try {
                note = await this.linkFile(full, { folderId, title: stem(e.name) });
                this._commit(() => { note.vaultId = id; });
                added++;
              } catch (_) { continue; }
            }
          } else {
            // One unreadable file (too big, not UTF-8) must not stop the rest of the scan.
            let r;
            try { r = await this.refreshFileNote(note.id); } catch (_) { seenNotes.add(note.id); continue; }
            if (r.changed) updated++;
            if (note.folderId !== folderId || note.vaultId !== id || note.trashedAt) {
              this._commit(() => { note.folderId = folderId; note.vaultId = id; note.trashedAt = null; });
            }
          }
          seenNotes.add(note.id);
        }
      }
    };
    await walk(vault.path, root.id);
    // Files or directories that vanished (deleted elsewhere, or moved out by git): drop their mirrors.
    const gone = allowRemovals ? this.notes.filter((n) => n.vaultId === id && !n.trashedAt && !seenNotes.has(n.id) && !(n.filePath && fs.existsSync(n.filePath))) : [];
    const goneFolders = allowRemovals ? this.folders.filter((f) => f.vaultId === id && !seenFolders.has(f.id) && !(f.dirPath && fs.existsSync(f.dirPath))) : [];
    if (gone.length || goneFolders.length) {
      this._commit(() => {
        const goneIds = new Set(gone.map((n) => n.id));
        const goneFolderIds = new Set(goneFolders.map((f) => f.id));
        this.notes = this.notes.filter((n) => !goneIds.has(n.id));
        this.folders = this.folders.filter((f) => !goneFolderIds.has(f.id));
        removed = gone.length;
      });
    }
    return { added, updated, removed, notes: seenNotes.size, folders: seenFolders.size };
  }

  // A new note inside a vault folder is a new file; the title is the file name.
  createVaultNote(folderId, data) {
    const folder = this.getFolder(folderId);
    if (!folder || !folder.vaultId || !folder.dirPath) throw new Error('Not a vault folder');
    data = data || {};
    fs.mkdirSync(folder.dirPath, { recursive: true });
    const base = H.safeFilename(String(data.title || '').trim() || 'Untitled');
    const name = uniqueName(folder.dirPath, base, '.md');
    const full = path.join(folder.dirPath, name);
    const body = String(data.body || '');
    fs.writeFileSync(full, body, 'utf8');
    return this.create({
      title: stem(name), body, tags: data.tags || [], folderId: folder.id,
      filePath: full, fileKind: 'text', fileMtime: F.mtimeOf(full), vaultId: folder.vaultId, pinned: !!data.pinned,
    });
  }

  // Renaming a vault note renames its file; a clash gets a numeric suffix. Returns the new title.
  _renameVaultFile(note, title) {
    const dir = path.dirname(note.filePath);
    const ext = path.extname(note.filePath) || '.md';
    const base = H.safeFilename(String(title || '').trim() || 'Untitled');
    if (base === stem(path.basename(note.filePath))) return note.title;
    // Only the case changed (notes -> Notes): Windows would find the file itself in the way; rename directly.
    const name = base.toLowerCase() === stem(path.basename(note.filePath)).toLowerCase() ? base + ext : uniqueName(dir, base, ext);
    const next = path.join(dir, name);
    fs.renameSync(note.filePath, next);
    note.filePath = next;
    return stem(name);
  }

  _vaultTrashDir(vaultId) {
    const v = this.getVault(vaultId);
    const dir = path.join(v.path, '.trash');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // Moves a vault file into another vault folder's directory (same vault only). Returns the new path.
  _moveVaultFile(note, targetFolderId) {
    const target = this.getFolder(targetFolderId);
    if (!target || target.vaultId !== note.vaultId || !target.dirPath) throw Object.assign(new Error('A vault note can only move within its vault.'), { code: 'EVAULT' });
    fs.mkdirSync(target.dirPath, { recursive: true });
    const name = uniqueName(target.dirPath, stem(path.basename(note.filePath)), path.extname(note.filePath) || '.md');
    const next = path.join(target.dirPath, name);
    if (F.pathKey(next) === F.pathKey(note.filePath)) return note.filePath;
    fs.renameSync(note.filePath, next);
    return next;
  }

  // Vault notes: trash moves the file into <vault>/.trash, restore moves it back, delete forever removes it.
  trash(id) {
    const note = this.get(id);
    if (!note || note.trashedAt) return note;
    this.relock(id); // a trashed locked note needs its password again
    let moved = null;
    if (note.vaultId && note.filePath && fs.existsSync(note.filePath)) {
      const dir = this._vaultTrashDir(note.vaultId);
      const next = path.join(dir, uniqueName(dir, stem(path.basename(note.filePath)), path.extname(note.filePath) || '.md'));
      fs.renameSync(note.filePath, next);
      moved = { from: note.filePath, to: next };
      note.trashedFrom = note.filePath;
      note.filePath = next;
    }
    try {
      return this._commit(() => { note.trashedAt = this.now(); note.sticky = null; return note; }); // pinned is kept for restore
    } catch (err) {
      // The metadata write failed: put the file back so disk and memory agree again.
      // _commit's rollback swapped this.notes for its snapshot copies: fix up the object that is live now.
      const live = this.get(id) || note;
      if (moved) { try { fs.renameSync(moved.to, moved.from); live.filePath = moved.from; delete live.trashedFrom; } catch (_) { /* best effort */ } }
      throw err;
    }
  }

  restore(id) {
    const note = this.get(id);
    if (!note || !note.trashedAt) return note;
    if (note.vaultId && note.filePath && fs.existsSync(note.filePath) && /[\\/]\.trash[\\/]/.test(note.filePath)) {
      // Back to where it came from; if that is unknown (older data) or gone, the vault root is the fallback.
      const v = this.getVault(note.vaultId);
      const origin = note.trashedFrom || (v ? path.join(v.path, path.basename(note.filePath)) : null);
      const dir = path.dirname(origin);
      fs.mkdirSync(dir, { recursive: true });
      const next = path.join(dir, uniqueName(dir, stem(path.basename(origin)), path.extname(origin) || '.md'));
      const wasAt = note.filePath, wasFrom = note.trashedFrom, wasFolder = note.folderId;
      fs.renameSync(note.filePath, next);
      note.filePath = next;
      const folder = this.folders.find((f) => f.vaultId === note.vaultId && f.dirPath && F.pathKey(f.dirPath) === F.pathKey(dir));
      if (folder) note.folderId = folder.id;
      delete note.trashedFrom;
      try {
        return this._commit(() => { note.trashedAt = null; if (note.folderId && !this.getFolder(note.folderId)) note.folderId = null; note.updatedAt = this.now(); return note; });
      } catch (err) {
        // Save failed: the file goes back to .trash and the record stays trashed, so "delete forever" can
        // never remove a live file.
        try { fs.renameSync(next, wasAt); } catch (_) { /* best effort */ }
        const live = this.get(id) || note; // _commit's rollback swapped this.notes for its snapshot copies
        live.filePath = wasAt; live.trashedFrom = wasFrom; live.folderId = wasFolder; live.trashedAt = live.trashedAt || note.trashedAt;
        throw err;
      }
    }
    return this._commit(() => {
      note.trashedAt = null;
      if (note.folderId && !this.getFolder(note.folderId)) note.folderId = null;
      note.updatedAt = this.now();
      return note;
    });
  }

  // Only a file that sits in the vault's .trash is ours to delete for good.
  _inVaultTrash(note) {
    return !!(note.vaultId && note.trashedAt && note.filePath && /[\\/]\.trash[\\/]/.test(note.filePath) && fs.existsSync(note.filePath));
  }

  destroy(id) {
    const idx = this.notes.findIndex((n) => n.id === id);
    if (idx === -1) return false;
    this.relock(id);
    const note = this.notes[idx];
    if (this._inVaultTrash(note)) fs.rmSync(note.filePath);
    return this._commit(() => { this.notes.splice(idx, 1); return true; });
  }

  emptyTrash() {
    const before = this.notes.length;
    if (!this.notes.some((n) => n.trashedAt)) return 0;
    for (const n of this.notes) if (this._inVaultTrash(n)) { try { fs.rmSync(n.filePath); } catch (_) { /* leave it */ } }
    for (const n of this.notes) if (n.trashedAt) this.relock(n.id);
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
    let all = 0, pinned = 0, trash = 0, reminders = 0, overdue = 0;
    const now = this.now();
    for (const n of this.notes) {
      if (n.trashedAt) trash++;
      else { all++; if (n.pinned) pinned++; if (n.remindAt) { reminders++; if (n.remindAt <= now) overdue++; } }
    }
    return { all, pinned, trash, reminders, overdue };
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
    } else if (kind === 'docx') ({ body, mtime } = await F.readDocxText(abs));
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

  // A file the app itself just wrote (a PDF saved with its edits): its new time is recorded so the next refresh
  // does not take the app's own write for an outside change. Returns that time.
  markFileWritten(id) {
    const note = this.get(id);
    if (!note || !note.filePath) return null;
    const mtime = F.mtimeOf(note.filePath);
    this._commit(() => { note.fileMtime = mtime; });
    return mtime;
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
    else if (note.fileKind === 'docx') body = (await F.readDocxText(note.filePath)).body;
    // A PDF or Word file is shown from the file itself, so any new version is a change, even with the same text.
    const changed = body !== note.body || note.fileKind === 'pdf' || note.fileKind === 'docx';
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
        return { id: f.id, name: f.name, parentId: f.parentId, depth, count, total, children, vaultId: f.vaultId || null, isVaultRoot: !!(f.vaultId && !f.parentId), book: !!f.book };
      });
    return build(null, 0);
  }

  createFolder(data) {
    data = data || {};
    const parentId = data.parentId && this.getFolder(data.parentId) ? data.parentId : null;
    const folder = { id: crypto.randomUUID(), name: cleanFolderName(data.name), parentId, createdAt: this.now() };
    const parent = parentId ? this.getFolder(parentId) : null;
    if (parent && parent.vaultId && parent.dirPath) {
      // A subfolder of a vault folder is a directory. Dot-directories are skipped by the scan (.git, .trash,
      // .obsidian), so a folder named that way would hold notes the app never sees again.
      assertVaultDirName(folder.name);
      const dirName = uniqueName(parent.dirPath, H.safeFilename(folder.name), '');
      folder.name = dirName;
      folder.vaultId = parent.vaultId;
      folder.dirPath = path.join(parent.dirPath, dirName);
      fs.mkdirSync(folder.dirPath, { recursive: true });
    }
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
    let next = cleanFolderName(name);
    if (next === f.name) return f;
    if (f.vaultId && f.dirPath && f.parentId) {
      // Rename the directory and re-point every note and subfolder underneath it.
      const parentDir = path.dirname(f.dirPath);
      assertVaultDirName(next);
      const wanted = H.safeFilename(next);
      // Only the case changed (notes -> Notes): Windows would find the folder itself in the way; rename directly.
      next = wanted.toLowerCase() === path.basename(f.dirPath).toLowerCase() ? wanted : uniqueName(parentDir, wanted, '');
      const newDir = path.join(parentDir, next);
      fs.renameSync(f.dirPath, newDir);
      this._retargetVaultPaths(f.dirPath, newDir);
      f.dirPath = newDir;
    } else if (f.vaultId && !f.parentId) {
      const v = this.getVault(f.vaultId);
      if (v) v.name = next; // the root mirrors the vault's display name, not the directory
    }
    this._commit(() => { f.name = next; });
    return f;
  }

  _retargetVaultPaths(oldDir, newDir) {
    const oldKey = F.pathKey(oldDir);
    const under = (p) => p && (F.pathKey(p) === oldKey || F.pathKey(p).startsWith(oldKey + '\\'));
    const swap = (p) => newDir + path.resolve(p).slice(path.resolve(oldDir).length);
    for (const n of this.notes) {
      if (under(n.filePath)) n.filePath = swap(n.filePath);
      if (under(n.trashedFrom)) n.trashedFrom = swap(n.trashedFrom);
    }
    for (const d of this.folders) if (d.dirPath && under(d.dirPath) && F.pathKey(d.dirPath) !== oldKey) d.dirPath = swap(d.dirPath);
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
    if ((f.parentId || null) === parentId) return { folder: f };
    if (f.vaultId) {
      const target = parentId ? this.getFolder(parentId) : null;
      if (!f.parentId) return { error: 'A vault root stays at the top level. Remove the vault in Settings instead.' };
      if (!target || target.vaultId !== f.vaultId || !target.dirPath) return { error: 'A vault folder can only move within its vault.' };
      const newDir = path.join(target.dirPath, uniqueName(target.dirPath, path.basename(f.dirPath), ''));
      fs.renameSync(f.dirPath, newDir);
      this._retargetVaultPaths(f.dirPath, newDir);
      f.dirPath = newDir;
      f.name = path.basename(newDir);
    } else if (parentId && this.getFolder(parentId).vaultId) {
      return { error: 'Plain folders cannot move into a vault. Create the folder inside the vault instead.' };
    }
    this._commit(() => { f.parentId = parentId; });
    return { folder: f };
  }

  // Deleting a folder lifts its notes and subfolders into its parent; nothing is lost.
  deleteFolder(id) {
    const f = this.getFolder(id);
    if (!f) return null;
    const parent = f.parentId || null;
    if (f.vaultId && !parent) return { error: 'Remove a vault in Settings; its files stay on disk.' };
    if (f.vaultId && f.dirPath) {
      // On disk: lift the directory's contents one level up, then remove the (now empty) directory.
      const parentDir = path.dirname(f.dirPath);
      for (const e of fs.readdirSync(f.dirPath, { withFileTypes: true })) {
        const from = path.join(f.dirPath, e.name);
        const ext = e.isDirectory() ? '' : path.extname(e.name);
        const to = path.join(parentDir, uniqueName(parentDir, e.isDirectory() ? e.name : stem(e.name), ext));
        fs.renameSync(from, to);
        if (e.isDirectory()) this._retargetVaultPaths(from, to);
        else { const n = this.findByPath(from); if (n) n.filePath = to; }
      }
      // Trashed notes that came from this directory should restore into the parent now.
      const dirKey = F.pathKey(f.dirPath);
      for (const n of this.notes) if (n.trashedFrom && F.pathKey(path.dirname(n.trashedFrom)) === dirKey) n.trashedFrom = path.join(parentDir, path.basename(n.trashedFrom));
      try { fs.rmdirSync(f.dirPath); } catch (_) { /* leave non-empty leftovers */ }
    }
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
    if (note.lock && !this.plain.has(id)) throw Object.assign(new Error('This note is locked. Unlock it first.'), { code: 'ELOCKED' });
    const view = this.publicNote(note);
    return { filename: H.safeFilename(H.deriveTitle(view)) + '.md', content: H.noteToMarkdown(view) };
  }

  exportAll() {
    const notes = this.notes.filter((n) => !n.trashedAt).map((n) => { const c = Object.assign({}, n); delete c.live; return c; }); // live tokens stay on this machine
    return JSON.stringify({ exportedAt: this.now(), folders: this.folders, notes }, null, 2);
  }

  importMarkdown(filename, content) {
    const parsed = H.markdownToNote(filename, content);
    return this.create(parsed);
  }
}

module.exports = {
  STICKY_COLORS, sanitizeSticky, Store, DEFAULT_SETTINGS, EDITOR_WIDTH, VAULT_EXT, sanitizeSettings, sanitizeNote, sanitizeFolder, sanitizeVault, cleanFolderName };
