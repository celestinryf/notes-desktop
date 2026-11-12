'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseTexLog, unwrapLog } = require('../../src/shared/tex-log.mts');
const B = require('../../src/tex-build.mts');

const LOGS = path.join(__dirname, '..', 'fixtures', 'tex-logs');
const logOf = (name) => parseTexLog(fs.readFileSync(path.join(LOGS, name), 'utf8'));
const brief = (issues) => issues.map((i) => [i.kind, i.file, i.line, i.message]);

test('a clean run has no issues', () => {
  const r = logOf('clean.texlog');
  assert.deepEqual([r.errors, r.warnings, r.badBoxes, r.rerun, r.fatal], [0, 0, 0, false, false]);
  assert.deepEqual(r.issues, []);
});

test('an undefined control sequence without file:line is placed by the open file and l.N', () => {
  const r = logOf('undefined-control-sequence.texlog');
  assert.deepEqual(brief(r.issues), [['error', 'chapters/intro.tex', 7, 'Undefined control sequence.']]);
  assert.match(r.issues[0].detail, /^l\.7 The speed is \\velocity/);
  assert.equal(r.fatal, false);
});

test('a missing package is one error at its line, and the run is fatal', () => {
  const r = logOf('missing-package.texlog');
  assert.deepEqual(brief(r.issues), [['error', 'main.tex', 3, "LaTeX Error: File `fancyheadings.sty' not found."]]);
  assert.equal(r.fatal, true);
});

test('warnings join their continuation lines and keep their input line; bad boxes keep their first line', () => {
  const r = logOf('warnings-and-boxes.texlog');
  assert.deepEqual(brief(r.issues), [
    ['warning', 'main.tex', 14, "Token not allowed in a PDF string (Unicode): removing `math shift' on input line 14."],
    ['warning', 'main.tex', 22, "Reference `fig:loop' on page 1 undefined on input line 22."],
    ['badbox', 'main.tex', 30, 'Overfull \\hbox (12.34567pt too wide) in paragraph at lines 30--32'],
    ['badbox', 'main.tex', 41, 'Underfull \\hbox (badness 10000) in paragraph at lines 41--41'],
    ['warning', 'main.tex', null, 'There were undefined references.'],
    ['warning', 'main.tex', null, 'Label(s) may have changed. Rerun to get cross-references right.'],
  ]);
  assert.deepEqual([r.errors, r.warnings, r.badBoxes, r.rerun], [0, 4, 2, true]);
  assert.equal(r.issues[0].detail, 'Package hyperref');
});

test('MiKTeX file:line:error messages, with Windows paths in the file stack', () => {
  const r = logOf('miktex-file-line-error.texlog');
  assert.deepEqual(brief(r.issues), [['error', 'resume.tex', 48, 'Missing $ inserted.'], ['error', 'resume.tex', 52, 'Extra }, or forgotten $.']]);
});

test('a file path TeX wrapped at 79 columns is joined back', () => {
  const r = logOf('wrapped-path.texlog');
  assert.deepEqual(brief(r.issues), [['error', 'sections/a-section-with-a-rather-long-name-that-makes-the-path-wrap-in-the-log-file.tex', 4, 'Undefined control sequence.']]);
});

test('unwrapLog joins only lines of exactly the wrap width', () => {
  const long = 'x'.repeat(79);
  assert.deepEqual(unwrapLog(long + '\nyz\nshort\n'), [long + 'yz', 'short', '']);
  assert.deepEqual(unwrapLog('a\r\nb'), ['a', 'b']);
  assert.deepEqual(unwrapLog(''), ['']);
});

test('an empty or missing log parses to nothing', () => {
  for (const s of ['', null, undefined]) assert.deepEqual(parseTexLog(s).issues, []);
});

test('magic comments name the root, the program and the bibliography tool', () => {
  assert.deepEqual(B.readMagic('% !TEX root = ../main.tex\n% !TEX program = xelatex\n% !BIB program = biber\n\\section{A}'), { root: '../main.tex', program: 'xelatex', bib: 'biber' });
  assert.deepEqual(B.readMagic('%!TeX TS-program = LuaLaTeX\n'), { root: null, program: 'lualatex', bib: null });
  assert.deepEqual(B.readMagic('% !TEX program = context\n'), { root: null, program: null, bib: null }, 'an engine Notes does not run is ignored');
  assert.deepEqual(B.readMagic('\\documentclass{article}\n% !TEX program = xelatex'), { root: null, program: 'xelatex', bib: null });
  const late = Array.from({ length: 25 }, () => '%').join('\n') + '\n% !TEX program = xelatex';
  assert.equal(B.readMagic(late).program, null, 'only the first 20 lines count');
  assert.equal(B.readMagic('% !TEX root = a.tex\n% !TEX root = b.tex').root, 'a.tex', 'the first one wins');
  assert.deepEqual(B.readMagic(''), { root: null, program: null, bib: null });
});

