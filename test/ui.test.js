'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { _electron: electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON_PATH = require('electron');
const { tmpDir } = require('./helpers/tmp');
const { readLibrary } = require('../src/store.mts');
const { deriveTitle } = require('../src/shared/helpers.mts');
const dataDir = tmpDir('notes-ui-');
const notesFile = path.join(dataDir, 'notes.json');
const journalFile = path.join(dataDir, 'notes.journal');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readNotes = () => { const d = readLibrary(dataDir); if (!d) throw new Error('notes.json could not be read'); return d; };
const filesUnder = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)])); } catch (_) { return []; } };
const savedText = () => [notesFile, journalFile].concat(filesUnder(path.join(dataDir, 'Notes'))).filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
let readOnlyNoteFiles = [];
const setSavesReadOnly = (on, noteFiles) => {
  if (noteFiles) readOnlyNoteFiles = noteFiles;
  for (const f of [notesFile, journalFile].concat(readOnlyNoteFiles)) { try { fs.chmodSync(f, on ? 0o444 : 0o666); } catch (_) {  } }
};
const homeVaultId = () => (readNotes().vaults.find((v) => v.home) || {}).id;
const isLinkedFile = (n) => !!n.filePath && !n.vaultId;
const homeNoteFile = (title) => findNote(title).filePath;
const findNote = (title) => readNotes().notes.find((n) => n.title === title);
const historyAt = (rev, file) => { try { return require('child_process').execFileSync('git', ['-C', path.join(dataDir, 'history'), 'show', rev + ':' + file], { encoding: 'utf8' }); } catch (_) { return ''; } };

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
let runningTest = '';
const duringTest = (text) => text + (runningTest ? ' [during: ' + runningTest + ']' : '');
const waitForDom = (fn, arg) => waitFor('DOM condition ' + fn.toString().slice(0, 80), () => page.evaluate(fn, arg));
const sourceBox = async () => (await page.$eval('#bodyInput', (t) => t.classList.contains('uses-code'))) ? '#codeHost .cm-content' : '#bodyInput';
const fillBody = async (text, opts) => page.fill(await sourceBox(), text, opts);
const focusBody = async () => page.focus(await sourceBox());
const clickBody = async (opts) => page.click(await sourceBox(), opts);
const waitForDomWithin = (timeout, fn) => waitFor('DOM condition ' + fn.toString().slice(0, 80), () => page.evaluate(fn), timeout);
const revealRow = (match) => page.evaluate(async (m) => {
  const matches = (r) => (m.id ? r.dataset.id === m.id : r.textContent.toLowerCase().includes(m.text.toLowerCase()));
  const list = document.getElementById('noteList');
  if (!list || list.classList.contains('hidden')) return [...document.querySelectorAll('.note-row')].some((r) => r.offsetParent && matches(r));
  const hit = () => [...list.querySelectorAll('.note-row')].some(matches);
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  list.scrollTop = 0;
  await frame();
  while (!hit() && list.scrollTop + list.clientHeight < list.scrollHeight - 1) { list.scrollTop += Math.max(28, list.clientHeight - 56); await frame(); }
  return hit();
}, match);
const clickRow = async (text) => { await revealRow({ text }); await page.click('.note-row:has-text(' + JSON.stringify(text) + ')'); };
const clickRowById = async (id) => { await revealRow({ id }); await page.click('.note-row[data-id="' + id + '"]'); };

test.before(async () => {
  fs.writeFileSync(notesFile, JSON.stringify({ settings: { hotkey: 'Control+Alt+Shift+F8', openAtLogin: false, theme: 'light', editorWidth: 0, columnLayout: 3, listMode: 'list', listLayout: 1 }, notes: [] }));
  app = await electron.launch({
    executablePath: ELECTRON_PATH,
    args: [ROOT, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env: Object.assign({}, process.env, {
      NOTES_APP_DATA_DIR: dataDir, NOTES_APP_NO_LOGIN_ITEM: '1', NOTES_APP_GIT_DEBOUNCE_MS: '300', NOTES_APP_INACTIVE: '1', NOTES_APP_DRY_DICTATE: '1', NOTES_APP_DRY_PRINT: '1', NOTES_APP_DRY_NOTIFY: '1', NOTES_APP_DRY_SPEECH: '1', NOTES_APP_REMINDER_TICK_MS: '300',
      NOTES_APP_CLAUDE_BIN: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'),
      ANTHROPIC_API_KEY: 'sk-ant-test-must-not-reach-the-agent',
      NOTES_APP_DRY_TERMINAL: '1',
      NOTES_APP_DRY_GITHUB: 'code',
      NOTES_APP_NO_CRAFTS: '1',
      NOTES_APP_NO_RECYCLE_BIN: '1',
      NOTES_APP_TEX_DIR: path.join(ROOT, 'test', 'fixtures', 'fake-tex'),
    }),
  });
  page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') rendererErrors.push(duringTest(m.text())); });
  page.on('pageerror', (e) => rendererErrors.push(duringTest('pageerror: ' + e.message)));
  await page.waitForSelector('#app');
  await page.evaluate(() => { window.confirm = () => true; });
  await app.evaluate(({ shell }) => {
    global.__shell = { opened: [], shown: [], external: [] };
    shell.openPath = async (p) => { global.__shell.opened.push(p); return ''; };
    shell.showItemInFolder = (p) => { global.__shell.shown.push(p); };
    shell.openExternal = async (url) => { global.__shell.external.push(url); };
  });
  await sleep(500);
  if (rendererErrors.length) throw new Error("the renderer failed at startup: " + rendererErrors.join("; "));
});
const shellCalls = () => app.evaluate(() => global.__shell);

test.beforeEach(async (t) => {
  runningTest = t.name;
  if (!page) return;
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); }).catch(() => {});
});

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
  if (app) {
    await app.evaluate(({ app: a }) => setTimeout(() => a.exit(0), 50)).catch(() => {});
    await Promise.race([app.waitForEvent('close'), sleep(5000)]).catch(() => {});
    await app.close().catch(() => {});
  }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {  }
});

const guestFrame = () => page.frames().find((f) => /pane=right/.test(f.url()));
async function closeSplitIfOpen() {
  if (!(await page.$('#panePeer'))) return;
  await guestFrame().click('#paneCloseBtn');
  await waitForDom(() => !document.getElementById('panePeer'));
}
async function removeFromNotes(files) {
  for (const file of files) {
    const id = (readNotes().notes.find((n) => n.filePath === file) || {}).id;
    if (!id) continue;
    await revealRow({ id });
    await clickRowById(id);
    await page.keyboard.press('Control+Shift+Delete');
    await waitFor('in the trash: ' + path.basename(file), () => { const n = readNotes().notes.find((x) => x.filePath === file); return !n || n.trashedAt; });
  }
  await page.click('.nav-item[data-view="trash"]');
  await page.waitForSelector('#emptyTrashBtn:not(.hidden)', { timeout: 8000 });
  await page.click('#emptyTrashBtn');
  await waitFor('gone from Notes', () => !readNotes().notes.some((x) => files.includes(x.filePath)));
  await page.click('.nav-item[data-view="all"]');
}

async function typeNote(title, body) {
  await page.click('#newNoteBtn');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', title);
  await fillBody(body);
  await waitFor('note "' + title + '" saved', () => { const n = findNote(title); return n && n.body === body; });
  return findNote(title);
}

test('showing the window does not create stray notes once notes exist', async () => {
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
  await page.click('#richEditor li[data-type="taskItem"] input[type="checkbox"]', T);
  await waitFor('checkbox toggled in markdown', () => findNote('Rendered').body.includes('- [x] a task'));
  step('checkbox toggled');

  await page.click('#richEditor h2', T);
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#linkDialog[open]', T);
  step('link dialog open');
  await sleep(300);
  assert.equal(await page.evaluate(() => !document.querySelector('#linkResults .is-active') && document.getElementById('linkApplyBtn').disabled && !document.getElementById('linkEmpty').textContent), true, 'an empty field chooses nothing and says nothing');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.getElementById('linkDialog').open), true, 'Enter on an empty field links nothing');
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

  await page.keyboard.press('Control+e');
  await waitForDom(() => !document.getElementById('bodyInput').classList.contains('hidden'));
  assert.equal(readNotes().settings.editorMode, 'source', 'mode persists');
  assert.match(await page.inputValue('#bodyInput'), /^## \[Big heading\]/);
  assert.match(await page.textContent('#codeHost .cm-content'), /\[Big heading\]\(https:\/\/example\.com\)/, 'the code editor shows the rich-mode edit');
  step('source view');
  await fillBody('# From source\n\n- [ ] one', T);
  await page.keyboard.press('Control+e');
  await page.waitForSelector('#richEditor h1:has-text("From source")', T);
  assert.equal(await page.$$eval('#richEditor li[data-type="taskItem"]', (l) => l.length), 1);
  await waitFor('source edit saved', () => findNote('Rendered').body.startsWith('# From source'));
  step('round trip');

  await useSourceMode(true);
  await page.keyboard.press('Control+Shift+Delete');
  await waitFor('rendered note trashed', () => findNote('Rendered').trashedAt);
  await page.click('.nav-item[data-view="trash"]', T);
  await page.click('.note-row:has-text("Rendered")', T);
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
  await fillBody('first body');
  await waitFor('Alpha saved', () => { const n = findNote('Alpha'); return n && n.body === 'first body'; });
  assert.equal(await page.textContent('#statusSaved'), 'Saved');
  assert.match(await page.textContent('#statusWords'), /2 words/);
});

test('search filters and highlights; clearing restores', async () => {
  await typeNote('Beta', 'kiwi and mango');
  await typeNote('Gamma', 'pure text');
  await page.fill('#searchInput', 'MANGO');
  await waitForDom(() => document.querySelectorAll('.note-row').length === 1);
  assert.equal(await page.textContent('.note-row .row-name'), 'Beta');
  assert.ok(await page.$('.note-row .mark'), 'match highlighted');
  assert.equal(await page.textContent('#listTitle'), 'Results');
  await page.fill('#searchInput', 'nothing-matches-this');
  await waitForDom(() => !document.getElementById('listEmpty').classList.contains('hidden'));
  await page.fill('#searchInput', '');
  await waitForDom(() => document.querySelectorAll('.note-row').length === 3);
});

test('sort options reorder the list', async () => {
  await page.selectOption('#sortSelect', 'title');
  await waitForDom(() => document.querySelector('.note-row .row-name').textContent === 'Alpha');
  const titles = await page.$$eval('.note-row .row-name', (els) => els.map((e) => e.textContent));
  assert.deepEqual(titles, ['Alpha', 'Beta', 'Gamma']);
  assert.equal(readNotes().settings.sort, 'title');
  await page.selectOption('#sortSelect', 'updated');
  await waitForDom(() => document.querySelector('.note-row .row-name').textContent === 'Gamma');
});

test('pin button, pinned view, and pinned-first ordering', async () => {
  await clickRow("Alpha");
  await waitForDom(() => document.getElementById('titleInput').value === 'Alpha');
  await page.click('#pinBtn');
  await waitFor('Alpha pinned', () => findNote('Alpha').pinned);
  assert.equal(await page.getAttribute('#pinBtn', 'aria-pressed'), 'true');
  await waitForDom(() => document.querySelector('.note-row .row-name').textContent.includes('Alpha'));
  await page.click('.nav-item[data-view="pinned"]');
  await waitForDom(() => document.querySelectorAll('.note-row').length === 1);
  assert.equal(await page.textContent('#countPinned'), '1');
  await page.click('.nav-item[data-view="all"]');
  await waitForDom(() => document.querySelectorAll('.note-row').length === 3);
});

test('tags filter in the sidebar', async () => {
  await clickRow("Beta");
  await waitForDom(() => document.getElementById('titleInput').value === 'Beta');
  await page.fill('#tagsInput', 'Fruit, snacks');
  await page.press('#tagsInput', 'Enter');
  await waitFor('tags saved', () => findNote('Beta').tags.join(',') === 'fruit,snacks');
  await page.waitForSelector('#tagList .nav-item:has-text("fruit")');
  await page.click('#tagList .nav-item:has-text("fruit")');
  await waitForDom(() => document.querySelectorAll('.note-row').length === 1);
  assert.equal(await page.textContent('#listTitle'), '#fruit');
  await page.click('.nav-item[data-view="all"]');
  await waitForDom(() => document.querySelectorAll('.note-row').length === 3);
});

test('duplicate creates a copy and selects it', async () => {
  await clickRow("Gamma");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma');
  await clickTool('#duplicateBtn');
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  const copy = findNote('Gamma (copy)');
  assert.equal(copy.body, 'pure text');
  assert.equal(await page.textContent('#countAll'), '4');
});

test('Ctrl+B / Ctrl+I / Ctrl+K wrap the selection and toggle off again', async () => {
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await focusBody();
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
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
  await fillBody('- item one');
  await focusBody();
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
  assert.equal(await page.inputValue('#bodyInput'), '- item one\n- item two\n', 'empty bullet ends the list; the Markdown keymap trims the trailing spaces');
});

test('the Markdown source view is the code editor: line numbers, Ln/Col, highlighted marks, spellcheck on, word counts kept', async () => {
  await useSourceMode(true);
  await fillBody('# Head\n\nplain **bold** [site](https://example.com)\n');
  await waitFor('source saved', () => findNote('Gamma (copy)').body.startsWith('# Head'));
  assert.equal(await page.$eval('#bodyInput', (t) => t.classList.contains('uses-code')), true, 'the textarea hands over to the code editor');
  assert.equal(await page.isVisible('#codeHost .cm-editor'), true);
  assert.equal(await page.$$eval('#codeHost .cm-lineNumbers .cm-gutterElement', (g) => g.some((e) => e.textContent === '3')), true, 'line numbers show');
  assert.equal(await page.$eval('#codeHost .cm-content', (c) => c.getAttribute('spellcheck')), 'true', 'Markdown keeps spellcheck');
  assert.equal(await page.$$eval('#codeHost .cm-line', (ls) => ls.filter((l) => l.querySelector('span')).length >= 2), true, 'headings and marks are highlighted spans');
  await clickBody();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await waitForDom(() => document.getElementById('statusCode').textContent === 'Ln 3, Col 43');
  assert.match(await page.textContent('#statusWords'), /^5 words$/, 'a Markdown note still counts words');
  await page.keyboard.press('Control+e');
  await waitForDom(() => document.getElementById('bodyInput').classList.contains('hidden'));
  assert.equal(await page.isVisible('#codeHost .cm-editor'), false, 'the code editor hides with the source view');
  assert.equal(await page.$eval('#statusCode', (s) => s.classList.contains('hidden')), true);
  await page.keyboard.press('Control+e');
  await waitForDom(() => !document.getElementById('bodyInput').classList.contains('hidden'));
});

test('switching source to rendered shows the same Markdown and checkbox clicks write back', async () => {
  await fillBody('# Head\n\n- [ ] alpha\n- [x] beta\n\n[site](https://example.com)');
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
  await waitForDom(() => !document.getElementById('bodyInput').classList.contains('hidden'));
});

test('tables and images render; Markdown the rendered view would alter opens as source and is not rewritten', async () => {
  await useSourceMode(true);
  await page.click('#newNoteBtn');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', 'Rich constructs');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const table = '| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n\n![Diagram](' + png + ')\n\nDone.';
  await fillBody(table);
  await waitFor('table note saved', () => findNote('Rich constructs') && findNote('Rich constructs').body === table);
  await page.keyboard.press('Control+e');
  await page.waitForSelector('#richEditor:not(.hidden) table', { timeout: 8000 });
  assert.equal(await page.$$eval('#richEditor td', (c) => c.length), 2);
  assert.equal(await page.$eval('#richEditor img[src]', (i) => i.getAttribute('src')), png);
  assert.equal(readNotes().settings.editorMode, 'rendered');
  await page.click('#richEditor td >> nth=0');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('more');
  await waitFor('cell edit saved', () => findNote('Rich constructs').body.includes('more'));
  const afterEnter = findNote('Rich constructs').body;
  assert.ok(!afterEnter.includes('[table]'), 'no placeholder: ' + afterEnter);
  assert.ok(/Apple/.test(afterEnter) && /Qty/.test(afterEnter), 'table content kept: ' + afterEnter);
  await page.keyboard.press('Control+Backspace');
  await sleep(500);
  assert.equal(findNote('Rich constructs').trashedAt, null, 'Ctrl+Backspace did not trash');

  await page.click('#newNoteBtn');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', 'Soft breaks');
  await useSourceMode(true);
  const soft = 'line one\nline two\n\nx -> y and a > b\n\n* star bullet\n* another';
  await fillBody(soft);
  await waitFor('soft note saved', () => findNote('Soft breaks') && findNote('Soft breaks').body === soft);
  await page.keyboard.press('Control+e');
  await page.waitForSelector('#richEditor:not(.hidden) p', { timeout: 8000 });
  const stampSoft = findNote('Soft breaks').updatedAt;
  const stampTable = findNote('Rich constructs').updatedAt;
  await clickRow("Rich constructs");
  await waitForDom(() => document.getElementById('titleInput').value === 'Rich constructs');
  await page.waitForSelector('#richEditor:not(.hidden) table', { timeout: 8000 });
  await sleep(900);
  await clickRow("Soft breaks");
  await waitForDom(() => document.getElementById('titleInput').value === 'Soft breaks');
  await sleep(900);
  assert.equal(findNote('Soft breaks').body, soft, 'viewing did not rewrite soft breaks');
  assert.equal(findNote('Soft breaks').updatedAt, stampSoft, 'updatedAt untouched by viewing');
  assert.equal(findNote('Rich constructs').updatedAt, stampTable, 'table note untouched by viewing');
  await page.click('#richEditor p >> nth=0');
  await page.keyboard.press('End');
  await page.keyboard.type(' plus');
  await waitFor('rendered edit saved', () => findNote('Soft breaks').body.includes('plus'));
  const edited = findNote('Soft breaks').body;
  assert.ok(edited.includes('x -> y and a > b'), 'angle brackets kept literal: ' + JSON.stringify(edited));
  assert.ok(!edited.includes('&gt;'), 'no entity escaping: ' + JSON.stringify(edited));
  await page.keyboard.press('Control+Shift+Delete');
  await waitFor('soft note trashed', () => findNote('Soft breaks').trashedAt);

  await page.click('#newNoteBtn');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', 'Lossy');
  await useSourceMode(true);
  const lossy = 'Keyboard: <kbd>Ctrl</kbd>+<kbd>K</kbd>\n\nA claim.[^1]\n\n[^1]: The footnote text.';
  await fillBody(lossy);
  await waitFor('lossy note saved', () => findNote('Lossy') && findNote('Lossy').body === lossy);
  await clickRow("Rich constructs");
  await waitForDom(() => document.getElementById('titleInput').value === 'Rich constructs');
  await page.keyboard.press('Control+e');
  await page.waitForSelector('#richEditor:not(.hidden) table', { timeout: 8000 });
  await clickRow("Lossy");
  await waitForDom(() => document.getElementById('titleInput').value === 'Lossy');
  await waitForDom(() => !document.getElementById('bodyInput').classList.contains('hidden'));
  await page.waitForSelector('#toast:not(.hidden)', { timeout: 8000 });
  assert.match(await page.textContent('#toast'), /Opened as Markdown source/);
  await sleep(800);
  assert.equal(findNote('Lossy').body, lossy, 'viewing did not rewrite the note');
  assert.equal(readNotes().settings.editorMode, 'rendered', 'the global preference is untouched');
  await clickRow("Rich constructs");
  await page.waitForSelector('#richEditor:not(.hidden) table', { timeout: 8000 });

  for (const title of ['Lossy', 'Rich constructs']) {
    await clickRow(title);
    await waitForDom((t) => document.getElementById('titleInput').value === t, title);
    await page.keyboard.press('Control+Shift+Delete');
    await waitFor(title + ' trashed', () => findNote(title).trashedAt);
  }
  await page.click('.nav-item[data-view="trash"]');
  await page.waitForSelector('#emptyTrashBtn:not(.hidden)', { timeout: 8000 });
  await page.click('#emptyTrashBtn');
  await waitFor('trash emptied', () => !findNote('Lossy') && !findNote('Rich constructs') && !findNote('Soft breaks'));
  await page.click('.nav-item[data-view="all"]');
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
});

