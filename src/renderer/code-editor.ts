import { el } from './dom.ts';
import { state } from './state.ts';
import { find } from './find-state.ts';
import * as H from '../shared/helpers.mts';
import { toast } from './toast.ts';

const { isPlainTextFile } = H;

let code: CodeEditor | null = null;
let codeOn = false;
let codeFailed = false;

type CodeEditorHooks = { runFind: (forward?: boolean) => void, autoGrow: () => void, scrollTextareaToSelection: (at: number) => void };

let hooks: CodeEditorHooks = { runFind: () => {}, autoGrow: () => {}, scrollTextareaToSelection: () => {} };

const shown = () => (codeOn ? code : null);

export const src = {
  get value() { return el.bodyInput.value; },
  set value(text: string) { el.bodyInput.value = text; const c = shown(); if (c) c.setValue(el.bodyInput.value); },
  reload(text: string) { el.bodyInput.value = text; const c = shown(); if (c) c.setValue(el.bodyInput.value, { history: false }); },
  get readOnly() { return el.bodyInput.readOnly; },
  get selectionStart() { const c = shown(); return c ? c.selectionStart : el.bodyInput.selectionStart; },
  get selectionEnd() { const c = shown(); return c ? c.selectionEnd : el.bodyInput.selectionEnd; },
  setSelectionRange(from: number, to: number) { const c = shown(); if (c) c.setSelectionRange(from, to); else el.bodyInput.setSelectionRange(from, to); },
  focus() { const c = shown(); if (c) c.focus(); else el.bodyInput.focus(); },
  hasFocus() { const c = shown(); return c ? c.hasFocus() : document.activeElement === el.bodyInput; },
  reveal(at: number) { const c = shown(); if (c) c.reveal(at); else hooks.scrollTextareaToSelection(at); },
  dispatchEvent(event: Event) { return el.bodyInput.dispatchEvent(event); },
  get codeOn() { return !!shown(); },
  undoRedo(cmd: 'undo' | 'redo') {
    const c = shown();
    if (!c || !c.contains(document.activeElement)) return false;
    c[cmd === 'redo' ? 'redo' : 'undo']();
    return true;
  },
};

const PROSE_EXT = new Set(['txt', 'text']);
const isProseFile = (note: PublicNote) => isPlainTextFile(note) && PROSE_EXT.has(H.extOf(note.filePath));

function codeEditor(): CodeEditor {
  if (!code) {
    if (!window.NotesCode) throw new Error('the code editor bundle did not load');
    code = window.NotesCode.create({
      parent: el.codeHost,
      onChange: (text: string) => { el.bodyInput.value = text; el.bodyInput.dispatchEvent(new Event('input', { bubbles: true })); },
      onSelection: renderCodePosition,
      onEnter: (shift: boolean) => { if (!find.open) return false; hooks.runFind(!shift); return true; },
    });
  }
  return code;
}

function showCode(note: PublicNote, readOnly: boolean) {
  codeOn = !!window.NotesCode && !codeFailed && isPlainTextFile(note) && !isProseFile(note);
  if (codeOn) {
    try {
      codeEditor().load(el.bodyInput.value, { ext: H.extOf(note.filePath), readOnly, placeholder: 'Plain text.', label: H.deriveTitle(note) });
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
  const c = state.sourceMode ? shown() : null;
  el.statusCode.classList.toggle('hidden', !c);
  if (!c) return;
  const at = c.position();
  el.statusCode.textContent = 'Ln ' + at.line + ', Col ' + at.col;
}

export function createCodeEditor({ runFind, autoGrow, scrollTextareaToSelection }: CodeEditorHooks) {
  hooks = { runFind, autoGrow, scrollTextareaToSelection };
  return { showCode };
}