test('the root resolves beside the file and gains .tex when it has none', () => {
  const file = path.join('C:', 'thesis', 'chapters', 'intro.tex');
  assert.equal(B.rootFor(file, B.readMagic('')), file);
  assert.equal(B.rootFor(file, B.readMagic('% !TEX root = ../main.tex')), path.join('C:', 'thesis', 'main.tex'));
  assert.equal(B.rootFor(file, B.readMagic('% !TEX root = ../main')), path.join('C:', 'thesis', 'main.tex'));
});

test('the magic comment beats the chosen engine', () => {
  const options = { engine: 'pdflatex', haltOnError: false };
  assert.equal(B.engineFor(B.readMagic(''), options), 'pdflatex');
  assert.equal(B.engineFor(B.readMagic('% !TEX program = lualatex'), options), 'lualatex');
  assert.equal(B.engineFor(B.readMagic(''), { engine: 'xelatex', haltOnError: false }), 'xelatex');
});

test('commands never wait on the keyboard, write SyncTeX and file:line errors, and stop on the first error only when asked', () => {
  const file = path.join('C:', 'x', 'main.tex');
  assert.deepEqual(B.engineArgs(file, { engine: 'pdflatex', haltOnError: false }), ['-interaction=nonstopmode', '-synctex=1', '-file-line-error', 'main.tex']);
  assert.deepEqual(B.engineArgs(file, { engine: 'pdflatex', haltOnError: true }), ['-interaction=nonstopmode', '-synctex=1', '-file-line-error', '-halt-on-error', 'main.tex']);
  assert.deepEqual(B.latexmkArgs(file, 'xelatex', { engine: 'pdflatex', haltOnError: false }), ['-pdfxe', '-interaction=nonstopmode', '-synctex=1', '-file-line-error', 'main.tex']);
  assert.equal(B.latexmkArgs(file, 'lualatex', { engine: 'pdflatex', haltOnError: false })[0], '-pdflua');
  assert.equal(B.latexmkArgs(file, 'pdflatex', { engine: 'pdflatex', haltOnError: false })[0], '-pdf');
});

test('build files and the PDF sit beside the root', () => {
  const root = path.join('C:', 'x', 'my thesis.tex');
  assert.equal(B.pdfFor(root), path.join('C:', 'x', 'my thesis.pdf'));
  const files = B.buildFiles(root);
  assert.ok(files.includes(path.join('C:', 'x', 'my thesis.aux')));
  assert.ok(files.includes(path.join('C:', 'x', 'my thesis.synctex.gz')));
  assert.ok(!files.some((f) => /\.(tex|pdf|bib)$/.test(f)), 'never the source, the PDF or the bibliography');
});

test('bibliography tools are run when the aux file asks for them', () => {
  assert.equal(B.needsBibtex('\\bibstyle{plain}\n\\bibdata{refs}\n'), true);
  assert.equal(B.needsBibtex('\\relax\n'), false);
  assert.equal(B.needsBiber('\\abx@aux@refcontext{nty/global//global/global}', ''), true);
  assert.equal(B.needsBiber('', 'Package biblatex Warning: Please (re)run Biber on the file:'), true);
  assert.equal(B.needsBiber('\\relax', ''), false);
});

const R = require('../../src/shared/tex-results.mts');
const T = require('../../src/shared/tex-magic.mts');
const Hl = require('../../src/shared/helpers.mts');

const log = (over) => Object.assign({ issues: [], errors: 0, warnings: 0, badBoxes: 0, rerun: false, fatal: false }, over);
const ok = (over) => Object.assign({ ok: true, root: 'C:/x/main.tex', pdf: 'C:/x/main.pdf', engine: 'pdflatex', log: log(), ms: 1200, steps: ['pdflatex'] }, over);
const failed = (reason) => ({ ok: false, root: null, reason, message: 'm', log: null, ms: 0, steps: [] });

