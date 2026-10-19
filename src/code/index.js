'use strict';
// NotesCode: the editor (CodeMirror 6) for opened text files that are not Markdown: .txt, LaTeX, code and config.
// Notes keeps the text in its own textarea too (saving, the title and the counts read it there); this edits and
// shows it, and reports the person's edits with onChange. Edits Notes makes itself (load, setValue, setRangeText)
// are not reported back. Colours and sizes come from the app's CSS tokens (styles.css, "code editor").
import { EditorState, EditorSelection, Compartment, Annotation, Transaction } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder } from '@codemirror/view';
import { history, historyKeymap, standardKeymap, indentMore, indentLess, toggleComment, undo, redo } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, indentUnit, bracketMatching } from '@codemirror/language';
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

// The languages Notes highlights, by file extension (as H.extOf gives it). Anything else is plain text.
const LANGUAGES = [
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
const BY_EXT = new Map();
for (const [name, mode, exts] of LANGUAGES) for (const ext of exts) BY_EXT.set(ext, { name, mode });

// The language for a file extension: its name (for the status line) and its parser (made once), or plain text.
export function languageFor(ext) {
  const found = BY_EXT.get(String(ext || '').toLowerCase());
  if (!found) return { name: 'Plain text', language: null, code: false };
  if (!found.language) found.language = StreamLanguage.define(found.mode);
  return { name: found.name, language: found.language, code: true };
}

// Syntax colours: the five --syn-* tokens, each 4.5:1 or more on the paper in both themes.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.tagName, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--syn-string)' },
  { tag: [t.atom, t.bool, t.number, t.literal, t.typeName, t.className, t.attributeName, t.propertyName, t.labelName], color: 'var(--syn-atom)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.meta, t.processingInstruction], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.bracket, t.punctuation, t.separator, t.operator, t.angleBracket, t.squareBracket, t.paren, t.brace], color: 'var(--syn-punct)' },
  { tag: t.heading, fontWeight: '600' },
  { tag: t.strong, fontWeight: '650' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

// The indentation the file already uses: a tab, or the smallest run of leading spaces (2 when there is none).
export function detectIndent(text) {
  let tabs = 0, spaces = 0, unit = 0;
  for (const line of String(text).split('\n', 2000)) {
    if (line.startsWith('\t')) tabs++;
    const m = /^( +)\S/.exec(line);
    if (m) { spaces++; if (m[1].length >= 2 && (!unit || m[1].length < unit)) unit = m[1].length; }
  }
  if (tabs > spaces) return '\t';
  return ' '.repeat(Math.min(Math.max(unit || 2, 2), 8));
}

// An edit Notes makes itself, so it is not reported back as the person's.
const fromNotes = Annotation.define();

const lineIsIndented = (state) => {
  const { from, to } = state.selection.main;
  for (let pos = from; pos <= to;) {
    const line = state.doc.lineAt(pos);
    if (/^[ \t]/.test(line.text)) return true;
    if (line.to + 1 > to || line.number === state.doc.lines) break;
    pos = line.to + 1;
  }
  return false;
};

/* create({ parent, onChange(text), onSelection(), onEnter(shift) -> handled }) -> editor
   onEnter: Enter (and Shift+Enter) go to Notes first, so the find bar can step between matches. */
export function create({ parent, onChange, onSelection, onEnter }) {
  const language = new Compartment(), writable = new Compartment(), hint = new Compartment(), indent = new Compartment(), words = new Compartment();

  const keys = [
    { key: 'Enter', run: () => !!(onEnter && onEnter(false)) },
    { key: 'Shift-Enter', run: () => !!(onEnter && onEnter(true)) },
    // Tab indents (the selected lines, or at the caret); Shift+Tab outdents, and when nothing is indented lets focus
    // move on, as it does everywhere else. A file that cannot be edited never keeps Tab.
    { key: 'Tab', run: (v) => {
      if (v.state.readOnly) return false;
      if (v.state.selection.ranges.some((range) => !range.empty)) return indentMore(v);
      v.dispatch(v.state.replaceSelection(v.state.facet(indentUnit)), { scrollIntoView: true, userEvent: 'input' });
      return true;
    } },
    { key: 'Shift-Tab', run: (v) => !v.state.readOnly && lineIsIndented(v.state) && indentLess(v) },
    { key: 'Mod-/', run: toggleComment },
    { key: 'Mod-b', run: () => true },
    { key: 'Mod-i', run: () => true },
    { key: 'Mod-u', run: () => true },
  ];

  const stateFor = (text, opts) => {
    const lang = languageFor(opts.ext);
    return EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), bracketMatching(),
        EditorView.lineWrapping, EditorState.tabSize.of(2), syntaxHighlighting(highlight),
        language.of(lang.language || []),
        // Spelling is checked in prose (plain text), not in code or LaTeX commands.
        words.of(EditorView.contentAttributes.of({ spellcheck: lang.code ? 'false' : 'true', 'aria-label': 'Text of ' + (opts.label || 'the file') })),
        writable.of([EditorState.readOnly.of(!!opts.readOnly), EditorView.editable.of(!opts.readOnly)]),
        hint.of(opts.placeholder ? placeholder(opts.placeholder) : []),
        indent.of(indentUnit.of(detectIndent(text))),
        keymap.of([...keys, ...historyKeymap, ...standardKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && onChange && !u.transactions.some((tr) => tr.annotation(fromNotes))) onChange(u.state.doc.toString());
          if ((u.docChanged || u.selectionSet) && onSelection) onSelection();
        }),
      ],
    });
  };

  const view = new EditorView({ parent, state: stateFor('', {}) });
  const clamp = (n) => Math.max(0, Math.min(Number(n) || 0, view.state.doc.length));

  return {
    dom: view.dom,
    // A new document (another note, or the file read again): its undo history starts here.
    load(text, opts) { view.setState(stateFor(String(text || ''), opts || {})); },
    get value() { return view.state.doc.toString(); },
    // The text replaced by Notes. Only the part that differs is changed, so the caret and the scroll stay where they
    // were when the change is elsewhere. It is one undo step, unless history is false: text that came from outside
    // (the file saved by another program, a live or vault update) is not the person's to undo, and undoing it would
    // save the old text over the new.
    setValue(text, { history = true } = {}) {
      const next = String(text || '').replace(/\r\n?/g, '\n'), prev = view.state.doc.toString();
      if (next === prev) return;
      let start = 0;
      while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
      let endPrev = prev.length, endNext = next.length;
      while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) { endPrev--; endNext--; }
      const annotations = history ? [fromNotes.of(true)] : [fromNotes.of(true), Transaction.addToHistory.of(false)];
      view.dispatch({ changes: { from: start, to: endPrev, insert: next.slice(start, endNext) }, annotations });
    },
    // The person's undo and redo from outside the keyboard (the context menu).
    undo() { return undo(view); },
    redo() { return redo(view); },
    get selectionStart() { return view.state.selection.main.from; },
    get selectionEnd() { return view.state.selection.main.to; },
    setSelectionRange(from, to) {
      view.dispatch({ selection: EditorSelection.single(clamp(from), clamp(to === undefined ? from : to)), annotations: fromNotes.of(true) });
    },
    // As a textarea's setRangeText: mode is 'select', 'start', 'end' or 'preserve' (the default).
    setRangeText(text, from, to, mode) {
      const a = clamp(from), b = Math.max(a, clamp(to)), insert = String(text);
      const spec = { changes: { from: a, to: b, insert }, annotations: fromNotes.of(true) };
      if (mode === 'select') spec.selection = EditorSelection.single(a, a + insert.length);
      else if (mode === 'start') spec.selection = EditorSelection.cursor(a);
      else if (mode === 'end') spec.selection = EditorSelection.cursor(a + insert.length);
      view.dispatch(spec);
    },
    // Scrolls a position to the middle of the view (a find match, a line).
    reveal(at) { view.dispatch({ effects: EditorView.scrollIntoView(clamp(at), { y: 'center' }) }); },
    focus() { view.focus(); },
    hasFocus() { return view.hasFocus; },
    contains(node) { return !!node && view.dom.contains(node); },
    setReadOnly(readOnly) { view.dispatch({ effects: writable.reconfigure([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]) }); },
    // The caret's line and column, counted from 1.
    position() {
      const head = view.state.selection.main.head, line = view.state.doc.lineAt(head);
      return { line: line.number, col: head - line.from + 1 };
    },
    destroy() { view.destroy(); },
  };
}
