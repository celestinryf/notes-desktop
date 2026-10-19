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
const { tmpDir } = require('./helpers/tmp'); // folders are removed when the run exits
const dataDir = tmpDir('notes-ui-');
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
  fs.writeFileSync(notesFile, JSON.stringify({ settings: { hotkey: 'Control+Alt+Shift+F8', openAtLogin: false, theme: 'light', editorWidth: 0, columnLayout: 3 }, notes: [] }));
  app = await electron.launch({
    executablePath: ELECTRON_PATH,
    args: [ROOT, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    // NOTES_APP_INACTIVE keeps the test window from taking keyboard focus from a person using the machine.
    env: Object.assign({}, process.env, {
      NOTES_APP_DATA_DIR: dataDir, NOTES_APP_NO_LOGIN_ITEM: '1', NOTES_APP_GIT_DEBOUNCE_MS: '300', NOTES_APP_INACTIVE: '1', NOTES_APP_DRY_DICTATE: '1', NOTES_APP_DRY_PRINT: '1', NOTES_APP_DRY_NOTIFY: '1', NOTES_APP_REMINDER_TICK_MS: '300',
      // The bot panel is exercised against a fake `claude` so no real agent (or tokens) is involved.
      NOTES_APP_CLAUDE_BIN: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'),
      // Must never reach the agent: runs bill the Claude subscription, not API credits.
      ANTHROPIC_API_KEY: 'sk-ant-test-must-not-reach-the-agent',
      NOTES_APP_DRY_TERMINAL: '1',
      // Word documents use Notes' own editor here, which these tests drive, even where WordCraft is built.
      NOTES_APP_NO_WORDCRAFT: '1',
    }),
  });
  page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') rendererErrors.push(m.text()); });
  page.on('pageerror', (e) => rendererErrors.push('pageerror: ' + e.message));
  await page.waitForSelector('#app');
  await page.evaluate(() => { window.confirm = () => true; });
  // No test may open a real window outside the app (Explorer, a browser, the mail app): record the shell calls
  // instead. A real showItemInFolder left an Explorer window behind on every run, which fell back to %TEMP%
  // once the run deleted its folder.
  await app.evaluate(({ shell }) => {
    global.__shell = { opened: [], shown: [], external: [] };
    shell.openPath = async (p) => { global.__shell.opened.push(p); return ''; };
    shell.showItemInFolder = (p) => { global.__shell.shown.push(p); };
    shell.openExternal = async (url) => { global.__shell.external.push(url); };
  });
});
const shellCalls = () => app.evaluate(() => global.__shell);

// A failed test must not leave a modal dialog open for the next one.
test.beforeEach(async () => {
  if (!page) return;
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); }).catch(() => {});
});

// Per-note actions that are not on the toolbar live in the More menu: open it first when the button is in there.
async function clickTool(sel) {
  const inMenu = await page.evaluate((s) => { const b = document.querySelector(s); return !!(b && b.closest('#moreMenu')); }, sel);
  if (inMenu && await page.evaluate(() => document.getElementById('moreMenu').classList.contains('hidden'))) await page.click('#moreBtn');
  await page.click(sel);
}
const toolLabel = (sel) => page.evaluate((s) => document.querySelector(s + ' .lbl').textContent, sel);

async function useSourceMode(on) {
  const isSource = async () => page.evaluate(() => !document.getElementById('bodyInput').classList.contains('hidden'));
  if ((await isSource()) === on) return;
  await page.click('#sourceBtn');
  await waitFor('editor mode ' + (on ? 'source' : 'rendered'), async () => (await isSource()) === on);
}

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

test('showing the window does not create stray notes once notes exist', async () => {
  // Regression: the first show arrives before the initial load; it must not spawn an empty note when notes exist.
  // This instance started with zero notes, so exactly one fresh note is expected, and a second show must add none.
  await waitForDom(() => !document.getElementById('editor').classList.contains('hidden'));
  await waitFor('exactly one note after first show', () => readNotes().notes.length === 1);
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.hide(); w.show(); w.webContents.send('app:shown'); });
  await sleep(600);
  assert.equal(readNotes().notes.length, 1, 'second show created no extra note');
});

