import { Prec, type Extension, type EditorState } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import { autocompletion, snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { foldService, foldGutter, foldKeymap, codeFolding, indentUnit } from '@codemirror/language';
import { setDiagnostics, lintGutter, type Diagnostic } from '@codemirror/lint';
import { withoutComments } from '../shared/tex-refs.mts';

export type TexHelp = {
  references: (text: string) => Promise<TexReferences>,
  marker: (open: boolean) => HTMLElement,
  placeholder: () => HTMLElement,
};
export type TexMark = { line: number, severity: 'error' | 'warning' | 'info', message: string };

const CITE = /\\(?:[cC]ite[a-z]*|[pP]arencite|[tT]extcite|[aA]utocite|[fF]ootcite|[fF]ullcite|nocite|smartcite)\*?(?:\[[^\]\n]*\]){0,2}\{(?:[^}\n]*,)?\s*([^,}\s]*)$/;
const REF = /\\(?:ref|eqref|autoref|[cC]ref|[cC]pageref|pageref|nameref|vref|vpageref|labelcref)\*?\{(?:[^}\n]*,)?\s*([^,}\s]*)$/;
const FILE_ARG = /\\(input|include|subfile|includegraphics|bibliography|addbibresource)\*?(?:\[[^\]\n]*\])?\{([^}\n]*)$/;
const BEGIN = /\\(?:begin|end)\{([A-Za-z*]*)$/;
const COMMAND = /\\([A-Za-z@]*)$/;

const ENVIRONMENTS = ['document', 'itemize', 'enumerate', 'description', 'equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'split', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'figure', 'figure*', 'table', 'table*', 'tabular', 'tabularx', 'center', 'flushleft', 'flushright', 'quote', 'quotation', 'verbatim', 'abstract', 'minipage', 'theorem', 'lemma', 'proof', 'definition', 'remark', 'corollary', 'example', 'frame', 'columns', 'column', 'thebibliography', 'lstlisting', 'minted', 'tikzpicture'];

const SNIPPETS: [string, string, string][] = [
  ['section', '\\section{${}}', 'Section'],
  ['subsection', '\\subsection{${}}', 'Subsection'],
  ['subsubsection', '\\subsubsection{${}}', 'Subsubsection'],
  ['paragraph', '\\paragraph{${}}', 'Paragraph heading'],
  ['chapter', '\\chapter{${}}', 'Chapter'],
  ['textbf', '\\textbf{${}}', 'Bold'],
  ['textit', '\\textit{${}}', 'Italic'],
  ['emph', '\\emph{${}}', 'Emphasis'],
  ['underline', '\\underline{${}}', 'Underline'],
  ['texttt', '\\texttt{${}}', 'Monospace'],
  ['textsc', '\\textsc{${}}', 'Small capitals'],
  ['frac', '\\frac{${}}{${}}', 'Fraction'],
  ['sqrt', '\\sqrt{${}}', 'Square root'],
  ['sum', '\\sum_{${}}^{${}}', 'Sum'],
  ['int', '\\int_{${}}^{${}}', 'Integral'],
  ['lim', '\\lim_{${}}', 'Limit'],
  ['mathbb', '\\mathbb{${}}', 'Blackboard bold'],
  ['mathrm', '\\mathrm{${}}', 'Upright in math'],
  ['text', '\\text{${}}', 'Text in math'],
  ['label', '\\label{${}}', 'Label'],
  ['ref', '\\ref{${}}', 'Reference'],
  ['eqref', '\\eqref{${}}', 'Equation reference'],
  ['cite', '\\cite{${}}', 'Citation'],
  ['footnote', '\\footnote{${}}', 'Footnote'],
  ['href', '\\href{${url}}{${text}}', 'Link'],
  ['url', '\\url{${}}', 'Web address'],
  ['includegraphics', '\\includegraphics[width=\\linewidth]{${}}', 'Picture'],
  ['caption', '\\caption{${}}', 'Caption'],
  ['usepackage', '\\usepackage{${}}', 'Package'],
  ['documentclass', '\\documentclass{${article}}', 'Document class'],
  ['input', '\\input{${}}', 'Input a file'],
  ['include', '\\include{${}}', 'Include a file'],
  ['item', '\\item ${}', 'List item'],
  ['title', '\\title{${}}', 'Title'],
  ['author', '\\author{${}}', 'Author'],
  ['date', '\\date{${}}', 'Date'],
  ['maketitle', '\\maketitle', 'Make the title'],
  ['tableofcontents', '\\tableofcontents', 'Table of contents'],
  ['hline', '\\hline', 'Table rule'],
  ['vspace', '\\vspace{${}}', 'Vertical space'],
  ['hspace', '\\hspace{${}}', 'Horizontal space'],
  ['bibliography', '\\bibliography{${}}', 'Bibliography file'],
  ['bibliographystyle', '\\bibliographystyle{${plain}}', 'Bibliography style'],
  ['addbibresource', '\\addbibresource{${}}', 'Bibliography file, biblatex'],
  ['newline', '\\newline', 'New line'],
  ['newpage', '\\newpage', 'New page'],
  ['centering', '\\centering', 'Centre'],
];

const SYMBOLS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega', 'infty', 'partial', 'nabla', 'cdot', 'times', 'leq', 'geq', 'neq', 'approx', 'equiv', 'in', 'subset', 'cup', 'cap', 'forall', 'exists', 'rightarrow', 'Rightarrow', 'leftrightarrow', 'ldots', 'cdots', 'quad', 'qquad'];

const BUILT_IN_COMMANDS: Completion[] = [
  snippetCompletion('\\begin{${env}}\n\t${}\n\\end{${env}}', { label: '\\begin', detail: 'Environment', type: 'keyword' }),
  ...SNIPPETS.map(([label, template, detail]) => snippetCompletion(template, { label: '\\' + label, detail, type: 'keyword' })),
  ...SYMBOLS.map((name) => ({ label: '\\' + name, type: 'constant' })),
];
const BUILT_IN_NAMES = new Set(BUILT_IN_COMMANDS.map((c) => c.label));

const environmentOption = (name: string, closing: boolean): Completion => (closing
  ? { label: name, apply: name + '}', type: 'type' }
  : snippetCompletion(name + '}\n\t${}\n\\end{' + name + '}', { label: name, type: 'type' }));

const FILE_KINDS: Record<string, { ext: RegExp, keepExt: boolean }> = {
  input: { ext: /\.(tex|ltx)$/i, keepExt: false },
  include: { ext: /\.(tex|ltx)$/i, keepExt: false },
  subfile: { ext: /\.(tex|ltx)$/i, keepExt: true },
  includegraphics: { ext: /\.(png|jpe?g|pdf|eps|svg)$/i, keepExt: true },
  bibliography: { ext: /\.bib$/i, keepExt: false },
  addbibresource: { ext: /\.bib$/i, keepExt: true },
};

function fileOptions(command: string, files: string[]): Completion[] {
  const kind = FILE_KINDS[command];
  return files.filter((f) => kind.ext.test(f)).map((f) => ({ label: kind.keepExt ? f : f.replace(/\.[^./]+$/, ''), type: 'text' }));
}

function environmentsClosed(state: EditorState, name: string) {
  const text = withoutComments(state.doc.toString());
  const count = (s: string) => text.split(s).length - 1;
  return count('\\end{' + name + '}') >= count('\\begin{' + name + '}');
}

export function closeEnvironment(view: EditorView) {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || state.readOnly) return false;
  const line = state.doc.lineAt(range.head);
  const before = line.text.slice(0, range.head - line.from);
  if (line.text.slice(range.head - line.from).trim()) return false;
  if (withoutComments(before) !== before) return false;
  const begun = /\\begin\{([^}\s]+)\}(?:\[[^\]]*\]|\{[^}]*\})*\s*$/.exec(before);
  if (!begun) return false;
  if (environmentsClosed(state, begun[1])) return false;
  const indent = (/^[ \t]*/.exec(line.text) || [''])[0];
  const inner = '\n' + indent + state.facet(indentUnit);
  view.dispatch({
    changes: { from: range.head, insert: inner + '\n' + indent + '\\end{' + begun[1] + '}' },
    selection: { anchor: range.head + inner.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

export function texCompletions(help: TexHelp) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    if (/(^|[^\\])%/.test(before)) return null;
    const refs = () => help.references(context.state.doc.toString());
    const cite = CITE.exec(before);
    if (cite) {
      const found = await refs();
      return { from: context.pos - cite[1].length, options: found.citations.map((e) => ({ label: e.key, detail: e.detail, type: 'variable' })), validFor: /^[^,}\s]*$/ };
    }
    const ref = REF.exec(before);
    if (ref) {
      const found = await refs();
      return { from: context.pos - ref[1].length, options: found.labels.map((l) => ({ label: l.key, detail: l.detail, type: 'variable' })), validFor: /^[^,}\s]*$/ };
    }
    const file = FILE_ARG.exec(before);
    if (file) {
      const found = await refs();
      return { from: context.pos - file[2].length, options: fileOptions(file[1], found.files), validFor: /^[^}]*$/ };
    }
    const begin = BEGIN.exec(before);
    if (begin) {
      const found = await refs();
      const names = [...new Set([...ENVIRONMENTS, ...found.environments])];
      return { from: context.pos - begin[1].length, options: names.map((n) => environmentOption(n, before.endsWith('\\end{' + begin[1]))), validFor: /^[A-Za-z*]*$/ };
    }
    const command = COMMAND.exec(before);
    if (command && (command[1].length > 0 || context.explicit)) {
      const found = await refs();
      const own = found.commands.filter((c) => !BUILT_IN_NAMES.has('\\' + c)).map((c) => ({ label: '\\' + c, detail: 'Defined here', type: 'function' }));
      return { from: context.pos - command[1].length - 1, options: [...BUILT_IN_COMMANDS, ...own], validFor: /^\\[A-Za-z@]*$/ };
    }
    return null;
  };
}

