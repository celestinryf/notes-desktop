'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir } = require('../helpers/tmp.js');
const { candidateDirs, detectTex, distributionOf } = require('../../src/tex-engine.mts');
const { compileTex, stopCompile } = require('../../src/tex-compile.mts');

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

async function fakeInstall() {
  const dir = copyFake(path.join(tmpDir('notes-tex-run-'), 'bin'));
  const found = await detectTex(env({ NOTES_APP_TEX_DIR: dir }));
  assert.ok(found.install);
  return found.install;
}

function texFile(body, name) {
  const dir = tmpDir('notes-tex-doc-');
  const file = path.join(dir, name || 'main.tex');
  fs.writeFileSync(file, body);
  return file;
}

const OPTIONS = { engine: 'pdflatex', haltOnError: false };

test('a clean compile writes the PDF beside the file and reports no issues', async () => {
  const install = await fakeInstall();
  const file = texFile('\\documentclass{article}\nHello compiled world\n');
  const out = await compileTex(file, fs.readFileSync(file, 'utf8'), install, OPTIONS);
  assert.equal(out.ok, true, out.message);
  assert.equal(out.pdf, path.join(path.dirname(file), 'main.pdf'));
  assert.ok(fs.existsSync(out.pdf));
  assert.deepEqual([out.log.errors, out.log.warnings], [0, 0]);
  assert.deepEqual(out.steps, ['pdflatex']);
});

test('an error is reported with its line, and the PDF still comes out', async () => {
  const install = await fakeInstall();
  const file = texFile('\\documentclass{article}\nfirst\n\\FAKEERROR here\n');
  const out = await compileTex(file, fs.readFileSync(file, 'utf8'), install, OPTIONS);
  assert.equal(out.ok, true);
  assert.equal(out.log.errors, 1);
  assert.deepEqual([out.log.issues[0].file, out.log.issues[0].line], ['main.tex', 3]);
  assert.ok(out.pdf);
});

test('a fatal run has no PDF', async () => {
  const install = await fakeInstall();
  const file = texFile('\\FAKEFATAL\n');
  const out = await compileTex(file, fs.readFileSync(file, 'utf8'), install, OPTIONS);
  assert.equal(out.ok, true);
  assert.equal(out.pdf, null);
  assert.equal(out.log.fatal, true);
});

test('the root named by a magic comment is what gets compiled', async () => {
  const install = await fakeInstall();
  const main = texFile('\\documentclass{article}\nThe root\n', 'thesis.tex');
  const dir = path.dirname(main);
  fs.mkdirSync(path.join(dir, 'chapters'));
  const chapter = path.join(dir, 'chapters', 'one.tex');
  fs.writeFileSync(chapter, '% !TEX root = ../thesis.tex\n\\section{One}\n');
  const out = await compileTex(chapter, fs.readFileSync(chapter, 'utf8'), install, OPTIONS);
  assert.equal(out.ok, true);
  assert.equal(out.root, main);
  assert.equal(out.pdf, path.join(dir, 'thesis.pdf'));
});

test('a missing root says so', async () => {
  const install = await fakeInstall();
  const file = texFile('% !TEX root = nowhere.tex\n');
  const out = await compileTex(file, fs.readFileSync(file, 'utf8'), install, OPTIONS);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'failed');
  assert.match(out.message, /nowhere\.tex/);
});

test('the program magic comment picks the engine', async () => {
  const install = await fakeInstall();
  const file = texFile('% !TEX program = xelatex\nHello\n');
  const out = await compileTex(file, fs.readFileSync(file, 'utf8'), install, OPTIONS);
  assert.equal(out.ok, true);
  assert.equal(out.engine, 'xelatex');
  assert.deepEqual(out.steps, ['xelatex']);
});

test('a second compile or a stop ends the one running', async () => {
  const install = await fakeInstall();
  const file = texFile('Slow\n');
  process.env.FAKE_TEX_DELAY_MS = '4000';
  try {
    const first = compileTex(file, fs.readFileSync(file, 'utf8'), install, OPTIONS);
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(stopCompile(file), true);
    const out = await first;
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'stopped');
    assert.equal(stopCompile(file), false, 'nothing left running');
  } finally { delete process.env.FAKE_TEX_DELAY_MS; }
});