test('rendered editor: ## becomes a heading, lists and checklists render, Markdown round-trips', async () => {
  const step = (s) => console.log('  [rendered] ' + s);
  const T = { timeout: 8000 };
  await waitForDom(() => !document.getElementById('editor').classList.contains('hidden'));
  assert.equal(await page.$eval('#bodyInput', (t) => t.classList.contains('hidden')), true, 'rendered view is the default');
  await page.fill('#titleInput', 'Rendered');
  await page.click('#richEditor .rich-editor-content', T);
  await page.keyboard.type('## Big heading');
  await page.waitForSelector('#richEditor h2:has-text("Big heading")', T);
  step('heading rendered');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plain paragraph with ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('bold');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [ ] a task');
  await page.waitForSelector('#richEditor li[data-type="taskItem"]', T);
  step('task item rendered');
  await waitFor('markdown saved from rendered editor', () => {
    const n = findNote('Rendered');
    return n && n.body.includes('## Big heading') && n.body.includes('**bold**') && n.body.includes('- [ ] a task');
  });
  step('markdown saved');
  // Ticking the checkbox writes back to the Markdown.
  await page.click('#richEditor li[data-type="taskItem"] input[type="checkbox"]', T);
  await waitFor('checkbox toggled in markdown', () => findNote('Rendered').body.includes('- [x] a task'));
  step('checkbox toggled');

  // Ctrl+K opens the link dialog and applies a link to the selection.
  await page.click('#richEditor h2', T);
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#linkDialog[open]', T);
  step('link dialog open');
  await page.fill('#linkInput', 'https://example.com', T);
  await page.click('#linkApplyBtn', T);
  try {
    await waitFor('link in markdown', () => /\[Big heading\]\(https:\/\/example\.com\)/.test(findNote('Rendered').body));
  } catch (err) {
    const diag = await page.evaluate(() => ({
      html: document.querySelector('#richEditor .ProseMirror').innerHTML,
      textarea: document.getElementById('bodyInput').value,
      active: document.activeElement && (document.activeElement.id || document.activeElement.className),
      hasFocus: document.hasFocus(),
      dialogOpen: document.getElementById('linkDialog').open,
      selection: String(window.getSelection && window.getSelection().toString()),
    }));
    throw new Error(err.message + ' | file=' + JSON.stringify(findNote('Rendered').body) + ' | ' + JSON.stringify(diag));
  }

  step('link applied');

  // Ctrl+E shows the raw source with the same text; editing there flows back into the rendered view.
  await page.keyboard.press('Control+e');
  await waitForDom(() => !document.getElementById('bodyInput').classList.contains('hidden'));
  assert.equal(readNotes().settings.editorMode, 'source', 'mode persists');
  assert.match(await page.inputValue('#bodyInput'), /^## \[Big heading\]/);
  step('source view');
  await page.fill('#bodyInput', '# From source\n\n- [ ] one', T);
  await page.keyboard.press('Control+e');
  await page.waitForSelector('#richEditor h1:has-text("From source")', T);
  assert.equal(await page.$$eval('#richEditor li[data-type="taskItem"]', (l) => l.length), 1);
  await waitFor('source edit saved', () => findNote('Rendered').body.startsWith('# From source'));
  step('round trip');

  // Leave the editor in source mode: the older tests below drive the textarea directly.
  await useSourceMode(true);
  await page.keyboard.press('Control+Shift+Delete'); // trash this note so the following tests start as before
  await waitFor('rendered note trashed', () => findNote('Rendered').trashedAt);
  await page.click('.nav-item[data-view="trash"]', T);
  await page.click('.note-card:has-text("Rendered")', T);
  await page.click('#destroyBtn', T);
  await waitFor('rendered note destroyed', () => !findNote('Rendered'));
  await page.click('.nav-item[data-view="all"]', T);
  await page.click('#newNoteBtn', T);
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  step('cleaned up');
});

test('first run opens on a fresh note and typing autosaves', async () => {
  await waitForDom(() => !document.getElementById('editor').classList.contains('hidden'));
  await useSourceMode(true);
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
  assert.equal(await page.getAttribute('#pinBtn', 'aria-pressed'), 'true');
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
  await clickTool('#duplicateBtn');
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

test('switching source to rendered shows the same Markdown and checkbox clicks write back', async () => {
  await page.fill('#bodyInput', '# Head\n\n- [ ] alpha\n- [x] beta\n\n[site](https://example.com)');
  await waitFor('source saved', () => findNote('Gamma (copy)').body.startsWith('# Head'));
  await page.keyboard.press('Control+e');
  await page.waitForSelector('#richEditor:not(.hidden) h1');
  assert.equal(await page.textContent('#richEditor h1'), 'Head');
  assert.equal(await page.$$eval('#richEditor li[data-type="taskItem"]', (b) => b.length), 2);
  assert.equal(await page.$eval('#richEditor a', (a) => a.getAttribute('href')), 'https://example.com');
  await page.click('#richEditor li[data-type="taskItem"] >> nth=0 >> input[type="checkbox"]');
  await waitFor('checkbox toggled in source', () => findNote('Gamma (copy)').body.includes('- [x] alpha'));
  assert.equal(await page.$eval('#richEditor li[data-type="taskItem"] >> nth=0', (li) => li.dataset.checked), 'true');
  await page.keyboard.press('Control+e');
  await page.waitForSelector('#bodyInput:not(.hidden)');
});

test('tables and images render; Markdown the rendered view would alter opens as source and is not rewritten', async () => {
  await useSourceMode(true);
  await page.click('#newNoteBtn');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', 'Rich constructs');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const table = '| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n\n![Diagram](' + png + ')\n\nDone.';
  await page.fill('#bodyInput', table);
  await waitFor('table note saved', () => findNote('Rich constructs') && findNote('Rich constructs').body === table);
  await page.keyboard.press('Control+e');
  await page.waitForSelector('#richEditor:not(.hidden) table', { timeout: 8000 });
  assert.equal(await page.$$eval('#richEditor td', (c) => c.length), 2);
  assert.equal(await page.$eval('#richEditor img[src]', (i) => i.getAttribute('src')), png);
  assert.equal(readNotes().settings.editorMode, 'rendered');
  // Enter inside a cell used to replace the whole table with "[table]" on autosave.
  await page.click('#richEditor td >> nth=0');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('more');
  await waitFor('cell edit saved', () => findNote('Rich constructs').body.includes('more'));
  const afterEnter = findNote('Rich constructs').body;
  assert.ok(!afterEnter.includes('[table]'), 'no placeholder: ' + afterEnter);
  assert.ok(/Apple/.test(afterEnter) && /Qty/.test(afterEnter), 'table content kept: ' + afterEnter);
  // Ctrl+Backspace in a text field deletes a word and must not trash the note.
  await page.keyboard.press('Control+Backspace');
  await sleep(500);
  assert.equal(findNote('Rich constructs').trashedAt, null, 'Ctrl+Backspace did not trash');

  // Viewing must never write. Re-open the (HTML-serialized) table note and a note whose Markdown is not
  // byte-identical to the editor's output but is content-identical: neither may change on disk.
  await page.click('#newNoteBtn');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', 'Soft breaks');
  await useSourceMode(true);
  const soft = 'line one\nline two\n\nx -> y and a > b\n\n* star bullet\n* another';
  await page.fill('#bodyInput', soft);
  await waitFor('soft note saved', () => findNote('Soft breaks') && findNote('Soft breaks').body === soft);
  await page.keyboard.press('Control+e'); // rendered, global preference back to rendered
  await page.waitForSelector('#richEditor:not(.hidden) p', { timeout: 8000 });
  const stampSoft = findNote('Soft breaks').updatedAt;
  const stampTable = findNote('Rich constructs').updatedAt;
  await page.click('.note-card:has-text("Rich constructs")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Rich constructs');
  await page.waitForSelector('#richEditor:not(.hidden) table', { timeout: 8000 });
  await sleep(900);
  await page.click('.note-card:has-text("Soft breaks")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Soft breaks');
  await sleep(900);
  assert.equal(findNote('Soft breaks').body, soft, 'viewing did not rewrite soft breaks');
  assert.equal(findNote('Soft breaks').updatedAt, stampSoft, 'updatedAt untouched by viewing');
  assert.equal(findNote('Rich constructs').updatedAt, stampTable, 'table note untouched by viewing');
  // Editing in rendered mode keeps "->" as typed instead of "-&gt;".
  await page.click('#richEditor p >> nth=0');
  await page.keyboard.press('End');
  await page.keyboard.type(' plus');
  await waitFor('rendered edit saved', () => findNote('Soft breaks').body.includes('plus'));
  const edited = findNote('Soft breaks').body;
  assert.ok(edited.includes('x -> y and a > b'), 'angle brackets kept literal: ' + JSON.stringify(edited));
  assert.ok(!edited.includes('&gt;'), 'no entity escaping: ' + JSON.stringify(edited));
  await page.keyboard.press('Control+Shift+Delete');
  await waitFor('soft note trashed', () => findNote('Soft breaks').trashedAt);

  // A note with constructs the editor cannot keep (inline HTML, a footnote) must open as source untouched.
  await page.click('#newNoteBtn');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', 'Lossy');
  // The new note opened in rendered mode (persisted setting); switch to source to type raw Markdown.
  await useSourceMode(true);
  const lossy = 'Keyboard: <kbd>Ctrl</kbd>+<kbd>K</kbd>\n\nA claim.[^1]\n\n[^1]: The footnote text.';
  await page.fill('#bodyInput', lossy);
  await waitFor('lossy note saved', () => findNote('Lossy') && findNote('Lossy').body === lossy);
  // Prefer rendered globally again, then re-open the lossy note: it must stay in source with a notice.
  await page.click('.note-card:has-text("Rich constructs")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Rich constructs');
  await page.keyboard.press('Control+e');
  await page.waitForSelector('#richEditor:not(.hidden) table', { timeout: 8000 });
  await page.click('.note-card:has-text("Lossy")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Lossy');
  await waitForDom(() => !document.getElementById('bodyInput').classList.contains('hidden'));
  await page.waitForSelector('#toast:not(.hidden)', { timeout: 8000 });
  assert.match(await page.textContent('#toast'), /Opened as Markdown source/);
  await sleep(800);
  assert.equal(findNote('Lossy').body, lossy, 'viewing did not rewrite the note');
  assert.equal(readNotes().settings.editorMode, 'rendered', 'the global preference is untouched');
  // And a normal note after it goes back to the rendered view automatically.
  await page.click('.note-card:has-text("Rich constructs")');
  await page.waitForSelector('#richEditor:not(.hidden) table', { timeout: 8000 });

  // Clean up so later tests see the same notes as before.
  for (const title of ['Lossy', 'Rich constructs']) {
    await page.click(`.note-card:has-text("${title}")`);
    await waitForDom((t) => document.getElementById('titleInput').value === t, title);
    await page.keyboard.press('Control+Shift+Delete');
    await waitFor(title + ' trashed', () => findNote(title).trashedAt);
  }
  await page.click('.nav-item[data-view="trash"]');
  await page.waitForSelector('#emptyTrashBtn:not(.hidden)', { timeout: 8000 });
  await page.click('#emptyTrashBtn');
  await waitFor('trash emptied', () => !findNote('Lossy') && !findNote('Rich constructs') && !findNote('Soft breaks'));
  await page.click('.nav-item[data-view="all"]');
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
});

test.afterEach(() => {
  // The locked-disk test makes notes.json read-only; make sure nothing downstream inherits that.
  try { fs.chmodSync(notesFile, 0o666); } catch (_) { /* ignore */ }
});

test('an edit that cannot be saved survives switching notes and lands once the disk allows it', { timeout: 60000 }, async () => {
  await useSourceMode(true);
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await page.fill('#bodyInput', 'before lock');
  await waitFor('baseline saved', () => findNote('Gamma (copy)').body === 'before lock');
  // Make the data file read-only: rename-over and copy-over both fail, so update() throws.
  const alphaBefore = findNote('Alpha').body;
  fs.chmodSync(notesFile, 0o444);
  try {
    await page.fill('#bodyInput', 'typed while locked');
    await waitForDom(() => document.getElementById('statusSaved').textContent === 'Save failed', 8000);
    // Switch to a second note and edit it too: both failures must be kept, one per note.
    await page.click('.note-card:has-text("Alpha")');
    await waitForDom(() => document.getElementById('titleInput').value === 'Alpha');
    assert.equal(findNote('Gamma (copy)').body, 'before lock', 'nothing reached disk while locked');
    await page.fill('#bodyInput', 'alpha edited while locked');
    await waitForDom(() => document.getElementById('statusSaved').textContent === 'Save failed', 8000);
    // Coming back to the first note must show the unsaved text, not the stale disk copy, and stay marked unsaved.
    await page.click('.note-card:has-text("Gamma (copy)")');
    await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
    assert.equal(await page.inputValue('#bodyInput'), 'typed while locked', 'pending edit shown on reselect');
    assert.equal(await page.textContent('#statusSaved'), 'Save failed');
    await sleep(3500); // a retry cycle while still locked must not clobber either pending edit
    assert.equal(findNote('Gamma (copy)').body, 'before lock');
    assert.equal(findNote('Alpha').body, alphaBefore);
    assert.equal(await page.inputValue('#bodyInput'), 'typed while locked');
  } finally {
    fs.chmodSync(notesFile, 0o666);
  }
  await waitFor('both pending edits landed after unlock', () => findNote('Gamma (copy)').body === 'typed while locked' && findNote('Alpha').body === 'alpha edited while locked', 15000);
  await waitForDom(() => document.getElementById('statusSaved').textContent === 'Saved');
  await page.fill('#bodyInput', 'pure text');
  await waitFor('restored body', () => findNote('Gamma (copy)').body === 'pure text');
  await page.click('.note-card:has-text("Alpha")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Alpha');
  await page.fill('#bodyInput', alphaBefore);
  await waitFor('alpha restored', () => findNote('Alpha').body === alphaBefore);
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
});

test('entity-looking text and numbered lists round-trip in the rendered view', async () => {
  await page.click('#newNoteBtn');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', 'Entities');
  await useSourceMode(true);
  // In Markdown source, "&" and angle brackets are ordinary text; "1. 1. 1." is a valid ordered list.
  const md = 'Fish & chips, 1 < 2 && 3 > 2, <3\n\n1. one\n1. two\n1. three';
  await page.fill('#bodyInput', md);
  await waitFor('entities note saved', () => findNote('Entities') && findNote('Entities').body === md);
  await page.keyboard.press('Control+e');
  await page.waitForSelector('#richEditor:not(.hidden) ol', { timeout: 8000 });
  assert.equal(await page.$eval('#richEditor p', (p) => p.textContent), 'Fish & chips, 1 < 2 && 3 > 2, <3', 'text shown verbatim, note not forced to source');
  await page.click('#richEditor p');
  await page.keyboard.press('End');
  await page.keyboard.type(' ok, typed &amp; literally');
  await waitFor('rendered edit saved', () => findNote('Entities').body.includes('literally'));
  const body = findNote('Entities').body;
  assert.ok(body.includes('Fish & chips, 1 < 2 && 3 > 2, <3 ok'), 'ampersand and brackets stay literal: ' + JSON.stringify(body));
  assert.ok(body.includes('typed &amp;amp; literally'), 'an entity typed as text is escaped so it reloads as typed: ' + JSON.stringify(body));
  // Reload the note: the typed "&amp;" must come back as the five characters the user typed.
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await page.click('.note-card:has-text("Entities")');
  await page.waitForSelector('#richEditor:not(.hidden) ol', { timeout: 8000 });
  assert.ok((await page.$eval('#richEditor p', (p) => p.textContent)).endsWith('typed &amp; literally'));
  await page.keyboard.press('Control+Shift+Delete');
  await waitFor('entities note trashed', () => findNote('Entities').trashedAt);
  await page.click('.nav-item[data-view="trash"]');
  await page.waitForSelector('#emptyTrashBtn:not(.hidden)', { timeout: 8000 });
  await page.click('#emptyTrashBtn');
  await waitFor('entities note destroyed', () => !findNote('Entities'));
  await page.click('.nav-item[data-view="all"]');
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
});

test('file-backed notes: open a Markdown file, edit it on disk both ways, view a PDF, agent files folder', { timeout: 90000 }, async () => {
  const fileDir = tmpDir('notes-ui-files-');
  const mdPath = path.join(fileDir, 'External note.md');
  fs.writeFileSync(mdPath, '# From disk\n\nline one\n');
  const pdfPath = path.join(fileDir, 'paper.pdf');
  fs.writeFileSync(pdfPath, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async (_w, opts) => ({ canceled: false, filePaths: /Open files as notes/.test(opts.title) ? paths : [] });
  }, [mdPath, pdfPath]);

  await useSourceMode(true);
  await page.keyboard.press('Control+o');
  await waitFor('two file notes linked', () => readNotes().notes.filter((n) => n.filePath).length === 2);
  const mdNote = readNotes().notes.find((n) => n.filePath && n.filePath.endsWith('External note.md'));
  assert.equal(mdNote.title, 'External note.md');
  assert.equal(mdNote.body, '# From disk\n\nline one\n');
  await waitForDom(() => document.getElementById('titleInput').value === 'External note.md');
  assert.equal(await page.$eval('#fileRow', (r) => !r.classList.contains('hidden')), true);
  assert.equal(await page.textContent('#fileKind'), 'TEXT');

  // Edit in the app: the file on disk changes, in place.
  const inoBefore = fs.statSync(mdPath).ino;
  await page.fill('#bodyInput', '# From disk\n\nline one\nline two from the app\n');
  await waitFor('edit reached the file', () => fs.readFileSync(mdPath, 'utf8').includes('line two from the app'));
  assert.equal(fs.statSync(mdPath).ino, inoBefore, 'written in place');

  // Edit on disk: the app picks it up while the note is open and clean.
  await sleep(400);
  fs.writeFileSync(mdPath, '# From disk\n\nreplaced by another program\n');
  await waitForDom(() => document.getElementById('bodyInput').value.includes('replaced by another program'), 10000);

  // A file whose Markdown the rendered view would reformat (soft line breaks) opens in source mode even when the
  // global preference is rendered, so the real file is never rewritten just by opening it.
  const softPath = path.join(fileDir, 'soft.md');
  fs.writeFileSync(softPath, 'first line\nsecond line\n');
  await page.keyboard.press('Control+e'); // prefer rendered globally
  await waitFor('rendered preferred', () => readNotes().settings.editorMode === 'rendered');
  await page.evaluate((p) => window.notesApi.files.link([p]), softPath);
  await waitFor('soft file linked', () => readNotes().notes.some((n) => n.filePath && n.filePath.endsWith('soft.md')));
  await page.click('.nav-item[data-view="all"]'); // linking through the API does not refresh the list by itself
  await page.waitForSelector('.note-card:has-text("soft.md")', { timeout: 8000 });
  await page.click('.note-card:has-text("soft.md")');
  await waitForDom(() => document.getElementById('titleInput').value === 'soft.md');
  await waitForDom(() => !document.getElementById('bodyInput').classList.contains('hidden'));
  assert.equal(readNotes().settings.editorMode, 'rendered', 'global preference untouched');
  await sleep(600);
  assert.equal(fs.readFileSync(softPath, 'utf8'), 'first line\nsecond line\n', 'file untouched by opening it');

  // PDF opens in the app's PDF editor (pdf.js), with its pages drawn.
  await page.click('.note-card:has-text("paper.pdf")');
  await waitForDom(() => document.getElementById('titleInput').value === 'paper.pdf');
  await waitForDom(() => !document.getElementById('pdfEditor').classList.contains('hidden') && !!document.querySelector('#pdfEditor .pdfViewer .page canvas'));
  assert.equal(await page.$eval('#bodyInput', (t) => t.classList.contains('hidden')), true);
  assert.match(await page.textContent('#fileBanner'), /original is backed up/);

  // Agent files: discovery runs against the real home folder; it must create the folder and link at least the global CLAUDE.md.
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await page.click('#agentFilesBtn');
  await waitFor('agent files folder exists', () => readNotes().folders.some((f) => f.name === 'Agent files'));
  await waitFor('global CLAUDE.md linked', () => readNotes().notes.some((n) => n.filePath && /\\\.claude\\CLAUDE\.md$/i.test(n.filePath)));
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  const agentFolder = readNotes().folders.find((f) => f.name === 'Agent files');
  const globalNote = readNotes().notes.find((n) => n.filePath && /\\\.claude\\CLAUDE\.md$/i.test(n.filePath));
  assert.equal(globalNote.folderId, agentFolder.id);
  assert.match(globalNote.title, /global/);
  assert.ok(globalNote.body.includes('# Global instructions'), 'contents read from the real file');

  // Clean up: unlink the test notes (files stay), delete the folder, go back to the usual state.
  await page.click('.nav-item[data-view="all"]');
  for (const t of ['External note.md', 'paper.pdf', 'soft.md']) {
    await page.click(`.note-card:has-text("${t}")`);
    await waitForDom((x) => document.getElementById('titleInput').value === x, t);
    await page.keyboard.press('Control+Shift+Delete');
    await waitFor(t + ' trashed', () => readNotes().notes.find((n) => n.title === t).trashedAt);
  }
  assert.ok(fs.existsSync(mdPath) && fs.existsSync(pdfPath), 'trashing a file note leaves the files alone');
  await page.click('.nav-item[data-view="trash"]');
  await page.waitForSelector('#emptyTrashBtn:not(.hidden)', { timeout: 8000 });
  await page.click('#emptyTrashBtn');
  await waitFor('file notes destroyed', () => !readNotes().notes.some((n) => ['External note.md', 'paper.pdf', 'soft.md'].includes(n.title)));
  // Remove the agent-file links and their folder through the app's own API so later tests see the usual tree.
  const agentNoteIds = readNotes().notes.filter((x) => x.folderId === agentFolder.id).map((x) => x.id);
  await page.evaluate(async ({ ids, folderId }) => {
    for (const id of ids) await window.notesApi.notes.destroy(id);
    await window.notesApi.folders.delete(folderId);
  }, { ids: agentNoteIds, folderId: agentFolder.id });
  await waitFor('agent links removed', () => !readNotes().notes.some((n) => n.filePath) && !readNotes().folders.some((f) => f.name === 'Agent files'));
  assert.ok(fs.readFileSync(path.join(os.homedir(), '.claude', 'CLAUDE.md'), 'utf8').includes('# Global instructions'), 'the real file was never modified');
  await page.click('.nav-item[data-view="all"]');
  await waitForDom(() => document.querySelectorAll('.note-card').length >= 2);
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
});

test('vaults: a folder of Markdown becomes notes; new note writes a file; rename renames; external files appear', { timeout: 60000 }, async () => {
  const vaultDir = tmpDir('notes-ui-vault-');
  fs.mkdirSync(path.join(vaultDir, 'Work'));
  fs.writeFileSync(path.join(vaultDir, 'Hello.md'), '# Hello\n\nfrom the vault\n');
  fs.writeFileSync(path.join(vaultDir, 'Work', 'Plan.md'), 'plan\n');
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async (_w, opts) => (/vault/i.test(opts.title) ? { canceled: false, filePaths: [dir] } : { canceled: true, filePaths: [] });
  }, vaultDir);

  await useSourceMode(true);
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await page.click('#vaultAddFolderBtn');
  await waitFor('vault recorded', () => readNotes().vaults && readNotes().vaults.length === 1);
  const vault = readNotes().vaults[0];
  await waitFor('vault notes mirrored', () => readNotes().notes.filter((n) => n.vaultId === vault.id).length === 2);
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await page.waitForSelector('.folder-row .vault-badge', { timeout: 8000 });
  const root = readNotes().folders.find((f) => f.vaultId === vault.id && !f.parentId);
  assert.equal(root.name, path.basename(vaultDir));
  assert.ok(readNotes().folders.some((f) => f.vaultId === vault.id && f.name === 'Work'));

  // New note inside the vault root creates a file named after the title.
  await page.keyboard.press('Control+n');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', 'Shopping');
  await page.fill('#bodyInput', '- eggs\n');
  await waitFor('file created from note', () => fs.existsSync(path.join(vaultDir, 'Shopping.md')) && fs.readFileSync(path.join(vaultDir, 'Shopping.md'), 'utf8') === '- eggs\n');
  // Renaming the title renames the file.
  await page.fill('#titleInput', 'Groceries');
  await waitFor('file renamed', () => fs.existsSync(path.join(vaultDir, 'Groceries.md')) && !fs.existsSync(path.join(vaultDir, 'Shopping.md')));

  // A file dropped into the folder by another program shows up through the watcher.
  fs.writeFileSync(path.join(vaultDir, 'Work', 'External.md'), 'external\n');
  await waitFor('external file became a note', () => readNotes().notes.some((n) => n.title === 'External' && n.vaultId === vault.id), 15000);

  // The open note is refreshed when its file changes underneath it (as after a git pull) while it is clean.
  await page.click('.note-card:has-text("Groceries")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Groceries');
  await sleep(600);
  fs.writeFileSync(path.join(vaultDir, 'Groceries.md'), '- eggs\n- milk from another device\n');
  await waitForDom(() => document.getElementById('bodyInput').value.includes('milk from another device'), 15000);

  // Trash moves the file into .trash; empty trash deletes it.
  await page.click('.note-card:has-text("Groceries")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Groceries');
  await page.keyboard.press('Control+Shift+Delete');
  await waitFor('moved to .trash', () => fs.existsSync(path.join(vaultDir, '.trash', 'Groceries.md')) && !fs.existsSync(path.join(vaultDir, 'Groceries.md')));
  await page.click('.nav-item[data-view="trash"]');
  await page.waitForSelector('#emptyTrashBtn:not(.hidden)', { timeout: 8000 });
  await page.click('#emptyTrashBtn');
  await waitFor('deleted from .trash', () => !fs.existsSync(path.join(vaultDir, '.trash', 'Groceries.md')));

  // Settings shows the vault with a status line; Sync on a plain folder explains itself.
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await page.waitForSelector('.vault-item', { timeout: 8000 });
  assert.match(await page.textContent('.vault-item .vault-status'), /Plain folder/);
  await page.click('.vault-item button:has-text("Sync now")');
  await waitForDom(() => /plain folder/i.test(document.getElementById('toast').textContent));

  // Remove the vault: notes and folders go, files stay.
  await page.click('.vault-item button:has-text("Remove")');
  await waitFor('vault removed', () => readNotes().vaults.length === 0 && !readNotes().notes.some((n) => n.vaultId));
  assert.ok(fs.existsSync(path.join(vaultDir, 'Hello.md')) && fs.existsSync(path.join(vaultDir, 'Work', 'Plan.md')), 'files untouched');
  await waitForDom(() => !document.getElementById('settingsDialog').open).catch(() => {});
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); });
  await page.click('.nav-item[data-view="all"]');
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
});

