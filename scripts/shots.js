'use strict';
/* Screenshots of the real app in named scenes, for design work: look at what you changed before you call it done.
   It runs against an isolated, seeded data folder (never the user's notes) and never takes keyboard focus.

   npm run shots                         every scene, light and dark, into %TEMP%\shots-notes-app
   npm run shots -- --scene main,settings --theme dark
   npm run shots -- --size 820x560 --out C:\some\folder
   npm run shots -- --list               the scene names
   npm run shots -- --eval metrics.js    also evaluate a script in each scene and save its result as <scene>-<theme>.json
                                         (for example the ui-audit skill's scripts/ui-metrics.js)
   npm run shots -- --screen             also capture the window from the real screen as <scene>-<theme>-screen.png:
                                         it includes the caption buttons Windows draws. The window comes to the front
                                         for a moment, so do not use it while someone is typing.

   Each PNG is named <scene>-<theme>.png. Open them with the Read tool to look at them.
   A run first deletes the .png and .json files already in the output folder, so what is there is this run's. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright-core');
const { tmpDir } = require('../test/helpers/tmp');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  const out = { scenes: null, themes: ['light', 'dark'], size: { width: 1280, height: 800 }, out: path.join(os.tmpdir(), 'shots-notes-app'), list: false, eval: null, screen: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(a + ' needs a value'); return v; };
    if (a === '--scene' || a === '--scenes') out.scenes = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--theme') { const t = next(); out.themes = t === 'both' ? ['light', 'dark'] : [t]; }
    else if (a === '--size') { const m = /^(\d+)x(\d+)$/.exec(next()); if (!m) throw new Error('--size wants WIDTHxHEIGHT'); out.size = { width: +m[1], height: +m[2] }; }
    else if (a === '--out') out.out = path.resolve(next());
    else if (a === '--list') out.list = true;
    else if (a === '--screen') out.screen = true;
    else if (a === '--eval') { out.eval = path.resolve(next()); if (!fs.existsSync(out.eval)) throw new Error('No such file: ' + out.eval); }
    else throw new Error('Unknown argument ' + a);
  }
  for (const t of out.themes) if (t !== 'light' && t !== 'dark') throw new Error('--theme is light, dark or both');
  return out;
}

/* Sample data: a believable notebook, so layouts are judged with real lengths, not lorem ipsum. */
function seed(now) {
  const f = (id, name, extra) => Object.assign({ id, name, parentId: null, createdAt: now - 30 * DAY }, extra);
  const folders = [
    f('f-work', 'Work'),
    f('f-proj', 'Project Atlas', { parentId: 'f-work' }),
    f('f-home', 'Home'),
    f('f-book', 'Field guide', { book: true, pageOrder: ['b1', 'b2', 'b3'] }),
  ];
  let t = 0;
  const n = (id, title, body, extra) => Object.assign({ id, title, body, tags: [], folderId: null, pinned: false, createdAt: now - (40 - t) * DAY, updatedAt: now - (t++) * 3.7 * 60 * 60 * 1000 }, extra);
  const notes = [
    n('n-plan', 'Q4 planning', [
      '## Goals',
      'Ship the sync rewrite before the holiday freeze, and cut the cold-start time in half.',
      '',
      '- [x] Draft the migration plan',
      '- [x] Review it with the storage team',
      '- [ ] Benchmark the new index on the large test vault',
      '- [ ] Write the rollback runbook',
      '',
      '## Open questions',
      '> Do we keep the old format readable for one release, or two?',
      '',
      'The index lives in `index.db` next to the notes. A rebuild takes about **40 seconds** on the big vault, which is too slow to run at startup.',
      '',
      '| Milestone | Owner | Due |',
      '| --- | --- | --- |',
      '| Migration plan | Dana | Oct 24 |',
      '| Benchmarks | Sam | Nov 2 |',
      '| Rollback runbook | Dana | Nov 9 |',
      '',
      '```js',
      'const index = await openIndex(vault, { rebuild: false });',
      '```',
    ].join('\n'), { tags: ['work', 'planning'], folderId: 'f-proj', pinned: true }),
    n('n-1on1', '1:1 with Sam', 'Talked through the benchmark setup. Sam wants a second machine with a slow disk to catch the worst case.\n\n- Borrow the old laptop from IT\n- Share the vault generator script', { tags: ['work'], folderId: 'f-work' }),
    n('n-groceries', 'Groceries', '- [ ] Oat milk\n- [ ] Lemons\n- [x] Coffee beans\n- [ ] Rice\n- [ ] Something for Friday dinner', { folderId: 'f-home', tags: ['errands'] }),
    n('n-reading', 'Reading list', '1. *The Design of Everyday Things*, Don Norman\n2. *Thinking with Type*, Ellen Lupton\n3. *A Pattern Language*, Christopher Alexander\n\nStarted Norman again. The chapter on feedback is the one to reread every year.', { tags: ['books'] }),
    n('n-ideas', 'Ideas for the garden', 'Move the herbs to the south bed, where they get the afternoon sun. Try garlic in October.\n\nAsk the neighbour about the fence before spring.', { folderId: 'f-home' }),
    n('n-retro', 'Sprint retro notes', '## What went well\nThe new review checklist caught two real bugs.\n\n## What to change\nStand-ups ran long. Try a 10 minute cap with a visible timer.', { tags: ['work', 'meetings'], folderId: 'f-work' }),
    n('n-quick', 'Untitled', 'Call the dentist about moving Thursday.', {}),
    n('n-long', 'Notes on writing tools', Array.from({ length: 6 }, (_, i) => `## Part ${i + 1}\nA good writing tool disappears while you write and shows up the moment you need it. The interface should never ask for attention it has not earned. Typography carries most of the experience: the measure, the leading and the contrast decide whether a long session feels calm or tiring.\n`).join('\n'), { tags: ['writing'] }),
    n('b1', 'Getting started', 'This guide collects what we learned on the trail.\n\nEach page covers one region.', { folderId: 'f-book' }),
    n('b2', 'Birds of the ridge', 'Ravens nest on the north face. Listen for the knocking call in the early morning.', { folderId: 'f-book' }),
    n('b3', 'Wildflowers', 'Lupine blooms in late June above the tree line.', { folderId: 'f-book' }),
  ];
  return { schemaVersion: 1, settings: { hotkey: 'Control+Alt+Shift+F7', openAtLogin: false, gitEnabled: false }, folders, vaults: [], notes };
}

