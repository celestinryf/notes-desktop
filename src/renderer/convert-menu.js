// @ts-check
import { el } from './dom.js';
import { state } from './state.js';
import { ipcErrorText } from './text.js';
import { toast } from './toast.js';
import { placePopover } from './popover.js';

export function createConvertMenu({ api, flushSave, openFiles }) {
  async function openConvertMenu() {
    const note = state.current;
    if (!note || !note.filePath) return;
    let opts;
    try { opts = await api.files.convertOptions(note.id); } catch (err) { toast('Could not convert: ' + ipcErrorText(err)); return; }
    if (state.currentId !== note.id) return;
    if (!opts.length) { toast('Notes cannot convert this kind of file.'); return; }
    el.convertMenu.replaceChildren(...opts.map((o) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      b.dataset.to = o.to;
      b.append(o.label);
      if (o.note) { const n = document.createElement('span'); n.className = 'menu-note'; n.textContent = o.note; b.append(n); }
      return b;
    }));
    placePopover(el.convertMenu, el.fileConvertBtn);
    el.convertMenu.querySelector('button').focus();
  }

  function closeConvertMenu() { el.convertMenu.classList.add('hidden'); }

  let converting = false;
  async function convertCurrent(to) {
    closeConvertMenu();
    const note = state.current;
    if (!note || !note.filePath || converting) return;
    converting = true;
    el.fileConvertBtn.disabled = true;
    try {
      await flushSave(); // a text file converts what is on disk, so unsaved typing goes there first
      toast('Converting…');
      const r = await api.files.convert(note.id, to);
      if (!r.ok) { toast('Could not convert: ' + r.error); return; }
      const name = r.filePath.split(/[\\/]/).pop();
      toast('Saved ' + name + ' next to the original.' + (r.warning ? ' ' + r.warning : ''), { label: 'Open', run: () => openFiles([r.filePath]) });
    } catch (err) {
      toast('Could not convert: ' + ipcErrorText(err));
    } finally {
      converting = false;
      el.fileConvertBtn.disabled = false;
    }
  }

  return { openConvertMenu, closeConvertMenu, convertCurrent };
}
