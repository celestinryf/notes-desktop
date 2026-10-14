'use strict';
/* Drives the real app through every UI feature with Playwright's Electron launcher.
   Native file dialogs are stubbed inside the main process so export and import actually write and read files.
   Run with: npm run test:ui */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { _electron: electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON_PATH = require('electron');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-ui-'));
const notesFile = path.join(dataDir, 'notes.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readNotes = () => JSON.parse(fs.readFileSync(notesFile, 'utf8'));
const findNote = (title) => readNotes().notes.find((n) => n.title === title);

async function waitFor(label, fn, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error('Timed out: ' + label);
}

let app, page;
const rendererErrors = [];
// The renderer's CSP forbids eval, which page.waitForFunction relies on; page.evaluate goes through CDP and is allowed.
const waitForDom = (fn, arg) => waitFor('DOM condition ' + fn.toString().slice(0, 80), () => page.evaluate(fn, arg));

test.before(async () => {
  fs.writeFileSync(notesFile, JSON.stringify({ settings: { hotkey: 'Control+Alt+Shift+F8', openAtLogin: false, theme: 'light' }, notes: [] }));
  app = await electron.launch({
    executablePath: ELECTRON_PATH,
    args: [ROOT],
    env: Object.assign({}, process.env, { NOTES_APP_DATA_DIR: dataDir, NOTES_APP_NO_LOGIN_ITEM: '1' }),
  });
  page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') rendererErrors.push(m.text()); });
  page.on('pageerror', (e) => rendererErrors.push('pageerror: ' + e.message));
  await page.waitForSelector('#app');
  await page.evaluate(() => { window.confirm = () => true; });
});

test.after(async () => {
  // The window's close handler hides to the tray, so ask the app to exit instead of closing windows.
  if (app) {
    await app.evaluate(({ app: a }) => setTimeout(() => a.exit(0), 50)).catch(() => {});
    await Promise.race([app.waitForEvent('close'), sleep(5000)]).catch(() => {});
    await app.close().catch(() => {});
  }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
});

async function typeNote(title, body) {
  await page.click('#newNoteBtn');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', title);
  await page.fill('#bodyInput', body);
  await waitFor('note "' + title + '" saved', () => { const n = findNote(title); return n && n.body === body; });
  return findNote(title);
}

test('first run opens on a fresh note and typing autosaves', async () => {
  await waitForDom(() => !document.getElementById('editor').classList.contains('hidden'));
  await page.fill('#titleInput', 'Alpha');
  await page.fill('#bodyInput', 'first body');
  await waitFor('Alpha saved', () => { const n = findNote('Alpha'); return n && n.body === 'first body'; });
  assert.equal(await page.textContent('#statusSaved'), 'Saved');
  assert.match(await page.textContent('#statusWords'), /2 words/);
});

test('search filters and highlights; clearing restores', async () => {
  await typeNote('Beta', 'kiwi and mango');
  await typeNote('Gamma', 'pure text');
  await page.fill('#searchInput', 'MANGO');
  await waitForDom(() => document.querySelectorAll('.note-card').length === 1);
  assert.equal(await page.textContent('.note-card .note-card-title'), 'Beta');
  assert.ok(await page.$('.note-card .mark'), 'match highlighted');
  assert.equal(await page.textContent('#listTitle'), 'Results');
  await page.fill('#searchInput', 'nothing-matches-this');
  await waitForDom(() => !document.getElementById('listEmpty').classList.contains('hidden'));
  await page.fill('#searchInput', '');
  await waitForDom(() => document.querySelectorAll('.note-card').length === 3);
});

test('sort options reorder the list', async () => {
  await page.selectOption('#sortSelect', 'title');
  await waitForDom(() => document.querySelector('.note-card .note-card-title').textContent === 'Alpha');
  const titles = await page.$$eval('.note-card .note-card-title', (els) => els.map((e) => e.textContent));
  assert.deepEqual(titles, ['Alpha', 'Beta', 'Gamma']);
  assert.equal(readNotes().settings.sort, 'title');
  await page.selectOption('#sortSelect', 'updated');
  await waitForDom(() => document.querySelector('.note-card .note-card-title').textContent === 'Gamma');
});

test('pin button, pinned view, and pinned-first ordering', async () => {
  await page.click('.note-card:has-text("Alpha")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Alpha');
  await page.click('#pinBtn');
  await waitFor('Alpha pinned', () => findNote('Alpha').pinned);
  assert.equal(await page.textContent('#pinBtn'), '★');
  await waitForDom(() => document.querySelector('.note-card .note-card-title').textContent.includes('Alpha'));
  await page.click('.nav-item[data-view="pinned"]');
  await waitForDom(() => document.querySelectorAll('.note-card').length === 1);
  assert.equal(await page.textContent('#countPinned'), '1');
  await page.click('.nav-item[data-view="all"]');
  await waitForDom(() => document.querySelectorAll('.note-card').length === 3);
});

test('tags filter in the sidebar', async () => {
  await page.click('.note-card:has-text("Beta")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Beta');
  await page.fill('#tagsInput', 'Fruit, snacks');
  await page.press('#tagsInput', 'Enter');
  await waitFor('tags saved', () => findNote('Beta').tags.join(',') === 'fruit,snacks');
  await page.waitForSelector('#tagList .nav-item:has-text("fruit")');
  await page.click('#tagList .nav-item:has-text("fruit")');
  await waitForDom(() => document.querySelectorAll('.note-card').length === 1);
  assert.equal(await page.textContent('#listTitle'), '#fruit');
  await page.click('.nav-item[data-view="all"]');
  await waitForDom(() => document.querySelectorAll('.note-card').length === 3);
});

test('duplicate creates a copy and selects it', async () => {
  await page.click('.note-card:has-text("Gamma")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma');
  await page.click('#duplicateBtn');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  const copy = findNote('Gamma (copy)');
  assert.equal(copy.body, 'pure text');
  assert.equal(await page.textContent('#countAll'), '4');
});

test('Ctrl+B / Ctrl+I / Ctrl+K wrap the selection and toggle off again', async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await page.focus('#bodyInput');
  await page.evaluate(() => { const t = document.getElementById('bodyInput'); t.setSelectionRange(0, 4); });
  await page.keyboard.press('Control+b');
  assert.equal(await page.inputValue('#bodyInput'), '**pure** text');
  await page.keyboard.press('Control+b');
  assert.equal(await page.inputValue('#bodyInput'), 'pure text');
  await page.keyboard.press('Control+i');
  assert.equal(await page.inputValue('#bodyInput'), '_pure_ text');
  await page.keyboard.press('Control+i');
  await page.keyboard.press('Control+k');
  assert.equal(await page.inputValue('#bodyInput'), '[pure](url) text');
  await waitFor('wrap saved', () => findNote('Gamma (copy)').body === '[pure](url) text');
});

test('Tab indents, Shift+Tab outdents, Enter continues lists', async () => {
  await page.fill('#bodyInput', '- item one');
  await page.focus('#bodyInput');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('item two');
  await page.keyboard.press('Tab');
  assert.equal(await page.inputValue('#bodyInput'), '- item one\n- item two  ');
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  assert.equal(await page.inputValue('#bodyInput'), '- item one\n  - item two  ');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.inputValue('#bodyInput'), '- item one\n- item two  ');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  assert.equal(await page.inputValue('#bodyInput'), '- item one\n- item two  \n', 'empty bullet ends the list');
});