test.afterEach(() => {
  setSavesReadOnly(false);
});

test('a picture whose path has spaces shows in the rendered view, and an edit keeps the link as written', async () => {
  await page.click('#newNoteBtn');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', 'Spaced pictures');
  await useSourceMode(true);
  const body = 'Shots:\n\n![Feed cards](my shots/one.png)\n\n![Cards [2]](my shots/two (b).png)\n\nDone.';
  await fillBody(body);
  await waitFor('spaced picture note saved', () => findNote('Spaced pictures') && findNote('Spaced pictures').body === body);
  const dir = path.dirname(homeNoteFile('Spaced pictures'));
  fs.mkdirSync(path.join(dir, 'my shots'), { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(path.join(dir, 'my shots', 'one.png'), png);
  fs.writeFileSync(path.join(dir, 'my shots', 'two (b).png'), png);
  try {
    await page.keyboard.press('Control+e');
    await page.waitForSelector('#richEditor:not(.hidden) img[data-src]', { timeout: 8000 });
    const imgs = await page.$$eval('#richEditor img[data-src]', (all) => all.map((i) => ({ written: i.getAttribute('data-src'), src: i.getAttribute('src'), alt: i.getAttribute('alt') })));
    assert.deepEqual(imgs.map((i) => [i.written, i.alt]), [['my shots/one.png', 'Feed cards'], ['my shots/two (b).png', 'Cards [2]']]);
    assert.match(imgs[0].src, /^file:\/\/\/.*\/my%20shots\/one\.png$/);
    assert.match(imgs[1].src, /^file:\/\/\/.*\/my%20shots\/two%20\(b\)\.png$/);
    await waitForDom(() => { const all = [...document.querySelectorAll('#richEditor img[data-src]')]; return all.length === 2 && all.every((i) => i.complete && i.naturalWidth === 1); });
    assert.equal(await page.$eval('#bodyInput', (t) => t.classList.contains('hidden')), true, 'the note is not sent to the source view');
    assert.equal(await page.evaluate(() => document.getElementById('richEditor').textContent.includes('](')), false, 'no link text left on the page');

    await page.click('#richEditor p >> nth=-1');
    await page.keyboard.press('End');
    await page.keyboard.type(' More');
    await waitFor('rendered edit saved', () => findNote('Spaced pictures').body.includes('Done. More'));
    const edited = findNote('Spaced pictures').body;
    assert.ok(edited.includes('![Feed cards](my shots/one.png)'), 'the link is saved as written: ' + JSON.stringify(edited));
    assert.ok(edited.includes('![Cards \\[2\\]](my shots/two \\(b\\).png)'), 'brackets and parentheses are escaped as CommonMark reads them: ' + JSON.stringify(edited));
    assert.equal((edited.match(/\\/g) || []).length, 4, 'nothing else escaped: ' + JSON.stringify(edited));
  } finally {
    await page.keyboard.press('Control+Shift+Delete');
    await waitFor('spaced picture note trashed', () => findNote('Spaced pictures').trashedAt);
    fs.rmSync(path.join(dir, 'my shots'), { recursive: true, force: true });
  }
});

test('an edit that cannot be saved survives switching notes and lands once the disk allows it', { timeout: 60000 }, async () => {
  await useSourceMode(true);
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await fillBody('before lock');
  await waitFor('baseline saved', () => findNote('Gamma (copy)').body === 'before lock');
  const alphaBefore = findNote('Alpha').body;
  const gammaFile = homeNoteFile('Gamma (copy)');
  setSavesReadOnly(true, [gammaFile, homeNoteFile('Alpha')]);
  try {
    await fillBody('typed while locked');
    await waitForDomWithin(8000, () => document.getElementById('statusSaved').textContent === 'Save failed');
    await clickRow("Alpha");
    await waitForDom(() => document.getElementById('titleInput').value === 'Alpha');
    assert.equal(findNote('Gamma (copy)').body, 'before lock', 'nothing reached disk while locked');
    assert.equal(fs.readFileSync(gammaFile, 'utf8'), 'before lock', 'the note file is unchanged too');
    await fillBody('alpha edited while locked');
    await waitForDomWithin(8000, () => document.getElementById('statusSaved').textContent === 'Save failed');
    await clickRow("Gamma (copy)");
    await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
    assert.equal(await page.inputValue('#bodyInput'), 'typed while locked', 'pending edit shown on reselect');
    assert.equal(await page.textContent('#statusSaved'), 'Save failed');
    await sleep(3500);
    assert.equal(findNote('Gamma (copy)').body, 'before lock');
    assert.equal(findNote('Alpha').body, alphaBefore);
    assert.equal(await page.inputValue('#bodyInput'), 'typed while locked');
  } finally {
    setSavesReadOnly(false);
    readOnlyNoteFiles = [];
  }
  await waitFor('both pending edits landed after unlock', () => findNote('Gamma (copy)').body === 'typed while locked' && findNote('Alpha').body === 'alpha edited while locked', 15000);
  await waitForDom(() => document.getElementById('statusSaved').textContent === 'Saved');
  await fillBody('pure text');
  await waitFor('restored body', () => findNote('Gamma (copy)').body === 'pure text');
  await clickRow("Alpha");
  await waitForDom(() => document.getElementById('titleInput').value === 'Alpha');
  await fillBody(alphaBefore);
  await waitFor('alpha restored', () => findNote('Alpha').body === alphaBefore);
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
});

test('entity-looking text and numbered lists round-trip in the rendered view', async () => {
  await page.click('#newNoteBtn');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', 'Entities');
  await useSourceMode(true);
  const md = 'Fish & chips, 1 < 2 && 3 > 2, <3\n\n1. one\n1. two\n1. three';
  await fillBody(md);
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
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await clickRow("Entities");
  await page.waitForSelector('#richEditor:not(.hidden) ol', { timeout: 8000 });
  assert.ok((await page.$eval('#richEditor p', (p) => p.textContent)).endsWith('typed &amp; literally'));
  await page.keyboard.press('Control+Shift+Delete');
  await waitFor('entities note trashed', () => findNote('Entities').trashedAt);
  await page.click('.nav-item[data-view="trash"]');
  await page.waitForSelector('#emptyTrashBtn:not(.hidden)', { timeout: 8000 });
  await page.click('#emptyTrashBtn');
  await waitFor('entities note destroyed', () => !findNote('Entities'));
  await page.click('.nav-item[data-view="all"]');
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
});

test('formulas: $ and $$ render with KaTeX, a click or Enter edits them in a popover, Ctrl+Shift+E and /formula insert them, and the Markdown keeps its shape', { timeout: 60000 }, async () => {
  const md = '# Formulas\n\nEnergy is $E = mc^2$ and costs $5 and $10 stay text.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nBroken $\\frac{1}{$ here.';
  await page.click('#newNoteBtn');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', 'Formulas');
  await useSourceMode(true);
  await fillBody(md);
  await waitFor('formulas note saved', () => findNote('Formulas') && findNote('Formulas').body === md);
  await useSourceMode(false);
  await page.waitForSelector('#richEditor .math-block .katex-display', { timeout: 8000 });
  assert.equal(await page.$$eval('#richEditor .math-inline', (k) => k.length), 2, 'two inline formulas');
  assert.equal(await page.$$eval('#richEditor .math-inline .katex', (k) => k.length), 1, 'one drawn by KaTeX');
  assert.equal(await page.$$eval('#richEditor .math-inline .katex-error', (k) => k.length), 1, 'the broken one shows as an error');
  assert.match(await page.$eval('#richEditor p:nth-of-type(1)', (p) => p.textContent), /costs \$5 and \$10 stay text/, 'prices stay text');
  assert.equal(await page.$eval('#richEditor .math-inline .katex-error', (k) => getComputedStyle(k).color), await page.evaluate(() => { const s = document.createElement('span'); s.style.color = 'var(--danger)'; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c; }), 'the error colour is --danger');

  await page.keyboard.press('Control+Shift+s');
  await page.waitForSelector('#shareMenu:not(.hidden)');
  await page.click('#shareMenu [data-action="copy-html"]');
  const copied = await waitFor('formulas copied as rich text', () => { const html = require('child_process').spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -TextFormatType Html'], { encoding: 'utf8' }).stdout || ''; return html.includes('mc^2') ? html : null; }, 10000);
  assert.ok(copied.includes('$E = mc^2$') && copied.includes('$$\\int_0^1 x\\,dx$$'), 'formulas paste as their TeX: ' + copied.slice(0, 300));
  assert.doesNotMatch(copied, /katex/, 'no KaTeX markup on the clipboard');

  await page.click('#richEditor .math-inline >> nth=0');
  await page.waitForSelector('#mathEditor:not(.hidden)');
  assert.equal(await page.inputValue('#mathSource'), 'E = mc^2');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'mathSource');
  await page.fill('#mathSource', 'E = mc^3');
  await waitForDom(() => document.querySelector('#richEditor .math-inline').getAttribute('data-latex') === 'E = mc^3');
  await page.fill('#mathSource', '\\frac{1}{');
  await page.waitForSelector('#mathError:not(.hidden)');
  assert.equal(await page.getAttribute('#mathSource', 'aria-invalid'), 'true');
  await page.fill('#mathSource', 'E = mc^3');
  await page.waitForSelector('#mathError.hidden', { state: 'attached' });
  await page.keyboard.press('Enter');
  await page.waitForSelector('#mathEditor.hidden', { state: 'attached' });
  await waitFor('the edited formula saved', () => findNote('Formulas').body.includes('Energy is $E = mc^3$ and costs'));
  assert.equal(findNote('Formulas').body, md.replace('mc^2', 'mc^3'), 'nothing else changed');
  await page.keyboard.press('Control+z');
  await waitFor('one undo puts the formula back', () => findNote('Formulas').body === md);

  await page.click('#richEditor h1');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Area ');
  await page.keyboard.press('Control+Shift+E');
  await page.waitForSelector('#mathEditor:not(.hidden)');
  assert.equal(await page.inputValue('#mathSource'), '');
  await page.keyboard.type('\\pi r^2');
  await page.keyboard.press('Enter');
  await waitFor('the inserted formula saved', () => findNote('Formulas').body.startsWith('# Formulas\n\nArea $\\pi r^2$\n\nEnergy'));

  await page.keyboard.press('Enter');
  await page.keyboard.type('/formula');
  await page.waitForSelector('#inlineMenu:not(.hidden)');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#mathEditor:not(.hidden)');
  await page.keyboard.type('\\sum_i i');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('= n');
  await page.keyboard.press('Enter');
  await waitFor('the formula block saved', () => findNote('Formulas').body.includes('Area $\\pi r^2$\n\n$$\n\\sum_i i\n= n\n$$\n\nEnergy'));
  await waitForDom(() => document.getElementById('statusCode').textContent === 'Enter edits the formula');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#mathEditor:not(.hidden)');
  assert.equal(await page.inputValue('#mathSource'), '\\sum_i i\n= n', 'Enter on a selected formula opens it without the outer newlines');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#mathEditor.hidden', { state: 'attached' });
  assert.equal(await page.evaluate(() => document.getElementById('app').classList.contains('hidden') || !document.hasFocus()), false, 'Esc closed the popover, not the window');

  await page.click('#richEditor .math-inline >> nth=0');
  await page.waitForSelector('#mathEditor:not(.hidden)');
  await page.fill('#mathSource', '');
  await page.keyboard.press('Backspace');
  await page.waitForSelector('#mathEditor.hidden', { state: 'attached' });
  await waitFor('Backspace in an empty formula removes it', () => findNote('Formulas').body.startsWith('# Formulas\n\nArea \n\n$$'));

  await page.keyboard.press('Control+f');
  await page.waitForSelector('#findBar:not(.hidden)');
  await page.fill('#findInput', 'mc');
  await waitForDomWithin(8000, () => document.getElementById('findCount').textContent === 'No matches');
  await page.keyboard.press('Escape');

  const saved = findNote('Formulas').body;
  await useSourceMode(true);
  await waitFor('the source view shows the saved Markdown', async () => (await page.inputValue('#bodyInput')) === saved);
  await page.keyboard.press('Control+Shift+Delete');
  await waitFor('formulas note trashed', () => findNote('Formulas').trashedAt);
  await page.click('.nav-item[data-view="trash"]');
  await page.waitForSelector('#emptyTrashBtn:not(.hidden)', { timeout: 8000 });
  await page.click('#emptyTrashBtn');
  await waitFor('formulas note destroyed', () => !findNote('Formulas'));
  await page.click('.nav-item[data-view="all"]');
});

test('compile: a LaTeX file compiles with the TeX Notes finds, lists errors with their lines, goes to a line on click, and keeps its options', { timeout: 60000 }, async () => {
  const dir = tmpDir('notes-ui-tex-');
  const texPath = path.join(dir, 'paper.tex');
  const built = (ext) => path.join(dir, 'paper.' + ext);
  const statusText = () => page.evaluate(() => document.getElementById('compileStatus').textContent.trim());
  fs.writeFileSync(texPath, '\\documentclass{article}\n\\begin{document}\nHello from the test\n\\end{document}\n');
  await page.evaluate((p) => window.notesApi.files.link([p]), texPath);
  await waitFor('tex file linked', () => readNotes().notes.some((n) => n.filePath === texPath));
  await page.click('.nav-item[data-view="all"]');
  await waitFor('paper.tex listed', () => revealRow({ text: 'paper.tex' }), 8000);
  await clickRow('paper.tex');
  await waitForDom(() => document.getElementById('titleInput').value === 'paper.tex');
  await page.waitForSelector('#compileControls:not(.hidden)');
  assert.equal(await statusText(), 'Not compiled yet');
  assert.equal(await page.$eval('#moreCompileBtn', (b) => b.classList.contains('hidden')), false, 'Compile is in the More menu too');

  await page.click('#compileBtn');
  await waitFor('compiled', async () => (await statusText()) === 'Compiled', 15000);
  assert.ok(fs.existsSync(built('pdf')), 'the PDF sits beside the file');

  await page.click('#codeHost .cm-line >> nth=2');
  await page.keyboard.press('End');
  await page.keyboard.type(' \\FAKEERROR');
  await waitFor('the result marked as stale', async () => (await statusText()) === 'Edited since compiling');
  await page.click('#codeHost .cm-line >> nth=0');
  await page.keyboard.press('Control+Enter');
  await waitFor('the error counted', async () => (await statusText()) === '1 error', 15000);
  assert.match(fs.readFileSync(texPath, 'utf8'), /\\FAKEERROR/, 'the edit was saved before compiling');
  await page.click('#compileStatus');
  await page.waitForSelector('#compileResults:not(.hidden)');
  assert.match(await page.textContent('#compileSummary'), /^1 error$/);
  assert.equal(await page.textContent('#compileIssueList .compile-issue .compile-issue-where'), 'paper.tex:3');
  assert.equal(await page.isVisible('#compileOpenPdfBtn'), true);
  await page.click('#compileIssueList .compile-issue');
  await waitForDom(() => /^Ln 3,/.test(document.getElementById('statusCode').textContent));
  assert.equal(await page.$eval('#compileResults', (p) => p.classList.contains('hidden')), true, 'the list closes on a click');
  await page.click('#codeHost .cm-line >> nth=0');
  await waitForDom(() => /^Ln 1,/.test(document.getElementById('statusCode').textContent));
  await page.keyboard.press('F8');
  await waitForDom(() => /^Ln 3,/.test(document.getElementById('statusCode').textContent));

  await page.click('#compileMenuBtn');
  await page.waitForSelector('#compileMenu:not(.hidden)');
  assert.equal(await page.getAttribute('#compileEngines [aria-checked="true"]', 'role'), 'menuitemradio');
  await page.click('#compileEngines [role="menuitemradio"]:has-text("XeLaTeX")');
  const options = () => (readNotes().notes.find((n) => n.filePath === texPath) || {}).texOptions || {};
  await waitFor('the engine kept for this file', () => options().engine === 'xelatex');
  await page.click('#compileMenuBtn');
  await page.click('#compileHaltBtn');
  await waitFor('stop on the first error kept', () => options().haltOnError === true);
  await page.click('#compileMenuBtn');
  await page.keyboard.press('Escape');
  await waitForDom(() => document.getElementById('compileMenu').classList.contains('hidden'));

  await page.click('#compileMenuBtn');
  await page.click('#compileCleanBtn');
  await waitFor('build files cleared', () => !fs.existsSync(built('log')) && !fs.existsSync(built('aux')));
  assert.ok(fs.existsSync(built('pdf')) && fs.existsSync(texPath), 'the PDF and the source stay');
  assert.equal(await statusText(), 'Not compiled yet');

  await closeSplitIfOpen();
  await removeFromNotes([texPath, built('pdf')]);
  assert.ok(fs.existsSync(texPath), 'removing a linked file from Notes never deletes it');
});

test('preview: a compile opens the PDF beside the file, Ctrl+Alt+J shows the line in it, a double-click goes back, and Compile on save compiles after a pause', { timeout: 90000 }, async () => {
  const dir = tmpDir('notes-ui-preview-');
  const texPath = path.join(dir, 'essay.tex');
  const pdfPath = path.join(dir, 'essay.pdf');
  const statusText = () => page.evaluate(() => document.getElementById('compileStatus').textContent.trim());
  const guest = guestFrame;
  fs.writeFileSync(texPath, '\\documentclass{article}\n\\begin{document}\nFirst line of the essay\n\nSecond paragraph here\n\\end{document}\n');
  await page.evaluate((p) => window.notesApi.files.link([p]), texPath);
  await waitFor('essay linked', () => readNotes().notes.some((n) => n.filePath === texPath));
  await page.click('.nav-item[data-view="all"]');
  await waitFor('essay listed', () => revealRow({ text: 'essay.tex' }), 8000);
  await clickRow('essay.tex');
  await waitForDom(() => document.getElementById('titleInput').value === 'essay.tex');
  await page.click('#compileBtn');
  await waitFor('compiled', async () => (await statusText()) === 'Compiled', 15000);

  await waitFor('the split opened with the PDF on the right', async () => {
    const g = guest();
    return !!g && await g.evaluate(() => document.getElementById('titleInput').value === 'essay.pdf' && !!document.querySelector('#pdfEditor .pdfViewer .page canvas')).catch(() => false);
  }, 20000);
  assert.equal(await page.evaluate(() => document.getElementById('titleInput').value), 'essay.tex', 'the source stays on the left');

  await page.click('#codeHost .cm-line >> nth=4');
  await page.keyboard.press('Control+Alt+j');
  await waitFor('the line flashed in the PDF', () => guest().evaluate(() => !!document.querySelector('#pdfEditor .sync-flash')), 8000);
  await page.waitForSelector('#syncArrows:not(.hidden)');
  await waitFor('the flash gone', () => guest().evaluate(() => !document.querySelector('#pdfEditor .sync-flash')), 8000);
  await page.click('#syncForwardBtn');
  await waitFor('the arrow shows the line in the PDF too', () => guest().evaluate(() => !!document.querySelector('#pdfEditor .sync-flash')), 8000);

  await page.click('#codeHost .cm-line >> nth=0');
  const pageBox = await guest().evaluate(() => {
    const pageEl = document.querySelector('#pdfEditor .page[data-page-number="1"]');
    pageEl.scrollIntoView({ block: 'start' });
    const r = pageEl.getBoundingClientRect();
    return { scale: (r.width - pageEl.clientLeft * 2) / 595, inset: pageEl.clientTop };
  });
  await guest().locator('#pdfEditor .page[data-page-number="1"]').dblclick({ position: { x: pageBox.inset + 200 * pageBox.scale, y: pageBox.inset + (72 + 18 * 3 - 4) * pageBox.scale } });
  await waitForDom(() => /^Ln 3,/.test(document.getElementById('statusCode').textContent));

  await page.click('#compileMenuBtn');
  await page.click('#compileAutoBtn');
  await waitFor('compile on save kept', () => ((readNotes().notes.find((n) => n.filePath === texPath) || {}).texOptions || {}).compileOnSave === true);
  const before = fs.statSync(pdfPath).mtimeMs;
  const zoomOf = () => guest().evaluate(() => document.getElementById('pdfZoom').textContent);
  const zoomBefore = await zoomOf();
  await guest().click('[data-pdf-act="zoom-in"]');
  await guest().click('[data-pdf-act="zoom-in"]');
  await waitFor('zoomed in', async () => (await zoomOf()) !== zoomBefore);
  const zoomed = await zoomOf();
  await page.click('#codeHost .cm-line >> nth=2');
  await page.keyboard.press('End');
  await page.keyboard.type(' and more');
  await waitFor('compiled again by itself', () => fs.statSync(pdfPath).mtimeMs > before, 15000);
  await waitFor('status back to compiled', async () => (await statusText()) === 'Compiled', 15000);
  await waitFor('the PDF reloaded with the new file', () => guest().evaluate(() => !!document.querySelector('#pdfEditor .pdfViewer .page canvas')), 8000);
  await sleep(1500);
  assert.equal(await zoomOf(), zoomed, 'the zoom survives the silent reload');

  await closeSplitIfOpen();
  await removeFromNotes([texPath, pdfPath]);
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
  await waitFor('two file notes linked', () => readNotes().notes.filter(isLinkedFile).length === 2);
  const mdNote = readNotes().notes.find((n) => n.filePath && n.filePath.endsWith('External note.md'));
  assert.equal(mdNote.title, 'External note.md');
  assert.equal(mdNote.body, '# From disk\n\nline one\n');
  await waitForDom(() => document.getElementById('titleInput').value === 'External note.md');
  assert.equal(await page.$eval('#fileRow', (r) => !r.classList.contains('hidden')), true);
  assert.equal(await page.textContent('#fileKind'), 'Markdown');
  assert.equal(await page.$$eval('#fileRow button', (bs) => bs.filter((b) => b.offsetParent).length), 0, 'the row shows no buttons for a file that does not compile');
  await page.click('#moreBtn');
  await page.waitForSelector('#moreMenu:not(.hidden)');
  const fileItems = () => page.$$eval('#fileRevealBtn, #fileOpenBtn, #fileConvertBtn', (bs) => bs.map((b) => !b.classList.contains('hidden') && !!b.offsetParent));
  await waitForDom(() => !document.getElementById('fileConvertBtn').classList.contains('hidden'));
  assert.deepEqual(await fileItems(), [true, true, true], 'a file note shows the This file group in More');
  await page.click('#fileConvertBtn');
  await waitForDom(() => document.getElementById('moreMenu').classList.contains('hidden'));
  await page.waitForSelector('#convertMenu:not(.hidden) button');
  await page.keyboard.press('Escape');
  await waitForDom(() => document.getElementById('convertMenu').classList.contains('hidden'));
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'moreBtn', 'Esc from Convert to returns to More');
  await clickRow('Alpha');
  await waitForDom(() => document.getElementById('titleInput').value === 'Alpha');
  await page.click('#moreBtn');
  await page.waitForSelector('#moreMenu:not(.hidden)');
  assert.deepEqual(await fileItems(), [true, true, false], 'a vault note can be shown or opened, not converted');
  await page.keyboard.press('Escape');
  await waitForDom(() => document.getElementById('moreMenu').classList.contains('hidden'));
  await clickRow('External note.md');
  await waitForDom(() => document.getElementById('titleInput').value === 'External note.md');

  const inoBefore = fs.statSync(mdPath).ino;
  await fillBody('# From disk\n\nline one\nline two from the app\n');
  await waitFor('edit reached the file', () => fs.readFileSync(mdPath, 'utf8').includes('line two from the app'));
  assert.equal(fs.statSync(mdPath).ino, inoBefore, 'written in place');

  await sleep(400);
  fs.writeFileSync(mdPath, '# From disk\n\nreplaced by another program\n');
  await waitForDomWithin(10000, () => document.getElementById('bodyInput').value.includes('replaced by another program'));

  const outside = '# From disk\n\nwritten by another program while typing\n';
  await focusBody();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('x');
  fs.writeFileSync(mdPath, outside);
  await waitForDomWithin(10000, () => document.getElementById('bodyInput').value.includes('while typing') && !document.getElementById('bodyInput').value.includes('x'));
  await sleep(600);
  assert.equal(fs.readFileSync(mdPath, 'utf8'), outside, 'the disk version wins without asking; the typed character is not written');
  assert.equal(await page.inputValue('#bodyInput'), outside);

  const softPath = path.join(fileDir, 'soft.md');
  fs.writeFileSync(softPath, 'first line\nsecond line\n');
  await page.keyboard.press('Control+e');
  await waitFor('rendered preferred', () => readNotes().settings.editorMode === 'rendered');
  await page.evaluate((p) => window.notesApi.files.link([p]), softPath);
  await waitFor('soft file linked', () => readNotes().notes.some((n) => n.filePath && n.filePath.endsWith('soft.md')));
  await page.click('.nav-item[data-view="all"]');
  await waitFor('soft.md listed', () => revealRow({ text: 'soft.md' }), 8000);
  await clickRow("soft.md");
  await waitForDom(() => document.getElementById('titleInput').value === 'soft.md');
  await waitForDom(() => !document.getElementById('bodyInput').classList.contains('hidden'));
  assert.equal(readNotes().settings.editorMode, 'rendered', 'global preference untouched');
  await sleep(600);
  assert.equal(fs.readFileSync(softPath, 'utf8'), 'first line\nsecond line\n', 'file untouched by opening it');
  assert.match(await page.textContent('#statusWords'), /^4 words$/, 'a text file counts words');

  const codePath = path.join(fileDir, 'tool.py');
  fs.writeFileSync(codePath, 'import os\n\n\ndef main():\n    print(os.getcwd())\n');
  await page.evaluate((p) => window.notesApi.files.link([p]), codePath);
  await waitFor('code file linked', () => readNotes().notes.some((n) => n.filePath && n.filePath.endsWith('tool.py')));
  await page.click('.nav-item[data-view="all"]');
  await waitFor('tool.py listed', () => revealRow({ text: 'tool.py' }), 8000);
  await clickRow('tool.py');
  await waitForDom(() => document.getElementById('titleInput').value === 'tool.py');
  await waitForDom(() => document.getElementById('fileKind').textContent === 'Python');
  await waitForDom(() => /^5 lines$/.test(document.getElementById('statusWords').textContent));
  assert.match(await page.textContent('#statusChars'), /^47 characters$/);

  await clickRow("paper.pdf");
  await waitForDom(() => document.getElementById('titleInput').value === 'paper.pdf');
  await waitForDom(() => !document.getElementById('pdfEditor').classList.contains('hidden') && !!document.querySelector('#pdfEditor .pdfViewer .page canvas'));
  assert.equal(await page.$eval('#bodyInput', (t) => t.classList.contains('hidden')), true);
  assert.match(await page.textContent('#fileBanner'), /original is backed up/);

  const themeBefore = await page.evaluate(() => { const t = document.documentElement.dataset.theme; document.documentElement.dataset.theme = 'dark'; return t; });
  const shown = (sel) => page.$eval(sel, (n) => getComputedStyle(n).display !== 'none');
  assert.equal(await shown('#pdfFormat'), false, 'no settings row in Read mode');
  await page.click('[data-pdf-mode="text"]');
  await waitForDom(() => document.getElementById('pdfEditor').dataset.tool === 'text');
  assert.equal(await shown('#pdfFormat'), true);
  assert.equal(await shown('#pdfFormat [data-pdf-for="text"]'), true);
  assert.equal(await shown('#pdfFormat [data-pdf-for="draw"]'), false);
  assert.equal(await page.inputValue('[data-pdf-text="color"]'), '#000000', 'text defaults to black, not the dark theme\'s CanvasText');
  assert.equal(await page.inputValue('[data-pdf-text="size"]'), '12');
  assert.equal(await page.inputValue('[data-pdf-text="font"]'), 'sans');
  await page.waitForSelector('#pdfEditor .text-marks.is-active');
  const mid = await page.$eval('#pdfEditor .pdfViewer .page', (p) => {
    p.scrollIntoView({ block: 'center' });
    const b = p.getBoundingClientRect();
    const v = p.closest('.pdf-viewport').getBoundingClientRect();
    const top = Math.max(b.top, v.top);
    const bottom = Math.min(b.bottom, v.bottom);
    return { x: b.left + b.width / 2, y: (top + bottom) / 2 };
  });
  await page.mouse.click(mid.x, mid.y);
  await page.waitForSelector('#pdfEditor .text-mark.is-editing .text-mark-body');
  await page.keyboard.type('Checked');
  const textBox = () => page.$eval('#pdfEditor .text-mark .text-mark-body', (d) => ({ color: getComputedStyle(d).color, weight: getComputedStyle(d).fontWeight, align: getComputedStyle(d).textAlign, text: d.textContent }));
  assert.equal((await textBox()).color, 'rgb(0, 0, 0)', 'a new text box is black in dark mode');
  assert.equal((await textBox()).text, 'Checked');
  await page.fill('[data-pdf-text="color"]', '#ff0000');
  await waitForDom(() => getComputedStyle(document.querySelector('#pdfEditor .text-mark .text-mark-body')).color === 'rgb(255, 0, 0)');
  await page.click('[data-pdf-text="bold"]');
  await waitForDom(() => getComputedStyle(document.querySelector('#pdfEditor .text-mark .text-mark-body')).fontWeight === '700');
  assert.equal(await page.getAttribute('[data-pdf-text="bold"]', 'aria-pressed'), 'true');
  await page.click('[data-pdf-text="align"][data-pdf-value="center"]');
  await waitForDom(() => getComputedStyle(document.querySelector('#pdfEditor .text-mark .text-mark-body')).textAlign === 'center');
  await page.selectOption('[data-pdf-text="size"]', '18');
  await waitForDom(() => parseFloat(document.querySelector('#pdfEditor .text-mark .text-mark-body').style.fontSize) > 18);
  await page.keyboard.press('Escape');
  await waitForDom(() => !document.querySelector('#pdfEditor .text-mark.is-editing'));
  assert.equal(await page.$eval('#pdfEditor .text-mark', (n) => n.classList.contains('is-selected')), true, 'Escape leaves the box selected with its handles');
  assert.equal(await page.$$eval('#pdfEditor .text-mark .text-mark-handle', (hs) => hs.filter((h) => getComputedStyle(h).display !== 'none').length), 6);
  await page.click('[data-pdf-mode="draw"]');
  await waitForDom(() => document.getElementById('pdfEditor').dataset.tool === 'draw');
  assert.equal(await shown('#pdfFormat [data-pdf-for="text"]'), false);
  assert.equal(await shown('#pdfFormat [data-pdf-for="draw"]'), true);
  assert.equal(await page.inputValue('[data-pdf-param="inkColor"]'), '#000000', 'ink defaults to black too');
  assert.equal(await page.inputValue('[data-pdf-param="inkWidth"]'), '1');
  assert.equal(await page.textContent('[data-pdf-param="inkOpacity"] + output'), '100%');
  await page.click('[data-pdf-mode="text"]');
  await waitForDom(() => document.getElementById('pdfEditor').dataset.tool === 'text');
  assert.equal(await page.inputValue('[data-pdf-text="color"]'), '#ff0000', 'the last chosen style becomes the default for the next box');
  assert.equal(await page.inputValue('[data-pdf-text="size"]'), '18');
  assert.equal(await page.getAttribute('[data-pdf-text="bold"]', 'aria-pressed'), 'true');
  await page.click('[data-pdf-mode="select"]');
  await waitForDom(() => document.getElementById('pdfEditor').dataset.tool === 'select');
  assert.equal(await shown('#pdfFormat'), false);
  await page.evaluate((t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }, themeBefore);

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await page.click('#agentFilesBtn');
  await waitFor('agent files folder exists', () => readNotes().folders.some((f) => f.name === 'Agent files'));
  await waitFor('global CLAUDE.md linked', () => readNotes().notes.some((n) => n.filePath && /\\\.claude\\CLAUDE\.md$/i.test(n.filePath)));
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await waitForDomWithin(15000, () => /Agent files are in the/.test(document.getElementById('toast').textContent));
  const agentFolder = readNotes().folders.find((f) => f.name === 'Agent files');
  const globalNote = readNotes().notes.find((n) => n.filePath && /\\\.claude\\CLAUDE\.md$/i.test(n.filePath));
  assert.equal(globalNote.folderId, agentFolder.id);
  assert.match(globalNote.title, /global/);
  assert.ok(globalNote.body.includes('# Global instructions'), 'contents read from the real file');

  await page.click('.nav-item[data-view="all"]');
  for (const t of ['External note.md', 'paper.pdf', 'soft.md', 'tool.py']) {
    const id = readNotes().notes.find((n) => n.title === t).id;
    await waitFor(t + ' listed', () => revealRow({ id }), 8000);
    await page.evaluate((x) => document.querySelector('.note-row[data-id="' + x + '"]').click(), id);
    await waitForDom((x) => document.getElementById('titleInput').value === x, t);
    await page.keyboard.press('Control+Shift+Delete');
    await waitFor(t + ' trashed', () => readNotes().notes.find((n) => n.title === t).trashedAt);
  }
  assert.ok(fs.existsSync(mdPath) && fs.existsSync(pdfPath), 'trashing a file note leaves the files alone');
  await page.click('.nav-item[data-view="trash"]');
  await page.waitForSelector('#emptyTrashBtn:not(.hidden)', { timeout: 8000 });
  await page.click('#emptyTrashBtn');
  await waitFor('file notes destroyed', () => !readNotes().notes.some((n) => ['External note.md', 'paper.pdf', 'soft.md'].includes(n.title)));
  const agentNoteIds = readNotes().notes.filter((x) => x.folderId === agentFolder.id).map((x) => x.id);
  await page.evaluate(async ({ ids, folderId }) => {
    for (const id of ids) await window.notesApi.notes.destroy(id);
    await window.notesApi.folders.delete(folderId);
  }, { ids: agentNoteIds, folderId: agentFolder.id });
  await waitFor('agent links removed', () => !readNotes().notes.some(isLinkedFile) && !readNotes().folders.some((f) => f.name === 'Agent files'));
  assert.ok(fs.readFileSync(path.join(os.homedir(), '.claude', 'CLAUDE.md'), 'utf8').includes('# Global instructions'), 'the real file was never modified');
  await page.click('.nav-item[data-view="all"]');
  await waitForDom(() => document.querySelectorAll('.note-row').length >= 2);
  await clickRow("Gamma (copy)");
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
  const addedVaults = () => readNotes().vaults.filter((v) => !v.home);
  await waitFor('vault recorded', () => addedVaults().length === 1);
  const vault = addedVaults()[0];
  await waitFor('vault notes mirrored', () => readNotes().notes.filter((n) => n.vaultId === vault.id).length === 2);
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await page.waitForSelector('.folder-row .vault-badge', { timeout: 8000 });
  const root = readNotes().folders.find((f) => f.vaultId === vault.id && !f.parentId);
  assert.equal(root.name, path.basename(vaultDir));
  assert.ok(readNotes().folders.some((f) => f.vaultId === vault.id && f.name === 'Work'));

  await page.keyboard.press('Control+n');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', 'Shopping');
  await fillBody('- eggs\n');
  await waitFor('file created from note', () => fs.existsSync(path.join(vaultDir, 'Shopping.md')) && fs.readFileSync(path.join(vaultDir, 'Shopping.md'), 'utf8') === '- eggs\n');
  await page.fill('#titleInput', 'Groceries');
  await waitFor('file renamed', () => fs.existsSync(path.join(vaultDir, 'Groceries.md')) && !fs.existsSync(path.join(vaultDir, 'Shopping.md')));

  fs.writeFileSync(path.join(vaultDir, 'Work', 'External.md'), 'external\n');
  await waitFor('external file became a note', () => readNotes().notes.some((n) => n.title === 'External' && n.vaultId === vault.id), 15000);

  const tagged = path.join(vaultDir, 'Tagged.md');
  fs.writeFileSync(tagged, '---\ntags: [alpha]\n---\n\nTagged body\n');
  await waitFor('front matter note appeared', () => readNotes().notes.some((n) => n.title === 'Tagged' && n.vaultId === vault.id), 15000);
  await useSourceMode(false);
  await clickRow("Tagged");
  await waitForDom(() => document.getElementById('titleInput').value === 'Tagged');
  assert.equal(await page.$eval('#bodyInput', (t) => t.classList.contains('hidden')), true, 'a note with front matter opens rendered');
  assert.equal(await page.inputValue('#tagsInput'), 'alpha');
  assert.ok(!(await page.textContent('#richEditor')).includes('tags:'), 'the rendered view does not show the front matter');
  await page.click('#richEditor p:has-text("Tagged body")');
  await page.keyboard.press('End');
  await page.keyboard.type(' more');
  await waitFor('a rendered edit keeps the front matter', () => /^---\ntags: \[alpha\]\n---\n\nTagged body more\n?$/.test(fs.readFileSync(tagged, 'utf8')));
  await page.fill('#tagsInput', 'alpha, beta');
  await waitFor('a tag edit lands in the front matter', () => /^---\ntags: \[alpha, beta\]\n---\n\nTagged body more\n?$/.test(fs.readFileSync(tagged, 'utf8')));
  await page.click('#richEditor p:has-text("Tagged body more")');
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await waitFor('a body edit after a tag edit keeps the tag', () => /^---\ntags: \[alpha, beta\]\n---\n\nTagged body more!\n?$/.test(fs.readFileSync(tagged, 'utf8')));
  await useSourceMode(true);
  assert.match(await page.inputValue('#bodyInput'), /^---\ntags: \[alpha, beta\]\n---/);
  assert.equal(await page.$$eval('#codeHost .cm-frontMatter', (ls) => ls.map((l) => l.textContent)).then((t) => t.join('|')), '---|tags: [alpha, beta]|---', 'the front matter lines are marked so they can recede');

  await clickRow("Groceries");
  await waitForDom(() => document.getElementById('titleInput').value === 'Groceries');
  await sleep(600);
  fs.writeFileSync(path.join(vaultDir, 'Groceries.md'), '- eggs\n- milk from another device\n');
  await waitForDomWithin(15000, () => document.getElementById('bodyInput').value.includes('milk from another device'));

  await clickRow("Groceries");
  await waitForDom(() => document.getElementById('titleInput').value === 'Groceries');
  await page.keyboard.press('Control+Shift+Delete');
  await waitFor('moved to .trash', () => fs.existsSync(path.join(vaultDir, '.trash', 'Groceries.md')) && !fs.existsSync(path.join(vaultDir, 'Groceries.md')));
  await page.click('.nav-item[data-view="trash"]');
  await page.waitForSelector('#emptyTrashBtn:not(.hidden)', { timeout: 8000 });
  await page.click('#emptyTrashBtn');
  await waitFor('deleted from .trash', () => !fs.existsSync(path.join(vaultDir, '.trash', 'Groceries.md')));

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await page.waitForSelector('.vault-item', { timeout: 8000 });
  assert.match(await page.textContent('.vault-item .vault-status'), /Plain folder/);
  await page.click('.vault-item button:has-text("Sync now")');
  await waitForDom(() => /plain folder/i.test(document.getElementById('toast').textContent));

  await page.click('.vault-item button:has-text("Remove")');
  await waitFor('vault removed', () => addedVaults().length === 0 && !readNotes().notes.some((n) => n.vaultId === vault.id));
  assert.ok(fs.existsSync(path.join(vaultDir, 'Hello.md')) && fs.existsSync(path.join(vaultDir, 'Work', 'Plan.md')), 'files untouched');
  await waitForDom(() => !document.getElementById('settingsDialog').open).catch(() => {});
  await page.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); });
  await page.click('.nav-item[data-view="all"]');
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
});

