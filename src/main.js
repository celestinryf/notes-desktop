'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, dialog, shell, nativeTheme, screen, Notification, clipboard, ClipboardItem, session, protocol } = require('electron');
const { Store } = require('./store');
const { GitSync } = require('./gitSync');
const windowInput = require('./window-input');
const { VaultManager } = require('./vaults');
const { drawIconBitmap } = require('./icon');
const crypto = require('crypto');
const os = require('os');
const H = require('./shared/helpers');
const convert = require('./convert');
const { runWorker } = require('./run-worker');
const crafts = require('./craft-host');

const APP_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.NOTES_APP_DATA_DIR || path.join(app.getPath('appData'), 'notes-app');
const START_HIDDEN = process.argv.includes('--hidden') || process.env.NOTES_APP_START_HIDDEN === '1';
// Test harnesses set this so the window never takes keyboard focus away from whoever is using the machine.
const SHOW_INACTIVE = process.env.NOTES_APP_INACTIVE === '1';
const MANAGE_LOGIN_ITEM = process.env.NOTES_APP_NO_LOGIN_ITEM !== '1';
const HOTKEY_FALLBACKS = ['CommandOrControl+Alt+N', 'CommandOrControl+Shift+Alt+N', 'CommandOrControl+Alt+J', 'CommandOrControl+Alt+F12'];
const Themes = require('./shared/themes');
const TITLE_BAR_H = 40; // styles.css --bar-h