test('preview renders Markdown and checkbox clicks write back to the source', async () => {
  await page.fill('#bodyInput', '# Head\n\n- [ ] alpha\n- [x] beta\n\n[site](https://example.com)');
  await page.keyboard.press('Control+e');
  await page.waitForSelector('#preview:not(.hidden) h1');
  assert.equal(await page.textContent('#preview h1'), 'Head');
  assert.equal(await page.$$eval('#preview input[type=checkbox]', (b) => b.length), 2);
  await page.click('#preview input[type=checkbox] >> nth=0');
  await waitFor('checkbox toggled in source', () => findNote('Gamma (copy)').body.includes('- [x] alpha'));
  assert.equal(await page.$eval('#preview li.task-item >> nth=0', (li) => li.classList.contains('is-done')), true);
  await page.keyboard.press('Control+e');
  await page.waitForSelector('#bodyInput:not(.hidden)');
});

test('Alt+Arrow moves between notes', async () => {
  await page.click('.note-card >> nth=0');
  const first = await page.inputValue('#titleInput');
  await page.focus('#bodyInput');
  await page.keyboard.press('Alt+ArrowDown');
  await waitForDom((f) => document.getElementById('titleInput').value !== f, first);
  const second = await page.inputValue('#titleInput');
  await page.keyboard.press('Alt+ArrowUp');
  await waitForDom((f) => document.getElementById('titleInput').value === f, first);
  assert.notEqual(first, second);
});