test('bot: runs Claude Code in the notes folder, streams output, and its edits come back through the files', { timeout: 60000 }, async () => {
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await fillBody('bot target body');
  await waitFor('body saved', () => findNote('Gamma (copy)').body === 'bot target body');
  await page.keyboard.press('Control+Shift+a');
  await page.waitForSelector('#botPanel:not(.hidden)');
  assert.match(await page.textContent('#botScope'), /your notes folder/);
  await app.evaluate(() => { process.env.FAKE_CLAUDE_AUTH = 'apiKey'; });
  await page.fill('#botPrompt', 'Append a bullet to the current note');
  await page.keyboard.press('Control+Enter');
  await waitForDomWithin(10000, () => /bills API credits/.test(document.getElementById('botOutput').textContent));
  assert.doesNotMatch(await page.textContent('#botOutput'), /fake claude: cwd/, 'nothing ran');
  await app.evaluate(() => { process.env.FAKE_CLAUDE_AUTH = 'none'; });
  await page.keyboard.press('Control+Enter');
  await waitForDomWithin(10000, () => /not signed in/.test(document.getElementById('botOutput').textContent));
  await app.evaluate(() => { delete process.env.FAKE_CLAUDE_AUTH; });
  await page.keyboard.press('Control+Enter');
  await waitForDomWithin(20000, () => [...document.querySelectorAll('#botOutput .bot-meta')].some((s) => s.textContent.startsWith('\nDone')));
  const out = await page.textContent('#botOutput');
  assert.match(out, /Claude Code, on your Claude Max subscription \(no API credits\)/);
  assert.match(out, /api key env: absent/);
  const term = await page.evaluate(() => window.notesApi.bot.openTerminal(null));
  assert.equal(term.ok, true, JSON.stringify(term));
  const ps = fs.readFileSync(term.script, 'utf8');
  for (const v of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) assert.match(ps, new RegExp('Remove-Item -LiteralPath Env:' + v + ' '));
  assert.ok(ps.indexOf('Remove-Item') < ps.indexOf('& $notes'), 'variables are cleared before Claude Code starts');
  assert.equal(term.cwd, path.join(dataDir, 'Notes'), 'the terminal opens in the notes folder');
  assert.match(out, /fake claude: cwd=.*Notes/);
  assert.match(out, /edited Gamma \(copy\)\.md/);
  const gammaFile = homeNoteFile('Gamma (copy)');
  assert.equal(path.dirname(gammaFile), path.join(dataDir, 'Notes'));
  await waitFor('agent edit read from the file', () => findNote('Gamma (copy)').body === 'bot target body\n- added by the bot\n');
  const botFile = path.join(dataDir, 'Notes', 'Bot created this.md');
  await waitFor('agent-created file became a note', () => readNotes().notes.find((n) => n.filePath === botFile));
  await waitForDom(() => document.getElementById('bodyInput').value.includes('added by the bot'));
  fs.writeFileSync(gammaFile, 'bot target body\n- added by the bot\n- typed in a terminal\n', 'utf8');
  await waitFor('terminal edit read from the file', () => /typed in a terminal/.test(findNote('Gamma (copy)').body), 15000);
  await waitForDomWithin(15000, () => document.getElementById('bodyInput').value.includes('typed in a terminal'));
  const botNote = readNotes().notes.find((n) => n.filePath === botFile);
  await page.evaluate(async (id) => { await window.notesApi.notes.trash(id); await window.notesApi.notes.destroy(id); }, botNote.id);
  await fillBody('pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
  await page.keyboard.press('Control+Shift+a');
  await waitForDom(() => document.getElementById('botPanel').classList.contains('hidden'));
});

test('stickies: a note becomes a desktop window; edits flow both ways; colour and removal persist', { timeout: 60000 }, async () => {
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await fillBody('- [ ] buy milk\n');
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
  await waitForDom(() => !!document.querySelector('.note-row.is-active .sticky-mark'));
  await waitFor('checkbox rendered', () => sticky.evaluate(() => !!document.querySelector('#stickyEditor ul[data-type="taskList"] input[type="checkbox"]')));
  assert.match(await sticky.textContent('#stickyTitle'), /Gamma \(copy\)/);

  await sticky.click('#stickyEditor .rich-editor-content');
  await sticky.keyboard.press('Control+End');
  await sticky.keyboard.type('eggs');
  await waitFor('sticky edit saved', () => /eggs/.test(findNote('Gamma (copy)').body), 8000);
  await waitForDomWithin(8000, () => /eggs/.test(document.getElementById('bodyInput').value));

  await fillBody('- [x] done from main\n');
  await waitFor('main edit saved', () => findNote('Gamma (copy)').body === '- [x] done from main\n');
  await waitFor('sticky reloaded', () => sticky.evaluate(() => /done from main/.test(document.querySelector('#stickyEditor').textContent)), 8000);

  await sticky.click('#stickyColors [data-color="sky"]');
  await waitFor('colour saved', () => findNote('Gamma (copy)').sticky.color === 'sky');
  await waitFor('tint applied', () => sticky.evaluate(() => document.documentElement.dataset.color === 'sky'));
  await sticky.click('#stickyTopBtn');
  await waitFor('onTop saved', () => findNote('Gamma (copy)').sticky.onTop === false);
  const bw = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), onTop: w.isAlwaysOnTop(), frame: w.isResizable() })));
  assert.ok(bw.length >= 2, 'two windows');

  await sticky.keyboard.press('Escape').catch(() => {});
  await waitFor('hidden', () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length) .then((n) => n === 1));
  assert.ok(findNote('Gamma (copy)').sticky, 'still a sticky after Esc');
  const again = app.waitForEvent('window', { timeout: 15000 });
  await page.evaluate((id) => window.notesApi.stickies.open(id), findNote('Gamma (copy)').id);
  const sticky2 = await again;
  await sticky2.waitForSelector('#stickyEditor .rich-editor-content', { timeout: 15000 });
  await waitFor('same tint on reopen', () => sticky2.evaluate(() => document.documentElement.dataset.color === 'sky'));

  await sticky2.click('#stickyCloseBtn');
  await waitFor('removed', () => !findNote('Gamma (copy)').sticky);
  await waitFor('window closed', () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).then((n) => n === 1));
  await waitForDom(() => !document.getElementById('stickyBtn').classList.contains('is-on'));
  assert.equal(findNote('Gamma (copy)').body, '- [x] done from main\n');

  const created = app.waitForEvent('window', { timeout: 15000 });
  const fresh = await page.evaluate(() => window.notesApi.stickies.create());
  const s3 = await created;
  await s3.waitForSelector('#stickyEditor .rich-editor-content', { timeout: 15000 });
  await page.evaluate((id) => window.notesApi.notes.trash(id), fresh.id);
  await waitFor('window closed by trash', () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length).then((n) => n === 1));
  await page.evaluate((id) => window.notesApi.notes.destroy(id), fresh.id);

  await fillBody('pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('stickies: a note the rendered view cannot reproduce opens read-only instead of being rewritten', { timeout: 30000 }, async () => {
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  const lossy = '~~~\nfenced with tildes\n~~~\n\nbody\n';
  await fillBody(lossy);
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
  await fillBody('pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('undo after switching notes does nothing; typing with the find bar open does not eat text', async () => {
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await fillBody('gamma text');
  await waitFor('gamma saved', () => findNote('Gamma (copy)').body === 'gamma text');
  await useSourceMode(false);
  const other = readNotes().notes.find((n) => n.title !== 'Gamma (copy)' && !n.trashedAt && n.vaultId === homeVaultId());
  await clickRowById(other.id);
  await waitForDom((id) => !!document.querySelector('.note-row.is-active[data-id="' + id + '"]'), other.id);
  const before = await page.evaluate(() => document.getElementById('bodyInput').value);
  await page.click('.rich-editor-content');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await sleep(600);
  assert.equal(await page.evaluate(() => document.getElementById('bodyInput').value), before, 'undo did not bring the other note back');
  assert.equal(findNote(other.title).body, before);
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await page.keyboard.press('Control+f');
  await page.waitForSelector('#findBar:not(.hidden)');
  await page.fill('#findInput', 'gamma');
  await waitForDom(() => document.getElementById('findCount').textContent === '1/1');
  await clickBody();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' plus gamma');
  await waitFor('typed intact', () => findNote('Gamma (copy)').body === 'gamma text plus gamma');
  await waitForDom(() => /\/2$/.test(document.getElementById('findCount').textContent));
  await page.keyboard.press('Escape');
  await waitForDom(() => document.getElementById('findBar').classList.contains('hidden'));
  await fillBody('pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('find in note counts and steps through matches; print asks the system to print', async () => {
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await fillBody('- needle one\n- hay\n- needle two\n');
  await waitFor('body saved', () => findNote('Gamma (copy)').body === '- needle one\n- hay\n- needle two\n');
  await page.keyboard.press('Control+f');
  await page.waitForSelector('#findBar:not(.hidden)');
  await page.fill('#findInput', 'needle');
  await waitForDomWithin(8000, () => document.getElementById('findCount').textContent === '1/2');
  await page.keyboard.press('Enter');
  await waitForDomWithin(8000, () => document.getElementById('findCount').textContent === '2/2');
  assert.deepEqual(await page.evaluate(() => [document.getElementById('bodyInput').selectionStart, document.getElementById('bodyInput').selectionEnd]), ['- needle one\n- hay\n- '.length, '- needle one\n- hay\n- needle'.length], 'source view selects the active match');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('#codeHost')), true, 'focus moves to the text so the selection is visible');
  await page.keyboard.press('Shift+F3');
  await waitForDomWithin(8000, () => document.getElementById('findCount').textContent === '1/2');
  assert.deepEqual(await page.evaluate(() => [document.getElementById('bodyInput').selectionStart, document.getElementById('bodyInput').selectionEnd]), [2, 8]);
  await page.keyboard.press('Enter');
  await waitForDomWithin(8000, () => document.getElementById('findCount').textContent === '2/2');
  await page.keyboard.press('Shift+Enter');
  await waitForDomWithin(8000, () => document.getElementById('findCount').textContent === '1/2');
  assert.equal(await page.evaluate(() => document.getElementById('bodyInput').value), '- needle one\n- hay\n- needle two\n', 'text untouched by stepping: Enter steps the match instead of continuing the list');
  await page.click('#findInput');
  await page.keyboard.press('Escape');
  await useSourceMode(false);
  await page.keyboard.press('Control+f');
  await page.waitForSelector('#findBar:not(.hidden)');
  await page.fill('#findInput', 'NEEDLE');
  await waitForDomWithin(8000, () => document.getElementById('findCount').textContent === '1/2');
  assert.equal(await page.evaluate(() => CSS.highlights.get('notes-find').size), 2, 'two highlighted ranges');
  await page.keyboard.press('Enter');
  await waitForDomWithin(8000, () => document.getElementById('findCount').textContent === '2/2');
  await page.click('.rich-editor-content');
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' needle three');
  await waitForDomWithin(8000, () => /\/3$/.test(document.getElementById('findCount').textContent));
  await page.fill('#findInput', 'onehay');
  await waitForDomWithin(8000, () => document.getElementById('findCount').textContent === 'No matches');
  await page.fill('#findInput', 'NEEDLE');
  await waitForDomWithin(8000, () => /\/3$/.test(document.getElementById('findCount').textContent));
  await page.keyboard.press('Escape');
  await waitForDom(() => !CSS.highlights.has('notes-find'));
  await useSourceMode(true);
  await page.keyboard.press('Control+f');
  await page.waitForSelector('#findBar:not(.hidden)');
  await page.fill('#findInput', 'zzzz-not-here');
  await waitForDomWithin(8000, () => document.getElementById('findCount').textContent === 'No matches');
  await page.keyboard.press('Escape');
  await waitForDom(() => document.getElementById('findBar').classList.contains('hidden'));
  await waitForDomWithin(2000, () => !document.getElementById('app').classList.contains('hidden'));
  const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
  assert.equal(visible, true, 'Escape in the find bar must not hide the app');
  await page.keyboard.press('Control+Shift+p');
  await waitForDomWithin(8000, () => /Print: dry run/.test(document.getElementById('toast').textContent));
  await fillBody('pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('find in note: match case and whole word narrow the matches by button, Alt+C and Alt+W, in both views, and replace follows them', async () => {
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  const body = 'Needle needle needles NEEDLE\n';
  await fillBody(body);
  await waitFor('body saved', () => findNote('Gamma (copy)').body === body);
  const total = (n) => waitFor('find total ' + n, async () => (await page.$eval('#findCount', (e) => e.textContent)).endsWith('/' + n));
  const pressed = (sel) => page.$eval(sel, (b) => b.getAttribute('aria-pressed') === 'true' && b.classList.contains('is-on'));
  await page.keyboard.press('Control+f');
  await page.waitForSelector('#findBar:not(.hidden)');
  await page.fill('#findInput', 'needle');
  await total(4);
  try {
    await page.click('#findCaseBtn');
    await total(2);
    assert.equal(await pressed('#findCaseBtn'), true, 'the button shows it is on');
    await page.keyboard.press('Alt+w');
    await total(1);
    assert.equal(await pressed('#findWordBtn'), true);
    await page.keyboard.press('Alt+c');
    await total(3);
    assert.equal(await pressed('#findCaseBtn'), false);
    await page.focus('#findInput');
    await page.keyboard.press('Alt+w');
    await total(4);

    await page.keyboard.press('Control+e');
    await page.waitForSelector('#richEditor:not(.hidden)');
    await total(4);
    await page.click('#findCaseBtn');
    await total(2);
    await page.click('#findCaseBtn');
    await total(4);
    await page.click('#findWordBtn');
    await total(3);

    await page.keyboard.press('Control+h');
    await page.waitForSelector('#replaceRow:not(.hidden)');
    await page.fill('#replaceInput', 'pin');
    await page.click('#replaceAllBtn');
    await waitFor('whole words replaced', () => findNote('Gamma (copy)').body.replace(/\s+$/, '') === 'pin pin needles pin');
  } finally {
    for (const sel of ['#findCaseBtn', '#findWordBtn']) if (await pressed(sel)) await page.click(sel);
    await page.keyboard.press('Escape');
    await waitForDom(() => document.getElementById('findBar').classList.contains('hidden'));
  }
});

