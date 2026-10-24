import path from 'node:path';
import fs from 'node:fs';
import { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, dialog, shell, nativeTheme, screen, Notification, clipboard, ClipboardItem, session, protocol } from 'electron';
import { Store, isFileNote, MOVING_MARKER } from './store.mts';
import { SearchIndex } from './search-index.mts';
import { linkNamesOf } from './vault-links.mts';
import { GitSync } from './gitSync.mts';
import * as windowInput from './window-input.mts';
import { VaultManager } from './vaults.mts';
import { drawIconBitmap } from './icon.mts';
import crypto from 'node:crypto';
import os from 'node:os';
import * as H from './shared/helpers.mts';
import * as convert from './convert.mts';
import { runWorker } from './run-worker.mts';
import * as crafts from './craft-host.mts';
import { createCraftTrace } from './craft-trace.mts';
import { ReminderScheduler } from './reminders.mts';
import { LiveShare } from './live.mts';
import { StickyManager } from './stickies.mts';
import { discoverAgentFiles, readDocumentBuffer, readDocxText, readNoteText, readImage, mtimeOf, pathKey } from './files.mts';
import * as claudeBin from './claude-bin.mts';
import { execFile, execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { pathToFileURL, fileURLToPath } from 'node:url';

interface HiddenPageOptions { isolated?: boolean; javascript?: boolean; allowFiles?: string[]; readDir?: string; timeoutMs?: number }

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = process.env.NOTES_APP_DATA_DIR || path.join(app.getPath('appData'), 'notes-app');
const START_HIDDEN = process.argv.includes('--hidden') || process.env.NOTES_APP_START_HIDDEN === '1';
const SHOW_INACTIVE = process.env.NOTES_APP_INACTIVE === '1';
const MANAGE_LOGIN_ITEM = process.env.NOTES_APP_NO_LOGIN_ITEM !== '1';
const HOTKEY_FALLBACKS = ['CommandOrControl+Alt+N', 'CommandOrControl+Shift+Alt+N', 'CommandOrControl+Alt+J', 'CommandOrControl+Alt+F12'];
import * as Themes from './shared/themes.mts';
const TITLE_BAR_H = 40;

app.setName('Notes');
crafts.registerSchemes(protocol);
app.setAppUserModelId('com.celestinryf.notes');
app.setPath('userData', DATA_DIR);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function notesDirFor() {
  const override = process.env.NOTES_APP_NOTES_DIR || (process.env.NOTES_APP_DATA_DIR ? path.join(DATA_DIR, 'Notes') : '');
  if (override) return override;
  const base = path.join(app.getPath('documents'), 'Notes');
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? base : base + ' ' + i;
    let entries: string[] | null = null;
    try { entries = fs.readdirSync(candidate); } catch (_) {  }
    if (!entries || !entries.length || entries.includes(MOVING_MARKER)) return candidate;
  }
}

function plainFilesError(err: NodeJS.ErrnoException) {
  const where = err.path ? ' (' + err.path + ')' : '';
  if (err.code === 'EPERM' || err.code === 'EACCES') return 'Windows did not allow writing there' + where;
  if (err.code === 'ENOSPC') return 'the disk is full';
  if (err.code === 'EBUSY') return 'another program was using a file' + where;
  if (err.code === 'ENAMETOOLONG') return 'a file path was too long' + where;
  return String(err.message || err);
}

function backupBeforeFiles() {
  const current = fs.readFileSync(path.join(DATA_DIR, 'notes.json'));
  const earlier = fs.readdirSync(DATA_DIR).filter((name) => name.startsWith('before-files-')).sort().reverse()[0];
  if (earlier) {
    try { if (fs.readFileSync(path.join(DATA_DIR, earlier, 'notes.json')).equals(current)) return path.join(DATA_DIR, earlier); } catch (_) {  }
  }
  const backupDir = path.join(DATA_DIR, 'before-files-' + H.fileStamp(Date.now()));
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, 'notes.json'), current);
  return backupDir;
}

function ensureNotesFolder(store: Store): FilesMove {
  if (store.saveBlocked || store.homeVault()) return { report: null, error: null };
  try {
    const dir = notesDirFor();
    const appNotes = store.notes.some((n) => !n.filePath && !n.vaultId) || store.folders.some((f) => !f.vaultId);
    if (!appNotes) { store.addHomeVault(dir); return { report: null, error: null }; }
    store.flush();
    const backupDir = backupBeforeFiles();
    const report = Object.assign(store.moveIntoHome(dir), { backupDir, at: Date.now() });
    try { fs.writeFileSync(path.join(DATA_DIR, 'moved-to-files.json'), JSON.stringify(report, null, 2)); } catch (_) {  }
    return { report, error: null };
  } catch (err) {
    console.error('[files] moving notes into a folder failed:', err);
    return { report: null, error: plainFilesError(err) };
  }
}

