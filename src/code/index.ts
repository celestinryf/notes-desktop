import { EditorState, EditorSelection, Compartment, Annotation, Transaction, StateField, RangeSetBuilder, type TransactionSpec, type Extension, type Text } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder, Decoration, type DecorationSet } from '@codemirror/view';
import { readFrontMatter } from '../shared/helpers.mts';
import { history, historyKeymap, standardKeymap, indentMore, indentLess, toggleComment, undo, redo } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, indentUnit, bracketMatching, type StreamParser } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { javascript, json, typescript } from '@codemirror/legacy-modes/mode/javascript';
import { python } from '@codemirror/legacy-modes/mode/python';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { css, sCSS, less } from '@codemirror/legacy-modes/mode/css';
import { xml, html } from '@codemirror/legacy-modes/mode/xml';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { go } from '@codemirror/legacy-modes/mode/go';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { c, cpp, java, csharp, kotlin } from '@codemirror/legacy-modes/mode/clike';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { r } from '@codemirror/legacy-modes/mode/r';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { autocompletion, startCompletion } from '@codemirror/autocomplete';
import { foldAll, unfoldAll, foldCode, unfoldCode } from '@codemirror/language';
import { bibtex, bibtexCompletionSource } from 'codemirror-lang-bib';
import { texHelp, marksTransaction, type TexHelp, type TexMark } from './latex.ts';

export type { TexHelp, TexMark } from './latex.ts';

const LANGUAGES: [string, StreamParser<unknown>, string[]][] = [
  ['LaTeX', stex, ['tex', 'latex', 'sty', 'cls', 'ltx']],
  ['JavaScript', javascript, ['js', 'mjs', 'cjs', 'jsx']],
  ['TypeScript', typescript, ['ts', 'tsx']],
  ['JSON', json, ['json', 'jsonc']],
  ['Python', python, ['py']],
  ['YAML', yaml, ['yaml', 'yml']],
  ['TOML', toml, ['toml']],
  ['Shell', shell, ['sh', 'bash', 'zsh']],
  ['PowerShell', powerShell, ['ps1']],
  ['CSS', css, ['css']],
  ['SCSS', sCSS, ['scss']],
  ['Less', less, ['less']],
  ['XML', xml, ['xml', 'svg']],
  ['HTML', html, ['html', 'htm']],
  ['SQL', standardSQL, ['sql']],
  ['Lua', lua, ['lua', 'luau']],
  ['Ruby', ruby, ['rb']],
  ['Go', go, ['go']],
  ['Rust', rust, ['rs']],
  ['C', c, ['c', 'h']],
  ['C++', cpp, ['cpp', 'hpp', 'cc']],
  ['Java', java, ['java']],
  ['C#', csharp, ['cs']],
  ['Kotlin', kotlin, ['kt']],
  ['Swift', swift, ['swift']],
  ['INI', properties, ['ini', 'cfg', 'conf', 'env', 'properties', 'editorconfig', 'gitattributes']],
  ['Dockerfile', dockerFile, ['dockerfile']],
  ['R', r, ['r']],
  ['Perl', perl, ['pl']],
];
type Known = { name: string, code: boolean, make: () => Extension, language?: Extension };
const BY_EXT = new Map<string, Known>();
for (const [name, mode, exts] of LANGUAGES) {
  const known: Known = { name, code: true, make: () => StreamLanguage.define(mode) };
  for (const ext of exts) BY_EXT.set(ext, known);
}
const MARKDOWN: Known = { name: 'Markdown', code: false, make: () => markdown({ addKeymap: false }) };
for (const ext of ['md', 'markdown']) BY_EXT.set(ext, MARKDOWN);
const BIBTEX: Known = { name: 'BibTeX', code: true, make: () => [bibtex({ enableLinting: false, enableTooltips: false, enableAutocomplete: false }), autocompletion({ override: [bibtexCompletionSource], icons: false })] };
BY_EXT.set('bib', BIBTEX);

const found = (ext: string | null | undefined) => BY_EXT.get(String(ext || '').toLowerCase());

