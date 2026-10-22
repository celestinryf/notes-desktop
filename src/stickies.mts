import path from 'node:path';
import { BrowserWindow, screen, Menu, shell, clipboard } from 'electron';
import * as windowInput from './window-input.mts';
import type { Store } from './store.mts';

const THEME_BG = { light: '#f6dcc3', dark: '#2a1a12' };

class StickyManager {
  store: Store;
  windows: Map<string, BrowserWindow>;
  timers: Map<string, NodeJS.Timeout>;
  themeFor: () => 'light' | 'dark';
  showInactive: boolean;
  onChange: (noteId: string) => void;
  quitting: boolean;
  constructor(store: Store, opts?: { themeFor?: () => 'light' | 'dark', showInactive?: boolean, onChange?: (noteId: string) => void }) {
    opts = opts || {};
    this.store = store;
    this.windows = new Map();
    this.timers = new Map();
    this.themeFor = opts.themeFor || (() => 'light');
    this.showInactive = !!opts.showInactive;
    this.onChange = opts.onChange || (() => {});
    this.quitting = false;
  }

  isOpen(id: string) {
    const w = this.windows.get(id);
    return !!(w && !w.isDestroyed());
  }

  openIds() {
    return Array.from(this.windows.keys()).filter((id) => this.isOpen(id));
  }

  open(id: string, opts?: { focus?: boolean }) {
    opts = opts || {};
    const note = this.store.get(id);
    if (!note || note.trashedAt || note.lock) return null;
    if (!note.sticky) this.store.setSticky(id, { x: null, y: null });
    const sticky = this.store.get(id)?.sticky;
    if (!sticky) return null;
    const open = this.windows.get(id);
    if (open && !open.isDestroyed()) {
      if (opts.focus !== false) { open.show(); open.focus(); }
      return open;
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
        preload: path.join(import.meta.dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
      },
    });
    this.windows.set(id, w);
    w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    w.webContents.on('will-navigate', (e, url) => { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); });
    windowInput.attachZoom(w.webContents);
    windowInput.attachContextMenu(w.webContents, () => w, { Menu, shell, clipboard });
    w.loadFile(path.join(import.meta.dirname, 'renderer', 'sticky.html'), { query: { id } });
    w.once('ready-to-show', () => {
      if (w.isDestroyed()) return;
      if (this.showInactive || opts.focus === false) w.showInactive(); else { w.show(); w.focus(); }
    });
    const persist = () => {
      clearTimeout(this.timers.get(id));
      this.timers.set(id, setTimeout(() => {
        if (w.isDestroyed()) return;
        const b = w.getBounds();
        try { this.store.setSticky(id, { x: b.x, y: b.y, w: b.width, h: b.height }); } catch (_) {  }
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

  close(id: string, opts?: { forget?: boolean }) {
    opts = opts || {};
    if (opts.forget) { try { this.store.setSticky(id, null); } catch (_) {  } }
    const w = this.windows.get(id);
    if (w && !w.isDestroyed()) w.close(); else this.onChange(id);
  }

  setColor(id: string, color: string) {
    const note = this.store.setSticky(id, { color });
    this._send(id, 'sticky:changed', note && note.sticky);
    return note && note.sticky;
  }

  setOnTop(id: string, onTop: boolean) {
    const note = this.store.setSticky(id, { onTop: !!onTop });
    const w = this.windows.get(id);
    if (w && !w.isDestroyed()) w.setAlwaysOnTop(!!onTop);
    this._send(id, 'sticky:changed', note && note.sticky);
    return note && note.sticky;
  }

  restoreAll() {
    for (const n of this.store.stickies()) { try { this.open(n.id, { focus: false }); } catch (err) { console.error('[stickies] restore failed', err); } }
  }

  flushAll(flushFn: (w: BrowserWindow) => Promise<unknown>) {
    const open = Array.from(this.windows.values()).filter((w) => !w.isDestroyed());
    return Promise.all(open.map((w) => flushFn(w).catch(() => {})));
  }

  closeAll() {
    this.quitting = true;
    for (const w of this.windows.values()) { if (!w.isDestroyed()) { try { w.destroy(); } catch (_) {  } } }
    this.windows.clear();
  }

  broadcast(channel: string, payload?: unknown, exceptContents?: Electron.WebContents) {
    for (const w of this.windows.values()) {
      if (w.isDestroyed()) continue;
      if (exceptContents && w.webContents.id === exceptContents.id) continue;
      w.webContents.send(channel, payload);
    }
  }

  _send(id: string, channel: string, payload: Sticky | null) {
    const w = this.windows.get(id);
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }

  _bounds(sticky: Sticky) {
    const width = sticky.w, height = sticky.h;
    const { x, y } = sticky;
    if (x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y)) {
      const rect = { x, y, width, height };
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

export { StickyManager };