// Opens a note by title: from the list or the folder view when it is on screen, else through the palette.
const openNote = (title) => async (page) => {
  if ((await page.inputValue('#titleInput').catch(() => '')) === title && await page.isVisible('#titleInput')) return;
  const row = page.locator('.note-card, .note-tree .tree-note', { hasText: title }).first();
  if (await row.count() && await row.isVisible()) await row.click();
  else {
    await page.keyboard.press('Control+p');
    await sleep(250);
    await page.keyboard.type(title);
    await sleep(400);
    await page.keyboard.press('Enter');
  }
  await sleep(500);
};
// Puts the caret at the end of the open note's text and types there.
const typeAtEnd = (text, newLine) => async (page) => {
  await page.click('.rich-editor-content');
  await page.keyboard.press('Control+End');
  await sleep(200); // the editor moves the caret on its next frame; Enter before that splits the word under the click
  if (newLine) await page.keyboard.press('Enter');
  await page.keyboard.type(text);
  await sleep(400);
};
const key = (combo) => async (page) => { await page.keyboard.press(combo); await sleep(350); };
const steps = (...fns) => async (page) => { for (const fn of fns) await fn(page); };

const SCENES = {
  empty: { about: 'No note open (the last tab closed)', run: key('Control+w') },
  main: { about: 'A long, rich note open with the list and sidebar', run: openNote('Q4 planning') },
  'short-note': { about: 'A short checklist note', run: openNote('Groceries') },
  focus: { about: 'Sidebar and list hidden: the writing view', run: steps(openNote('Notes on writing tools'), key('Control+\\'), key('Control+Shift+\\')) },
  find: { about: 'Find and replace in a note', run: steps(openNote('Q4 planning'), key('Control+h')) },
  settings: { about: 'The settings dialog', run: key('Control+,') },
  share: { about: 'The share menu', run: steps(openNote('Q4 planning'), key('Control+Shift+s')) },
  book: { about: 'A book: pages as tabs', run: openNote('Birds of the ridge') },
  bot: { about: 'The Claude Code panel', run: steps(openNote('Q4 planning'), key('Control+Shift+a')) },
  search: { about: 'Searching the list', run: async (page) => { await page.keyboard.press('Control+f'); await page.keyboard.type('bench'); await sleep(500); } },
  trash: { about: 'The trash view, empty', run: async (page) => { await page.locator('[data-view="trash"]').first().click(); await sleep(400); } },
  palette: { about: 'The command palette, empty query', run: key('Control+p') },
  'palette-query': { about: 'The command palette, typing', run: async (page) => { await page.keyboard.press('Control+p'); await sleep(250); await page.keyboard.type('plan'); await sleep(400); } },
  more: { about: 'The More menu of a note', run: steps(openNote('Q4 planning'), async (page) => { await page.click('#moreBtn'); await sleep(300); }) },
  slash: { about: 'The "/" block menu in a note', run: steps(openNote('Ideas for the garden'), typeAtEnd('/', true)) },
  'slash-query': { about: 'The "/" block menu, filtered', run: steps(openNote('Ideas for the garden'), typeAtEnd('/che', true)) },
  wikilink: { about: 'The "[[" note picker', run: steps(openNote('Ideas for the garden'), typeAtEnd(' [[gro')) },
  'tree-view': { about: 'The note list as folders with their notes, and the open note headings under it', settings: { listMode: 'tree' }, run: openNote('Q4 planning') },
  'sidebar-float': { about: 'The sidebar unpinned, floated in from the left edge', settings: { sidebarCollapsed: true }, run: async (page) => { await page.mouse.move(2, 400); await sleep(600); } },
  small: { about: 'A small window (820x560) with a note open', size: { width: 820, height: 560 }, run: openNote('Q4 planning') },
};

