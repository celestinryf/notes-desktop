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
    // NOTES_APP_INACTIVE keeps the test window from taking keyboard focus from a person using the machine.
    env: Object.assign({}, process.env, { NOTES_APP_DATA_DIR: dataDir, NOTES_APP_NO_LOGIN_ITEM: '1', NOTES_APP_GIT_DEBOUNCE_MS: '300', NOTES_APP_INACTIVE: '1', NOTES_APP_DRY_DICTATE: '1' }),
  });
  page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') rendererErrors.push(m.text()); });
  page.on('pageerror', (e) => rendererErrors.push('pageerror: ' + e.message));
  await page.waitForSelector('#app');
  await page.evaluate(() => { window.confirm = () => true; });
});

// A failed test must not leave a modal dialog open for the next one.
test.beforeEach(async () => {
  if (!page) return;
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); }).catch(() => {});
});

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
  const fileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-ui-files-'));
  const mdPath = path.join(fileDir, 'External note.md');
  fs.writeFileSync(mdPath, '# From disk\n\nline one\n');
  const pdfPath = path.join(fileDir, 'paper.pdf');
  fs.writeFileSync(pdfPath, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
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

  // PDF opens in a viewer frame, read-only.
  await page.click('.note-card:has-text("paper.pdf")');
  await waitForDom(() => document.getElementById('titleInput').value === 'paper.pdf');
  await waitForDom(() => !document.getElementById('pdfFrame').classList.contains('hidden') && /file:\/\//.test(document.getElementById('pdfFrame').getAttribute('src') || ''));
  assert.equal(await page.$eval('#bodyInput', (t) => t.classList.contains('hidden')), true);
  assert.match(await page.textContent('#fileBanner'), /read-only/);

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

test('speech: read aloud speaks the note and stops; dictation hands off to Windows', async () => {
  await page.click('.note-card:has-text("Gamma (copy)")');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  const voices = await page.evaluate(() => (window.speechSynthesis ? window.speechSynthesis.getVoices().length : -1));
  assert.ok(voices >= 0, 'speechSynthesis exists');
  await page.click('#readAloudBtn');
  await waitForDom(() => document.getElementById('readAloudBtn').classList.contains('is-on'));
  if (voices > 0) {
    await waitForDom(() => window.speechSynthesis.speaking || window.speechSynthesis.pending, 5000);
  }
  await page.click('#readAloudBtn');
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
    return { cls: c.className, width: c.getBoundingClientRect().width, left: c.getBoundingClientRect().left, paneLeft: document.getElementById('editorPane').getBoundingClientRect().left, paneWidth: document.getElementById('editorPane').getBoundingClientRect().width, maxWidth: cs.maxWidth };
  });
  const before = await col();
  assert.match(before.cls, /align-left/);
  assert.equal(before.maxWidth, '760px');

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
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

  await page.uncheck('#editorFullWidthInput');
  await page.click('#alignSeg button[data-align="left"]');
  await waitFor('restored', () => readNotes().settings.editorAlign === 'left' && readNotes().settings.editorWidth > 0);
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
  await page.click('#deleteBtn');
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
