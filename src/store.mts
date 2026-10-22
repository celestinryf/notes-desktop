import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as H from './shared/helpers.mts';
import { isObjectLike, isRecord } from './shared/helpers.mts';
import * as Themes from './shared/themes.mts';
import * as F from './files.mts';
import * as L from './lock.mts';

const SCHEMA_VERSION = 1;
const MAX_BACKUPS = 10;
const BACKUP_MIN_INTERVAL_MS = 10 * 60 * 1000;

const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  hotkey: 'CommandOrControl+Alt+N',
  theme: 'system',
  colorScheme: 'notes',
  customColors: null,
  fontSize: 16,
  openAtLogin: true,
  alwaysOnTop: false,
  sort: 'updated',
  sidebarCollapsed: false,
  listCollapsed: false,
  listMode: 'tree',
  listLayout: 1,
  lastFolderId: null,
  sidebarWidth: H.PANE_LIMITS.sidebarWidth.def,
  listWidth: H.PANE_LIMITS.listWidth.def,
  expandedFolders: [],
  treeExpanded: [],
  tagsCollapsed: false,
  editorMode: 'rendered',
  editorAlign: 'center',
  editorWidth: 760,
  columnLayout: 3,
  panes: null,
  gitEnabled: true,
  gitRemote: '',
  ttsVoice: '',
  ttsRate: 1,
  zoomLevel: 0,
  window: null,
});

const EDITOR_WIDTH = { min: 480, max: 1600 };

type NoteInput = Partial<Omit<Note, 'tags'>> & { tags?: string[] | string };
type NoteUpdate = NoteInput & { force?: boolean };
type LinkOptions = { title?: string; tags?: string[] | string; folderId?: string | null };
type FileText = Awaited<ReturnType<typeof F.readNoteText>>;

const FILE_KINDS: readonly string[] = ['text', 'pdf', 'docx', 'sheet', 'image', 'binary'];

const isPublicView = (n: Note | PublicNote): n is PublicNote => !('lock' in n && n.lock !== undefined) && 'locked' in n && typeof n.locked === 'boolean';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isFileKind = (v: unknown): v is FileKind => typeof v === 'string' && FILE_KINDS.includes(v);
const isPresent = <T,>(v: T | null): v is T => v !== null;

function clampEditorWidth(v: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.editorWidth;
  if (n <= 0) return 0;
  return Math.min(EDITOR_WIDTH.max, Math.max(EDITOR_WIDTH.min, Math.round(n)));
}

const FOLDER_NAME_MAX = 80;

function stem(fileName: string) {
  const ext = path.extname(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

function cleanFolderName(name: unknown) {
  const s = String(name == null ? '' : name).replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
  return (s || 'Untitled folder').slice(0, FOLDER_NAME_MAX);
}

const MAX_BOOK_PAGES = 5000;

function sanitizeFolder(raw: unknown, now: number): Folder | null {
  if (!isObjectLike(raw)) return null;
  return folderFrom(raw, now);
}

function folderFrom(raw: Record<string, unknown>, now: number): Folder {
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    name: cleanFolderName(raw.name),
    parentId: typeof raw.parentId === 'string' && raw.parentId ? raw.parentId : null,
    createdAt: isFiniteNumber(raw.createdAt) ? raw.createdAt : now,
    vaultId: typeof raw.vaultId === 'string' && raw.vaultId ? raw.vaultId : null,
    dirPath: typeof raw.dirPath === 'string' && raw.dirPath ? raw.dirPath : null,
    book: !!raw.book,
    pageOrder: Array.isArray(raw.pageOrder) ? raw.pageOrder.filter((x: unknown) => typeof x === 'string' && x).slice(0, MAX_BOOK_PAGES) : [],
  };
}

function sanitizeVault(raw: unknown, now: number): Vault | null {
  if (!isObjectLike(raw) || typeof raw.path !== 'string' || !raw.path) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    name: cleanFolderName(raw.name || path.basename(raw.path)),
    path: path.resolve(raw.path),
    remote: typeof raw.remote === 'string' ? raw.remote.trim().slice(0, 500) : '',
    autoSync: raw.autoSync !== false,
    syncMinutes: Number.isFinite(Number(raw.syncMinutes)) ? Math.min(240, Math.max(1, Math.round(Number(raw.syncMinutes)))) : 5,
    createdAt: isFiniteNumber(raw.createdAt) ? raw.createdAt : now,
  };
}

const VAULT_EXT = new Set(['md', 'markdown', 'mdx', 'txt', 'text', 'tex', 'latex', 'bib', 'org', 'rst']);
const VAULT_SKIP_DIRS = new Set(['.git', '.trash', '.obsidian', 'node_modules', '.vscode', '.idea']);

function assertVaultDirName(name: string) {
  const safe = H.safeFilename(name);
  if (/^\./.test(safe) || VAULT_SKIP_DIRS.has(safe.toLowerCase())) throw Object.assign(new Error('A vault folder cannot be named "' + safe + '": the app does not scan folders with that name.'), { code: 'ENAME' });
}

