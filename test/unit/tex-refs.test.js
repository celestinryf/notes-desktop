'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpDir } = require('../helpers/tmp.js');
const R = require('../../src/shared/tex-refs.mts');
const F = require('../../src/tex-refs.mts');
const { TexService } = require('../../src/tex-service.mts');

const keys = (entries) => entries.map((e) => e.key);

test('bib entries: key, first surname, year and title, with braces, quotes, accents and parentheses', () => {
  const bib = [
    '@article{knuth84, author = {Knuth, Donald E. and Lamport, Leslie}, title = {Literate {P}rogramming}, year = 1984}',
    '@Book(lamport94,',
    '  author = "Leslie Lamport",',
    '  title = "{LaTeX}: A Document Preparation System",',
    '  date = {1994-06-01}',
    ')',
    '@misc{survey, author = {{Upper Meadow Survey}}, title = {Springs of the upper meadow}, year = {2025}}',
    '@misc{accents, author = {Erd{\\H{o}}s, Paul}, title = {On {\\"u}ber graphs}}',
  ].join('\n');
  const found = R.bibEntries(bib);
  assert.deepEqual(keys(found), ['knuth84', 'lamport94', 'survey', 'accents']);
  assert.equal(found[0].detail, 'Knuth, 1984, Literate Programming');
  assert.equal(found[1].detail, 'Lamport, 1994, LaTeX: A Document Preparation System');
  assert.equal(found[2].detail, 'Upper Meadow Survey, 2025, Springs of the upper meadow', 'a braced corporate author stays whole');
  assert.equal(found[3].detail, 'Erdos, On uber graphs');
});

test('bib entries: @string, @preamble and @comment are not entries, a repeated key counts once, an entry with no fields still lists', () => {
  const bib = '@string{jan = "January"}\n@preamble{"\\newcommand{\\noop}[1]{}"}\n@comment{old, stuff}\n@book{dup, title = {First}}\n@book{dup, title = {Second}}\n@misc{bare,\n}\n';
  const found = R.bibEntries(bib);
  assert.deepEqual(keys(found), ['dup', 'bare']);
  assert.equal(found[0].detail, 'First');
  assert.equal(found[1].detail, '');
});

test('bib entries: the detail stops at 120 characters and an editor stands in for a missing author', () => {
  const long = 'word '.repeat(60);
  const [entry] = R.bibEntries('@book{long, editor = {Ada Byron}, title = {' + long + '}, year = 2020}');
  assert.equal(entry.detail.length, 120);
  assert.match(entry.detail, /^Byron, 2020, word/);
});

test('labels: every \\label with its file and line, skipping comments but not an escaped percent', () => {
  const text = 'intro\n\\section{A}\\label{sec:a} \\label{sec:a2}\n% \\label{gone}\n50\\% done \\label{fig:half}\n\\label{}\n';
  const found = R.labelsIn(text, path.join('C:', 'paper', 'main.tex'));
  assert.deepEqual(keys(found), ['sec:a', 'sec:a2', 'fig:half']);
  assert.deepEqual(found.map((l) => l.line), [2, 2, 4]);
  assert.equal(found[0].detail, 'main.tex:2');
});

test('definitions: commands and environments the document defines, not the commented ones', () => {
  const text = [
    '\\newcommand{\\elev}[1]{#1 m}',
    '\\renewcommand*\\vec[1]{\\mathbf{#1}}',
    '\\DeclareMathOperator{\\grad}{grad}',
    '\\def\\later{soon}',
    '\\NewDocumentCommand{\\pair}{mm}{(#1, #2)}',
    '\\newenvironment{note}{}{}',
    '\\newtheorem{claim}{Claim}',
    '% \\newcommand{\\hidden}{x}',
  ].join('\n');
  const found = R.definitionsIn(text);
  assert.deepEqual(found.commands.sort(), ['elev', 'grad', 'later', 'pair', 'vec']);
  assert.deepEqual(found.environments.sort(), ['claim', 'note']);
});

test('with the buffer: the open file\'s unsaved labels replace its saved ones, other files keep theirs, keys stay unique', () => {
  const file = path.join('C:', 'p', 'main.tex');
  const other = path.join('C:', 'p', 'intro.tex');
  const disk = { citations: [{ key: 'k', detail: '' }], labels: [{ key: 'old', detail: 'main.tex:1', file, line: 1 }, { key: 'intro', detail: 'intro.tex:3', file: other, line: 3 }, { key: 'shared', detail: 'intro.tex:4', file: other, line: 4 }], commands: ['disk'], environments: ['boxed'], files: ['main.tex'] };
  const merged = R.withBuffer(disk, '\\label{new}\n\\label{shared}\n\\newcommand{\\mine}{}\n', file, (a, b) => a.toLowerCase() === b.toLowerCase());
  assert.deepEqual(keys(merged.labels), ['new', 'shared', 'intro']);
  assert.equal(merged.labels[1].file, file, 'the buffer wins a clash');
  assert.deepEqual(merged.commands, ['mine', 'disk']);
  assert.deepEqual(merged.environments, ['boxed']);
  assert.deepEqual(merged.citations, disk.citations);
  assert.deepEqual(merged.files, ['main.tex']);
});

