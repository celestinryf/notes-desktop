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
  window: null,             // { x, y, width, height }
});

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
  s.sort = ['updated', 'created', 'title'].includes(s.sort) ? s.sort : 'updated';
  if (s.window && typeof s.window === 'object') {
    const w = s.window;
    const ok = ['width', 'height'].every((k) => Number.isFinite(w[k]) && w[k] > 100);
    s.window = ok ? { x: w.x, y: w.y, width: w.width, height: w.height } : null;
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
    this.notes = notes.map((n) => sanitizeNote(n, now)).filter(Boolean);
    this.settings = sanitizeSettings(raw && raw.settings);
    return this;
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
    return { schemaVersion: SCHEMA_VERSION, savedAt: this.now(), settings: this.settings, notes: this.notes };
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    this._maybeBackup();
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.serialize(), null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
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
    this.notes.unshift(note);
    this.save();
    return note;
  }

  update(id, patch) {
    const note = this.get(id);
    if (!note) return null;
    patch = patch || {};
    let changed = false;
    if (typeof patch.title === 'string' && patch.title !== note.title) { note.title = patch.title; changed = true; }
    if (typeof patch.body === 'string' && patch.body !== note.body) { note.body = patch.body; changed = true; }
    if (patch.tags !== undefined) {
      const tags = H.parseTags(patch.tags);
      if (tags.join(',') !== note.tags.join(',')) { note.tags = tags; changed = true; }
    }
    if (typeof patch.pinned === 'boolean' && patch.pinned !== note.pinned) { note.pinned = patch.pinned; changed = true; }
    if (changed) {
      note.updatedAt = this.now();
      this.save();
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
    return this.create({ title: note.title ? note.title + ' (copy)' : '', body: note.body, tags: note.tags, pinned: false });
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
    return JSON.stringify({ exportedAt: this.now(), notes: this.notes.filter((n) => !n.trashedAt) }, null, 2);
  }

  importMarkdown(filename, content) {
    const parsed = H.markdownToNote(filename, content);
    return this.create(parsed);
  }
}

module.exports = { Store, DEFAULT_SETTINGS, sanitizeSettings, sanitizeNote };
