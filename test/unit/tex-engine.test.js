'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir } = require('../helpers/tmp.js');
const { candidateDirs, detectTex, distributionOf } = require('../../src/tex-engine.mts');
const { stopAllCompiles } = require('../../src/tex-compile.mts');
const { TexService, NO_TEX } = require('../../src/tex-service.mts');

const FAKE = path.join(__dirname, '..', 'fixtures', 'fake-tex');
const copyFake = (into) => { fs.mkdirSync(into, { recursive: true }); for (const f of fs.readdirSync(FAKE)) fs.copyFileSync(path.join(FAKE, f), path.join(into, f)); return into; };
const env = (extra) => Object.assign({ PATH: process.env.PATH, SystemDrive: 'Z:' }, extra);

test('the candidates are PATH, MiKTeX for this user, MiKTeX for all users, then TeX Live newest first, each once and only if it exists', () => {
  const root = tmpDir('notes-tex-dirs-');
  const onPath = fs.mkdirSync(path.join(root, 'bin'), { recursive: true }) || path.join(root, 'bin');
  const user = path.join(root, 'local', 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64');
  const all = path.join(root, 'pf', 'MiKTeX', 'miktex', 'bin', 'x64');
  const live24 = path.join(root, 'drive', 'texlive', '2024', 'bin', 'windows');
  const live26 = path.join(root, 'drive', 'texlive', '2026', 'bin', 'windows');
  for (const d of [user, all, live24, live26]) fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(root, 'drive', 'texlive', 'texmf-local'), { recursive: true });
  const dirs = candidateDirs({ PATH: [onPath, onPath, path.join(root, 'missing')].join(path.delimiter), LOCALAPPDATA: path.join(root, 'local'), ProgramFiles: path.join(root, 'pf'), SystemDrive: path.join(root, 'drive') });
  assert.deepEqual(dirs, [onPath, user, all, live26, live24]);
});

test('NOTES_APP_TEX_DIR overrides every other place', () => {
  const dir = tmpDir('notes-tex-only-');
  assert.deepEqual(candidateDirs({ NOTES_APP_TEX_DIR: dir, PATH: process.env.PATH }), [path.resolve(dir)]);
});

test('no TeX anywhere is reported with the places looked at', async () => {
  const empty = tmpDir('notes-tex-none-');
  const found = await detectTex(env({ PATH: empty }));
  assert.equal(found.install, null);
  assert.equal(found.problem, null);
  assert.ok(found.looked.includes(empty));
});

test('a TeX found with kpsewhich working gives the engines and the distribution', async () => {
  const dir = copyFake(path.join(tmpDir('notes-tex-found-'), 'bin'));
  const found = await detectTex(env({ NOTES_APP_TEX_DIR: dir }));
  assert.ok(found.install, found.problem || 'not found');
  assert.equal(found.install.dir, dir);
  assert.deepEqual(Object.keys(found.install.engines).sort(), ['lualatex', 'pdflatex', 'xelatex']);
  assert.equal(found.install.distribution, 'Fake TeX 2026');
  assert.equal(found.install.latexmk, null);
});

test('an engine without a working kpsewhich is a broken install, said plainly', async () => {
  const dir = copyFake(path.join(tmpDir('notes-tex-broken-'), 'bin'));
  fs.unlinkSync(path.join(dir, 'kpsewhich.cmd'));
  const missing = await detectTex(env({ NOTES_APP_TEX_DIR: dir }));
  assert.equal(missing.install, null);
  assert.match(missing.problem, /no kpsewhich beside it/);
  const dir2 = copyFake(path.join(tmpDir('notes-tex-broken2-'), 'bin'));
  const failing = await detectTex(env({ NOTES_APP_TEX_DIR: dir2 }), async (exe, args) => (/kpsewhich/.test(exe.file) ? { code: 3, stdout: '' } : { code: 0, stdout: 'pdfTeX (MiKTeX 24.4)' }));
  assert.equal(failing.install, null);
  assert.match(failing.problem, /kpsewhich did not run/);
});

test('the distribution is read from the engine version line', () => {
  assert.equal(distributionOf('MiKTeX-pdfTeX 4.20 (MiKTeX 24.4)\n© 2024'), 'MiKTeX 24.4');
  assert.equal(distributionOf('pdfTeX 3.141592653-2.6-1.40.26 (TeX Live 2024) (preloaded format=pdflatex)'), 'TeX Live 2024');
  assert.equal(distributionOf(''), 'TeX');
});

