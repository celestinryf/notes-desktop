import { el } from './dom.ts';
import * as H from '../shared/helpers.mts';
import { ipcErrorText } from './text.ts';

const HINT = 'Notes saves it as a shortcut in your notes folder and shows the page there.';
const NOT_LOCAL = 'Use an address on this computer, such as localhost:5173 or 127.0.0.1:8000.';

type WebPageDialogDeps = {
  api: NotesApi,
  opened: (note: PublicNote) => Promise<unknown>,
};

export function createWebPageDialog({ api, opened }: WebPageDialogDeps) {
  let folderId: string | null = null;
  let busy = false;

  function check() {
    const text = el.webPageInput.value.trim();
    const ok = !!H.localPageAddress(text);
    el.webPageHint.textContent = !text || ok ? HINT : NOT_LOCAL;
    el.webPageApplyBtn.disabled = !ok || busy;
    return ok;
  }

  function open(inFolder: string | null) {
    folderId = inFolder;
    busy = false;
    el.webPageInput.value = '';
    check();
    el.webPageDialog.showModal();
    el.webPageInput.focus();
  }

  async function submit() {
    const url = H.localPageAddress(el.webPageInput.value);
    if (!url || busy) { check(); return; }
    busy = true;
    check();
    try {
      const note = await api.pages.createLink(url, folderId);
      el.webPageDialog.close();
      if (note) await opened(note);
    } catch (err) {
      el.webPageHint.textContent = 'Could not add the page: ' + ipcErrorText(err);
    } finally {
      busy = false;
      if (el.webPageDialog.open) el.webPageApplyBtn.disabled = !H.localPageAddress(el.webPageInput.value);
    }
  }

  function bind() {
    el.webPageInput.addEventListener('input', check);
    el.webPageForm.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    el.webPageCancelBtn.addEventListener('click', () => { el.webPageDialog.close(); });
  }

  return { open, bind };
}