function uniqueName(dir: string, base: string, ext: string) {
  let candidate = base + ext;
  let i = 2;
  while (fs.existsSync(path.join(dir, candidate))) { candidate = base + ' ' + i + ext; i++; }
  return candidate;
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function replaceFile(tmp: string, target: string) {
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

function clampFontSize(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_SETTINGS.fontSize;
  return Math.min(28, Math.max(12, Math.round(v)));
}

const TABS_MAX = 50;

function sanitizePanes(raw: unknown): Panes {
  const p: Record<string, unknown> = isRecord(raw) ? raw : {};
  const side = (v: unknown): PaneSide => {
    const o: Record<string, unknown> = isObjectLike(v) ? v : {};
    const ids = Array.isArray(o.ids) ? Array.from(new Set<string>(o.ids.filter((x: unknown) => typeof x === 'string' && x && x.length <= 100))).slice(0, TABS_MAX) : [];
    return { ids, current: typeof o.current === 'string' && ids.includes(o.current) ? o.current : null };
  };
  const left = side(p.left);
  const right = side(p.right);
  right.ids = right.ids.filter((id) => !left.ids.includes(id));
  if (right.current && !right.ids.includes(right.current)) right.current = null;
  const ratio = Number(p.ratio);
  return {
    split: !!p.split,
    ratio: Number.isFinite(ratio) ? Math.min(0.8, Math.max(0.2, Math.round(ratio * 1000) / 1000)) : 0.5,
    active: p.split && p.active === 'right' ? 'right' : 'left',
    left,
    right: p.split ? right : { ids: [], current: null },
  };
}

function sanitizeSettings(input: unknown) {
  const src: Record<string, unknown> = isRecord(input) ? input : {};
  const s: Settings = Object.assign({}, DEFAULT_SETTINGS, src);
  const acc = H.parseAccelerator(s.hotkey);
  s.hotkey = acc.ok && acc.value ? acc.value : DEFAULT_SETTINGS.hotkey;
  s.theme = ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system';
  s.customColors = Themes.cleanCustom(s.customColors);
  s.colorScheme = Themes.cleanSchemeId(s.colorScheme, s.customColors);
  s.fontSize = clampFontSize(s.fontSize);
  s.openAtLogin = !!s.openAtLogin;
  s.alwaysOnTop = !!s.alwaysOnTop;
  s.sidebarCollapsed = !!s.sidebarCollapsed;
  s.listCollapsed = !!s.listCollapsed;
  s.listMode = s.listMode === 'list' ? 'list' : 'tree';
  if ((Number(src.listLayout) || 0) < 1) s.listMode = 'tree';
  s.listLayout = 1;
  s.treeExpanded = Array.isArray(s.treeExpanded) ? s.treeExpanded.filter((x) => typeof x === 'string').slice(0, 5000) : [];
  s.tagsCollapsed = !!s.tagsCollapsed;
  s.lastFolderId = typeof s.lastFolderId === 'string' && s.lastFolderId ? s.lastFolderId : null;
  s.zoomLevel = Number.isFinite(Number(s.zoomLevel)) ? Math.max(-3, Math.min(5, Math.round(Number(s.zoomLevel) * 2) / 2)) : 0;
  s.sidebarWidth = H.clampPane('sidebarWidth', s.sidebarWidth);
  s.listWidth = H.clampPane('listWidth', s.listWidth);
  s.expandedFolders = Array.isArray(s.expandedFolders) ? s.expandedFolders.filter((x) => typeof x === 'string').slice(0, 5000) : [];
  s.editorMode = s.editorMode === 'source' ? 'source' : 'rendered';
  s.editorAlign = ['left', 'center', 'right'].includes(s.editorAlign) ? s.editorAlign : DEFAULT_SETTINGS.editorAlign;
  s.editorWidth = clampEditorWidth(s.editorWidth);
  const layout = Number(src.columnLayout) || 0;
  if (layout < 2 && s.editorWidth === 760 && s.editorAlign === 'left') s.editorAlign = DEFAULT_SETTINGS.editorAlign;
  if (layout < 3 && s.editorWidth === 0) s.editorWidth = DEFAULT_SETTINGS.editorWidth;
  s.columnLayout = 3;
  s.panes = s.panes == null ? null : sanitizePanes(s.panes);
  s.gitEnabled = !!s.gitEnabled;
  s.gitRemote = typeof s.gitRemote === 'string' ? s.gitRemote.trim().slice(0, 500) : '';
  s.ttsVoice = typeof s.ttsVoice === 'string' ? s.ttsVoice.slice(0, 200) : '';
  s.ttsRate = Number.isFinite(Number(s.ttsRate)) ? Math.min(2, Math.max(0.5, Math.round(Number(s.ttsRate) * 10) / 10)) : 1;
  s.sort = ['updated', 'created', 'title'].includes(s.sort) ? s.sort : 'updated';
  if (s.window && typeof s.window === 'object') {
    const w = s.window;
    const ok = (['width', 'height'] as const).every((k) => Number.isFinite(w[k]) && w[k] > 100) && (['x', 'y'] as const).every((k) => Number.isFinite(w[k]));
    s.window = ok ? { x: Math.round(w.x), y: Math.round(w.y), width: Math.round(w.width), height: Math.round(w.height) } : null;
  } else s.window = null;
  return s;
}

const STICKY_COLORS = ['peach', 'cream', 'leaf', 'sky', 'rose', 'ink'];

function sanitizeSticky(raw: unknown): Sticky | null {
  if (!isObjectLike(raw)) return null;
  const num = <D,>(v: unknown, d: D): number | D => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d);
  return {
    x: num(raw.x, null), y: num(raw.y, null),
    w: Math.max(180, Math.min(1600, num(raw.w, 280))), h: Math.max(140, Math.min(1600, num(raw.h, 260))),
    color: typeof raw.color === 'string' && STICKY_COLORS.includes(raw.color) ? raw.color : 'peach',
    onTop: raw.onTop !== false,
  };
}

function sanitizeLive(raw: unknown): Live | null {
  if (!isObjectLike(raw) || (raw.role !== 'host' && raw.role !== 'guest') || typeof raw.url !== 'string') return null;
  return { role: raw.role, url: raw.url, token: typeof raw.token === 'string' ? raw.token : undefined, port: isFiniteNumber(raw.port) ? raw.port : undefined, pending: raw.pending ? true : undefined };
}

function sanitizeNote(raw: unknown, now: number): Note | null {
  if (!isObjectLike(raw)) return null;
  return noteFrom(raw, now);
}

function noteFrom(raw: Record<string, unknown>, now: number): Note {
  const createdAt = isFiniteNumber(raw.createdAt) ? raw.createdAt : now;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    title: typeof raw.title === 'string' ? raw.title : '',
    body: typeof raw.body === 'string' && !L.sanitizeLock(raw.lock) ? raw.body : '',
    tags: H.parseTags(raw.tags || []),
    folderId: typeof raw.folderId === 'string' && raw.folderId ? raw.folderId : null,
    filePath: typeof raw.filePath === 'string' && raw.filePath ? raw.filePath : null,
    fileKind: isFileKind(raw.fileKind) ? raw.fileKind : null,
    fileMtime: isFiniteNumber(raw.fileMtime) ? raw.fileMtime : null,
    vaultId: typeof raw.vaultId === 'string' && raw.vaultId ? raw.vaultId : null,
    trashedFrom: typeof raw.trashedFrom === 'string' && raw.trashedFrom ? raw.trashedFrom : undefined,
    sticky: sanitizeSticky(raw.sticky),
    live: sanitizeLive(raw.live),
    lock: L.sanitizeLock(raw.lock),
    remindAt: isFiniteNumber(raw.remindAt) ? Math.round(raw.remindAt) : null,
    remindedAt: isFiniteNumber(raw.remindedAt) ? Math.round(raw.remindedAt) : null,
    pinned: !!raw.pinned,
    createdAt,
    updatedAt: isFiniteNumber(raw.updatedAt) ? raw.updatedAt : createdAt,
    trashedAt: isFiniteNumber(raw.trashedAt) ? raw.trashedAt : null,
  };
}

