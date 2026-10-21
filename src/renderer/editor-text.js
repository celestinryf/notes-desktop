import { el } from './dom.js';
import { find } from './find-state.js';

export function createEditorText({ runFind, scheduleSave }) {
  function wrapSelection(before, after) {
    const ta = el.bodyInput;
    if (ta.readOnly) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const selected = value.slice(s, e);
    const already = value.slice(s - before.length, s) === before && value.slice(e, e + after.length) === after;
    if (already) {
      ta.setRangeText(selected, s - before.length, e + after.length, 'select');
    } else {
      ta.setRangeText(before + selected + after, s, e, 'select');
      ta.setSelectionRange(s + before.length, s + before.length + selected.length);
    }
    scheduleSave();
  }

  function handleEditorKeydown(e) {
    if (e.isComposing || e.keyCode === 229) return; // an IME is composing (CJK input): Enter and Tab belong to it
    // While the find bar is open, Enter in the text steps between matches instead of replacing the selected
    // match with a newline (focus lands here after Enter in the bar, so that would eat the match).
    if (find.open && e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); runFind(!e.shiftKey); return; }
    const ta = el.bodyInput;
    if (e.key === 'Tab' && e.shiftKey) {
      // Outdent the current line when it is indented; otherwise let focus move back to the tags field.
      const value = ta.value;
      const lineStart = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      const indent = /^( {1,2}|\t)/.exec(value.slice(lineStart));
      if (!indent || ta.readOnly) return;
      e.preventDefault();
      const caret = ta.selectionStart;
      ta.setRangeText('', lineStart, lineStart + indent[0].length, 'preserve');
      ta.setSelectionRange(Math.max(lineStart, caret - indent[0].length), Math.max(lineStart, caret - indent[0].length));
      scheduleSave();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (ta.readOnly) return;
      ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
      scheduleSave();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !ta.readOnly) {
      // Continue lists and checklists on the next line.
      const value = ta.value;
      const lineStart = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      const line = value.slice(lineStart, ta.selectionStart);
      const m = /^(\s*)([-*+]|\d+[.)])\s(\[[ xX]\]\s)?(.*)$/.exec(line);
      if (!m) return;
      e.preventDefault();
      if (!m[4].trim() && !m[3]) {
        // Empty bullet: end the list.
        ta.setRangeText('', lineStart, ta.selectionStart, 'end');
      } else if (!m[4].trim() && m[3]) {
        ta.setRangeText('', lineStart, ta.selectionStart, 'end');
      } else {
        const marker = /^\d+/.test(m[2]) ? (parseInt(m[2], 10) + 1) + m[2].slice(-1) : m[2];
        ta.setRangeText('\n' + m[1] + marker + ' ' + (m[3] ? '[ ] ' : ''), ta.selectionStart, ta.selectionEnd, 'end');
      }
      scheduleSave();
    }
  }

  return { wrapSelection, handleEditorKeydown };
}