test('bot: runs Claude Code over an exported workspace, streams output, and pulls the edits back in', { timeout: 60000 }, async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await page.fill('#bodyInput', 'bot target body');
  await waitFor('body saved', () => findNote('Gamma (copy)').body === 'bot target body');
  await page.keyboard.press('Control+Shift+a');
  await page.waitForSelector('#botPanel:not(.hidden)');
  assert.match(await page.textContent('#botScope'), /plain notes/);
  // A Claude Code signed in with an API key, or not signed in, is refused before anything runs.
  await app.evaluate(() => { process.env.FAKE_CLAUDE_AUTH = 'apiKey'; });
  await page.fill('#botPrompt', 'Append a bullet to the current note');
  await page.keyboard.press('Control+Enter');
  await waitForDom(() => /bills API credits/.test(document.getElementById('botOutput').textContent), 10000);
  assert.doesNotMatch(await page.textContent('#botOutput'), /fake claude: cwd/, 'nothing ran');
  await app.evaluate(() => { process.env.FAKE_CLAUDE_AUTH = 'none'; });
  await page.keyboard.press('Control+Enter');
  await waitForDom(() => /not signed in/.test(document.getElementById('botOutput').textContent), 10000);
  await app.evaluate(() => { delete process.env.FAKE_CLAUDE_AUTH; });
  await page.keyboard.press('Control+Enter');
  // Wait for the app's own end-of-run line, written when the run has exited and the workspace has been imported.
  // The fake agent's lowercase "done" on stdout streams in earlier, before the import summary exists.
  await waitForDom(() => [...document.querySelectorAll('#botOutput .bot-meta')].some((s) => s.textContent.startsWith('\nDone')), 20000);
  const out = await page.textContent('#botOutput');
  assert.match(out, /Claude Code, on your Claude Max subscription \(no API credits\)/);
  assert.match(out, /api key env: absent/);
  // The terminal session clears the API-billing variables itself (an open Windows Terminal hands new tabs
  // its own environment, not the app's) and then starts Claude Code.
  const term = await page.evaluate(() => window.notesApi.bot.openTerminal(null));
  assert.equal(term.ok, true, JSON.stringify(term));
  const ps = fs.readFileSync(term.script, 'utf8');
  for (const v of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) assert.match(ps, new RegExp('Remove-Item -LiteralPath Env:' + v + ' '));
  assert.ok(ps.indexOf('Remove-Item') < ps.indexOf('& $notes'), 'variables are cleared before Claude Code starts');
  assert.match(out, /fake claude: cwd=.*workspace/);
  assert.match(out, /edited .*Gamma \(copy\)\.md/);
  assert.match(out, /Notes updated: 1, created: 1/);
  await waitFor('agent edit imported', () => findNote('Gamma (copy)').body === 'bot target body\n- added by the bot\n');
  await waitFor('agent-created note imported', () => findNote('Bot created this'));
  await waitForDom(() => document.getElementById('bodyInput').value.includes('added by the bot'));
  // A terminal-style edit in the workspace folder comes back in via Run with an empty prompt.
  const wsFile = path.join(dataDir, 'workspace', 'Gamma (copy).md');
  assert.ok(fs.existsSync(wsFile), 'workspace export exists');
  fs.writeFileSync(wsFile, 'bot target body\n- added by the bot\n- typed in a terminal\n', 'utf8');
  await page.fill('#botPrompt', '');
  await page.click('#botRunBtn');
  await waitForDom(() => /Pulled in workspace edits/.test(document.getElementById('botOutput').textContent), 10000);
  await waitFor('terminal edit imported', () => /typed in a terminal/.test(findNote('Gamma (copy)').body));
  await waitForDom(() => document.getElementById('bodyInput').value.includes('typed in a terminal'));
  // Clean up the created note and restore the body for later tests.
  await page.evaluate((id) => window.notesApi.notes.destroy(id), findNote('Bot created this').id);
  await page.fill('#bodyInput', 'pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
  await page.keyboard.press('Control+Shift+a');
  await waitForDom(() => document.getElementById('botPanel').classList.contains('hidden'));
});

