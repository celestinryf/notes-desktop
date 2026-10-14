'use strict';
/* End-to-end proof on a real Windows desktop:
   1. launch the app hidden with an isolated data dir and a test-only hotkey
   2. press the hotkey with real synthesized input (SendKeys) and confirm the window appears and is focused
   3. type a note and confirm it reaches notes.json
   4. press the hotkey again and confirm the window hides, then again to confirm it returns
   Run with: npm run test:e2e */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON = require('electron'); // path to electron.exe when required from node
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

function screenshot(name) {
  const file = path.join(shotDir, name + '.png');
  ps(`Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing;
      $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
      $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height;
      $g = [System.Drawing.Graphics]::FromImage($bmp);
      $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size);
      $bmp.Save('${file.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png);
      $g.Dispose(); $bmp.Dispose();`);
  log('screenshot', file);
  return file;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

async function waitFor(label, predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < (timeoutMs || 10000)) {
    const v = predicate();
    if (v) return v;
    await sleep(150);
  }
  throw new Error('Timed out waiting for ' + label);
}

async function main() {
  fs.writeFileSync(path.join(dataDir, 'notes.json'), JSON.stringify({ settings: { hotkey: HOTKEY, openAtLogin: false, theme: 'light' }, notes: [] }));
  const runtimeFile = path.join(dataDir, 'runtime.json');
  const notesFile = path.join(dataDir, 'notes.json');

  log('launching app hidden, data dir', dataDir);
  const child = spawn(ELECTRON, [ROOT, '--hidden'], {
    env: Object.assign({}, process.env, { NOTES_APP_DATA_DIR: dataDir, NOTES_APP_NO_LOGIN_ITEM: '1', NOTES_APP_LOG_CONSOLE: '1' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const rendererErrors = [];
  child.stdout.on('data', (d) => { const s = String(d); process.stdout.write('[app] ' + s); if (/[renderer:error]/.test(s)) rendererErrors.push(s.trim()); });
  child.stderr.on('data', (d) => process.stderr.write('[app:err] ' + d));

  let exitCode = 0;
  try {
    const rt = await waitFor('app ready with hotkey registered', () => { const r = readJson(runtimeFile); return r && r.ready && r.registered ? r : null; }, 20000);
    assert.equal(rt.hotkey, HOTKEY, 'registered the requested hotkey, not a fallback');
    assert.equal(rt.visible, false, 'starts hidden with --hidden');
    log('ready; hotkey registered:', rt.hotkey);

    sendKeys(SENDKEYS_HOTKEY);
    await waitFor('window visible and focused after hotkey', () => { const r = readJson(runtimeFile); return r && r.visible && r.focused; }, 8000);
    log('window shown by hotkey');
    await sleep(700);

    sendKeys('^n');
    await sleep(500);
    sendKeys('E2E Title{ENTER}Body text typed through the hotkey window.');
    await sleep(1200);

    const data = await waitFor('typed note saved to disk', () => {
      const d = readJson(notesFile);
      const n = d && d.notes.find((x) => x.title === 'E2E Title');
      return n && n.body.includes('Body text typed through the hotkey window.') ? d : null;
    }, 8000);
    const saved = data.notes.find((x) => x.title === 'E2E Title');
    log('note persisted:', JSON.stringify({ title: saved.title, body: saved.body }));
    // List continuation, preview, pin, tags, trash.
    sendKeys('{ENTER}- [ ] first task{ENTER}second task{ENTER}{ENTER}');
    await sleep(900);
    const cont = await waitFor('list continuation saved', () => {
      const d = readJson(notesFile); const n = d && d.notes.find((x) => x.title === 'E2E Title');
      return n && n.body.includes('- [ ] first task\n- [ ] second task') ? n : null;
    }, 6000);
    assert.ok(!cont.body.endsWith('- [ ] '), 'empty checklist bullet ended the list: ' + JSON.stringify(cont.body));
    log('list continuation works');

    sendKeys('^e');
    await sleep(500);
    screenshot('e2e-preview');
    sendKeys('^e');
    await sleep(300);

    sendKeys('^p');
    await waitFor('pin persisted', () => { const d = readJson(notesFile); const n = d && d.notes.find((x) => x.title === 'E2E Title'); return n && n.pinned; }, 6000);
    log('pin works');

    sendKeys('+{TAB}');            // body -> tags input
    await sleep(200);
    sendKeys('work, ideas{ENTER}'); // Enter returns focus to the body
    await waitFor('tags persisted', () => { const d = readJson(notesFile); const n = d && d.notes.find((x) => x.title === 'E2E Title'); return n && n.tags.join(',') === 'work,ideas'; }, 6000);
    log('tags work');
    screenshot('e2e-light');

    sendKeys('^+l');
    await sleep(500);
    screenshot('e2e-dark');
    const themed = readJson(notesFile);
    assert.equal(themed.settings.theme, 'dark', 'theme toggle persisted');

    sendKeys('^{DELETE}');
    await waitFor('trash persisted', () => { const d = readJson(notesFile); const n = d && d.notes.find((x) => x.title === 'E2E Title'); return n && n.trashedAt && !n.pinned; }, 6000);
    log('trash works');

    sendKeys(SENDKEYS_HOTKEY);
    await waitFor('window hidden after second hotkey press', () => { const r = readJson(runtimeFile); return r && !r.visible; }, 8000);
    log('window hidden by hotkey');

    sendKeys(SENDKEYS_HOTKEY);
    await waitFor('window visible again after third press', () => { const r = readJson(runtimeFile); return r && r.visible; }, 8000);
    log('window shown again by hotkey');

    sendKeys('{ESC}');
    await waitFor('window hidden by Esc', () => { const r = readJson(runtimeFile); return r && !r.visible; }, 8000);
    log('window hidden by Esc');

    assert.deepEqual(rendererErrors, [], 'renderer logged errors');
    log('PASS');
  } catch (err) {
    exitCode = 1;
    console.error('[e2e] FAIL:', err.message);
    try { screenshot('e2e-failure'); } catch (_) { /* ignore */ }
  } finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) { /* already gone */ }
  }
  process.exit(exitCode);
}

main();