// One fresh app per shot: the app restores tabs and panes at start, so reusing a window would leak one scene into the next.
async function shoot(theme, name, opts) {
  const dataDir = tmpDir('notes-shots-');
  const data = seed(Date.now());
  data.settings.theme = theme;
  Object.assign(data.settings, SCENES[name].settings || {});
  data.settings.window = { width: opts.size.width, height: opts.size.height };
  fs.writeFileSync(path.join(dataDir, 'notes.json'), JSON.stringify(data));
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT],
    env: Object.assign({}, process.env, {
      NOTES_APP_DATA_DIR: dataDir, NOTES_APP_NO_LOGIN_ITEM: '1', NOTES_APP_INACTIVE: '1',
      NOTES_APP_DRY_DICTATE: '1', NOTES_APP_DRY_PRINT: '1', NOTES_APP_DRY_NOTIFY: '1', NOTES_APP_DRY_TERMINAL: '1',
      NOTES_APP_CLAUDE_BIN: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'),
    }),
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('#app');
    await app.evaluate(({ BrowserWindow }, size) => { BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height); }, SCENES[name].size || opts.size);
    await page.evaluate(() => { window.confirm = () => true; return document.fonts && document.fonts.ready.then(() => true); });
    await sleep(900); // entrance animations
    await SCENES[name].run(page);
    await sleep(350);
    const file = path.join(opts.out, `${name}-${theme}.png`);
    await page.screenshot({ path: file });
    if (opts.screen) {
      // Bring the window to the front, read its rectangle in physical pixels, and copy that part of the screen.
      const r = await app.evaluate(({ BrowserWindow, screen }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.setAlwaysOnTop(true, 'screen-saver');
        w.showInactive();
        const b = w.getBounds();
        const sf = screen.getDisplayMatching(b).scaleFactor;
        return { x: Math.round(b.x * sf), y: Math.round(b.y * sf), width: Math.round(b.width * sf), height: Math.round(b.height * sf) };
      });
      await sleep(600);
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'screen-capture.ps1'),
        '-X', String(r.x), '-Y', String(r.y), '-Width', String(r.width), '-Height', String(r.height), '-Out', file.replace(/[.]png$/, '-screen.png')], { stdio: 'ignore' });
    }
    if (opts.eval) {
      // Evaluated through the debugger, so the page's CSP (no eval) does not apply.
      const result = await page.evaluate(fs.readFileSync(opts.eval, 'utf8'));
      fs.writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify(result, null, 2));
    }
    return file;
  } finally {
    // Wait for Electron to be gone before removing its data folder: Windows keeps files of a live process locked,
    // and a folder that could not be removed would be left in %TEMP%.
    const proc = app.process();
    const gone = new Promise((resolve) => { if (proc.exitCode !== null) resolve(); else proc.once('exit', resolve); });
    await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
    await Promise.race([gone, sleep(10000)]);
    try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) { /* the exit cleanup tries again */ }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.list) {
    for (const [name, s] of Object.entries(SCENES)) console.log(name.padEnd(12), s.about);
    return;
  }
  const names = opts.scenes || Object.keys(SCENES);
  const unknown = names.filter((n) => !SCENES[n]);
  if (unknown.length) throw new Error('Unknown scene(s): ' + unknown.join(', ') + '. Use --list.');
  fs.mkdirSync(opts.out, { recursive: true });
  // One run, one set of results: shots and metrics left from an earlier run would be read as this run's.
  for (const f of fs.readdirSync(opts.out)) if (/\.(png|json)$/i.test(f)) fs.rmSync(path.join(opts.out, f), { force: true });
  const all = [];
  for (const theme of opts.themes) for (const name of names) all.push(await shoot(theme, name, opts));
  console.log(all.join('\n'));
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message || err); process.exit(1); });
}

module.exports = { parseArgs, seed, SCENES };
