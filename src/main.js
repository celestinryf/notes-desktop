'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, dialog, shell, nativeTheme, screen } = require('electron');
const { Store } = require('./store');
const { GitSync } = require('./gitSync');
const { VaultManager } = require('./vaults');
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
  const vaults = new VaultManager(store, {
    debounceMs: Number(process.env.NOTES_APP_VAULT_DEBOUNCE_MS) || 8000,
    onChange: (id, status) => { if (win && !win.isDestroyed()) win.webContents.send('vault:status', { id, status }); },
    onNotesChanged: () => { lastContentHash = contentHash(); if (win && !win.isDestroyed()) win.webContents.send('notes:reloaded', { reason: 'vault' }); },
  });
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
      git.flush().catch(() => {});
    });
    win.on('hide', () => writeRuntime());
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
      if (win && !win.isDestroyed()) { win.webContents.send('settings:changed', store.getSettings()); win.webContents.send('notes:reloaded', { reason: 'recovered' }); }
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
    if (win && !win.isDestroyed()) win.setBackgroundColor(THEME_BG[effectiveTheme()]);
  }

  function refreshTray() {
    if (!tray) return;
    const hk = hotkeyState.registered ? H.displayAccelerator(hotkeyState.hotkey) : 'hotkey unavailable';
    tray.setToolTip('Notes  (' + hk + ')');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show / hide notes', accelerator: hotkeyState.registered ? hotkeyState.hotkey : undefined, click: toggleWindow },
      { label: 'New note', click: requestNewNote },
      { type: 'separator' },
      { label: 'Start at login', type: 'checkbox', checked: !!store.settings.openAtLogin, click: (item) => { try { store.setSettings({ openAtLogin: item.checked }); applyLoginItem(); } catch (_) { /* paused */ } broadcastSettings(); refreshTray(); } },
      { label: 'Always on top', type: 'checkbox', checked: !!store.settings.alwaysOnTop, click: (item) => { try { store.setSettings({ alwaysOnTop: item.checked }); if (win) win.setAlwaysOnTop(item.checked); } catch (_) { /* paused */ } broadcastSettings(); refreshTray(); } },
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
      documentsDir: app.getPath('documents'),
      saveBlocked: !!store.saveBlocked,
      recoveredNotes: store.recoveredFromBackup ? store.notes.length : null,
    };
  }

  // ---- IPC ----------------------------------------------------------------

  ipcMain.handle('notes:list', (_e, opts) => store.list(opts));
  ipcMain.handle('notes:get', (_e, id) => store.get(id));
  ipcMain.handle('notes:create', (_e, data) => {
    data = data || {};
    const folder = data.folderId ? store.getFolder(data.folderId) : null;
    const note = folder && folder.vaultId ? store.createVaultNote(folder.id, data) : store.create(data);
    if (note.vaultId) vaults.noteChanged(note.vaultId);
    return note;
  });
  ipcMain.handle('notes:update', (_e, id, patch) => {
    const note = store.update(id, patch);
    if (note && note.vaultId) vaults.noteChanged(note.vaultId);
    return note;
  });
  ipcMain.handle('notes:togglePin', (_e, id) => store.togglePin(id));
  ipcMain.handle('notes:duplicate', (_e, id) => store.duplicate(id));
  ipcMain.handle('notes:trash', (_e, id) => store.trash(id));
  ipcMain.handle('notes:restore', (_e, id) => store.restore(id));
  ipcMain.handle('notes:destroy', (_e, id) => store.destroy(id));
  ipcMain.handle('notes:emptyTrash', () => store.emptyTrash());
  ipcMain.handle('notes:tags', () => store.tags());
  ipcMain.handle('notes:counts', () => store.counts());

  // ---- file-backed notes ---------------------------------------------------

  async function linkPaths(paths, opts) {
    const linked = [];
    const failed = [];
    for (const p of paths) {
      try { linked.push(await store.linkFile(p, opts)); }
      catch (err) { failed.push(path.basename(p) + ' (' + (err.code || err.message) + ')'); }
    }
    return { ok: linked.length > 0, linked: linked.map((n) => n.id), failed, firstId: linked.length ? linked[0].id : null };
  }

  ipcMain.handle('files:openDialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Open files as notes',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Notes and documents', extensions: ['md', 'markdown', 'txt', 'tex', 'latex', 'pdf', 'docx', 'json', 'yaml', 'yml', 'csv', 'log'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true, linked: [], failed: [] };
    return linkPaths(filePaths);
  });
  ipcMain.handle('files:link', (_e, paths, opts) => linkPaths(Array.isArray(paths) ? paths : [], opts || {}));
  ipcMain.handle('files:refresh', (_e, id) => store.refreshFileNote(id));
  ipcMain.handle('files:reveal', (_e, id) => { const n = store.get(id); if (n && n.filePath) shell.showItemInFolder(n.filePath); });
  ipcMain.handle('files:openExternal', async (_e, id) => { const n = store.get(id); return n && n.filePath ? shell.openPath(n.filePath) : 'No file'; });
  ipcMain.handle('files:pdfUrl', (_e, id) => { const n = store.get(id); return n && n.filePath && n.fileKind === 'pdf' ? require('url').pathToFileURL(n.filePath).href : null; });

  const { discoverAgentFiles } = require('./files');
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
    const v = store.addVault({ path: dest, name: safe, remote: url });
    await vaults.initRepo(v.id, url); // ensures .gitignore (.trash) in a freshly cloned vault
    await vaults.open(v.id, { pull: false });
    return { ok: true, vault: vaultView(v) };
  });
  ipcMain.handle('vaults:update', async (_e, id, patch) => { const v = store.updateVault(id, patch); if (v) { vaults.schedulePull(id); if (patch && patch.remote !== undefined) await vaults.initRepo(id, patch.remote); } return v ? vaultView(v) : null; });
  ipcMain.handle('vaults:remove', (_e, id) => { vaults.close(id); return store.removeVault(id); });
  ipcMain.handle('vaults:sync', (_e, id) => vaults.sync(id, 'manual'));
  ipcMain.handle('vaults:scan', async (_e, id) => { const r = await store.scanVault(id); lastContentHash = contentHash(); return r; });
  ipcMain.handle('vaults:initRepo', (_e, id, remote) => vaults.initRepo(id, remote));
  ipcMain.handle('vaults:status', async (_e, id) => vaults.refreshRepoStatus(id));
  ipcMain.handle('vaults:openFolder', (_e, id) => { const v = store.getVault(id); return v ? shell.openPath(v.path) : 'No vault'; });

  // ---- bot: Claude Code over the notes -------------------------------------

  const workspace = require('./workspace');
  const WORKSPACE_DIR = path.join(DATA_DIR, 'workspace');
  const CLAUDE_BIN = process.env.NOTES_APP_CLAUDE_BIN || 'claude';
  let botChild = null;

  // Where the agent should work for the note in front of the user: the vault folder for vault notes, the
  // file's folder for other file notes, otherwise the exported workspace of plain notes.
  function botCwdFor(noteId) {
    const note = noteId ? store.get(noteId) : null;
    if (note && note.vaultId) { const v = store.getVault(note.vaultId); if (v) return { cwd: v.path, kind: 'vault', focus: path.relative(v.path, note.filePath) }; }
    if (note && note.filePath) return { cwd: path.dirname(note.filePath), kind: 'file', focus: path.basename(note.filePath) };
    const manifest = workspace.exportNotes(store, WORKSPACE_DIR);
    const entry = note ? manifest.files.find((f) => f.id === note.id) : null;
    return { cwd: WORKSPACE_DIR, kind: 'workspace', focus: entry ? entry.rel : null };
  }

  function botSend(type, data) {
    if (win && !win.isDestroyed()) win.webContents.send('bot:event', Object.assign({ type }, data || {}));
  }

  ipcMain.handle('bot:run', async (_e, opts) => {
    opts = opts || {};
    if (botChild) return { ok: false, error: 'A run is already in progress.' };
    const prompt = String(opts.prompt || '').trim();
    if (!prompt) return { ok: false, error: 'Type what you want done.' };
    let target;
    try { target = botCwdFor(opts.noteId); } catch (err) { return { ok: false, error: 'Could not prepare the workspace: ' + err.message }; }
    const intro = target.kind === 'workspace'
      ? 'You are working inside a folder of Markdown notes exported from a notes app. Each .md file is one note; folders mirror the app\'s folders. Edit files in place; create new .md files for new notes; do not create other file types.'
      : 'You are working inside the user\'s notes folder. Each Markdown file is a note.';
    const focusLine = target.focus ? ' The user is currently looking at "' + target.focus + '".' : '';
    const fullPrompt = intro + focusLine + '\n\nTask: ' + prompt;
    const allowed = opts.allowEdits === false ? 'Read,Glob,Grep' : 'Read,Glob,Grep,Edit,Write,MultiEdit';
    const args = ['-p', fullPrompt, '--output-format', 'text', '--permission-mode', 'dontAsk', '--allowedTools', allowed];
    botSend('start', { cwd: target.cwd, kind: target.kind, focus: target.focus });
    const { spawn } = require('child_process');
    let child;
    try {
      const env = Object.assign({}, process.env, { CLAUDE_CODE_NONINTERACTIVE: '1' });
      if (/\.js$/i.test(CLAUDE_BIN)) {
        // A script stand-in (tests): run it with this executable acting as plain Node.
        child = spawn(process.execPath, [CLAUDE_BIN].concat(args), { cwd: target.cwd, windowsHide: true, env: Object.assign(env, { ELECTRON_RUN_AS_NODE: '1' }) });
      } else {
        // `claude` on Windows is an npm .cmd shim, which needs a shell to resolve; a full path to an .exe does not.
        child = spawn(CLAUDE_BIN, args, { cwd: target.cwd, windowsHide: true, shell: process.platform === 'win32' && !/\.exe$/i.test(CLAUDE_BIN), env });
      }
    } catch (err) {
      botSend('end', { ok: false, error: err.message });
      return { ok: false, error: err.message };
    }
    botChild = child;
    child.stdout.on('data', (d) => botSend('out', { text: String(d) }));
    child.stderr.on('data', (d) => botSend('err', { text: String(d) }));
    child.on('error', (err) => { botSend('end', { ok: false, error: 'Could not start "' + CLAUDE_BIN + '": ' + err.message + '. Is Claude Code installed and on PATH?' }); botChild = null; });
    child.on('close', (code) => {
      botChild = null;
      let imported = null;
      if (target.kind === 'workspace') {
        try { imported = workspace.importNotes(store, WORKSPACE_DIR); } catch (err) { imported = { error: err.message }; }
      } else if (target.kind === 'vault') {
        const note = store.get(opts.noteId);
        if (note && note.vaultId) { store.scanVault(note.vaultId).then((r) => { if (r && (r.added || r.updated || r.removed)) botSend('reloaded', r); }).catch(() => {}); vaults.noteChanged(note.vaultId); }
      }
      lastContentHash = contentHash();
      if (store.settings.gitEnabled) git.noteChanged();
      botSend('end', { ok: code === 0, code, imported });
      if (win && !win.isDestroyed()) win.webContents.send('notes:reloaded', { reason: 'bot' });
    });
    return { ok: true, cwd: target.cwd, kind: target.kind };
  });
  ipcMain.handle('bot:cancel', () => { if (botChild) { try { botChild.kill(); } catch (_) { /* ignore */ } return true; } return false; });
  ipcMain.handle('bot:openTerminal', (_e, noteId) => {
    let target;
    try { target = botCwdFor(noteId); } catch (err) { return { ok: false, error: err.message }; }
    const { spawn } = require('child_process');
    try {
      // Prefer Windows Terminal; fall back to a PowerShell window. Both run the interactive Claude Code TUI.
      const hasWt = (() => { try { require('child_process').execFileSync('where', ['wt'], { stdio: 'ignore', windowsHide: true }); return true; } catch (_) { return false; } })();
      if (hasWt) spawn('wt', ['-d', target.cwd, 'powershell', '-NoExit', '-Command', CLAUDE_BIN], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      else spawn('powershell', ['-NoExit', '-Command', 'Set-Location -LiteralPath \'' + target.cwd.replace(/'/g, "''") + "'; " + CLAUDE_BIN], { detached: true, stdio: 'ignore', windowsHide: false, shell: false }).unref();
      return { ok: true, cwd: target.cwd, kind: target.kind };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('bot:importWorkspace', () => { const r = workspace.importNotes(store, WORKSPACE_DIR); lastContentHash = contentHash(); return r; });

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
  app.on('before-quit', (e) => {
    quitting = true;
    if (quitPrepared) return;
    quitPrepared = true;
    // Let the renderer flush an in-flight edit, then finish any pending git commit, then quit for real.
    e.preventDefault();
    const rendererFlushed = new Promise((resolve) => {
      if (!win || win.isDestroyed()) return resolve();
      const timer = setTimeout(resolve, 800);
      ipcMain.once('app:flush-done', () => { clearTimeout(timer); resolve(); });
      try { win.webContents.send('app:flush'); } catch (_) { clearTimeout(timer); resolve(); }
    });
    // After the renderer's write has landed, commit it; cap the git step so an unreachable remote
    // cannot keep the tray icon alive for a minute after Quit.
    rendererFlushed
      .then(() => Promise.race([Promise.all([git.flush(), vaults.flushAll()]), new Promise((r) => setTimeout(r, 8000))]))
      .catch(() => {})
      .finally(() => { vaults.closeAll(); app.quit(); });
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
    const step = (name, fn) => { try { fn(); } catch (err) { console.error('[startup] ' + name + ' failed:', err); } };
    step('theme', applyTheme);
    step('window', createWindow);
    if (!win) step('window (defaults)', () => { store.setSettings({ window: null }); createWindow(); });
    step('tray', createTray);
    step('hotkey', () => registerHotkey(store.settings.hotkey));
    step('login item', applyLoginItem);
    git.configure(store.settings).then(() => { if (store.settings.gitEnabled) git.noteChanged(); }).catch(() => {});
    vaults.start().catch((err) => console.error('[vaults] start failed', err));
  });
}