app.setName('Notes');
crafts.registerSchemes(protocol); // must happen before the app is ready
app.setAppUserModelId('com.celestinryf.notes');
app.setPath('userData', DATA_DIR);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  const store = new Store(DATA_DIR).load();
  const git = new GitSync(DATA_DIR, {
    debounceMs: Number(process.env.NOTES_APP_GIT_DEBOUNCE_MS) || 4000,
    onChange: (s) => { if (win && !win.isDestroyed()) win.webContents.send('git:status', s); },
  });
  // Commit only when notes or folders change, not on window moves or other settings writes.
  const contentHash = () => crypto.createHash('sha1').update(JSON.stringify({ n: store.notes, f: store.folders })).digest('hex');
  let lastContentHash = contentHash(); // eslint-disable-line prefer-const
  const originalSave = store.save.bind(store);
  store.save = () => {
    originalSave();
    const h = contentHash();
    if (h !== lastContentHash) { lastContentHash = h; git.noteChanged(); }
    return store;
  };
  let win = null;
  let tray = null;
  let quitting = false;
  let pendingOpenNote = null;
  const vaults = new VaultManager(store, {
    debounceMs: Number(process.env.NOTES_APP_VAULT_DEBOUNCE_MS) || 8000,
    onChange: (id, status) => { if (win && !win.isDestroyed()) win.webContents.send('vault:status', { id, status }); },
    onNotesChanged: () => { lastContentHash = contentHash(); fanReloaded({ reason: 'vault' }); },
  });
  const { ReminderScheduler } = require('./reminders');
  const reminders = new ReminderScheduler(store, {
    tickMs: Number(process.env.NOTES_APP_REMINDER_TICK_MS) || 30000,
    notify: (note) => {
      const title = H.deriveTitle(note) || 'Reminder';
      lastContentHash = contentHash();
      if (win && !win.isDestroyed()) win.webContents.send('reminder:fired', { id: note.id, title });
      if (process.env.NOTES_APP_DRY_NOTIFY === '1' || !Notification.isSupported()) return;
      const n = new Notification({ title: '⏰ ' + title, body: H.plainTextFromMarkdown(note.body).slice(0, 200) || 'Open your note', icon: iconImage() });
      n.on('click', () => { showWindow(); if (rendererReady) win.webContents.send('app:open-note', note.id); else pendingOpenNote = note.id; });
      n.show();
    },
  });
  const { LiveShare } = require('./live');
  const live = new LiveShare(store, {
    pushDelayMs: Number(process.env.NOTES_APP_LIVE_PUSH_MS) || 250,
    // A remote edit landed in the store: the open editor and any sticky showing the note follow it.
    onRemote: (id) => { lastContentHash = contentHash(); fanReloaded({ reason: 'live', id }); stickies.broadcast('notes:changed', { id }); },
    onStatus: (id, status) => { if (win && !win.isDestroyed()) win.webContents.send('live:status', { id, status }); },
  });
  const { StickyManager } = require('./stickies');
  const stickies = new StickyManager(store, {
    themeFor: effectiveTheme,
    showInactive: SHOW_INACTIVE,
    onChange: () => { refreshTray(); if (win && !win.isDestroyed()) win.webContents.send('stickies:changed'); },
  });
  let hotkeyState = { hotkey: store.settings.hotkey, registered: false };
  let boundsTimer = null;

  const iconImage = () => nativeImage.createFromBitmap(drawIconBitmap(32), { width: 32, height: 32 });

  let rendererShown = false; // first paint done; survives later runtime writes
  function writeRuntime(extra) {
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
    try { fs.writeFileSync(path.join(DATA_DIR, 'runtime.json'), JSON.stringify(data)); } catch (_) { /* best effort */ }
  }

  function effectiveTheme() {
    const t = store.settings.theme;
    if (t === 'light' || t === 'dark') return t;
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }

  // The editor's paper and text colours in the colour scheme in use (src/shared/themes.js), shown before the page
  // paints; the page repaints the caption buttons to match whatever sits under them (app:titleBar).
  function windowColors() {
    return Themes.windowColors(store.settings, effectiveTheme());
  }

  function safeBounds(saved) {
    const def = { width: 1100, height: 720 };
    if (!saved) return def;
    try {
      const area = screen.getDisplayMatching(saved).workArea;
      const fits = saved.x >= area.x - 50 && saved.y >= area.y - 50 && saved.x < area.x + area.width - 100 && saved.y < area.y + area.height - 100;
      return fits ? saved : { width: saved.width, height: saved.height };
    } catch (_) {
      return def; // an odd saved rectangle must never stop the window from opening
    }
  }

  function createWindow() {
    win = new BrowserWindow(Object.assign({
      minWidth: 760,
      minHeight: 480,
      show: false,
      autoHideMenuBar: true,
      title: 'Notes',
      icon: iconImage(),
      backgroundColor: windowColors().background,
      // Our own top band instead of Windows' white title bar; Windows still draws the caption buttons.
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: windowColors().background, symbolColor: windowColors().foreground, height: TITLE_BAR_H },
      alwaysOnTop: store.settings.alwaysOnTop,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        // The split view's right side is this page again in an iframe, and needs the preload there too.
        nodeIntegrationInSubFrames: true,
      },
    }, safeBounds(store.settings.window)));

    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    win.once('ready-to-show', () => {
      if (!START_HIDDEN) showWindow();
      writeRuntime({ ready: true });
    });

    win.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      win.hide();
      writeRuntime();
    });

    const persistBounds = () => {
      clearTimeout(boundsTimer);
      boundsTimer = setTimeout(() => {
        if (win && !win.isDestroyed() && !win.isMinimized() && !win.isMaximized()) {
          try { store.setSettings({ window: win.getBounds() }); } catch (_) { /* saving paused or disk busy; bounds are not worth an error dialog */ }
        }
      }, 400);
    };
    win.on('resize', persistBounds);
    win.on('move', persistBounds);
    win.on('show', () => writeRuntime());
    // Windows logoff/shutdown does not emit before-quit; do what can be done synchronously.
    win.on('session-end', () => {
      try { win.webContents.send('app:flush'); } catch (_) { /* ignore */ }
      stickies.broadcast('app:flush');
      git.flush().catch(() => {});
    });
    win.on('hide', () => { writeRuntime(); relockOnHide(); });
    win.on('focus', () => {
      // Windows may refuse a topmost change requested while another app held the foreground; retry on focus.
      if (store.settings.alwaysOnTop && !win.isAlwaysOnTop()) win.setAlwaysOnTop(true);
      writeRuntime();
    });
    win.on('blur', () => writeRuntime());

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    // Ctrl+= / Ctrl+- / Ctrl+0 and the right-click menu (Electron supplies neither properly on its own).
    // Debounced: holding Ctrl+= repeats ~30 times a second, and each save writes notes.json.
    let zoomSaveTimer = null;
    const rememberZoom = (level) => {
      clearTimeout(zoomSaveTimer);
      zoomSaveTimer = setTimeout(() => { if (store.settings.zoomLevel === level) return; try { store.setSettings({ zoomLevel: level }); } catch (_) { /* saving paused */ } }, 400);
    };
    windowInput.attachZoom(win.webContents, { initial: store.settings.zoomLevel, onChange: rememberZoom });
    windowInput.attachContextMenu(win.webContents, () => win, { Menu, shell, clipboard, onZoom: rememberZoom });
    win.webContents.on('will-navigate', (e, url) => {
      e.preventDefault(); // the app page never navigates (a dropped file must not replace it)
      if (/^https?:/i.test(url)) shell.openExternal(url);
    });

    if (process.env.NOTES_APP_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
    if (process.env.NOTES_APP_LOG_CONSOLE === '1') {
      win.webContents.on('console-message', (ev, ...rest) => {
        const d = ev && typeof ev.level !== 'undefined' ? ev : { level: rest[0], message: rest[1], lineNumber: rest[2], sourceId: rest[3] };
        const level = typeof d.level === 'number' ? ['debug', 'info', 'warning', 'error'][d.level] || d.level : d.level;
        console.log('[renderer:' + level + '] ' + d.message + ' (' + d.sourceId + ':' + d.lineNumber + ')');
      });
      win.webContents.on('render-process-gone', (_e, details) => console.log('[renderer:error] render process gone: ' + details.reason));
    }
  }

  // While saving is paused because the file was unreadable at startup, try again whenever the window is shown.
  let reloadedSinceStart = false;
  function retryLoadIfBlocked() {
    if (!store.saveBlocked) return;
    try { store.load(); } catch (_) { return; }
    if (!store.saveBlocked) {
      lastContentHash = contentHash();
      reloadedSinceStart = true;
      // The file's settings may differ from the defaults we started with: apply them for real.
      applyTheme();
      registerHotkey(store.settings.hotkey);
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!store.settings.alwaysOnTop);
      applyLoginItem();
      git.configure(store.settings).then(() => { if (store.settings.gitEnabled) git.noteChanged(); }).catch(() => {});
      if (win && !win.isDestroyed()) win.webContents.send('settings:changed', store.getSettings());
      fanReloaded({ reason: 'recovered' });
      // Everything that was started against the empty store starts again against the real one.
      try { stickies.restoreAll(); } catch (_) { /* best effort */ }
      vaults.start().catch(() => {});
      live.restore().catch(() => {});
    }
  }

  function showWindow() {
    retryLoadIfBlocked();
    if (!win || win.isDestroyed()) createWindow();
    if (win.isMinimized()) win.restore();
    if (SHOW_INACTIVE) {
      win.showInactive();
    } else {
      win.show();
      win.focus();
      app.focus({ steal: true });
    }
    win.webContents.send('app:shown');
    writeRuntime();
  }

  function hideWindow() {
    if (win && !win.isDestroyed() && win.isVisible()) win.hide();
    writeRuntime();
  }

  function toggleWindow() {
    if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) hideWindow();
    else showWindow();
  }

  function registerHotkey(preferred) {
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
    } catch (_) { /* non-fatal */ }
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
      { label: 'Start at login', type: 'checkbox', checked: !!store.settings.openAtLogin, click: (item) => { try { store.setSettings({ openAtLogin: item.checked }); applyLoginItem(); } catch (_) { /* paused */ } broadcastSettings(); refreshTray(); } },
      { label: 'Always on top', type: 'checkbox', checked: !!store.settings.alwaysOnTop, click: (item) => { try { store.setSettings({ alwaysOnTop: item.checked }); if (win) win.setAlwaysOnTop(item.checked); } catch (_) { /* paused */ } broadcastSettings(); refreshTray(); } },
      { label: 'Open data folder', click: () => shell.openPath(DATA_DIR) },
      { type: 'separator' },
      { label: 'Quit Notes', click: () => { quitting = true; app.quit(); } },
    ]));
  }

  function stickyMenu() {
    const items = store.stickies().map((n) => ({
      label: (stickies.isOpen(n.id) ? '' : '(hidden) ') + (H.deriveTitle(n) || 'Untitled').slice(0, 60),
      click: () => stickies.open(n.id),
    }));
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

  let craftsReady = {}; // which Craft apps' builds are there: { wordcraft, gridcraft, deckcraft }
  function info() {
    return {
      version: app.getVersion(),
      dataDir: DATA_DIR,
      hotkey: hotkeyState.hotkey,
      hotkeyRegistered: hotkeyState.registered,
      hotkeyFallback: !!hotkeyState.fallback,
      hotkeyDisplay: H.displayAccelerator(hotkeyState.hotkey),
      platform: process.platform,
      crafts: craftsReady, // the Craft apps whose web builds are there, so their documents open in them
      loadError: store.loadError ? String(store.loadError.message || store.loadError) : null,
      documentsDir: app.getPath('documents'),
      saveBlocked: !!store.saveBlocked,
      recoveredNotes: store.recoveredFromBackup ? store.notes.length : null,
    };
  }

  // ---- IPC ----------------------------------------------------------------

  const pub = (n) => store.publicNote(n);
  ipcMain.handle('notes:list', (_e, opts) => store.list(opts).map(pub));
  ipcMain.handle('notes:outline', (_e, sort) => store.noteOutline(typeof sort === 'string' ? sort : undefined));
  ipcMain.handle('notes:get', (_e, id) => pub(store.get(id)));
  ipcMain.handle('notes:create', (_e, data) => {
    data = Object.assign({}, data || {});
    // The page may only name content and placement; file links, vault membership and locks are the store's.
    for (const k of ['filePath', 'fileKind', 'fileMtime', 'vaultId', 'lock', 'live', 'sticky', 'trashedFrom', 'id']) delete data[k];
    const folder = data.folderId ? store.getFolder(data.folderId) : null;
    const note = folder && folder.vaultId ? store.createVaultNote(folder.id, data) : store.create(data);
    if (note.vaultId) vaults.noteChanged(note.vaultId);
    return pub(note);
  });
  ipcMain.handle('notes:update', (e, id, patch) => {
    const note = store.update(id, patch);
    if (note && note.vaultId) vaults.noteChanged(note.vaultId);
    if (note) notifyNoteChanged(note.id, e.sender);
    return pub(note);
  });

  // ---- locking ---------------------------------------------------------------
  ipcMain.handle('lock:set', (_e, id, password) => { const n = store.lockNote(id, password); forgetWorkspaceCopy(id); live.stop(id); stickies.close(id, { forget: true }); return n; });
  ipcMain.handle('lock:unlock', (_e, id, password) => store.unlockNote(id, password));
  ipcMain.handle('lock:relock', (_e, id) => { store.relock(id); return pub(store.get(id)); });
  ipcMain.handle('lock:remove', (_e, id, password) => store.removeLock(id, password));
  // Hiding the window locks everything again (after the renderer has written what it was typing).
  function relockOnHide() {
    flushWindow(win, 800).then(() => {
      if (win && !win.isDestroyed() && win.isVisible()) return; // shown again before the flush finished
      const ids = store.relockAll();
      if (ids.length && win && !win.isDestroyed()) win.webContents.send('lock:relocked', ids);
    });
  }
  // Edits made in one window reach the others: the main window reloads the open note when clean,
  // and each sticky showing that note does the same.
  // Something other than the main window changed notes (vault, bot, live, recovery, sticky edit): every
  // window that shows notes reloads what it has, when it is clean.
  function fanReloaded(payload) {
    if (win && !win.isDestroyed()) win.webContents.send('notes:reloaded', payload);
    stickies.broadcast('notes:reloaded', payload);
  }

  let trayRefreshTimer = null;
  function refreshTraySoon() { clearTimeout(trayRefreshTimer); trayRefreshTimer = setTimeout(refreshTray, 1000); }

  function notifyNoteChanged(id, sender) {
    const changed = store.get(id);
    if (changed && changed.sticky) refreshTraySoon();
    if (win && !win.isDestroyed() && (!sender || win.webContents.id !== sender.id)) win.webContents.send('notes:reloaded', { reason: 'sticky', id });
    stickies.broadcast('notes:changed', { id }, sender);
    live.noteChanged(id);
  }

  // ---- live share -------------------------------------------------------------
  ipcMain.handle('live:host', async (_e, id) => { try { return { ok: true, status: await live.host(id) }; } catch (err) { return { ok: false, error: err.message }; } });
  ipcMain.handle('live:join', async (_e, url, folderId) => {
    const folder = folderId ? store.getFolder(folderId) : null;
    try { const r = await live.join(url, { folderId: folder && !folder.vaultId ? folder.id : null }); fanReloaded({ reason: 'live' }); return { ok: true, noteId: r.noteId, status: r.status }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('live:stop', (_e, id) => live.stop(id));
  ipcMain.handle('live:status', (_e, id) => live.statusOf(id));
  ipcMain.handle('notes:togglePin', (_e, id) => pub(store.togglePin(id)));
  ipcMain.handle('notes:duplicate', (_e, id) => pub(store.duplicate(id)));
  ipcMain.handle('notes:splitIntoBook', (_e, id, opts) => {
    const r = store.splitIntoBook(id, opts);
    if (r.originalTrashed) { live.stop(id); forgetWorkspaceCopy(id); stickies.close(id); }
    return r;
  });
  ipcMain.handle('notes:undoSplit', (_e, folderId, pageIds, originalId) => {
    const r = store.undoSplit(folderId, pageIds, originalId);
    for (const id of r.removedIds) { live.stop(id); forgetWorkspaceCopy(id); stickies.close(id); }
    return r;
  });
  ipcMain.handle('notes:trash', (_e, id) => { live.stop(id); forgetWorkspaceCopy(id); const n = store.trash(id); stickies.close(id); return pub(n); });
  ipcMain.handle('notes:restore', (_e, id) => pub(store.restore(id)));
  ipcMain.handle('notes:destroy', (_e, id) => { live.stop(id); forgetWorkspaceCopy(id); stickies.close(id); return store.destroy(id); });
  function forgetWorkspaceCopy(id) { try { require('./workspace').forgetNote(path.join(DATA_DIR, 'workspace'), id); } catch (_) { /* best effort */ } }
  ipcMain.handle('notes:emptyTrash', () => store.emptyTrash());

  // ---- desktop stickies ------------------------------------------------------

  const stickyView = (n) => ({ id: n.id, title: H.deriveTitle(n), sticky: n.sticky, open: stickies.isOpen(n.id) });
  function newSticky() {
    let note;
    try {
      note = store.create({ title: '', body: '' });
      stickies.open(note.id);
    } catch (err) {
      // From the tray there is no renderer to reject to: say it in the app window if there is one.
      if (note) { try { store.destroy(note.id); } catch (_) { /* leave it */ } }
      if (win && !win.isDestroyed()) win.webContents.send('app:notice', 'Could not create a sticky: ' + (err.message || err));
      return null;
    }
    fanReloaded({ reason: 'sticky' });
    return pub(note);
  }
  ipcMain.handle('stickies:list', () => store.stickies().map(stickyView));
  ipcMain.handle('stickies:open', (_e, id) => !!stickies.open(id));
  ipcMain.handle('stickies:close', (_e, id, opts) => { stickies.close(id, opts || {}); return true; });
  ipcMain.handle('stickies:create', () => newSticky());
  ipcMain.handle('stickies:setColor', (_e, id, color) => stickies.setColor(id, color));
  ipcMain.handle('stickies:setOnTop', (_e, id, onTop) => stickies.setOnTop(id, onTop));
  ipcMain.handle('stickies:openInNotes', (_e, id) => { showWindow(); if (rendererReady) win.webContents.send('app:open-note', id); else pendingOpenNote = id; return true; });
  ipcMain.handle('notes:tags', () => store.tags());
  ipcMain.handle('notes:counts', () => store.counts());
  ipcMain.handle('notes:related', (_e, id) => store.related(id));
  ipcMain.handle('folders:setBook', (_e, id, on) => store.setBook(id, on));
  ipcMain.handle('folders:reorderPages', (_e, id, ids) => store.reorderPages(id, ids));

  // ---- file-backed notes ---------------------------------------------------

  const APP_ERROR_CODES = new Set(['EZIP', 'ETOOBIG', 'EENCODING']);
  async function linkPaths(paths, opts) {
    const linked = [];
    const failed = [];
    for (const p of paths) {
      try { linked.push(await store.linkFile(p, opts)); }
      // The app's own errors explain themselves; a system error is shown by its code (ENOENT, EACCES).
      catch (err) { failed.push(path.basename(p) + ' (' + (APP_ERROR_CODES.has(err.code) || !err.code ? err.message : err.code) + ')'); }
    }
    return { ok: linked.length > 0, linked: linked.map((n) => n.id), failed, firstId: linked.length ? linked[0].id : null };
  }

  ipcMain.handle('files:openDialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Open files as notes',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Notes and documents', extensions: ['md', 'markdown', 'txt', 'tex', 'latex', 'pdf', ...H.WORD_EXT, ...H.SHEET_EXT, ...H.DECK_EXT, ...H.IMAGE_EXT, 'csv', 'tsv', 'json', 'yaml', 'yml', 'log'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true, linked: [], failed: [] };
    return linkPaths(filePaths);
  });
  ipcMain.handle('files:link', (_e, paths, opts) => linkPaths(Array.isArray(paths) ? paths : [], opts || {}));
  ipcMain.handle('files:refresh', (_e, id) => store.refreshFileNote(id));
  ipcMain.handle('files:reveal', (_e, id) => { const n = store.get(id); if (n && n.filePath) shell.showItemInFolder(n.filePath); });
  const EXEC_EXT = /\.(exe|bat|cmd|com|scr|pif|msi|msp|msc|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|lnk|url|jar|hta|reg|cpl|py|pyw|mht|mhtml)$/i;
  // Only documents and media are handed to their default app; anything else is shown in Explorer instead,
  // so a file that could run code is never launched from inside Notes. (An allowlist, not a denylist.)
  const OPENABLE_EXT = /\.(pdf|txt|md|markdown|mdx|csv|tsv|json|xml|yaml|yml|toml|ini|log|rtf|doc|docx|odt|xls|xlsx|ods|ppt|pptx|odp|key|pages|numbers|png|jpe?g|gif|webp|bmp|tiff?|heic|avif|mp3|wav|m4a|aac|ogg|opus|flac|webm|mp4|m4v|mov|mkv|avi|zip|7z|rar|gz|tar|epub|ics|vcf|tex|bib|srt|vtt)$/i;
  function openSafely(fullPath) {
    const name = path.basename(fullPath).replace(/[. ]+$/, '');
    if (OPENABLE_EXT.test(name) && !EXEC_EXT.test(name)) return shell.openPath(fullPath);
    shell.showItemInFolder(fullPath);
    return 'Shown in Explorer instead: Notes only opens documents and media itself.';
  }
  ipcMain.handle('files:openExternal', async (_e, id) => {
    const n = store.get(id);
    if (!n || !n.filePath) return 'No file';
    return openSafely(n.filePath);
  });
  // The opened file behind note id, which must be of the given kind (pdf, docx, sheet, deck, image).
  function fileNoteOfKind(id, kind) {
    const n = store.get(id);
    if (!n || !n.filePath || n.fileKind !== kind) throw new Error({ pdf: 'Not a PDF.', image: 'Not an image.', sheet: 'Not a spreadsheet.', deck: 'Not a presentation.' }[kind] || 'Not a Word document.');
    return n;
  }

  // PDFs: the bytes for the viewer, and saving the viewer's edits back into the file.
  const MAX_PDF_BYTES = 100 * 1024 * 1024;
  ipcMain.handle('files:pdfBytes', (_e, id) => {
    const n = fileNoteOfKind(id, 'pdf');
    if (fs.statSync(n.filePath).size > MAX_PDF_BYTES) throw new Error('This PDF is larger than 100 MB.');
    return fs.readFileSync(n.filePath);
  });

  // Before a PDF is overwritten, the file as it is now is copied into its own folder under backups\files. The newest
  // KEEP_FILE_VERSIONS copies are kept, plus the copy made before the first save of this session (the original).
  const FILE_BACKUP_DIR = path.join(DATA_DIR, 'backups', 'files');
  const KEEP_FILE_VERSIONS = 10;
  const sessionOriginals = new Map(); // pathKey -> name of that first copy
  const backupDirFor = (file) => path.join(FILE_BACKUP_DIR, H.safeFilename(path.basename(file)) + ' ' + crypto.createHash('sha1').update(pathKey(file)).digest('hex').slice(0, 8));
  // Returns { first, name }: whether this was the session's first copy of the file, and the copy's file name.
  function backUpBeforeWrite(file) {
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
  // In place (so links to the file stay joined), and flushed to disk before it counts as saved.
  function writeInPlace(file, buf) {
    const fd = fs.openSync(file, 'w');
    try {
      for (let done = 0; done < buf.length;) done += fs.writeSync(fd, buf, done, buf.length - done, done);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  }
  // Backs the file up, writes buf over it in place, and records the app's own write. Returns { mtime, backup }.
  function replaceFile(id, file, buf) {
    const backup = backUpBeforeWrite(file);
    writeInPlace(file, buf);
    return { mtime: store.markFileWritten(id), backup };
  }

  // After the original changed on disk, a note's edits go to a copy beside it; later saves update that same copy
  // (while it is unchanged since the app wrote it). note id -> { file, mtime }.
  const conflictCopies = new Map();
  // Writes edited bytes for the opened file of note id: in place after a backup while the file is as it was opened
  // ({ mtime, backup: whether this was the session's first backup }), else into the copy ({ savedAs, newCopy }).
  function saveEdits(id, file, buf, expectedMtime) {
    if (stillAsOpened(file, expectedMtime)) {
      conflictCopies.delete(id);
      const { mtime, backup } = replaceFile(id, file, buf);
      return { mtime, backup: backup.first };
    }
    // Changed or removed on disk since it was opened: never write over that.
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
  ipcMain.handle('files:savePdf', (_e, id, bytes, expectedMtime) => saveEdits(id, fileNoteOfKind(id, 'pdf').filePath, pdfBuffer(bytes), expectedMtime));

  // A signature the person chose to remember, kept as a PNG in the app's data folder (never anywhere else).
  const SIGNATURE_FILE = path.join(DATA_DIR, 'signature.png');
  const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
  ipcMain.handle('signature:get', () => (fs.existsSync(SIGNATURE_FILE) ? fs.readFileSync(SIGNATURE_FILE) : null));
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  ipcMain.handle('signature:set', (_e, bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_SIGNATURE_BYTES) return { ok: false, error: 'the signature picture is missing or too large.' };
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_MAGIC)) return { ok: false, error: 'the signature is not a PNG picture.' };
    // Our own file, so a temp file and a rename: a crash never leaves half a signature.
    const tmp = SIGNATURE_FILE + '.tmp';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, SIGNATURE_FILE);
    return { ok: true };
  });
  ipcMain.handle('signature:forget', () => { fs.rmSync(SIGNATURE_FILE, { force: true }); return { ok: true }; });

  // PDF bytes from the renderer: a byte array of at most MAX_PDF_BYTES that starts like a PDF, as a Buffer.
  function pdfBuffer(bytes) {
    if (!ArrayBuffer.isView(bytes) || bytes.byteLength > MAX_PDF_BYTES) throw new Error('the PDF is missing or larger than 100 MB, so nothing was written.');
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (buf.length < 8 || buf.toString('latin1', 0, 5) !== '%PDF-') throw new Error('the PDF came back damaged, so nothing was written.');
    return buf;
  }
  const stillAsOpened = (file, expectedMtime) => fs.existsSync(file) && mtimeOf(file) === expectedMtime;
  const CHANGED_ON_DISK = 'The PDF changed on disk since you opened it. Reload it, then try again.';

  // Rewrites the opened PDF of note id: build(bytes of the file now) gives the new bytes. Refused when the file
  // changed on disk since it was opened (or while building); written in place after a backup. Returns
  // { ok, mtime, backup } with the backup's name, for Undo, or { ok: false, error }.
  async function rewritePdf(id, expectedMtime, build) {
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
  // A pdf-lib change (pdf-edit-worker.js) to bytes; resolves to the new bytes, or throws with the reason.
  async function pdfLibTask(bytes, task, extra, what) {
    const res = await runWorker('pdf-edit-worker.js', Object.assign({ bytes, task }, extra), 2 * 60 * 1000, what + ' took too long.');
    if (!res.ok) throw new Error(res.error);
    return res.bytes;
  }

  // Page changes (reorder, remove, add pages from another PDF, turn): bytes is the PDF pdf.js rebuilt in the renderer
  // with the new page order, or null when only turning; rotations has one entry per page of the result.
  ipcMain.handle('files:pdfApplyPages', (_e, id, bytes, rotations, expectedMtime) => {
    if (!Array.isArray(rotations) || !rotations.length || rotations.some((r) => ![0, 90, 180, 270].includes(r))) return { ok: false, error: 'the page turns were not valid.' };
    return rewritePdf(id, expectedMtime, async (current) => {
      // Rebuilding the file breaks a digital signature: the worker refuses a signed PDF.
      if (bytes !== null) await pdfLibTask(current, 'check', {}, 'Reading the PDF');
      const buf = bytes === null ? current : pdfBuffer(bytes);
      return rotations.some((r) => r) ? pdfLibTask(buf, 'rotate', { rotations }, 'Turning the pages') : buf;
    });
  });
  // Comments: sticky notes added, retyped or deleted (ops as pdf-edit-worker.js takes them). A new note is signed
  // with the Windows user name, as other PDF apps do.
  function commentAuthor() {
    try { return os.userInfo().username || ''; } catch (_) { return ''; }
  }
  ipcMain.handle('files:pdfComments', (_e, id, ops, expectedMtime) => {
    if (!Array.isArray(ops) || !ops.length || ops.length > 100) return { ok: false, error: 'that comment change was not valid.' };
    return rewritePdf(id, expectedMtime, (current) => pdfLibTask(current, 'comments', { ops, author: commentAuthor() }, 'Saving the comment'));
  });
  // Undo for page and comment changes: the backup taken just before goes back in place (after a backup of what is
  // there). expectedMtime is the time the change itself wrote, so an Undo never wipes out anything saved after it.
  ipcMain.handle('files:pdfRestore', (_e, id, name, expectedMtime) => {
    const file = fileNoteOfKind(id, 'pdf').filePath;
    const dir = backupDirFor(file);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { /* no backups */ }
    if (typeof name !== 'string' || !names.includes(name)) return { ok: false, error: 'that backup is gone.' };
    if (!stillAsOpened(file, expectedMtime)) return { ok: false, error: 'the PDF was saved again after that change, so undoing it would lose what was saved. Its earlier versions are in the backups folder.' };
    try {
      return Object.assign({ ok: true }, { mtime: replaceFile(id, file, pdfBuffer(fs.readFileSync(path.join(dir, name)))).mtime });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // A PDF to take pages from: the person picks it; its bytes go to the renderer for thumbnails and for pdf.js.
  ipcMain.handle('files:pdfPickPages', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Add pages from a PDF', properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };
    const file = filePaths[0];
    if (fs.statSync(file).size > MAX_PDF_BYTES) return { ok: false, error: 'that PDF is larger than 100 MB.' };
    return { ok: true, name: path.basename(file), bytes: fs.readFileSync(file) };
  });
  // Word documents: the bytes to show and edit, and saving the edited paragraphs back. docxBases: note id ->
  // { buf, mtime }: the .docx the shown version came from, which the renderer's edits are made on, and the file time
  // the renderer knows that version by (a few are kept, for recent notes).
  const docxBases = new Map();
  const KEEP_DOCX_BASES = 4;
  function rememberDocx(id, buf, mtime) {
    docxBases.delete(id);
    docxBases.set(id, { buf, mtime });
    while (docxBases.size > KEEP_DOCX_BASES) docxBases.delete(docxBases.keys().next().value);
  }
  ipcMain.handle('files:docxBytes', async (_e, id) => {
    const file = fileNoteOfKind(id, 'docx').filePath;
    const mtime = mtimeOf(file);
    const buf = await readDocumentBuffer(file);
    rememberDocx(id, buf, mtime);
    return buf;
  });
  // A spreadsheet's or presentation's bytes, for GridCraft or DeckCraft.
  ipcMain.handle('files:documentBytes', (_e, id) => {
    const n = store.get(id);
    if (!n || !n.filePath || !['sheet', 'deck'].includes(n.fileKind)) throw new Error('Not a spreadsheet or presentation.');
    return readDocumentBuffer(n.filePath);
  });
  // The Craft apps' saves of a file note, by the note's kind:
  // - Under the document's own name: over the note's file (after a backup, or into the "(edited)" copy if it changed on
  //   disk since it was read). Not from DeckCraft: it is early in its development (2026-10-19), so what it saves is
  //   written beside the file, never over it, until its saved files have been checked the way WordCraft's were.
  // - A format the app reads but saves as its own zip format (WordCraft: .odt, .rtf and the old .doc become .docx;
  //   GridCraft: .xls, .xlsb and .ods become .xlsx): its Save is <name>.<that>, written beside the original, never over
  //   anything, and the note moves to it; the original stays as it was.
  // - Anything else (Save As PDF, another name): a new file beside it, never over anything.
  const CRAFT_SAVES = {
    docx: { app: 'WordCraft', inPlace: true, to: 'docx', from: H.WORD_TO_DOCX_EXT, exports: ['pdf', 'docx', 'odt', 'rtf', 'txt', 'md', 'html', 'png'] },
    sheet: { app: 'GridCraft', inPlace: true, to: 'xlsx', from: H.SHEET_TO_XLSX_EXT, exports: ['pdf', 'xlsx', 'xlsm', 'ods', 'csv', 'tsv', 'txt', 'json', 'html', 'png'] },
    deck: { app: 'DeckCraft', inPlace: false, to: null, from: new Set(), exports: ['pdf', 'pptx', 'potx', 'ppsx', 'png', 'jpg', 'jpeg', 'txt', 'md', 'html'] },
  };
  // Whether bytes are what their extension says: the Office and OpenDocument formats are zips, RTF starts {\rtf.
  // (WordCraft writes no .doc and GridCraft no .xls: such a save never goes over one.)
  const ZIP_SAVE_EXT = new Set([...H.OOXML_EXT, 'odt', 'xlsx', 'xlsm', 'ods', ...H.DECK_EXT]);
  const looksLike = (ext, buf) => {
    if (ZIP_SAVE_EXT.has(ext)) return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
    if (ext === 'rtf') return buf.slice(0, 5).toString('latin1') === '{\\rtf';
    return false;
  };
  ipcMain.handle('files:saveCraft', async (_e, id, bytes, name, expectedMtime) => {
    const n = store.get(id);
    const rules = n && n.filePath && CRAFT_SAVES[n.fileKind];
    if (!rules) throw new Error('Not a document a Craft app edits.');
    if (!ArrayBuffer.isView(bytes) || !bytes.byteLength || bytes.byteLength > MAX_PDF_BYTES) throw new Error('the document is missing or larger than 100 MB, so nothing was written.');
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const own = H.extOf(n.filePath);
    const given = path.basename(String(name || ''));
    const ext = path.extname(given).slice(1).toLowerCase();
    const stem = path.basename(n.filePath, path.extname(n.filePath));
    const dir = path.dirname(n.filePath);
    if (given.toLowerCase() === path.basename(n.filePath).toLowerCase()) {
      if (!looksLike(own, buf)) throw new Error('that is not a .' + own + ' file, so nothing was written.');
      if (!rules.inPlace) return { exported: convert.writeNew(dir, stem, own, buf) };
      const saved = saveEdits(id, n.filePath, buf, expectedMtime);
      if (n.fileKind === 'docx') rememberDocx(id, buf, saved.savedAs ? expectedMtime : saved.mtime);
      return saved;
    }
    if (rules.to && rules.from.has(own) && given.toLowerCase() === (stem + '.' + rules.to).toLowerCase()) {
      if (!looksLike(rules.to, buf)) throw new Error('that is not a .' + rules.to + ' file, so nothing was written.');
      const file = convert.writeNew(dir, stem, rules.to, buf);
      let body;
      try { body = (await readNoteText(n.fileKind, file)).body; } catch (_) { body = undefined; } // keeps the old text; the file is saved either way
      const moved = store.relinkFileNote(id, file, body);
      conflictCopies.delete(id); // an "(edited)" copy of the old file is not where the new file's saves go
      if (n.fileKind === 'docx') rememberDocx(id, buf, moved.fileMtime);
      return { relinked: file, mtime: moved.fileMtime };
    }
    if (!rules.exports.includes(ext)) throw new Error('Notes does not save .' + (ext || 'extensionless') + ' files from ' + rules.app + '.');
    const base = H.safeFilename(path.basename(given, path.extname(given))) || stem;
    return { exported: convert.writeNew(dir, base, ext, buf) };
  });

  // An image note's picture, for the image viewer.
  ipcMain.handle('files:imageBytes', (_e, id) => {
    const { bytes, mime } = readImage(fileNoteOfKind(id, 'image').filePath);
    return { bytes, mime };
  });
  const MAX_DOCX_PATCH_CHARS = 50 * 1024 * 1024;
  ipcMain.handle('files:saveDocx', async (_e, id, patches, expectedMtime) => {
    const file = fileNoteOfKind(id, 'docx').filePath;
    const base = docxBases.get(id);
    // The edits were made on the version the renderer was shown; never apply them to another one.
    if (!base || base.mtime !== expectedMtime) throw new Error('the document shown here is not the version Notes last read. Reload it, then make the change again.');
    if (!Array.isArray(patches) || !patches.length || patches.reduce((n, p) => n + String((p && p.xml) || '').length + String((p && p.old) || '').length, 0) > MAX_DOCX_PATCH_CHARS) throw new Error('the changes could not be read, so nothing was written.');
    const res = await runWorker('docx-edit-worker.js', { bytes: base.buf, patches }, 2 * 60 * 1000, 'Saving the document took too long.');
    if (!res.ok) throw new Error(res.error);
    const buf = Buffer.from(res.bytes);
    const saved = saveEdits(id, file, buf, expectedMtime);
    // Written in place: the renderer now knows the file by its new time. Into a copy: still by the old one.
    rememberDocx(id, buf, saved.savedAs ? expectedMtime : saved.mtime);
    return saved;
  });

  const { discoverAgentFiles, readDocumentBuffer, readDocxText, readNoteText, readImage, mtimeOf, pathKey } = require('./files');
  ipcMain.handle('agentFiles:discover', () => discoverAgentFiles());
  ipcMain.handle('agentFiles:link', async () => {
    const folder = store.ensureFolder('Agent files', null);
    const found = discoverAgentFiles();
    const res = await linkPaths(found.map((f) => f.filePath), { folderId: folder.id });
    // Label newly linked notes (or ones still carrying an auto label); never overwrite a title the user chose.
    for (const f of found) {
      const n = store.findByPath(f.filePath);
      if (!n) continue;
      const base = path.basename(f.filePath);
      const autoTitled = n.title === base || n.title.startsWith(base + ' — ');
      const patch = { tags: Array.from(new Set((n.tags || []).concat(['agent']))) };
      if (autoTitled) patch.title = f.label;
      if (!n.folderId) patch.folderId = folder.id;
      store.update(n.id, patch);
    }
    return Object.assign(res, { folderId: folder.id, found: found.length });
  });

  // ---- vaults --------------------------------------------------------------

  const vaultView = (v) => Object.assign({}, v, { status: vaults.statusOf(v.id), rootFolderId: (store.vaultRootFolder(v.id) || {}).id || null });
  ipcMain.handle('vaults:list', () => store.vaults.map(vaultView));
  ipcMain.handle('vaults:pickFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Choose a folder to use as a vault', properties: ['openDirectory', 'createDirectory'] });
    return canceled || !filePaths.length ? null : filePaths[0];
  });
  ipcMain.handle('vaults:add', async (_e, data) => {
    const v = store.addVault(data);
    await vaults.open(v.id, { pull: true });
    return vaultView(v);
  });
  ipcMain.handle('vaults:clone', async (_e, url, parentDir, name) => {
    const safe = String(name || path.basename(String(url).replace(/\.git$/, '').replace(/[\\/]+$/, '')) || 'vault').replace(/[<>:"/\\|?*]/g, '-');
    const dest = path.join(parentDir, safe);
    if (fs.existsSync(dest)) return { ok: false, error: 'A folder named "' + safe + '" already exists there.' };
    const r = await VaultManager.clone(url, dest);
    if (!r.ok) return r;
    let v;
    try { v = store.addVault({ path: dest, name: safe, remote: url }); }
    catch (err) { try { fs.rmSync(dest, { recursive: true, force: true }); } catch (_) { /* leave it */ } return { ok: false, error: err.message }; } // no orphan clone on disk
    await vaults.initRepo(v.id, url); // ensures .gitignore (.trash) in a freshly cloned vault
    await vaults.open(v.id, { pull: false });
    return { ok: true, vault: vaultView(v) };
  });
  ipcMain.handle('vaults:update', async (_e, id, patch) => {
    patch = Object.assign({}, patch || {});
    if (patch.remote !== undefined) {
      patch.remote = String(patch.remote || '').trim();
      if (/^-/.test(patch.remote)) return { ok: false, error: 'That does not look like a repository URL.' }; // refused before anything is stored
    }
    const v = store.updateVault(id, patch);
    if (v) { vaults.schedulePull(id); if (patch.remote !== undefined) await vaults.initRepo(id, patch.remote); }
    return v ? vaultView(v) : null;
  });
  ipcMain.handle('vaults:remove', (_e, id) => { vaults.close(id); const r = store.removeVault(id); closeOrphanStickies(); fanReloaded({ reason: 'vault' }); return r; });
  function closeOrphanStickies() { for (const sid of stickies.openIds()) if (!store.get(sid)) stickies.close(sid); }
  ipcMain.handle('vaults:sync', (_e, id) => vaults.sync(id, 'manual'));
  ipcMain.handle('vaults:scan', async (_e, id) => { const r = await store.scanVault(id); lastContentHash = contentHash(); closeOrphanStickies(); if (r && (r.added || r.updated || r.removed)) fanReloaded({ reason: 'vault' }); return r; });
  ipcMain.handle('vaults:initRepo', (_e, id, remote) => vaults.initRepo(id, remote));
  ipcMain.handle('vaults:status', async (_e, id) => vaults.refreshRepoStatus(id));
  ipcMain.handle('vaults:openFolder', (_e, id) => { const v = store.getVault(id); return v ? shell.openPath(v.path) : 'No vault'; });

  // ---- bot: Claude Code over the notes -------------------------------------

  const workspace = require('./workspace');
  const claudeBin = require('./claude-bin');
  const WORKSPACE_DIR = path.join(DATA_DIR, 'workspace');
  let botChild = null;
  let botStarting = false; // a run is past its checks but its process is not spawned yet

  function findClaude() {
    return claudeBin.resolveClaude({ override: process.env.NOTES_APP_CLAUDE_BIN || null });
  }

  // Where the agent should work for the note in front of the user: the vault folder for vault notes, the
  // file's folder for other file notes, otherwise the exported workspace of plain notes. The workspace is
  // imported before it is rewritten, so edits made there in a terminal session are never thrown away.
  function botCwdFor(noteId) {
    const note = noteId ? store.get(noteId) : null;
    if (note && note.vaultId) { const v = store.getVault(note.vaultId); if (v) return { cwd: v.path, kind: 'vault', focus: path.relative(v.path, note.filePath) }; }
    if (note && note.filePath) return { cwd: path.dirname(note.filePath), kind: 'file', focus: path.basename(note.filePath) };
    const { imported, manifest } = workspace.refreshWorkspace(store, WORKSPACE_DIR);
    if (!manifest) throw new Error('the earlier workspace could not be read back (' + imported.error + '); fix or remove ' + WORKSPACE_DIR + ' first');
    for (const nid of imported.updatedIds || []) live.noteChanged(nid);
    if (imported && (imported.updated || imported.created || imported.conflicts)) { lastContentHash = contentHash(); fanReloaded({ reason: 'bot' }); }
    const entry = note ? manifest.files.find((f) => f.id === note.id) : null;
    return { cwd: WORKSPACE_DIR, kind: 'workspace', focus: entry ? entry.rel : null, imported };
  }

  // The app may itself have been started from inside a Claude Code session (a terminal, a script); those
  // session variables must not leak into the agent we launch, or it would attach to that session.
  function cleanEnv() {
    const env = Object.assign({}, process.env);
    // Only the variables that attach a process to a running Claude Code session; auth and provider
    // settings such as CLAUDE_CODE_OAUTH_TOKEN or CLAUDE_CODE_GIT_BASH_PATH must stay.
    for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|SESSION_ID|SESSION_ATTENDED|CHILD_SESSION|MESSAGING_SOCKET|MESSAGING_TOKEN))$/i.test(k)) delete env[k];
    // Runs go on the user's Claude subscription, never on API credits.
    return claudeBin.subscriptionEnv(env);
  }

  // Asks Claude Code how it is signed in and refuses to start an agent that would bill API credits.
  // A confirmed subscription is remembered for a minute, so quick repeat runs do not pay for the check.
  let authOkUntil = 0, authPlan = null;
  async function ensureSubscription(spec) {
    if (Date.now() < authOkUntil) return { ok: true, plan: authPlan };
    const launch = claudeBin.launchSpec(spec, ['auth', 'status']);
    const text = await new Promise((resolve) => {
      require('child_process').execFile(launch.file, launch.args, { windowsHide: true, timeout: 20000, env: Object.assign(cleanEnv(), launch.env) }, (_err, stdout) => resolve(String(stdout || '')));
    });
    const r = claudeBin.checkSubscriptionAuth(text);
    if (r.ok) { authOkUntil = Date.now() + 60 * 1000; authPlan = r.plan; }
    return r;
  }

  function botSend(type, data) {
    if (win && !win.isDestroyed()) win.webContents.send('bot:event', Object.assign({ type }, data || {}));
  }

  function killTree(child) {
    if (!child || child.exitCode !== null) return;
    if (process.platform === 'win32') {
      // kill() alone would leave grandchildren (and their edits) running.
      try { require('child_process').execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch (_) { /* ignore */ }
    } else {
      try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
    }
  }

  ipcMain.handle('bot:run', async (_e, opts) => {
    opts = opts || {};
    if (botChild || botStarting) return { ok: false, error: 'A run is already in progress.' };
    const prompt = String(opts.prompt || '').trim();
    if (!prompt) return { ok: false, error: 'Type what you want done.' };
    const spec = findClaude();
    if (!spec) return { ok: false, error: 'Claude Code was not found. Install it (npm i -g @anthropic-ai/claude-code, or the native installer) and make sure "claude" is on your PATH.' };
    botStarting = true; // holds the slot while the sign-in check runs, so two runs cannot start
    let auth;
    try { auth = await ensureSubscription(spec); } finally { botStarting = false; }
    if (!auth.ok) return { ok: false, error: auth.reason };
    let target;
    try { target = botCwdFor(opts.noteId); } catch (err) { return { ok: false, error: 'Could not prepare the workspace: ' + err.message }; }
    const intro = target.kind === 'workspace'
      ? 'You are working inside a folder of Markdown notes exported from a notes app. Each .md file is one note; folders mirror the app\'s folders. Edit files in place; create new .md files for new notes; do not create other file types.'
      : 'You are working inside the user\'s notes folder. Each Markdown file is a note.';
    const focusLine = target.focus ? ' The user is currently looking at "' + target.focus + '".' : '';
    const fullPrompt = intro + focusLine + '\n\nTask: ' + prompt;
    const allowed = opts.allowEdits === false ? 'Read,Glob,Grep' : 'Read,Glob,Grep,Edit,Write,MultiEdit';
    const args = ['-p', fullPrompt, '--output-format', 'text', '--permission-mode', 'dontAsk', '--allowedTools', allowed];
    // Never through a shell: the prompt is one argv entry, whatever it contains.
    const launch = claudeBin.launchSpec(spec, args);
    botSend('start', { cwd: target.cwd, kind: target.kind, focus: target.focus, imported: target.imported, plan: auth.plan });
    const { spawn } = require('child_process');
    let child;
    try {
      // stdin closed: with a pipe left open, claude waits a few seconds for piped input before starting.
      child = spawn(launch.file, launch.args, { cwd: target.cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign(cleanEnv(), { CLAUDE_CODE_NONINTERACTIVE: '1' }, launch.env) });
    } catch (err) {
      botSend('end', { ok: false, error: err.message });
      return { ok: false, error: err.message };
    }
    botChild = child;
    let ended = false;
    const end = (data) => { if (ended) return; ended = true; if (botChild === child) botChild = null; botSend('end', data); };
    // Streaming decoders: a multibyte character split across two chunks must not show as a replacement sign.
    const { StringDecoder } = require('string_decoder');
    const outDec = new StringDecoder('utf8'), errDec = new StringDecoder('utf8');
    child.stdout.on('data', (d) => { const t = outDec.write(d); if (t) botSend('out', { text: t }); });
    child.stderr.on('data', (d) => { const t = errDec.write(d); if (t) botSend('err', { text: t }); });
    child.on('error', (err) => end({ ok: false, error: 'Could not start "' + launch.file + '": ' + err.message }));
    child.on('close', (code) => {
      if (ended) return;
      let imported = null;
      if (target.kind === 'workspace') {
        try { imported = workspace.importNotes(store, WORKSPACE_DIR); for (const nid of imported.updatedIds || []) live.noteChanged(nid); } catch (err) { imported = { error: err.message }; }
      } else if (target.kind === 'vault') {
        const note = store.get(opts.noteId);
        if (note && note.vaultId) { store.scanVault(note.vaultId).then((r) => { if (r && (r.added || r.updated || r.removed)) botSend('reloaded', r); }).catch(() => {}); vaults.noteChanged(note.vaultId); }
      }
      lastContentHash = contentHash();
      if (store.settings.gitEnabled) git.noteChanged();
      end({ ok: code === 0, code, imported });
      fanReloaded({ reason: 'bot' });
    });
    return { ok: true, cwd: target.cwd, kind: target.kind };
  });
  ipcMain.handle('bot:cancel', () => { if (botChild) { killTree(botChild); return true; } return false; });
  ipcMain.handle('bot:openTerminal', async (_e, noteId) => {
    if (botChild || botStarting) return { ok: false, error: 'A run is in progress; wait for it to finish (or stop it) first.' }; // the workspace is in use
    let target;
    try { target = botCwdFor(noteId); } catch (err) { return { ok: false, error: err.message }; }
    const spec = findClaude();
    if (!spec) return { ok: false, error: 'Claude Code was not found on this machine.' };
    botStarting = true; // a run must not start on the workspace while the check runs, nor a second terminal
    let auth;
    try { auth = await ensureSubscription(spec); } finally { botStarting = false; }
    if (!auth.ok) return { ok: false, error: auth.reason };
    const { spawn } = require('child_process');
    try {
      // Prefer Windows Terminal; fall back to a PowerShell window. Both run the interactive Claude Code TUI.
      // Paths never go through PowerShell's parser or wt's `;` splitting: they sit inside single-quoted
      // here-strings in a script file (only a line that is exactly '@ ends one, and paths have no newlines).
      const here = (s) => "@'\n" + String(s).replace(/\r?\n/g, '') + "\n'@";
      const lines = ['$ErrorActionPreference = \'Continue\'', 'Set-Location -LiteralPath ' + here(target.cwd)];
      // A Windows Terminal that is already open gives new tabs its own environment, not ours, so the script
      // clears the API-billing variables itself: the session runs on the Claude subscription.
      for (const v of claudeBin.API_BILLING_VARS) lines.push('Remove-Item -LiteralPath Env:' + v + ' -ErrorAction SilentlyContinue');
      if (spec.isScript) lines.push('$notesNode = ' + here(claudeBin.resolveNode() || 'node'), '$notesCli = ' + here(spec.file), '& $notesNode $notesCli');
      else lines.push('$notesClaude = ' + here(spec.file), '& $notesClaude');
      const script = path.join(DATA_DIR, 'bot-terminal.ps1');
      fs.writeFileSync(script, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
      if (process.env.NOTES_APP_DRY_TERMINAL) return { ok: true, cwd: target.cwd, kind: target.kind, script }; // tests: no window
      const psArgs = ['-NoExit', '-ExecutionPolicy', 'Bypass', '-File', script];
      const hasWt = (() => { try { require('child_process').execFileSync('where', ['wt'], { stdio: 'ignore', windowsHide: true }); return true; } catch (_) { return false; } })();
      if (hasWt) spawn('wt', ['powershell'].concat(psArgs), { detached: true, stdio: 'ignore', windowsHide: false, env: cleanEnv() }).unref();
      else spawn('powershell', psArgs, { detached: true, stdio: 'ignore', windowsHide: false, shell: false, env: cleanEnv() }).unref();
      return { ok: true, cwd: target.cwd, kind: target.kind };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  // Pulls edits made in the workspace (e.g. in a terminal session) back into the notes.
  ipcMain.handle('bot:importWorkspace', () => {
    if (botChild) return { error: 'A run is in progress; its edits are imported when it finishes.' };
    const r = workspace.importNotes(store, WORKSPACE_DIR);
    lastContentHash = contentHash();
    fanReloaded({ reason: 'bot' });
    return r;
  });

  ipcMain.handle('folders:tree', () => store.folderTree());
  ipcMain.handle('folders:path', (_e, id) => store.folderPath(id));
  ipcMain.handle('folders:create', (_e, data) => store.createFolder(data));
  ipcMain.handle('folders:rename', (_e, id, name) => store.renameFolder(id, name));
  ipcMain.handle('folders:move', (_e, id, parentId) => store.moveFolder(id, parentId));
  ipcMain.handle('folders:delete', (_e, id) => store.deleteFolder(id));

  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:set', async (_e, patch) => {
    patch = patch || {};
    const before = store.getSettings();
    let error = null;
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
      // The save failed; undo a hotkey we may already have re-registered so the binding matches the settings.
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

  ipcMain.handle('git:status', () => git.status());
  ipcMain.handle('git:commit', () => git.commit('manual commit'));
  ipcMain.handle('git:push', () => git.push());
  ipcMain.handle('git:history', (_e, limit) => git.history(limit));

  // Dictation: Windows' built-in speech recognition types into the focused control. We bring the window to
  // the front and press Win+H on the user's behalf; nothing is recorded by this app.
  ipcMain.handle('app:dictate', async () => {
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
        require('child_process').execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 10000 }, (err) => (err ? reject(err) : resolve()));
      });
      return { ok: true, method: 'windows-dictation' };
    } catch (err) {
      return { ok: false, error: 'Could not open Windows dictation: ' + (err.message || err) + '. Press Win+H manually.' };
    }
  });

  ipcMain.handle('app:info', () => info());
  ipcMain.handle('app:hide', () => hideWindow());
  ipcMain.handle('app:titleBar', (e, colors) => {
    const ok = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
    if (!win || win.isDestroyed() || e.sender !== win.webContents || !colors || !ok(colors.color) || !ok(colors.symbol)) return false;
    try { win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbol, height: TITLE_BAR_H }); return true; } catch (_) { return false; }
  });
  ipcMain.handle('app:print', (e) => new Promise((resolve) => {
    if (process.env.NOTES_APP_DRY_PRINT === '1') return resolve({ ok: true, dry: true });
    try { e.sender.print({ printBackground: true }, (ok, reason) => resolve({ ok, error: ok ? null : (reason || 'print failed') })); }
    catch (err) { resolve({ ok: false, error: err.message }); }
  }));
  // The first 'app:shown' can be sent before the renderer has registered its listener (ready-to-show fires
  // before the scripts finish). Once the renderer is ready it asks, and we replay the signal if visible.
  let rendererReady = false;
  let pendingNewNote = false;
  ipcMain.handle('app:rendererReady', () => {
    rendererReady = true;
    const visible = !!(win && !win.isDestroyed() && win.isVisible());
    if (reloadedSinceStart) { win.webContents.send('settings:changed', store.getSettings()); win.webContents.send('notes:reloaded', { reason: 'recovered' }); }
    if (visible) win.webContents.send('app:shown');
    if (pendingNewNote) { pendingNewNote = false; win.webContents.send('app:new-note'); }
    if (pendingOpenNote) { win.webContents.send('app:open-note', pendingOpenNote); pendingOpenNote = null; }
    return { visible };
  });
  function requestNewNote() {
    showWindow();
    if (rendererReady) win.webContents.send('app:new-note'); else pendingNewNote = true;
  }
  ipcMain.handle('app:openDataFolder', () => shell.openPath(DATA_DIR));
  ipcMain.handle('app:openExternal', (_e, url) => { if (/^https?:/i.test(url)) shell.openExternal(url); });

  ipcMain.handle('app:exportNote', async (_e, id) => {
    const out = store.exportNote(id);
    if (!out) return { ok: false };
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export note as Markdown',
      defaultPath: path.join(app.getPath('documents'), out.filename),
      filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, out.content, 'utf8');
    return { ok: true, filePath };
  });

  // ---- sharing ---------------------------------------------------------------

  ipcMain.handle('app:copy', async (_e, data) => {
    const d = data || {};
    const text = String(d.text || '');
    if (!d.html) { await clipboard.writeText(text); return true; }
    // Electron 44's clipboard is the async ClipboardItem API: both flavours go on in one item, so a rich
    // editor pastes the HTML and a plain one the Markdown.
    const item = new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([String(d.html)], { type: 'text/html' }) });
    await clipboard.write([item]);
    return true;
  });
  ipcMain.handle('app:emailNote', async (_e, id) => {
    const note = store.publicNote(store.get(id));
    if (!note) return { ok: false, error: 'Note not found' };
    if (note.locked && !note.unlocked) return { ok: false, error: 'Unlock the note first.' };
    const m = H.mailtoFor(note);
    try { await shell.openExternal(m.url); } catch (err) { return { ok: false, error: 'No mail app could open the message: ' + err.message }; }
    return { ok: true, truncated: m.truncated };
  });
  // Two steps, because the page is what gets printed: the renderer asks for a path, then (if it still shows
  // that same note) asks for the print. A note switched or relocked while the dialog was up is never printed
  // under the wrong name.
  ipcMain.handle('app:pdfPath', async (_e, id) => {
    const note = store.publicNote(store.get(id));
    if (!note) return { ok: false, error: 'Note not found' };
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save as PDF',
      defaultPath: path.join(app.getPath('documents'), H.safeFilename(H.deriveTitle(note)) + '.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    return { ok: true, filePath };
  });
  ipcMain.handle('app:writePdf', async (e, filePath) => {
    if (typeof filePath !== 'string' || !/\.pdf$/i.test(filePath)) return { ok: false, error: 'Not a PDF path' };
    try {
      // The print stylesheet leaves only the note on the page.
      const data = await e.sender.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } });
      fs.writeFileSync(filePath, data);
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('app:exportHtml', async (_e, id, bodyHtml) => {
    const note = store.get(id);
    if (!note) return { ok: false, error: 'Note not found' };
    const title = H.deriveTitle(note) || 'Note';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save as HTML',
      defaultPath: path.join(app.getPath('documents'), H.safeFilename(title) + '.html'),
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, convert.htmlDocument(title, (note.title ? '<h1>' + convert.escHtml(note.title) + '</h1>\n' : '') + String(bodyHtml || '')), 'utf8');
    return { ok: true, filePath };
  });

  // ---- books: export or print the whole book as one document ----------------------
  // The renderer assembles the book (it owns the Markdown renderer); this saves or prints it.
  // data: { name, markdown, html }. format: md | html | pdf | print.
  const BOOK_CSS = '.book-toc{border:2px solid #2a1a12;border-radius:10px;padding:10px 18px;margin:0 0 32px}.book-toc h2{margin:.2em 0 .4em;font-size:1.1em}.book-page{margin-bottom:40px}.book-page>h2{border-bottom:2px dashed #c9b8a8;padding-bottom:6px}@media print{body{background:#fff;margin:0;max-width:none}.book-page{break-before:page}.book-page:first-of-type{break-before:auto}}';
  // Renders an HTML page in a hidden window and hands the window to fn. Scripts are off unless opts.javascript.
  // opts.isolated: the page comes from an opened file, so it runs in its own in-memory session that can load
  // nothing but local files and data: URLs (no beacons, no remote pictures), and cannot navigate or open windows.
  // opts.readDir: the one folder an isolated page may load files from (the original file's), besides the page itself
  // and opts.allowFiles; it gives up after opts.timeoutMs.
  async function withHiddenPage(doc, opts, fn) {
    const tmp = path.join(app.getPath('temp'), 'notes-page-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.html');
    let w = null, timer = null, contentsId = null;
    try {
      fs.writeFileSync(tmp, doc, 'utf8');
      const webPreferences = { javascript: !!opts.javascript, sandbox: true, contextIsolation: true };
      if (opts.isolated) webPreferences.session = isolatedSession();
      // Parented to the main window so the print dialog comes up in front of it.
      w = new BrowserWindow({ show: false, parent: win || undefined, webPreferences });
      contentsId = w.webContents.id;
      if (opts.isolated) {
        isolatedAccess.set(contentsId, { page: tmp, files: opts.allowFiles || [], dir: opts.readDir || null });
        w.webContents.on('will-navigate', (e) => e.preventDefault());
        w.webContents.on('will-frame-navigate', (e) => { if (e.isMainFrame && e.url !== require('url').pathToFileURL(tmp).href) e.preventDefault(); });
        w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      }
      const work = (async () => { await w.loadFile(tmp); return fn(w); })();
      if (!opts.timeoutMs) return await work;
      return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('the page took too long to render')), opts.timeoutMs); })]);
    } finally {
      clearTimeout(timer);
      isolatedAccess.delete(contentsId);
      if (w && !w.isDestroyed()) w.destroy();
      try { fs.unlinkSync(tmp); } catch (_) { /* never written, or already gone */ }
    }
  }
  // What each isolated page may load: data: URLs, its own page, the listed files, and files inside its folder.
  // Never the network, and never a file: URL with a host, which Windows would fetch over SMB and so send the login.
  const isolatedAccess = new Map(); // webContents id -> { page, files, dir }
  let convertSession = null;
  function isolatedSession() {
    if (!convertSession) {
      convertSession = session.fromPartition('notes-isolated-pages');
      convertSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !isolatedRequestAllowed(d) }));
    }
    return convertSession;
  }
  function isolatedRequestAllowed(d) {
    if (/^data:/i.test(d.url)) return true;
    const access = isolatedAccess.get(d.webContentsId);
    if (!access || !/^file:\/\/\//i.test(d.url)) return false;
    let file;
    try { file = require('url').fileURLToPath(d.url); } catch (_) { return false; }
    const same = (a) => path.resolve(a).toLowerCase() === path.resolve(file).toLowerCase();
    if (same(access.page) || access.files.some(same)) return true;
    // From the folder only what a page shows as part of itself; never a frame or an embedded document.
    return ['image', 'stylesheet', 'font', 'media'].includes(d.resourceType) && !!access.dir && convert.isInside(file, access.dir);
  }
  const RENDER_TIMEOUT_MS = 2 * 60 * 1000;
  const PDF_OPTIONS = { printBackground: true, pageSize: 'A4', margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } };
  // Relative links and pictures in a converted page resolve against the original file's folder.
  // The CSP repeats the request filter inside the page (defence in depth: it also stops DNS prefetch and preconnect).
  const ISOLATED_CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src file: data:; style-src \'unsafe-inline\' file:; font-src file: data:; media-src file: data:">';
  function withBase(doc, baseDir) {
    const head = ISOLATED_CSP + '<meta http-equiv="x-dns-prefetch-control" content="off"><base href="' + convert.escHtml(require('url').pathToFileURL(baseDir + path.sep).href) + '">';
    if (/<head(\s[^>]*)?>/i.test(doc)) return doc.replace(/<head(\s[^>]*)?>/i, (m) => m + head);
    // No <head>: put one after the doctype (or <html>), so the page keeps standards mode.
    const at = /^\s*(<!doctype[^>]*>)?\s*(<html(\s[^>]*)?>)?/i.exec(doc)[0].length;
    return doc.slice(0, at) + '<head>' + head + '</head>' + doc.slice(at);
  }

  // Word to PDF: the document laid out by docx-preview, as the app shows it, then printed.
  const DOCX_BUNDLE_PATH = path.join(__dirname, 'renderer', 'vendor', 'docx.bundle.js');
  const DOCX_BUNDLE_URL = require('url').pathToFileURL(DOCX_BUNDLE_PATH).href;
  const DOCX_PRINT_PAGE = '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src file:; style-src \'unsafe-inline\'; img-src data:; font-src data:">'
    + '<style>html, body { margin: 0; background: #fff; }</style><script src="' + DOCX_BUNDLE_URL + '"></script></head><body></body></html>';
  // Runs in the hidden page. When Word recorded where its pages break, each rendered section is one page and is
  // printed as one, headers and footers included. Otherwise the text flows across pages with the document's
  // margins, and headers and footers (which would show only once) are left out.
  function docxPrintScript(b64) {
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
    html: (doc, baseDir) => withHiddenPage(withBase(doc, baseDir), { isolated: true, readDir: baseDir, timeoutMs: RENDER_TIMEOUT_MS }, (w) => w.webContents.printToPDF(PDF_OPTIONS)),
    docx: (bytes) => withHiddenPage(DOCX_PRINT_PAGE, { isolated: true, javascript: true, allowFiles: [DOCX_BUNDLE_PATH], timeoutMs: RENDER_TIMEOUT_MS }, async (w) => {
      const r = await w.webContents.executeJavaScript(docxPrintScript(bytes.toString('base64')));
      const pdf = await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      return { pdf, warning: r && r.flowed ? 'This document does not record where its pages break, so its headers and footers were left out.' : '' };
    }),
  };
  ipcMain.handle('files:convertOptions', (_e, id) => convert.options(store.get(id)));
  // An opened file as Markdown, for the book reader and book export (Word pictures inlined, PDF text only).
  ipcMain.handle('files:asMarkdown', async (_e, id) => {
    const n = store.get(id);
    if (!convert.sourceOf(n)) return { ok: false, error: 'this kind of file has no text to show' };
    // The book reader and its exports load pictures, so a page made from a file keeps only its inlined ones; a picture
    // on the web or a network share becomes its description.
    try { return { ok: true, markdown: convert.inlinePicturesOnly((await convert.toMarkdown(n)).markdown) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('files:convert', async (_e, id, to) => {
    try { return Object.assign({ ok: true }, await convert.convertFile(store.get(id), to, printers)); }
    catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('book:export', async (_e, format, data) => {
    data = data || {};
    const name = String(data.name || 'Book');
    const doc = () => convert.htmlDocument(name, String(data.html || ''), BOOK_CSS);
    try {
      if (format === 'print') {
        if (process.env.NOTES_APP_DRY_PRINT) return { ok: true, dry: true };
        return await withHiddenPage(doc(), {}, (w) => new Promise((resolve) => {
          // Electron sometimes never calls back (no printer, a lost dialog); give up after 10 minutes so the
          // hidden window and its temp file are not kept forever.
          const timer = setTimeout(() => resolve({ ok: false, error: 'the print dialog did not answer' }), 10 * 60 * 1000);
          w.webContents.print({ printBackground: true }, (ok, reason) => { clearTimeout(timer); resolve(ok ? { ok: true } : { ok: false, canceled: reason === 'cancelled', error: reason }); });
        }));
      }
      const ext = { md: 'md', html: 'html', pdf: 'pdf' }[format];
      if (!ext) return { ok: false, error: 'Unknown format' };
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
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

  ipcMain.handle('app:exportAll', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export all notes',
      defaultPath: path.join(app.getPath('documents'), 'notes-export-' + new Date().toISOString().slice(0, 10) + '.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, store.exportAll(), 'utf8');
    return { ok: true, filePath };
  });

  // ---- per-note version history (from the git snapshots of notes.json) ------------
  ipcMain.handle('history:versions', async (_e, id, limit) => {
    const note = store.get(id);
    if (!note) return { ok: false, error: 'Note not found' };
    if (note.lock) return { ok: false, error: 'History is not shown for locked notes.' };
    if (!store.settings.gitEnabled) return { ok: false, error: 'History is off. Turn on "Commit every change to a git repo" in Settings.' };
    const commits = await git.history(Math.min(200, Math.max(1, limit || 80)));
    const versions = [];
    let lastBody = null;
    for (const c of commits) {
      const text = await git.showNotesAt(c.hash);
      if (!text) continue;
      let snap;
      try { snap = JSON.parse(text); } catch (_) { continue; }
      const n = (snap.notes || []).find((x) => x.id === id);
      if (!n || typeof n.body !== 'string' || n.lock) continue;
      if (n.body === lastBody) continue; // the same text committed again (another note changed)
      lastBody = n.body;
      versions.push({ hash: c.hash, at: c.at, title: n.title || '', body: n.body, chars: n.body.length });
    }
    return { ok: true, versions, current: note.body };
  });

  // ---- attachments: files the app keeps next to the notes -----------------------
  const ATTACH_DIR = path.join(DATA_DIR, 'attachments');
  const safeAttachmentName = (name) => {
    const s = String(name || '');
    const base = path.basename(s);
    // A plain file name: no separators, no drive or stream colon, not all dots, no trailing dot or space
    // (Windows strips those and would resolve "setup.exe." to setup.exe).
    if (!base || base !== s || /^\.+$/.test(base) || /[:\u0000-\u001f]/.test(base) || /[. ]$/.test(base)) return null;
    return base;
  };
  function addAttachment(srcPath) {
    fs.mkdirSync(ATTACH_DIR, { recursive: true });
    const ext = path.extname(srcPath);
    const stem = H.safeFilename(path.basename(srcPath, ext)) || 'file';
    let name = stem + ext, i = 2;
    while (fs.existsSync(path.join(ATTACH_DIR, name))) { name = stem + ' ' + i + ext; i++; }
    fs.copyFileSync(srcPath, path.join(ATTACH_DIR, name));
    return { name, href: 'attachment://' + encodeURIComponent(name), size: fs.statSync(path.join(ATTACH_DIR, name)).size };
  }
  ipcMain.handle('attachments:pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: 'Attach files', properties: ['openFile', 'multiSelections'] });
    if (canceled || !filePaths.length) return [];
    return filePaths.map((p) => { try { return addAttachment(p); } catch (err) { return { error: err.message, name: path.basename(p) }; } });
  });
  ipcMain.handle('attachments:addPaths', (_e, paths) => (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string').map((p) => { try { return addAttachment(p); } catch (err) { return { error: err.message, name: path.basename(p) }; } }));
  ipcMain.handle('attachments:saveRecording', (_e, bytes, ext) => {
    fs.mkdirSync(ATTACH_DIR, { recursive: true });
    const clean = /^[a-z0-9]{1,5}$/i.test(String(ext)) ? String(ext).toLowerCase() : 'webm';
    const stamp = H.fileStamp().slice(0, 19);
    let name = 'Recording ' + stamp + '.' + clean;
    for (let i = 2; fs.existsSync(path.join(ATTACH_DIR, name)); i++) name = 'Recording ' + stamp + ' ' + i + '.' + clean; // two in one second
    fs.writeFileSync(path.join(ATTACH_DIR, name), Buffer.from(bytes));
    return { name, href: 'attachment://' + encodeURIComponent(name), size: Buffer.from(bytes).length };
  });
  ipcMain.handle('attachments:open', async (_e, href) => {
    const raw = String(href || '').replace(/^attachment:\/\//i, '');
    let name;
    try { name = safeAttachmentName(decodeURIComponent(raw)); } catch (_) { name = null; }
    if (!name) return 'Not an attachment link';
    const full = path.join(ATTACH_DIR, name);
    if (path.dirname(full) !== ATTACH_DIR || !fs.existsSync(full)) return 'Attachment not found: ' + name;
    return openSafely(full);
  });
  ipcMain.handle('attachments:reveal', (_e, href) => {
    const raw = String(href || '').replace(/^attachment:\/\//i, '');
    let name; try { name = safeAttachmentName(decodeURIComponent(raw)); } catch (_) { name = null; }
    const full = name ? path.join(ATTACH_DIR, name) : null;
    if (full && fs.existsSync(full)) shell.showItemInFolder(full);
    return !!(full && fs.existsSync(full));
  });

  ipcMain.handle('app:importMarkdown', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import Markdown or text files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown / Text', extensions: ['md', 'markdown', 'txt'] }],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true, count: 0 };
    let first = null;
    let count = 0;
    const failed = [];
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

  // ---- lifecycle -----------------------------------------------------------

  app.on('second-instance', () => showWindow());
  let quitPrepared = false;
  // Asks one window to write any pending edit and waits for its own flush-done (not another window's).
  function flushWindow(w, ms) {
    return new Promise((resolve) => {
      if (!w || w.isDestroyed()) return resolve();
      const id = w.webContents.id;
      const done = (e) => { if (e.sender.id === id) finish(); };
      const timer = setTimeout(finish, ms);
      function finish() { clearTimeout(timer); ipcMain.removeListener('app:flush-done', done); resolve(); }
      ipcMain.on('app:flush-done', done);
      try { w.webContents.send('app:flush'); } catch (_) { finish(); }
    });
  }

  app.on('before-quit', (e) => {
    quitting = true;
    if (quitPrepared) return;
    quitPrepared = true;
    // Let the renderer flush an in-flight edit, then finish any pending git commit, then quit for real.
    e.preventDefault();
    // The main window may be writing a PDF's edits, which takes longer than a note.
    const rendererFlushed = Promise.all([flushWindow(win, 5000), stickies.flushAll((w) => flushWindow(w, 800))]);
    // After the renderer's write has landed, commit it; cap the git step so an unreachable remote
    // cannot keep the tray icon alive for a minute after Quit.
    rendererFlushed
      .then(() => Promise.race([Promise.all([git.flush(), vaults.flushAll()].concat(Array.from(live.sessions.keys()).map((id) => live.flush(id)))), new Promise((r) => setTimeout(r, 8000))]))
      .catch(() => {})
      .finally(() => { reminders.stop(); if (botChild) killTree(botChild); for (const s of live.sessions.values()) { if (s.role === 'host') { try { s.server.close(); } catch (_) { /* ignore */ } } } vaults.closeAll(); stickies.closeAll(); app.quit(); });
  });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); writeRuntime({ visible: false, exiting: true }); });
  app.on('window-all-closed', () => { /* stay alive in the tray */ });
  app.on('activate', showWindow);

  nativeTheme.on('updated', () => {
    if (win && !win.isDestroyed()) {
      win.setBackgroundColor(windowColors().background);
      win.webContents.send('theme:system', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    }
    stickies.broadcast('settings:changed', store.getSettings());
  });

  app.whenReady().then(() => {
    const step = (name, fn) => { try { fn(); } catch (err) { console.error('[startup] ' + name + ' failed:', err); } };
    step('crafts', () => { craftsReady = crafts.serve(protocol); });
    step('theme', applyTheme);
    step('window', createWindow);
    if (!win) step('window (defaults)', () => { store.setSettings({ window: null }); createWindow(); });
    step('tray', createTray);
    step('hotkey', () => registerHotkey(store.settings.hotkey));
    step('login item', applyLoginItem);
    git.configure(store.settings).then(() => { if (store.settings.gitEnabled) git.noteChanged(); }).catch(() => {});
    vaults.start().catch((err) => console.error('[vaults] start failed', err));
    step('stickies', () => stickies.restoreAll());
    step('reminders', () => reminders.start());
    live.restore().catch((err) => console.error('[live] restore failed', err));
  });
}