test('stickies: a note becomes a desktop window; edits flow both ways; colour and removal persist', { timeout: 60000 }, async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await page.fill('#bodyInput', '- [ ] buy milk\n');
  await waitFor('body saved', () => findNote('Gamma (copy)').body === '- [ ] buy milk\n');
  assert.equal(await toolLabel('#stickyBtn'), 'Stick to the desktop');

  const stickyPromise = app.waitForEvent('window', { timeout: 15000 });
  await page.keyboard.press('Control+Shift+t');
  const sticky = await stickyPromise;
  sticky.on('pageerror', (e) => rendererErrors.push('sticky pageerror: ' + e.message));
  sticky.on('console', (m) => { if (m.type() === 'error') rendererErrors.push('sticky: ' + m.text()); });
  await sticky.waitForSelector('#stickyEditor .rich-editor-content', { timeout: 15000 });
  await waitFor('sticky persisted', () => { const n = findNote('Gamma (copy)'); return n.sticky && n.sticky.color === 'peach'; });
  await waitForDom(() => document.getElementById('stickyBtn').classList.contains('is-on'));
  await waitForDom(() => !!document.querySelector('.note-card.is-active .sticky-mark'));
  // The sticky renders the checklist.
  await waitFor('checkbox rendered', () => sticky.evaluate(() => !!document.querySelector('#stickyEditor ul[data-type="taskList"] input[type="checkbox"]')));
  assert.match(await sticky.textContent('#stickyTitle'), /Gamma \(copy\)/);

  // Typing in the sticky saves and reaches the main window (which is clean and on the same note).
  await sticky.click('#stickyEditor .rich-editor-content');
  await sticky.keyboard.press('Control+End');
  await sticky.keyboard.type('eggs');
  await waitFor('sticky edit saved', () => /eggs/.test(findNote('Gamma (copy)').body), 8000);
  await waitForDom(() => /eggs/.test(document.getElementById('bodyInput').value), 8000);

  // Editing in the main window reaches the sticky.
  await page.fill('#bodyInput', '- [x] done from main\n');
  await waitFor('main edit saved', () => findNote('Gamma (copy)').body === '- [x] done from main\n');
  await waitFor('sticky reloaded', () => sticky.evaluate(() => /done from main/.test(document.querySelector('#stickyEditor').textContent)), 8000);

  // Colour and on-top are persisted on the note.
  await sticky.click('#stickyColors [data-color="sky"]');
  await waitFor('colour saved', () => findNote('Gamma (copy)').sticky.color === 'sky');
  await waitFor('tint applied', () => sticky.evaluate(() => document.documentElement.dataset.color === 'sky'));
  await sticky.click('#stickyTopBtn');
  await waitFor('onTop saved', () => findNote('Gamma (copy)').sticky.onTop === false);
  const bw = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), onTop: w.isAlwaysOnTop(), frame: w.isResizable() })));
  assert.ok(bw.length >= 2, 'two windows');

  // Esc hides the sticky but keeps it a sticky; tray "Stickies" would bring it back. Reopen through the API.
  // The window closes on keydown, so the keyup round trip may fail: that is the expected outcome.
  await sticky.keyboard.press('Escape').catch(() => {});
  await waitFor('hidden', () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length) .then((n) => n === 1));
  assert.ok(findNote('Gamma (copy)').sticky, 'still a sticky after Esc');
  const again = app.waitForEvent('window', { timeout: 15000 });
  await page.evaluate((id) => window.notesApi.stickies.open(id), findNote('Gamma (copy)').id);
  const sticky2 = await again;
  await sticky2.waitForSelector('#stickyEditor .rich-editor-content', { timeout: 15000 });
  await waitFor('same tint on reopen', () => sticky2.evaluate(() => document.documentElement.dataset.color === 'sky'));

  // ✕ removes it from the desktop: window gone, sticky cleared, note kept.
  await sticky2.click('#stickyCloseBtn');
  await waitFor('removed', () => !findNote('Gamma (copy)').sticky);
  await waitFor('window closed', () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).then((n) => n === 1));
  await waitForDom(() => !document.getElementById('stickyBtn').classList.contains('is-on'));
  assert.equal(findNote('Gamma (copy)').body, '- [x] done from main\n');

  // Tray-style creation: a new empty note opens as a sticky; trashing it closes the window.
  const created = app.waitForEvent('window', { timeout: 15000 });
  const fresh = await page.evaluate(() => window.notesApi.stickies.create());
  const s3 = await created;
  await s3.waitForSelector('#stickyEditor .rich-editor-content', { timeout: 15000 });
  await page.evaluate((id) => window.notesApi.notes.trash(id), fresh.id);
  await waitFor('window closed by trash', () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).then((n) => n === 1));
  await page.evaluate((id) => window.notesApi.notes.destroy(id), fresh.id);

  await page.fill('#bodyInput', 'pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('stickies: a note the rendered view cannot reproduce opens read-only instead of being rewritten', { timeout: 30000 }, async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  const lossy = '---\ntitle: front matter\n---\n\nbody\n';
  await page.fill('#bodyInput', lossy);
  await waitFor('lossy body saved', () => findNote('Gamma (copy)').body === lossy);
  const opened = app.waitForEvent('window', { timeout: 15000 });
  await page.evaluate((id) => window.notesApi.stickies.open(id), findNote('Gamma (copy)').id);
  const sticky = await opened;
  sticky.on('pageerror', (e) => rendererErrors.push('sticky pageerror: ' + e.message));
  await sticky.waitForSelector('#stickyEditor .rich-editor-content', { timeout: 15000 });
  await waitFor('read-only', () => sticky.evaluate(() => document.documentElement.classList.contains('is-readonly')));
  assert.match(await sticky.textContent('#stickyStatus'), /cannot show/);
  assert.equal(await sticky.evaluate(() => document.querySelector('#stickyEditor .rich-editor-content').getAttribute('contenteditable')), 'false');
  await sleep(800);
  assert.equal(findNote('Gamma (copy)').body, lossy, 'nothing rewritten by just showing it');
  await sticky.click('#stickyCloseBtn');
  await waitFor('removed', () => !findNote('Gamma (copy)').sticky);
  await waitFor('window closed', () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).then((n) => n === 1));
  await page.fill('#bodyInput', 'pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('undo after switching notes does nothing; typing with the find bar open does not eat text', async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await page.fill('#bodyInput', 'gamma text');
  await waitFor('gamma saved', () => findNote('Gamma (copy)').body === 'gamma text');
  await useSourceMode(false);
  const other = readNotes().notes.find((n) => n.title !== 'Gamma (copy)' && !n.trashedAt && !n.filePath);
  await page.click('.note-card[data-id="' + other.id + '"]');
  await waitForDom((id) => !!document.querySelector('.note-card.is-active[data-id="' + id + '"]'), other.id);
  const before = await page.evaluate(() => document.getElementById('bodyInput').value);
  await page.click('.rich-editor-content');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await sleep(600);
  assert.equal(await page.evaluate(() => document.getElementById('bodyInput').value), before, 'undo did not bring the other note back');
  assert.equal(findNote(other.title).body, before);
  // Find bar open, typing in source view appends where the caret is.
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await page.keyboard.press('Control+Shift+f');
  await page.waitForSelector('#findBar:not(.hidden)');
  await page.fill('#findInput', 'gamma');
  await waitForDom(() => document.getElementById('findCount').textContent === '1/1');
  await page.click('#bodyInput');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' plus gamma');
  await waitFor('typed intact', () => findNote('Gamma (copy)').body === 'gamma text plus gamma');
  await waitForDom(() => /\/2$/.test(document.getElementById('findCount').textContent));
  await page.keyboard.press('Escape');
  await waitForDom(() => document.getElementById('findBar').classList.contains('hidden'));
  await page.fill('#bodyInput', 'pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('find in note counts and steps through matches; print asks the system to print', async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await page.fill('#bodyInput', 'needle one\nhay\nneedle two\n');
  await waitFor('body saved', () => findNote('Gamma (copy)').body === 'needle one\nhay\nneedle two\n');
  await page.keyboard.press('Control+Shift+f');
  await page.waitForSelector('#findBar:not(.hidden)');
  await page.fill('#findInput', 'needle');
  await waitForDom(() => document.getElementById('findCount').textContent === '1/2', 8000);
  await page.keyboard.press('Enter');
  await waitForDom(() => document.getElementById('findCount').textContent === '2/2', 8000);
  assert.deepEqual(await page.evaluate(() => [document.getElementById('bodyInput').selectionStart, document.getElementById('bodyInput').selectionEnd]), ['needle one\nhay\n'.length, 'needle one\nhay\nneedle'.length], 'source view selects the active match');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'bodyInput', 'focus moves to the text so the selection is visible');
  await page.keyboard.press('Shift+F3');
  await waitForDom(() => document.getElementById('findCount').textContent === '1/2', 8000);
  assert.deepEqual(await page.evaluate(() => [document.getElementById('bodyInput').selectionStart, document.getElementById('bodyInput').selectionEnd]), [0, 6]);
  // Enter while focus is in the text steps too; it must never replace the selected match with a newline.
  await page.keyboard.press('Enter');
  await waitForDom(() => document.getElementById('findCount').textContent === '2/2', 8000);
  await page.keyboard.press('Shift+Enter');
  await waitForDom(() => document.getElementById('findCount').textContent === '1/2', 8000);
  assert.equal(await page.evaluate(() => document.getElementById('bodyInput').value), 'needle one\nhay\nneedle two\n', 'text untouched by stepping');
  // Editing in the rendered view keeps the count honest.
  await page.click('#findInput');
  // Rendered view: the same search highlights ranges inside the editor only.
  await page.keyboard.press('Escape');
  await useSourceMode(false);
  await page.keyboard.press('Control+Shift+f');
  await page.waitForSelector('#findBar:not(.hidden)');
  await page.fill('#findInput', 'NEEDLE');
  await waitForDom(() => document.getElementById('findCount').textContent === '1/2', 8000);
  assert.equal(await page.evaluate(() => CSS.highlights.get('notes-find').size), 2, 'two highlighted ranges');
  await page.keyboard.press('Enter');
  await waitForDom(() => document.getElementById('findCount').textContent === '2/2', 8000);
  await page.click('.rich-editor-content');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' needle three');
  await waitForDom(() => /\/3$/.test(document.getElementById('findCount').textContent), 8000);
  await page.fill('#findInput', 'onehay');
  await waitForDom(() => document.getElementById('findCount').textContent === 'No matches', 8000); // no match across paragraphs
  await page.fill('#findInput', 'NEEDLE');
  await waitForDom(() => /\/3$/.test(document.getElementById('findCount').textContent), 8000);
  await page.keyboard.press('Escape');
  await waitForDom(() => !CSS.highlights.has('notes-find'));
  await useSourceMode(true);
  await page.keyboard.press('Control+Shift+f');
  await page.waitForSelector('#findBar:not(.hidden)');
  await page.fill('#findInput', 'zzzz-not-here');
  await waitForDom(() => document.getElementById('findCount').textContent === 'No matches', 8000);
  await page.keyboard.press('Escape');
  await waitForDom(() => document.getElementById('findBar').classList.contains('hidden'));
  await waitForDom(() => !document.getElementById('app').classList.contains('hidden'), 2000); // Esc closed the bar, not the window
  const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
  assert.equal(visible, true, 'Escape in the find bar must not hide the app');
  // Print (dry run in tests) goes through the main process and reports back.
  await page.keyboard.press('Control+Shift+p');
  await waitForDom(() => /Print: dry run/.test(document.getElementById('toast').textContent), 8000);
  await page.fill('#bodyInput', 'pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('reminders: set from the dialog, shown on the card and in the Reminders view, fired by the scheduler, cleared', { timeout: 30000 }, async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  const id = findNote('Gamma (copy)').id;
  assert.equal(await toolLabel('#remindBtn'), 'Remind me…');
  const before = Date.now();
  await page.keyboard.press('Control+Shift+m');
  await page.waitForSelector('#remindDialog[open]');
  assert.match(await page.textContent('#remindCurrent'), /No reminder/);
  await page.click('#remindQuick [data-pick="1h"]');
  await waitFor('reminder saved', () => { const n = findNote('Gamma (copy)'); return n.remindAt && n.remindAt > before + 3500 * 1000 && n.remindAt < before + 3700 * 1000; });
  await waitForDom(() => !document.getElementById('remindDialog').open);
  await waitForDom(() => document.getElementById('remindBtn').classList.contains('is-on'));
  await waitForDom(() => !!document.querySelector('.note-card.is-active .remind-mark'));
  await waitForDom(() => document.getElementById('countReminders').textContent === '1');
  await page.click('.nav-item[data-view="reminders"]');
  await waitForDom(() => document.querySelectorAll('.note-card').length === 1 && /Gamma/.test(document.querySelector('.note-card').textContent));
  // The scheduler announces a reminder when its time passes: toast in the app, badge turns overdue.
  await page.evaluate((nid) => window.notesApi.notes.update(nid, { remindAt: Date.now() + 600 }), id);
  await waitForDom(() => /⏰ Gamma \(copy\)/.test(document.getElementById('toast').textContent), 8000);
  await waitFor('marked reminded', () => { const n = findNote('Gamma (copy)'); return n.remindedAt && n.remindedAt >= n.remindAt; });
  await waitForDom(() => !!document.querySelector('.note-card .remind-mark.is-overdue'), 8000);
  await waitForDom(() => document.getElementById('countReminders').classList.contains('is-overdue'));
  // A later time rings again; clearing removes it from the view.
  await page.keyboard.press('Control+Shift+m');
  await page.waitForSelector('#remindDialog[open]');
  assert.match(await page.textContent('#remindCurrent'), /went off/);
  await page.click('#remindClearBtn');
  await waitFor('cleared', () => findNote('Gamma (copy)').remindAt === null);
  await waitForDom(() => document.getElementById('countReminders').textContent === '0');
  await waitForDom(() => document.querySelectorAll('.note-card').length === 0);
  await page.click('.nav-item[data-view="all"]');
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  // Typing a time in the picker works too.
  await page.keyboard.press('Control+Shift+m');
  await page.waitForSelector('#remindDialog[open]');
  await page.fill('#remindInput', '2031-01-02T09:30');
  await page.click('#remindSetBtn');
  await waitFor('typed time saved', () => findNote('Gamma (copy)').remindAt === new Date(2031, 0, 2, 9, 30).getTime());
  await page.evaluate((nid) => window.notesApi.notes.update(nid, { remindAt: null }), id);
  await waitFor('cleared again', () => findNote('Gamma (copy)').remindAt === null);
});