function isFileNote(note: Note | null): note is FileNote {
  return !!(note && note.filePath);
}

class Store {
  dir: string;
  file: string;
  backupDir: string;
  now: () => number;
  notes: Note[];
  plain: Map<string, string>;
  keys: Map<string, Buffer>;
  folders: Folder[];
  vaults: Vault[];
  settings: Settings;
  lastBackupAt: number;
  loadError: Error | null;
  onFileText: ((id: string) => void) | null;
  saveBlocked: boolean | undefined;
  recoveredFromBackup: boolean | undefined;
  backupSuspended: boolean | undefined;
  constructor(dir: string, opts?: { now?: () => number }) {
    opts = opts || {};
    this.dir = dir;
    this.file = path.join(dir, 'notes.json');
    this.backupDir = path.join(dir, 'backups');
    this.now = opts.now || Date.now;
    this.notes = [];
    this.plain = new Map();
    this.keys = new Map();
    this.folders = [];
    this.vaults = [];
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    this.lastBackupAt = 0;
    this.loadError = null;
    this.onFileText = null;
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    let raw: unknown = null;
    this.saveBlocked = false;
    this.recoveredFromBackup = false;
    this.backupSuspended = false;
    this.loadError = null;
    if (fs.existsSync(this.file)) {
      let text: string | null = null;
      let ioError = null;
      for (let attempt = 0; attempt < 6 && text === null; attempt++) {
        try { text = fs.readFileSync(this.file, 'utf8'); ioError = null; } catch (err) { ioError = err; sleepSync(50 * (attempt + 1)); }
      }
      if (text === null) {
        this.loadError = ioError;
        this.saveBlocked = true;
      } else {
        try {
          raw = JSON.parse(text);
        } catch (err) {
          this.loadError = err;
          const quarantined = this.file + '.corrupt-' + this.now();
          try { fs.renameSync(this.file, quarantined); } catch (_) {
            this.backupSuspended = true;
          }
          raw = this._loadNewestBackup();
          this.recoveredFromBackup = true;
          if (!raw && this.backupSuspended) this.saveBlocked = true;
        }
      }
    }
    const now = this.now();
    const doc: Record<string, unknown> = isObjectLike(raw) ? raw : {};
    const notes: unknown[] = Array.isArray(doc.notes) ? doc.notes : [];
    const folders: unknown[] = Array.isArray(doc.folders) ? doc.folders : [];
    const vaults: unknown[] = Array.isArray(doc.vaults) ? doc.vaults : [];
    this.notes = notes.map((n) => sanitizeNote(n, now)).filter(isPresent);
    this.folders = folders.map((f) => sanitizeFolder(f, now)).filter(isPresent);
    this.vaults = vaults.map((v) => sanitizeVault(v, now)).filter(isPresent);
    const vaultIds = new Set(this.vaults.map((v) => v.id));
    for (const f of this.folders) if (f.vaultId && !vaultIds.has(f.vaultId)) { f.vaultId = null; f.dirPath = null; }
    for (const n of this.notes) if (n.vaultId && !vaultIds.has(n.vaultId)) n.vaultId = null;
    this._repairFolderGraph();
    this.settings = sanitizeSettings(doc.settings);
    const ids = new Set(this.folders.map((f) => f.id));
    this.settings.expandedFolders = this.settings.expandedFolders.filter((id) => ids.has(id));
    this.settings.treeExpanded = this.settings.treeExpanded.filter((id) => ids.has(id));
    if (this.recoveredFromBackup && !this.saveBlocked) {
      try { this.save(); } catch (_) {  }
    }
    return this;
  }

  _repairFolderGraph() {
    const seen = new Set();
    this.folders = this.folders.filter((f) => { if (seen.has(f.id)) return false; seen.add(f.id); return true; });
    const byId = new Map(this.folders.map((f) => [f.id, f]));
    for (const f of this.folders) {
      if (f.parentId === f.id || (f.parentId && !byId.has(f.parentId))) f.parentId = null;
    }
    for (const f of this.folders) {
      const trail = new Set([f.id]);
      let cur: Folder | undefined = f;
      while (cur && cur.parentId) {
        if (trail.has(cur.parentId)) { cur.parentId = null; break; }
        trail.add(cur.parentId);
        cur = byId.get(cur.parentId);
      }
    }
    for (const n of this.notes) if (n.folderId && !byId.has(n.folderId)) n.folderId = null;
  }

  _loadNewestBackup(): unknown {
    try {
      const files = fs.readdirSync(this.backupDir).filter((f) => f.endsWith('.json')).sort().reverse();
      for (const f of files) {
        try { return JSON.parse(fs.readFileSync(path.join(this.backupDir, f), 'utf8')); } catch (_) {  }
      }
    } catch (_) {  }
    return null;
  }

  serialize() {
    return { schemaVersion: SCHEMA_VERSION, savedAt: this.now(), settings: this.settings, vaults: this.vaults, folders: this.folders, notes: this.notes };
  }

