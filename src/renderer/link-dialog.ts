import { el, I } from './dom.ts';
import { state } from './state.ts';
import { toast } from './toast.ts';
import { focusBody } from './editor-view.ts';
import * as H from '../shared/helpers.mts';
import { linkChoices } from './link-choices.ts';
import type { LinkChoice } from './link-choices.ts';

const LINK_ROWS = 6;
const NO_MATCH = 'No notes match. Paste a web address to link to a page.';

type LinkDialogDeps = { api: NotesApi; folderNames: () => Map<string, string> };

export function createLinkDialog({ api, folderNames }: LinkDialogDeps) {
  const pick: { rows: ListRow[] | null; choices: LinkChoice[]; active: number; seq: number; existing: string | null } = { rows: null, choices: [], active: -1, seq: 0, existing: null };

  const activeHref = () => (pick.active >= 0 && pick.choices[pick.active] ? pick.choices[pick.active].href : null);

  function open() {
    const rich = state.rich;
    if (!rich || state.sourceMode) return;
    const existing = rich.activeLink() || null;
    if (!existing && !rich.hasSelection()) { toast('Select the text to link first'); return; }
    state.linkRange = rich.selectionRange();
    const linkedNote = /^note:\/\/(.+)$/.exec(existing || '');
    const seq = ++pick.seq;
    pick.rows = null;
    pick.existing = existing;
    el.linkInput.value = linkedNote ? '' : existing || '';
    el.linkRemoveBtn.classList.toggle('hidden', !existing);
    render(existing);
    el.linkDialog.showModal();
    el.linkInput.focus();
    el.linkInput.select();
    api.notes.rows({ sort: 'updated' }).catch((): ListRow[] => []).then((rows) => {
      if (seq !== pick.seq || !el.linkDialog.open) return;
      pick.rows = rows;
      const target = linkedNote ? rows.find((n) => n.id === linkedNote[1]) : null;
      if (target && !el.linkInput.value) { el.linkInput.value = H.deriveTitle(target); el.linkInput.select(); }
      render(activeHref() || pick.existing);
    });
  }

  function render(keep: string | null) {
    pick.choices = linkChoices(el.linkInput.value, pick.rows || [], state.currentId, LINK_ROWS);
    const kept = keep === null ? -1 : pick.choices.findIndex((c) => c.href === keep);
    pick.active = kept >= 0 ? kept : el.linkInput.value.trim() && pick.choices.length ? 0 : -1;
    const names = folderNames();
    el.linkResults.replaceChildren(...pick.choices.map((c, i) => choiceRow(c, i, names)));
    el.linkEmpty.textContent = pick.rows && !pick.choices.length && el.linkInput.value.trim() ? NO_MATCH : '';
    el.linkInput.setAttribute('aria-expanded', String(pick.choices.length > 0));
    mark();
  }

  function choiceRow(c: LinkChoice, i: number, names: Map<string, string>) {
    const row = document.createElement('div');
    row.className = 'inline-item';
    row.id = 'link-choice-' + i;
    row.setAttribute('role', 'option');
    if (c.noteId) row.dataset.id = c.noteId;
    row.innerHTML = I(c.icon);
    const label = document.createElement('span');
    label.className = 'lbl';
    label.textContent = c.label;
    row.append(label);
    const folder = c.folderId ? names.get(c.folderId) : undefined;
    if (folder) {
      const where = document.createElement('span');
      where.className = 'link-where';
      where.textContent = folder;
      where.title = folder;
      row.append(where);
    }
    const keys = document.createElement('span');
    keys.className = 'keys';
    keys.textContent = c.keys;
    row.append(keys);
    row.addEventListener('mousedown', (e) => { e.preventDefault(); apply(i); });
    row.addEventListener('mousemove', () => { if (pick.active !== i) { pick.active = i; mark(); } });
    return row;
  }

  function mark() {
    el.linkResults.querySelectorAll('[role="option"]').forEach((row, i) => {
      row.classList.toggle('is-active', i === pick.active);
      row.setAttribute('aria-selected', String(i === pick.active));
    });
    if (pick.active >= 0) el.linkInput.setAttribute('aria-activedescendant', 'link-choice-' + pick.active);
    else el.linkInput.removeAttribute('aria-activedescendant');
    el.linkApplyBtn.disabled = pick.active < 0;
  }

  function move(step: number) {
    const n = pick.choices.length;
    pick.active = pick.active < 0 ? (step > 0 ? 0 : n - 1) : (pick.active + step + n) % n;
    mark();
  }

  function apply(i: number) {
    const choice = pick.choices[i];
    if (!choice) return;
    el.linkDialog.close();
    if (state.rich) state.rich.setLink(choice.href, state.linkRange);
  }

  function bind() {
    el.linkInput.addEventListener('input', () => render(null));
    el.linkInput.addEventListener('keydown', (e) => {
      if (e.isComposing || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !pick.choices.length) return;
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