test('reminders: set from the dialog, shown on the card and in the Reminders view, fired by the scheduler, cleared', { timeout: 30000 }, async () => {
  await clickRow("Gamma (copy)");
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
  await waitForDom(() => !!document.querySelector('.note-row.is-active .remind-mark'));
  await waitForDom(() => document.getElementById('countReminders').textContent === '1');
  await page.click('.nav-item[data-view="reminders"]');
  await waitForDom(() => document.querySelectorAll('.note-row').length === 1 && /Gamma/.test(document.querySelector('.note-row').textContent));
  await page.evaluate((nid) => window.notesApi.notes.update(nid, { remindAt: Date.now() + 600 }), id);
  await waitForDomWithin(8000, () => /⏰ Gamma \(copy\)/.test(document.getElementById('toast').textContent));
  await waitFor('marked reminded', () => { const n = findNote('Gamma (copy)'); return n.remindedAt && n.remindedAt >= n.remindAt; });
  await waitForDomWithin(8000, () => !!document.querySelector('.note-row .remind-mark.is-overdue'));
  await waitForDom(() => document.getElementById('countReminders').classList.contains('is-overdue'));
  await page.keyboard.press('Control+Shift+m');
  await page.waitForSelector('#remindDialog[open]');
  assert.match(await page.textContent('#remindCurrent'), /went off/);
  await page.click('#remindClearBtn');
  await waitFor('cleared', () => findNote('Gamma (copy)').remindAt === null);
  await waitForDom(() => document.getElementById('countReminders').textContent === '0');
  await waitForDom(() => document.querySelectorAll('.note-row').length === 0);
  await page.click('.nav-item[data-view="all"]');
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await page.keyboard.press('Control+Shift+m');
  await page.waitForSelector('#remindDialog[open]');
  await page.fill('#remindInput', '2031-01-02T09:30');
  await page.click('#remindSetBtn');
  await waitFor('typed time saved', () => findNote('Gamma (copy)').remindAt === new Date(2031, 0, 2, 9, 30).getTime());
  await page.evaluate((nid) => window.notesApi.notes.update(nid, { remindAt: null }), id);
  await waitFor('cleared again', () => findNote('Gamma (copy)').remindAt === null);
});