test('trash with undo, restore, delete forever, empty trash', async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await page.click('#deleteBtn');
  await waitFor('trashed', () => findNote('Gamma (copy)').trashedAt);
  await page.click('#toast button:has-text("Undo")');
  await waitFor('undo restored', () => !findNote('Gamma (copy)').trashedAt);
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');

  await page.keyboard.press('Control+Delete');
  await waitFor('trashed again', () => findNote('Gamma (copy)').trashedAt);
  await page.click('.nav-item[data-view="trash"]');
  await waitForDom(() => document.querySelectorAll('.note-card').length === 1);
  assert.equal(await page.textContent('#listTitle'), 'Trash');
  assert.equal(await page.$eval('#titleInput', (i) => i.readOnly), true, 'trashed note is read only');
  assert.equal(await page.$eval('#restoreBtn', (b) => b.classList.contains('hidden')), false);
  await page.click('#restoreBtn');
  await waitFor('restored', () => !findNote('Gamma (copy)').trashedAt);
  await waitForDom(() => document.querySelectorAll('.note-card').length === 0);

  await page.click('.nav-item[data-view="all"]');
  await page.click('.note-card:has-text("Gamma (copy)")');
  await page.click('#deleteBtn');
  await page.click('.nav-item[data-view="trash"]');
  await page.click('.note-card:has-text("Gamma (copy)")');
  await page.click('#destroyBtn');
  await waitFor('destroyed', () => !findNote('Gamma (copy)'));

  await page.click('.nav-item[data-view="all"]');
  await page.click('.note-card:has-text("Beta")');
  await page.click('#deleteBtn');
  await page.click('.nav-item[data-view="trash"]');
  await page.waitForSelector('#emptyTrashBtn:not(.hidden)');
  await page.click('#emptyTrashBtn');
  await waitFor('trash emptied', () => !findNote('Beta'));
  assert.equal(await page.textContent('#countTrash'), '0');
  await page.click('.nav-item[data-view="all"]');
});

