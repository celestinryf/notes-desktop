import { el } from './dom.ts';

type MathEdit = import('../editor/index.ts').MathEdit;

const MAX_SOURCE_LINES = 8;
const GAP = 8;

export function createMathEditor() {
  let current: MathEdit | null = null;

  const isOpen = () => current !== null;

  function grow() {
    const ta = el.mathSource;
    ta.style.height = 'auto';
    const cs = getComputedStyle(ta);
    const borders = ta.offsetHeight - ta.clientHeight;
    const most = (parseFloat(cs.lineHeight) || 20) * MAX_SOURCE_LINES + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + borders;
    ta.style.height = Math.min(ta.scrollHeight + borders, most) + 'px';
  }

  function showError() {
    const message = window.NotesEditor ? window.NotesEditor.mathError(el.mathSource.value) : null;
    el.mathError.textContent = message || '';
    el.mathError.classList.toggle('hidden', !message);
    el.mathHint.classList.toggle('hidden', !!message);
    el.mathSource.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function hide() {
    el.mathEditor.classList.add('hidden');
    el.mathSource.value = '';
    el.mathError.classList.add('hidden');
    el.mathHint.classList.remove('hidden');
  }

  function place(anchor: HTMLElement) {
    const pop = el.mathEditor;
    pop.style.left = '0px';
    pop.style.top = '0px';
    pop.classList.remove('hidden');
    const at = anchor.getBoundingClientRect();
    const column = (anchor.closest('.rich-editor-content') || anchor).getBoundingClientRect();
    const width = pop.offsetWidth, height = pop.offsetHeight;
    const x = Math.max(GAP, column.left, Math.min(at.left, window.innerWidth - width - GAP));
    const below = at.bottom + GAP;
    const y = below + height <= window.innerHeight - GAP ? below : Math.max(GAP, at.top - height - GAP);
    pop.style.left = Math.round(x) + 'px';
    pop.style.top = Math.round(y) + 'px';
  }

  function open(edit: MathEdit) {
    if (current) finish();
    current = edit;
    edit.onEnd(() => { if (current === edit) { current = null; hide(); } });
    el.mathEditor.dataset.kind = edit.kind;
    el.mathSource.setAttribute('aria-label', edit.kind === 'block' ? 'Formula block in TeX' : 'Formula in TeX');
    el.mathSource.value = edit.latex;
    el.mathEditor.classList.remove('hidden');
    showError();
    grow();
    place(edit.anchor);
    el.mathSource.focus();
    el.mathSource.setSelectionRange(edit.latex.length, edit.latex.length);
  }

  function finish() {
    const edit = current;
    if (!edit) return;
    current = null;
    const latex = el.mathSource.value;
    hide();
    edit.finish(latex);
  }

  function remove() {
    const edit = current;
    if (!edit) return;
    current = null;
    hide();
    edit.remove();
  }

  el.mathSource.addEventListener('input', () => {
    if (!current) return;
    grow();
    showError();
    current.preview(el.mathSource.value);
    place(current.anchor);
  });

  el.mathSource.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); finish(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); return; }
    if (e.key === 'Backspace' && !el.mathSource.value) { e.preventDefault(); remove(); return; }
    e.stopPropagation();
  });

  el.mathEditor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
  });

  el.mathDone.addEventListener('click', finish);

  el.mathEditor.addEventListener('focusout', (e) => {
    if (e.relatedTarget instanceof Node && el.mathEditor.contains(e.relatedTarget)) return;
    finish();
  });

  return { open, finish, isOpen };
}
