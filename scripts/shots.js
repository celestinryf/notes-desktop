'use strict';
/* Screenshots of the real app in named scenes, for design work: look at what you changed before you call it done.
   It runs against an isolated, seeded data folder (never the user's notes) and never takes keyboard focus.

   npm run shots                         every scene, light and dark, into %TEMP%\shots-notes-app
   npm run shots -- --scene main,settings --theme dark
   npm run shots -- --size 820x560 --out C:\some\folder
   npm run shots -- --list               the scene names
   npm run shots -- --eval metrics.js    also evaluate a script in each scene and save its result as <scene>-<theme>.json
                                         (for example the ui-audit skill's scripts/ui-metrics.js)
   npm run shots -- --css try.css        also inject a stylesheet into each scene before the shot, to compare a
                                         candidate style against the real one without editing styles.css
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
  const out = { scenes: null, themes: ['light', 'dark'], size: { width: 1280, height: 800 }, out: path.join(os.tmpdir(), 'shots-notes-app'), list: false, eval: null, css: null, screen: false };
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
    else if (a === '--css') { out.css = path.resolve(next()); if (!fs.existsSync(out.css)) throw new Error('No such file: ' + out.css); }
    else throw new Error('Unknown argument ' + a);
  }
  for (const t of out.themes) if (t !== 'light' && t !== 'dark') throw new Error('--theme is light, dark or both');
  return out;
}

/* Sample data: a believable notebook, so layouts are judged with real lengths, not lorem ipsum. */
// A real Word document (made with the docx library) and the file note that opens it, for scenes that need one.
async function sampleWordNote(dir) {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx');
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ text: 'Trail report', heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun('The north loop reopened on Saturday. '), new TextRun({ text: 'Bring water:', bold: true }), new TextRun(' the spring at mile four is dry.')] }),
    new Paragraph({ text: 'Conditions', heading: HeadingLevel.HEADING_2 }),
    new Paragraph({ text: 'Mud on the switchbacks below the ridge; the upper meadow is clear.' }),
  ] }] });
  const file = path.join(dir, 'Trail report.docx');
  fs.writeFileSync(file, await Packer.toBuffer(doc));
  const now = Date.now();
  return { id: 'n-word', title: 'Trail report.docx', body: '', tags: [], folderId: null, filePath: file, fileKind: 'docx', fileMtime: fs.statSync(file).mtimeMs, createdAt: now, updatedAt: now + 1000 };
}

