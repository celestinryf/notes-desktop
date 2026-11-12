'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const esbuild = require('esbuild');
const { tmpDir } = require('../helpers/tmp.js');

const ROOT = path.join(__dirname, '..', '..');
const outfile = path.join(tmpDir('notes-tex-help-'), 'latex.cjs');
esbuild.buildSync({
  stdin: {
    contents: "export * from './src/code/latex.ts';\nexport { EditorState } from '@codemirror/state';\nexport { CompletionContext } from '@codemirror/autocomplete';",
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile,
  logLevel: 'silent',
});
const L = require(outfile);

const at = (doc) => {
  const pos = doc.indexOf('|');
  return { state: L.EditorState.create({ doc: doc.replace('|', ''), selection: { anchor: pos } }), pos };
};
const lineRange = (state, n) => { const l = state.doc.line(n); return { from: l.from, to: l.to }; };
const foldAt = (state, n) => { const l = state.doc.line(n); return L.foldTex(state, l.from, l.to); };

const REFS = {
  citations: [{ key: 'knuth84', detail: 'Knuth, 1984' }, { key: 'lamport94', detail: 'Lamport, 1994' }],
  labels: [{ key: 'sec:intro', detail: 'main.tex:3', file: 'main.tex', line: 3 }],
  commands: ['elev', 'section'],
  environments: ['aside'],
  files: ['chapters/intro.tex', 'figures/plot.png', 'refs.bib', 'notes.pdf'],
};

function complete(doc, explicit = false) {
  const { state, pos } = at(doc);
  const seen = [];
  const help = { references: async (text) => { seen.push(text); return REFS; }, marker: () => null, placeholder: () => null };
  return L.texCompletions(help)(new L.CompletionContext(state, pos, explicit)).then((result) => ({ result, seen, pos, labels: result ? result.options.map((o) => o.label) : [] }));
}

test('completion: \\cite{ lists the .bib keys with their detail, after a comma too, and through optional arguments', async () => {
  const plain = await complete('See \\cite{|');
  assert.deepEqual(plain.labels, ['knuth84', 'lamport94']);
  assert.equal(plain.result.options[0].detail, 'Knuth, 1984');
  assert.equal(plain.result.from, plain.pos);
  assert.equal(plain.seen[0], 'See \\cite{', 'the buffer text goes to the lookup');
  const typed = await complete('\\citep[see][p.~4]{knuth84, lam|');
  assert.deepEqual(typed.labels, ['knuth84', 'lamport94']);
  assert.equal(typed.result.from, typed.pos - 3);
  assert.ok((await complete('\\parencite*{|')).result);
  assert.ok((await complete('\\Textcite{|')).result);
});

test('completion: \\ref{ and its kin list the labels', async () => {
  for (const cmd of ['ref', 'eqref', 'autoref', 'cref', 'Cref', 'pageref']) {
    const { labels } = await complete('\\' + cmd + '{|');
    assert.deepEqual(labels, ['sec:intro'], cmd);
  }
  const many = await complete('\\cref{sec:a,sec:|');
  assert.equal(many.result.from, many.pos - 4);
});

test('completion: file arguments list the right kind of file, with or without the extension as LaTeX expects', async () => {
  assert.deepEqual((await complete('\\input{|')).labels, ['chapters/intro']);
  assert.deepEqual((await complete('\\include{chap|')).labels, ['chapters/intro']);
  assert.deepEqual((await complete('\\includegraphics[width=\\linewidth]{|')).labels, ['figures/plot.png', 'notes.pdf']);
  assert.deepEqual((await complete('\\bibliography{|')).labels, ['refs']);
  assert.deepEqual((await complete('\\addbibresource{|')).labels, ['refs.bib']);
});

test('completion: \\begin{ offers environments that insert their \\end, \\end{ only closes the name, the document\'s own ones included', async () => {
  const begin = await complete('\\begin{it|');
  assert.ok(begin.labels.includes('itemize'));
  assert.ok(begin.labels.includes('aside'));
  assert.equal(begin.result.from, begin.pos - 2);
  const item = begin.result.options.find((o) => o.label === 'itemize');
  assert.equal(typeof item.apply, 'function', 'a snippet that writes the \\end');
  const end = await complete('\\end{it|');
  assert.equal(end.result.options.find((o) => o.label === 'itemize').apply, 'itemize}');
});

test('completion: a backslash and letters list commands, built-in first, the document\'s own marked and never doubled', async () => {
  const { result, labels, pos } = await complete('\\sec|');
  assert.equal(result.from, pos - 4);
  assert.ok(labels.includes('\\section'));
  assert.ok(labels.includes('\\elev'));
  assert.equal(labels.filter((l) => l === '\\section').length, 1);
  assert.equal(result.options.find((o) => o.label === '\\elev').detail, 'Defined here');
  assert.equal(labels[0], '\\begin');
});

test('completion: a bare backslash waits for Ctrl+Space, and nothing is offered in a comment or in plain text', async () => {
  assert.equal((await complete('\\|')).result, null);
  assert.ok((await complete('\\|', true)).result);
  assert.equal((await complete('% see \\cite{|')).result, null);
  assert.ok((await complete('50\\% see \\cite{|')).result, 'an escaped percent is not a comment');
  assert.equal((await complete('plain words|')).result, null);
  assert.equal((await complete('\\cite{a} and more|')).result, null);
});

function enter(doc, opts = {}) {
  const { state } = at(doc);
  const ready = opts.readOnly ? L.EditorState.create({ doc: state.doc.toString(), selection: state.selection, extensions: [L.EditorState.readOnly.of(true)] }) : state;
  let next = null;
  const view = { state: ready, dispatch: (spec) => { next = ready.update(spec).state; } };
  const done = L.closeEnvironment(view);
  return { done, text: next ? next.doc.toString() : null, caret: next ? next.selection.main.head : null };
}

test('Enter after \\begin{name} writes its \\end and puts the caret on the line between, at the line\'s indent plus one step', () => {
  const r = enter('\\begin{itemize}|');
  assert.equal(r.done, true);
  assert.equal(r.text, '\\begin{itemize}\n  \n\\end{itemize}');
  assert.equal(r.caret, '\\begin{itemize}\n  '.length);
  const indented = enter('  \\begin{tabular}{ll}|');
  assert.equal(indented.text, '  \\begin{tabular}{ll}\n    \n  \\end{tabular}');
  const withOption = enter('\\begin{figure}[ht]|');
  assert.equal(withOption.text, '\\begin{figure}[ht]\n  \n\\end{figure}');
});

test('Enter leaves \\begin alone when it is already closed, has text after the caret, sits in a comment, or the file is read-only', () => {
  assert.equal(enter('\\begin{itemize}|\n\\end{itemize}').done, false);
  assert.equal(enter('\\begin{itemize}| \\item').done, false);
  assert.equal(enter('% \\begin{itemize}|').done, false);
  assert.equal(enter('\\begin{itemize} % list|').done, false);
  assert.equal(enter('\\begin{itemize}|', { readOnly: true }).done, false);
  assert.equal(enter('plain|').done, false);
});

test('Enter closes a nested environment of the same name when the outer one already has its \\end', () => {
  const r = enter('\\begin{itemize}\n\\item a\n\\begin{itemize}|\n\\end{itemize}');
  assert.equal(r.done, true);
  assert.match(r.text, /\\begin\{itemize\}\n {2}\n\\end\{itemize\}\n\\end\{itemize\}$/);
});

test('folding: an environment folds to the line before its \\end, nested ones of the same name match, \\begin{document} does not fold', () => {
  const { state } = at('\\begin{document}\n\\begin{itemize}\n\\item a\n\\begin{itemize}\n\\item b\n\\end{itemize}\n\\end{itemize}\n\\end{document}');
  assert.deepEqual(foldAt(state, 2), { from: lineRange(state, 2).to, to: lineRange(state, 6).to });
  assert.deepEqual(foldAt(state, 4), { from: lineRange(state, 4).to, to: lineRange(state, 5).to });
  assert.equal(foldAt(state, 1), null);
  assert.equal(foldAt(state, 3), null);
});

test('folding: one-line, empty, unclosed and commented environments do not fold', () => {
  const { state } = at('\\begin{center}x\\end{center}\n\\begin{quote}\n\\end{quote}\n% \\begin{proof}\nx\n\\end{proof}\n\\begin{proof}\nnever closed');
  assert.equal(foldAt(state, 1), null);
  assert.equal(foldAt(state, 2), null);
  assert.equal(foldAt(state, 4), null);
  assert.equal(foldAt(state, 7), null);
});

test('folding: a section runs to the last line with text before the next section of its level or higher, or the bibliography', () => {
  const doc = ['\\section{A}', 'text a', '\\subsection{A1}', 'text a1', '', '\\subsection{A2}', 'text a2', '', '\\section{B}', 'text b', '', '\\bibliographystyle{plain}', '\\bibliography{refs}', '\\section{Empty}', '\\end{document}'].join('\n');
  const { state } = at(doc);
  assert.deepEqual(foldAt(state, 1), { from: lineRange(state, 1).to, to: lineRange(state, 7).to });
  assert.deepEqual(foldAt(state, 3), { from: lineRange(state, 3).to, to: lineRange(state, 4).to });
  assert.deepEqual(foldAt(state, 9), { from: lineRange(state, 9).to, to: lineRange(state, 10).to });
  assert.equal(foldAt(state, 14), null);
  assert.equal(foldAt(state, 2), null);
});

test('error marks: each lands on its line from the first non-space character, lines outside the file are dropped', () => {
  const { state } = at('first\n    indented\n\nlast');
  const marks = L.texDiagnostics(state, [
    { line: 2, severity: 'error', message: 'Undefined control sequence.' },
    { line: 3, severity: 'warning', message: 'Blank line' },
    { line: 4, severity: 'info', message: 'Overfull' },
    { line: 0, severity: 'error', message: 'none' },
    { line: 9, severity: 'error', message: 'past the end' },
  ]);
  assert.equal(marks.length, 3);
  assert.deepEqual([marks[0].from, marks[0].to], [state.doc.line(2).from + 4, state.doc.line(2).to]);
  assert.deepEqual([marks[1].from, marks[1].to], [state.doc.line(3).from, state.doc.line(3).from]);
  assert.deepEqual(marks.map((m) => m.severity), ['error', 'warning', 'info']);
  assert.equal(marks[0].message, 'Undefined control sequence.');
});

test('the environment before the caret: arguments with nested braces and brackets count, anything else after them does not', () => {
  assert.equal(L.environmentBefore('\\begin{tabular}{@{}ll@{}}'), 'tabular');
  assert.equal(L.environmentBefore('\\begin{tabular}{p{3cm}c}'), 'tabular');
  assert.equal(L.environmentBefore('\\begin{minipage}[t]{0.5\\linewidth}  '), 'minipage');
  assert.equal(L.environmentBefore('\\begin{tabular}{l\\}l}'), 'tabular', 'an escaped brace is not a close');
  assert.equal(L.environmentBefore('\\begin{tabular}{ll'), null, 'an argument still being typed');
  assert.equal(L.environmentBefore('\\begin{itemize} \\item'), null);
  assert.equal(L.environmentBefore('\\begin{a}\\end{a} \\begin{b}'), 'b', 'the last \\begin on the line');
  assert.equal(L.environmentBefore('no environment'), null);
  assert.equal(enter('\\begin{tabular}{@{}ll@{}}|').text, '\\begin{tabular}{@{}ll@{}}\n  \n\\end{tabular}');
});

test('completion: \\bibliography{ after a comma replaces only the name being typed', async () => {
  const many = await complete('\\bibliography{refs, mo|');
  assert.equal(many.result.from, many.pos - 2);
  assert.deepEqual(many.labels, ['refs']);
  assert.ok(many.result.validFor.test('more'));
  assert.ok(!many.result.validFor.test('a,b'));
  const one = await complete('\\includegraphics{figures/pl|');
  assert.equal(one.result.from, one.pos - 'figures/pl'.length);
});

test('folding: a line that ends one environment and begins another of the same name folds the new one', () => {
  const { state } = at('\\begin{proof}\na\n\\end{proof}\\begin{proof}\nb\nc\n\\end{proof}');
  assert.deepEqual(foldAt(state, 3), { from: lineRange(state, 3).to, to: lineRange(state, 5).to });
  assert.deepEqual(foldAt(state, 1), { from: lineRange(state, 1).to, to: lineRange(state, 2).to }, 'the first one ends where the next begins');
});