test('settings: theme, font size, always on top, sidebar toggle, hotkey change', async () => {
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');

  await page.selectOption('#themeSelect', 'dark');
  await waitForDom(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(readNotes().settings.theme, 'dark');

  await page.$eval('#fontSizeInput', (i) => { i.value = '20'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitFor('font size saved', () => readNotes().settings.fontSize === 20);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size').trim()), '20px');

  await page.check('#alwaysOnTopInput');
  await waitFor('always on top applied', () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()));
  await page.uncheck('#alwaysOnTopInput');
  await waitFor('always on top cleared', async () => !(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())));

  await page.focus('#hotkeyInput');
  await page.keyboard.press('Control+Alt+F10');
  await waitFor('hotkey re-registered', () => app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+F10')));
  assert.equal(readNotes().settings.hotkey, 'Control+Alt+F10');
  assert.equal(await page.textContent('#hotkeyError'), '');
  assert.equal(await page.textContent('#hotkeyHint'), 'Ctrl + Alt + F10');

  await page.click('#closeSettingsBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await page.click('#toggleSidebarBtn');
  await waitForDom(() => document.getElementById('app').classList.contains('sidebar-collapsed'));
  await page.keyboard.press('Control+\\');
  await waitForDom(() => !document.getElementById('app').classList.contains('sidebar-collapsed'));
  await page.keyboard.press('Control+Shift+l');
  await waitForDom(() => document.documentElement.dataset.theme === 'light');
});

test('export note, export all, and import through stubbed dialogs', async () => {
  const outMd = path.join(dataDir, 'exported.md');
  const outJson = path.join(dataDir, 'all.json');
  const inMd = path.join(dataDir, 'incoming.md');
  fs.writeFileSync(inMd, '# Imported note\n\nhello from disk\n\nTags: #inbox\n');
  await app.evaluate(({ dialog }, paths) => {
    dialog.showSaveDialog = async (_w, opts) => ({ canceled: false, filePath: /json/i.test(opts.title) || /all notes/i.test(opts.title) ? paths.outJson : paths.outMd });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.inMd] });
  }, { outMd, outJson, inMd });

  await page.click('.note-card:has-text("Alpha")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Alpha');
  await page.click('#exportBtn');
  await waitFor('note exported', () => fs.existsSync(outMd));
  assert.equal(fs.readFileSync(outMd, 'utf8'), '# Alpha\n\nfirst body\n');

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await page.click('#exportAllBtn');
  await waitFor('all exported', () => fs.existsSync(outJson));
  assert.ok(JSON.parse(fs.readFileSync(outJson, 'utf8')).notes.length >= 2);

  await page.click('#importBtn');
  await waitForDom(() => document.getElementById('titleInput').value === 'Imported note');
  const imported = findNote('Imported note');
  assert.equal(imported.body, 'hello from disk');
  assert.deepEqual(imported.tags, ['inbox']);
});