  save() {
    if (this.saveBlocked) {
      throw Object.assign(new Error('Your notes file could not be read when Notes started (it may be locked by another program). Saving is paused so nothing is overwritten; restart Notes once the file is free.'), { code: 'ESAVEBLOCKED' });
    }
    fs.mkdirSync(this.dir, { recursive: true });
    this._maybeBackup();
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.serialize(), null, 2), 'utf8');
    replaceFile(tmp, this.file);
    this.backupSuspended = false;
    return this;
  }

  _maybeBackup() {
    const now = this.now();
    if (this.backupSuspended) return;
    if (!fs.existsSync(this.file) || now - this.lastBackupAt < BACKUP_MIN_INTERVAL_MS) return;
    fs.mkdirSync(this.backupDir, { recursive: true });
    const stamp = H.fileStamp(now);
    try { fs.copyFileSync(this.file, path.join(this.backupDir, 'notes-' + stamp + '.json')); } catch (_) { return; }
    this.lastBackupAt = now;
    const files = fs.readdirSync(this.backupDir).filter((f) => f.endsWith('.json')).sort();
    while (files.length > MAX_BACKUPS) { const oldest = files.shift(); if (!oldest) break; try { fs.unlinkSync(path.join(this.backupDir, oldest)); } catch (_) { break; } }
  }

  list(opts?: ListOpts) {
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
    if (opts.reminders) return out.slice().sort((a, b) => (a.remindAt || 0) - (b.remindAt || 0));
    if (opts.folderId && !opts.recursive && !opts.query && !trashed) {
      const f = this.getFolder(opts.folderId);
      if (f && f.book) return this._orderPages(f, out);
    }
    return H.sortNotes(out, opts.sort || this.settings.sort);
  }

  get(id: string) {
    return this.notes.find((n) => n.id === id) || null;
  }

  create(data?: NoteInput) {
    data = data || {};
    const now = this.now();
    const note = noteFrom(Object.assign({}, data, { id: crypto.randomUUID(), createdAt: now, updatedAt: now, trashedAt: null }), now);
    if (note.folderId && !this.getFolder(note.folderId)) note.folderId = null;
    this.notes.unshift(note);
    try {
      this.save();
    } catch (err) {
      this.notes = this.notes.filter((n) => n !== note);
      throw err;
    }
    return note;
  }

  update(id: string, patch?: NoteUpdate) {
    const note = this.get(id);
    if (!note) return null;
    patch = patch || {};
    const before = Object.assign({}, note, { tags: note.tags.slice() });
    let changed = false;
    let fileWritten = false;
    let plainBefore: string | undefined;
    if (note.lock && typeof patch.body === 'string') {
      if (!this.plain.has(id) && patch.body !== '') throw Object.assign(new Error('This note is locked. Unlock it first.'), { code: 'ELOCKED' });
      if (this.plain.has(id) && patch.body !== this.plain.get(id)) {
        plainBefore = this.plain.get(id);
        note.lock = L.encrypt(patch.body, this._keyOf(id), note.lock.salt);
        this.plain.set(id, patch.body);
        changed = true;
      }
      patch = Object.assign({}, patch); delete patch.body;
    }
    let fileMoved = false;
    if (patch.folderId !== undefined && note.vaultId && note.filePath && !patch.folderId && (note.folderId || null) !== null) throw Object.assign(new Error('A vault note can only move within its vault.'), { code: 'EVAULT' });
    if (patch.folderId && note.filePath && !note.vaultId) {
      const t = this.getFolder(patch.folderId);
      if (t && t.vaultId) throw Object.assign(new Error('A linked file cannot be moved into a vault; copy its text into a new note there instead.'), { code: 'EVAULT' });
    }
    if (typeof patch.body === 'string' && patch.body !== note.body && note.filePath) {
      if (note.fileKind !== 'text') throw Object.assign(new Error('This file type is read-only here.'), { code: 'EREADONLY' });
      if (!patch.force && note.fileMtime !== null) {
        const diskM = F.mtimeOf(note.filePath);
        if (diskM !== null && diskM !== note.fileMtime) {
          let onDisk = null;
          try { onDisk = F.readText(note.filePath).body; } catch (_) {  }
          if (onDisk !== note.body && onDisk !== patch.body) throw Object.assign(new Error('This file changed on disk since it was opened.'), { code: 'ECONFLICT' });
        }
      }
      note.fileMtime = F.writeTextInPlace(note.filePath, patch.body);
      fileWritten = true;
    }
    if (typeof patch.title === 'string' && patch.title !== note.title) {
      if (note.vaultId && isFileNote(note) && note.fileKind === 'text') {
        try { note.title = this._renameVaultFile(note, patch.title); fileMoved = true; }
        catch (err) { if (typeof patch.body === 'string' && fileWritten) { note.body = patch.body; } throw err; }
      } else note.title = patch.title;
      changed = true;
    }
    if (typeof patch.body === 'string' && patch.body !== note.body) { note.body = patch.body; changed = true; }
    if (patch.folderId !== undefined && note.vaultId && isFileNote(note)) {
      const fid = patch.folderId || null;
      if (fid !== (note.folderId || null)) {
        if (!fid) throw Object.assign(new Error('A vault note can only move within its vault.'), { code: 'EVAULT' });
        note.filePath = this._moveVaultFile(note, fid);
        note.folderId = fid; changed = true; fileMoved = true;
      }
      delete patch.folderId;
    } else if (patch.folderId && !note.filePath) {
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
      const at = isFiniteNumber(patch.remindAt) ? Math.round(patch.remindAt) : null;
      if (at !== note.remindAt) { note.remindAt = at; note.remindedAt = null; changed = true; }
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

  publicNote(n: Note | PublicNote): PublicNote;
  publicNote(n: Note | PublicNote | null): PublicNote | null;
  publicNote(n: Note | PublicNote | null): PublicNote | null {
    if (!n) return n;
    if (isPublicView(n)) return n;
    const { lock, ...rest } = n;
    const unlocked = !!lock && this.plain.has(n.id);
    return Object.assign(rest, { locked: !!lock, unlocked }, lock ? { body: unlocked ? this.plain.get(n.id) ?? '' : '' } : {});
  }

  lockNote(id: string, password: string) {
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

  unlockNote(id: string, password: string) {
    const note = this.get(id);
    if (!note) return null;
    if (!note.lock) return this.publicNote(note);
    const r = L.unlock(note.lock, password);
    if (!r) throw Object.assign(new Error('Wrong password.'), { code: 'EPASS' });
    this.plain.set(id, r.body);
    this.keys.set(id, r.key);
    return this.publicNote(note);
  }

  relock(id: string) {
    const was = this.plain.has(id);
    this.plain.delete(id);
    this.keys.delete(id);
    return was;
  }

  relockAll() {
    const ids = Array.from(this.plain.keys());
    this.plain.clear();
    this.keys.clear();
    return ids;
  }

  removeLock(id: string, password: string) {
    const note = this.get(id);
    if (!note || !note.lock) return this.publicNote(note);
    const r = L.unlock(note.lock, password);
    if (!r) throw Object.assign(new Error('Wrong password.'), { code: 'EPASS' });
    this._commit(() => { note.lock = null; note.body = r.body; note.updatedAt = this.now(); return note; });
    this.relock(id);
    return this.publicNote(note);
  }

  markReminded(id: string, at: number) {
    const note = this.get(id);
    if (!note) return null;
    return this._commit(() => { note.remindedAt = at; return note; });
  }

  setSticky(id: string, sticky: Partial<Sticky> | null) {
    const note = this.get(id);
    if (!note) return null;
    const next = sticky ? sanitizeSticky(Object.assign({}, note.sticky || {}, sticky)) : null;
    if (JSON.stringify(next) === JSON.stringify(note.sticky || null)) return note;
    return this._commit(() => { note.sticky = next; return note; });
  }

  _orderPages(folder: Folder, notes: Note[]) {
    const rank = new Map<string, number>((folder.pageOrder || []).map((id, i) => [id, i]));
    return notes.slice().sort((a, b) => {
      const ra = rank.get(a.id) ?? Infinity, rb = rank.get(b.id) ?? Infinity;
      if (ra !== rb) return ra - rb;
      return (a.createdAt - b.createdAt) || a.id.localeCompare(b.id);
    });
  }

  bookPages(folderId: string) {
    const f = this.getFolder(folderId);
    if (!f) return [];
    return this._orderPages(f, this.notes.filter((n) => !n.trashedAt && n.folderId === folderId));
  }

  setBook(folderId: string, on: boolean) {
    const f = this.getFolder(folderId);
    if (!f) return null;
    if (!!f.book === !!on) return f;
    return this._commit(() => {
      f.book = !!on;
      if (f.book && !(f.pageOrder || []).length) f.pageOrder = this.bookPages(folderId).map((n) => n.id);
      return f;
    });
  }

  reorderPages(folderId: string, ids: string[]) {
    const f = this.getFolder(folderId);
    if (!f || !f.book) return null;
    const pages = this.bookPages(folderId).map((n) => n.id);
    const wanted = (Array.isArray(ids) ? ids : []).filter((id, i, a) => pages.includes(id) && a.indexOf(id) === i);
    const next = wanted.concat(pages.filter((id) => !wanted.includes(id)));
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

  related(id: string, limit?: number) {
    const note = this.get(id);
    if (!note) return null;
    const bodyOf = (n: Note) => (n.lock ? (this.plain.get(n.id) || '') : n.body);
    const view = (n: Note) => ({ id: n.id, title: H.deriveTitle(this.publicNote(n)) || 'Untitled', trashed: !!n.trashedAt, locked: !!n.lock });
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

  setLive(id: string, live: Live | null) {
    const note = this.get(id);
    if (!note) return null;
    const next = sanitizeLive(live);
    if (JSON.stringify(next) === JSON.stringify(note.live || null)) return note;
    return this._commit(() => { note.live = next; return note; });
  }

  stickies() {
    return this.notes.filter((n) => n.sticky && !n.trashedAt);
  }

  togglePin(id: string) {
    const note = this.get(id);
    if (!note) return null;
    return this.update(id, { pinned: !note.pinned });
  }

  duplicate(id: string) {
    const note = this.get(id);
    if (!note) return null;
    if (note.lock) {
      const plain = this.plain.get(id);
      if (plain === undefined) throw Object.assign(new Error('This note is locked. Unlock it first.'), { code: 'ELOCKED' });
      const key = this._keyOf(id);
      const copy = this.create({ title: note.title + ' (copy)', body: '', tags: note.tags, folderId: note.folderId, pinned: false, lock: L.encrypt(plain, key, note.lock.salt) });
      this.plain.set(copy.id, plain);
      this.keys.set(copy.id, key);
      return this.publicNote(copy);
    }
    const folder = note.folderId ? this.getFolder(note.folderId) : null;
    if (note.vaultId && folder && folder.vaultId && folder.dirPath) return this.createVaultNote(folder.id, { title: note.title + ' (copy)', body: note.body, tags: note.tags });
    return this.create({ title: (note.title || path.basename(note.filePath || '')) + ' (copy)', body: note.body, tags: note.tags, folderId: note.folderId, pinned: false });
  }

  splitIntoBook(id: string, opts?: { name?: string; keepOriginal?: boolean }) {
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
    const parentId = parent && !parent.vaultId ? parent.id : null;
    const folder = folderFrom({ name: String(opts.name || '').trim() || plan.name, parentId, createdAt: now, book: true }, now);
    const pages = plan.pages.map((p) => noteFrom({ id: crypto.randomUUID(), title: p.title, body: p.body, tags: note.tags.slice(), folderId: folder.id, pinned: false, createdAt: now, updatedAt: now, trashedAt: null }, now));
    folder.pageOrder = pages.map((p) => p.id);
    const originalTrashed = !opts.keepOriginal;
    return this._commit(() => {
      this.folders.push(folder);
      this.notes.unshift(...pages);
      if (originalTrashed) { note.trashedAt = now; note.sticky = null; }
      return { folder, pageIds: folder.pageOrder.slice(), originalTrashed };
    });
  }

  undoSplit(folderId: string, pageIds: string[], originalId: string | null) {
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

  ensureFolder(name: string, parentId: null) {
    const found = this.folders.find((f) => (f.parentId || null) === (parentId || null) && f.name.toLowerCase() === String(name).toLowerCase());
    return found || this.createFolder({ name, parentId: parentId || null });
  }

  _commit<T>(mutate: () => T): T {
    const snapshot = {
      notes: this.notes.map((n) => Object.assign({}, n, { tags: n.tags.slice() })),
      folders: this.folders.map((f) => Object.assign({}, f)),
      vaults: this.vaults.map((v) => Object.assign({}, v)),
      settings: Object.assign({}, this.settings, { expandedFolders: this.settings.expandedFolders.slice(), treeExpanded: this.settings.treeExpanded.slice() }),
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

  _keyOf(id: string): Buffer {
    const key = this.keys.get(id);
    if (!key) throw Object.assign(new Error('This note is locked. Unlock it first.'), { code: 'ELOCKED' });
    return key;
  }

  getVault(id: string) {
    return this.vaults.find((v) => v.id === id) || null;
  }

  vaultRootFolder(vaultId: string) {
    return this.folders.find((f) => f.vaultId === vaultId && f.parentId === null) || null;
  }

  folderDir(folderId: string) {
    const f = this.getFolder(folderId);
    return f && f.vaultId ? f.dirPath : null;
  }

  addVault(data: { path: string; name?: string; remote?: string }) {
    const vault = sanitizeVault(Object.assign({}, data, { id: crypto.randomUUID(), createdAt: this.now() }), this.now());
    if (!vault) throw new Error('A vault needs a folder path.');
    if (!fs.existsSync(vault.path) || !fs.statSync(vault.path).isDirectory()) throw Object.assign(new Error('Folder not found: ' + vault.path), { code: 'ENOENT' });
    const dup = this.vaults.find((v) => F.pathKey(v.path) === F.pathKey(vault.path));
    if (dup) return dup;
    const inside = (a: string, b: string) => (F.pathKey(a) + path.sep).startsWith(F.pathKey(b) + path.sep);
    const overlap = this.vaults.find((v) => inside(vault.path, v.path) || inside(v.path, vault.path));
    if (overlap) throw Object.assign(new Error('That folder overlaps the vault "' + overlap.name + '"; one vault cannot sit inside another.'), { code: 'EOVERLAP' });
    return this._commit(() => {
      this.vaults.push(vault);
      this.folders.push(folderFrom({ name: vault.name, vaultId: vault.id, dirPath: vault.path }, this.now()));
      return vault;
    });
  }

  updateVault(id: string, patch?: Partial<Vault>) {
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

  removeVault(id: string) {
    const v = this.getVault(id);
    if (!v) return false;
    return this._commit(() => {
      this.notes = this.notes.filter((n) => n.vaultId !== id);
      this.folders = this.folders.filter((f) => f.vaultId !== id);
      this.vaults = this.vaults.filter((x) => x.id !== id);
      this.settings.expandedFolders = this.settings.expandedFolders.filter((fid) => this.folders.some((f) => f.id === fid));
      this.settings.treeExpanded = this.settings.treeExpanded.filter((fid) => this.folders.some((f) => f.id === fid));
      return true;
    });
  }

  async scanVault(id: string, opts?: { allowRemovals?: boolean }) {
    opts = opts || {};
    const allowRemovals = opts.allowRemovals !== false;
    const vault = this.getVault(id);
    if (!vault) return null;
    let rootEntries: fs.Dirent<string>[] | null = null;
    try { rootEntries = fs.readdirSync(vault.path, { withFileTypes: true }); } catch (_) { return { added: 0, updated: 0, removed: 0, unavailable: true }; }
    const root = this.vaultRootFolder(id) || this._commit(() => { const f: Folder = { id: crypto.randomUUID(), name: vault.name, parentId: null, createdAt: this.now(), vaultId: id, dirPath: vault.path, book: false, pageOrder: [] }; this.folders.push(f); return f; });
    const seenFolders = new Set([root.id]);
    const seenNotes = new Set<string>();
    let added = 0, updated = 0, removed = 0;
    const walk = async (dir: string, folderId: string) => {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (VAULT_SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
          const sub = this.folders.find((f) => f.vaultId === id && f.dirPath && F.pathKey(f.dirPath) === F.pathKey(full))
            || this._commit(() => { const f: Folder = { id: crypto.randomUUID(), name: e.name, parentId: folderId, createdAt: this.now(), vaultId: id, dirPath: full, book: false, pageOrder: [] }; this.folders.push(f); return f; });
          if (sub.parentId !== folderId || sub.name !== e.name) this._commit(() => { sub.parentId = folderId; sub.name = e.name; });
          seenFolders.add(sub.id);
          await walk(full, sub.id);
        } else if (e.isFile()) {
          if (!VAULT_EXT.has(F.extOf(e.name))) continue;
          let note = this.findByPath(full);
          if (!note) {
            let text = null;
            try { text = F.readText(full).body; } catch (_) { continue; }
            const orphan = this.notes.find((n) => n.vaultId === id && !n.trashedAt && n.filePath && !seenNotes.has(n.id) && n.body === text && !fs.existsSync(n.filePath));
            if (orphan) {
              this._commit(() => { orphan.filePath = full; orphan.title = stem(e.name); orphan.folderId = folderId; orphan.fileMtime = F.mtimeOf(full); });
              note = orphan; updated++;
            } else {
              try {
                const linked = await this.linkFile(full, { folderId, title: stem(e.name) });
                this._commit(() => { linked.vaultId = id; });
                note = linked;
                added++;
              } catch (_) { continue; }
            }
          } else {
            let r;
            try { r = await this.refreshFileNote(note.id); } catch (_) { seenNotes.add(note.id); continue; }
            if (r.changed) updated++;
            const known = note;
            if (known.folderId !== folderId || known.vaultId !== id || known.trashedAt) {
              this._commit(() => { known.folderId = folderId; known.vaultId = id; known.trashedAt = null; });
            }
          }
          seenNotes.add(note.id);
        }
      }
    };
    await walk(vault.path, root.id);
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

  createVaultNote(folderId: string, data?: NoteInput) {
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

  _renameVaultFile(note: FileNote, title: string) {
    const dir = path.dirname(note.filePath);
    const ext = path.extname(note.filePath) || '.md';
    const base = H.safeFilename(String(title || '').trim() || 'Untitled');
    if (base === stem(path.basename(note.filePath))) return note.title;
    const name = base.toLowerCase() === stem(path.basename(note.filePath)).toLowerCase() ? base + ext : uniqueName(dir, base, ext);
    const next = path.join(dir, name);
    fs.renameSync(note.filePath, next);
    note.filePath = next;
    return stem(name);
  }

  _vaultTrashDir(vaultId: string) {
    const v = this.getVault(vaultId);
    if (!v) throw new Error('Vault not found');
    const dir = path.join(v.path, '.trash');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  _moveVaultFile(note: FileNote, targetFolderId: string) {
    const target = this.getFolder(targetFolderId);
    if (!target || target.vaultId !== note.vaultId || !target.dirPath) throw Object.assign(new Error('A vault note can only move within its vault.'), { code: 'EVAULT' });
    fs.mkdirSync(target.dirPath, { recursive: true });
    const name = uniqueName(target.dirPath, stem(path.basename(note.filePath)), path.extname(note.filePath) || '.md');
    const next = path.join(target.dirPath, name);
    if (F.pathKey(next) === F.pathKey(note.filePath)) return note.filePath;
    fs.renameSync(note.filePath, next);
    return next;
  }

  trash(id: string) {
    const note = this.get(id);
    if (!note || note.trashedAt) return note;
    this.relock(id);
    let moved: { from: string, to: string } | null = null;
    if (note.vaultId && note.filePath && fs.existsSync(note.filePath)) {
      const dir = this._vaultTrashDir(note.vaultId);
      const next = path.join(dir, uniqueName(dir, stem(path.basename(note.filePath)), path.extname(note.filePath) || '.md'));
      fs.renameSync(note.filePath, next);
      moved = { from: note.filePath, to: next };
      note.trashedFrom = note.filePath;
      note.filePath = next;
    }
    try {
      return this._commit(() => { note.trashedAt = this.now(); note.sticky = null; return note; });
    } catch (err) {
      const live = this.get(id) || note;
      if (moved) { try { fs.renameSync(moved.to, moved.from); live.filePath = moved.from; delete live.trashedFrom; } catch (_) {  } }
      throw err;
    }
  }

  restore(id: string) {
    const note = this.get(id);
    if (!note || !note.trashedAt) return note;
    const v = note.vaultId ? this.getVault(note.vaultId) : null;
    const origin = note.trashedFrom || (v && note.filePath ? path.join(v.path, path.basename(note.filePath)) : null);
    if (note.vaultId && note.filePath && origin && fs.existsSync(note.filePath) && /[\\/]\.trash[\\/]/.test(note.filePath)) {
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
        try { fs.renameSync(next, wasAt); } catch (_) {  }
        const live = this.get(id) || note;
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

  _inVaultTrash(note: Note): note is FileNote {
    return !!(note.vaultId && note.trashedAt && note.filePath && /[\\/]\.trash[\\/]/.test(note.filePath) && fs.existsSync(note.filePath));
  }

  destroy(id: string) {
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
    for (const n of this.notes) if (this._inVaultTrash(n)) { try { fs.rmSync(n.filePath); } catch (_) {  } }
    for (const n of this.notes) if (n.trashedAt) this.relock(n.id);
    return this._commit(() => { this.notes = this.notes.filter((n) => !n.trashedAt); return before - this.notes.length; });
  }

  tags() {
    const counts = new Map<string, number>();
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

  findByPath(filePath: string) {
    const key = F.pathKey(filePath);
    return this.notes.find((n) => n.filePath && F.pathKey(n.filePath) === key) || null;
  }

  async linkFile(filePath: string, opts?: LinkOptions) {
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
    const later = kind === 'sheet';
    if (!later) {
      try { const read = await F.readNoteText(kind, abs); body = read.body ?? ''; mtime = read.mtime; }
      catch (err) { if (kind === 'text' && err.code === 'EENCODING') { kind = 'binary'; body = ''; } else throw err; }
    }
    const note = this.create({
      title: opts.title || path.basename(abs),
      body,
      tags: opts.tags || [],
      folderId: opts.folderId || null,
      filePath: abs,
      fileKind: kind,
      fileMtime: mtime,
    });
    if (later) this.fillFileText(note.id);
    return note;
  }

  async fillFileText(id: string) {
    const before = this.get(id);
    if (!before || !before.filePath) return;
    let read;
    try { read = await F.readNoteText(before.fileKind, before.filePath); } catch (_) { return; }
    const note = this.get(id);
    const body = read.body;
    if (!note || note.filePath !== before.filePath || note.fileMtime !== before.fileMtime || typeof body !== 'string' || body === note.body) return;
    this._commit(() => { note.body = body; });
    if (this.onFileText) this.onFileText(id);
  }

  markFileWritten(id: string) {
    const note = this.get(id);
    if (!note || !note.filePath) return null;
    const mtime = F.mtimeOf(note.filePath);
    this._commit(() => { note.fileMtime = mtime; });
    return mtime;
  }

  async refreshFileNote(id: string) {
    const note = this.get(id);
    if (!note || !note.filePath) return { changed: false, missing: false };
    if (!fs.existsSync(note.filePath)) return { changed: false, missing: true };
    const known = F.kindOf(note.filePath);
    const rekind = ['docx', 'sheet', 'image'].includes(known) && known !== note.fileKind;
    const mtime = F.mtimeOf(note.filePath);
    if (mtime === note.fileMtime && !rekind) return { changed: false, missing: false };
    const kind = rekind ? known : note.fileKind;
    let body = rekind ? '' : note.body;
    if (kind !== null && F.TEXTED_KINDS.has(kind)) {
      const read = await F.readNoteText(kind, note.filePath);
      if (typeof read.body === 'string') body = read.body;
    }
    const changed = rekind || body !== note.body || kind !== 'text';
    this._commit(() => { note.body = body; note.fileMtime = mtime; note.fileKind = kind; });
    return { changed, missing: false };
  }

  relinkFileNote(id: string, newPath: string, body?: string) {
    const note = this.get(id);
    if (!note || !note.filePath) return null;
    const oldName = path.basename(note.filePath);
    this._commit(() => {
      if (note.title === oldName) note.title = path.basename(newPath);
      note.filePath = newPath;
      note.fileKind = F.kindOf(newPath);
      note.fileMtime = F.mtimeOf(newPath);
      if (typeof body === 'string') note.body = body;
    });
    return note;
  }

  fileNotes() {
    return this.notes.filter((n) => n.filePath && !n.trashedAt);
  }

  getFolder(id: string) {
    return this.folders.find((f) => f.id === id) || null;
  }

  descendantIds(id: string) {
    const out = new Set<string>();
    const walk = (pid: string) => {
      for (const f of this.folders) if (f.parentId === pid && !out.has(f.id)) { out.add(f.id); walk(f.id); }
    };
    walk(id);
    return out;
  }

  folderPath(id: string) {
    const path: { id: string, name: string }[] = [];
    let cur = this.getFolder(id);
    let guard = 0;
    while (cur && guard++ < 10000) { path.unshift({ id: cur.id, name: cur.name }); cur = cur.parentId ? this.getFolder(cur.parentId) : null; }
    return path;
  }

  noteOutline(sort?: SortKey) {
    const by = new Map<string, Note[]>();
    for (const n of this.notes) {
      if (n.trashedAt) continue;
      const k = n.folderId || '';
      let list = by.get(k);
      if (!list) { list = []; by.set(k, list); }
      list.push(n);
    }
    const out: Record<string, OutlineRow[]> = {};
    for (const [k, list] of by) {
      const f = k ? this.getFolder(k) : null;
      const ordered = f && f.book ? this._orderPages(f, list) : H.sortNotes(list, sort || this.settings.sort);
      out[k] = ordered.map((n) => {
        const p = this.publicNote(n);
        return { id: n.id, title: H.deriveTitle(p), folderId: n.folderId || null, pinned: !!n.pinned, locked: !!p.locked, unlocked: !!p.unlocked, sticky: !!p.sticky,
          fileKind: n.fileKind || null, filePath: n.filePath || null, remindAt: p.remindAt || null, live: p.live || null, createdAt: n.createdAt, updatedAt: n.updatedAt };
      });
    }
    return out;
  }

  folderTree() {
    const direct = new Map<string, number>();
    for (const n of this.notes) {
      if (n.trashedAt || !n.folderId) continue;
      direct.set(n.folderId, (direct.get(n.folderId) || 0) + 1);
    }
    const byParent = new Map<string | null, Folder[]>();
    for (const f of this.folders) {
      const key = f.parentId || null;
      let siblings = byParent.get(key);
      if (!siblings) { siblings = []; byParent.set(key, siblings); }
      siblings.push(f);
    }
    const build = (pid: string | null, depth: number): FolderNode[] => (byParent.get(pid) || [])
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

  createFolder(data?: { name?: string; parentId?: string | null }) {
    data = data || {};
    const parentId = data.parentId && this.getFolder(data.parentId) ? data.parentId : null;
    const folder = folderFrom({ name: data.name, parentId }, this.now());
    const parent = parentId ? this.getFolder(parentId) : null;
    if (parent && parent.vaultId && parent.dirPath) {
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

  renameFolder(id: string, name: string) {
    const f = this.getFolder(id);
    if (!f) return null;
    let next = cleanFolderName(name);
    if (next === f.name) return f;
    if (f.vaultId && f.dirPath && f.parentId) {
      const parentDir = path.dirname(f.dirPath);
      assertVaultDirName(next);
      const wanted = H.safeFilename(next);
      next = wanted.toLowerCase() === path.basename(f.dirPath).toLowerCase() ? wanted : uniqueName(parentDir, wanted, '');
      const newDir = path.join(parentDir, next);
      fs.renameSync(f.dirPath, newDir);
      this._retargetVaultPaths(f.dirPath, newDir);
      f.dirPath = newDir;
    } else if (f.vaultId && !f.parentId) {
      const v = this.getVault(f.vaultId);
      if (v) v.name = next;
    }
    this._commit(() => { f.name = next; });
    return f;
  }

  _retargetVaultPaths(oldDir: string, newDir: string) {
    const oldKey = F.pathKey(oldDir);
    const under = (p: string | null | undefined): p is string => !!p && (F.pathKey(p) === oldKey || F.pathKey(p).startsWith(oldKey + '\\'));
    const swap = (p: string) => newDir + path.resolve(p).slice(path.resolve(oldDir).length);
    for (const n of this.notes) {
      if (under(n.filePath)) n.filePath = swap(n.filePath);
      if (under(n.trashedFrom)) n.trashedFrom = swap(n.trashedFrom);
    }
    for (const d of this.folders) if (d.dirPath && under(d.dirPath) && F.pathKey(d.dirPath) !== oldKey) d.dirPath = swap(d.dirPath);
  }

  moveFolder(id: string, parentId: string | null) {
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
      if (!target || target.vaultId !== f.vaultId || !target.dirPath || !f.dirPath) return { error: 'A vault folder can only move within its vault.' };
      const newDir = path.join(target.dirPath, uniqueName(target.dirPath, path.basename(f.dirPath), ''));
      fs.renameSync(f.dirPath, newDir);
      this._retargetVaultPaths(f.dirPath, newDir);
      f.dirPath = newDir;
      f.name = path.basename(newDir);
    } else if (parentId && this.getFolder(parentId)?.vaultId) {
      return { error: 'Plain folders cannot move into a vault. Create the folder inside the vault instead.' };
    }
    this._commit(() => { f.parentId = parentId; });
    return { folder: f };
  }

  deleteFolder(id: string) {
    const f = this.getFolder(id);
    if (!f) return null;
    const parent = f.parentId || null;
    if (f.vaultId && !parent) return { error: 'Remove a vault in Settings; its files stay on disk.' };
    if (f.vaultId && f.dirPath) {
      const parentDir = path.dirname(f.dirPath);
      for (const e of fs.readdirSync(f.dirPath, { withFileTypes: true })) {
        const from = path.join(f.dirPath, e.name);
        const ext = e.isDirectory() ? '' : path.extname(e.name);
        const to = path.join(parentDir, uniqueName(parentDir, e.isDirectory() ? e.name : stem(e.name), ext));
        fs.renameSync(from, to);
        if (e.isDirectory()) this._retargetVaultPaths(from, to);
        else { const n = this.findByPath(from); if (n) n.filePath = to; }
      }
      const dirKey = F.pathKey(f.dirPath);
      for (const n of this.notes) if (n.trashedFrom && F.pathKey(path.dirname(n.trashedFrom)) === dirKey) n.trashedFrom = path.join(parentDir, path.basename(n.trashedFrom));
      try { fs.rmdirSync(f.dirPath); } catch (_) {  }
    }
    return this._commit(() => {
      let movedNotes = 0, movedFolders = 0;
      for (const n of this.notes) if (n.folderId === id) { n.folderId = parent; movedNotes++; }
      for (const c of this.folders) if (c.parentId === id) { c.parentId = parent; movedFolders++; }
      this.folders = this.folders.filter((x) => x.id !== id);
      this.settings.expandedFolders = this.settings.expandedFolders.filter((x) => x !== id);
      this.settings.treeExpanded = this.settings.treeExpanded.filter((x) => x !== id);
      return { movedNotes, movedFolders, parentId: parent };
    });
  }

  getSettings() {
    return Object.assign({}, this.settings);
  }

  setSettings(patch?: SettingsPatch) {
    const previous = this.settings;
    this.settings = sanitizeSettings(Object.assign({}, this.settings, patch || {}));
    try { this.save(); } catch (err) { this.settings = previous; throw err; }
    return this.getSettings();
  }

  exportNote(id: string) {
    const note = this.get(id);
    if (!note) return null;
    if (note.lock && !this.plain.has(id)) throw Object.assign(new Error('This note is locked. Unlock it first.'), { code: 'ELOCKED' });
    const view = this.publicNote(note);
    return { filename: H.safeFilename(H.deriveTitle(view)) + '.md', content: H.noteToMarkdown(view) };
  }

  exportAll() {
    const notes = this.notes.filter((n) => !n.trashedAt).map(({ live: _live, ...rest }) => rest);
    return JSON.stringify({ exportedAt: this.now(), folders: this.folders, notes }, null, 2);
  }

  importMarkdown(filename: string, content: string) {
    const parsed = H.markdownToNote(filename, content);
    return this.create(parsed);
  }
}

export { STICKY_COLORS, sanitizeSticky, Store, isFileNote, DEFAULT_SETTINGS, EDITOR_WIDTH, VAULT_EXT, sanitizeSettings, sanitizeNote, sanitizeFolder, sanitizeVault, cleanFolderName };
