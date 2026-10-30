import { el, I, setLabel, setIcon } from './dom.ts';
import { state, lockedNow } from './state.ts';
import { find } from './find-state.ts';
import { src } from './code-editor.ts';
import * as H from '../shared/helpers.mts';
import { toast } from './toast.ts';
import { autoGrow } from './editor-view.ts';

const { isViewerOnlyFile } = H;

const KEPT_OUT_HINT = 'Kept out of history: new changes are not recorded. The versions below still hold its old text.';

interface HistoryDialogDeps {
  api: NotesApi;
  flushSave: () => Promise<boolean>;
  applyEditorMode: (source: boolean) => void;
  runFind: (forward?: boolean, fresh?: boolean, quiet?: boolean) => unknown;
  scheduleSave: () => void;
}

export function createHistoryDialog({ api, flushSave, applyEditorMode, runFind, scheduleSave }: HistoryDialogDeps) {
  const hist: { versions: HistoryVersion[], index: number, noteId: string | null } = { versions: [], index: -1, noteId: null };
  const recordedHint = el.historyHint.textContent || '';

  function renderKeepOut(note: PublicNote | null) {
    const out = !!(note && note.keepOutOfHistory);
    el.historyKeepBtn.classList.toggle('hidden', !note || !!note.trashedAt || (!!note.filePath && note.fileKind !== 'text'));
    el.historyKeepBtn.classList.toggle('is-on', out);
    setLabel(el.historyKeepBtn, out ? 'Record in history again' : 'Keep out of history');
    setIcon(el.historyKeepBtn, out ? 'eye' : 'eye-off');
    el.historyKeepBtn.title = out ? "Record this note's changes in history again" : "Stop recording this note's changes in history. Earlier versions keep its old text.";
  }

  function renderDialogKeepOut(out: boolean) {
    el.historyHint.classList.toggle('with-icon', out);
    if (out) {
      const words = document.createElement('span');
      words.textContent = KEPT_OUT_HINT;
      el.historyHint.innerHTML = I('eye-off');
      el.historyHint.append(words);
    } else el.historyHint.textContent = recordedHint;
    el.historyRecordBtn.classList.toggle('hidden', !out);
  }

  async function setKeepOut(id: string, on: boolean, undoable: boolean) {
    let fresh: PublicNote | null;
    try { fresh = await api.notes.keepOutOfHistory(id, on); }
    catch (err) { toast('Could not change that: ' + (err.message || err)); return; }
    if (!fresh) return;
    if (state.current && state.current.id === id) { state.current.keepOutOfHistory = fresh.keepOutOfHistory; renderKeepOut(state.current); }
    if (hist.noteId === id && el.historyDialog.open) renderDialogKeepOut(fresh.keepOutOfHistory);
    const undo = undoable ? { label: 'Undo', run: () => { setKeepOut(id, !on, false); } } : undefined;
    toast(on ? 'Kept out of history. New changes are not recorded; earlier versions still hold the old text.' : 'Recorded in history again.', undo);
  }

  function toggleKeepOut() {
    const note = state.current;
    if (note && !el.historyKeepBtn.classList.contains('hidden')) setKeepOut(note.id, !note.keepOutOfHistory, true);
  }

  function recordAgain() {
    if (!hist.noteId) return;
    if (document.activeElement === el.historyRecordBtn) el.historyCloseBtn.focus();
    setKeepOut(hist.noteId, false, true);
  }

  async function openHistory(pick?: { hash: string, at: number }) {
    const note = state.current;
    if (!note) return;
    if (note.trashedAt) { toast('Restore the note from the trash first; then its earlier versions can be restored.'); return; }
    await flushSave();
    el.historyList.innerHTML = '';
    el.historyPreview.textContent = '';
    el.historyRestoreBtn.disabled = true;
    el.historyStatus.textContent = 'Loading…';
    renderDialogKeepOut(false);
    el.historyDialog.showModal();
    const r = await api.app.historyVersions(note.id, pick ? 200 : 80);
    if (!r.ok) { el.historyStatus.textContent = r.error; return; }
    hist.noteId = note.id;
    renderDialogKeepOut(r.keptOut);
    hist.versions = r.versions.filter((v) => v.body !== r.current);
    hist.index = -1;
    el.historyStatus.textContent = hist.versions.length ? hist.versions.length + (hist.versions.length === 1 ? ' earlier version' : ' earlier versions') : r.keptOut ? 'No earlier versions.' : 'No earlier version differs from the current text yet.';
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
    if (hist.versions.length) {
      const at = pickIndex(pick);
      showVersion(at);
      if (pick && hist.versions[at].hash !== pick.hash) el.historyStatus.textContent = hist.versions[at].at <= pick.at ? 'The version you picked has the same text as the note now, so the one before it is shown.' : 'The version you picked is older than the ones listed, so the oldest listed is shown.';
    }
  }

  function pickIndex(pick?: { hash: string, at: number }) {
    if (!pick) return 0;
    const exact = hist.versions.findIndex((v) => v.hash === pick.hash);
    if (exact >= 0) return exact;
    const before = hist.versions.findIndex((v) => v.at <= pick.at);
    return before >= 0 ? before : hist.versions.length - 1;
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

  return { openHistory, restoreVersion, renderKeepOut, toggleKeepOut, recordAgain };
}
