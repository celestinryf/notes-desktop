import { el } from './dom.js';
import { state } from './state.js';
import { find } from './find-state.js';
import H from '../shared/helpers.js';
import { toast } from './toast.js';

const { isPlainTextFile } = H;

let code = null;      // the code editor, made when a file first needs it
let codeOn = false;   // it is showing the open note's text
let codeFailed = false; // it could not start: files use the textarea until Notes restarts

// What the rest of the app lends the editor: set once by createCodeEditor.
let hooks = { runFind: () => {}, autoGrow: () => {}, scrollTextareaToSelection: () => {} };

// The source text and its selection, in whichever of the textarea and the code editor is showing it. Code that
// changes the text, moves the selection or focuses it goes through here, so the two never disagree.
export const src = {
  get value() { return el.bodyInput.value; },
  set value(text) { el.bodyInput.value = text; if (codeOn) code.setValue(el.bodyInput.value); },
  // Text that came from outside (the file changed on disk, a live or vault update, a lock): shown, not undoable.
  reload(text) { el.bodyInput.value = text; if (codeOn) code.setValue(el.bodyInput.value, { history: false }); },
  get readOnly() { return el.bodyInput.readOnly; },
  get selectionStart() { return codeOn ? code.selectionStart : el.bodyInput.selectionStart; },
  get selectionEnd() { return codeOn ? code.selectionEnd : el.bodyInput.selectionEnd; },
  setSelectionRange(from, to) { if (codeOn) code.setSelectionRange(from, to); else el.bodyInput.setSelectionRange(from, to); },
  focus() { if (codeOn) code.focus(); else el.bodyInput.focus(); },
  hasFocus() { return codeOn ? code.hasFocus() : document.activeElement === el.bodyInput; },
  // Scrolls a position into view (a find match, a heading).
  reveal(at) { if (codeOn) code.reveal(at); else hooks.scrollTextareaToSelection(at); },
  // The input event goes to the textarea, whose listeners save, count and refresh the find bar.
  dispatchEvent(event) { return el.bodyInput.dispatchEvent(event); },
  get codeOn() { return codeOn; },
  // Undo or redo in the code editor when the keyboard is in it; false when it is not.
  undoRedo(cmd) {
    if (!codeOn || !code.contains(document.activeElement)) return false;
    code[cmd === 'redo' ? 'redo' : 'undo']();
    return true;
  },
};

// An opened text file that is not Markdown (.txt, LaTeX, code, config) is edited in CodeMirror (src/code/index.js),
// shown in the textarea's place. The textarea still holds the text: saving, the title and the counts read it there,
// and the person's edits in the code editor are copied into it as they happen (with the textarea's input event).

// Prose files (.txt) are written, not coded: the plain text box in the writing font, as the user asked, with no
// line numbers or highlighting. LaTeX, code and config get the code editor.
const PROSE_EXT = new Set(['txt', 'text']);
const isProseFile = (note) => isPlainTextFile(note) && PROSE_EXT.has(H.extOf(note.filePath));

function codeEditor() {
  if (!code) {
    code = window.NotesCode.create({
      parent: el.codeHost,
      onChange: (text) => { el.bodyInput.value = text; el.bodyInput.dispatchEvent(new Event('input', { bubbles: true })); },
      onSelection: renderCodePosition,
      // While the find bar is open, Enter steps between matches, as it does in the textarea.
      onEnter: (shift) => { if (!find.open) return false; hooks.runFind(!shift); return true; },
    });
  }
  return code;
}

// Shows the note's text in the code editor when it is a plain-text file (and the editor is built), else in the
// textarea. A new note starts a new undo history.
function showCode(note, readOnly) {
  codeOn = !!window.NotesCode && !codeFailed && isPlainTextFile(note) && !isProseFile(note);
  if (codeOn) {
    try {
      codeEditor().load(el.bodyInput.value, { ext: H.extOf(note.filePath), readOnly, placeholder: 'Plain text.', label: H.deriveTitle(note) });
    } catch (err) {
      // Never a blank page: the textarea holds the text, so it shows it instead.
      console.error('The code editor could not start:', err);
      codeFailed = true;
      codeOn = false;
      toast('The code editor could not start, so this file opens as plain text.');
    }
  }
  if (!codeOn && code) { try { code.load('', {}); } catch (_) { /* nothing of the last file is kept around */ } }
  el.bodyInput.classList.toggle('uses-code', codeOn);
  el.bodyInput.classList.toggle('is-prose', isProseFile(note));
  renderCodePosition();
  hooks.autoGrow();
}

// The status line: where the caret is, for the code editor only (the file row's badge names the language).
export function renderCodePosition() {
  const shown = codeOn && state.sourceMode;
  el.statusCode.classList.toggle('hidden', !shown);
  if (!shown) return;
  const at = code.position();
  el.statusCode.textContent = 'Ln ' + at.line + ', Col ' + at.col;
}

export function createCodeEditor({ runFind, autoGrow, scrollTextareaToSelection }) {
  hooks = { runFind, autoGrow, scrollTextareaToSelection };
  return { showCode };
}