test('share: copy as Markdown, rich text and plain text; email via mailto; save as PDF and HTML', { timeout: 30000 }, async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await page.fill('#bodyInput', '# Head\n\n**bold** text\n');
  await waitFor('body saved', () => findNote('Gamma (copy)').body === '# Head\n\n**bold** text\n');
  const pdfPath = path.join(dataDir, 'share-out.pdf');
  const htmlPath = path.join(dataDir, 'share-out.html');
  await app.evaluate(({ dialog }, paths) => {
    dialog.showSaveDialog = async (_w, opts) => ({ canceled: false, filePath: /PDF/.test(opts.title) ? paths.pdf : paths.html });
    global.__shell.external = [];
  }, { pdf: pdfPath, html: htmlPath });
  const share = async (action) => {
    await page.keyboard.press('Control+Shift+s');
    await page.waitForSelector('#shareMenu:not(.hidden)');
    await page.click('#shareMenu [data-action="' + action + '"]');
    await waitForDom(() => document.getElementById('shareMenu').classList.contains('hidden'));
  };
  await share('copy-md');
  await waitFor('markdown on clipboard', () => app.evaluate(({ clipboard }) => clipboard.readText()).then((t) => /\*\*bold\*\* text/.test(t) && /Gamma \(copy\)/.test(t)));
  await share('copy-html');
  // Electron 44's clipboard module has no readHTML; ask Windows for the HTML format directly.
  const readHtmlClipboard = () => require('child_process').spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -TextFormatType Html'], { encoding: 'utf8' }).stdout || '';
  await waitFor('html on clipboard', () => { const t = readHtmlClipboard(); return /<strong>bold<\/strong>/.test(t) && /<h1>Gamma \(copy\)<\/h1>/.test(t); }, 10000);
  await share('copy-text');
  const plain = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.ok(/bold text/.test(plain) && !/\*\*/.test(plain), 'plain text has no Markdown markers: ' + JSON.stringify(plain));
  await share('email');
  await waitFor('mail client asked', () => shellCalls().then((s) => s.external.length > 0));
  const mailto = (await shellCalls()).external.at(-1);
  assert.ok(mailto.startsWith('mailto:?subject=Gamma%20(copy)&body='), mailto);
  assert.match(decodeURIComponent(mailto), /\*\*bold\*\* text/);
  await share('pdf');
  await waitFor('pdf written', () => fs.existsSync(pdfPath) && fs.readFileSync(pdfPath).slice(0, 5).toString() === '%PDF-', 15000);
  await waitForDom(() => /Saved PDF/.test(document.getElementById('toast').textContent));
  await share('html');
  await waitFor('html written', () => fs.existsSync(htmlPath));
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /<title>Gamma \(copy\)<\/title>/);
  assert.match(html, /<strong>bold<\/strong>/);
  // Esc closes the menu without hiding the window.
  await page.keyboard.press('Control+Shift+s');
  await page.waitForSelector('#shareMenu:not(.hidden)');
  await page.keyboard.press('Escape');
  await waitForDom(() => document.getElementById('shareMenu').classList.contains('hidden'));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  await page.fill('#bodyInput', 'pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('locking: a password locks the note, the file holds no plaintext, wrong password is refused, hiding the app relocks', { timeout: 60000 }, async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await page.fill('#bodyInput', 'the launch code is 4242-flamingo');
  await waitFor('body saved', () => findNote('Gamma (copy)').body === 'the launch code is 4242-flamingo');
  const id = findNote('Gamma (copy)').id;
  await page.keyboard.press('Control+l');
  await page.waitForSelector('#lockDialog[open]');
  await page.fill('#lockPassword', 'pw-one');
  await page.fill('#lockPassword2', 'pw-two');
  await page.click('#lockSubmitBtn');
  await waitForDom(() => /differ/.test(document.getElementById('lockError').textContent));
  await page.fill('#lockPassword2', 'pw-one');
  await page.click('#lockSubmitBtn');
  await waitFor('locked on disk', () => { const n = findNote('Gamma (copy)'); return n.lock && n.lock.ct && n.body === ''; });
  assert.ok(!fs.readFileSync(notesFile, 'utf8').includes('flamingo'), 'no plaintext in notes.json');
  await waitForDom(() => document.querySelector('#lockBtn .lbl').textContent === 'Unlocked');
  assert.equal(await page.inputValue('#bodyInput'), 'the launch code is 4242-flamingo', 'still readable right after locking');
  // Editing while unlocked re-encrypts.
  await page.fill('#bodyInput', 'the launch code is 9999-pelican');
  await sleep(900);
  await waitFor('edit encrypted', () => !fs.readFileSync(notesFile, 'utf8').includes('pelican') && findNote('Gamma (copy)').body === '');
  // Lock now from the lock menu.
  await clickTool('#lockBtn');
  await page.waitForSelector('#lockMenu:not(.hidden)');
  await page.click('#lockMenu [data-action="relock"]');
  await page.waitForSelector('#lockScreen:not(.hidden)');
  assert.ok(await page.evaluate(() => document.getElementById('bodyInput').classList.contains('hidden') && document.getElementById('richEditor').classList.contains('hidden')), 'editors hidden while locked');
  await waitForDom(() => /Locked note/.test(document.querySelector('.note-card.is-active').textContent));
  assert.equal(await page.evaluate(() => document.getElementById('stickyBtn').disabled), true, 'no stickies for locked notes');
  // Search finds the title, not the body.
  await page.fill('#searchInput', 'pelican');
  await waitForDom(() => document.querySelectorAll('.note-card').length === 0 && /No|Nothing/.test(document.querySelector('.list-pane').textContent));
  await page.fill('#searchInput', '');
  await page.click('.note-card:has-text("Gamma (copy)")');
  await page.waitForSelector('#lockScreen:not(.hidden)');
  // Title and tags still save while the body is locked.
  await page.fill('#titleInput', 'Gamma (copy) renamed');
  await waitFor('title saved while locked', () => findNote('Gamma (copy) renamed') && findNote('Gamma (copy) renamed').body === '');
  await page.fill('#titleInput', 'Gamma (copy)');
  await waitFor('title back', () => !!findNote('Gamma (copy)'));
  // Wrong password, then right password.
  await page.fill('#lockScreenPassword', 'nope');
  await page.click('#lockScreenBtn');
  await waitForDom(() => /Wrong password/.test(document.getElementById('lockScreenError').textContent));
  await page.fill('#lockScreenPassword', 'pw-one');
  await page.keyboard.press('Enter');
  await waitForDom(() => document.getElementById('lockScreen').classList.contains('hidden'));
  assert.equal(await page.inputValue('#bodyInput'), 'the launch code is 9999-pelican');
  // Hiding the app relocks (the window is shown again by the test harness through the main process).
  await page.evaluate(() => window.notesApi.app.hide());
  await waitFor('hidden', () => app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isVisible()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  await page.waitForSelector('#lockScreen:not(.hidden)', { timeout: 8000 });
  assert.equal(await page.inputValue('#bodyInput'), '', 'plaintext cleared from the editor');
  // Remove the lock: body back in clear.
  await page.fill('#lockScreenPassword', 'pw-one');
  await page.keyboard.press('Enter');
  await waitForDom(() => document.getElementById('lockScreen').classList.contains('hidden'));
  await clickTool('#lockBtn');
  await page.waitForSelector('#lockMenu:not(.hidden)');
  await page.click('#lockMenu [data-action="remove"]');
  await page.waitForSelector('#lockDialog[open]');
  await page.fill('#lockPassword', 'pw-one');
  await page.click('#lockSubmitBtn');
  await waitFor('lock removed', () => { const n = findNote('Gamma (copy)'); return !n.lock && n.body === 'the launch code is 9999-pelican'; });
  await waitForDom(() => document.querySelector('#lockBtn .lbl').textContent === 'Lock');
  await page.fill('#bodyInput', 'pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
  void id;
});

test('live share: the app hosts a note; another participant over HTTP sees edits as they happen and can edit back', { timeout: 60000 }, async () => {
  const http = require('http');
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await page.fill('#bodyInput', 'shared v1');
  await waitFor('body saved', () => findNote('Gamma (copy)').body === 'shared v1');
  const id = findNote('Gamma (copy)').id;
  await page.keyboard.press('Control+Shift+s');
  await page.waitForSelector('#shareMenu:not(.hidden)');
  await page.click('#shareMenu [data-action="live-host"]');
  await page.waitForSelector('#liveDialog[open]');
  const url = await page.inputValue('#liveLinkInput');
  assert.match(url, /^http:\/\/[\d.]+:\d+\/live\/[0-9a-f]{32}$/);
  await page.click('#liveCancelBtn');
  await waitFor('flag persisted', () => findNote('Gamma (copy)').live && findNote('Gamma (copy)').live.role === 'host');
  await page.waitForSelector('#liveRow:not(.hidden)');
  await waitForDom(() => !!document.querySelector('.note-card.is-active .live-mark'));
  // The other participant: fetch the state, then follow the event stream.
  const local = url.replace(/\/\/[\d.]+:/, '//127.0.0.1:');
  const getJson = (u) => new Promise((resolve, reject) => http.get(u, (res) => { let t = ''; res.on('data', (d) => (t += d)); res.on('end', () => { try { resolve(JSON.parse(t)); } catch (e) { reject(e); } }); }).on('error', reject));
  assert.equal((await getJson(local)).body, 'shared v1');
  const events = [];
  const es = await new Promise((resolve, reject) => { const req = http.get(local + '/events', (res) => { res.setEncoding('utf8'); let buf = ''; res.on('data', (ch) => { buf += ch; let i; while ((i = buf.indexOf('\n\n')) !== -1) { const f = buf.slice(0, i); buf = buf.slice(i + 2); const d = f.split('\n').find((l) => l.startsWith('data: ')); if (d) events.push(JSON.parse(d.slice(6))); } }); resolve(req); }); req.on('error', reject); });
  await waitFor('initial state event', () => events.length >= 1);
  await waitForDom(() => /1 person connected/.test(document.getElementById('liveText').textContent));
  // Host types -> participant receives within the push window.
  await page.fill('#bodyInput', 'shared v2 from app');
  await waitFor('participant got v2', () => events.some((e) => e.body === 'shared v2 from app'), 8000);
  // Participant edits -> the app's editor updates live (it is not being typed in).
  await sleep(1600);
  const post = (u, data) => new Promise((resolve, reject) => { const body = Buffer.from(JSON.stringify(data)); const req = http.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, (res) => { let t = ''; res.on('data', (d) => (t += d)); res.on('end', () => resolve({ status: res.statusCode, text: t })); }); req.on('error', reject); req.end(body); });
  const r = await post(local, { title: 'Gamma (copy)', body: 'shared v3 from the other side', clientId: 'tester' });
  assert.equal(r.status, 200);
  await waitForDom(() => document.getElementById('bodyInput').value === 'shared v3 from the other side', 8000);
  await waitFor('stored', () => findNote('Gamma (copy)').body === 'shared v3 from the other side');
  // A wrong token gets nothing.
  const bad = await new Promise((resolve) => http.get(local.replace(/[0-9a-f]{32}$/, '0'.repeat(32)), (res) => { res.resume(); resolve(res.statusCode); }));
  assert.equal(bad, 404);
  // Stop: the participant's stream ends, the flag clears, the note stays.
  let ended = false; es.on('close', () => { ended = true; }); es.on('response', (res) => res.on('end', () => { ended = true; }));
  await page.click('#liveStopBtn');
  await waitFor('flag cleared', () => !findNote('Gamma (copy)').live);
  await waitForDom(() => document.getElementById('liveRow').classList.contains('hidden'));
  es.destroy();
  assert.equal(findNote('Gamma (copy)').body, 'shared v3 from the other side');
  // Joining a dead link reports an error instead of creating a note.
  const before = readNotes().notes.length;
  await page.keyboard.press('Control+Shift+s');
  await page.waitForSelector('#shareMenu:not(.hidden)');
  await page.click('#shareMenu [data-action="live-join"]');
  await page.waitForSelector('#liveDialog[open]');
  await page.fill('#liveLinkInput', local);
  await page.click('#liveSubmitBtn');
  await waitForDom(() => /ECONNREFUSED|refused|HTTP|ended|closed/i.test(document.getElementById('liveError').textContent), 10000);
  await page.click('#liveCancelBtn');
  assert.equal(readNotes().notes.length, before, 'no note created for a failed join');
  void id;
  await page.fill('#bodyInput', 'pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('hardening: the page cannot be navigated away, and "Open with…" refuses programs', async () => {
  const opened = await page.evaluate(() => { const w = window.open('file:///C:/Windows/win.ini'); return w === null; });
  assert.equal(opened, true, 'window.open is denied');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'no extra window');
  const bat = path.join(dataDir, 'danger.bat');
  fs.writeFileSync(bat, '@echo off\r\n');
  const linked = await page.evaluate((p) => window.notesApi.files.link([p]), bat);
  const note = (Array.isArray(linked) ? linked : linked.notes || [])[0] || readNotes().notes.find((n) => n.filePath && /danger\.bat$/.test(n.filePath));
  assert.ok(note, 'linked');
  const before = await shellCalls();
  const res = await page.evaluate((id) => window.notesApi.files.openExternal(id), note.id);
  assert.match(String(res), /Shown in Explorer instead/);
  const after = await shellCalls();
  assert.equal(after.shown.at(-1), bat, 'shown in Explorer');
  assert.equal(after.opened.length, before.opened.length, 'the program was not run');
  await page.evaluate((id) => window.notesApi.notes.destroy(id), note.id);
});

