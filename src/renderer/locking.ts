import { el, setLabel, setIcon } from './dom.ts';
import { state } from './state.ts';
import { find } from './find-state.ts';
import { src } from './code-editor.ts';
import * as H from '../shared/helpers.mts';
import { ipcErrorText } from './text.ts';
import { toast } from './toast.ts';
import { placePopover } from './popover.ts';
import { focusBody, autoGrow } from './editor-view.ts';

const { isViewerOnlyFile, isPlainTextFile } = H;

export function createLocking({ api, renderFileRow, flushSave, applyEditorMode, runFind, scheduleSave, renderStickyButton, updateStatus, refreshRow }) {
  function renderLockState(note) {
    const locked = !!(note && note.locked);
    const open = !!(note && note.unlocked);
    el.lockScreen.classList.toggle('hidden', !(locked && !open));
    el.lockScreenError.textContent = '';
    el.lockScreenPassword.value = '';
    el.lockBtn.classList.toggle('is-on', locked);
    setLabel(el.lockBtn, !locked ? 'Lock' : (open ? 'Unlocked' : 'Locked'));
    setIcon(el.lockBtn, locked && open ? 'lock-open' : 'lock');
    el.lockBtn.title = !locked ? 'Lock this note with a password (Ctrl+L)' : (open ? 'Unlocked for now: lock again or remove the lock (Ctrl+L)' : 'Locked. Enter the password below to read it (Ctrl+L)');
    if (locked && !open) {
      el.richEditor.classList.add('hidden');
      el.bodyInput.classList.add('hidden');
      if (state.rich) state.rich.setEditable(false);
    } else if (note) {
      renderFileRow(note); // restores the right editor for the mode
      if (state.rich) state.rich.setEditable(!note.trashedAt && !isViewerOnlyFile(note) && !isPlainTextFile(note));
    }
  }

  function onLockButton() {
    const note = state.current;
    if (!note || note.trashedAt || note.filePath) return;
    if (!note.locked) { openLockDialog('set'); return; }
    if (!note.unlocked) { el.lockScreenPassword.focus(); return; }
    placePopover(el.lockMenu, el.moreMenu.contains(el.lockBtn) ? el.moreBtn : el.lockBtn);
  }

  function openLockDialog(mode) {
    el.lockDialog.dataset.mode = mode;
    el.lockDialogTitle.textContent = mode === 'set' ? 'Lock note' : 'Remove lock';
    el.lockDialogHint.textContent = mode === 'set'
      ? 'The text is encrypted with this password. There is no recovery: if you forget it, the note stays locked.'
      : 'Enter the password to store this note in clear again.';
    el.lockConfirmRow.classList.toggle('hidden', mode !== 'set');
    el.lockSubmitBtn.textContent = mode === 'set' ? 'Lock' : 'Remove lock';
    el.lockPassword.value = ''; el.lockPassword2.value = ''; el.lockError.textContent = '';
    el.lockDialog.showModal();
    el.lockPassword.focus();
  }

  async function submitLockDialog() {
    const note = state.current;
    if (!note) return;
    const mode = el.lockDialog.dataset.mode;
    const pw = el.lockPassword.value;
    if (!pw) { el.lockError.textContent = 'Enter a password.'; return; }
    if (mode === 'set' && pw !== el.lockPassword2.value) { el.lockError.textContent = 'The two passwords differ.'; return; }
    await flushSave();
    try {
      const updated = mode === 'set' ? await api.lock.set(note.id, pw) : await api.lock.remove(note.id, pw);
      el.lockDialog.close();
      applyLockedNote(updated);
      toast(mode === 'set' ? 'Locked. It stays readable until you hide the app or choose Lock now.' : 'Lock removed.');
    } catch (err) {
      el.lockError.textContent = ipcErrorText(err);
    }
  }

  async function unlockFromScreen() {
    const note = state.current;
    if (!note) return;
    const pw = el.lockScreenPassword.value;
    if (!pw) { el.lockScreenError.textContent = 'Enter the password.'; return; }
    try {
      const updated = await api.lock.unlock(note.id, pw);
      applyLockedNote(updated);
      focusBody();
    } catch (err) {
      el.lockScreenError.textContent = /wrong password/i.test(String(err.message)) ? 'Wrong password.' : ipcErrorText(err);
      el.lockScreenPassword.select();
    }
  }

  // Swaps the open note for its fresh view after a lock change: body, editor, button, card.
  function applyLockedNote(updated) {
    if (!updated || updated.id !== state.currentId) return;
    state.current = updated;
    // Keystrokes that landed while the lock call ran (scrypt takes a moment) are kept and saved again;
    // a relocked note, on the other hand, must show no plaintext at all.
    const keepTyping = state.dirty && updated.unlocked;
    if (!keepTyping) {
      state.dirty = false;
      src.reload(updated.body);
      if (state.rich) {
        state.currentLossless = state.rich.setMarkdown(updated.body);
        // Same rule as opening a note: text the rendered view would rewrite opens as source.
        if (updated.unlocked && state.currentLossless === false && !state.sourceMode && state.lossyOverride !== updated.id) { applyEditorMode(true); toast('Switched to source: this note contains formatting the rendered view would change.'); }
      }
      state.pending.delete(updated.id);
      autoGrow();
      if (find.open) runFind(true, true, true);
    } else scheduleSave();
    renderLockState(updated);
    renderStickyButton(updated);
    updateStatus(updated);
    const idx = state.notes.findIndex((n) => n.id === updated.id);
    if (idx !== -1) { state.notes[idx] = updated; refreshRow(updated); }
  }

  async function lockMenuAction(action) {
    el.lockMenu.classList.add('hidden');
    const note = state.current;
    if (!note || !note.locked) return;
    if (action === 'relock') {
      const saved = await flushSave();
      if (!saved) { toast('Your latest typing could not be saved yet, so the note was not locked. Try again in a moment.'); return; }
      state.pending.delete(note.id);
      applyLockedNote(await api.lock.relock(note.id));
      toast('Locked.');
    }
    else if (action === 'remove') openLockDialog('remove');
  }

  return { renderLockState, onLockButton, submitLockDialog, unlockFromScreen, applyLockedNote, lockMenuAction };
}
