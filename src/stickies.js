'use strict';
/* Desktop stickies: one small frameless window per note that has note.sticky set. Main process only.
   Position, size, tint and the on-top flag are persisted on the note, so stickies come back at login. */
const path = require('path');
const { BrowserWindow, screen } = require('electron');

const THEME_BG = { light: '#f6dcc3', dark: '#2a1a12' };

class StickyManager {
  constructor(store, opts) {
    opts = opts || {};
    this.store = store;
    this.windows = new Map(); // noteId -> BrowserWindow
    this.timers = new Map();  // noteId -> bounds persist timer
    this.themeFor = opts.themeFor || (() => 'light');
    this.showInactive = !!opts.showInactive;
    this.onChange = opts.onChange || (() => {}); // (noteId) -> void, after a sticky opens/closes/forgets
    this.quitting = false;
  }

  isOpen(id) {
    const w = this.windows.get(id);
    return !!(w && !w.isDestroyed());
  }

  openIds() {
    return Array.from(this.windows.keys()).filter((id) => this.isOpen(id));
  }

  // Shows the sticky for a note, creating the window if needed. Marks the note sticky if it was not.
  open(id, opts) {
    opts = opts || {};
    const note = this.store.get(id);
    if (!note || note.trashedAt || note.lock) return null; // a locked note never sits on the desktop
    if (!note.sticky) this.store.setSticky(id, { x: null, y: null });
    const sticky = this.store.get(id).sticky;
    if (this.isOpen(id)) {
      const w = this.windows.get(id);
      if (opts.focus !== false) { w.show(); w.focus(); }
      return w;
    }
    const bounds = this._bounds(sticky);
    const w = new BrowserWindow({
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      minWidth: 180, minHeight: 140,
      frame: false,
      show: false,
      skipTaskbar: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: !!sticky.onTop,
      title: 'Sticky',
      backgroundColor: THEME_BG[this.themeFor()] || THEME_BG.light,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
      },
    });
    this.windows.set(id, w);
    // Same guards as the main window: nothing navigates or opens windows from the privileged page.
    w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) require('electron').shell.openExternal(url); return { action: 'deny' }; });
    w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) require('electron').shell.openExternal(url); } });
    w.loadFile(path.join(__dirname, 'renderer', 'sticky.html'), { query: { id } });
    w.once('ready-to-show', () => {
      if (w.isDestroyed()) return;
      if (this.showInactive || opts.focus === false) w.showInactive(); else { w.show(); w.focus(); }
    });
    const persist = () => {
      clearTimeout(this.timers.get(id));
      this.timers.set(id, setTimeout(() => {
        if (w.isDestroyed()) return;
        const b = w.getBounds();
        try { this.store.setSticky(id, { x: b.x, y: b.y, w: b.width, h: b.height }); } catch (_) { /* saving paused; not worth a dialog */ }
      }, 400));
    };
    w.on('move', persist);
    w.on('resize', persist);
    w.on('closed', () => {
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
      if (this.windows.get(id) === w) this.windows.delete(id);
      this.onChange(id);
    });
    this.onChange(id);
    return w;
  }

  // Closes the window. With forget, the note stops being a sticky (it stays a note).
  close(id, opts) {
    opts = opts || {};
    if (opts.forget) { try { this.store.setSticky(id, null); } catch (_) { /* paused */ } }
    const w = this.windows.get(id);
    if (w && !w.isDestroyed()) w.close(); else this.onChange(id);
  }

  setColor(id, color) {
    const note = this.store.setSticky(id, { color });
    this._send(id, 'sticky:changed', note && note.sticky);
    return note && note.sticky;
  }

  setOnTop(id, onTop) {
    const note = this.store.setSticky(id, { onTop: !!onTop });
    const w = this.windows.get(id);
    if (w && !w.isDestroyed()) w.setAlwaysOnTop(!!onTop);
    this._send(id, 'sticky:changed', note && note.sticky);
    return note && note.sticky;
  }

  // Opens every note that was a sticky when the app last ran.
  restoreAll() {
    for (const n of this.store.stickies()) { try { this.open(n.id, { focus: false }); } catch (err) { console.error('[stickies] restore failed', err); } }
  }

  // Gives every sticky the chance to write a pending edit; flushFn(window) resolves when it has.
  flushAll(flushFn) {
    const open = Array.from(this.windows.values()).filter((w) => !w.isDestroyed());
    return Promise.all(open.map((w) => flushFn(w).catch(() => {})));
  }

  closeAll() {
    this.quitting = true;
    for (const w of this.windows.values()) { if (!w.isDestroyed()) { try { w.destroy(); } catch (_) { /* ignore */ } } }
    this.windows.clear();
  }

  // Tells every sticky (except the sender) that a note changed, so it can reload if it shows that note.
  broadcast(channel, payload, exceptContents) {
    for (const w of this.windows.values()) {
      if (w.isDestroyed()) continue;
      if (exceptContents && w.webContents.id === exceptContents.id) continue;
      w.webContents.send(channel, payload);
    }
  }

  _send(id, channel, payload) {
    const w = this.windows.get(id);
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }

  // A saved position is used only when it is still on a screen; otherwise cascade from the top-right corner.
  _bounds(sticky) {
    const width = sticky.w, height = sticky.h;
    if (Number.isFinite(sticky.x) && Number.isFinite(sticky.y)) {
      const rect = { x: sticky.x, y: sticky.y, width, height };
      const onScreen = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return rect.x + 40 < a.x + a.width && rect.x + rect.width - 40 > a.x && rect.y + 20 < a.y + a.height && rect.y + rect.height - 20 > a.y;
      });
      if (onScreen) return rect;
    }
    const area = screen.getPrimaryDisplay().workArea;
    const n = this.openIds().length;
    return { x: area.x + area.width - width - 24 - (n % 4) * 32, y: area.y + 24 + (n % 6) * 40, width, height };
  }
}

module.exports = { StickyManager };
