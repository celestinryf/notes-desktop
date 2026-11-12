import { el } from './dom.ts';
import { state } from './state.ts';
import { find } from './find-state.ts';
import * as H from '../shared/helpers.mts';
import { toast } from './toast.ts';

const { isPlainTextFile, isViewerOnlyFile } = H;

let code: CodeEditor | null = null;
let codeOn = false;
let codeFailed = false;

type CodeEditorHooks = { runFind: (forward?: boolean) => void, autoGrow: () => void, scrollTextareaToSelection: (at: number) => void };

let hooks: CodeEditorHooks = { runFind: () => {}, autoGrow: () => {}, scrollTextareaToSelection: () => {} };

const shown = () => (codeOn && state.sourceMode ? code : null);

export const src = {
  get value() { return el.bodyInput.value; },
  set value(text: string) { el.bodyInput.value = text; const c = shown(); if (c) c.setValue(el.bodyInput.value); },
  reload(text: string) { el.bodyInput.value = text; const c = shown(); if (c) c.setValue(el.bodyInput.value, { history: false }); },
  get readOnly() { return el.bodyInput.readOnly; },
  get selectionStart() { const c = shown(); return c ? c.selectionStart : el.bodyInput.selectionStart; },
  get selectionEnd() { const c = shown(); return c ? c.selectionEnd : el.bodyInput.selectionEnd; },
  setSelectionRange(from: number, to: number) { const c = shown(); if (c) c.setSelectionRange(from, to); else el.bodyInput.setSelectionRange(from, to); },
  setRangeText(text: string, from: number, to: number, mode: 'select' | 'start' | 'end' | 'preserve') {
    const c = shown();
    if (c) { c.setRangeText(text, from, to, mode); el.bodyInput.value = c.value; }
    else el.bodyInput.setRangeText(text, from, to, mode);
  },
  focus() { const c = shown(); if (c) c.focus(); else el.bodyInput.focus(); },
  hasFocus() { const c = shown(); return c ? c.hasFocus() : document.activeElement === el.bodyInput; },
  reveal(at: number) { const c = shown(); if (c) c.reveal(at); else hooks.scrollTextareaToSelection(at); },
  dispatchEvent(event: Event) { return el.bodyInput.dispatchEvent(event); },
  get codeOn() { return !!shown(); },
  sync() { const c = shown(); if (c) c.setValue(el.bodyInput.value, { history: false }); },
  undoRedo(cmd: 'undo' | 'redo') {
    const c = shown();
    if (!c || !c.contains(document.activeElement)) return false;
    c[cmd === 'redo' ? 'redo' : 'undo']();
    return true;
  },
};

const PROSE_EXT = new Set(['txt', 'text']);
const isProseFile = (note: PublicNote) => isPlainTextFile(note) && PROSE_EXT.has(H.extOf(note.filePath));
const isMarkdownNote = (note: PublicNote) => !isPlainTextFile(note) && !isViewerOnlyFile(note) && !H.isTableFile(note);

function codeEditor(): CodeEditor {
  if (!code) {
    if (!window.NotesCode) throw new Error('the code editor bundle did not load');
    code = window.NotesCode.create({
      parent: el.codeHost,
      onChange: (text: string) => { el.bodyInput.value = text; el.bodyInput.dispatchEvent(new Event('input', { bubbles: true })); },
      onSelection: () => { mirrorSelection(); renderCodePosition(); },
      onEnter: (shift: boolean) => { if (!find.open) return false; hooks.runFind(!shift); return true; },
    });
  }
  return code;
}

function mirrorSelection() {
  const c = shown();
  if (c) el.bodyInput.setSelectionRange(c.selectionStart, c.selectionEnd);
}

function showCode(note: PublicNote, readOnly: boolean) {
  const markdown = isMarkdownNote(note);
  codeOn = !!window.NotesCode && !codeFailed && (markdown || (isPlainTextFile(note) && !isProseFile(note)));
  if (codeOn) {
    try {
      codeEditor().load(el.bodyInput.value, { ext: markdown ? 'md' : H.extOf(note.filePath), readOnly, placeholder: markdown ? el.bodyInput.placeholder : 'Plain text.', label: H.deriveTitle(note) });
    } catch (err) {
      console.error('The code editor could not start:', err);
      codeFailed = true;
      codeOn = false;
      toast('The code editor could not start, so this file opens as plain text.');
    }
  }
  if (!codeOn && code) { try { code.load('', {}); } catch (_) {  } }
  el.bodyInput.classList.toggle('uses-code', codeOn);
  el.bodyInput.classList.toggle('is-prose', isProseFile(note));
  renderCodePosition();
  hooks.autoGrow();
}

export function renderCodePosition() {
  const c = shown();
  el.statusCode.classList.toggle('hidden', !c);
  if (!c) return;
  const at = c.position();
  el.statusCode.textContent = 'Ln ' + at.line + ', Col ' + at.col;
}

export function createCodeEditor({ runFind, autoGrow, scrollTextareaToSelection }: CodeEditorHooks) {
  hooks = { runFind, autoGrow, scrollTextareaToSelection };
  return { showCode };
}
