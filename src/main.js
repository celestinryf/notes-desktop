'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, dialog, shell, nativeTheme, screen } = require('electron');
const { Store } = require('./store');
const { GitSync } = require('./gitSync');
const { drawIconBitmap } = require('./icon');
const crypto = require('crypto');
const H = require('./shared/helpers');

const APP_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.NOTES_APP_DATA_DIR || path.join(app.getPath('appData'), 'notes-app');
const START_HIDDEN = process.argv.includes('--hidden') || process.env.NOTES_APP_START_HIDDEN === '1';
// Test harnesses set this so the window never takes keyboard focus away from whoever is using the machine.
const SHOW_INACTIVE = process.env.NOTES_APP_INACTIVE === '1';
const MANAGE_LOGIN_ITEM = process.env.NOTES_APP_NO_LOGIN_ITEM !== '1';
const HOTKEY_FALLBACKS = ['CommandOrControl+Alt+N', 'CommandOrControl+Shift+Alt+N', 'CommandOrControl+Alt+J', 'CommandOrControl+Alt+F12'];
const THEME_BG = { light: '#fbf1e4', dark: '#1b120d' };

app.setName('Notes');
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
  let lastContentHash = contentHash();
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
  let hotkeyState = { hotkey: store.settings.hotkey, registered: false };
  let boundsTimer = null;

  const iconImage = () => nativeImage.createFromBitmap(drawIconBitmap(32), { width: 32, height: 32 });

  function writeRuntime(extra) {
    const data = Object.assign({
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

  function safeBounds(saved) {
    const def = { width: 1100, height: 720 };
    if (!saved) return def;
    const area = screen.getDisplayMatching(saved).workArea;
    const fits = saved.x >= area.x - 50 && saved.y >= area.y - 50 && saved.x < area.x + area.width - 100 && saved.y < area.y + area.height - 100;
    return fits ? saved : { width: saved.width, height: saved.height };
  }

  function createWindow() {
    win = new BrowserWindow(Object.assign({
      minWidth: 760,
      minHeight: 480,
      show: false,
      autoHideMenuBar: true,
      title: 'Notes',
      icon: iconImage(),
      backgroundColor: THEME_BG[effectiveTheme()],
      alwaysOnTop: store.settings.alwaysOnTop,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
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
          store.setSettings({ window: win.getBounds() });
        }
      }, 400);
    };
    win.on('resize', persistBounds);
    win.on('move', persistBounds);
    win.on('show', () => writeRuntime());
    win.on('hide', () => writeRuntime());
    win.on('focus', () => writeRuntime());
    win.on('blur', () => writeRuntime());

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); }
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

  function showWindow() {
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
    if (win && !win.isDestroyed()) win.setBackgroundColor(THEME_BG[effectiveTheme()]);
  }

  function refreshTray() {
    if (!tray) return;
    const hk = hotkeyState.registered ? H.displayAccelerator(hotkeyState.hotkey) : 'hotkey unavailable';
    tray.setToolTip('Notes  (' + hk + ')');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show / hide notes', accelerator: hotkeyState.registered ? hotkeyState.hotkey : undefined, click: toggleWindow },
      { label: 'New note', click: () => { showWindow(); win.webContents.send('app:new-note'); } },
      { type: 'separator' },
      { label: 'Start at login', type: 'checkbox', checked: !!store.settings.openAtLogin, click: (item) => { store.setSettings({ openAtLogin: item.checked }); applyLoginItem(); broadcastSettings(); } },
      { label: 'Always on top', type: 'checkbox', checked: !!store.settings.alwaysOnTop, click: (item) => { store.setSettings({ alwaysOnTop: item.checked }); if (win) win.setAlwaysOnTop(item.checked); broadcastSettings(); } },
      { label: 'Open data folder', click: () => shell.openPath(DATA_DIR) },
      { type: 'separator' },
      { label: 'Quit Notes', click: () => { quitting = true; app.quit(); } },
    ]));
  }

  function createTray() {
    tray = new Tray(iconImage());
    tray.on('click', toggleWindow);
    tray.on('double-click', showWindow);
    refreshTray();
  }

  function broadcastSettings() {
    if (win && !win.isDestroyed()) win.webContents.send('settings:changed', store.getSettings());
  }

  function info() {
    return {
      version: app.getVersion(),
      dataDir: DATA_DIR,
      hotkey: hotkeyState.hotkey,
      hotkeyRegistered: hotkeyState.registered,
      hotkeyFallback: !!hotkeyState.fallback,
      hotkeyDisplay: H.displayAccelerator(hotkeyState.hotkey),
      platform: process.platform,
      loadError: store.loadError ? String(store.loadError.message || store.loadError) : null,
    };
  }

  // ---- IPC ----------------------------------------------------------------

  ipcMain.handle('notes:list', (_e, opts) => store.list(opts));
  ipcMain.handle('notes:get', (_e, id) => store.get(id));
  ipcMain.handle('notes:create', (_e, data) => store.create(data));
  ipcMain.handle('notes:update', (_e, id, patch) => store.update(id, patch));
  ipcMain.handle('notes:togglePin', (_e, id) => store.togglePin(id));
  ipcMain.handle('notes:duplicate', (_e, id) => store.duplicate(id));
  ipcMain.handle('notes:trash', (_e, id) => store.trash(id));
  ipcMain.handle('notes:restore', (_e, id) => store.restore(id));
  ipcMain.handle('notes:destroy', (_e, id) => store.destroy(id));
  ipcMain.handle('notes:emptyTrash', () => store.emptyTrash());
  ipcMain.handle('notes:tags', () => store.tags());
  ipcMain.handle('notes:counts', () => store.counts());

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
    const settings = store.setSettings(patch);
    if (settings.theme !== before.theme) applyTheme();
    if (settings.alwaysOnTop !== before.alwaysOnTop && win) win.setAlwaysOnTop(settings.alwaysOnTop);
    if (settings.openAtLogin !== before.openAtLogin) applyLoginItem();
    if (settings.gitEnabled !== before.gitEnabled || settings.gitRemote !== before.gitRemote) {
      await git.configure(settings);
      if (settings.gitEnabled) git.noteChanged();
    }
    refreshTray();
    return { settings, info: info(), error };
  });

  ipcMain.handle('git:status', () => git.status());
  ipcMain.handle('git:commit', () => git.commit('manual commit'));
  ipcMain.handle('git:push', () => git.push());
  ipcMain.handle('git:history', (_e, limit) => git.history(limit));

  ipcMain.handle('app:info', () => info());
  ipcMain.handle('app:hide', () => hideWindow());
  // The first 'app:shown' can be sent before the renderer has registered its listener (ready-to-show fires
  // before the scripts finish). Once the renderer is ready it asks, and we replay the signal if visible.
  ipcMain.handle('app:rendererReady', () => {
    const visible = !!(win && !win.isDestroyed() && win.isVisible());
    if (visible) win.webContents.send('app:shown');
    return { visible };
  });
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

  ipcMain.handle('app:importMarkdown', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import Markdown or text files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown / Text', extensions: ['md', 'markdown', 'txt'] }],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true, count: 0 };
    let first = null;
    for (const fp of filePaths) {
      const note = store.importMarkdown(path.basename(fp), fs.readFileSync(fp, 'utf8'));
      if (!first) first = note;
    }
    return { ok: true, count: filePaths.length, firstId: first && first.id };
  });

  // ---- lifecycle -----------------------------------------------------------

  app.on('second-instance', () => showWindow());
  let gitFlushed = false;
  app.on('before-quit', (e) => {
    quitting = true;
    if (!gitFlushed && git.status().pending) {
      // Finish the pending commit before the process goes away, then quit for real.
      e.preventDefault();
      git.flush().catch(() => {}).finally(() => { gitFlushed = true; app.quit(); });
    }
  });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); writeRuntime({ visible: false, exiting: true }); });
  app.on('window-all-closed', () => { /* stay alive in the tray */ });
  app.on('activate', showWindow);

  nativeTheme.on('updated', () => {
    if (win && !win.isDestroyed()) {
      win.setBackgroundColor(THEME_BG[effectiveTheme()]);
      win.webContents.send('theme:system', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    }
  });

  app.whenReady().then(() => {
    applyTheme();
    createWindow();
    createTray();
    registerHotkey(store.settings.hotkey);
    applyLoginItem();
    git.configure(store.settings).then(() => { if (store.settings.gitEnabled) git.noteChanged(); }).catch(() => {});
  });
}