test('replace in note: one at a time and all, in source and rendered views', async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  // Offsets are measured on the original text: a capital İ (two code units when lower-cased) must not shift them.
  await page.fill('#bodyInput', 'İstanbul foo bar foo');
  await waitFor('turkish saved', () => findNote('Gamma (copy)').body === 'İstanbul foo bar foo');
  await page.keyboard.press('Control+h');
  await page.waitForSelector('#replaceRow:not(.hidden)');
  await page.fill('#findInput', 'foo');
  await waitForDom(() => document.getElementById('findCount').textContent === '1/2');
  await page.fill('#replaceInput', 'X');
  await page.click('#replaceAllBtn');
  await waitFor('offsets intact', () => findNote('Gamma (copy)').body === 'İstanbul X bar X');
  await page.keyboard.press('Escape');
  await page.fill('#bodyInput', 'cat sat\ncat ran\ncat hid\n');
  await waitFor('saved', () => findNote('Gamma (copy)').body === 'cat sat\ncat ran\ncat hid\n');
  await page.keyboard.press('Control+h');
  await page.waitForSelector('#replaceRow:not(.hidden)');
  await page.fill('#findInput', 'cat');
  await waitForDom(() => document.getElementById('findCount').textContent === '1/3');
  await page.fill('#replaceInput', 'dog');
  await page.click('#replaceOneBtn');
  await waitFor('one replaced', () => findNote('Gamma (copy)').body === 'dog sat\ncat ran\ncat hid\n');
  await waitForDom(() => document.getElementById('findCount').textContent === '1/2');
  assert.deepEqual(await page.evaluate(() => [document.getElementById('bodyInput').selectionStart, document.getElementById('bodyInput').selectionEnd]), ['dog sat\n'.length, 'dog sat\ncat'.length], 'the very next match is selected, none skipped');
  await page.click('#replaceOneBtn');
  await waitFor('second replaced in order', () => findNote('Gamma (copy)').body === 'dog sat\ndog ran\ncat hid\n');
  await page.click('#replaceAllBtn');
  await waitFor('all replaced', () => findNote('Gamma (copy)').body === 'dog sat\ndog ran\ndog hid\n');
  await waitForDom(() => document.getElementById('findCount').textContent === 'No matches');
  // Rendered view.
  await page.keyboard.press('Escape');
  await useSourceMode(false);
  await page.keyboard.press('Control+h');
  await page.waitForSelector('#replaceRow:not(.hidden)');
  await page.fill('#findInput', 'dog');
  await waitForDom(() => document.getElementById('findCount').textContent === '1/3');
  await page.fill('#replaceInput', 'fox');
  await page.click('#replaceAllBtn');
  // The rendered view serializes without a trailing newline; the replacement itself is what matters.
  // A hard break may serialize as backslash-newline; the replacement itself is what matters.
  await waitFor('rendered all replaced', () => findNote('Gamma (copy)').body.replace(/\\\n/g, '\n').replace(/\n$/, '') === 'fox sat\nfox ran\nfox hid', 8000);
  await page.keyboard.press('Escape');
  await useSourceMode(true);
  await page.fill('#bodyInput', 'pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('history: earlier versions are listed and one can be restored', { timeout: 40000 }, async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await page.fill('#bodyInput', 'version one');
  await waitFor('v1 saved', () => findNote('Gamma (copy)').body === 'version one');
  await sleep(1200); // the history commit debounce in tests is 300 ms
  await page.fill('#bodyInput', 'version two');
  await waitFor('v2 saved', () => findNote('Gamma (copy)').body === 'version two');
  await sleep(1200);
  await page.keyboard.press('Control+Shift+h');
  await page.waitForSelector('#historyDialog[open]');
  await waitForDom(() => document.querySelectorAll('#historyList li').length >= 1, 15000);
  await waitForDom(() => /version one/.test(document.getElementById('historyList').textContent) || /version one/.test(document.getElementById('historyPreview').textContent));
  const items = await page.$$eval('#historyList li', (els) => els.map((e) => e.textContent));
  const idx = items.findIndex((t) => /version one/.test(t));
  await page.click('#historyList li:nth-child(' + (idx + 1) + ')');
  await waitForDom(() => document.getElementById('historyPreview').textContent === 'version one');
  await page.click('#historyRestoreBtn');
  await waitFor('restored', () => findNote('Gamma (copy)').body === 'version one');
  assert.equal(await page.inputValue('#bodyInput'), 'version one');
  await page.fill('#bodyInput', 'pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('attachments and voice memos: files are copied in and linked; links open through the app; note links jump', { timeout: 40000 }, async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await page.fill('#bodyInput', 'files:');
  await waitFor('saved', () => findNote('Gamma (copy)').body === 'files:');
  const src = path.join(dataDir, 'budget.csv');
  fs.writeFileSync(src, 'a,b\n1,2\n');
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async (_w, opts) => (/Attach/.test(opts.title) ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] });
    global.__shell.opened = []; global.__shell.shown = [];
  }, src);
  await page.keyboard.press('Control+Shift+o');
  await waitFor('attachment copied', () => fs.existsSync(path.join(dataDir, 'attachments', 'budget.csv')));
  await waitFor('link in note', () => /\[📎 budget\.csv\]\(attachment:\/\/budget\.csv\)/.test(findNote('Gamma (copy)').body));
  // Ctrl+click in the rendered view opens the attachment through the app's guard.
  await useSourceMode(false);
  await page.waitForSelector('.rich-editor-content a[href^="attachment://"]');
  await page.click('.rich-editor-content a[href^="attachment://"]', { modifiers: ['Control'] });
  await waitFor('opened', () => shellCalls().then((s) => s.opened.length === 1 && /attachments[\\/]budget\.csv$/.test(s.opened[0])));
  // A forged link cannot escape the attachments folder or run a program.
  assert.match(String(await page.evaluate(() => window.notesApi.attachments.open('attachment://..%2F..%2Fnotes.json'))), /Not an attachment|not found/);
  fs.writeFileSync(path.join(dataDir, 'attachments', 'evil.bat'), '@echo off');
  assert.match(String(await page.evaluate(() => window.notesApi.attachments.open('attachment://evil.bat'))), /Shown in Explorer instead/);
  assert.deepEqual((await shellCalls()).shown.map((p) => path.basename(p)), ['evil.bat'], 'shown in Explorer, never run');
  assert.equal((await shellCalls()).opened.length, 1, 'evil.bat was not handed to its default app');
  assert.match(String(await page.evaluate(() => window.notesApi.attachments.open('attachment://evil.bat.'))), /Not an attachment/);
  assert.match(String(await page.evaluate(() => window.notesApi.attachments.open('attachment://evil.bat%3A%3A%24DATA'))), /Not an attachment/);
  // Voice memo with the fake microphone.
  await page.keyboard.press('Control+Shift+g');
  await waitForDom(() => document.getElementById('recordBtn').classList.contains('is-recording'), 8000);
  await sleep(1200);
  await clickTool('#recordBtn');
  await waitFor('recording saved', () => fs.existsSync(path.join(dataDir, 'attachments')) && fs.readdirSync(path.join(dataDir, 'attachments')).some((f) => /^Recording .*\.webm$/.test(f) && fs.statSync(path.join(dataDir, 'attachments', f)).size > 0), 15000);
  await waitFor('memo linked', () => /🎙 Voice memo \d\d:\d\d\]\(attachment:\/\/Recording/.test(findNote('Gamma (copy)').body));
  // Note link: pick another note in the link dialog, then Ctrl+click jumps to it.
  const other = readNotes().notes.find((n) => n.title !== 'Gamma (copy)' && !n.trashedAt && !n.filePath && !n.locked);
  await useSourceMode(true);
  await page.fill('#bodyInput', 'see also');
  await waitFor('saved2', () => findNote('Gamma (copy)').body === 'see also');
  await useSourceMode(false);
  await page.click('.rich-editor-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#linkDialog[open]');
  await waitForDom((id) => !!document.querySelector('#linkNoteSelect option[value="note://' + id + '"]'), other.id);
  await page.selectOption('#linkNoteSelect', 'note://' + other.id);
  await page.click('#linkApplyBtn');
  await waitFor('note link saved', () => findNote('Gamma (copy)').body === '[see also](note://' + other.id + ')');
  await page.click('.rich-editor-content a[href^="note://"]', { modifiers: ['Control'] });
  await waitForDom((id) => !!document.querySelector('.note-card.is-active[data-id="' + id + '"]'), other.id);
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await page.fill('#bodyInput', 'pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('zoom: Ctrl+= zooms in, Ctrl+- out, Ctrl+0 resets, and the level is remembered; right-click shows a menu', async () => {
  const level = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel());
  // Through Electron's real input path (what a physical key press takes); Playwright's keyboard injects below it.
  const realKey = (k) => app.evaluate(({ BrowserWindow }, keyCode) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] }); }, k);
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  const start = await level();
  await realKey('=');
  await waitFor('zoomed in', async () => (await level()) === start + 0.5);
  await realKey('=');
  await waitFor('zoomed in twice', async () => (await level()) === start + 1);
  await waitFor('remembered', () => readNotes().settings.zoomLevel === start + 1);
  await realKey('-');
  await waitFor('zoomed out', async () => (await level()) === start + 0.5);
  await realKey('0');
  await waitFor('reset', async () => (await level()) === 0);
  await waitFor('reset remembered', () => readNotes().settings.zoomLevel === 0);
  // Right-click in the editor: the menu is built with the edit actions and popped up.
  await app.evaluate(({ Menu }) => { global.__menus = []; const orig = Menu.prototype.popup; Menu.prototype.popup = function () { global.__menus.push(this.items.map((i) => i.label).filter(Boolean)); }; global.__restorePopup = () => { Menu.prototype.popup = orig; }; });
  await useSourceMode(true);
  await page.click('#bodyInput', { button: 'right' });
  await waitFor('menu shown', () => app.evaluate(() => global.__menus.length).then((n) => n >= 1));
  const labels = await app.evaluate(() => global.__menus[global.__menus.length - 1]);
  for (const l of ['Cut', 'Copy', 'Paste', 'Select all', 'Zoom in']) assert.ok(labels.includes(l), 'menu has ' + l + ': ' + labels.join(', '));
  // A folder row keeps its own menu: no native menu on top of it.
  const before = await app.evaluate(() => global.__menus.length);
  const row = await page.$('.folder-row');
  if (row) {
    await row.click({ button: 'right' });
    await waitForDom(() => !document.getElementById('folderMenu').classList.contains('hidden'));
    await sleep(300);
    assert.equal(await app.evaluate(() => global.__menus.length), before, 'folder row shows only the app menu');
    await page.keyboard.press('Escape');
  }
  await app.evaluate(() => global.__restorePopup());
});