const SECTION_LEVELS: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };
const SECTION = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/;
const SECTION_END = /\\end\{document\}|\\(bibliography|bibliographystyle|printbibliography|appendix)\b/;
const BEGIN_LINE = /\\begin\{([^}]+)\}/;

export function foldTex(state: EditorState, lineStart: number, lineEnd: number) {
  const doc = state.doc;
  const first = doc.lineAt(lineStart);
  const text = withoutComments(first.text);
  const begin = BEGIN_LINE.exec(text);
  if (begin && begin[1] !== 'document' && !text.includes('\\end{' + begin[1] + '}')) {
    const open = '\\begin{' + begin[1] + '}', close = '\\end{' + begin[1] + '}';
    let depth = 0;
    for (let n = first.number + 1; n <= doc.lines; n++) {
      const line = withoutComments(doc.line(n).text);
      depth += line.split(open).length - 1;
      if (!line.includes(close)) continue;
      depth -= line.split(close).length - 1;
      if (depth < 0) return n > first.number + 1 ? { from: lineEnd, to: doc.line(n - 1).to } : null;
    }
    return null;
  }
  const section = SECTION.exec(text);
  if (!section) return null;
  const level = SECTION_LEVELS[section[1]];
  let last = first.number;
  for (let n = first.number + 1; n <= doc.lines; n++) {
    const line = withoutComments(doc.line(n).text);
    const next = SECTION.exec(line);
    if ((next && SECTION_LEVELS[next[1]] <= level) || SECTION_END.test(line)) break;
    if (line.trim()) last = n;
  }
  return last > first.number ? { from: lineEnd, to: doc.line(last).to } : null;
}

export function texDiagnostics(state: EditorState, marks: TexMark[]): Diagnostic[] {
  return marks.filter((m) => m.line >= 1 && m.line <= state.doc.lines).map((m) => {
    const line = state.doc.line(m.line);
    const indent = (/^\s*/.exec(line.text) || [''])[0].length;
    const from = Math.min(line.from + indent, line.to);
    return { from, to: line.to > from ? line.to : from, severity: m.severity, message: m.message };
  });
}

export function marksTransaction(state: EditorState, marks: TexMark[]) {
  return setDiagnostics(state, texDiagnostics(state, marks));
}

export function texHelp(help: TexHelp): Extension {
  return [
    autocompletion({ override: [texCompletions(help)], icons: false }),
    Prec.high(keymap.of([{ key: 'Enter', run: closeEnvironment }])),
    foldService.of(foldTex),
    codeFolding({ placeholderDOM: (_view, onclick) => { const dom = help.placeholder(); dom.addEventListener('click', onclick); return dom; } }),
    foldGutter({ markerDOM: (open) => help.marker(open) }),
    keymap.of(foldKeymap),
    Prec.high(lintGutter()),
  ];
}