test('folders: create, nest, new note inside, move via select and drag, counts, collapse, rename, reparent, delete, persist', async () => {
  const step = (s) => console.log('  [folders] ' + s);
  const folders = () => readNotes().folders;
  const folderByName = (name) => folders().find((f) => f.name === name);
  const row = (name) => `.folder-row:has(.folder-name:text-is("${name}"))`;
  // Plain-DOM equivalents for page.evaluate, which cannot use Playwright selector engines.
  const waitForCount = (name, count) => waitForDom(([n, c]) => {
    const r = Array.from(document.querySelectorAll('.folder-row')).find((x) => { const nm = x.querySelector('.folder-name'); return nm && nm.textContent === n; });
    return !!r && r.querySelector('.count').textContent === String(c);
  }, [name, count]);

  // Create a root folder from the + button.
  await page.click('#newFolderBtn');
  await page.waitForSelector('#folderTree .folder-input');
  await page.keyboard.type('Work');
  await page.keyboard.press('Enter');
  await page.waitForSelector(row('Work') + '.is-active');
  await waitFor('Work folder saved', () => folderByName('Work'));
  assert.equal(await page.textContent('#listTitle'), 'Work');
  assert.equal(await page.$$eval('.note-card', (c) => c.length), 0, 'new folder is empty');
  step('created root folder');

  // New note while inside the folder lands in it.
  await page.keyboard.press('Control+n');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', 'In Work');
  await waitFor('note created in folder', () => { const n = findNote('In Work'); return n && n.folderId === folderByName('Work').id; });
  assert.equal(await page.$$eval('.note-card', (c) => c.length), 1);
  step('new note inside folder');

  // Subfolder through the context menu.
  await page.click(row('Work'), { button: 'right' });
  await page.waitForSelector('#folderMenu:not(.hidden)');
  await page.click('#folderMenu button[data-action="new-subfolder"]');
  await page.waitForSelector('#folderTree .folder-input');
  await page.keyboard.type('Clients');
  await page.keyboard.press('Enter');
  await page.waitForSelector(row('Clients') + '.is-active');
  await waitFor('Clients nested under Work', () => { const c = folderByName('Clients'); return c && c.parentId === folderByName('Work').id; });
  assert.equal(await page.$eval(row('Clients'), (r) => r.style.getPropertyValue('--depth')), '1');
  assert.equal((await page.textContent('#listTitle')).replace(/\s+/g, ' ').trim(), 'Work / Clients');
  step('subfolder via menu');

  // Move a note with the editor's folder select.
  await page.click('.nav-item[data-view="all"]');
  await page.click('.note-card:has-text("Gamma")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma');
  await page.selectOption('#folderSelect', folderByName('Clients').id);
  await waitFor('Gamma moved to Clients', () => findNote('Gamma').folderId === folderByName('Clients').id);
  step('moved via select');

  // Move a note by dragging its card onto a folder.
  await page.dragAndDrop('.note-card:has-text("Imported note")', row('Work'), { timeout: 8000 });
  await waitFor('Imported note dragged into Work', () => findNote('Imported note').folderId === folderByName('Work').id);
  step('moved via drag');

  // Recursive count on the parent: In Work + Imported note + Gamma (in Clients).
  await waitForCount('Work', 3);
  step('recursive count');

  // Collapse and expand persist.
  await page.click(row('Work') + ' .folder-chevron', { timeout: 8000 });
  await waitForDom(() => !Array.from(document.querySelectorAll('.folder-name')).some((n) => n.textContent === 'Clients'));
  assert.deepEqual(readNotes().settings.expandedFolders, []);
  await page.click(row('Work') + ' .folder-chevron', { timeout: 8000 });
  await page.waitForSelector(row('Clients'), { timeout: 8000 });
  assert.deepEqual(readNotes().settings.expandedFolders, [folderByName('Work').id]);
  step('collapse/expand');

  // Rename inline by double-click.
  await page.dblclick(row('Clients') + ' .folder-name', { timeout: 8000 });
  await page.waitForSelector('#folderTree .folder-input', { timeout: 8000 });
  await page.fill('#folderTree .folder-input', 'Customers');
  await page.keyboard.press('Enter');
  await page.waitForSelector(row('Customers'), { timeout: 8000 });
  await waitFor('renamed on disk', () => folderByName('Customers') && !folderByName('Clients'));
  step('renamed');

  // Reparent a folder by dragging it onto "All notes" (top level), then back into Work.
  await page.dragAndDrop(row('Customers'), '.nav-item[data-view="all"]', { timeout: 8000 });
  await waitFor('Customers is top level', () => folderByName('Customers').parentId === null);
  await page.dragAndDrop(row('Customers'), row('Work'), { timeout: 8000 });
  await waitFor('Customers back under Work', () => folderByName('Customers').parentId === folderByName('Work').id);
  // Dropping a folder into its own subfolder is refused.
  await page.dragAndDrop(row('Work'), row('Customers'), { timeout: 8000 });
  await sleep(300);
  assert.equal(folderByName('Work').parentId, null, 'cycle refused');
  step('reparented');

  // Search inside a folder looks across every note.
  await page.click(row('Work'), { timeout: 8000 });
  await page.fill('#searchInput', 'Alpha');
  await page.waitForSelector('.note-card:has-text("Alpha")', { timeout: 8000 });
  await page.fill('#searchInput', '');
  await waitForDom(() => document.querySelectorAll('.note-card').length === 2);
  step('global search from folder');

  // Deleting a folder lifts its contents to the parent.
  await page.hover(row('Customers'), { timeout: 8000 });
  await page.click(row('Customers') + ' .folder-menu-btn', { timeout: 8000, force: true });
  await page.waitForSelector('#folderMenu:not(.hidden)', { timeout: 8000 });
  await page.click('#folderMenu button[data-action="delete"]', { timeout: 8000 });
  await waitFor('Customers deleted', () => !folderByName('Customers'));
  assert.equal(findNote('Gamma').folderId, folderByName('Work').id, 'Gamma lifted into Work');
  await waitForCount('Work', 3);
  step('deleted folder');

  // Survives a reload.
  await page.reload({ timeout: 8000 });
  await page.waitForSelector(row('Work'), { timeout: 8000 });
  await page.click('.nav-item[data-view="all"]', { timeout: 8000 });
  await waitForDom(() => document.querySelectorAll('.note-card').length >= 3);
  step('persisted across reload');
});

