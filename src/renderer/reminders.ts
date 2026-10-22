import { el, setLabel } from './dom.ts';
import { state } from './state.ts';
import * as H from '../shared/helpers.mts';
import { toast } from './toast.ts';
import { toLocalInputValue } from './remind-times.ts';

export function createReminders({ api, flushSave, refreshCurrentMeta }) {
  function renderRemindButton(note) {
    const on = !!(note && note.remindAt);
    el.remindBtn.classList.toggle('hidden', !note || !!note.trashedAt);
    el.remindBtn.classList.toggle('is-on', on);
    setLabel(el.remindBtn, on ? 'Reminder: ' + H.formatWhen(note.remindAt) : 'Remind me…');
    el.remindBtn.title = on ? 'Reminder set for ' + H.formatWhen(note.remindAt) + ' (Ctrl+Shift+M to change)' : 'Remind me about this note (Ctrl+Shift+M)';
  }

  function openRemindDialog() {
    const note = state.current;
    if (!note || note.trashedAt) return;
    const base = note.remindAt || (Math.ceil(Date.now() / (3600 * 1000)) * 3600 * 1000);
    el.remindInput.value = toLocalInputValue(base);
    el.remindCurrent.textContent = note.remindAt ? ('Currently: ' + H.formatWhen(note.remindAt) + (note.remindedAt ? ' (went off)' : '')) : 'No reminder on this note.';
    el.remindClearBtn.classList.toggle('hidden', !note.remindAt);
    el.remindDialog.showModal();
    el.remindInput.focus();
  }

  async function setReminder(at) {
    const note = state.current;
    if (!note) return;
    el.remindDialog.close();
    await flushSave();
    try {
      await api.notes.update(note.id, { remindAt: at });
      await refreshCurrentMeta();
      toast(at ? 'Reminder set for ' + H.formatWhen(at) : 'Reminder cleared');
    } catch (err) {
      toast('Could not save the reminder: ' + (err.message || err));
    }
  }

  return { renderRemindButton, openRemindDialog, setReminder };
}
