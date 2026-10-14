'use strict';
/* Live end-to-end check against the REAL claude CLI, a REAL GitHub repo, and real windows. Not part of the
   test suite (it spends tokens and touches GitHub). Run: node scratchpad/live-check.js
   Uses an isolated data dir; never touches production notes. Creates and deletes a private repo
   notes-vault-livetest on the signed-in GitHub account. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { _electron: electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const ELECTRON_PATH = require('electron');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-live-'));
const notesFile = path.join(dataDir, 'notes.json');
const shots = path.join(ROOT, 'scratchpad', 'shots');
fs.mkdirSync(shots, { recursive: true });
const readNotes = () => JSON.parse(fs.readFileSync(notesFile, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[live]', ...a);
const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
async function waitFor(label, fn, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await sleep(200); }
  throw new Error('Timed out: ' + label);
}
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const REPO = 'notes-vault-livetest';
const RUN = String(Date.now()).slice(-6);
const NOTE = 'Live check ' + RUN;
const OTHER = 'From other device ' + RUN;
let app, page, owner, repoUrl, vaultParent, otherClone;

async function main() {
  owner = gh('api', 'user', '-q', '.login');
  // Fresh private repo (delete a leftover first).
  try { gh('api', '-X', 'DELETE', 'repos/' + owner + '/' + REPO); } catch (_) { /* none or no scope */ }
  try { gh('repo', 'create', owner + '/' + REPO, '--private', '--description', 'temporary live test of the notes app vault sync'); } catch (e) { log('repo create failed (reusing existing): ' + String(e.message).slice(0, 80)); }
  repoUrl = 'https://github.com/' + owner + '/' + REPO + '.git';
  log('repo', repoUrl);
  vaultParent = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-live-vault-'));

  fs.writeFileSync(notesFile, JSON.stringify({ settings: { hotkey: 'Control+Alt+Shift+F7', openAtLogin: false, theme: 'light' }, notes: [] }));
  const env = Object.assign({}, process.env, { NOTES_APP_DATA_DIR: dataDir, NOTES_APP_NO_LOGIN_ITEM: '1', NOTES_APP_INACTIVE: '1', NOTES_APP_VAULT_DEBOUNCE_MS: '1500' });
  delete env.NOTES_APP_CLAUDE_BIN; // the real claude
  app = await electron.launch({ executablePath: ELECTRON_PATH, args: [ROOT], env });
  page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForSelector('#app');
  await page.evaluate(() => { window.confirm = () => true; });
  await page.evaluate(() => window.notesApi.settings.set({ editorMode: 'source' }));

  // 1. Clone the empty repo as a vault through the app's own IPC (what the Clone dialog calls).
  const clone = await page.evaluate(([url, dest]) => window.notesApi.vaults.clone(url, dest, 'livetest'), [repoUrl, vaultParent]);
  record('vault: clone empty GitHub repo', clone.ok, clone.ok ? clone.vault.path : clone.error);
  if (!clone.ok) throw new Error(clone.error);
  const vaultId = clone.vault.id;
  const rootFolderId = clone.vault.rootFolderId;

  // 2. Create a note in the vault from the UI, type into it; expect a file, then a commit pushed to GitHub.
  await page.evaluate((fid) => window.notesApi.settings.set({ expandedFolders: [fid] }), rootFolderId);
  await page.click('.nav-item[data-view="all"]'); // refresh the sidebar so the new vault folder is rendered
  await page.waitForSelector('.folder-row[data-id="' + rootFolderId + '"]', { timeout: 10000 });
  await page.click('.folder-row[data-id="' + rootFolderId + '"]');
  await waitFor('vault folder active', () => page.evaluate((id) => { const r = document.querySelector('.folder-row[data-id="' + id + '"]'); return r && r.classList.contains('is-active'); }, rootFolderId));
  await page.keyboard.press('Control+n');
  await waitFor('title focused', () => page.evaluate(() => document.activeElement && document.activeElement.id === 'titleInput'));
  await page.fill('#titleInput', NOTE);
  // Source view so the Markdown textarea is the thing we type into (same as the UI tests' helper).
  if (await page.evaluate(() => document.getElementById('bodyInput').classList.contains('hidden'))) { await page.keyboard.press('Control+e'); await waitFor('source mode', () => page.evaluate(() => !document.getElementById('bodyInput').classList.contains('hidden'))); }
  await page.fill('#bodyInput', '# Live check\n\n- [ ] written from the app\n');
  const file = path.join(clone.vault.path, NOTE + '.md');
  await waitFor('vault file written', () => fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('written from the app'));
  record('vault: typing creates the file', true, file);
  const pushed = await waitFor('commit on GitHub', async () => {
    try { const out = gh('api', 'repos/' + owner + '/' + REPO + '/contents/Live%20check.md', '-q', '.sha'); return out.length > 0; } catch (_) { return false; }
  }, 60000).catch(() => false);
  record('vault: auto-commit and push reach GitHub', !!pushed);

  // 3. Another device: clone elsewhere, add a file, push; the app syncs and the note appears.
  otherClone = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notes-live-other-')), 'clone');
  git(path.dirname(otherClone), 'clone', '-q', repoUrl, otherClone);
  fs.writeFileSync(path.join(otherClone, OTHER + '.md'), 'Hello from the other device\n');
  git(otherClone, 'add', '-A'); git(otherClone, '-c', 'user.name=Other', '-c', 'user.email=o@x', 'commit', '-q', '-m', 'from other device'); git(otherClone, 'push', '-q');
  const sync = await page.evaluate((id) => window.notesApi.vaults.sync(id), vaultId);
  const appeared = await waitFor('pulled note appears', () => readNotes().notes.some((n) => n.title === OTHER && n.vaultId === vaultId), 20000).catch(() => false);
  record('vault: sync pulls another device\'s note', !!(sync.ok && appeared), sync.ok ? '' : sync.error);
  await page.screenshot({ path: path.join(shots, 'main-vault.png') });

  // 4. Bot: real `claude -p` edits the vault note in front of the user.
  await page.click('.note-card:has-text("' + NOTE + '")');
  await waitFor('note open', () => page.evaluate((t) => document.getElementById('titleInput').value === t, NOTE));
  await page.keyboard.press('Control+Shift+a');
  await page.waitForSelector('#botPanel:not(.hidden)');
  await page.fill('#botPrompt', 'Append exactly one line to the end of the file the user is currently looking at: "- [x] checked by the bot". Change nothing else and do not touch other files.');
  await page.click('#botRunBtn');
  const botDone = await waitFor('bot finished', () => page.evaluate(() => /Done/.test(document.getElementById('botOutput').textContent) || /Could not|not found/.test(document.getElementById('botOutput').textContent)), 240000).catch(() => false);
  const botOut = await page.textContent('#botOutput');
  const fileAfter = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const edited = /checked by the bot/.test(fileAfter);
  const inApp = await waitFor('edit reached the editor', () => page.evaluate(() => /checked by the bot/.test(document.getElementById('bodyInput').value)), 15000).catch(() => false);
  record('bot: real claude -p edits the open vault note', !!(botDone && edited), 'output tail: ' + botOut.slice(-200).replace(/\s+/g, ' '));
  record('bot: the edit shows up in the editor without reload', !!inApp);
  await page.screenshot({ path: path.join(shots, 'main-bot.png') });

  // 5. Open terminal: a PowerShell running the generated script with claude as its child.
  const term = await page.evaluate((id) => window.notesApi.bot.openTerminal(id), readNotes().notes.find((n) => n.title === NOTE).id);
  const script = path.join(dataDir, 'bot-terminal.ps1');
  const scriptText = fs.existsSync(script) ? fs.readFileSync(script, 'utf8') : '';
  let termProcs = [];
  for (let i = 0; i < 20 && !termProcs.length; i++) {
    await sleep(1000);
    const ps = spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*bot-terminal.ps1*' -or ($_.Name -eq 'claude.exe') } | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.ParentProcessId + '|' + $_.Name + '|' + $_.CommandLine }"], { encoding: 'utf8' });
    termProcs = ps.stdout.split(/\r?\n/).filter((l) => /bot-terminal|claude\.exe/.test(l));
  }
  const haveShell = termProcs.some((l) => /powershell/i.test(l) && /bot-terminal\.ps1/.test(l));
  const haveClaude = termProcs.some((l) => /\|claude\.exe\|/.test(l));
  record('terminal: PowerShell runs the generated script', !!(term.ok && haveShell), term.ok ? scriptText.split(/\r?\n/).slice(0, 4).join(' / ') : term.error);
  record('terminal: an interactive claude is running inside it', haveClaude, termProcs.map((l) => l.split('|').slice(0, 3).join(':')).join(', '));
  // Close what we opened.
  for (const l of termProcs) { if (/powershell/i.test(l) && /bot-terminal.ps1/.test(l)) spawnSync('taskkill', ['/PID', l.split('|')[0], '/T', '/F'], { stdio: 'ignore' }); }
  for (const l of termProcs) { if (/WindowsTerminal/i.test(l) && /bot-terminal.ps1/.test(l)) spawnSync('taskkill', ['/PID', l.split('|')[0], '/F'], { stdio: 'ignore' }); }

  // 6. Sticky: real window, screenshot it.
  const noteId = readNotes().notes.find((n) => n.title === NOTE).id;
  const stickyPromise = app.waitForEvent('window', { timeout: 15000 });
  await page.evaluate((id) => window.notesApi.stickies.open(id), noteId);
  const sticky = await stickyPromise;
  await sticky.waitForSelector('#stickyEditor .rich-editor-content');
  await sleep(800);
  await sticky.screenshot({ path: path.join(shots, 'sticky.png') });
  const stickyText = await sticky.textContent('#stickyEditor');
  record('sticky: window opens with the note rendered', /checked by the bot|written from the app/.test(stickyText), stickyText.slice(0, 80).replace(/\s+/g, ' '));
  await sticky.click('#stickyColors [data-color="leaf"]');
  await waitFor('tint', () => sticky.evaluate(() => document.documentElement.dataset.color === 'leaf'));
  await sticky.screenshot({ path: path.join(shots, 'sticky-leaf.png') });
  await sticky.click('#stickyCloseBtn');
  await waitFor('sticky gone', () => !readNotes().notes.find((n) => n.id === noteId).sticky);

  // 7. Main window look, dark theme too.
  await page.evaluate(() => window.notesApi.settings.set({ theme: 'dark' }));
  await sleep(500);
  await page.screenshot({ path: path.join(shots, 'main-dark.png') });
  await page.evaluate(() => window.notesApi.settings.set({ theme: 'light' }));

  record('no renderer errors during the live run', errors.length === 0, errors.join(' | ').slice(0, 300));
}

main().catch((err) => { record('live run aborted', false, String(err && err.stack || err).slice(0, 400)); }).finally(async () => {
  try { if (app) await app.evaluate(({ app }) => { app.exit(0); }); } catch (_) { /* ignore */ }
  log('repo kept (token lacks delete_repo): https://github.com/' + owner + '/' + REPO);
  log('data dir', dataDir, 'vault', vaultParent, 'shots', shots);
  console.log(JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
});