test('the status line says what happened in a few words', () => {
  assert.deepEqual(R.statusOf(null, false), { text: 'Not compiled yet', tone: 'muted', icon: null });
  assert.equal(R.statusOf(ok(), true).text, 'Compiling…');
  assert.deepEqual(R.statusOf(ok(), false), { text: 'Compiled', tone: 'normal', icon: null });
  assert.equal(R.statusOf(ok({ log: log({ warnings: 3 }) }), false).text, 'Compiled, 3 warnings');
  assert.equal(R.statusOf(ok({ log: log({ warnings: 1 }) }), false).text, 'Compiled, 1 warning');
  assert.deepEqual(R.statusOf(ok({ log: log({ errors: 2, warnings: 1 }) }), false), { text: '2 errors', tone: 'danger', icon: 'circle-alert' });
  assert.equal(R.statusOf(ok({ pdf: null }), false).text, 'No PDF made');
  assert.equal(R.statusOf(failed('no-tex'), false).text, 'No TeX found');
  assert.equal(R.statusOf(failed('stopped'), false).tone, 'muted');
  assert.equal(R.statusOf(failed('timeout'), false).text, 'Stopped after 2 minutes');
  assert.equal(R.statusOf(failed('failed'), false).text, 'Could not compile');
});

test('counts read naturally, with thousands separators', () => {
  assert.equal(R.plural(1, 'error'), '1 error');
  assert.equal(R.plural(2, 'error'), '2 errors');
  assert.equal(R.plural(1200, 'warning'), (1200).toLocaleString() + ' warnings');
  assert.equal(R.plural(2, 'box', 'boxes'), '2 boxes');
});

test('issues list errors first, then warnings, then bad boxes, each in log order', () => {
  const i = (kind, message) => ({ kind, message, file: null, line: null, detail: '' });
  assert.deepEqual(R.sortedIssues([i('badbox', 'b1'), i('warning', 'w1'), i('error', 'e1'), i('warning', 'w2'), i('error', 'e2')]).map((x) => x.message), ['e1', 'e2', 'w1', 'w2', 'b1']);
  assert.deepEqual(R.sortedIssues([]), []);
});

test('a file named in the log is found beside the root', () => {
  assert.equal(R.joinPath('C:/thesis', 'chapters/intro.tex'), 'C:/thesis/chapters/intro.tex');
  assert.equal(R.joinPath('C:\\thesis\\parts', '../main.tex'), 'C:/thesis/main.tex');
  assert.equal(R.joinPath('C:/thesis', './a.tex'), 'C:/thesis/a.tex');
  assert.equal(R.joinPath('C:/thesis', 'D:\\other\\b.tex'), 'D:/other/b.tex');
  assert.equal(R.dirOf('C:\\thesis\\main.tex'), 'C:/thesis');
  assert.equal(R.samePath('C:\\Thesis\\Main.tex', 'c:/thesis/main.tex'), true);
  assert.equal(R.samePath('C:/a.tex', 'C:/b.tex'), false);
});

test('compile options are read safely and a patch keeps only valid fields', () => {
  assert.equal(T.texOptionsFrom(null), undefined);
  assert.deepEqual(T.texOptionsFrom({}), { engine: 'pdflatex', haltOnError: false, compileOnSave: false });
  assert.deepEqual(T.texOptionsFrom({ engine: 'xelatex', haltOnError: true, compileOnSave: true }), { engine: 'xelatex', haltOnError: true, compileOnSave: true });
  assert.deepEqual(T.texOptionsPatch({ engine: 'context', haltOnError: 'yes', compileOnSave: false, extra: 1 }), { compileOnSave: false });
  assert.deepEqual(T.texOptionsPatch('nonsense'), {});
  assert.deepEqual(T.ENGINES.map((e) => T.ENGINE_LABELS[e]), ['pdfLaTeX', 'XeLaTeX', 'LuaLaTeX']);
});

test('only .tex, .ltx and .latex files outside the notes folder are LaTeX files', () => {
  assert.equal(Hl.isTexFile({ filePath: 'C:/x/a.tex', fileKind: 'text' }), true);
  assert.equal(Hl.isTexFile({ filePath: 'C:/x/a.LTX', fileKind: 'text' }), true);
  assert.equal(Hl.isTexFile({ filePath: 'C:/x/a.bib', fileKind: 'text' }), false);
  assert.equal(Hl.isTexFile({ filePath: 'C:/x/a.md', fileKind: 'text' }), false);
  assert.equal(Hl.isTexFile({ filePath: null, fileKind: null }), false);
  assert.equal(Hl.isTexFile(null), false);
});