function project() {
  const dir = tmpDir('notes-tex-refs-');
  const write = (rel, text) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
  const main = write('main.tex', '\\documentclass{article}\n\\newcommand{\\elev}{m}\n\\begin{document}\n\\input{chapters/intro}\n\\include{chapters/end.tex}\n% \\input{secret}\n\\input{../outside}\n\\label{top}\n\\bibliography{refs, more}\n\\end{document}\n');
  write('chapters/intro.tex', '\\section{Intro}\\label{sec:intro}\n\\input{main}\n\\newenvironment{aside}{}{}\n');
  write('chapters/end.tex', '\\label{sec:end}\n');
  write('secret.tex', '\\label{secret}\n');
  write('refs.bib', '@book{one, title = {One}}\n');
  write('more.bib', '@book{two, title = {Two}}\n@book{one, title = {Again}}\n');
  write('figures/plot.png', 'png');
  write('figures/deep/a/b/c/d/far.png', 'png');
  write('.hidden/skip.tex', 'x');
  write('node_modules/skip.tex', 'x');
  write('notes.txt', 'x');
  fs.writeFileSync(path.join(path.dirname(dir), 'outside.tex'), '\\label{outside}\n');
  return { dir, main, write };
}


test('references: labels from the \\input and \\include chain, citations from the named .bib files, commands, environments and the project\'s files', async () => {
  const { main } = project();
  const found = await F.referencesFor(main);
  assert.deepEqual(keys(found.labels), ['top', 'sec:intro', 'sec:end']);
  assert.deepEqual(keys(found.citations), ['one', 'two']);
  assert.equal(found.citations[0].detail, 'One', 'the first .bib named wins a repeated key');
  assert.deepEqual(found.commands, ['elev']);
  assert.deepEqual(found.environments, ['aside']);
  assert.deepEqual(found.files, ['chapters/end.tex', 'chapters/intro.tex', 'figures/plot.png', 'main.tex', 'more.bib', 'refs.bib', 'secret.tex']);
});

test('references: with no \\bibliography, every .bib beside the root is read; a missing named one is skipped', async () => {
  const { write } = project();
  const lone = write('lone.tex', '\\cite{x}\n');
  const all = (await F.referencesFor(lone)).citations;
  assert.deepEqual(keys(all), ['two', 'one'], 'more.bib comes before refs.bib');
  assert.equal(all[1].detail, 'Again');
  const named = write('named.tex', '\\addbibresource{gone.bib}\n\\addbibresource[label=x]{refs.bib}\n');
  assert.deepEqual(keys((await F.referencesFor(named)).citations), ['one']);
});

test('references: files over 4 MB are not read', async () => {
  const { write } = project();
  write('big.bib', '@book{big, title = {Big}}\n' + ' '.repeat(4 * 1024 * 1024 + 10));
  const root = write('big.tex', '\\bibliography{big}\n');
  assert.deepEqual((await F.referencesFor(root)).citations, []);
});

test('references: a root that cannot be read gives empty lists, not an error', async () => {
  const found = await F.referencesFor(path.join(tmpDir('notes-tex-refs-none-'), 'gone.tex'));
  assert.deepEqual(found.labels, []);
  assert.deepEqual(found.citations, []);
});

test('references: a folder linked into the project that points outside it is not read', async (t) => {
  const { dir, write } = project();
  const outside = tmpDir('notes-tex-refs-outside-');
  fs.writeFileSync(path.join(outside, 'leak.tex'), '\\label{leaked}\n');
  fs.writeFileSync(path.join(outside, 'leak.bib'), '@book{leaked, title = {Leak}}\n');
  try { fs.symlinkSync(outside, path.join(dir, 'linked'), 'junction'); } catch (err) { t.skip('cannot make a junction here: ' + err.code); return; }
  const root = write('linked-root.tex', '\\input{linked/leak}\n\\bibliography{linked/leak}\n\\label{own}\n');
  const found = await F.referencesFor(root);
  assert.deepEqual(keys(found.labels), ['own']);
  assert.deepEqual(found.citations, []);
  assert.ok(!found.files.some((f) => f.startsWith('linked/')), 'the walk does not enter the link');
});

test('references: the folder walk stops after its entry budget, so a .tex in a huge folder stays quick', async () => {
  const dir = tmpDir('notes-tex-refs-wide-');
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(dir, 'a' + String(i).padStart(2, '0') + '.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'z-late.tex'), 'x');
  assert.deepEqual(await F.projectFilesOf(dir, 20), []);
  assert.deepEqual(await F.projectFilesOf(dir, 100), ['z-late.tex']);
});

test('references: the reader stops once its byte budget is spent', async () => {
  const dir = tmpDir('notes-tex-refs-budget-');
  fs.writeFileSync(path.join(dir, 'a.tex'), 'aaaaaa');
  fs.writeFileSync(path.join(dir, 'b.tex'), 'bbbbbb');
  const read = F.projectReader(dir, 10);
  assert.equal(await read(path.join(dir, 'a.tex')), 'aaaaaa');
  assert.equal(await read(path.join(dir, 'b.tex')), null);
  assert.equal(await F.projectReader(dir)(path.join(dir, 'gone.tex')), null);
});

test('the service reads references from the root a "% !TEX root" names, and from the file itself when that root is missing', async () => {
  const { write } = project();
  const chapter = write('chapters/part.tex', '% !TEX root = ../main.tex\n\\label{sec:part}\n');
  const tex = new TexService({});
  assert.ok(keys((await tex.references(chapter)).labels).includes('top'), 'the root\'s labels');
  const orphan = write('chapters/orphan.tex', '% !TEX root = ../nowhere.tex\n\\label{sec:orphan}\n');
  assert.deepEqual(keys((await tex.references(orphan)).labels), ['sec:orphan']);
});