export function languageFor(ext: string | null | undefined) {
  const known = found(ext);
  if (!known) return { name: 'Plain text', language: null, code: false };
  if (!known.language) known.language = known.make();
  return { name: known.name, language: known.language, code: known.code };
}

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.tagName, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--syn-string)' },
  { tag: [t.atom, t.bool, t.number, t.literal, t.typeName, t.className, t.attributeName, t.propertyName, t.labelName], color: 'var(--syn-atom)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.meta], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.bracket, t.punctuation, t.separator, t.operator, t.angleBracket, t.squareBracket, t.paren, t.brace, t.processingInstruction, t.contentSeparator], color: 'var(--syn-punct)' },
  { tag: [t.link, t.url], color: 'var(--syn-string)' },
  { tag: t.monospace, color: 'var(--syn-atom)' },
  { tag: t.quote, color: 'var(--syn-comment)' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.heading, fontWeight: '600' },
  { tag: t.strong, fontWeight: '650' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

export function detectIndent(text: string) {
  let tabs = 0, spaces = 0, unit = 0;
  for (const line of String(text).split('\n', 2000)) {
    if (line.startsWith('\t')) tabs++;
    const m = /^( +)\S/.exec(line);
    if (m) { spaces++; if (m[1].length >= 2 && (!unit || m[1].length < unit)) unit = m[1].length; }
  }
  if (tabs > spaces) return '\t';
  return ' '.repeat(Math.min(Math.max(unit || 2, 2), 8));
}

const fromNotes = Annotation.define();

const FRONT_MATTER_LOOKAHEAD = 4000;
const frontMatterLine = Decoration.line({ class: 'cm-frontMatter' });

function frontMatterLines(doc: Text) {
  const front = readFrontMatter(doc.sliceString(0, FRONT_MATTER_LOOKAHEAD));
  if (!front) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  const lines = Math.min(front.inner.length + 2, doc.lines);
  for (let n = 1; n <= lines; n++) {
    const line = doc.line(n);
    builder.add(line.from, line.from, frontMatterLine);
  }
  return builder.finish();
}

const frontMatter = StateField.define<DecorationSet>({
  create: (s) => frontMatterLines(s.doc),
  update: (deco, tr) => (tr.docChanged ? frontMatterLines(tr.state.doc) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

const lineIsIndented = (state: EditorState) => {
  const { from, to } = state.selection.main;
  for (let pos = from; pos <= to;) {
    const line = state.doc.lineAt(pos);
    if (/^[ \t]/.test(line.text)) return true;
    if (line.to + 1 > to || line.number === state.doc.lines) break;
    pos = line.to + 1;
  }
  return false;
};

export type CodeEditorOptions = {
  parent: Element | DocumentFragment,
  onChange?: (text: string) => void,
  onSelection?: () => void,
  onEnter?: (shift: boolean) => boolean,
};

export type LoadOptions = { ext?: string, readOnly?: boolean, placeholder?: string, label?: string, tex?: TexHelp | null };

export function create({ parent, onChange, onSelection, onEnter }: CodeEditorOptions) {
  const language = new Compartment(), writable = new Compartment(), hint = new Compartment(), indent = new Compartment(), words = new Compartment();

  const keys = [
    { key: 'Enter', run: () => !!(onEnter && onEnter(false)) },
    { key: 'Shift-Enter', run: () => !!(onEnter && onEnter(true)) },
    { key: 'Tab', run: (v: EditorView) => {
      if (v.state.readOnly) return false;
      if (v.state.selection.ranges.some((range) => !range.empty)) return indentMore(v);
      v.dispatch(v.state.replaceSelection(v.state.facet(indentUnit)), { scrollIntoView: true, userEvent: 'input' });
      return true;
    } },
    { key: 'Shift-Tab', run: (v: EditorView) => !v.state.readOnly && lineIsIndented(v.state) && indentLess(v) },
    { key: 'Mod-/', run: toggleComment },
    { key: 'Mod-b', run: () => true },
    { key: 'Mod-i', run: () => true },
    { key: 'Mod-u', run: () => true },
  ];

  const stateFor = (text: string, opts: LoadOptions) => {
    const lang = languageFor(opts.ext);
    return EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), bracketMatching(),
        EditorView.lineWrapping, EditorState.tabSize.of(2), syntaxHighlighting(highlight),
        language.of(lang.language || []),
        found(opts.ext) === MARKDOWN ? frontMatter : [],
        opts.tex && found(opts.ext) === found('tex') ? texHelp(opts.tex) : [],
        words.of(EditorView.contentAttributes.of({ spellcheck: lang.code ? 'false' : 'true', 'aria-label': 'Text of ' + (opts.label || 'the file') })),
        writable.of([EditorState.readOnly.of(!!opts.readOnly), EditorView.editable.of(!opts.readOnly)]),
        hint.of(opts.placeholder ? placeholder(opts.placeholder) : []),
        indent.of(indentUnit.of(detectIndent(text))),
        keymap.of([...keys, ...(found(opts.ext) === MARKDOWN ? markdownKeymap : []), ...historyKeymap, ...standardKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && onChange && !u.transactions.some((tr) => tr.annotation(fromNotes))) onChange(u.state.doc.toString());
          if ((u.docChanged || u.selectionSet) && onSelection) onSelection();
        }),
      ],
    });
  };

  let loaded: LoadOptions = {};
  const view = new EditorView({ parent, state: stateFor('', {}) });
  const clamp = (n: unknown) => Math.max(0, Math.min(Number(n) || 0, view.state.doc.length));

  return {
    dom: view.dom,
    load(text: string, opts?: LoadOptions) { loaded = opts || {}; view.setState(stateFor(String(text || ''), loaded)); },
    forgetHistory() { view.setState(stateFor(view.state.doc.toString(), loaded)); },
    get value() { return view.state.doc.toString(); },
    setValue(text: string, { history = true } = {}) {
      const next = String(text || '').replace(/\r\n?/g, '\n'), prev = view.state.doc.toString();
      if (next === prev) return;
      let start = 0;
      while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
      let endPrev = prev.length, endNext = next.length;
      while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) { endPrev--; endNext--; }
      const annotations = history ? [fromNotes.of(true)] : [fromNotes.of(true), Transaction.addToHistory.of(false)];
      view.dispatch({ changes: { from: start, to: endPrev, insert: next.slice(start, endNext) }, annotations });
    },
    undo() { return undo(view); },
    redo() { return redo(view); },
    get selectionStart() { return view.state.selection.main.from; },
    get selectionEnd() { return view.state.selection.main.to; },
    setSelectionRange(from: number, to: number) {
      view.dispatch({ selection: EditorSelection.single(clamp(from), clamp(to === undefined ? from : to)), annotations: fromNotes.of(true) });
    },
    setRangeText(text: string, from: number, to: number, mode?: 'select' | 'start' | 'end' | 'preserve') {
      const a = clamp(from), b = Math.max(a, clamp(to)), insert = String(text);
      const spec: TransactionSpec = { changes: { from: a, to: b, insert }, annotations: fromNotes.of(true) };
      if (mode === 'select') spec.selection = EditorSelection.single(a, a + insert.length);
      else if (mode === 'start') spec.selection = EditorSelection.cursor(a);
      else if (mode === 'end') spec.selection = EditorSelection.cursor(a + insert.length);
      view.dispatch(spec);
    },
    reveal(at: number) { view.dispatch({ effects: EditorView.scrollIntoView(clamp(at), { y: 'center' }) }); },
    focus() { view.focus(); },
    hasFocus() { return view.hasFocus; },
    contains(node: Element | null) { return !!node && view.dom.contains(node); },
    setReadOnly(readOnly: boolean) { view.dispatch({ effects: writable.reconfigure([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]) }); },
    setMarks(marks: TexMark[]) { view.dispatch(marksTransaction(view.state, marks)); },
    fold(how: 'all' | 'none' | 'here' | 'open') { view.focus(); return (how === 'all' ? foldAll : how === 'none' ? unfoldAll : how === 'here' ? foldCode : unfoldCode)(view); },
    suggest() { view.focus(); return startCompletion(view); },
    position() {
      const head = view.state.selection.main.head, line = view.state.doc.lineAt(head);
      return { line: line.number, col: head - line.from + 1 };
    },
    destroy() { view.destroy(); },
  };
}