// Text files, and the file notes that open them in the code editor.
const SAMPLE_FILES = {
  tex: ['trail.tex', String.raw`\documentclass{article}
\usepackage{amsmath}
\title{Trail notes}

\begin{document}
\maketitle

\section{Elevation}
The climb gains $\Delta h = 640\,\text{m}$ over the first loop.
% Check against the park map.

\end{document}
`],
  txt: ['trail.txt', `Trail notes

The north loop reopened on Saturday. Bring water: the spring at mile four is dry.

Mud on the switchbacks below the ridge; the upper meadow is clear.
`],
  csv: ['trail-log.csv', `date,trail,distance_km,elevation_m,notes
2026-09-06,North loop,8.4,640,"Mud on the switchbacks, upper meadow clear"
2026-09-13,Ridge path,11.2,910,Spring at mile four is dry
2026-09-20,Lake trail,5.1,120,
2026-09-27,North loop,8.4,640,"Reopened after the storm; bring water"
`],
  'csv-wide': ['readings.csv', sampleReadings(150)],
  png: ['ridge.png', samplePng(480, 300), 'image'],
  js: ['trail.js', `// Elevation gain over the first loop, in metres.
const loop = { name: 'North loop', gain: 640, open: true };

export function describe(trail) {
  return trail.name + ': ' + trail.gain + ' m' + (trail.open ? '' : ' (closed)');
}
`],
};
// A long, wide table for the CSV view: made-up test readings (a fixture, never shown to anyone but the screenshots),
// with gaps and "n/a" in a number column so its alignment is decided by the column, not cell by cell.
function sampleReadings(rows) {
  const head = 'station,date,temp_c,humidity_pct,wind_kmh,pressure_hpa,rain_mm,notes';
  const out = [head];
  for (let i = 0; i < rows; i++) {
    const day = String(1 + (i % 28)).padStart(2, '0');
    const temp = i % 17 === 5 ? 'n/a' : (8 + ((i * 7) % 15) + (i % 10) / 10).toFixed(1);
    const rain = i % 4 ? '' : ((i % 9) * 0.6).toFixed(1);
    const note = i % 6 === 0 ? '"Test row ' + (i + 1) + ': a longer note, so the cell is cut short and shows its whole text on hover"' : '';
    out.push(['Test ' + (1 + (i % 3)), '2026-09-' + day, temp, 40 + ((i * 11) % 50), (i * 3) % 40, 1000 + ((i * 13) % 30), rain, note].join(','));
  }
  return out.join('\n') + '\n';
}
// A small picture for the image viewer: a gradient with a transparent band, as a real PNG.
function samplePng(w, h) {
  const zlib = require('zlib');
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = 240 - Math.round((x / w) * 120); raw[o + 1] = 120 + Math.round((y / h) * 80); raw[o + 2] = 62; raw[o + 3] = y < h / 6 ? 0 : 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// A spreadsheet from scripts/fixtures (a small file made once with openpyxl, since
// Notes has no writer of its own for it) and the file note that opens it.
function sampleOfficeNote(dir, kind) {
  const name = { sheet: 'Trail readings.xlsx' }[kind];
  const file = path.join(dir, name);
  fs.copyFileSync(path.join(ROOT, 'scripts', 'fixtures', name), file);
  const now = Date.now();
  return { id: 'n-' + kind, title: name, body: '', tags: [], folderId: null, filePath: file, fileKind: kind, fileMtime: fs.statSync(file).mtimeMs, createdAt: now, updatedAt: now + 1500 };
}

function sampleFileNote(dir, kind) {
  const [name, content, fileKind] = SAMPLE_FILES[kind];
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  const now = Date.now();
  const body = typeof content === 'string' ? content : '';
  return { id: 'n-' + kind, title: name, body, tags: [], folderId: null, filePath: file, fileKind: fileKind || 'text', fileMtime: fs.statSync(file).mtimeMs, createdAt: now, updatedAt: now + 2000 };
}

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
  const row = page.locator('.note-row', { hasText: title }).first();
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
  'list-view': { about: 'The note list as one flat list (the title-row switch; folders are the default)', settings: { listMode: 'list', listLayout: 1 }, run: openNote('Q4 planning') },
  pinned: { about: 'The Pinned view: always a flat list, with the folder of each note trailing', run: async (page) => { await page.locator('[data-view="pinned"]').first().click(); await sleep(400); } },
  'settings-search': { about: 'Settings filtered by a search: only matching settings and sections stay', run: async (page) => { await page.keyboard.press('Control+,'); await sleep(400); await page.keyboard.type('width'); await sleep(400); } },
  'settings-appearance': { about: 'Settings > Appearance: theme, the scheme swatches, the custom colour pickers', run: async (page) => { await page.keyboard.press('Control+,'); await sleep(400); await page.click('#settingsNav a[href="#set-appearance"]'); await sleep(400); } },
  'settings-unsaved': { about: 'Settings with an unsaved change (the theme previewed on the page) and the Save changes button live', run: async (page) => { await page.keyboard.press('Control+,'); await sleep(400); await page.click('#settingsNav a[href="#set-appearance"]'); await page.click('.scheme-swatch[data-scheme="slate"]'); await sleep(400); } },
  'settings-save-prompt': { about: 'Closing Settings with unsaved changes: the Save your changes? question', run: async (page) => { await page.keyboard.press('Control+,'); await sleep(400); await page.click('.scheme-swatch[data-scheme="forest"]'); await page.keyboard.press('Escape'); await sleep(400); } },
  'settings-search-none': { about: 'A settings search with no match', run: async (page) => { await page.keyboard.press('Control+,'); await sleep(400); await page.keyboard.type('zzqx'); await sleep(400); } },
  'sidebar-float': { about: 'The sidebar unpinned, floated in from the left edge', settings: { sidebarCollapsed: true }, run: async (page) => { await page.mouse.move(2, 400); await sleep(600); } },
  'sidebar-float-resize': { about: 'The floating sidebar widened by dragging its right edge, the handle still under the pointer', settings: { sidebarCollapsed: true }, run: async (page) => {
    await page.mouse.move(2, 400); await sleep(600);
    const box = await page.locator('#sidebarResizer').boundingBox();
    const x = box.x + box.width / 2, y = box.y + 300;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 40, y, { steps: 4 }); await page.mouse.move(x + 80, y, { steps: 4 }); await page.mouse.up();
    await page.mouse.move(x + 80, y); await sleep(500);
  } },
  'two-tabs': { about: 'Two tabs open: the tabs show (with one, they do not)', run: steps(openNote('Q4 planning'), key('Control+t'), openNote('Groceries')) },
  // A test seed to prove derivation end to end, not a premade scheme (those are still to be designed with the user).
  'scheme-custom': { about: 'A custom colour scheme (test colours), derived from three seeds per mode', settings: { colorScheme: 'custom', customColors: {
    light: { background: '#f2f5f7', text: '#1b2530', accent: '#2b6cb0' }, dark: { background: '#141a21', text: '#e3e9ef', accent: '#5b9bd5' } } }, run: openNote('Q4 planning') },
  word: { about: 'A Word document open in WordCraft (needs its web build)', word: true, run: steps(openNote('Trail report.docx'), async () => { await sleep(8000); }) },
  sheet: { about: 'A spreadsheet open in GridCraft (needs its web build)', office: 'sheet', run: steps(openNote('Trail readings.xlsx'), async () => { await sleep(8000); }) },
  'sheet-nobuild': { about: 'A spreadsheet with no GridCraft build: the banner and "Open with…"', office: 'sheet', env: { NOTES_APP_NO_GRIDCRAFT: '1' }, run: openNote('Trail readings.xlsx') },
  tex: { about: 'A LaTeX file open in the code editor', file: 'tex', run: openNote('trail.tex') },
  'tex-small': { about: 'The code editor in a small window', file: 'tex', size: { width: 820, height: 560 }, run: openNote('trail.tex') },
  'tex-focus': { about: 'The code editor focused: caret, active line and number', file: 'tex', run: steps(openNote('trail.tex'), async (page) => { await page.click('#codeHost .cm-line >> nth=8'); await page.keyboard.press('End'); await sleep(300); }) },
  txt: { about: 'A .txt file: the plain text box, in the writing font', file: 'txt', run: openNote('trail.txt') },
  'code-js': { about: 'A JavaScript file in the code editor', file: 'js', run: openNote('trail.js') },
  csv: { about: 'A CSV file as a table (Ctrl+E edits it as text)', file: 'csv', run: openNote('trail-log.csv') },
  'csv-wide': { about: 'A long, wide CSV scrolled down and right: the header and row numbers stay', file: 'csv-wide', size: { width: 900, height: 640 },
    run: steps(openNote('readings.csv'), async (page) => { await page.evaluate(() => { const v = document.getElementById('csvView'); v.scrollTop = 900; v.scrollLeft = 260; }); await sleep(300); }) },
  image: { about: 'An image file in the image viewer', file: 'png', run: openNote('ridge.png') },
  'image-actual': { about: 'An image at its actual size', file: 'png', run: steps(openNote('ridge.png'), async (page) => { await page.click('#imageView'); await sleep(300); }) },
  dropdown: { about: 'A select open: the note list sort', run: async (page) => { await page.click('#sortSelect'); await sleep(400); } },
  'dropdown-keys': { about: 'A select open, moved through with the keyboard', run: async (page) => { await page.click('#sortSelect'); await sleep(300); await page.keyboard.press('ArrowDown'); await sleep(300); } },
  'dropdown-folder': { about: 'The folder select over a note title, open', run: steps(openNote('Q4 planning'), async (page) => { await page.click('#folderSelect'); await sleep(400); }) },
  small: { about: 'A small window (820x560) with a note open', size: { width: 820, height: 560 }, run: openNote('Q4 planning') },
};