test('drag handles resize the sidebar and list, persist, clamp, and reset on double-click', async () => {
  const widths = () => page.evaluate(() => {
    const s = getComputedStyle(document.getElementById('app')).gridTemplateColumns.split(' ').map((v) => parseFloat(v));
    return { sidebar: s[0], list: s[1] };
  });
  const before = await widths();
  assert.equal(before.sidebar, 232);
  assert.equal(before.list, 300);

  const drag = async (selector, dx) => {
    const box = await page.locator(selector).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y, { steps: 4 });
    await page.mouse.move(x + dx, y, { steps: 4 });
    await page.mouse.up();
  };

  await drag('#sidebarResizer', 60);
  await waitFor('sidebar width persisted', () => readNotes().settings.sidebarWidth === 292);
  assert.equal((await widths()).sidebar, 292);

  await drag('#listResizer', -40);
  await waitFor('list width persisted', () => readNotes().settings.listWidth === 260);
  assert.equal((await widths()).list, 260);

  await drag('#sidebarResizer', -500);
  await waitFor('sidebar clamped at minimum', () => readNotes().settings.sidebarWidth === 160);
  await drag('#listResizer', 2000);
  await waitFor('list clamped at maximum', () => readNotes().settings.listWidth === 560);

  await page.dblclick('#sidebarResizer');
  await waitFor('sidebar reset', () => readNotes().settings.sidebarWidth === 232);
  await page.dblclick('#listResizer');
  await waitFor('list reset', () => readNotes().settings.listWidth === 300);
  const after = await widths();
  assert.deepEqual(after, { sidebar: 232, list: 300 });

  // A narrow window must still leave the editor its minimum width.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 600));
  await waitForDom(() => parseFloat(getComputedStyle(document.getElementById('app')).gridTemplateColumns.split(' ')[2]) >= 320);
  await drag('#listResizer', 400);
  const squeezed = await widths();
  assert.ok(squeezed.sidebar + squeezed.list <= 760 - 320 + 1, 'panes left room for the editor: ' + JSON.stringify(squeezed));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await page.dblclick('#listResizer');
  await waitFor('list reset again', () => readNotes().settings.listWidth === 300);
});

test('window state: Esc hides, a second launch re-shows the first instance, data survives reload', async () => {
  const step = (s) => console.log('  [window-state] ' + s);
  const win = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
  await page.keyboard.press('Escape');
  await waitFor('hidden by Esc', async () => !(await win()));
  step('hidden by Esc');

  const second = spawn(ELECTRON_PATH, [ROOT], { env: Object.assign({}, process.env, { NOTES_APP_DATA_DIR: dataDir, NOTES_APP_NO_LOGIN_ITEM: '1' }), stdio: 'ignore' });
  const secondExit = new Promise((r) => second.on('exit', (code) => r(code)));
  await waitFor('second instance re-shows the window', win, 10000);
  step('re-shown by second instance');
  const code = await Promise.race([secondExit, sleep(8000).then(() => 'timeout')]);
  step('second instance exit: ' + code);
  if (code === 'timeout') second.kill();
  assert.notEqual(code, 'timeout', 'second instance should quit on its own after handing off');

  const before = readNotes().notes.length;
  await page.reload({ timeout: 8000 });
  step('reloaded');
  await page.waitForSelector('.note-card', { timeout: 8000 });
  assert.equal(await page.$$eval('.note-card', (c) => c.length), before);
  step('data survived reload');
});

test('no renderer errors were logged during the run', () => {
  assert.deepEqual(rendererErrors, []);
});