test('share: copy as Markdown, rich text and plain text; email via mailto; save as PDF and HTML', { timeout: 30000 }, async () => {
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await fillBody('# Head\n\n**bold** text\n');
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
  await page.keyboard.press('Control+Shift+s');
  await page.waitForSelector('#shareMenu:not(.hidden)');
  await page.keyboard.press('Escape');
  await waitForDom(() => document.getElementById('shareMenu').classList.contains('hidden'));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  await fillBody('pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('locking: a password locks the note, the file holds no plaintext, wrong password is refused, hiding the app relocks', { timeout: 60000 }, async () => {
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await fillBody('the launch code is 4242-flamingo');
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
  assert.ok(!savedText().includes('flamingo'), 'no plaintext in notes.json, its journal, or any file in the notes folder');
  await waitForDom(() => document.querySelector('#lockBtn .lbl').textContent === 'Unlocked');
  assert.equal(await page.inputValue('#bodyInput'), 'the launch code is 4242-flamingo', 'still readable right after locking');
  await fillBody('the launch code is 9999-pelican');
  await sleep(900);
  await waitFor('edit encrypted', () => !savedText().includes('pelican') && findNote('Gamma (copy)').body === '');
  await clickTool('#lockBtn');
  await page.waitForSelector('#lockMenu:not(.hidden)');
  await page.click('#lockMenu [data-action="relock"]');
  await page.waitForSelector('#lockScreen:not(.hidden)');
  assert.ok(await page.evaluate(() => document.getElementById('bodyInput').classList.contains('hidden') && document.getElementById('richEditor').classList.contains('hidden')), 'editors hidden while locked');
  await waitForDom(() => !!document.querySelector('.note-row.is-active .lock-mark'));
  assert.equal(await page.evaluate(() => document.getElementById('stickyBtn').disabled), true, 'no stickies for locked notes');
  await page.fill('#searchInput', 'pelican');
  await waitForDom(() => document.querySelectorAll('.note-row').length === 0 && /No|Nothing/.test(document.querySelector('.list-pane').textContent));
  await page.fill('#searchInput', '');
  await clickRow("Gamma (copy)");
  await page.waitForSelector('#lockScreen:not(.hidden)');
  await page.fill('#titleInput', 'Gamma (copy) renamed');
  await waitFor('title saved while locked', () => findNote('Gamma (copy) renamed') && findNote('Gamma (copy) renamed').body === '');
  await page.fill('#titleInput', 'Gamma (copy)');
  await waitFor('title back', () => !!findNote('Gamma (copy)'));
  await page.fill('#lockScreenPassword', 'nope');
  await page.click('#lockScreenBtn');
  await waitForDom(() => /Wrong password/.test(document.getElementById('lockScreenError').textContent));
  await page.fill('#lockScreenPassword', 'pw-one');
  await page.keyboard.press('Enter');
  await waitForDom(() => document.getElementById('lockScreen').classList.contains('hidden'));
  assert.equal(await page.inputValue('#bodyInput'), 'the launch code is 9999-pelican');
  await page.evaluate(() => window.notesApi.app.hide());
  await waitFor('hidden', () => app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isVisible()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  await page.waitForSelector('#lockScreen:not(.hidden)', { timeout: 8000 });
  assert.equal(await page.inputValue('#bodyInput'), '', 'plaintext cleared from the editor');
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
  await fillBody('pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
  void id;
});

test('the flat list shows cards: title, a two-line snippet, the time and tags; the folder view keeps one-line rows; a search card shows the match', async () => {
  const body = 'The quick brown fox jumps over the lazy dog, then naps in the warm afternoon sun while the farmer counts his sheep and the river runs on past the mill.\n\nTags: #cards';
  const note = await typeNote('Card sample', body);
  await page.click('.nav-item[data-view="all"]');
  const wasTree = await page.$eval('#listModeSeg button[data-mode="tree"]', (b) => b.classList.contains('is-on'));
  try {
    if (wasTree) await page.click('#listModeSeg button[data-mode="list"]');
    const card = `#noteList .note-row[data-id="${note.id}"]`;
    await page.waitForSelector(card + ' .card-snippet');
    const parts = await page.$eval(card, (c) => ({
      title: c.querySelector('.card-title .row-name').textContent,
      snippet: c.querySelector('.card-snippet').textContent,
      meta: c.querySelector('.card-meta').textContent,
      metaLines: Math.round(c.querySelector('.card-meta').getBoundingClientRect().height / parseFloat(getComputedStyle(c.querySelector('.card-meta')).lineHeight)),
      timeTitle: c.querySelector('.card-time').getAttribute('title'),
      tags: [...c.querySelectorAll('.card-meta .tag')].map((t) => t.textContent),
      height: c.getBoundingClientRect().height,
      snippetLines: Math.round(c.querySelector('.card-snippet').getBoundingClientRect().height / parseFloat(getComputedStyle(c.querySelector('.card-snippet')).lineHeight)),
      snippetClamped: c.querySelector('.card-snippet').scrollHeight > c.querySelector('.card-snippet').clientHeight,
    }));
    assert.equal(parts.title, 'Card sample');
    assert.match(parts.snippet, /^The quick brown fox jumps over the lazy dog, then naps in the warm afternoon sun/);
    assert.match(parts.meta, /^(just now|\d+ (seconds?|minutes?) ago)/);
    assert.deepEqual(parts.tags, ['#cards']);
    assert.equal(parts.metaLines, 1, 'the meta line never wraps');
    assert.match(parts.timeTitle, /\d/, 'the full date is the tooltip of the time');
    assert.ok(parts.height >= 56 && parts.height <= 130, 'a card is a few lines tall: ' + parts.height);
    assert.equal(parts.snippetLines, 2, 'the snippet is clamped to two lines');
    assert.equal(parts.snippetClamped, true, 'the longer text is cut, not shown');
    const otherRow = await page.$eval('#noteList .note-row:not([data-id="' + note.id + '"])', (c) => c.getBoundingClientRect().height);
    assert.ok(otherRow >= 40, 'every flat row is a card: ' + otherRow);

    await page.keyboard.press('Control+Shift+f');
    await page.keyboard.type('lazy dog');
    await page.waitForSelector(card + ' .card-snippet .mark');
    assert.equal(await page.$eval(card + ' .card-snippet', (s) => s.querySelector('.mark').textContent.toLowerCase()), 'lazy');
    await page.keyboard.press('Escape');
    await waitForDom(() => !document.getElementById('searchInput').value);

    await page.click('#listModeSeg button[data-mode="tree"]');
    await page.waitForSelector(`.note-tree .tree-note[data-id="${note.id}"]`);
    assert.equal(await page.$$eval('.note-tree .card-snippet, .note-tree .card-meta', (x) => x.length), 0, 'the folder view has no snippets or meta');
    const treeRow = await page.$eval(`.note-tree .tree-note[data-id="${note.id}"]`, (r) => r.getBoundingClientRect().height);
    assert.ok(treeRow <= 30, 'a tree row stays one line: ' + treeRow);
  } finally {
    if (!wasTree) await page.click('#listModeSeg button[data-mode="list"]');
    await page.evaluate((id) => window.notesApi.notes.destroy(id), note.id);
    await page.click('.nav-item[data-view="all"]');
  }
});

test('the palette shows a note with its folder, or with its age when it has none', async () => {
  const shown = await typeNote('Palette hint shown', 'x');
  await typeNote('Palette hint from here', 'y');
  await page.keyboard.press('Control+p');
  await page.waitForSelector('#palette[open]');
  await page.keyboard.type('Palette hint');
  const hintOf = (title) => page.evaluate((t) => {
    const li = [...document.querySelectorAll('#paletteList .palette-item')].find((x) => x.querySelector('.palette-title').textContent === t);
    return li ? (li.querySelector('.palette-hint') || { textContent: '' }).textContent : null;
  }, title);
  await waitFor('the note listed in the palette', async () => (await hintOf('Palette hint shown')) !== null);
  const folder = shown.folderId ? readNotes().folders.find((f) => f.id === shown.folderId) : null;
  assert.equal(await hintOf('Palette hint shown'), folder ? folder.name : 'just now');
  assert.equal(await hintOf('Palette hint from here'), null, 'the open note is not offered');
  await page.keyboard.press('Escape');
  await waitForDom(() => !document.getElementById('palette').open);
  for (const title of ['Palette hint from here', 'Palette hint shown']) {
    await clickRow(title);
    await waitForDom((t) => document.getElementById('titleInput').value === t, title);
    await page.keyboard.press('Control+Shift+Delete');
    await waitFor(title + ' trashed', () => findNote(title).trashedAt);
    await page.evaluate((id) => window.notesApi.notes.destroy(id), findNote(title).id);
  }
});

test('the More menu copies the file name or the path of the open note, from the menu and from the palette', async () => {
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  const file = findNote('Gamma (copy)').filePath;
  assert.ok(file, 'the note has a file');
  const readClipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await page.click('#moreBtn');
  await page.waitForSelector('#moreMenu:not(.hidden)');
  assert.equal(await page.isVisible('#copyNameBtn'), true);
  assert.equal(await page.isVisible('#copyPathBtn'), true);
  await page.click('#copyNameBtn');
  await waitFor('file name on the clipboard', async () => (await readClipboard()) === path.basename(file));
  await waitForDom(() => document.getElementById('moreMenu').classList.contains('hidden'));
  assert.equal(await page.$eval('#toast', (t) => t.textContent), 'Copied ' + path.basename(file));

  await page.keyboard.press('Control+p');
  await page.waitForSelector('#palette[open]');
  await page.keyboard.type('>Copy path');
  await page.waitForSelector('.palette-item.is-active:has-text("Copy path")');
  await page.keyboard.press('Enter');
  await waitFor('path on the clipboard', async () => (await readClipboard()) === file);

  const throwaway = await typeNote('Throwaway for copy', 'x');
  await page.keyboard.press('Control+Shift+Delete');
  await waitFor('throwaway trashed', () => findNote('Throwaway for copy').trashedAt);
  await page.click('.nav-item[data-view="trash"]');
  await clickRow('Throwaway for copy');
  await waitForDom(() => document.getElementById('titleInput').value === 'Throwaway for copy');
  await page.click('#moreBtn');
  await page.waitForSelector('#moreMenu:not(.hidden)');
  assert.equal(await page.isVisible('#copyNameBtn'), false, 'no file name to copy for a note in the trash');
  assert.equal(await page.isVisible('#copyPathBtn'), false);
  await page.keyboard.press('Escape');
  await page.evaluate((id) => window.notesApi.notes.destroy(id), throwaway.id);
  await page.click('.nav-item[data-view="all"]');
});

test('live share: the app hosts a note; another participant over HTTP sees edits as they happen and can edit back', { timeout: 60000 }, async () => {
  const http = require('http');
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await fillBody('shared v1');
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
  await waitForDom(() => !!document.querySelector('.note-row.is-active .live-mark'));
  const local = url.replace(/\/\/[\d.]+:/, '//127.0.0.1:');
  const getJson = (u) => new Promise((resolve, reject) => http.get(u, (res) => { let t = ''; res.on('data', (d) => (t += d)); res.on('end', () => { try { resolve(JSON.parse(t)); } catch (e) { reject(e); } }); }).on('error', reject));
  assert.equal((await getJson(local)).body, 'shared v1');
  const events = [];
  const es = await new Promise((resolve, reject) => { const req = http.get(local + '/events', (res) => { res.setEncoding('utf8'); let buf = ''; res.on('data', (ch) => { buf += ch; let i; while ((i = buf.indexOf('\n\n')) !== -1) { const f = buf.slice(0, i); buf = buf.slice(i + 2); const d = f.split('\n').find((l) => l.startsWith('data: ')); if (d) events.push(JSON.parse(d.slice(6))); } }); resolve(req); }); req.on('error', reject); });
  await waitFor('initial state event', () => events.length >= 1);
  await waitForDom(() => /1 person connected/.test(document.getElementById('liveText').textContent));
  await fillBody('shared v2 from app');
  await waitFor('participant got v2', () => events.some((e) => e.body === 'shared v2 from app'), 8000);
  await sleep(1600);
  const post = (u, data) => new Promise((resolve, reject) => { const body = Buffer.from(JSON.stringify(data)); const req = http.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, (res) => { let t = ''; res.on('data', (d) => (t += d)); res.on('end', () => resolve({ status: res.statusCode, text: t })); }); req.on('error', reject); req.end(body); });
  const r = await post(local, { title: 'Gamma (copy)', body: 'shared v3 from the other side', clientId: 'tester' });
  assert.equal(r.status, 200);
  await waitForDomWithin(8000, () => document.getElementById('bodyInput').value === 'shared v3 from the other side');
  await waitFor('stored', () => findNote('Gamma (copy)').body === 'shared v3 from the other side');
  const bad = await new Promise((resolve) => http.get(local.replace(/[0-9a-f]{32}$/, '0'.repeat(32)), (res) => { res.resume(); resolve(res.statusCode); }));
  assert.equal(bad, 404);
  let ended = false; es.on('close', () => { ended = true; }); es.on('response', (res) => res.on('end', () => { ended = true; }));
  await page.click('#liveStopBtn');
  await waitFor('flag cleared', () => !findNote('Gamma (copy)').live);
  await waitForDom(() => document.getElementById('liveRow').classList.contains('hidden'));
  es.destroy();
  assert.equal(findNote('Gamma (copy)').body, 'shared v3 from the other side');
  const before = readNotes().notes.length;
  await page.keyboard.press('Control+Shift+s');
  await page.waitForSelector('#shareMenu:not(.hidden)');
  await page.click('#shareMenu [data-action="live-join"]');
  await page.waitForSelector('#liveDialog[open]');
  await page.fill('#liveLinkInput', local);
  await page.click('#liveSubmitBtn');
  await waitForDomWithin(10000, () => /ECONNREFUSED|refused|HTTP|ended|closed/i.test(document.getElementById('liveError').textContent));
  await page.click('#liveCancelBtn');
  assert.equal(readNotes().notes.length, before, 'no note created for a failed join');
  void id;
  await fillBody('pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('hardening: the page cannot be navigated away, and Open in default app refuses programs', async () => {
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
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await fillBody('İstanbul foo bar foo');
  await waitFor('turkish saved', () => findNote('Gamma (copy)').body === 'İstanbul foo bar foo');
  await page.keyboard.press('Control+h');
  await page.waitForSelector('#replaceRow:not(.hidden)');
  await page.fill('#findInput', 'foo');
  await waitForDom(() => document.getElementById('findCount').textContent === '1/2');
  await page.fill('#replaceInput', 'X');
  await page.click('#replaceAllBtn');
  await waitFor('offsets intact', () => findNote('Gamma (copy)').body === 'İstanbul X bar X');
  await page.keyboard.press('Escape');
  await fillBody('cat sat\ncat ran\ncat hid\n');
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
  await page.keyboard.press('Escape');
  await useSourceMode(false);
  await page.keyboard.press('Control+h');
  await page.waitForSelector('#replaceRow:not(.hidden)');
  await page.fill('#findInput', 'dog');
  await waitForDom(() => document.getElementById('findCount').textContent === '1/3');
  await page.fill('#replaceInput', 'fox');
  await page.click('#replaceAllBtn');
  await waitFor('rendered all replaced', () => findNote('Gamma (copy)').body.replace(/\\\n/g, '\n').replace(/\n$/, '') === 'fox sat\nfox ran\nfox hid', 8000);
  await page.keyboard.press('Escape');
  await useSourceMode(true);
  await fillBody('pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('history: earlier versions are listed and one can be restored', { timeout: 40000 }, async () => {
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await fillBody('version one');
  await waitFor('v1 saved', () => findNote('Gamma (copy)').body === 'version one');
  await waitFor('v1 in the history', () => historyAt('HEAD', 'Gamma (copy).md') === 'version one', 15000);
  await fillBody('version two');
  await waitFor('v2 saved', () => findNote('Gamma (copy)').body === 'version two');
  await sleep(1200);
  await page.keyboard.press('Control+Shift+h');
  await page.waitForSelector('#historyDialog[open]');
  await waitForDomWithin(15000, () => document.querySelectorAll('#historyList li').length >= 1);
  await waitForDom(() => /version one/.test(document.getElementById('historyList').textContent) || /version one/.test(document.getElementById('historyPreview').textContent));
  const items = await page.$$eval('#historyList li', (els) => els.map((e) => e.textContent));
  const idx = items.findIndex((t) => /version one/.test(t));
  await page.click('#historyList li:nth-child(' + (idx + 1) + ')');
  await waitForDom(() => { const p = document.getElementById('historyPreview'); const ins = p.querySelector('ins'), del = p.querySelector('del'); return !!ins && !!del && ins.textContent === 'one' && del.textContent === 'two' && p.textContent === 'version twoone'; });
  assert.equal(await page.$eval('#historyDiffSummary', (e) => e.textContent), '1 word added, 1 removed.');
  await page.keyboard.press('F3');
  assert.equal(await page.evaluate(() => document.getElementById('historyDialog').open), true);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#historyPreview .history-fold').length), 0);
  assert.equal(await page.$eval('#historyCompare', (e) => getComputedStyle(e).display !== 'none'), true);
  await page.selectOption('#historyCompareSelect', 'before');
  await waitForDom(() => { const p = document.getElementById('historyPreview'); const del = p.querySelector('del'); return !!p.querySelector('ins') && (!del || del.textContent !== 'two') && !/two/.test(p.textContent); });
  await page.selectOption('#historyCompareSelect', 'now');
  await waitForDom(() => !!document.querySelector('#historyPreview del'));
  await page.click('#historyRestoreBtn');
  await waitFor('restored', () => findNote('Gamma (copy)').body === 'version one');
  assert.equal(await page.inputValue('#bodyInput'), 'version one');
  await fillBody('pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('attachments and voice memos: files are copied in and linked; links open through the app; note links jump', { timeout: 40000 }, async () => {
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await useSourceMode(true);
  await fillBody('files:');
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
  await useSourceMode(false);
  await page.waitForSelector('.rich-editor-content a[href^="attachment://"]');
  await page.click('.rich-editor-content a[href^="attachment://"]', { modifiers: ['Control'] });
  await waitFor('opened', () => shellCalls().then((s) => s.opened.length === 1 && /attachments[\\/]budget\.csv$/.test(s.opened[0])));
  assert.match(String(await page.evaluate(() => window.notesApi.attachments.open('attachment://..%2F..%2Fnotes.json'))), /Not an attachment|not found/);
  fs.writeFileSync(path.join(dataDir, 'attachments', 'evil.bat'), '@echo off');
  assert.match(String(await page.evaluate(() => window.notesApi.attachments.open('attachment://evil.bat'))), /Shown in Explorer instead/);
  assert.deepEqual((await shellCalls()).shown.map((p) => path.basename(p)), ['evil.bat'], 'shown in Explorer, never run');
  assert.equal((await shellCalls()).opened.length, 1, 'evil.bat was not handed to its default app');
  assert.match(String(await page.evaluate(() => window.notesApi.attachments.open('attachment://evil.bat.'))), /Not an attachment/);
  assert.match(String(await page.evaluate(() => window.notesApi.attachments.open('attachment://evil.bat%3A%3A%24DATA'))), /Not an attachment/);
  await page.keyboard.press('Control+Shift+g');
  await waitForDomWithin(8000, () => document.getElementById('recordBtn').classList.contains('is-recording'));
  await sleep(1200);
  await clickTool('#recordBtn');
  await waitFor('recording saved', () => fs.existsSync(path.join(dataDir, 'attachments')) && fs.readdirSync(path.join(dataDir, 'attachments')).some((f) => /^Recording .*\.webm$/.test(f) && fs.statSync(path.join(dataDir, 'attachments', f)).size > 0), 15000);
  await waitFor('memo linked', () => /🎙 Voice memo \d\d:\d\d\]\(attachment:\/\/Recording/.test(findNote('Gamma (copy)').body));
  const other = readNotes().notes.find((n) => n.title !== 'Gamma (copy)' && !n.trashedAt && n.vaultId === homeVaultId() && !n.lock);
  await useSourceMode(true);
  await fillBody('see also');
  await waitFor('saved2', () => findNote('Gamma (copy)').body === 'see also');
  await useSourceMode(false);
  await page.click('.rich-editor-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#linkDialog[open]');
  await page.fill('#linkInput', deriveTitle(other));
  const otherRow = '#linkResults [role="option"][data-id="' + other.id + '"]';
  await page.waitForSelector(otherRow);
  assert.equal(await page.$$eval('#linkResults [role="option"]', (rows) => rows.length <= 6), true, 'at most six rows');
  await page.click(otherRow);
  await waitFor('note link saved', () => findNote('Gamma (copy)').body === '[see also](note://' + other.id + ')');
  await page.keyboard.press('Control+p');
  await page.waitForSelector('#palette[open]');
  await page.keyboard.type('>Link the selected text');
  await waitForDom(() => { const a = document.querySelector('.palette-item.is-active'); return !!a && a.textContent.includes('Link the selected text'); });
  await page.keyboard.press('Enter');
  await page.waitForSelector('#linkDialog[open]');
  await waitForDom((id) => {
    const active = document.querySelector('#linkResults .inline-item.is-active');
    const input = document.getElementById('linkInput');
    return !!active && active.dataset.id === id && input.getAttribute('aria-activedescendant') === active.id && !document.getElementById('linkRemoveBtn').classList.contains('hidden');
  }, other.id);
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(() => { const rows = document.querySelectorAll('#linkResults [role="option"]'); return rows[rows.length - 1].classList.contains('is-active'); }), true, 'Up from the first row wraps to the last');
  await page.fill('#linkInput', 'qqqq-no-such-note');
  await waitForDom(() => document.getElementById('linkEmpty').textContent.startsWith('No notes match') && document.getElementById('linkApplyBtn').disabled);
  await page.keyboard.press('Escape');
  await waitForDom(() => !document.getElementById('linkDialog').open);
  assert.equal(findNote('Gamma (copy)').body, '[see also](note://' + other.id + ')', 'closing without applying keeps the link');
  await page.click('.rich-editor-content a[href^="note://"]', { modifiers: ['Control'] });
  await waitForDom((id) => !!document.querySelector('.note-row.is-active[data-id="' + id + '"]'), other.id);
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await page.click('.rich-editor-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#linkDialog[open]');
  await waitForDom(() => !document.getElementById('linkRemoveBtn').classList.contains('hidden'));
  await page.click('#linkRemoveBtn');
  await waitFor('link removed', () => findNote('Gamma (copy)').body === 'see also');
  await useSourceMode(true);
  await fillBody('[kept](foo.com)');
  await waitFor('a link without a scheme saved', () => findNote('Gamma (copy)').body === '[kept](foo.com)');
  await useSourceMode(false);
  await page.click('.rich-editor-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#linkDialog[open]');
  await sleep(400);
  assert.deepEqual(await page.evaluate(() => { const a = document.querySelector('#linkResults .is-active'); return a && [a.querySelector('.lbl').textContent, a.querySelector('.keys').textContent]; }), ['foo.com', 'Current link'], 'the link as written stays chosen after the notes load');
  await page.keyboard.press('Enter');
  await waitForDom(() => !document.getElementById('linkDialog').open);
  await sleep(300);
  assert.equal(findNote('Gamma (copy)').body, '[kept](foo.com)', 'Enter keeps it as written');
  await useSourceMode(true);
  await fillBody('pure text');
  await waitFor('body restored', () => findNote('Gamma (copy)').body === 'pure text');
});

test('zoom: Ctrl+= zooms in, Ctrl+- out, Ctrl+0 resets, and the level is remembered; right-click shows a menu', async () => {
  const level = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel());
  const realKey = (k) => app.evaluate(({ BrowserWindow }, keyCode) => { const wc = BrowserWindow.getAllWindows()[0].webContents; wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] }); }, k);
  await clickRow("Gamma (copy)");
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
  await app.evaluate(({ Menu }) => { global.__menus = []; const orig = Menu.prototype.popup; Menu.prototype.popup = function () { global.__menus.push(this.items.map((i) => i.label).filter(Boolean)); }; global.__restorePopup = () => { Menu.prototype.popup = orig; }; });
  await useSourceMode(true);
  await clickBody({ button: 'right' });
  await waitFor('menu shown', () => app.evaluate(() => global.__menus.length).then((n) => n >= 1));
  const labels = await app.evaluate(() => global.__menus[global.__menus.length - 1]);
  for (const l of ['Cut', 'Copy', 'Paste', 'Select all', 'Zoom in']) assert.ok(labels.includes(l), 'menu has ' + l + ': ' + labels.join(', '));
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
  await waitForDom(() => document.querySelectorAll('.note-row').length === 3 && /p\. 1/.test(document.querySelector('.note-row').textContent));
  const order = () => page.$$eval('.note-row', (els) => els.map((e) => e.querySelector('.row-name').textContent.replace(/^p\. \d+/, '').trim()));
  assert.deepEqual(await order(), ['Chapter 1', 'Chapter 2', 'Chapter 3'], 'reading order = creation order');
  await clickRowById(one.id);
  await page.waitForSelector('#bookStrip:not(.hidden)');
  await waitForDom(() => document.querySelectorAll('#bookTabs .book-tab').length === 3);
  assert.equal(await page.textContent('#bookName'), 'Novel');
  assert.equal(await page.evaluate(() => document.getElementById('bookPrevBtn').disabled), true);
  await page.click('#bookNextBtn');
  await waitForDom((id) => document.querySelector('#bookTabs .book-tab.is-active') && document.querySelector('#bookTabs .book-tab.is-active').dataset.id === id, two.id);
  await page.keyboard.press('Control+PageDown');
  await waitForDom((id) => document.getElementById('titleInput').value === 'Chapter 3', three.id);
  assert.equal(await page.evaluate(() => document.getElementById('bookNextBtn').disabled), true);
  await page.keyboard.press('Control+PageUp');
  await waitForDom(() => document.getElementById('titleInput').value === 'Chapter 2');
  await page.click('#bookTabs .book-tab[data-id="' + one.id + '"]');
  await waitForDom(() => document.getElementById('titleInput').value === 'Chapter 1');
  await page.evaluate(([f, ids]) => window.notesApi.folders.reorderPages(f, ids), [folder.id, [three.id, one.id, two.id]]);
  await page.click('.folder-row[data-id="' + folder.id + '"]');
  await waitForDom(() => /Chapter 3/.test(document.querySelector('.note-row').textContent));
  assert.deepEqual(await order(), ['Chapter 3', 'Chapter 1', 'Chapter 2']);
  await clickRowById(one.id);
  await waitForDom(() => document.querySelectorAll('#bookTabs .book-tab').length === 3);
  await page.dragAndDrop('#bookTabs .book-tab[data-id="' + two.id + '"]', '#bookTabs .book-tab[data-id="' + three.id + '"]');
  await waitFor('dragged order saved', () => JSON.stringify(readNotes().folders.find((f) => f.id === folder.id).pageOrder) === JSON.stringify([two.id, three.id, one.id]), 8000);
  await page.click('#bookAddBtn');
  await waitFor('page added', () => readNotes().notes.filter((n) => n.folderId === folder.id && !n.trashedAt).length === 4);
  await waitForDom(() => document.querySelectorAll('#bookTabs .book-tab').length === 4 && document.querySelector('#bookTabs .book-tab:last-child').classList.contains('is-active'));
  await page.fill('#titleInput', 'Epilogue');
  await waitFor('epilogue saved', () => readNotes().notes.some((n) => n.title === 'Epilogue' && n.folderId === folder.id));
  await page.evaluate(([id, target]) => window.notesApi.notes.update(id, { body: 'see [next](note://' + target + ')', tags: 'novel' }), [one.id, two.id]);
  await page.evaluate((id) => window.notesApi.notes.update(id, { tags: 'novel' }), three.id);
  await page.click('#bookTabs .book-tab[data-id="' + two.id + '"]');
  await waitForDom(() => document.getElementById('titleInput').value === 'Chapter 2');
  await waitForDomWithin(8000, () => !document.getElementById('relatedIn').classList.contains('hidden') && /Chapter 1/.test(document.getElementById('relatedIn').textContent));
  await page.click('#bookTabs .book-tab[data-id="' + one.id + '"]');
  await waitForDom(() => document.getElementById('titleInput').value === 'Chapter 1');
  await waitForDomWithin(8000, () => /Chapter 2/.test(document.getElementById('relatedOut').textContent) && /Chapter 3/.test(document.getElementById('relatedTags').textContent));
  await page.click('#relatedOut button');
  await waitForDom(() => document.getElementById('titleInput').value === 'Chapter 2');
  await page.click('.folder-row[data-id="' + folder.id + '"]', { button: 'right' });
  await waitForDom(() => document.getElementById('folderMenuBook').textContent === 'Turn back into a folder');
  await page.click('#folderMenuBook');
  await waitFor('book off', () => readNotes().folders.find((f) => f.id === folder.id).book === false);
  await clickRowById(one.id);
  await waitForDom(() => document.getElementById('bookStrip').classList.contains('hidden'));
  await page.click('.nav-item[data-view="all"]');
});

