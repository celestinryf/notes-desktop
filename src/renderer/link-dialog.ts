import { el, I } from './dom.ts';
import { state } from './state.ts';
import { toast } from './toast.ts';
import { focusBody } from './editor-view.ts';
import * as H from '../shared/helpers.mts';
import { linkChoices } from './link-choices.ts';
import type { LinkChoice } from './link-choices.ts';

const LINK_ROWS = 6;

export function createLinkDialog(api: NotesApi) {
  const pick: { rows: ListRow[] | null; choices: LinkChoice[]; active: number; seq: number } = { rows: null, choices: [], active: 0, seq: 0 };

  function open() {
    const rich = state.rich;
    if (!rich || state.sourceMode) return;
    const existing = rich.activeLink();
    if (!existing && !rich.hasSelection()) { toast('Select the text to link first'); return; }
    state.linkRange = rich.selectionRange();
    const linkedNote = /^note:\/\/(.+)$/.exec(existing || '');
    const seq = ++pick.seq;
    pick.rows = null;
    el.linkInput.value = linkedNote ? '' : existing || '';
    el.linkRemoveBtn.classList.toggle('hidden', !existing);
    render();
    el.linkDialog.showModal();
    el.linkInput.focus();
    el.linkInput.select();
    api.notes.rows({ sort: 'updated' }).catch((): ListRow[] => []).then((rows) => {
      if (seq !== pick.seq || !el.linkDialog.open) return;
      pick.rows = rows;
      const target = linkedNote ? rows.find((n) => n.id === linkedNote[1]) : null;
      if (target && !el.linkInput.value) { el.linkInput.value = H.deriveTitle(target); el.linkInput.select(); }
      render();
    });
  }

  function render() {
    pick.choices = linkChoices(el.linkInput.value, pick.rows || [], state.currentId, LINK_ROWS);
    pick.active = 0;
    el.linkResults.replaceChildren(...pick.choices.map(choiceRow));
    if (!pick.choices.length && pick.rows) {
      const empty = document.createElement('div');
      empty.className = 'link-empty';
      empty.textContent = 'No notes match';
      el.linkResults.append(empty);
    }
    mark();
  }

  function choiceRow(c: LinkChoice, i: number) {
    const row = document.createElement('div');
    row.className = 'inline-item';
    row.id = 'link-choice-' + i;
    row.setAttribute('role', 'option');
    if (c.noteId) row.dataset.id = c.noteId;
    row.innerHTML = I(c.icon);
    const label = document.createElement('span');
    label.className = 'lbl';
    label.textContent = c.label;
    const keys = document.createElement('span');
    keys.className = 'keys';
    keys.textContent = c.keys;
    row.append(label, keys);
    row.addEventListener('mousedown', (e) => { e.preventDefault(); apply(i); });
    row.addEventListener('mousemove', () => { if (pick.active !== i) { pick.active = i; mark(); } });
    return row;
  }

  function mark() {
    el.linkResults.querySelectorAll('[role="option"]').forEach((row, i) => {
      row.classList.toggle('is-active', i === pick.active);
      row.setAttribute('aria-selected', String(i === pick.active));
    });
    if (pick.choices.length) el.linkInput.setAttribute('aria-activedescendant', 'link-choice-' + pick.active);
    else el.linkInput.removeAttribute('aria-activedescendant');
    el.linkApplyBtn.disabled = !pick.choices.length;
  }

  function move(step: number) {
    const n = pick.choices.length;
    if (!n) return;
    pick.active = (pick.active + step + n) % n;
    mark();
  }

  function apply(i: number) {
    const choice = pick.choices[i];
    if (!choice) return;
    el.linkDialog.close();
    if (state.rich) state.rich.setLink(choice.href, state.linkRange);
  }

  function bind() {
    el.linkInput.addEventListener('input', render);
    el.linkInput.addEventListener('keydown', (e) => {
      if (e.isComposing || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    });
    el.linkForm.addEventListener('submit', (e) => { e.preventDefault(); apply(pick.active); });
    el.linkRemoveBtn.addEventListener('click', () => { el.linkDialog.close(); if (state.rich) state.rich.setLink('', state.linkRange); });
    el.linkCancelBtn.addEventListener('click', () => el.linkDialog.close());
    el.linkDialog.addEventListener('close', () => focusBody());
  }

  return { open, bind };
}