function texFile(body, name) {
  const dir = tmpDir('notes-tex-doc-');
  const file = path.join(dir, name || 'main.tex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

function service(extra) {
  const dir = copyFake(path.join(tmpDir('notes-tex-run-'), 'bin'));
  if (extra) extra(dir);
  return new TexService(env({ NOTES_APP_TEX_DIR: dir }));
}

const OPTIONS = { engine: 'pdflatex', haltOnError: false, compileOnSave: false };
const runsOf = (file) => Number(fs.readFileSync(file.replace(/\.tex$/, '.runs'), 'utf8'));

test('a clean compile writes the PDF beside the file and reports no issues', async () => {
  const file = texFile('\\documentclass{article}\nHello compiled world\n');
  const out = await service().compile('n1', file, OPTIONS);
  assert.equal(out.ok, true, out.message);
  assert.equal(out.pdf, path.join(path.dirname(file), 'main.pdf'));
  assert.ok(fs.existsSync(out.pdf));
  assert.deepEqual([out.log.errors, out.log.warnings], [0, 0]);
  assert.deepEqual(out.steps, ['pdflatex']);
});

test('an error is reported with its line, and the PDF still comes out', async () => {
  const file = texFile('\\documentclass{article}\nfirst\n\\FAKEERROR here\n');
  const out = await service().compile('n1', file, OPTIONS);
  assert.equal(out.ok, true);
  assert.equal(out.log.errors, 1);
  assert.deepEqual([out.log.issues[0].file, out.log.issues[0].line], ['main.tex', 3]);
  assert.ok(out.pdf);
});

test('a fatal run has no PDF', async () => {
  const out = await service().compile('n1', texFile('\\FAKEFATAL\n'), OPTIONS);
  assert.equal(out.ok, true);
  assert.equal(out.pdf, null);
  assert.equal(out.log.fatal, true);
});

test('an engine that writes no log is a failure, and an old log is never read as the new one', async () => {
  const file = texFile('\\FAKENOLOG\n');
  fs.writeFileSync(file.replace(/\.tex$/, '.log'), './main.tex:1: Undefined control sequence.\nl.1 old\n');
  const old = Date.now() - 60000;
  fs.utimesSync(file.replace(/\.tex$/, '.log'), old / 1000, old / 1000);
  const out = await service().compile('n1', file, OPTIONS);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'failed');
  assert.match(out.message, /pdflatex stopped before writing its log \(exit code 3\)/);
  assert.equal(out.log, null, 'the stale log is not shown');
});

test('the root named by a magic comment is what gets compiled', async () => {
  const main = texFile('\\documentclass{article}\nThe root\n', 'thesis.tex');
  const dir = path.dirname(main);
  fs.mkdirSync(path.join(dir, 'chapters'));
  const chapter = path.join(dir, 'chapters', 'one.tex');
  fs.writeFileSync(chapter, '% !TEX root = ../thesis.tex\n\\section{One}\n');
  const out = await service().compile('n1', chapter, OPTIONS);
  assert.equal(out.ok, true);
  assert.equal(out.root, main);
  assert.equal(out.pdf, path.join(dir, 'thesis.pdf'));
});

test('a root outside the file\'s folder and the three above it is refused', async () => {
  const deep = texFile('% !TEX root = ../../../../../elsewhere/x.tex\n', path.join('a', 'b', 'c', 'd', 'main.tex'));
  const out = await service().compile('n1', deep, OPTIONS);
  assert.equal(out.ok, false);
  assert.match(out.message, /outside this file's folder/);
  const sideways = texFile('% !TEX root = ../other/x.tex\n', path.join('a', 'main.tex'));
  fs.mkdirSync(path.join(path.dirname(sideways), '..', 'other'), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(sideways), '..', 'other', 'x.tex'), 'x');
  const out2 = await service().compile('n1', sideways, OPTIONS);
  assert.equal(out2.ok, false);
  assert.match(out2.message, /outside this file's folder/);
  const absolute = texFile('% !TEX root = ' + path.join(tmpDir('notes-tex-far-'), 'far.tex') + '\n');
  assert.match((await service().compile('n1', absolute, OPTIONS)).message, /outside this file's folder/);
});

test('a missing root or a missing file says which', async () => {
  const out = await service().compile('n1', texFile('% !TEX root = nowhere.tex\n'), OPTIONS);
  assert.equal(out.ok, false);
  assert.match(out.message, /nowhere\.tex.*does not exist/);
  const gone = await service().compile('n1', path.join(tmpDir('notes-tex-gone-'), 'gone.tex'), OPTIONS);
  assert.match(gone.message, /gone\.tex is no longer on disk/);
});

test('the program magic comment picks the engine', async () => {
  const out = await service().compile('n1', texFile('% !TEX program = xelatex\nHello\n'), OPTIONS);
  assert.equal(out.ok, true);
  assert.equal(out.engine, 'xelatex');
  assert.deepEqual(out.steps, ['xelatex']);
});

test('reruns until the log stops asking, four runs at most', async () => {
  const file = texFile('\\FAKERERUN\n');
  const out = await service().compile('n1', file, OPTIONS);
  assert.deepEqual(out.steps, ['pdflatex', 'pdflatex', 'pdflatex', 'pdflatex']);
  assert.equal(runsOf(file), 4);
  assert.equal(out.log.rerun, true);
});

test('bibtex runs when the aux file asks for it, then the engine again', async () => {
  const file = texFile('Text\\cite{a}\n\\bibliography{refs}\n');
  const out = await service().compile('n1', file, OPTIONS);
  assert.deepEqual(out.steps, ['pdflatex', 'bibtex', 'pdflatex']);
  assert.ok(fs.existsSync(file.replace(/\.tex$/, '.bbl')));
});

test('latexmk is used when it runs, with no rc files', async () => {
  const svc = service((dir) => fs.writeFileSync(path.join(dir, 'latexmk.cmd'), '@node "%~dp0\\fake-tex.js" %*\r\n'));
  assert.equal((await svc.status()).latexmk, true);
  const out = await svc.compile('n1', texFile('Hello\n'), OPTIONS);
  assert.equal(out.ok, true);
  assert.deepEqual(out.steps, ['latexmk']);
});

test('a compile past its cap is stopped and says so', async () => {
  process.env.FAKE_TEX_DELAY_MS = '5000';
  try {
    const started = Date.now();
    const out = await service().compile('n1', texFile('Slow\n'), OPTIONS, 600);
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'timeout');
    assert.ok(Date.now() - started < 4500, 'the engine was killed, not waited for');
  } finally { delete process.env.FAKE_TEX_DELAY_MS; }
});

test('Stop ends the compile of that note, and stopping all ends every one', async () => {
  const svc = service();
  process.env.FAKE_TEX_DELAY_MS = '5000';
  try {
    const first = svc.compile('n1', texFile('Slow one\n'), OPTIONS);
    const second = svc.compile('n2', texFile('Slow two\n'), OPTIONS);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(svc.stop('n1'), true);
    assert.equal((await first).reason, 'stopped');
    assert.equal(svc.stop('nobody'), false);
    stopAllCompiles();
    assert.equal((await second).reason, 'stopped');
    assert.equal(svc.stop('n2'), false, 'nothing left running');
  } finally { delete process.env.FAKE_TEX_DELAY_MS; }
});

test('a second compile of the same root waits for the first to end', async () => {
  const svc = service();
  const file = texFile('Twice\n');
  process.env.FAKE_TEX_DELAY_MS = '1500';
  try {
    const first = svc.compile('n1', file, OPTIONS);
    await new Promise((r) => setTimeout(r, 400));
    delete process.env.FAKE_TEX_DELAY_MS;
    const second = await svc.compile('n1', file, OPTIONS);
    assert.equal((await first).reason, 'stopped');
    assert.equal(second.ok, true);
    assert.equal(runsOf(file), 1, 'only the second run finished writing');
  } finally { delete process.env.FAKE_TEX_DELAY_MS; }
});

test('Clear build files removes only build files, and not while compiling', async () => {
  const svc = service();
  const file = texFile('Hello\n');
  await svc.compile('n1', file, OPTIONS);
  const dir = path.dirname(file);
  fs.writeFileSync(path.join(dir, 'refs.bib'), '@book{a}');
  assert.ok(svc.clean('n1', file) >= 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['main.pdf', 'main.runs', 'main.tex', 'refs.bib']);
  process.env.FAKE_TEX_DELAY_MS = '3000';
  try {
    const running = svc.compile('n1', file, OPTIONS);
    await new Promise((r) => setTimeout(r, 400));
    assert.throws(() => svc.clean('n1', file), /Stop the compile/);
    svc.stop('n1');
    await running;
  } finally { delete process.env.FAKE_TEX_DELAY_MS; }
});

test('no TeX gives one plain message', async () => {
  const svc = new TexService(env({ NOTES_APP_TEX_DIR: tmpDir('notes-tex-empty-') }));
  const out = await svc.compile('n1', texFile('x'), OPTIONS);
  assert.equal(out.reason, 'no-tex');
  assert.equal(out.message, NO_TEX);
  assert.deepEqual(await svc.status(), { found: false, looked: [path.resolve(svc.env.NOTES_APP_TEX_DIR)], problem: null });
});
