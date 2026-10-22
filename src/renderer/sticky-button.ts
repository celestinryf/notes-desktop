import { el, setLabel } from './dom.ts';
import { state } from './state.ts';
import * as H from '../shared/helpers.mts';
import { toast } from './toast.ts';

const { isViewerOnlyFile, isPlainTextFile } = H;

export function createStickyButton({ api, flushSave, refreshCurrentMeta }) {
  function renderStickyButton(note) {
    const on = !!(note && note.sticky);
    el.stickyBtn.classList.toggle('is-on', on);
    setLabel(el.stickyBtn, on ? 'Take off the desktop' : 'Stick to the desktop');
    el.stickyBtn.title = on ? 'Remove this note from the desktop (Ctrl+Shift+T)' : 'Put this note on the desktop as a sticky (Ctrl+Shift+T)';
    // A sticky shows rendered Markdown, so neither a PDF/Word file nor a plain-text file can become one (one that
    // already is can still be removed).
    const notMarkdown = isViewerOnlyFile(note) || isPlainTextFile(note);
    el.stickyBtn.disabled = !note || !!note.trashedAt || (notMarkdown && !on) || !!note.locked;
    el.stickyBtn.title = note && note.locked ? 'Locked notes cannot be stickies' : el.stickyBtn.title;
  }

  async function toggleSticky() {
    const note = state.current;
    if (!note || el.stickyBtn.disabled) return;
    await flushSave();
    try {
      if (note.sticky) {
        await api.stickies.close(note.id, { forget: true });
        toast('Removed from the desktop. The note is kept.');
      } else {
        await api.stickies.open(note.id);
        toast('On the desktop. Drag its top bar to move it; its close button removes it, Esc just hides it (tray → Stickies brings it back).');
      }
    } catch (err) {
      toast('Could not change the sticky: ' + (err.message || err));
    }
    await refreshCurrentMeta();
  }

  return { renderStickyButton, toggleSticky };
}