test('books: a folder becomes a book with page tabs; pages turn, get added and reorder; related notes list links and backlinks', { timeout: 60000 }, async () => {
  // A folder with three notes, made into a book from the folder menu.
  const folder = await page.evaluate(() => window.notesApi.folders.create({ name: 'Novel' }));
  const mk = (title) => page.evaluate(([t, f]) => window.notesApi.notes.create({ title: t, body: t + ' text', folderId: f }), [title, folder.id]);
  const one = await mk('Chapter 1'); await sleep(5); const two = await mk('Chapter 2'); await sleep(5); const three = await mk('Chapter 3');
  await page.click('.nav-item[data-view="all"]');
  await page.waitForSelector('.folder-row[data-id="' + folder.id + '"]');
  await page.click('.folder-row[data-id="' + folder.id + '"]', { button: 'right' });
  await waitForDom(() => !document.getElementById('folderMenu').classList.contains('hidden'));
  assert.equal(await page.textContent('#folderMenuBook'), 'Turn into a book');
  await page.click('#folderMenuBook');
  await waitFor('book flag', () => readNotes().folders.find((f) => f.id === folder.id).book === true);
  await page.click('.folder-row[data-id="' + folder.id + '"]');
  await waitForDom(() => document.querySelectorAll('.note-card').length === 3 && /p\. 1/.test(document.querySelector('.note-card').textContent));
  const order = () => page.$$eval('.note-card', (els) => els.map((e) => e.querySelector('.note-card-title').textContent.replace(/^p\. \d+/, '').trim()));
  assert.deepEqual(await order(), ['Chapter 1', 'Chapter 2', 'Chapter 3'], 'reading order = creation order');
  await page.click('.note-card[data-id="' + one.id + '"]');
  await page.waitForSelector('#bookStrip:not(.hidden)');
  await waitForDom(() => document.querySelectorAll('#bookTabs .book-tab').length === 3);
  assert.equal(await page.textContent('#bookName'), 'Novel');
  assert.equal(await page.evaluate(() => document.getElementById('bookPrevBtn').disabled), true);
  // Turn pages with the button and with Ctrl+PageDown / Ctrl+PageUp.
  await page.click('#bookNextBtn');
  await waitForDom((id) => document.querySelector('#bookTabs .book-tab.is-active') && document.querySelector('#bookTabs .book-tab.is-active').dataset.id === id, two.id);
  await page.keyboard.press('Control+PageDown');
  await waitForDom((id) => document.getElementById('titleInput').value === 'Chapter 3', three.id);
  assert.equal(await page.evaluate(() => document.getElementById('bookNextBtn').disabled), true);
  await page.keyboard.press('Control+PageUp');
  await waitForDom(() => document.getElementById('titleInput').value === 'Chapter 2');
  // Click a tab.
  await page.click('#bookTabs .book-tab[data-id="' + one.id + '"]');
  await waitForDom(() => document.getElementById('titleInput').value === 'Chapter 1');
  // Reorder: Chapter 3 before Chapter 1 (the store call the drag-and-drop makes).
  await page.evaluate(([f, ids]) => window.notesApi.folders.reorderPages(f, ids), [folder.id, [three.id, one.id, two.id]]);
  await page.click('.folder-row[data-id="' + folder.id + '"]');
  await waitForDom(() => /Chapter 3/.test(document.querySelector('.note-card').textContent));
  assert.deepEqual(await order(), ['Chapter 3', 'Chapter 1', 'Chapter 2']);
  // Drag a tab in the strip: Chapter 2 onto Chapter 3 puts it first.
  await page.click('.note-card[data-id="' + one.id + '"]');
  await waitForDom(() => document.querySelectorAll('#bookTabs .book-tab').length === 3);
  await page.dragAndDrop('#bookTabs .book-tab[data-id="' + two.id + '"]', '#bookTabs .book-tab[data-id="' + three.id + '"]');
  await waitFor('dragged order saved', () => JSON.stringify(readNotes().folders.find((f) => f.id === folder.id).pageOrder) === JSON.stringify([two.id, three.id, one.id]), 8000);
  // + Page adds a page at the end and opens it.
  await page.click('#bookAddBtn');
  await waitFor('page added', () => readNotes().notes.filter((n) => n.folderId === folder.id && !n.trashedAt).length === 4);
  await waitForDom(() => document.querySelectorAll('#bookTabs .book-tab').length === 4 && document.querySelector('#bookTabs .book-tab:last-child').classList.contains('is-active'));
  await page.fill('#titleInput', 'Epilogue');
  await waitFor('epilogue saved', () => readNotes().notes.some((n) => n.title === 'Epilogue' && n.folderId === folder.id));
  // Related notes: Chapter 1 links to Chapter 2 -> Chapter 2 shows it under "Linked from".
  await page.evaluate(([id, target]) => window.notesApi.notes.update(id, { body: 'see [next](note://' + target + ')', tags: 'novel' }), [one.id, two.id]);
  await page.evaluate((id) => window.notesApi.notes.update(id, { tags: 'novel' }), three.id);
  await page.click('#bookTabs .book-tab[data-id="' + two.id + '"]');
  await waitForDom(() => document.getElementById('titleInput').value === 'Chapter 2');
  await waitForDom(() => !document.getElementById('relatedIn').classList.contains('hidden') && /Chapter 1/.test(document.getElementById('relatedIn').textContent), 8000);
  await page.click('#bookTabs .book-tab[data-id="' + one.id + '"]');
  await waitForDom(() => document.getElementById('titleInput').value === 'Chapter 1');
  await waitForDom(() => /Chapter 2/.test(document.getElementById('relatedOut').textContent) && /Chapter 3/.test(document.getElementById('relatedTags').textContent), 8000);
  await page.click('#relatedOut button');
  await waitForDom(() => document.getElementById('titleInput').value === 'Chapter 2');
  // Back to a folder: no strip.
  await page.click('.folder-row[data-id="' + folder.id + '"]', { button: 'right' });
  await waitForDom(() => document.getElementById('folderMenuBook').textContent === 'Turn back into a folder');
  await page.click('#folderMenuBook');
  await waitFor('book off', () => readNotes().folders.find((f) => f.id === folder.id).book === false);
  await page.click('.note-card[data-id="' + one.id + '"]');
  await waitForDom(() => document.getElementById('bookStrip').classList.contains('hidden'));
  await page.click('.nav-item[data-view="all"]');
});