test('speech: read aloud speaks the note and stops; dictation hands off to Windows', async () => {
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  const voices = await page.evaluate(() => (window.speechSynthesis ? window.speechSynthesis.getVoices().length : -1));
  assert.ok(voices >= 0, 'speechSynthesis exists');
  await clickTool('#readAloudBtn');
  await waitForDom(() => document.getElementById('readAloudBtn').classList.contains('is-on'));
  assert.equal(await page.evaluate(() => window.speechSynthesis.speaking || window.speechSynthesis.pending), false, 'dry run: nothing spoken');
  await clickTool('#readAloudBtn');
  await waitForDom(() => !document.getElementById('readAloudBtn').classList.contains('is-on'));
  assert.equal(await page.evaluate(() => window.speechSynthesis.speaking), false);
  await page.keyboard.press('Control+Shift+r');
  await waitForDom(() => document.getElementById('readAloudBtn').classList.contains('is-on'));
  await page.keyboard.press('Control+Shift+r');
  await waitForDom(() => !document.getElementById('readAloudBtn').classList.contains('is-on'));

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await page.$eval('#ttsRateInput', (i) => { i.value = '1.4'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  const options = await page.$$eval('#ttsVoiceSelect option', (o) => o.map((x) => x.value));
  if (options.length > 1) await page.selectOption('#ttsVoiceSelect', options[1]);
  assert.notEqual(readNotes().settings.ttsRate, 1.4, 'not written before Save');
  await page.click('#saveSettingsBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await waitFor('rate persisted', () => readNotes().settings.ttsRate === 1.4);
  if (options.length > 1) await waitFor('voice persisted', () => readNotes().settings.ttsVoice === options[1]);

  const res = await page.evaluate(() => window.notesApi.app.dictate());
  assert.deepEqual(res, { ok: true, method: 'windows-dictation', dryRun: true });
});

test('writing column: alignment and width settings move and size the block', async () => {
  const col = () => page.evaluate(() => {
    const c = document.getElementById('editorColumn');
    const cs = getComputedStyle(c);
    return { cls: c.className, width: c.getBoundingClientRect().width, left: c.getBoundingClientRect().left,
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
  await waitForDom(() => getComputedStyle(document.getElementById('editorColumn')).maxWidth === '760px');
  assert.equal(readNotes().settings.editorWidth, 0, 'previewed, not written yet');
  await page.click('#alignSeg button[data-align="center"]');
  const centered = await col();
  assert.match(centered.cls, /align-center/);
  const leftGap = centered.left - centered.paneLeft;
  const rightGap = centered.paneLeft + centered.paneWidth - (centered.left + centered.width);
  assert.ok(Math.abs(leftGap - rightGap) < 2, 'centered within the pane: ' + leftGap + ' vs ' + rightGap);

  await page.click('#alignSeg button[data-align="right"]');
  await waitForDom(() => /align-right/.test(document.getElementById('editorColumn').className));
  const righted = await col();
  assert.ok(righted.paneLeft + righted.paneWidth - (righted.left + righted.width) < 2, 'flush right');

  await page.$eval('#editorWidthInput', (i) => { i.value = '600'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitForDom(() => getComputedStyle(document.getElementById('editorColumn')).maxWidth === '600px');
  await page.click('#saveSettingsBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await waitFor('width and alignment persisted', () => readNotes().settings.editorWidth === 600 && readNotes().settings.editorAlign === 'right');
  assert.equal((await col()).maxWidth, '600px', 'what was saved stays on the page');

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await page.check('#editorFullWidthInput');
  await waitForDom(() => /full-width/.test(document.getElementById('editorColumn').className));
  assert.equal(await page.$eval('#editorWidthInput', (i) => i.disabled), true);
  await page.click('#alignSeg button[data-align="center"]');
  await page.click('#saveSettingsBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await waitFor('restored', () => readNotes().settings.editorAlign === 'center' && readNotes().settings.editorWidth === 0);
});

test('git history: edits are committed to a repo in the data folder', async () => {
  const { execFileSync } = require('child_process');
  const repoDir = path.join(dataDir, 'history');
  const count = () => { try { return parseInt(execFileSync('git', ['-C', repoDir, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim(), 10) || 0; } catch (_) { return 0; } };
  await useSourceMode(true);
  await waitFor('at least one commit exists', () => count() >= 1, 10000);
  const before = count();
  await fillBody('committed text ' + Date.now());
  await waitFor('new commit after an edit', () => count() > before, 10000);
  const tracked = execFileSync('git', ['-C', repoDir, 'ls-files'], { encoding: 'utf8' }).trim().split('\n').sort();
  assert.ok(tracked.includes('Gamma (copy).md') && !tracked.includes('notes.json'), 'the notes folder\'s files are tracked, not notes.json: ' + tracked.join(', '));
  assert.equal(fs.existsSync(path.join(dataDir, '.git')), false, 'the data folder itself is not a repo');

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await waitForDom(() => /version/.test(document.getElementById('gitStatus').textContent));
  assert.equal(await page.$eval('#gitPushBtn', (b) => b.disabled), true, 'push disabled without a remote');
  await waitForDom(() => document.getElementById('toast').classList.contains('hidden'));
  await page.click('#gitCommitBtn');
  await waitForDom(() => !document.getElementById('toast').classList.contains('hidden') && /Saved a version|Nothing new to save|could not/.test(document.getElementById('toast').textContent));
  assert.match(await page.textContent('#toast'), /Saved a version|Nothing new to save/);
  assert.equal(await page.$eval('#saveSettingsBtn', (b) => b.disabled), true, 'nothing to save');
  await page.keyboard.press('Escape');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
});

test('Alt+Arrow moves between notes', async () => {
  await page.click('.note-row >> nth=0');
  const first = await page.inputValue('#titleInput');
  await focusBody();
  await page.keyboard.press('Alt+ArrowDown');
  await waitForDom((f) => document.getElementById('titleInput').value !== f, first);
  const second = await page.inputValue('#titleInput');
  await page.keyboard.press('Alt+ArrowUp');
  await waitForDom((f) => document.getElementById('titleInput').value === f, first);
  assert.notEqual(first, second);
});

test('trash with undo, restore, delete forever, empty trash', async () => {
  await clickRow("Gamma (copy)");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');
  await clickTool('#deleteBtn');
  await waitFor('trashed', () => findNote('Gamma (copy)').trashedAt);
  await page.click('#toast button:has-text("Undo")');
  await waitFor('undo restored', () => !findNote('Gamma (copy)').trashedAt);
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma (copy)');

  await page.keyboard.press('Control+Shift+Delete');
  await waitFor('trashed again', () => findNote('Gamma (copy)').trashedAt);
  await page.click('.nav-item[data-view="trash"]');
  await waitForDom(() => document.querySelectorAll('.note-row').length === 1);
  assert.equal(await page.textContent('#listTitle'), 'Trash');
  assert.equal(await page.$eval('#titleInput', (i) => i.readOnly), true, 'trashed note is read only');
  assert.equal(await page.$eval('#restoreBtn', (b) => b.classList.contains('hidden')), false);
  await page.click('#restoreBtn');
  await waitFor('restored', () => !findNote('Gamma (copy)').trashedAt);
  await waitForDom(() => document.querySelectorAll('.note-row').length === 0);

  await page.click('.nav-item[data-view="all"]');
  await clickRow("Gamma (copy)");
  await clickTool('#deleteBtn');
  await page.click('.nav-item[data-view="trash"]');
  await clickRow("Gamma (copy)");
  await page.click('#destroyBtn');
  await waitFor('destroyed', () => !findNote('Gamma (copy)'));

  await page.click('.nav-item[data-view="all"]');
  await clickRow("Beta");
  await clickTool('#deleteBtn');
  await page.click('.nav-item[data-view="trash"]');
  await page.waitForSelector('#emptyTrashBtn:not(.hidden)');
  await page.click('#emptyTrashBtn');
  await waitFor('trash emptied', () => !findNote('Beta'));
  assert.equal(await page.textContent('#countTrash'), '0');
  await page.click('.nav-item[data-view="all"]');
});

test('settings: Keep Notes up to date is on by default, saves off, and Check for updates reports the harness mode', async () => {
  assert.equal(readNotes().settings.autoUpdate, true);
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  assert.equal(await page.isChecked('#autoUpdateInput'), true);
  await page.uncheck('#autoUpdateInput');
  assert.equal(await page.textContent('#settingsDirtyNote'), 'Unsaved changes');
  await page.mouse.click(8, 8);
  await page.waitForSelector('#settingsSaveDialog[open]');
  assert.match(await page.textContent('#settingsSaveList'), /Keep Notes up to date/);
  await page.click('#settingsSaveYesBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await waitFor('auto-update off', () => readNotes().settings.autoUpdate === false);

  await page.keyboard.press('Control+p');
  await page.keyboard.type('>Check for updates');
  await waitForDom(() => !!document.querySelector('.palette-item.is-active') && /Check for updates/.test(document.querySelector('.palette-item.is-active').textContent));
  await page.keyboard.press('Enter');
  await waitForDom(() => /does not update itself/.test(document.getElementById('toast').textContent));
  assert.equal(await page.evaluate(() => window.notesApi.app.updateStatus().then((s) => s.state)), 'off');

  await page.keyboard.press('Control+p');
  await page.keyboard.type('>Update and restart Notes');
  await sleep(300);
  assert.equal(await page.$('.palette-item.is-active:has-text("Update and restart Notes")'), null, 'not offered while no update is pending');
  await page.keyboard.press('Escape');
  await waitForDom(() => !document.getElementById('palette').open);

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await page.check('#autoUpdateInput');
  await page.click('#saveSettingsBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await waitFor('auto-update back on', () => readNotes().settings.autoUpdate === true);
});

test('settings: changes preview on the page and are written by Save changes; theme, font size, always on top, hotkey', async () => {
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  assert.equal(await page.$eval('#saveSettingsBtn', (b) => b.disabled), true, 'nothing to save yet');

  await page.selectOption('#themeSelect', 'dark');
  await waitForDom(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(readNotes().settings.theme, 'light', 'previewed, not written');
  assert.equal(await page.$eval('#saveSettingsBtn', (b) => b.disabled), false);
  assert.equal(await page.textContent('#settingsDirtyNote'), 'Unsaved changes');

  await page.$eval('#fontSizeInput', (i) => { i.value = '20'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--editor-font-size').trim()), '20px');

  await page.check('#alwaysOnTopInput');

  await page.focus('#hotkeyInput');
  await page.keyboard.press('Control+Alt+F10');
  assert.equal(await page.textContent('#hotkeyError'), '');
  assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+F10')), false, 'bound on Save, not before');

  await page.click('#saveSettingsBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await waitFor('everything persisted', () => { const t = readNotes().settings; return t.theme === 'dark' && t.fontSize === 20 && t.alwaysOnTop === true && t.hotkey === 'Control+Alt+F10'; });
  await waitFor('hotkey re-registered', () => app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+F10')));
  assert.equal(await page.textContent('#hotkeyHint'), 'Ctrl + Alt + F10');
  console.log('  [settings] OS reports alwaysOnTop =', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()));

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await page.uncheck('#alwaysOnTopInput');
  await page.selectOption('#themeSelect', 'light');
  await waitForDom(() => document.documentElement.dataset.theme === 'light');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#settingsSaveDialog[open]');
  await page.click('#settingsSaveKeepBtn');
  await waitForDom(() => !document.getElementById('settingsSaveDialog').open && document.getElementById('settingsDialog').open);
  await page.click('#cancelSettingsBtn');
  await page.waitForSelector('#settingsSaveDialog[open]');
  await page.click('#settingsSaveDiscardBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await waitForDom(() => document.documentElement.dataset.theme === 'dark');
  await sleep(300);
  assert.equal(readNotes().settings.theme, 'dark', 'discarded');
  assert.equal(readNotes().settings.alwaysOnTop, true, 'discarded');

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await page.uncheck('#alwaysOnTopInput');
  await page.mouse.click(8, 8);
  await page.waitForSelector('#settingsSaveDialog[open]');
  assert.match(await page.textContent('#settingsSaveList'), /Keep above other windows/);
  await page.click('#settingsSaveYesBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await waitFor('always on top cleared', () => readNotes().settings.alwaysOnTop === false);
  await waitForDom(() => /Settings saved/.test(document.getElementById('toast').textContent));

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  assert.equal(await page.textContent('#cancelSettingsBtn'), 'Close', 'nothing to cancel');
  await page.mouse.click(8, 8);
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  assert.equal(await page.evaluate(() => document.getElementById('settingsSaveDialog').open), false);

  const accent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  const builtInAccent = await accent();
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  assert.equal(await page.$eval('.scheme-swatch[data-scheme="notes"]', (b) => b.getAttribute('aria-checked')), 'true');
  await page.click('.scheme-swatch[data-scheme="slate"]');
  await waitForDom(() => document.querySelector('.scheme-swatch[data-scheme="slate"]').getAttribute('aria-checked') === 'true');
  assert.notEqual(await accent(), builtInAccent, 'previewed on the page');
  assert.equal(readNotes().settings.colorScheme, 'notes', 'not written before Save');
  await page.click('#saveSettingsBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await waitFor('scheme persisted', () => readNotes().settings.colorScheme === 'slate');

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await page.keyboard.press('Escape');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  assert.equal(await page.$eval('.scheme-swatch[data-scheme="custom"] .swatch-sample', (s) => s.style.background), await page.$eval('.scheme-swatch[data-scheme="slate"] .swatch-sample', (s) => s.style.background), 'with nothing picked, Custom shows the chosen scheme as its start');
  await page.$eval('#customAccentInput', (i) => { i.value = '#aa0000'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await waitForDom(() => document.querySelector('.scheme-swatch[data-scheme="custom"]').getAttribute('aria-checked') === 'true');
  assert.equal(await accent(), '#aa0000');
  await page.click('#saveSettingsBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await waitFor('custom persisted', () => readNotes().settings.colorScheme === 'custom' && readNotes().settings.customColors.dark.accent === '#aa0000');

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await page.click('#schemeResetBtn');
  await waitForDom(() => document.querySelector('.scheme-swatch[data-scheme="notes"]').getAttribute('aria-checked') === 'true');
  assert.equal(await accent(), builtInAccent);
  await page.click('#saveSettingsBtn');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
  await waitFor('reset persisted', () => readNotes().settings.colorScheme === 'notes' && readNotes().settings.customColors === null);
  await page.click('#toggleSidebarBtn');
  await waitForDom(() => document.getElementById('app').classList.contains('sidebar-collapsed'));
  await page.keyboard.press('Control+\\');
  await waitForDom(() => !document.getElementById('app').classList.contains('sidebar-collapsed'));
  await page.keyboard.press('Control+Shift+l');
  await waitForDom(() => document.documentElement.dataset.theme === 'light');
});

const isPeeking = () => page.evaluate(() => document.getElementById('app').classList.contains('sidebar-peek'));
const isSidebarCollapsed = () => page.evaluate(() => document.getElementById('app').classList.contains('sidebar-collapsed'));
const togglesInSidebarHeader = () => page.evaluate(() => {
  const header = document.querySelector('#sidebar .sidebar-top');
  return ['toggleSidebarBtn', 'toggleListBtn'].every((id) => header.contains(document.getElementById(id)));
});
const togglesInsideSidebar = () => page.evaluate(() => {
  const s = document.getElementById('sidebar').getBoundingClientRect();
  return ['toggleSidebarBtn', 'toggleListBtn'].every((id) => {
    const b = document.getElementById(id).getBoundingClientRect();
    return b.width >= 24 && b.left >= s.left && b.top >= s.top && b.right <= s.right && b.bottom <= s.bottom;
  });
});

test('hidden sidebar: the pointer within 24px of the left edge floats it in, further away sends it off', async () => {
  await page.mouse.move(600, 400);
  await page.click('#toggleSidebarBtn');
  await waitFor('sidebar hidden', isSidebarCollapsed);
  try {
    await page.mouse.move(600, 400);
    await sleep(500);
    assert.equal(await isPeeking(), false, 'hidden while the pointer is far from the edge');
    await page.mouse.move(30, 400);
    await sleep(500);
    assert.equal(await isPeeking(), false, 'still hidden 30px from the edge');
    await page.mouse.move(20, 400);
    await waitFor('sidebar floats in from 20px', isPeeking);
    await page.mouse.move(600, 400);
    await waitFor('sidebar goes away', async () => !(await isPeeking()));
    await page.mouse.move(2, 400);
    await waitFor('sidebar floats in from the edge itself', isPeeking);
    await page.mouse.move(600, 400);
    await waitFor('sidebar goes away again', async () => !(await isPeeking()));
  } finally {
    await page.keyboard.press('Control+\\');
    await waitFor('sidebar docked', async () => !(await isSidebarCollapsed()));
  }
});

test('hidden sidebar: no rail and nothing in the tab bar; the toggles stay in its header and work from the floating sidebar', async () => {
  if (await page.isHidden('#editor')) await page.click('.note-row >> nth=0');
  await waitForDom(() => !document.getElementById('editor').classList.contains('hidden'));
  assert.equal(await togglesInSidebarHeader(), true, 'docked: the toggles are in the sidebar header');
  await page.mouse.move(600, 400);
  await page.click('#toggleSidebarBtn');
  await waitFor('sidebar hidden', isSidebarCollapsed);
  await waitFor('hidden state saved', () => readNotes().settings.sidebarCollapsed === true);
  try {
    await page.mouse.move(600, 400);
    await waitFor('the toggles hide with the sidebar', async () => !(await page.isVisible('#toggleSidebarBtn')));
    const hidden = await page.evaluate(() => ({
      rail: !!document.querySelector('#sidebarRail, .sidebar-rail'),
      inTabBar: !!document.querySelector('.tab-bar #toggleSidebarBtn, .tab-bar #toggleListBtn, .tab-bar .bar-toggles'),
      listLeft: Math.round(document.querySelector('.list-pane').getBoundingClientRect().left),
    }));
    assert.deepEqual(hidden, { rail: false, inTabBar: false, listLeft: 0 });
    const edge = await page.evaluate(() => { const strip = document.getElementById('sidebarEdge'); const app = document.getElementById('app'); return { region: getComputedStyle(strip).getPropertyValue('-webkit-app-region'), last: app.lastElementChild === strip, width: strip.getBoundingClientRect().width }; });
    assert.deepEqual(edge, { region: 'no-drag', last: true, width: 8 }, 'the edge strip is not a drag area and comes after the bars, so the top band still reaches the hover');
    assert.equal(await togglesInSidebarHeader(), true, 'hidden: the toggles stay in the sidebar header');
    assert.equal(await page.isVisible('#toggleListBtn'), false);

    await page.mouse.move(2, 400);
    await waitFor('sidebar floats in', isPeeking);
    await waitFor('the toggles show in the floating sidebar', async () => (await page.isVisible('#toggleSidebarBtn')) && (await page.isVisible('#toggleListBtn')));
    await waitFor('both toggles sit inside the floating sidebar', togglesInsideSidebar);
    const header = await page.evaluate(() => { const top = document.querySelector('#sidebar .sidebar-top'); const r = top.getBoundingClientRect(); return { region: getComputedStyle(top).getPropertyValue('-webkit-app-region'), x: r.right - 12, y: r.top + r.height / 2 }; });
    assert.equal(header.region, 'no-drag', 'the floating header is not a window drag area, so the pointer on it keeps the sidebar out');
    await page.mouse.move(header.x, header.y);
    await sleep(700);
    assert.equal(await isPeeking(), true, 'the pointer on the header keeps the sidebar out');
    assert.equal(await page.getAttribute('#toggleSidebarBtn', 'title'), 'Keep the sidebar open (Ctrl+\\)');

    const listShown = () => page.evaluate(() => getComputedStyle(document.querySelector('.list-pane')).display !== 'none');
    await page.click('#toggleListBtn');
    await waitFor('list hidden from the floating sidebar', async () => !(await listShown()));
    assert.equal(await isPeeking(), true, 'the sidebar stays out after the list toggle');
    await page.click('#toggleListBtn');
    await waitFor('list shown again', listShown);
    await waitFor('list state saved', () => readNotes().settings.listCollapsed === false);
    assert.equal(await isPeeking(), true);

    await page.click('#toggleSidebarBtn');
    await waitFor('sidebar docked from its own toggle', async () => !(await isSidebarCollapsed()));
    await waitFor('docked state saved', () => readNotes().settings.sidebarCollapsed === false);
    assert.equal(await isPeeking(), false);
    await waitFor('docked again: the toggles are in the sidebar', togglesInsideSidebar);
    const docked = await page.evaluate(() => getComputedStyle(document.querySelector('#sidebar .sidebar-top')).getPropertyValue('-webkit-app-region'));
    assert.equal(docked, 'drag', 'docked, the header still drags the window');
  } finally {
    if (await isSidebarCollapsed()) {
      await page.keyboard.press('Control+\\');
      await waitFor('sidebar docked', async () => !(await isSidebarCollapsed()));
    }
  }
});

test('narrow window: the floating sidebar keeps its toggles, and its sidebar toggle sends it away', async () => {
  await page.mouse.move(600, 300);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 640));
  try {
    await waitFor('sidebar floats below 1000px', isSidebarCollapsed);
    assert.equal(readNotes().settings.sidebarCollapsed, false, 'a narrow window leaves the saved choice alone');
    await waitFor('the toggles hide with the sidebar', async () => !(await page.isVisible('#toggleSidebarBtn')));
    assert.equal(await isPeeking(), false);
    await page.mouse.move(2, 300);
    await waitFor('sidebar floats in', isPeeking);
    await waitFor('the toggles show', () => page.isVisible('#toggleSidebarBtn'));
    await waitFor('the toggles sit inside the floating sidebar', togglesInsideSidebar);
    assert.equal(await page.getAttribute('#toggleSidebarBtn', 'title'), 'Hide the sidebar (Ctrl+\\)');
    await page.click('#toggleSidebarBtn');
    await waitFor('the sidebar goes away', async () => !(await isPeeking()));
    assert.equal(await isSidebarCollapsed(), true, 'still floating: the window is narrow');
    assert.equal(readNotes().settings.sidebarCollapsed, false);
  } finally {
    await page.mouse.move(600, 300);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
    await waitFor('sidebar docked when wide again', async () => !(await isSidebarCollapsed()));
  }
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

  await clickRow("Alpha");
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
  assert.equal(imported.body, '---\ntags:\n  - inbox\n---\nhello from disk');
  assert.equal(fs.readFileSync(imported.filePath, 'utf8'), imported.body, 'the imported note is a file with its tags in front matter');
  assert.deepEqual(imported.tags, ['inbox']);
});

test('folders: create, nest, new note inside, move via select and drag, counts, collapse, rename, reparent, delete, persist', async () => {
  const step = (s) => console.log('  [folders] ' + s);
  const folders = () => readNotes().folders;
  const folderByName = (name) => folders().find((f) => f.name === name);
  const row = (name) => `.folder-row:has(.row-name:text-is("${name}"))`;
  const waitForCount = (name, count) => waitForDom(([n, c]) => {
    const r = Array.from(document.querySelectorAll('.folder-row')).find((x) => { const nm = x.querySelector('.row-name'); return nm && nm.textContent === n; });
    return !!r && r.querySelector('.count').textContent === String(c);
  }, [name, count]);

  await page.click('#newFolderBtn');
  await page.waitForSelector('#folderTree .folder-input');
  await page.keyboard.type('Work');
  await page.keyboard.press('Enter');
  await page.waitForSelector(row('Work') + '.is-active');
  await waitFor('Work folder saved', () => folderByName('Work'));
  assert.equal(await page.textContent('#listTitle'), 'Work');
  assert.equal(await page.$$eval('.note-row', (c) => c.length), 0, 'new folder is empty');
  step('created root folder');

  await page.keyboard.press('Control+n');
  await waitForDom(() => document.activeElement && document.activeElement.id === 'titleInput');
  await page.fill('#titleInput', 'In Work');
  await waitFor('note created in folder', () => { const n = findNote('In Work'); return n && n.folderId === folderByName('Work').id; });
  assert.equal(await page.$$eval('.note-row', (c) => c.length), 1);
  step('new note inside folder');

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

  await page.click('.nav-item[data-view="all"]');
  await clickRow("Gamma");
  await waitForDom(() => document.getElementById('titleInput').value === 'Gamma');
  await page.selectOption('#folderSelect', folderByName('Clients').id);
  await waitFor('Gamma moved to Clients', () => findNote('Gamma').folderId === folderByName('Clients').id);
  step('moved via select');

  const crumbShows = () => page.evaluate(() => { const s = document.getElementById('folderSelect'); return { shown: s.querySelector('selectedcontent').textContent, chosen: s.selectedOptions[0].textContent }; });
  await waitForDom(() => document.querySelector('#folderSelect selectedcontent').textContent === 'Work / Clients');
  await clickRow('Imported note');
  await waitForDom(() => document.getElementById('titleInput').value !== 'Gamma');
  const crumb = await crumbShows();
  assert.equal(crumb.shown, crumb.chosen);
  assert.notEqual(crumb.shown, 'Work / Clients');
  step('the crumb follows the open note');

  await page.dragAndDrop('.note-row:has-text("Imported note")', row('Work'), { timeout: 8000 });
  await waitFor('Imported note dragged into Work', () => findNote('Imported note').folderId === folderByName('Work').id);
  step('moved via drag');

  await waitForCount('Work', 2);
  await waitForCount('Clients', 1);
  step('recursive count');

  await page.click(row('Work') + ' .folder-chevron', { timeout: 8000 });
  await waitForDom(() => !Array.from(document.querySelectorAll('.row-name')).some((n) => n.textContent === 'Clients'));
  assert.deepEqual(readNotes().settings.expandedFolders, []);
  await page.click(row('Work') + ' .folder-chevron', { timeout: 8000 });
  await page.waitForSelector(row('Clients'), { timeout: 8000 });
  assert.deepEqual(readNotes().settings.expandedFolders, [folderByName('Work').id]);
  step('collapse/expand');

  await page.dblclick(row('Clients') + ' .row-name', { timeout: 8000 });
  await page.waitForSelector('#folderTree .folder-input', { timeout: 8000 });
  await page.fill('#folderTree .folder-input', 'Customers');
  await page.keyboard.press('Enter');
  await page.waitForSelector(row('Customers'), { timeout: 8000 });
  await waitFor('renamed on disk', () => folderByName('Customers') && !folderByName('Clients'));
  step('renamed');

  await page.dragAndDrop(row('Customers'), '.nav-item[data-view="all"]', { timeout: 8000 });
  await waitFor('Customers is top level', () => folderByName('Customers').parentId === null);
  await page.dragAndDrop(row('Customers'), row('Work'), { timeout: 8000 });
  await waitFor('Customers back under Work', () => folderByName('Customers').parentId === folderByName('Work').id);
  await page.dragAndDrop(row('Work'), row('Customers'), { timeout: 8000 });
  await sleep(300);
  assert.equal(folderByName('Work').parentId, null, 'cycle refused');
  step('reparented');

  await page.click(row('Work'), { timeout: 8000 });
  await page.fill('#searchInput', 'Alpha');
  await page.waitForSelector('.note-row:has-text("Alpha")', { timeout: 8000 });
  await page.fill('#searchInput', '');
  await waitForDom(() => document.querySelectorAll('.note-row').length === 2);
  step('global search from folder');

  await page.hover(row('Customers'), { timeout: 8000 });
  await page.click(row('Customers') + ' .folder-menu-btn', { timeout: 8000, force: true });
  await page.waitForSelector('#folderMenu:not(.hidden)', { timeout: 8000 });
  await page.click('#folderMenu button[data-action="delete"]', { timeout: 8000 });
  await waitFor('Customers deleted', () => !folderByName('Customers'));
  assert.equal(findNote('Gamma').folderId, folderByName('Work').id, 'Gamma lifted into Work');
  await waitForCount('Work', 3);

  await page.click('.nav-item[data-view="all"]');
  for (const t of ['In Work', 'Imported note']) {
    await clickRow(t);
    await waitForDom((x) => document.getElementById('titleInput').value === x, t);
    await page.keyboard.press('Control+Shift+Delete');
    await waitFor(t + ' trashed', () => findNote(t).trashedAt);
  }
  await page.click('.nav-item[data-view="trash"]');
  await page.fill('#searchInput', 'Imported');
  await waitForDom(() => document.querySelectorAll('.note-row').length === 1);
  await page.click('#emptyTrashBtn');
  await waitFor('only the searched note destroyed', () => !findNote('Imported note'));
  assert.ok(findNote('In Work') && findNote('In Work').trashedAt, 'the other trashed note survives');
  await page.fill('#searchInput', '');
  await clickRow("In Work");
  await page.click('#restoreBtn');
  await waitFor('In Work restored', () => !findNote('In Work').trashedAt);
  await page.click('.nav-item[data-view="all"]');
  await waitForCount('Work', 2);
  step('deleted folder');

  await page.reload({ timeout: 8000 });
  await page.waitForSelector(row('Work'), { timeout: 8000 });
  await page.click('.nav-item[data-view="all"]', { timeout: 8000 });
  await waitForDom(() => document.querySelectorAll('.note-row').length >= 3);
  step('persisted across reload');
});

test('the folder view shows ten notes of a long folder and a "See N more" row; it opens the rest by click or Enter and closes with the folder', async () => {
  const folderId = (await page.evaluate(() => window.notesApi.folders.create({ name: 'Long folder' }))).id;
  const ids = [];
  for (let i = 1; i <= 12; i++) ids.push((await page.evaluate(([f, n]) => window.notesApi.notes.create({ title: 'Entry ' + n, body: 'Line ' + n, folderId: f }), [folderId, i])).id);
  await page.click('.nav-item[data-view="all"]');
  const wasTree = await page.$eval('#listModeSeg button[data-mode="tree"]', (b) => b.classList.contains('is-on'));
  const folderRow = `.note-tree .tree-folder[data-id="${folderId}"]`;
  const notesShown = () => page.$$eval('.note-tree .tree-note', (rows, f) => rows.filter((r) => r.closest('.tree-children') && r.textContent.startsWith('Entry')).length, folderId);
  const moreText = async () => { const m = await page.$('.note-tree .tree-more'); return m ? (await m.textContent()).trim() : null; };
  try {
    if (!wasTree) await page.click('#listModeSeg button[data-mode="tree"]');
    await page.waitForSelector(folderRow);
    if ((await page.$eval(folderRow, (r) => r.getAttribute('aria-expanded'))) !== 'true') await page.click(folderRow);
    await page.waitForSelector('.note-tree .tree-more');
    assert.equal(await notesShown(), 10);
    assert.equal(await moreText(), 'See 2 more');
    await page.click('.note-tree .tree-more');
    await waitFor('every note shown', async () => (await notesShown()) === 12);
    assert.equal(await moreText(), null);

    await page.click(folderRow);
    await waitFor('folder closed', async () => (await notesShown()) === 0);
    await page.click(folderRow);
    await page.waitForSelector('.note-tree .tree-more');
    assert.equal(await notesShown(), 10, 'closing the folder forgets "see more"');
    await page.focus('.note-tree .tree-more');
    await page.keyboard.press('Enter');
    await waitFor('every note shown by keyboard', async () => (await notesShown()) === 12);
    await waitFor('the first revealed note takes the focus', () => page.evaluate(() => { const a = document.activeElement; const n = a && a.querySelector('.row-name'); return n ? n.textContent : null; }).then((t) => t === 'Entry 2'));
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.querySelector('.row-name').textContent), 'Entry 1', 'the arrow keys carry on from there');
  } finally {
    try {
      for (const id of ids) await page.evaluate((i) => window.notesApi.notes.destroy(i), id);
      await page.evaluate((f) => window.notesApi.folders.delete(f), folderId);
      if (!wasTree) await page.click('#listModeSeg button[data-mode="list"]');
      await page.click('.nav-item[data-view="all"]');
    } catch (err) { console.log('  [see-more] cleanup failed: ' + err.message); }
  }
});

test('tips: a small pop in the corner shows once for hiding the sidebar and for find, closes on click, and "Show the tips again" resets them', { timeout: 60000 }, async () => {
  await page.click('.nav-item[data-view="all"]');
  await page.keyboard.press('Control+p');
  await page.waitForSelector('#palette[open]');
  await page.keyboard.type('>Show the tips again');
  await sleep(300);
  if (await page.$('.palette-item.is-active:has-text("Show the tips again")')) { await page.keyboard.press('Enter'); await waitFor('tips reset', () => readNotes().settings.hintsShown.length === 0); }
  else { await page.keyboard.press('Escape'); await waitForDom(() => !document.getElementById('palette').open); }
  const sample = await typeNote('Tips sample', 'A note to find in.');
  const pop = () => page.evaluate(() => { const p = document.getElementById('hintPop'); return p.classList.contains('hidden') ? null : p.textContent; });
  const docked = () => page.evaluate(() => !document.getElementById('app').classList.contains('sidebar-collapsed'));
  try {
    await page.mouse.move(600, 400);
    await page.keyboard.press('Control+\\');
    await waitFor('sidebar hidden', async () => !(await docked()));
    await waitFor('the sidebar tip shows', async () => /left edge/.test((await pop()) || ''));
    const box = await page.evaluate(() => { const p = document.getElementById('hintPop').getBoundingClientRect(); const e = document.getElementById('editor').getBoundingClientRect(); return { right: e.right - p.right, bottom: e.bottom - p.bottom, width: p.width, scrim: !!document.querySelector('.modal[open], dialog[open]') }; });
    assert.ok(box.right >= 8 && box.right <= 40 && box.bottom >= 40 && box.bottom <= 100, 'the tip sits in the bottom-right corner of the editor, above the status line: ' + JSON.stringify(box));
    assert.ok(box.width <= 320, 'the tip is small');
    assert.equal(box.scrim, false, 'nothing dims the screen');
    await page.click('#hintPop', { timeout: 4000 });
    await waitFor('a click closes it', async () => (await pop()) === null);
    await waitFor('remembered', () => readNotes().settings.hintsShown.includes('sidebar-hidden'));
    await page.keyboard.press('Control+\\');
    await waitFor('sidebar docked', docked);
    await page.keyboard.press('Control+\\');
    await waitFor('sidebar hidden again', async () => !(await docked()));
    await sleep(400);
    assert.equal(await pop(), null, 'the tip does not show twice');
    await page.keyboard.press('Control+\\');
    await waitFor('sidebar docked', docked);

    await page.keyboard.press('Control+f');
    await page.waitForSelector('#findBar:not(.hidden)');
    await waitFor('the find tip shows', async () => /Alt\+C/.test((await pop()) || ''));
    await page.keyboard.press('Escape');
    await waitForDom(() => document.getElementById('findBar').classList.contains('hidden'));
    assert.notEqual(await pop(), null, 'Esc closed find first, the tip is still there');
    await page.keyboard.press('Escape');
    await waitFor('Esc closes the tip before hiding the window', async () => (await pop()) === null);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true, 'the window stayed');

    await page.keyboard.press('Control+p');
    await page.waitForSelector('#palette[open]');
    await page.keyboard.type('>Show the tips again');
    await page.waitForSelector('.palette-item.is-active:has-text("Show the tips again")');
    await page.keyboard.press('Enter');
    await waitFor('tips forgotten', () => readNotes().settings.hintsShown.length === 0);
  } finally {
    await page.evaluate(() => document.getElementById('hintPop').classList.add('hidden'));
    if (!(await docked())) { await page.keyboard.press('Control+\\'); await waitFor('sidebar docked', docked); }
    await page.evaluate(() => window.notesApi.settings.set({ hintsShown: ['palette', 'sidebar-hidden', 'find-options'] }));
    await page.evaluate((id) => window.notesApi.notes.destroy(id), sample.id);
  }
});

test('folders move up, down, in and out: by drag in the sidebar and the note list, by Alt+arrows, and from the folder menu', async () => {
  const names = ['Alpha', 'Beta', 'Gamma'];
  const ids = {};
  for (const name of names) ids[name] = (await page.evaluate((n) => window.notesApi.folders.create({ name: n }), name)).id;
  const row = (name) => `.folder-row:has(.row-name:text-is("${name}"))`;
  const listRow = (name) => `.note-tree .tree-folder[data-id="${ids[name]}"]`;
  const dragTo = async (from, to, where) => {
    const box = await page.locator(to).boundingBox();
    const y = { before: 3, into: box.height / 2, after: box.height - 3 }[where];
    await page.dragAndDrop(from, to, { targetPosition: { x: 60, y }, timeout: 8000 });
  };
  const shape = () => page.evaluate(async (ns) => {
    const mine = (nodes) => nodes.filter((f) => ns.includes(f.name)).map((f) => f.name + (f.children.length ? '(' + mine(f.children).join(',') + ')' : ''));
    return mine(await window.notesApi.folders.tree()).join(' ');
  }, names);
  const expectShape = (want) => waitFor('folders read ' + want, async () => (await shape()) === want);
  const savedOrder = (name) => readNotes().folders.find((f) => f.name === name).order;
  const focusedName = () => page.evaluate(() => { const a = document.activeElement; const n = a && a.querySelector('.row-name'); return n ? n.textContent : null; });
  const toastText = () => page.$eval('#toast', (t) => t.textContent);
  const noMarks = async (scope, label) => assert.equal(await page.$$eval(scope + ' [data-drop], ' + scope + ' .is-drop-target', (r) => r.length), 0, label);
  let wasTree = null;
  try {
    await page.click('.nav-item[data-view="all"]');
    await page.waitForSelector(row('Gamma'));
    assert.equal(await shape(), 'Alpha Beta Gamma');

    await dragTo(row('Gamma'), row('Alpha'), 'before');
    await expectShape('Gamma Alpha Beta');
    assert.ok(savedOrder('Gamma') < savedOrder('Alpha') && savedOrder('Alpha') < savedOrder('Beta'), 'the order is saved');
    await noMarks('#folderTree', 'no drop mark left behind');
    assert.match(await toastText(), /^Moved Gamma above Alpha/);
    await page.click('#toast button');
    await expectShape('Alpha Beta Gamma');
    await dragTo(row('Gamma'), row('Alpha'), 'before');
    await expectShape('Gamma Alpha Beta');

    await dragTo(row('Beta'), row('Gamma'), 'into');
    await expectShape('Gamma(Beta) Alpha');
    await page.waitForSelector(row('Beta'), { state: 'visible' });
    assert.match(await toastText(), /^Moved Beta into Gamma/);

    await dragTo(row('Alpha'), row('Gamma'), 'after');
    await expectShape('Gamma(Alpha,Beta)', 'the bottom edge of an open folder puts it first inside');
    await page.waitForSelector(row('Alpha'), { state: 'visible' });

    const openTitle = await page.inputValue('#titleInput');
    await page.focus(row('Alpha'));
    assert.equal(await page.$eval('#statusCode', (s) => s.textContent), 'Alt+arrows move this folder', 'the status line says what Alt+arrows do');
    await page.keyboard.press('Alt+ArrowDown');
    await expectShape('Gamma(Beta,Alpha)');
    assert.equal(await focusedName(), 'Alpha', 'the moved row keeps the focus');
    assert.equal(await page.inputValue('#titleInput'), openTitle, 'Alt+Down on a folder row does not change the open note');
    await page.keyboard.press('Alt+ArrowLeft');
    await expectShape('Gamma(Beta) Alpha');
    await page.keyboard.press('Alt+ArrowUp');
    await expectShape('Alpha Gamma(Beta)');
    await page.focus(row('Beta'));
    await page.keyboard.press('Alt+ArrowLeft');
    await expectShape('Alpha Gamma Beta');
    await page.keyboard.press('Alt+ArrowRight');
    await expectShape('Alpha Gamma(Beta)');
    assert.equal(await focusedName(), 'Beta');
    await page.focus('#searchInput');
    assert.equal(await page.$eval('#statusCode', (s) => s.classList.contains('hidden')), true, 'the hint goes when the focus leaves the tree');

    await page.click(row('Beta'), { button: 'right' });
    await page.waitForSelector('#folderMenu:not(.hidden)');
    assert.deepEqual(await page.$$eval('#folderMenu button:not(.hidden)', (b) => b.map((x) => x.dataset.action)), ['new-note', 'new-subfolder', 'rename', 'move-out', 'toggle-book', 'delete'], 'an only child can move out, not up, down or in');
    assert.equal(await page.$eval('#folderMenuOut .lbl', (l) => l.textContent), 'Move out of Gamma');
    await page.click('#folderMenu [data-action="move-out"]');
    await expectShape('Alpha Gamma Beta');
    await page.click(row('Beta'), { button: 'right' });
    await page.waitForSelector('#folderMenu:not(.hidden)');
    assert.equal(await page.$eval('#folderMenuIn .lbl', (l) => l.textContent), 'Move into Gamma');
    await page.keyboard.press('Escape');

    await page.click('.nav-item[data-view="all"]');
    wasTree = await page.$eval('#listModeSeg button[data-mode="tree"]', (b) => b.classList.contains('is-on'));
    if (!wasTree) await page.click('#listModeSeg button[data-mode="tree"]');
    await page.waitForSelector(listRow('Alpha'));
    await dragTo(listRow('Alpha'), listRow('Beta'), 'after');
    await expectShape('Gamma Beta Alpha');
    await page.waitForSelector(listRow('Alpha'));
    await page.focus(listRow('Alpha'));
    await page.keyboard.press('Alt+ArrowUp');
    await expectShape('Gamma Alpha Beta');
    await waitFor('the moved list row keeps the focus', async () => (await focusedName()) === 'Alpha');
    await dragTo(listRow('Beta'), listRow('Gamma'), 'into');
    await expectShape('Gamma(Beta) Alpha');
    await noMarks('.note-tree', 'no drop mark left behind in the list');
  } finally {
    for (const name of ['Beta', 'Gamma', 'Alpha']) await page.evaluate((id) => window.notesApi.folders.delete(id), ids[name]);
    if (wasTree === false) await page.click('#listModeSeg button[data-mode="list"]');
    await page.click('.nav-item[data-view="all"]');
  }
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
  const rows = await page.evaluate(() => ({ row: parseFloat(getComputedStyle(document.getElementById('app')).gridTemplateRows), win: innerHeight }));
  assert.ok(Math.abs(rows.row - rows.win) < 2, 'grid row ' + rows.row + ' vs window ' + rows.win);
  const many = await page.evaluate(async () => { const ids = []; for (let i = 0; i < 40; i++) ids.push((await window.notesApi.notes.create({ title: 'Scroll filler ' + i, body: 'x' })).id); return ids; });
  await page.click('.nav-item[data-view="all"]');
  await waitForDom(() => Number((document.querySelector('#noteList .note-row') || { getAttribute: () => 0 }).getAttribute('aria-setsize')) >= 40);
  const listBox = await page.evaluate(() => { const e = document.getElementById('noteList'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 60, sh: e.scrollHeight, ch: e.clientHeight }; });
  assert.ok(listBox.sh > listBox.ch, 'the list overflows its pane');
  await page.mouse.move(listBox.x, listBox.y);
  await page.mouse.wheel(0, 500);
  await waitForDom(() => document.getElementById('noteList').scrollTop > 0);
  await clickRow("Scroll filler 0");
  const activeRowInView = () => page.evaluate(() => { const list = document.getElementById('noteList'); const row = list.querySelector('.note-row.is-active'); if (!row) return false; const a = row.getBoundingClientRect(), b = list.getBoundingClientRect(); return a.top >= b.top - 1 && a.bottom <= b.bottom + 1; });
  for (let i = 0; i < 80; i++) await page.keyboard.press('Alt+ArrowDown');
  await waitFor('the last note is revealed', activeRowInView);
  for (let i = 0; i < 80; i++) await page.keyboard.press('Alt+ArrowUp');
  await waitFor('the first note is revealed after scrolling back past unrendered rows', activeRowInView);
  assert.equal(await page.$eval('#noteList .note-row.is-active', (r) => r.getAttribute('aria-posinset')), '1', 'Alt+Up reaches the first note');
  await clickRow("Scroll filler 0");
  await useSourceMode(true);
  await fillBody(Array.from({ length: 150 }, (_, i) => 'line ' + i).join('\n'));
  await page.evaluate(() => { document.querySelector('.editor-scroll').scrollTop = 0; });
  const edBox = await page.evaluate(() => { const r = document.querySelector('.editor-scroll').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(edBox.x, edBox.y);
  await page.mouse.wheel(0, 500);
  await waitForDom(() => document.querySelector('.editor-scroll').scrollTop > 0);
  await page.evaluate((ids) => Promise.all(ids.map((id) => window.notesApi.notes.destroy(id))), many);

  const folder = await page.evaluate(() => window.notesApi.folders.create({ name: 'Scoped folder' }));
  const inside = await page.evaluate((f) => window.notesApi.notes.create({ title: 'Inside the folder', body: 'in', folderId: f }), folder.id);
  const outside = await page.evaluate((id) => window.notesApi.notes.create({ title: 'Outside note', body: 'see [it](note://' + id + ')' }), inside.id);
  await page.click('.nav-item[data-view="all"]');
  await clickRow("Outside note");
  await waitForDomWithin(8000, () => /Inside the folder/.test(document.getElementById('relatedOut').textContent));
  await page.click('#relatedOut button');
  await waitForDom(() => document.getElementById('titleInput').value === 'Inside the folder');
  await waitForDom(() => document.getElementById('listTitle').textContent.includes('Scoped folder'));
  const titles = await page.evaluate(() => [...document.querySelectorAll('.note-row .row-name')].map((e) => e.textContent));
  assert.deepEqual(titles, ['Inside the folder'], 'only the folder\'s notes are listed');
  await waitFor('folder remembered for the next start', () => readNotes().settings.lastFolderId === folder.id);
  await page.fill('#searchInput', 'Outside note');
  await waitForDom(() => [...document.querySelectorAll('.note-row .row-name')].some((e) => e.textContent === 'Outside note'));
  await clickRow("Outside note");
  await page.focus('#searchInput');
  await page.keyboard.press('Escape');
  await waitForDom(() => document.getElementById('listTitle').textContent === 'All notes');
  await waitFor('back to no remembered folder', () => readNotes().settings.lastFolderId === null);

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
  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate(() => ({ display: getComputedStyle(document.getElementById('app')).display, left: document.getElementById('editorPane').getBoundingClientRect().left }));
  await page.emulateMedia({ media: 'screen' });
  assert.equal(printed.display, 'block');
  assert.ok(printed.left < 2, 'note starts at the left edge: ' + printed.left);
  await page.keyboard.press('Control+Shift+f');
  await waitFor('list shown for search', listShown);
  await waitForDom(() => document.activeElement === document.getElementById('searchInput'));
  await page.keyboard.press('Control+Shift+Backslash');
  await waitFor('list hidden again', async () => !(await listShown()));
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
  await page.waitForSelector('.note-row', { timeout: 8000 });
  assert.equal(await page.$eval('#noteList .note-row', (r) => Number(r.getAttribute('aria-setsize'))), before);
  step('data survived reload');
});

test('sync with GitHub: the History dialog leads to the sign-in code, Esc cancels it, and Settings shows the account state', async () => {
  await page.keyboard.press('Control+Shift+b');
  await page.waitForSelector('#libraryDialog[open]');
  await waitForDom(() => /Sync with GitHub/.test(document.getElementById('libraryPrimaryBtn').textContent));
  assert.equal(await page.$eval('#libraryGithubBtn', (b) => b.classList.contains('hidden')), true, 'no second GitHub button while the primary is Sync with GitHub');
  assert.equal(await page.$eval('#libraryAccountText', (p) => p.classList.contains('hidden')), true, 'no account line without a repository');
  await page.click('#libraryPrimaryBtn');
  await page.waitForSelector('#githubDialog[open]');
  assert.equal(await page.$eval('#libraryDialog', (d) => d.open), false, 'the History dialog closed');
  assert.match(await page.textContent('#githubPrimaryBtn'), /Sign in with GitHub/);
  assert.equal(await page.$eval('#githubCode', (p) => p.classList.contains('hidden')), true, 'no code before signing in');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'githubPrimaryBtn', 'first focus on the primary');
  await page.keyboard.press('Enter');
  await waitForDom(() => !document.getElementById('githubCode').classList.contains('hidden'));
  assert.equal(await page.textContent('#githubCode'), 'WDJB-MJHT');
  assert.match(await page.textContent('#githubWait'), /Waiting for github\.com… the code expires in 1[45] min\./);
  assert.match(await page.textContent('#githubPrimaryBtn'), /Open github\.com/);
  assert.equal(await page.$eval('#githubCopyBtn', (b) => b.classList.contains('hidden')), false, 'Copy code is offered');
  assert.equal(await page.$eval('#githubRepoField', (l) => l.classList.contains('hidden')), true, 'no repository step yet');
  await page.keyboard.press('Escape');
  await waitForDom(() => !document.getElementById('githubDialog').open);

  await page.keyboard.press('Control+,');
  await page.waitForSelector('#settingsDialog[open]');
  await waitForDom(() => /Not signed in to GitHub/.test(document.getElementById('githubAccount').textContent));
  assert.match(await page.textContent('#githubSettingsBtn'), /Sync with GitHub/, 'the same label as the History dialog while no repository is set');
  await page.click('#githubSettingsBtn');
  await page.waitForSelector('#githubDialog[open]');
  assert.match(await page.textContent('#githubHint'), /GitHub will ask you to approve Notes/);
  await page.click('#githubCloseBtn');
  await waitForDom(() => !document.getElementById('githubDialog').open);
  await page.keyboard.press('Escape');
  await waitForDom(() => !document.getElementById('settingsDialog').open);
});

test('a change to notes.json made outside while Notes runs reaches the page and is kept', { timeout: 30000 }, async () => {
  const journaled = new Set(fs.readFileSync(journalFile, 'utf8').trim().split('\n').slice(1)
    .flatMap((line) => JSON.parse(line).change.map((c) => (c.note ? c.note.id : c.drop))));
  const doc = JSON.parse(fs.readFileSync(notesFile, 'utf8'));
  const target = doc.notes.find((n) => !n.pinned && !n.trashedAt && n.title && !journaled.has(n.id));
  assert.ok(target, 'a note Notes has not changed since its last full save');
  const pinnedBefore = Number(await page.textContent('#countPinned'));
  target.pinned = true;
  fs.writeFileSync(notesFile + '.writing', JSON.stringify(doc, null, 2));
  fs.renameSync(notesFile + '.writing', notesFile);
  await waitForDom((n) => Number(document.getElementById('countPinned').textContent) === n, pinnedBefore + 1);
  const written = JSON.parse(fs.readFileSync(notesFile, 'utf8'));
  assert.notEqual(written.journalId, doc.journalId, 'Notes wrote the merged library at once');
  assert.equal(written.notes.find((n) => n.id === target.id).pinned, true);
  await typeNote('Typed after the outside change', 'saved by Notes');
  assert.equal(readNotes().notes.find((n) => n.id === target.id).pinned, true);
  assert.deepEqual(fs.readdirSync(dataDir).filter((f) => f.startsWith('notes.json.outside-')), []);
});

test('the top band matches the window buttons and never runs under them or the other side, at any width or zoom', { timeout: 60000 }, async () => {
  await page.mouse.move(600, 400);
  const band = () => {
    const probe = document.getElementById('captionProbe').getBoundingClientRect();
    const wco = navigator.windowControlsOverlay.getTitlebarAreaRect();
    const bar = document.querySelector('.tab-bar').getBoundingClientRect();
    const peer = document.querySelector('.pane-peer');
    const peerLeft = peer && peer.offsetParent ? peer.getBoundingClientRect().left : null;
    const rights = [...document.querySelectorAll('.tab-bar button')].filter((b) => b.offsetParent && !b.closest('.tab')).map((b) => b.getBoundingClientRect().right);
    return { captionLeft: innerWidth - probe.width, captionH: wco.height, barH: bar.height, limit: peerLeft ?? innerWidth - probe.width, right: Math.max(0, ...rights) };
  };
  const guestRight = () => Math.max(0, ...[...document.querySelectorAll('.tab-bar button')].filter((b) => b.offsetParent && !b.closest('.tab')).map((b) => b.getBoundingClientRect().right));
  const setZoom = (level) => app.evaluate(({ BrowserWindow }, l) => BrowserWindow.getAllWindows()[0].webContents.setZoomLevel(l), level);
  const setWidth = (w) => app.evaluate(({ BrowserWindow }, width) => { const win = BrowserWindow.getAllWindows()[0]; if (win.isMaximized()) win.unmaximize(); win.setContentSize(width, 800); }, w);
  const guest = guestFrame;
  const openSplit = async () => {
    if (await page.isVisible('#splitViewBtn')) { await page.click('#splitViewBtn'); return; }
    await page.click('#moreBtn');
    await page.click('#moreSplitViewBtn');
  };
  await page.locator('.note-row').nth(0).click();
  await page.keyboard.press('Control+t');
  await page.locator('.note-row').nth(1).click();
  try {
    for (const zoom of [0, 1]) {
      await setZoom(zoom);
      for (const width of [1600, 1000, 760]) {
        await setWidth(width);
        await sleep(500);
        const m = await page.evaluate(band);
        assert.ok(m.captionH > 0, 'the window buttons are measured');
        assert.ok(Math.abs(m.barH - m.captionH - 1) < 0.5, `zoom ${zoom}, ${width}px: the band (${m.barH}) is the window buttons (${m.captionH}) and its 1px line below them`);
        assert.ok(m.right <= m.limit + 0.5, `zoom ${zoom}, ${width}px: band buttons end at ${m.right}, before the window buttons at ${m.limit}`);
        await openSplit();
        await waitFor('the second side', async () => { const g = guest(); return !!g && (await g.evaluate(() => !!document.querySelector('.tab-bar')).catch(() => false)); });
        await sleep(800);
        const s = await page.evaluate(band);
        assert.ok(s.right <= s.limit + 0.5, `zoom ${zoom}, ${width}px split: the left side's buttons end at ${s.right}, before the right side at ${s.limit}`);
        const peerRight = s.limit + await guest().evaluate(guestRight);
        assert.ok(peerRight <= s.captionLeft + 0.5, `zoom ${zoom}, ${width}px split: the right side's buttons end at ${peerRight}, before the window buttons at ${s.captionLeft}`);
        await guest().click('#paneCloseBtn');
        await waitForDom(() => !document.querySelector('.pane-peer') || !document.querySelector('.pane-peer').offsetParent);
      }
    }
  } finally {
    await setZoom(0);
    await setWidth(1100);
    await sleep(300);
  }
});

test('no renderer errors were logged during the run', () => {
  assert.deepEqual(rendererErrors, []);
});
