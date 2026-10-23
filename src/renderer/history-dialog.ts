import { el } from './dom.ts';
import { state, lockedNow } from './state.ts';
import { find } from './find-state.ts';
import { src } from './code-editor.ts';
import * as H from '../shared/helpers.mts';
import { toast } from './toast.ts';
import { autoGrow } from './editor-view.ts';

const { isViewerOnlyFile } = H;

interface HistoryDialogDeps {
  api: NotesApi;
  flushSave: () => Promise<boolean>;
  applyEditorMode: (source: boolean) => void;
  runFind: (forward?: boolean, fresh?: boolean, quiet?: boolean) => unknown;
  scheduleSave: () => void;
}

export function createHistoryDialog({ api, flushSave, applyEditorMode, runFind, scheduleSave }: HistoryDialogDeps) {
  const hist: { versions: HistoryVersion[], index: number, noteId: string | null } = { versions: [], index: -1, noteId: null };

  async function openHistory() {
    const note = state.current;
    if (!note) return;
    if (note.trashedAt) { toast('Restore the note from the trash first; then its earlier versions can be restored.'); return; }
    await flushSave();
    el.historyList.innerHTML = '';
    el.historyPreview.textContent = '';
    el.historyRestoreBtn.disabled = true;
    el.historyStatus.textContent = 'Loading…';
    el.historyDialog.showModal();
    const r = await api.app.historyVersions(note.id, 80);
    if (!r.ok) { el.historyStatus.textContent = r.error; return; }
    hist.noteId = note.id;
    hist.versions = r.versions.filter((v) => v.body !== r.current);
    hist.index = -1;
    el.historyStatus.textContent = hist.versions.length ? hist.versions.length + (hist.versions.length === 1 ? ' earlier version' : ' earlier versions') : 'No earlier version differs from the current text yet.';
    hist.versions.forEach((v, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.index = String(i);
      const first = (v.body.split('\n').find((l) => l.trim()) || '(empty)').replace(/^#+\s*/, '');
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = new Date(v.at).toLocaleString() + ' · ' + v.chars + ' chars';
      const firstLine = document.createElement('span');
      firstLine.className = 'first';
      firstLine.textContent = H.truncate(first, 48);
      li.append(when, firstLine);
      li.addEventListener('click', () => showVersion(i));
      el.historyList.append(li);
    });
    if (hist.versions.length) showVersion(0);
  }

  function showVersion(i: number) {
    hist.index = i;
    for (const li of el.historyList.children) if (li instanceof HTMLElement) li.classList.toggle('is-active', Number(li.dataset.index) === i);
    el.historyPreview.textContent = hist.versions[i].body;
    el.historyRestoreBtn.disabled = false;
  }

  async function restoreVersion() {
    const v = hist.versions[hist.index];
    const note = state.current;
    if (!v || !note) return;
    el.historyDialog.close();
    if (state.currentId !== hist.noteId || note.id !== hist.noteId || note.trashedAt || lockedNow() || isViewerOnlyFile(note)) { toast('This note cannot take the restored text right now.'); return; }
    src.value = v.body;
    if (state.rich) {
      let lossless = state.rich.setMarkdown(v.body);
      if (note.filePath && !note.home && lossless && !state.rich.lastRoundTripExact()) lossless = false;
      state.currentLossless = lossless;
      state.lossyOverride = null;
      if (!lossless && !state.sourceMode) applyEditorMode(true);
    }
    autoGrow();
    if (find.open) runFind(true, true, true);
    scheduleSave();
    const ok = await flushSave();
    if (ok) toast('Restored the version from ' + new Date(v.at).toLocaleString() + '. The text you had is still in history.');
    else if (state.conflictShown !== note.id) toast('Could not save the restored text yet; it will be retried.');
  }

  return { openHistory, restoreVersion };
}