// One fresh app per shot: the app restores tabs and panes at start, so reusing a window would leak one scene into the next.
async function shoot(theme, name, opts) {
  const dataDir = tmpDir('notes-shots-');
  const data = seed(Date.now());
  data.settings.theme = theme;
  Object.assign(data.settings, SCENES[name].settings || {});
  data.settings.window = { width: opts.size.width, height: opts.size.height };
  if (SCENES[name].word) data.notes.push(await sampleWordNote(dataDir));
  if (SCENES[name].file) data.notes.push(sampleFileNote(dataDir, SCENES[name].file));
  if (SCENES[name].office) data.notes.push(sampleOfficeNote(dataDir, SCENES[name].office));
  fs.writeFileSync(path.join(dataDir, 'notes.json'), JSON.stringify(data));
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT],
    env: Object.assign({}, process.env, {
      NOTES_APP_DATA_DIR: dataDir, NOTES_APP_NO_LOGIN_ITEM: '1', NOTES_APP_INACTIVE: '1',
      NOTES_APP_DRY_DICTATE: '1', NOTES_APP_DRY_PRINT: '1', NOTES_APP_DRY_NOTIFY: '1', NOTES_APP_DRY_SPEECH: '1', NOTES_APP_DRY_TERMINAL: '1',
      NOTES_APP_CLAUDE_BIN: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'),
    }, SCENES[name].env || {}),
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('#app');
    await app.evaluate(({ BrowserWindow }, size) => { BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height); }, SCENES[name].size || opts.size);
    await page.evaluate(() => { window.confirm = () => true; return document.fonts && document.fonts.ready.then(() => true); });
    await sleep(900); // entrance animations
    if (opts.css) await page.addStyleTag({ content: fs.readFileSync(opts.css, 'utf8') }); // a candidate style over the real one
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