function main() {
  const trace = createCraftTrace(DATA_DIR, process.env.NOTES_APP_CRAFT_TRACE === '1');
  trace.write('app-start', { uptimeMs: Math.round(process.uptime() * 1000), hidden: START_HIDDEN, version: app.getVersion() });
  const store = new Store(DATA_DIR).load();
  let filesMove = ensureNotesFolder(store);
  const git = new GitSync(DATA_DIR, {
    debounceMs: Number(process.env.NOTES_APP_GIT_DEBOUNCE_MS) || 4000,
    onChange: (s) => { if (win && !win.isDestroyed()) win.webContents.send('git:status', s); },
    beforeSnapshot: () => { store.flush(); },
    workTree: () => { const home = store.homeVault(); return home ? home.path : null; },
    linkedFiles: () => store.textFilesOutsideHome(),
  });
  store.onContentChange = () => git.noteChanged();
  const searchIndex = new SearchIndex(path.join(DATA_DIR, 'search-index.sqlite'), () => store.notes);
  store.onIndexChange = (update) => searchIndex.changed(update);
  searchIndex.onReady = (info) => trace.write('search-index-ready', info);
  let win: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let quitting = false;
  let pendingOpenNote: string | null = null;
  const vaults = new VaultManager(store, {
    debounceMs: Number(process.env.NOTES_APP_VAULT_DEBOUNCE_MS) || 8000,
    onChange: (id, status) => { if (win && !win.isDestroyed()) win.webContents.send('vault:status', { id, status }); },
    onNotesChanged: () => { fanReloaded({ reason: 'vault' }); },
  });
  const reminders = new ReminderScheduler(store, {
    tickMs: Number(process.env.NOTES_APP_REMINDER_TICK_MS) || 30000,
    notify: (note) => {
      const title = H.deriveTitle(note) || 'Reminder';
      if (win && !win.isDestroyed()) win.webContents.send('reminder:fired', { id: note.id, title });
      if (process.env.NOTES_APP_DRY_NOTIFY === '1' || !Notification.isSupported()) return;
      const n = new Notification({ title: '⏰ ' + title, body: H.plainTextFromMarkdown(note.body).slice(0, 200) || 'Open your note', icon: iconImage() });
      n.on('click', () => { const w = showWindow(); if (rendererReady) w.webContents.send('app:open-note', note.id); else pendingOpenNote = note.id; });
      n.show();
    },
  });
  const live = new LiveShare(store, {
    pushDelayMs: Number(process.env.NOTES_APP_LIVE_PUSH_MS) || 250,
    onRemote: (id) => { fanReloaded({ reason: 'live', id }); stickies.broadcast('notes:changed', { id }); },
    onStatus: (id, status) => { if (win && !win.isDestroyed()) win.webContents.send('live:status', { id, status }); },
  });
  const stickies = new StickyManager(store, {
    themeFor: effectiveTheme,
    showInactive: SHOW_INACTIVE,
    onChange: () => { refreshTray(); if (win && !win.isDestroyed()) win.webContents.send('stickies:changed'); },
  });
  let hotkeyState: { hotkey: string, registered: boolean, fallback?: boolean } = { hotkey: store.settings.hotkey, registered: false };
  let boundsTimer: NodeJS.Timeout | undefined;

  const iconImage = () => nativeImage.createFromBitmap(drawIconBitmap(32), { width: 32, height: 32 });

  let rendererShown = false;
  function writeRuntime(extra?: { ready?: boolean; visible?: boolean; exiting?: boolean }) {
    if (extra && extra.ready) rendererShown = true;
    const data = Object.assign({
      ready: rendererShown,
      pid: process.pid,
      hotkey: hotkeyState.hotkey,
      registered: hotkeyState.registered,
      visible: !!(win && !win.isDestroyed() && win.isVisible()),
      focused: !!(win && !win.isDestroyed() && win.isFocused()),
      updatedAt: Date.now(),
    }, extra || {});
    try { fs.writeFileSync(path.join(DATA_DIR, 'runtime.json'), JSON.stringify(data)); } catch (_) {  }
  }

  function effectiveTheme() {
    const t = store.settings.theme;
    if (t === 'light' || t === 'dark') return t;
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }

  function windowColors() {
    return Themes.windowColors(store.settings, effectiveTheme());
  }

  function safeBounds(saved: WindowRect | null) {
    const def = { width: 1100, height: 720 };
    if (!saved) return def;
    try {
      const area = screen.getDisplayMatching(saved).workArea;
      const fits = saved.x >= area.x - 50 && saved.y >= area.y - 50 && saved.x < area.x + area.width - 100 && saved.y < area.y + area.height - 100;
      return fits ? saved : { width: saved.width, height: saved.height };
    } catch (_) {
      return def;
    }
  }

  function createWindow() {
    const w = new BrowserWindow({
      minWidth: 760,
      minHeight: 480,
      show: false,
      autoHideMenuBar: true,
      title: 'Notes',
      icon: iconImage(),
      backgroundColor: windowColors().background,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: windowColors().background, symbolColor: windowColors().foreground, height: TITLE_BAR_H },
      alwaysOnTop: store.settings.alwaysOnTop,
      webPreferences: {
        preload: path.join(import.meta.dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        nodeIntegrationInSubFrames: true,
      },
      ...safeBounds(store.settings.window),
    });
    win = w;

    w.loadFile(path.join(import.meta.dirname, 'renderer', 'index.html'));

    w.once('ready-to-show', () => {
      if (!START_HIDDEN) showWindow();
      writeRuntime({ ready: true });
    });

    w.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      w.hide();
      writeRuntime();
    });
    w.on('show', () => trace.write('window-show'));
    w.on('hide', () => trace.write('window-hide'));

    const persistBounds = () => {
      clearTimeout(boundsTimer);
      boundsTimer = setTimeout(() => {
        if (!w.isDestroyed() && !w.isMinimized() && !w.isMaximized()) {
          try { store.setSettings({ window: w.getBounds() }); } catch (_) {  }
        }
      }, 400);
    };
    w.on('resize', persistBounds);
    w.on('move', persistBounds);
    w.on('show', () => writeRuntime());
    w.on('session-end', () => {
      try { w.webContents.send('app:flush'); } catch (_) {  }
      stickies.broadcast('app:flush');
      git.flush().catch(() => {}).finally(flushStore);
    });
    w.on('hide', () => { writeRuntime(); relockOnHide(); });
    w.on('focus', () => {
      if (store.settings.alwaysOnTop && !w.isAlwaysOnTop()) w.setAlwaysOnTop(true);
      writeRuntime();
    });
    w.on('blur', () => writeRuntime());

    w.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    let zoomSaveTimer: NodeJS.Timeout | undefined;
    const rememberZoom = (level: number) => {
      clearTimeout(zoomSaveTimer);
      zoomSaveTimer = setTimeout(() => { if (store.settings.zoomLevel === level) return; try { store.setSettings({ zoomLevel: level }); } catch (_) {  } }, 400);
    };
    windowInput.attachZoom(w.webContents, { initial: store.settings.zoomLevel, onChange: rememberZoom });
    windowInput.attachContextMenu(w.webContents, () => w, { Menu, shell, clipboard, onZoom: rememberZoom });
    w.webContents.on('will-navigate', (e, url) => {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    });

    if (process.env.NOTES_APP_DEVTOOLS === '1') w.webContents.openDevTools({ mode: 'detach' });
    if (process.env.NOTES_APP_LOG_CONSOLE === '1') {
      w.webContents.on('console-message', (ev, ...rest) => {
        const d = ev && typeof ev.level !== 'undefined' ? ev : { level: rest[0], message: rest[1], lineNumber: rest[2], sourceId: rest[3] };
        const level = typeof d.level === 'number' ? ['debug', 'info', 'warning', 'error'][d.level] || d.level : d.level;
        console.log('[renderer:' + level + '] ' + d.message + ' (' + d.sourceId + ':' + d.lineNumber + ')');
      });
      w.webContents.on('render-process-gone', (_e, details) => console.log('[renderer:error] render process gone: ' + details.reason));
    }
    return w;
  }

  let reloadedSinceStart = false;
  function retryLoadIfBlocked() {
    if (!store.saveBlocked) return;
    try { store.load(); } catch (_) { return; }
    if (!store.saveBlocked) {
      reloadedSinceStart = true;
      filesMove = ensureNotesFolder(store);
      applyTheme();
      registerHotkey(store.settings.hotkey);
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!store.settings.alwaysOnTop);
      applyLoginItem();
      git.configure(store.settings).then(() => { if (store.settings.gitEnabled) git.noteChanged(); }).catch(() => {});
      if (win && !win.isDestroyed()) win.webContents.send('settings:changed', store.getSettings());
      fanReloaded({ reason: 'recovered' });
      try { stickies.restoreAll(); } catch (_) {  }
      vaults.start().catch(() => {});
      live.restore().catch(() => {});
    }
  }

  function showWindow() {
    retryLoadIfBlocked();
    const w = win && !win.isDestroyed() ? win : createWindow();
    if (w.isMinimized()) w.restore();
    if (SHOW_INACTIVE) {
      w.showInactive();
    } else {
      w.show();
      w.focus();
      app.focus({ steal: true });
    }
    w.webContents.send('app:shown');
    writeRuntime();
    return w;
  }

  function openDialog(options: Electron.OpenDialogOptions) {
    return win && !win.isDestroyed() ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
  }

  function saveDialog(options: Electron.SaveDialogOptions) {
    return win && !win.isDestroyed() ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options);
  }

  function hideWindow() {
    if (win && !win.isDestroyed() && win.isVisible()) win.hide();
    writeRuntime();
  }

  function toggleWindow() {
    if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) hideWindow();
    else showWindow();
  }

  function registerHotkey(preferred: string) {
    globalShortcut.unregisterAll();
    const candidates = [preferred].concat(HOTKEY_FALLBACKS.filter((k) => k !== preferred));
    for (const acc of candidates) {
      let ok = false;
      try { ok = globalShortcut.register(acc, toggleWindow); } catch (_) { ok = false; }
      if (ok) {
        hotkeyState = { hotkey: acc, registered: true, fallback: acc !== preferred };
        writeRuntime();
        refreshTray();
        return hotkeyState;
      }
    }
    hotkeyState = { hotkey: preferred, registered: false, fallback: false };
    writeRuntime();
    refreshTray();
    return hotkeyState;
  }

  function applyLoginItem() {
    if (!MANAGE_LOGIN_ITEM) return;
    try {
      app.setLoginItemSettings({
        openAtLogin: !!store.settings.openAtLogin,
        name: 'Notes',
        path: process.execPath,
        args: app.isPackaged ? ['--hidden'] : [APP_ROOT, '--hidden'],
      });
    } catch (_) {  }
  }

  function applyTheme() {
    nativeTheme.themeSource = store.settings.theme;
    if (win && !win.isDestroyed()) win.setBackgroundColor(windowColors().background);
  }

  function refreshTray() {
    if (!tray) return;
    const hk = hotkeyState.registered ? H.displayAccelerator(hotkeyState.hotkey) : 'hotkey unavailable';
    tray.setToolTip('Notes  (' + hk + ')');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show / hide notes', accelerator: hotkeyState.registered ? hotkeyState.hotkey : undefined, click: toggleWindow },
      { label: 'New note', click: requestNewNote },
      { label: 'New sticky note', click: newSticky },
      { label: 'Stickies', submenu: stickyMenu() },
      { type: 'separator' },
      { label: 'Start at login', type: 'checkbox', checked: !!store.settings.openAtLogin, click: (item) => { try { store.setSettings({ openAtLogin: item.checked }); applyLoginItem(); } catch (_) {  } broadcastSettings(); refreshTray(); } },
      { label: 'Always on top', type: 'checkbox', checked: !!store.settings.alwaysOnTop, click: (item) => { try { store.setSettings({ alwaysOnTop: item.checked }); if (win) win.setAlwaysOnTop(item.checked); } catch (_) {  } broadcastSettings(); refreshTray(); } },
      { label: 'Open data folder', click: () => shell.openPath(DATA_DIR) },
      { type: 'separator' },
      { label: 'Quit Notes', click: () => { quitting = true; app.quit(); } },
    ]));
  }

  function stickyMenu() {
    const items = (store.stickies().map((n) => ({
      label: (stickies.isOpen(n.id) ? '' : '(hidden) ') + (H.deriveTitle(n) || 'Untitled').slice(0, 60),
      click: () => stickies.open(n.id),
    })) as Electron.MenuItemConstructorOptions[]);
    if (!items.length) items.push({ label: 'No stickies yet', enabled: false });
    items.push({ type: 'separator' });
    items.push({ label: 'Show all', enabled: store.stickies().length > 0, click: () => { for (const n of store.stickies()) stickies.open(n.id, { focus: false }); } });
    items.push({ label: 'Hide all (keep as stickies)', enabled: stickies.openIds().length > 0, click: () => { for (const id of stickies.openIds()) stickies.close(id); } });
    return items;
  }

  function createTray() {
    tray = new Tray(iconImage());
    tray.on('click', toggleWindow);
    tray.on('double-click', showWindow);
    refreshTray();
  }

  function broadcastSettings() {
    if (win && !win.isDestroyed()) win.webContents.send('settings:changed', store.getSettings());
    stickies.broadcast('settings:changed', store.getSettings());
  }

  let craftsReady: Record<string, boolean> = {};
  function info() {
    return {
      version: app.getVersion(),
      dataDir: DATA_DIR,
      hotkey: hotkeyState.hotkey,
      hotkeyRegistered: hotkeyState.registered,
      hotkeyFallback: !!hotkeyState.fallback,
      hotkeyDisplay: H.displayAccelerator(hotkeyState.hotkey),
      platform: process.platform,
      crafts: craftsReady,
      loadError: store.loadError ? String(store.loadError.message || store.loadError) : null,
      documentsDir: app.getPath('documents'),
      saveBlocked: !!store.saveBlocked,
      drySpeech: process.env.NOTES_APP_DRY_SPEECH === '1',
      recoveredNotes: store.recoveredFromBackup ? store.notes.length : null,
      craftTrace: trace.enabled,
      notesDir: (store.homeVault() || { path: null }).path,
      homeVaultId: (store.homeVault() || { id: null }).id,
      movedToFiles: filesMove.report,
      filesError: filesMove.error,
    };
  }

  const handle = <K extends IpcChannel>(channel: K, fn: (event: Electron.IpcMainInvokeEvent, ...args: IpcArgs<K>) => IpcResult<K> | Promise<IpcResult<K>>) => ipcMain.handle(channel, fn);
  ipcMain.on('app:trace', (_e, event: unknown, fields: unknown) => trace.fromPage(event, fields));
  handle('notes:list', async (_e, opts) => store.list(opts, await searchIndex.candidates(opts && opts.query)).map((n) => store.publicNote(n)));
  handle('notes:rows', async (_e, opts) => store.rows(opts, await searchIndex.candidates(opts && opts.query)));
  handle('notes:searchIds', async (_e, query) => { const q = typeof query === 'string' ? query : ''; return store.searchIds(q, await searchIndex.candidates(q)); });
  handle('notes:outline', (_e, sort) => store.noteOutline(typeof sort === 'string' ? sort : undefined));
  handle('notes:get', (_e, id) => store.publicNote(store.get(id)));
  handle('notes:latestFile', (_e, kind) => {
    if (kind !== 'docx' && kind !== 'sheet') return null;
    let latest = null;
    for (const n of store.notes) if (!n.trashedAt && n.filePath && n.fileKind === kind && (!latest || n.updatedAt > latest.updatedAt)) latest = n;
    return latest ? store.publicNote(latest) : null;
  });
  handle('notes:create', (_e, data) => {
    data = Object.assign({}, data || {});
    for (const k of ['filePath', 'fileKind', 'fileMtime', 'vaultId', 'lock', 'live', 'sticky', 'trashedFrom', 'id']) Reflect.deleteProperty(data, k);
    const note = store.create(data);
    if (note.vaultId) vaults.noteChanged(note.vaultId);
    return store.publicNote(note);
  });
  handle('notes:update', (e, id, patch) => {
    const note = store.update(id, patch);
    if (note && note.vaultId) vaults.noteChanged(note.vaultId);
    if (note) notifyNoteChanged(note.id, e.sender);
    return store.publicNote(note);
  });

  handle('lock:set', (_e, id, password) => { const n = store.lockNote(id, password); live.stop(id); stickies.close(id, { forget: true }); return n; });
  handle('lock:unlock', (_e, id, password) => store.unlockNote(id, password));
  handle('lock:relock', (_e, id) => { store.relock(id); return store.publicNote(store.get(id)); });
  handle('lock:remove', (_e, id, password) => store.removeLock(id, password));
  function relockOnHide() {
    flushWindow(win, 800).then(() => {
      if (win && !win.isDestroyed() && win.isVisible()) return;
      flushStore();
      const ids = store.relockAll();
      if (ids.length && win && !win.isDestroyed()) win.webContents.send('lock:relocked', ids);
    });
  }
  function fanReloaded(payload: { reason: string; id?: string }) {
    if (win && !win.isDestroyed()) win.webContents.send('notes:reloaded', payload);
    stickies.broadcast('notes:reloaded', payload);
  }
  store.onFileText = (id) => { fanReloaded({ reason: 'file', id }); };

  let trayRefreshTimer: NodeJS.Timeout | undefined;
  function refreshTraySoon() { clearTimeout(trayRefreshTimer); trayRefreshTimer = setTimeout(refreshTray, 1000); }

  function notifyNoteChanged(id: string, sender: Electron.WebContents) {
    const changed = store.get(id);
    if (changed && changed.sticky) refreshTraySoon();
    if (win && !win.isDestroyed() && (!sender || win.webContents.id !== sender.id)) win.webContents.send('notes:reloaded', { reason: 'sticky', id });
    stickies.broadcast('notes:changed', { id }, sender);
    live.noteChanged(id);
  }

  handle('live:host', async (_e, id) => { try { return { ok: true, status: await live.host(id) }; } catch (err) { return { ok: false, error: err.message }; } });
  handle('live:join', async (_e, url, folderId) => {
    const folder = folderId ? store.getFolder(folderId) : null;
    try { const r = await live.join(url, { folderId: folder && !folder.vaultId ? folder.id : null }); fanReloaded({ reason: 'live' }); return { ok: true, noteId: r.noteId, status: r.status }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  handle('live:stop', (_e, id) => live.stop(id));
  handle('live:status', (_e, id) => live.statusOf(id));
  handle('notes:togglePin', (_e, id) => store.publicNote(store.togglePin(id)));
  handle('notes:duplicate', (_e, id) => {
    const copy = store.duplicate(id);
    if (!copy) throw new Error('Note not found');
    return store.publicNote(copy);
  });
  handle('notes:splitIntoBook', (_e, id, opts) => {
    const r = store.splitIntoBook(id, opts);
    if (r.originalTrashed) { live.stop(id); stickies.close(id); }
    return r;
  });
  handle('notes:undoSplit', (_e, folderId, pageIds, originalId) => {
    const r = store.undoSplit(folderId, pageIds, originalId);
    for (const id of r.removedIds) { live.stop(id); stickies.close(id); }
    return r;
  });
  handle('notes:trash', (_e, id) => { live.stop(id); const n = store.trash(id); stickies.close(id); return store.publicNote(n); });
  handle('notes:restore', (_e, id) => store.publicNote(store.restore(id)));
  handle('notes:destroy', (_e, id) => { live.stop(id); stickies.close(id); return store.destroy(id); });
  handle('notes:emptyTrash', () => store.emptyTrash());

  const stickyView = (n: Note) => ({ id: n.id, title: H.deriveTitle(n), sticky: n.sticky, open: stickies.isOpen(n.id) });
  function newSticky() {
    let note;
    try {
      note = store.create({ title: '', body: '' });
      stickies.open(note.id);
    } catch (err) {
      if (note) { try { store.destroy(note.id); } catch (_) {  } }
      if (win && !win.isDestroyed()) win.webContents.send('app:notice', 'Could not create a sticky: ' + (err.message || err));
      return null;
    }
    fanReloaded({ reason: 'sticky' });
    return store.publicNote(note);
  }
  handle('stickies:list', () => store.stickies().map(stickyView));
  handle('stickies:open', (_e, id) => !!stickies.open(id));
  handle('stickies:close', (_e, id, opts) => { stickies.close(id, opts || {}); return true; });
  handle('stickies:create', () => newSticky());
  handle('stickies:setColor', (_e, id, color) => stickies.setColor(id, color));
  handle('stickies:setOnTop', (_e, id, onTop) => stickies.setOnTop(id, onTop));
  handle('stickies:openInNotes', (_e, id) => { const w = showWindow(); if (rendererReady) w.webContents.send('app:open-note', id); else pendingOpenNote = id; return true; });
  handle('notes:tags', () => store.tags());
  handle('notes:counts', () => store.counts());
  handle('notes:resolveLinks', (_e, id, names) => (typeof id === 'string' && Array.isArray(names) ? store.resolveWikiLinks(id, names.filter((n): n is string => typeof n === 'string')) : []));
  handle('notes:wikiLinkFor', (_e, sourceId, targetId) => (typeof sourceId === 'string' && typeof targetId === 'string' ? store.wikiLinkFor(sourceId, targetId) : null));
  handle('notes:related', async (_e, id) => {
    const note = store.get(id);
    return note ? store.related(id, undefined, await searchIndex.incoming(id, linkNamesOf(note))) : null;
  });
  handle('folders:setBook', (_e, id, on) => store.setBook(id, on));
  handle('folders:reorderPages', (_e, id, ids) => store.reorderPages(id, ids));

  const APP_ERROR_CODES = new Set(['EZIP', 'ETOOBIG', 'EENCODING']);
  async function linkPaths(paths: string[], opts?: Parameters<typeof store.linkFile>[1]) {
    const linked: (Awaited<ReturnType<typeof store.linkFile>>)[] = [];
    const failed: string[] = [];
    for (const p of paths) {
      try { linked.push(await store.linkFile(p, opts)); }
      catch (err) { failed.push(path.basename(p) + ' (' + (APP_ERROR_CODES.has(err.code) || !err.code ? err.message : err.code) + ')'); }
    }
    return { ok: linked.length > 0, linked: linked.map((n) => n.id), failed, firstId: linked.length ? linked[0].id : null };
  }

  handle('files:openDialog', async () => {
    const { canceled, filePaths } = await openDialog({
      title: 'Open files as notes',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Notes and documents', extensions: ['md', 'markdown', 'txt', 'tex', 'latex', 'pdf', ...H.WORD_EXT, ...H.SHEET_EXT, ...H.IMAGE_EXT, 'csv', 'tsv', 'json', 'yaml', 'yml', 'log'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true, linked: [], failed: [] };
    return linkPaths(filePaths);
  });
  handle('files:link', (_e, paths, opts) => linkPaths(Array.isArray(paths) ? paths : [], opts || {}));
  handle('files:refresh', (_e, id) => store.refreshFileNote(id));
  handle('files:reveal', (_e, id) => { const n = store.get(id); if (n && n.filePath) shell.showItemInFolder(n.filePath); });
  const EXEC_EXT = /\.(exe|bat|cmd|com|scr|pif|msi|msp|msc|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|lnk|url|jar|hta|reg|cpl|py|pyw|mht|mhtml)$/i;
  const OPENABLE_EXT = /\.(pdf|txt|md|markdown|mdx|csv|tsv|json|xml|yaml|yml|toml|ini|log|rtf|doc|docx|odt|xls|xlsx|ods|ppt|pptx|odp|key|pages|numbers|png|jpe?g|gif|webp|bmp|tiff?|heic|avif|mp3|wav|m4a|aac|ogg|opus|flac|webm|mp4|m4v|mov|mkv|avi|zip|7z|rar|gz|tar|epub|ics|vcf|tex|bib|srt|vtt)$/i;
  function openSafely(fullPath: string) {
    const name = path.basename(fullPath).replace(/[. ]+$/, '');
    if (OPENABLE_EXT.test(name) && !EXEC_EXT.test(name)) return shell.openPath(fullPath);
    shell.showItemInFolder(fullPath);
    return 'Shown in Explorer instead: Notes only opens documents and media itself.';
  }
  handle('files:openExternal', async (_e, id) => {
    const n = store.get(id);
    if (!n || !n.filePath) return 'No file';
    return openSafely(n.filePath);
  });
  function fileNoteOfKind(id: string, kind: FileKind): FileNote {
    const n = store.get(id);
    const wrongKindMessages: Partial<Record<FileKind, string>> = { pdf: 'Not a PDF.', image: 'Not an image.', sheet: 'Not a spreadsheet.' };
    if (!isFileNote(n) || n.fileKind !== kind) throw new Error(wrongKindMessages[kind] || 'Not a Word document.');
    return n;
  }

  const MAX_PDF_BYTES = 100 * 1024 * 1024;
  handle('files:pdfBytes', (_e, id) => {
    const n = fileNoteOfKind(id, 'pdf');
    if (fs.statSync(n.filePath).size > MAX_PDF_BYTES) throw new Error('This PDF is larger than 100 MB.');
    return fs.readFileSync(n.filePath);
  });

  const FILE_BACKUP_DIR = path.join(DATA_DIR, 'backups', 'files');
  const KEEP_FILE_VERSIONS = 10;
  const sessionOriginals = new Map();
  const backupDirFor = (file: string) => path.join(FILE_BACKUP_DIR, H.safeFilename(path.basename(file)) + ' ' + crypto.createHash('sha1').update(pathKey(file)).digest('hex').slice(0, 8));
  function backUpBeforeWrite(file: string) {
    const key = pathKey(file);
    const dir = backupDirFor(file);
    fs.mkdirSync(dir, { recursive: true });
    const name = H.fileStamp() + path.extname(file);
    fs.copyFileSync(file, path.join(dir, name), fs.constants.COPYFILE_EXCL);
    const first = !sessionOriginals.has(key);
    if (first) sessionOriginals.set(key, name);
    const keep = sessionOriginals.get(key);
    const all = fs.readdirSync(dir).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_FILE_VERSIONS))) if (old !== keep) fs.rmSync(path.join(dir, old), { force: true });
    return { first, name };
  }
  function writeInPlace(file: string, buf: Buffer) {
    const fd = fs.openSync(file, 'w');
    try {
      for (let done = 0; done < buf.length;) done += fs.writeSync(fd, buf, done, buf.length - done, done);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  }
  function replaceFile(id: string, file: string, buf: Buffer) {
    const backup = backUpBeforeWrite(file);
    writeInPlace(file, buf);
    return { mtime: store.markFileWritten(id), backup };
  }

  const conflictCopies = new Map();
  function saveEdits(id: string, file: string, buf: Buffer, expectedMtime: number | null) {
    if (stillAsOpened(file, expectedMtime)) {
      conflictCopies.delete(id);
      const { mtime, backup } = replaceFile(id, file, buf);
      return { mtime, backup: backup.first };
    }
    const prev = conflictCopies.get(id);
    if (prev && fs.existsSync(prev.file) && mtimeOf(prev.file) === prev.mtime) {
      writeInPlace(prev.file, buf);
      prev.mtime = mtimeOf(prev.file);
      return { savedAs: prev.file, newCopy: false };
    }
    const copy = convert.writeNew(path.dirname(file), path.basename(file, path.extname(file)) + ' (edited)', path.extname(file).slice(1).toLowerCase(), buf);
    conflictCopies.set(id, { file: copy, mtime: mtimeOf(copy) });
    return { savedAs: copy, newCopy: true };
  }
  handle('files:savePdf', (_e, id, bytes, expectedMtime) => saveEdits(id, fileNoteOfKind(id, 'pdf').filePath, pdfBuffer(bytes), expectedMtime));

  const SIGNATURE_FILE = path.join(DATA_DIR, 'signature.png');
  const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
  handle('signature:get', () => (fs.existsSync(SIGNATURE_FILE) ? fs.readFileSync(SIGNATURE_FILE) : null));
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  handle('signature:set', (_e, bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_SIGNATURE_BYTES) return { ok: false, error: 'the signature picture is missing or too large.' };
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_MAGIC)) return { ok: false, error: 'the signature is not a PNG picture.' };
    const tmp = SIGNATURE_FILE + '.tmp';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, SIGNATURE_FILE);
    return { ok: true };
  });
  handle('signature:forget', () => { fs.rmSync(SIGNATURE_FILE, { force: true }); return { ok: true }; });

  function pdfBuffer(bytes: unknown) {
    if (!ArrayBuffer.isView(bytes) || bytes.byteLength > MAX_PDF_BYTES) throw new Error('the PDF is missing or larger than 100 MB, so nothing was written.');
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (buf.length < 8 || buf.toString('latin1', 0, 5) !== '%PDF-') throw new Error('the PDF came back damaged, so nothing was written.');
    return buf;
  }
  const stillAsOpened = (file: string, expectedMtime: number | null) => fs.existsSync(file) && mtimeOf(file) === expectedMtime;
  const CHANGED_ON_DISK = 'The PDF changed on disk since you opened it. Reload it, then try again.';

  async function rewritePdf(id: string, expectedMtime: number | null, build: (current: Buffer) => unknown): Promise<Ok<{ mtime: number | null; backup: string }>> {
    const file = fileNoteOfKind(id, 'pdf').filePath;
    if (!stillAsOpened(file, expectedMtime)) return { ok: false, error: CHANGED_ON_DISK };
    try {
      const buf = pdfBuffer(await build(fs.readFileSync(file)));
      if (!stillAsOpened(file, expectedMtime)) return { ok: false, error: CHANGED_ON_DISK };
      const { mtime, backup } = replaceFile(id, file, buf);
      return { ok: true, mtime, backup: backup.name };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  async function pdfLibTask(bytes: Uint8Array, task: string, extra: object, what: string) {
    const res = await runWorker<{ bytes?: Uint8Array }>('pdf-edit-worker.mts', Object.assign({ bytes, task }, extra), 2 * 60 * 1000, what + ' took too long.');
    if (!res.ok) throw new Error(res.error);
    return res.bytes;
  }

  handle('files:pdfApplyPages', (_e, id, bytes, rotations, expectedMtime) => {
    if (!Array.isArray(rotations) || !rotations.length || rotations.some((r) => ![0, 90, 180, 270].includes(r))) return { ok: false, error: 'the page turns were not valid.' };
    return rewritePdf(id, expectedMtime, async (current) => {
      if (bytes !== null) await pdfLibTask(current, 'check', {}, 'Reading the PDF');
      const buf = bytes === null ? current : pdfBuffer(bytes);
      return rotations.some((r) => r) ? pdfLibTask(buf, 'rotate', { rotations }, 'Turning the pages') : buf;
    });
  });
  function commentAuthor() {
    try { return os.userInfo().username || ''; } catch (_) { return ''; }
  }
  handle('files:pdfComments', (_e, id, ops, expectedMtime) => {
    if (!Array.isArray(ops) || !ops.length || ops.length > 100) return { ok: false, error: 'that comment change was not valid.' };
    return rewritePdf(id, expectedMtime, (current) => pdfLibTask(current, 'comments', { ops, author: commentAuthor() }, 'Saving the comment'));
  });
  handle('files:pdfRestore', (_e, id, name, expectedMtime) => {
    const file = fileNoteOfKind(id, 'pdf').filePath;
    const dir = backupDirFor(file);
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch (_) {  }
    if (typeof name !== 'string' || !names.includes(name)) return { ok: false, error: 'that backup is gone.' };
    if (!stillAsOpened(file, expectedMtime)) return { ok: false, error: 'the PDF was saved again after that change, so undoing it would lose what was saved. Its earlier versions are in the backups folder.' };
    try {
      return Object.assign({ ok: true }, { mtime: replaceFile(id, file, pdfBuffer(fs.readFileSync(path.join(dir, name)))).mtime });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle('files:pdfPickPages', async () => {
    const { canceled, filePaths } = await openDialog({ title: 'Add pages from a PDF', properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };
    const file = filePaths[0];
    if (fs.statSync(file).size > MAX_PDF_BYTES) return { ok: false, error: 'that PDF is larger than 100 MB.' };
    return { ok: true, name: path.basename(file), bytes: fs.readFileSync(file) };
  });
  const docxBases = new Map();
  const KEEP_DOCX_BASES = 4;
  function rememberDocx(id: string, buf: Buffer, mtime?: number | null) {
    docxBases.delete(id);
    docxBases.set(id, { buf, mtime });
    while (docxBases.size > KEEP_DOCX_BASES) docxBases.delete(docxBases.keys().next().value);
  }
  handle('files:docxBytes', async (_e, id) => {
    const started = performance.now();
    const file = fileNoteOfKind(id, 'docx').filePath;
    const mtime = mtimeOf(file);
    const buf = await readDocumentBuffer(file);
    rememberDocx(id, buf, mtime);
    trace.write('read-bytes', { id, kind: 'docx', bytes: buf.length, ms: H.msSince(started) });
    return buf;
  });
  handle('files:documentBytes', async (_e, id) => {
    const started = performance.now();
    const buf = await readDocumentBuffer(fileNoteOfKind(id, 'sheet').filePath);
    trace.write('read-bytes', { id, kind: 'sheet', bytes: buf.length, ms: H.msSince(started) });
    return buf;
  });
  const CRAFT_SAVES = {
    docx: { app: 'WordCraft', own: new Set([...H.OOXML_EXT, 'odt', 'rtf']), to: 'docx', from: H.WORD_TO_DOCX_EXT, exports: ['pdf', 'docx', 'odt', 'rtf', 'txt', 'md', 'html', 'png'] },
    sheet: { app: 'GridCraft', own: new Set(['xlsx']), to: 'xlsx', from: H.SHEET_TO_XLSX_EXT, exports: ['pdf', 'csv', 'tsv', 'json', 'html'] },
  };
  const checkable = (ext: string) => H.ZIP_DOC_EXT.has(ext) || ext === 'rtf';
  const looksLike = (ext: string, buf: Buffer) => {
    if (H.ZIP_DOC_EXT.has(ext)) return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
    if (ext === 'rtf') return buf.slice(0, 5).toString('latin1') === '{\\rtf';
    return false;
  };
  const assertLooksLike = (ext: string, buf: Buffer) => { if (checkable(ext) && !looksLike(ext, buf)) throw new Error('that is not a .' + ext + ' file, so nothing was written.'); };
  const sideCopies = new Map();
  function sideCopy(id: string, dir: string, stem: string, ext: string, app: string, buf: Buffer) {
    const prev = sideCopies.get(id);
    if (prev && fs.existsSync(prev)) { fs.writeFileSync(prev, buf); return prev; }
    const file = convert.writeNew(dir, stem + ' (from ' + app + ')', ext, buf);
    sideCopies.set(id, file);
    return file;
  }
  handle('files:saveCraft', async (_e, id, bytes, name, expectedMtime) => {
    const n = store.get(id);
    if (!isFileNote(n) || (n.fileKind !== 'docx' && n.fileKind !== 'sheet')) throw new Error('Not a document a Craft app edits.');
    const rules = CRAFT_SAVES[n.fileKind];
    if (!ArrayBuffer.isView(bytes) || !bytes.byteLength || bytes.byteLength > MAX_PDF_BYTES) throw new Error('the document is missing or larger than 100 MB, so nothing was written.');
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const own = H.extOf(n.filePath);
    const given = path.basename(String(name || ''));
    const ext = path.extname(given).slice(1).toLowerCase();
    const stem = path.basename(n.filePath, path.extname(n.filePath));
    const dir = path.dirname(n.filePath);
    if (given.toLowerCase() === path.basename(n.filePath).toLowerCase()) {
      assertLooksLike(own, buf);
      if (!rules.own.has(own)) return { exported: sideCopy(id, dir, stem, own, rules.app, buf), own: true };
      const started = performance.now();
      const saved = saveEdits(id, n.filePath, buf, expectedMtime);
      if (n.fileKind === 'docx') rememberDocx(id, buf, saved.savedAs ? expectedMtime : saved.mtime);
      trace.write('save-write', { id, kind: n.fileKind, bytes: buf.length, ms: H.msSince(started), savedAs: !!saved.savedAs });
      if (!saved.savedAs) {
        const reread = performance.now();
        store.fillFileText(id).then(() => trace.write('text-reread', { id, kind: n.fileKind, ms: H.msSince(reread) }));
      }
      return saved;
    }
    if (rules.to && rules.from.has(own) && given.toLowerCase() === (stem + '.' + rules.to).toLowerCase()) {
      assertLooksLike(rules.to, buf);
      const file = convert.writeNew(dir, stem, rules.to, buf);
      let body;
      if (n.fileKind === 'docx') { try { body = (await readNoteText('docx', file)).body; } catch (_) { body = undefined; } }
      const moved = store.relinkFileNote(id, file, body);
      if (!moved) throw new Error('Note not found');
      if (n.fileKind !== 'docx') store.fillFileText(id);
      conflictCopies.delete(id);
      sideCopies.delete(id);
      if (n.fileKind === 'docx') rememberDocx(id, buf, moved.fileMtime);
      return { relinked: file, mtime: moved.fileMtime };
    }
    if (!rules.exports.includes(ext)) throw new Error('Notes does not save .' + (ext || 'extensionless') + ' files from ' + rules.app + '.');
    assertLooksLike(ext, buf);
    const base = H.safeFilename(path.basename(given, path.extname(given))) || stem;
    return { exported: convert.writeNew(dir, base, ext, buf) };
  });

  handle('files:imageBytes', (_e, id) => {
    const { bytes, mime } = readImage(fileNoteOfKind(id, 'image').filePath);
    return { bytes, mime };
  });
  const MAX_DOCX_PATCH_CHARS = 50 * 1024 * 1024;
  handle('files:saveDocx', async (_e, id, patches, expectedMtime) => {
    const file = fileNoteOfKind(id, 'docx').filePath;
    const base = docxBases.get(id);
    if (!base || base.mtime !== expectedMtime) throw new Error('the document shown here is not the version Notes last read. Reload it, then make the change again.');
    if (!Array.isArray(patches) || !patches.length || patches.reduce((n, p) => n + String((p && p.xml) || '').length + String((p && p.old) || '').length, 0) > MAX_DOCX_PATCH_CHARS) throw new Error('the changes could not be read, so nothing was written.');
    const res = await runWorker<{ bytes: Uint8Array }>('docx-edit-worker.mts', { bytes: base.buf, patches }, 2 * 60 * 1000, 'Saving the document took too long.');
    if (!res.ok) throw new Error(res.error);
    const buf = Buffer.from(res.bytes);
    const saved = saveEdits(id, file, buf, expectedMtime);
    rememberDocx(id, buf, saved.savedAs ? expectedMtime : saved.mtime);
    return saved;
  });

  handle('agentFiles:discover', () => discoverAgentFiles());
  handle('agentFiles:link', async () => {
    const folder = store.ensureFolder('Agent files', null);
    const found = discoverAgentFiles();
    const res = await linkPaths(found.map((f) => f.filePath), { folderId: folder.id });
    for (const f of found) {
      const n = store.findByPath(f.filePath);
      if (!n) continue;
      const base = path.basename(f.filePath);
      const autoTitled = n.title === base || n.title.startsWith(base + ' — ');
      const patch: { tags: string[], title?: string, folderId?: string } = { tags: Array.from(new Set((n.tags || []).concat(['agent']))) };
      if (autoTitled) patch.title = f.label;
      if (!n.folderId) patch.folderId = folder.id;
      store.update(n.id, patch);
    }
    return Object.assign(res, { folderId: folder.id, found: found.length });
  });

  const vaultView = (v: Vault) => Object.assign({}, v, { status: vaults.statusOf(v.id), rootFolderId: (store.vaultRootFolder(v.id) || {}).id || null });
  handle('vaults:list', () => store.vaults.filter((v) => !v.home).map(vaultView));
  handle('vaults:pickFolder', async () => {
    const { canceled, filePaths } = await openDialog({ title: 'Choose a folder to use as a vault', properties: ['openDirectory', 'createDirectory'] });
    return canceled || !filePaths.length ? null : filePaths[0];
  });
  handle('vaults:add', async (_e, data) => {
    const v = store.addVault(data);
    await vaults.open(v.id, { pull: true });
    return vaultView(v);
  });
  handle('vaults:clone', async (_e, url, parentDir, name) => {
    const safe = String(name || path.basename(String(url).replace(/\.git$/, '').replace(/[\\/]+$/, '')) || 'vault').replace(/[<>:"/\\|?*]/g, '-');
    const dest = path.join(parentDir, safe);
    if (fs.existsSync(dest)) return { ok: false, error: 'A folder named "' + safe + '" already exists there.' };
    const r = await VaultManager.clone(url, dest);
    if (!r.ok) return { ok: false, error: r.error || 'The clone failed.' };
    let v;
    try { v = store.addVault({ path: dest, name: safe, remote: url }); }
    catch (err) { try { fs.rmSync(dest, { recursive: true, force: true }); } catch (_) {  } return { ok: false, error: err.message }; }
    await vaults.initRepo(v.id, url);
    await vaults.open(v.id, { pull: false });
    return { ok: true, vault: vaultView(v) };
  });
  handle('vaults:update', async (_e, id, patch) => {
    patch = Object.assign({}, patch || {});
    if (patch.remote !== undefined) {
      patch.remote = String(patch.remote || '').trim();
      if (/^-/.test(patch.remote)) return { ok: false, error: 'That does not look like a repository URL.' };
    }
    const v = store.updateVault(id, patch);
    if (v) { vaults.schedulePull(id); if (patch.remote !== undefined) await vaults.initRepo(id, patch.remote); }
    return v ? vaultView(v) : null;
  });
  handle('vaults:remove', (_e, id) => { vaults.close(id); const r = store.removeVault(id); closeOrphanStickies(); fanReloaded({ reason: 'vault' }); return r; });
  function closeOrphanStickies() { for (const sid of stickies.openIds()) if (!store.get(sid)) stickies.close(sid); }
  handle('vaults:sync', (_e, id) => vaults.sync(id, 'manual'));
  handle('vaults:scan', async (_e, id) => { const r = await store.scanVault(id); closeOrphanStickies(); if (r && (r.added || r.updated || r.removed)) fanReloaded({ reason: 'vault' }); return r; });
  handle('vaults:initRepo', (_e, id, remote) => vaults.initRepo(id, remote));
  handle('vaults:status', async (_e, id) => vaults.refreshRepoStatus(id));
  handle('vaults:openFolder', (_e, id) => { const v = store.getVault(id); return v ? shell.openPath(v.path) : 'No vault'; });

  let botChild: ChildProcess | null = null;
  let botStarting = false;

  function findClaude() {
    return claudeBin.resolveClaude({ override: process.env.NOTES_APP_CLAUDE_BIN || null });
  }

  function botCwdFor(noteId?: string | null): { cwd: string; kind: 'vault' | 'file'; focus: string | null; vaultId: string | null } {
    const note = noteId ? store.get(noteId) : null;
    if (note && note.vaultId && note.filePath) { const v = store.getVault(note.vaultId); if (v) return { cwd: v.path, kind: 'vault', focus: path.relative(v.path, note.filePath), vaultId: v.id }; }
    if (note && note.filePath) return { cwd: path.dirname(note.filePath), kind: 'file', focus: path.basename(note.filePath), vaultId: null };
    const home = store.homeVault();
    if (!home) throw new Error('the notes folder is not set up' + (filesMove.error ? ': ' + filesMove.error : ''));
    return { cwd: home.path, kind: 'vault', focus: null, vaultId: home.id };
  }

  function cleanEnv() {
    const env = Object.assign({}, process.env);
    for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|SESSION_ID|SESSION_ATTENDED|CHILD_SESSION|MESSAGING_SOCKET|MESSAGING_TOKEN))$/i.test(k)) delete env[k];
    return claudeBin.subscriptionEnv(env);
  }

  let authOkUntil = 0, authPlan: string | null = null;
  async function ensureSubscription(spec: Parameters<typeof claudeBin.launchSpec>[0]) {
    if (Date.now() < authOkUntil) return { ok: true, plan: authPlan };
    const launch = claudeBin.launchSpec(spec, ['auth', 'status']);
    const text = await new Promise((resolve) => {
      execFile(launch.file, launch.args, { windowsHide: true, timeout: 20000, env: Object.assign(cleanEnv(), launch.env) }, (_err, stdout) => resolve(String(stdout || '')));
    });
    const r = claudeBin.checkSubscriptionAuth(text);
    if (r.ok) { authOkUntil = Date.now() + 60 * 1000; authPlan = r.plan; }
    return r;
  }

  function botSend(type: string, data?: object) {
    if (win && !win.isDestroyed()) win.webContents.send('bot:event', Object.assign({ type }, data || {}));
  }

  function killTree(child: ChildProcess | null) {
    if (!child || child.exitCode !== null) return;
    if (process.platform === 'win32') {
      try { execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch (_) {  }
    } else {
      try { child.kill('SIGTERM'); } catch (_) {  }
    }
  }

  handle('bot:run', async (_e, opts) => {
    opts = opts || {};
    if (botChild || botStarting) return { ok: false, error: 'A run is already in progress.' };
    const prompt = String(opts.prompt || '').trim();
    if (!prompt) return { ok: false, error: 'Type what you want done.' };
    const spec = findClaude();
    if (!spec) return { ok: false, error: 'Claude Code was not found. Install it (npm i -g @anthropic-ai/claude-code, or the native installer) and make sure "claude" is on your PATH.' };
    botStarting = true;
    let auth;
    try { auth = await ensureSubscription(spec); } finally { botStarting = false; }
    if (!auth.ok) return { ok: false, error: auth.reason };
    let target;
    try { target = botCwdFor(opts.noteId); } catch (err) { return { ok: false, error: 'Could not find the folder to work in: ' + err.message }; }
    const intro = 'You are working inside the user\'s notes folder. Each Markdown file is a note. Files ending in .mdlock are encrypted notes: never open or change them. Leave the .trash folder alone.';
    const focusLine = target.focus ? ' The user is currently looking at "' + target.focus + '".' : '';
    const fullPrompt = intro + focusLine + '\n\nTask: ' + prompt;
    const allowed = opts.allowEdits === false ? 'Read,Glob,Grep' : 'Read,Glob,Grep,Edit,Write,MultiEdit';
    const args = ['-p', fullPrompt, '--output-format', 'text', '--permission-mode', 'dontAsk', '--allowedTools', allowed];
    const launch = claudeBin.launchSpec(spec, args);
    botSend('start', { cwd: target.cwd, kind: target.kind, focus: target.focus, plan: auth.plan });
    let child;
    try {
      child = spawn(launch.file, launch.args, { cwd: target.cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign(cleanEnv(), { CLAUDE_CODE_NONINTERACTIVE: '1' }, launch.env) });
    } catch (err) {
      botSend('end', { ok: false, error: err.message });
      return { ok: false, error: err.message };
    }
    botChild = child;
    let ended = false;
    const end = (data: object) => { if (ended) return; ended = true; if (botChild === child) botChild = null; botSend('end', data); };
    const outDec = new StringDecoder('utf8'), errDec = new StringDecoder('utf8');
    child.stdout.on('data', (d) => { const t = outDec.write(d); if (t) botSend('out', { text: t }); });
    child.stderr.on('data', (d) => { const t = errDec.write(d); if (t) botSend('err', { text: t }); });
    child.on('error', (err) => end({ ok: false, error: 'Could not start "' + launch.file + '": ' + err.message }));
    child.on('close', async (code) => {
      if (ended) return;
      const vaultId = target.vaultId;
      if (vaultId) {
        try { const r = await store.scanVault(vaultId); if (r && (r.added || r.updated || r.removed)) botSend('reloaded', r); } catch (_) {  }
        vaults.noteChanged(vaultId);
      }
      if (store.settings.gitEnabled) git.noteChanged();
      end({ ok: code === 0, code });
      fanReloaded({ reason: 'bot' });
    });
    return { ok: true, cwd: target.cwd, kind: target.kind };
  });
  handle('bot:cancel', () => { if (botChild) { killTree(botChild); return true; } return false; });
  handle('bot:openTerminal', async (_e, noteId) => {
    if (botChild || botStarting) return { ok: false, error: 'A run is in progress; wait for it to finish (or stop it) first.' };
    let target;
    try { target = botCwdFor(noteId); } catch (err) { return { ok: false, error: err.message }; }
    const spec = findClaude();
    if (!spec) return { ok: false, error: 'Claude Code was not found on this machine.' };
    botStarting = true;
    let auth;
    try { auth = await ensureSubscription(spec); } finally { botStarting = false; }
    if (!auth.ok) return { ok: false, error: auth.reason };
    try {
      const here = (s: string) => "@'\n" + String(s).replace(/\r?\n/g, '') + "\n'@";
      const lines = ['$ErrorActionPreference = \'Continue\'', 'Set-Location -LiteralPath ' + here(target.cwd)];
      for (const v of claudeBin.API_BILLING_VARS) lines.push('Remove-Item -LiteralPath Env:' + v + ' -ErrorAction SilentlyContinue');
      if (spec.isScript) lines.push('$notesNode = ' + here(claudeBin.resolveNode() || 'node'), '$notesCli = ' + here(spec.file), '& $notesNode $notesCli');
      else lines.push('$notesClaude = ' + here(spec.file), '& $notesClaude');
      const script = path.join(DATA_DIR, 'bot-terminal.ps1');
      fs.writeFileSync(script, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
      if (process.env.NOTES_APP_DRY_TERMINAL) return { ok: true, cwd: target.cwd, kind: target.kind, script };
      const psArgs = ['-NoExit', '-ExecutionPolicy', 'Bypass', '-File', script];
      const hasWt = (() => { try { execFileSync('where', ['wt'], { stdio: 'ignore', windowsHide: true }); return true; } catch (_) { return false; } })();
      if (hasWt) spawn('wt', ['powershell'].concat(psArgs), { detached: true, stdio: 'ignore', windowsHide: false, env: cleanEnv() }).unref();
      else spawn('powershell', psArgs, { detached: true, stdio: 'ignore', windowsHide: false, shell: false, env: cleanEnv() }).unref();
      return { ok: true, cwd: target.cwd, kind: target.kind };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('folders:tree', () => store.folderTree());
  handle('folders:path', (_e, id) => store.folderPath(id));
  handle('folders:create', (_e, data) => store.createFolder(data));
  handle('folders:rename', (_e, id, name) => store.renameFolder(id, name));
  handle('folders:move', (_e, id, parentId) => store.moveFolder(id, parentId));
  handle('folders:delete', (_e, id) => store.deleteFolder(id));

  handle('settings:get', () => store.getSettings());
  handle('settings:set', async (_e, patch) => {
    patch = patch || {};
    const before = store.getSettings();
    let error: string | undefined | null = null;
    if (typeof patch.hotkey === 'string' && patch.hotkey !== before.hotkey) {
      const parsed = H.parseAccelerator(patch.hotkey);
      if (!parsed.ok) { error = parsed.reason; delete patch.hotkey; }
      else {
        const result = registerHotkey(parsed.value);
        if (!result.registered || result.fallback) {
          error = 'Could not bind ' + H.displayAccelerator(parsed.value) + '. Another app may own it.';
          registerHotkey(before.hotkey);
          delete patch.hotkey;
        } else patch.hotkey = parsed.value;
      }
    }
    let settings;
    try {
      settings = store.setSettings(patch);
    } catch (err) {
      if (patch.hotkey && patch.hotkey !== before.hotkey) registerHotkey(before.hotkey);
      throw err;
    }
    const schemeChanged = settings.colorScheme !== before.colorScheme || JSON.stringify(settings.customColors) !== JSON.stringify(before.customColors);
    if (settings.theme !== before.theme || schemeChanged) applyTheme();
    if (settings.alwaysOnTop !== before.alwaysOnTop && win) win.setAlwaysOnTop(settings.alwaysOnTop);
    if (settings.openAtLogin !== before.openAtLogin) applyLoginItem();
    if (settings.gitEnabled !== before.gitEnabled || settings.gitRemote !== before.gitRemote) {
      await git.configure(settings);
      if (settings.gitEnabled) git.noteChanged();
    }
    refreshTray();
    stickies.broadcast('settings:changed', settings);
    return { settings, info: info(), error };
  });

  handle('git:status', () => git.status());
  handle('git:commit', () => git.commit('manual commit'));
  handle('git:push', () => git.push());
  handle('git:history', (_e, limit) => git.history(limit));

  handle('app:dictate', async () => {
    if (process.platform !== 'win32') return { ok: false, error: 'Dictation is only wired up for Windows here.' };
    if (process.env.NOTES_APP_DRY_DICTATE === '1') return { ok: true, method: 'windows-dictation', dryRun: true };
    try {
      if (win && !win.isDestroyed()) { win.show(); win.focus(); app.focus({ steal: true }); }
      await new Promise((r) => setTimeout(r, 150));
      const script = [
        "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class K { [DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }'",
        '[K]::keybd_event(0x5B,0,0,[UIntPtr]::Zero); [K]::keybd_event(0x48,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [K]::keybd_event(0x48,0,2,[UIntPtr]::Zero); [K]::keybd_event(0x5B,0,2,[UIntPtr]::Zero)',
      ].join('; ');
      await new Promise((resolve, reject) => {
        execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 10000 }, (err) => (err ? reject(err) : resolve(undefined)));
      });
      return { ok: true, method: 'windows-dictation' };
    } catch (err) {
      return { ok: false, error: 'Could not open Windows dictation: ' + (err.message || err) + '. Press Win+H manually.' };
    }
  });

  handle('app:info', () => info());
  handle('app:hide', () => hideWindow());
  handle('app:titleBar', (e, colors) => {
    const ok = (c: string) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
    if (!win || win.isDestroyed() || e.sender !== win.webContents || !colors || !ok(colors.color) || !ok(colors.symbol)) return false;
    try { win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbol, height: TITLE_BAR_H }); return true; } catch (_) { return false; }
  });
  handle('app:print', (e) => new Promise((resolve) => {
    if (process.env.NOTES_APP_DRY_PRINT === '1') return resolve({ ok: true, dry: true });
    try { e.sender.print({ printBackground: true }, (ok, reason) => resolve({ ok, error: ok ? null : (reason || 'print failed') })); }
    catch (err) { resolve({ ok: false, error: err.message }); }
  }));
  let rendererReady = false;
  let pendingNewNote = false;
  handle('app:rendererReady', () => {
    rendererReady = true;
    if (!win || win.isDestroyed()) return { visible: false };
    const visible = win.isVisible();
    if (reloadedSinceStart) { win.webContents.send('settings:changed', store.getSettings()); win.webContents.send('notes:reloaded', { reason: 'recovered' }); }
    if (visible) win.webContents.send('app:shown');
    if (pendingNewNote) { pendingNewNote = false; win.webContents.send('app:new-note'); }
    if (pendingOpenNote) { win.webContents.send('app:open-note', pendingOpenNote); pendingOpenNote = null; }
    return { visible };
  });
  function requestNewNote() {
    const w = showWindow();
    if (rendererReady) w.webContents.send('app:new-note'); else pendingNewNote = true;
  }
  handle('app:openDataFolder', () => shell.openPath(DATA_DIR));
  handle('app:openExternal', (_e, url) => { if (/^https?:/i.test(url)) shell.openExternal(url); });

  handle('app:exportNote', async (_e, id) => {
    const out = store.exportNote(id);
    if (!out) return { ok: false };
    const { canceled, filePath } = await saveDialog({
      title: 'Export note as Markdown',
      defaultPath: path.join(app.getPath('documents'), out.filename),
      filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, out.content, 'utf8');
    return { ok: true, filePath };
  });

  handle('app:copy', async (_e, data) => {
    const d = data || {};
    const text = String(d.text || '');
    if (!d.html) { await clipboard.writeText(text); return true; }
    const item = new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([String(d.html)], { type: 'text/html' }) });
    await clipboard.write([item]);
    return true;
  });
  handle('app:emailNote', async (_e, id) => {
    const note = store.publicNote(store.get(id));
    if (!note) return { ok: false, error: 'Note not found' };
    if (note.locked && !note.unlocked) return { ok: false, error: 'Unlock the note first.' };
    const m = H.mailtoFor(note);
    try { await shell.openExternal(m.url); } catch (err) { return { ok: false, error: 'No mail app could open the message: ' + err.message }; }
    return { ok: true, truncated: m.truncated };
  });
  handle('app:pdfPath', async (_e, id) => {
    const note = store.publicNote(store.get(id));
    if (!note) return { ok: false, error: 'Note not found' };
    const { canceled, filePath } = await saveDialog({
      title: 'Save as PDF',
      defaultPath: path.join(app.getPath('documents'), H.safeFilename(H.deriveTitle(note)) + '.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    return { ok: true, filePath };
  });
  handle('app:writePdf', async (e, filePath) => {
    if (typeof filePath !== 'string' || !/\.pdf$/i.test(filePath)) return { ok: false, error: 'Not a PDF path' };
    try {
      const data = await e.sender.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } });
      fs.writeFileSync(filePath, data);
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  handle('app:exportHtml', async (_e, id, bodyHtml) => {
    const note = store.get(id);
    if (!note) return { ok: false, error: 'Note not found' };
    const title = H.deriveTitle(note) || 'Note';
    const { canceled, filePath } = await saveDialog({
      title: 'Save as HTML',
      defaultPath: path.join(app.getPath('documents'), H.safeFilename(title) + '.html'),
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, convert.htmlDocument(title, (note.title ? '<h1>' + convert.escHtml(note.title) + '</h1>\n' : '') + String(bodyHtml || '')), 'utf8');
    return { ok: true, filePath };
  });

  const BOOK_CSS = '.book-toc{border:2px solid #2a1a12;border-radius:10px;padding:10px 18px;margin:0 0 32px}.book-toc h2{margin:.2em 0 .4em;font-size:1.1em}.book-page{margin-bottom:40px}.book-page>h2{border-bottom:2px dashed #c9b8a8;padding-bottom:6px}@media print{body{background:#fff;margin:0;max-width:none}.book-page{break-before:page}.book-page:first-of-type{break-before:auto}}';
  async function withHiddenPage<T>(doc: string, opts: HiddenPageOptions, fn: (w: BrowserWindow) => Promise<T>) {
    const tmp = path.join(app.getPath('temp'), 'notes-page-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.html');
    let w: BrowserWindow | null = null, contentsId: number | null = null;
    let timer: NodeJS.Timeout | undefined;
    try {
      fs.writeFileSync(tmp, doc, 'utf8');
      const webPreferences: Electron.WebPreferences = { javascript: !!opts.javascript, sandbox: true, contextIsolation: true };
      if (opts.isolated) webPreferences.session = isolatedSession();
      w = new BrowserWindow({ show: false, parent: win || undefined, webPreferences });
      contentsId = w.webContents.id;
      if (opts.isolated) {
        isolatedAccess.set(contentsId, { page: tmp, files: opts.allowFiles || [], dir: opts.readDir || null });
        w.webContents.on('will-navigate', (e) => e.preventDefault());
        w.webContents.on('will-frame-navigate', (e) => { if (e.isMainFrame && e.url !== pathToFileURL(tmp).href) e.preventDefault(); });
        w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      }
      const work = (async () => { await w.loadFile(tmp); return fn(w); })();
      if (!opts.timeoutMs) return await work;
      const timeout = (new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('the page took too long to render')), opts.timeoutMs); }) as Promise<never>);
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
      isolatedAccess.delete(contentsId);
      if (w && !w.isDestroyed()) w.destroy();
      try { fs.unlinkSync(tmp); } catch (_) {  }
    }
  }
  const isolatedAccess = new Map();
  let convertSession: Electron.Session | null = null;
  function isolatedSession() {
    if (!convertSession) {
      convertSession = session.fromPartition('notes-isolated-pages');
      convertSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !isolatedRequestAllowed(d) }));
    }
    return convertSession;
  }
  function isolatedRequestAllowed(d: Electron.OnBeforeRequestListenerDetails) {
    if (/^data:/i.test(d.url)) return true;
    const access = isolatedAccess.get(d.webContentsId);
    if (!access || !/^file:\/\/\//i.test(d.url)) return false;
    let file;
    try { file = fileURLToPath(d.url); } catch (_) { return false; }
    const same = (a: string) => path.resolve(a).toLowerCase() === path.resolve(file).toLowerCase();
    if (same(access.page) || access.files.some(same)) return true;
    return ['image', 'stylesheet', 'font', 'media'].includes(d.resourceType) && !!access.dir && convert.isInside(file, access.dir);
  }
  const RENDER_TIMEOUT_MS = 2 * 60 * 1000;
  const PDF_OPTIONS: Electron.PrintToPDFOptions = { printBackground: true, pageSize: 'A4', margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } };
  const ISOLATED_CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src file: data:; style-src \'unsafe-inline\' file:; font-src file: data:; media-src file: data:">';
  function withBase(doc: string, baseDir: string) {
    const head = ISOLATED_CSP + '<meta http-equiv="x-dns-prefetch-control" content="off"><base href="' + convert.escHtml(pathToFileURL(baseDir + path.sep).href) + '">';
    if (/<head(\s[^>]*)?>/i.test(doc)) return doc.replace(/<head(\s[^>]*)?>/i, (m: string) => m + head);
    const lead = /^\s*(<!doctype[^>]*>)?\s*(<html(\s[^>]*)?>)?/i.exec(doc);
    const at = lead ? lead[0].length : 0;
    return doc.slice(0, at) + '<head>' + head + '</head>' + doc.slice(at);
  }

  const DOCX_BUNDLE_PATH = path.join(import.meta.dirname, 'renderer', 'vendor', 'docx.bundle.js');
  const DOCX_BUNDLE_URL = pathToFileURL(DOCX_BUNDLE_PATH).href;
  const DOCX_PRINT_PAGE = '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src file:; style-src \'unsafe-inline\'; img-src data:; font-src data:">'
    + '<style>html, body { margin: 0; background: #fff; }</style><script src="' + DOCX_BUNDLE_URL + '"></script></head><body></body></html>';
  function docxPrintScript(b64: string) {
    return '(async () => {'
      + 'const s = atob(' + JSON.stringify(b64) + '); const bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);'
      + 'await DocxView.renderAsync(bytes, document.body, document.head, { inWrapper: false, ignoreLastRenderedPageBreak: false, useBase64URL: true, renderAltChunks: false });'
      + 'const secs = [...document.querySelectorAll("section.docx")]; if (!secs.length) return { flowed: false };'
      + 'const st = secs[0].style; const W = st.width || "210mm", H = st.minHeight || "297mm";'
      + 'const probe = document.createElement("div"); probe.style.height = H; document.body.append(probe); const hPx = probe.offsetHeight; probe.remove();'
      + 'const fits = secs.every((x) => x.offsetHeight <= hPx + 1);'
      + 'const css = document.createElement("style");'
      + 'css.textContent = fits'
      + ' ? "@page { size: " + W + " " + H + "; margin: 0 } section.docx { margin: 0 !important; box-shadow: none !important; height: " + H + "; overflow: hidden; break-after: page } section.docx:last-of-type { break-after: auto }"'
      + ' : "@page { size: " + W + " " + H + "; margin: " + [st.paddingTop, st.paddingRight, st.paddingBottom, st.paddingLeft].map((v) => v || "1in").join(" ") + " } section.docx { margin: 0 !important; padding: 0 !important; width: auto !important; min-height: 0 !important; box-shadow: none !important; } section.docx > header, section.docx > footer { display: none !important }";'
      + 'document.head.append(css); return { flowed: !fits }; })()';
  }
  const printers = {
    html: (doc: string, baseDir: string) => withHiddenPage(withBase(doc, baseDir), { isolated: true, readDir: baseDir, timeoutMs: RENDER_TIMEOUT_MS }, (w) => w.webContents.printToPDF(PDF_OPTIONS)),
    docx: (bytes: Buffer) => withHiddenPage(DOCX_PRINT_PAGE, { isolated: true, javascript: true, allowFiles: [DOCX_BUNDLE_PATH], timeoutMs: RENDER_TIMEOUT_MS }, async (w) => {
      const r = await w.webContents.executeJavaScript(docxPrintScript(bytes.toString('base64')));
      const pdf = await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      return { pdf, warning: r && r.flowed ? 'This document does not record where its pages break, so its headers and footers were left out.' : '' };
    }),
  };
  handle('files:convertOptions', (_e, id) => convert.options(store.get(id)));
  handle('files:asMarkdown', async (_e, id) => {
    const n = store.get(id);
    if (!isFileNote(n) || !convert.sourceOf(n)) return { ok: false, error: 'this kind of file has no text to show' };
    try { return { ok: true, markdown: convert.inlinePicturesOnly((await convert.toMarkdown(n)).markdown) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  handle('files:convert', async (_e, id, to) => {
    try { const r = await convert.convertFile(store.get(id), to, printers); return { ok: true, filePath: r.filePath, warning: r.warning }; }
    catch (err) { return { ok: false, error: err.message }; }
  });

  handle('book:export', async (_e, format, data) => {
    data = data || {};
    const name = String(data.name || 'Book');
    const doc = () => convert.htmlDocument(name, String(data.html || ''), BOOK_CSS);
    try {
      if (format === 'print') {
        if (process.env.NOTES_APP_DRY_PRINT) return { ok: true, dry: true };
        return await withHiddenPage(doc(), {}, (w) => new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ ok: false, error: 'the print dialog did not answer' }), 10 * 60 * 1000);
          w.webContents.print({ printBackground: true }, (ok, reason) => { clearTimeout(timer); resolve(ok ? { ok: true } : { ok: false, canceled: reason === 'cancelled', error: reason }); });
        }));
      }
      const ext = { md: 'md', html: 'html', pdf: 'pdf' }[format];
      if (!ext) return { ok: false, error: 'Unknown format' };
      const { canceled, filePath } = await saveDialog({
        title: data.dialogTitle ? String(data.dialogTitle).slice(0, 100) : 'Export book',
        defaultPath: path.join(app.getPath('documents'), H.safeFilename(name) + '.' + ext),
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (canceled || !filePath) return { ok: false, canceled: true };
      if (format === 'md') fs.writeFileSync(filePath, String(data.markdown || ''), 'utf8');
      else if (format === 'html') fs.writeFileSync(filePath, doc(), 'utf8');
      else {
        const pdf = await withHiddenPage(doc(), {}, (w) => w.webContents.printToPDF(PDF_OPTIONS));
        fs.writeFileSync(filePath, pdf);
      }
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('app:exportAll', async () => {
    const { canceled, filePath } = await saveDialog({
      title: 'Export all notes',
      defaultPath: path.join(app.getPath('documents'), 'notes-export-' + new Date().toISOString().slice(0, 10) + '.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, store.exportAll(), 'utf8');
    return { ok: true, filePath };
  });

  handle('history:versions', async (_e, id, limit): Promise<HistoryVersions> => {
    const note = store.get(id);
    if (!note) return { ok: false, error: 'Note not found' };
    if (note.lock) return { ok: false, error: 'History is not shown for locked notes.' };
    if (!store.settings.gitEnabled) return { ok: false, error: 'History is off. Turn on "Keep every change in a git history in the data folder" in Settings › History.' };
    const max = Math.min(200, Math.max(1, limit || 80));
    const found: HistoryVersion[] = [];
    const home = store.homeVault();
    const homeRel = home && isFileNote(note) && store.isHome(note.vaultId) ? path.relative(home.path, note.filePath).split(path.sep).join('/') : null;
    const files = homeRel ? await git.fileHistory(homeRel, max) : store.isTextOutsideHome(note) ? await git.linkedHistory(note.id, max) : [];
    let followed = true;
    await git.eachFileAt(files, (i, text) => {
      if (text === null || !followed) return;
      const body = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
      if (homeRel && i > 0 && files[i].path !== files[i - 1].path && !body.trim()) { followed = false; return; }
      found.push({ hash: files[i].hash, at: files[i].at, title: '', body, chars: body.length });
    });
    const snapshots = await git.history(max, 'notes.json');
    await git.eachNotesAt(snapshots.map((c) => c.hash), (i, text) => {
      if (!text) return;
      let snap: { notes?: Note[] };
      try { snap = JSON.parse(text); } catch (_) { return; }
      const n = (snap.notes || []).find((x) => x.id === id);
      if (!n || typeof n.body !== 'string' || n.lock) return;
      found.push({ hash: snapshots[i].hash, at: snapshots[i].at, title: n.title || '', body: n.body, chars: n.body.length });
    });
    found.sort((a, b) => b.at - a.at);
    const versions = found.filter((v, i) => i === 0 || v.body !== found[i - 1].body).slice(0, max);
    return { ok: true, versions, current: note.body };
  });

  const ATTACH_DIR = path.join(DATA_DIR, 'attachments');
  const safeAttachmentName = (name: string) => {
    const s = String(name || '');
    const base = path.basename(s);
    if (!base || base !== s || /^\.+$/.test(base) || /[:\u0000-\u001f]/.test(base) || /[. ]$/.test(base)) return null;
    return base;
  };
  function addAttachment(srcPath: string) {
    fs.mkdirSync(ATTACH_DIR, { recursive: true });
    const ext = path.extname(srcPath);
    const stem = H.safeFilename(path.basename(srcPath, ext)) || 'file';
    let name = stem + ext, i = 2;
    while (fs.existsSync(path.join(ATTACH_DIR, name))) { name = stem + ' ' + i + ext; i++; }
    fs.copyFileSync(srcPath, path.join(ATTACH_DIR, name));
    return { name, href: 'attachment://' + encodeURIComponent(name), size: fs.statSync(path.join(ATTACH_DIR, name)).size };
  }
  handle('attachments:pick', async () => {
    const { canceled, filePaths } = await openDialog({ title: 'Attach files', properties: ['openFile', 'multiSelections'] });
    if (canceled || !filePaths.length) return [];
    return filePaths.map((p) => { try { return addAttachment(p); } catch (err) { return { error: err.message, name: path.basename(p) }; } });
  });
  handle('attachments:addPaths', (_e, paths) => (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string').map((p) => { try { return addAttachment(p); } catch (err) { return { error: err.message, name: path.basename(p) }; } }));
  handle('attachments:saveRecording', (_e, bytes, ext) => {
    fs.mkdirSync(ATTACH_DIR, { recursive: true });
    const clean = /^[a-z0-9]{1,5}$/i.test(String(ext)) ? String(ext).toLowerCase() : 'webm';
    const stamp = H.fileStamp().slice(0, 19);
    let name = 'Recording ' + stamp + '.' + clean;
    for (let i = 2; fs.existsSync(path.join(ATTACH_DIR, name)); i++) name = 'Recording ' + stamp + ' ' + i + '.' + clean;
    fs.writeFileSync(path.join(ATTACH_DIR, name), Buffer.from(bytes));
    return { name, href: 'attachment://' + encodeURIComponent(name), size: Buffer.from(bytes).length };
  });
  handle('attachments:open', async (_e, href) => {
    const raw = String(href || '').replace(/^attachment:\/\//i, '');
    let name;
    try { name = safeAttachmentName(decodeURIComponent(raw)); } catch (_) { name = null; }
    if (!name) return 'Not an attachment link';
    const full = path.join(ATTACH_DIR, name);
    if (path.dirname(full) !== ATTACH_DIR || !fs.existsSync(full)) return 'Attachment not found: ' + name;
    return openSafely(full);
  });
  handle('attachments:reveal', (_e, href) => {
    const raw = String(href || '').replace(/^attachment:\/\//i, '');
    let name; try { name = safeAttachmentName(decodeURIComponent(raw)); } catch (_) { name = null; }
    const full = name ? path.join(ATTACH_DIR, name) : null;
    if (full && fs.existsSync(full)) shell.showItemInFolder(full);
    return !!(full && fs.existsSync(full));
  });

  handle('app:importMarkdown', async () => {
    const { canceled, filePaths } = await openDialog({
      title: 'Import Markdown or text files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown / Text', extensions: ['md', 'markdown', 'txt'] }],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true, count: 0 };
    let first: Note | null = null;
    let count = 0;
    const failed: string[] = [];
    for (const fp of filePaths) {
      try {
        const note = store.importMarkdown(path.basename(fp), fs.readFileSync(fp, 'utf8'));
        count++;
        if (!first) first = note;
      } catch (err) {
        failed.push(path.basename(fp) + ' (' + (err.code || err.message) + ')');
      }
    }
    return { ok: count > 0, count, failed, firstId: first && first.id };
  });

  app.on('second-instance', () => showWindow());
  let quitPrepared = false;
  function flushStore() {
    try { store.flush(); } catch (err) { console.error('[store] flush failed', err); }
  }

  function flushWindow(w: BrowserWindow | null, ms: number) {
    return new Promise((resolve) => {
      if (!w || w.isDestroyed()) return resolve(undefined);
      const id = w.webContents.id;
      const done = (e: Electron.IpcMainEvent) => { if (e.sender.id === id) finish(); };
      const timer = setTimeout(finish, ms);
      function finish() { clearTimeout(timer); ipcMain.removeListener('app:flush-done', done); resolve(undefined); }
      ipcMain.on('app:flush-done', done);
      try { w.webContents.send('app:flush'); } catch (_) { finish(); }
    });
  }

  app.on('before-quit', (e) => {
    quitting = true;
    if (quitPrepared) return;
    quitPrepared = true;
    e.preventDefault();
    const rendererFlushed = Promise.all([flushWindow(win, 5000), stickies.flushAll((w: BrowserWindow) => flushWindow(w, 800))]);
    rendererFlushed
      .then(() => Promise.race([Promise.all([git.flush(), vaults.flushAll()].concat(Array.from(live.sessions.keys()).map((id) => live.flush(id)))), new Promise((r) => setTimeout(r, 8000))]))
      .catch(() => {})
      .finally(() => { flushStore(); searchIndex.stop(); reminders.stop(); if (botChild) killTree(botChild); for (const s of live.sessions.values()) { if (s.role === 'host') { try { s.server?.close(); } catch (_) {  } } } vaults.closeAll(); stickies.closeAll(); app.quit(); });
  });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); searchIndex.stop(); writeRuntime({ visible: false, exiting: true }); });
  app.on('window-all-closed', () => {  });
  app.on('activate', showWindow);

  nativeTheme.on('updated', () => {
    if (win && !win.isDestroyed()) {
      win.setBackgroundColor(windowColors().background);
      win.webContents.send('theme:system', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    }
    stickies.broadcast('settings:changed', store.getSettings());
  });

  app.whenReady().then(() => {
    const step = (name: string, fn: () => void) => { try { fn(); } catch (err) { console.error('[startup] ' + name + ' failed:', err); } };
    step('crafts', () => { craftsReady = crafts.serve(protocol, trace.write); });
    step('theme', applyTheme);
    step('window', createWindow);
    if (!win) step('window (defaults)', () => { store.setSettings({ window: null }); createWindow(); });
    step('tray', createTray);
    step('hotkey', () => registerHotkey(store.settings.hotkey));
    step('login item', applyLoginItem);
    git.configure(store.settings).then(() => { if (store.settings.gitEnabled) git.noteChanged(); }).catch(() => {});
    vaults.start().catch((err) => console.error('[vaults] start failed', err));
    if (!store.saveBlocked && process.env.NOTES_APP_NO_INDEX !== '1') step('search index', () => searchIndex.start());
    step('stickies', () => stickies.restoreAll());
    step('reminders', () => reminders.start());
    live.restore().catch((err) => console.error('[live] restore failed', err));
  });
}
