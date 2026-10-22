const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright-core');

const ROOT = process.cwd();
const HERE = __dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(label, fn, ms) {
  const end = Date.now() + (ms || 15000);
  while (Date.now() < end) { if (await fn()) return; await sleep(150); }
  throw new Error('Timed out: ' + label);
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-craftprobe-'));
  const filesDir = path.join(dataDir, 'files'); fs.mkdirSync(filesDir);
  const { Document, Packer, Paragraph } = require('docx');
  const docxPath = path.join(filesDir, 'Probe report.docx');
  fs.writeFileSync(docxPath, await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Probe text')] }] })));
  const xlsmPath = path.join(filesDir, 'Probe book.xlsm');
  fs.copyFileSync(path.join(ROOT, 'scripts', 'fixtures', 'Trail readings.xlsx'), xlsmPath);
  const now = Date.now();
  const note = (id, file, kind, t) => ({ id, title: path.basename(file), body: '', tags: [], folderId: null, filePath: file, fileKind: kind, fileMtime: fs.statSync(file).mtimeMs, createdAt: now - t, updatedAt: now - t });
  fs.writeFileSync(path.join(dataDir, 'notes.json'), JSON.stringify({ settings: { hotkey: 'Control+Alt+Shift+F11', openAtLogin: false, theme: 'dark', editorWidth: 0, columnLayout: 3 },
    notes: [note('n-doc', docxPath, 'docx', 1000), note('n-sheet', xlsmPath, 'sheet', 2000), { id: 'n-plain', title: 'Plain', body: 'plain', tags: [], folderId: null, createdAt: now - 3000, updatedAt: now - 3000 }] }));
  const app = await electron.launch({
    executablePath: require('electron'), args: [ROOT],
    env: Object.assign({}, process.env, {
      NOTES_APP_DATA_DIR: dataDir, NOTES_APP_NO_LOGIN_ITEM: '1', NOTES_APP_INACTIVE: '1', NOTES_APP_DRY_DICTATE: '1', NOTES_APP_DRY_PRINT: '1', NOTES_APP_DRY_NOTIFY: '1', NOTES_APP_DRY_TERMINAL: '1',
      NOTES_APP_CLAUDE_BIN: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'),
      NOTES_APP_WORDCRAFT_DIR: path.join(HERE, 'fake-craft'), NOTES_APP_GRIDCRAFT_DIR: path.join(HERE, 'fake-craft'),
    }),
  });
  const errors = [];
  const results = [];
  const ok = (label, cond) => { results.push((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) errors.push(label); };
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.waitForSelector('#app');
    await page.evaluate(() => { window.__confirms = 0; window.confirm = () => { window.__confirms++; return true; }; });
    const banner = () => page.evaluate(() => document.getElementById('fileBanner').textContent.trim());
    const frameShown = (id) => page.evaluate((id) => !document.getElementById(id).classList.contains('hidden') && !document.getElementById(id).classList.contains('is-opening'), id);
    const craftFrame = (id) => page.frames().find((f) => f.url().startsWith(id + '://'));
    const status = () => page.evaluate(() => document.getElementById('statusSaved').textContent.trim());

    await page.click('.note-row:has-text("Probe report.docx")');
    await waitFor('wordcraft frame shown', () => frameShown('wordcraftFrame'));
    ok('Word document opened in the frame', true);
    ok('banner cleared after open', (await banner()) === '');
    ok('fake frame got the bytes', (await craftFrame('wordcraft').evaluate(() => document.getElementById('s').textContent)).startsWith('open Probe report.docx'));

    await page.click('#fileReloadBtn');
    await sleep(1500);
    ok('reload from disk did not throw', !errors.some((e) => /ReferenceError/.test(e)));
    ok('frame shown again after reload', await frameShown('wordcraftFrame'));

    await page.click('.note-row:has-text("Probe book.xlsm")');
    await waitFor('gridcraft frame shown', () => frameShown('gridcraftFrame'));
    ok('banner cleared for the workbook', (await banner()) === '');
    const grid = craftFrame('gridcraft');
    await grid.evaluate(() => window.postMessage({ type: 'fake-edit' }, '*'));
    await waitFor('status Edited', async () => (await status()) === 'Edited');
    await grid.evaluate(() => window.postMessage({ type: 'fake-save' }, '*'));
    await waitFor('status Saved', async () => (await status()) === 'Saved');
    const copies = () => fs.readdirSync(filesDir).filter((f) => /from GridCraft/.test(f));
    ok('one copy beside the file after the first save: ' + copies().join(','), copies().length === 1);
    const originalBytes = fs.readFileSync(xlsmPath);
    await grid.evaluate(() => window.postMessage({ type: 'fake-edit' }, '*'));
    await grid.evaluate(() => window.postMessage({ type: 'fake-save' }, '*'));
    await sleep(1200);
    ok('still one copy after the second save: ' + copies().join(','), copies().length === 1);
    ok('the workbook itself is unchanged', Buffer.compare(originalBytes, fs.readFileSync(xlsmPath)) === 0);
    await page.click('.note-row:has-text("Plain")');
    await sleep(800);
    const confirms = await page.evaluate(() => window.__confirms);
    ok('leaving the saved workbook asked nothing', confirms === 0);
    ok('plain note shown', await page.evaluate(() => document.getElementById('gridcraftFrame').classList.contains('hidden')));
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await sleep(500);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {  }
  }
  console.log(results.join('\n'));
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