test('speech: read aloud speaks the note and stops; dictation hands off to Windows', async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  const voices = await page.evaluate(() => (window.speechSynthesis ? window.speechSynthesis.getVoices().length : -1));
  assert.ok(voices >= 0, 'speechSynthesis exists');
  await clickTool('#readAloudBtn');
  await waitForDom(() => document.getElementById('readAloudBtn').classList.contains('is-on'));
  if (voices > 0) {
    await waitForDom(() => window.speechSynthesis.speaking || window.speechSynthesis.pending, 5000);
  }
  await clickTool('#readAloudBtn');
  await waitForDom(() => !document.getElementById('readAloudBtn').classList.contains('is-on'));
  assert.equal(await page.evaluate(() => window.speechSynthesis.speaking), false);
  await page.keyboard.press('Control+Shift+r');
  await waitForDom(() => document.getElementById('readAloudBtn').classList.contains('is-on'));
  await page.keyboard.press('Control+Shift+r');
  await waitForDom(() => !document.getElementById('readAloudBtn').classList.contains('is-on'));

  // Voice and rate persist.
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await page.$eval('#ttsRateInput', (i) => { i.value = '1.4'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitFor('rate persisted', () => readNotes().settings.ttsRate === 1.4);
  const options = await page.$$eval('#ttsVoiceSelect option', (o) => o.map((x) => x.value));
  if (options.length > 1) {
    await page.selectOption('#ttsVoiceSelect', options[1]);
    await waitFor('voice persisted', () => readNotes().settings.ttsVoice === options[1]);
  }
  await page.click('#closeSettingsBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);

  // Dictation is a hand-off to Windows (dry run in tests so no dictation window opens).
  const res = await page.evaluate(() => window.notesApi.app.dictate());
  assert.deepEqual(res, { ok: true, method: 'windows-dictation', dryRun: true });
});

test('writing column: alignment and width settings move and size the block', async () => {
  const col = () => page.evaluate(() => {
    const c = document.getElementById('editorColumn');
    const cs = getComputedStyle(c);
    return { cls: c.className, width: c.getBoundingClientRect().width, left: c.getBoundingClientRect().left, // The scroll area minus its scrollbar: a long note shows one, and the column centres in what is left.
    paneLeft: document.querySelector('.editor-scroll').getBoundingClientRect().left, paneWidth: document.querySelector('.editor-scroll').clientWidth, maxWidth: cs.maxWidth };
  });
  const before = await col();
  assert.match(before.cls, /align-center/);
  assert.match(before.cls, /full-width/);
  assert.equal(before.maxWidth, 'none');
  assert.ok(Math.abs(before.width - before.paneWidth) < 2, 'fills the pane: ' + before.width + ' vs ' + before.paneWidth);

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  assert.equal(await page.$eval('#editorWidthInput', (i) => i.disabled), true);
  await page.uncheck('#editorFullWidthInput');
  await waitFor('a width persisted', () => readNotes().settings.editorWidth === 760);
  assert.equal((await col()).maxWidth, '760px');
  await page.click('#alignSeg button[data-align="center"]');
  await waitFor('center persisted', () => readNotes().settings.editorAlign === 'center');
  const centered = await col();
  assert.match(centered.cls, /align-center/);
  const leftGap = centered.left - centered.paneLeft;
  const rightGap = centered.paneLeft + centered.paneWidth - (centered.left + centered.width);
  assert.ok(Math.abs(leftGap - rightGap) < 2, 'centered within the pane: ' + leftGap + ' vs ' + rightGap);

  await page.click('#alignSeg button[data-align="right"]');
  await waitFor('right persisted', () => readNotes().settings.editorAlign === 'right');
  const righted = await col();
  assert.ok(righted.paneLeft + righted.paneWidth - (righted.left + righted.width) < 2, 'flush right');

  await page.$eval('#editorWidthInput', (i) => { i.value = '600'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitFor('width persisted', () => readNotes().settings.editorWidth === 600);
  assert.equal((await col()).maxWidth, '600px');

  await page.check('#editorFullWidthInput');
  await waitFor('full width persisted', () => readNotes().settings.editorWidth === 0);
  assert.match((await col()).cls, /full-width/);
  assert.equal(await page.$eval('#editorWidthInput', (i) => i.disabled), true);

  await page.click('#alignSeg button[data-align="center"]');
  await waitFor('restored', () => readNotes().settings.editorAlign === 'center' && readNotes().settings.editorWidth === 0);
  await page.click('#closeSettingsBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
});

test('git history: edits are committed to a repo in the data folder', async () => {
  const { execFileSync } = require('child_process');
  const repoDir = path.join(dataDir, 'history');
  const count = () => { try { return parseInt(execFileSync('git', ['-C', repoDir, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim(), 10) || 0; } catch (_) { return 0; } };
  await useSourceMode(true);
  await waitFor('at least one commit exists', () => count() >= 1, 10000);
  const before = count();
  await page.fill('#bodyInput', 'committed text ' + Date.now());
  await waitFor('new commit after an edit', () => count() > before, 10000);
  const tracked = execFileSync('git', ['-C', repoDir, 'ls-files'], { encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(tracked, ['notes.json'], 'only notes.json is tracked');
  assert.equal(fs.existsSync(path.join(dataDir, '.git')), false, 'the data folder itself is not a repo');

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await waitForDom(() => /commit/.test(document.getElementById('gitStatus').textContent));
  assert.equal(await page.$eval('#gitPushBtn', (b) => b.disabled), true, 'push disabled without a remote');
  await waitForDom(() => document.getElementById('toast').classList.contains('hidden'));
  await page.click('#gitCommitBtn');
  await waitForDom(() => !document.getElementById('toast').classList.contains('hidden') && /Committed|Nothing new to commit|Commit failed/.test(document.getElementById('toast').textContent));
  assert.match(await page.textContent('#toast'), /Committed|Nothing new to commit/);
  await page.click('#closeSettingsBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
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
  await clickTool('#deleteBtn');
  await waitFor('trashed', () => findNote('Gamma (copy)').trashedAt);
  await page.click('#toast button:has-text("Undo")');
  await waitFor('undo restored', () => !findNote('Gamma (copy)').trashedAt);
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');

  await page.keyboard.press('Control+Shift+Delete');
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
  await clickTool('#deleteBtn');
  await page.click('.nav-item[data-view="trash"]');
  await page.click('.note-card:has-text("Gamma (copy)")');
  await page.click('#destroyBtn');
  await waitFor('destroyed', () => !findNote('Gamma (copy)'));

  await page.click('.nav-item[data-view="all"]');
  await page.click('.note-card:has-text("Beta")');
  await clickTool('#deleteBtn');
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

  // Windows refuses topmost changes from a background process while another app holds the foreground, so the
  // OS flag is not assertable from an inactive test window; the setting and the request are.
  await page.check('#alwaysOnTopInput');
  await waitFor('always on top persisted', () => readNotes().settings.alwaysOnTop === true);
  console.log('  [settings] OS reports alwaysOnTop =', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()));
  await page.uncheck('#alwaysOnTopInput');
  await waitFor('always on top cleared', () => readNotes().settings.alwaysOnTop === false);

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
  await clickTool('#exportBtn');
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

  // Direct count on the parent (what its view lists): In Work + Imported note; Gamma sits in Clients.
  await waitForCount('Work', 2);
  await waitForCount('Clients', 1);
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

  // Emptying the trash while a search is active deletes only the listed notes.
  await page.click('.nav-item[data-view="all"]');
  for (const t of ['In Work', 'Imported note']) {
    await page.click(`.note-card:has-text("${t}")`);
    await waitForDom((x) => document.getElementById('titleInput').value === x, t);
    await page.keyboard.press('Control+Shift+Delete');
    await waitFor(t + ' trashed', () => findNote(t).trashedAt);
  }
  await page.click('.nav-item[data-view="trash"]');
  await page.fill('#searchInput', 'Imported');
  await waitForDom(() => document.querySelectorAll('.note-card').length === 1);
  await page.click('#emptyTrashBtn');
  await waitFor('only the searched note destroyed', () => !findNote('Imported note'));
  assert.ok(findNote('In Work') && findNote('In Work').trashedAt, 'the other trashed note survives');
  await page.fill('#searchInput', '');
  await page.click('.note-card:has-text("In Work")');
  await page.click('#restoreBtn');
  await waitFor('In Work restored', () => !findNote('In Work').trashedAt);
  await page.click('.nav-item[data-view="all"]');
  await waitForCount('Work', 2);
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

test('layout: panes scroll with the wheel; the note list hides and follows the open note\'s folder', { timeout: 60000 }, async () => {
  // The grid row is the window's height, so a long list scrolls inside its pane.
  const rows = await page.evaluate(() => ({ row: parseFloat(getComputedStyle(document.getElementById('app')).gridTemplateRows), win: innerHeight }));
  assert.ok(Math.abs(rows.row - rows.win) < 2, 'grid row ' + rows.row + ' vs window ' + rows.win);
  const many = await page.evaluate(async () => { const ids = []; for (let i = 0; i < 40; i++) ids.push((await window.notesApi.notes.create({ title: 'Scroll filler ' + i, body: 'x' })).id); return ids; });
  await page.click('.nav-item[data-view="all"]');
  await waitForDom(() => document.querySelectorAll('.note-card').length >= 40);
  const listBox = await page.evaluate(() => { const e = document.getElementById('noteList'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 60, sh: e.scrollHeight, ch: e.clientHeight }; });
  assert.ok(listBox.sh > listBox.ch, 'the list overflows its pane');
  await page.mouse.move(listBox.x, listBox.y);
  await page.mouse.wheel(0, 500);
  await waitForDom(() => document.getElementById('noteList').scrollTop > 0);
  // A long note scrolls inside the editor.
  await page.click('.note-card:has-text("Scroll filler 0")');
  await useSourceMode(true);
  await page.fill('#bodyInput', Array.from({ length: 150 }, (_, i) => 'line ' + i).join('\n'));
  await page.evaluate(() => { document.querySelector('.editor-scroll').scrollTop = 0; });
  const edBox = await page.evaluate(() => { const r = document.querySelector('.editor-scroll').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(edBox.x, edBox.y);
  await page.mouse.wheel(0, 500);
  await waitForDom(() => document.querySelector('.editor-scroll').scrollTop > 0);
  await page.evaluate((ids) => Promise.all(ids.map((id) => window.notesApi.notes.destroy(id))), many);

  // Folder scope: following a link opens the target's folder in the list, and only that folder's notes.
  const folder = await page.evaluate(() => window.notesApi.folders.create({ name: 'Scoped folder' }));
  const inside = await page.evaluate((f) => window.notesApi.notes.create({ title: 'Inside the folder', body: 'in', folderId: f }), folder.id);
  const outside = await page.evaluate((id) => window.notesApi.notes.create({ title: 'Outside note', body: 'see [it](note://' + id + ')' }), inside.id);
  await page.click('.nav-item[data-view="all"]');
  await page.click('.note-card:has-text("Outside note")');
  await waitForDom(() => /Inside the folder/.test(document.getElementById('relatedOut').textContent), 8000);
  await page.click('#relatedOut button');
  await waitForDom(() => document.getElementById('titleInput').value === 'Inside the folder');
  await waitForDom(() => document.getElementById('listTitle').textContent.includes('Scoped folder'));
  const titles = await page.evaluate(() => [...document.querySelectorAll('.note-card-title')].map((e) => e.textContent));
  assert.deepEqual(titles, ['Inside the folder'], 'only the folder\'s notes are listed');
  await waitFor('folder remembered for the next start', () => readNotes().settings.lastFolderId === folder.id);
  // A search looks everywhere; picking an unfiled result and clearing the search brings the list to All notes.
  await page.fill('#searchInput', 'Outside note');
  await waitForDom(() => [...document.querySelectorAll('.note-card-title')].some((e) => e.textContent === 'Outside note'));
  await page.click('.note-card:has-text("Outside note")');
  await page.focus('#searchInput');
  await page.keyboard.press('Escape');
  await waitForDom(() => document.getElementById('listTitle').textContent === 'All notes');
  await waitFor('back to no remembered folder', () => readNotes().settings.lastFolderId === null);

  // The list hides from its own button and comes back from the toolbar or Ctrl+Shift+Backslash.
  const listShown = () => page.evaluate(() => getComputedStyle(document.querySelector('.list-pane')).display !== 'none');
  await page.click('#hideListBtn');
  await waitFor('list hidden', async () => !(await listShown()));
  await waitFor('hidden state saved', () => readNotes().settings.listCollapsed === true);
  const edWidth = await page.evaluate(() => document.getElementById('editor').getBoundingClientRect().width);
  assert.ok(edWidth > 600, 'the editor takes the space: ' + edWidth);
  await page.click('#toggleListBtn');
  await waitFor('list shown', listShown);
  await page.keyboard.press('Control+Shift+Backslash');
  await waitFor('list hidden by key', async () => !(await listShown()));
  // Printing lays out the note alone, from the left edge, whatever the hidden panes' columns.
  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate(() => ({ display: getComputedStyle(document.getElementById('app')).display, left: document.getElementById('editorPane').getBoundingClientRect().left }));
  await page.emulateMedia({ media: 'screen' });
  assert.equal(printed.display, 'block');
  assert.ok(printed.left < 2, 'note starts at the left edge: ' + printed.left);
  // Search lives in the list, so Ctrl+F brings the list back.
  await page.keyboard.press('Control+f');
  await waitFor('list shown for search', listShown);
  await waitForDom(() => document.activeElement === document.getElementById('searchInput'));
  await page.keyboard.press('Control+Shift+Backslash');
  await waitFor('list hidden again', async () => !(await listShown()));
  // With no note open the list always shows, so there is a way back to the notes.
  await page.click('.nav-item[data-view="trash"]');
  await waitFor('list shown with no note open', listShown);
  await page.click('.nav-item[data-view="all"]');
  await waitFor('hidden again once a note is open', async () => !(await listShown()));
  await page.keyboard.press('Control+Shift+Backslash');
  await waitFor('list shown by key', listShown);
  await waitFor('shown state saved', () => readNotes().settings.listCollapsed === false);
  await page.evaluate(async ([a, b, f]) => { await window.notesApi.notes.destroy(a); await window.notesApi.notes.destroy(b); await window.notesApi.folders.delete(f); }, [inside.id, outside.id, folder.id]);
  await page.click('.nav-item[data-view="all"]');
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
