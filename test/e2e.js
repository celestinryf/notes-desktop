'use strict';
/* End-to-end proof of the global hotkey on a real Windows desktop.
   The hotkey chord itself is pressed with real synthesized input (SendKeys), because that is what proves the
   OS-level binding. Everything else is driven through the page via Playwright, so no stray text can land in
   another window if a person is using the machine while this runs.
   1. launch hidden with an isolated data dir and a test-only hotkey
   2. press the hotkey: the window must appear and take focus
   3. type a note and confirm it reaches notes.json
   4. press the hotkey again: hidden; again: shown; Esc: hidden
   Run with: npm run test:e2e */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON = require('electron');
const HOTKEY = 'Control+Alt+Shift+F9';
const SENDKEYS_HOTKEY = '^%+{F9}';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-e2e-'));
const shotDir = process.env.NOTES_E2E_SHOTS || dataDir;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[e2e]', ...a);

function ps(script) {
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function sendKeys(keys) {
  ps("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('" + keys.replace(/'/g, "''") + "')");
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

async function waitFor(label, predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < (timeoutMs || 10000)) {
    const v = await predicate();
    if (v) return v;
    await sleep(150);
  }
  throw new Error('Timed out waiting for ' + label);
}

async function main() {
  fs.writeFileSync(path.join(dataDir, 'notes.json'), JSON.stringify({ settings: { hotkey: HOTKEY, openAtLogin: false, theme: 'light', gitEnabled: false }, notes: [] }));
  const runtimeFile = path.join(dataDir, 'runtime.json');
  const notesFile = path.join(dataDir, 'notes.json');
  const rendererErrors = [];

  log('launching app hidden, data dir', dataDir);
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, '--hidden'],
    env: Object.assign({}, process.env, { NOTES_APP_DATA_DIR: dataDir, NOTES_APP_NO_LOGIN_ITEM: '1' }),
  });
  const page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') rendererErrors.push(m.text()); });
  page.on('pageerror', (e) => rendererErrors.push('pageerror: ' + e.message));
  const win = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { visible: w.isVisible(), focused: w.isFocused() }; });

  let exitCode = 0;
  try {
    const rt = await waitFor('app ready with hotkey registered', () => { const r = readJson(runtimeFile); return r && r.ready && r.registered ? r : null; }, 20000);
    assert.equal(rt.hotkey, HOTKEY, 'registered the requested hotkey, not a fallback');
    assert.equal((await win()).visible, false, 'starts hidden with --hidden');
    log('ready; hotkey registered:', rt.hotkey);

    sendKeys(SENDKEYS_HOTKEY);
    await waitFor('window visible and focused after hotkey', async () => { const w = await win(); return w.visible && w.focused; }, 8000);
    log('window shown and focused by the OS hotkey');
    await sleep(500);

    // The first show on an empty store opens a fresh note with the title focused.
    await waitFor('fresh note ready', () => page.evaluate(() => document.activeElement && document.activeElement.id === 'titleInput'), 8000);
    // The hotkey focused this window for real, so a person typing elsewhere can land a stray key here first.
    await page.keyboard.press('Control+a');
    await page.keyboard.type('E2E Title');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Body text typed into the hotkey window.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- [ ] first task');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second task');
    const saved = await waitFor('typed note saved to disk', () => {
      const d = readJson(notesFile);
      const n = d && d.notes.find((x) => x.title === 'E2E Title');
      return n && n.body.includes('Body text typed into the hotkey window.') && n.body.includes('- [ ] first task\n- [ ] second task') ? n : null;
    }, 8000);
    log('note persisted:', JSON.stringify({ title: saved.title, body: saved.body }));
    await page.screenshot({ path: path.join(shotDir, 'e2e-light.png') });

    // Zoom with real OS key presses (Ctrl+= used to do nothing because Electron's default menu wants Ctrl+Shift+=).
    const zoom = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel());
    sendKeys('^=');
    await waitFor('Ctrl+= zoomed in', async () => (await zoom()) === 0.5, 5000);
    sendKeys('^-');
    await waitFor('Ctrl+- zoomed out', async () => (await zoom()) === 0, 5000);
    sendKeys('^=');
    sendKeys('^0');
    await waitFor('Ctrl+0 reset', async () => (await zoom()) === 0, 5000);
    log('zoom keys work with real key presses');

    sendKeys(SENDKEYS_HOTKEY);
    await waitFor('window hidden after second hotkey press', async () => !(await win()).visible, 8000);
    log('window hidden by hotkey');

    sendKeys(SENDKEYS_HOTKEY);
    await waitFor('window visible again after third press', async () => (await win()).visible, 8000);
    log('window shown again by hotkey');

    await page.keyboard.press('Escape');
    await waitFor('window hidden by Esc', async () => !(await win()).visible, 8000);
    log('window hidden by Esc');

    assert.deepEqual(rendererErrors, [], 'renderer logged errors');
    log('PASS');
  } catch (err) {
    exitCode = 1;
    console.error('[e2e] FAIL:', err.message);
    try { await page.screenshot({ path: path.join(shotDir, 'e2e-failure.png') }); } catch (_) { /* ignore */ }
  } finally {
    try { await app.evaluate(({ app: a }) => setTimeout(() => a.exit(0), 50)); } catch (_) { /* ignore */ }
    await sleep(500);
    try { await app.close(); } catch (_) { /* ignore */ }
  }
  process.exit(exitCode);
}

main();
