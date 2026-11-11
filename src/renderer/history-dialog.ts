import { el, I, setLabel, setIcon } from './dom.ts';
import { state, lockedNow } from './state.ts';
import { find } from './find-state.ts';
import { src } from './code-editor.ts';
import * as H from '../shared/helpers.mts';
import { toast } from './toast.ts';
import { autoGrow } from './editor-view.ts';
import { diffText, diffCounts, diffSummary } from '../shared/text-diff.mts';

const { isViewerOnlyFile } = H;

const KEPT_OUT_HINT = 'Kept out of history: new changes are not recorded. The versions below still hold its old text.';
const COPIES_HINT = 'A copy of this file is kept before a save, but not again within two minutes of the last copy while only Notes has written it: the last 30, and the one from before your first change this session. Restore puts a copy back in place; the file as it is now is kept too.';

interface HistoryDialogDeps {
  api: NotesApi;
  flushSave: () => Promise<boolean>;
  applyEditorMode: (source: boolean) => void;
  runFind: (forward?: boolean, fresh?: boolean, quiet?: boolean) => unknown;
  scheduleSave: () => void;
  reloadFile: () => Promise<boolean>;
}

const keepsCopies = (note: PublicNote) => !!note.filePath && (note.fileKind === 'pdf' || note.fileKind === 'docx');

export function createHistoryDialog({ api, flushSave, applyEditorMode, runFind, scheduleSave, reloadFile }: HistoryDialogDeps) {
  const hist: { versions: HistoryVersion[], copies: FileVersion[], current: string, index: number, noteId: string | null, opens: number, changes: Element[], changeAt: number } = { versions: [], copies: [], current: '', index: -1, noteId: null, opens: 0, changes: [], changeAt: -1 };
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
    el.historyRestoreBtn.textContent = 'Restore this version';
    el.historyPreview.classList.remove('is-copy');
    el.historyCompare.classList.add('hidden');
    el.historyDiffSummary.textContent = '';
    el.historyStatus.textContent = 'Loading…';
    renderDialogKeepOut(false);
    el.historyDialog.showModal();
    hist.noteId = note.id;
    hist.versions = [];
    hist.copies = [];
    hist.index = -1;
    if (keepsCopies(note)) { await openCopies(note); return; }
    const r = await api.app.historyVersions(note.id, pick ? 200 : 80);
    if (!r.ok) { el.historyStatus.textContent = r.error; return; }
    renderDialogKeepOut(r.keptOut);
    hist.current = r.current;
    hist.versions = r.versions.filter((v) => v.body !== r.current);
    el.historyCompare.classList.toggle('hidden', !hist.versions.length);
    el.historyStatus.textContent = hist.versions.length ? countText(hist.versions.length, 'earlier version') : r.keptOut ? 'No earlier versions.' : 'No earlier version differs from the current text yet.';
    hist.versions.forEach((v, i) => {
      const first = (v.body.split('\n').find((l) => l.trim()) || '(empty)').replace(/^#+\s*/, '');
      addRow(i, new Date(v.at).toLocaleString() + ' · ' + v.chars + ' chars', H.truncate(first, 48), () => showVersion(i));
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

  const countText = (n: number, noun: string) => n + ' ' + noun + (n === 1 ? '' : 's');

  function addRow(i: number, when: string, first: string, onPick: () => void) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.index = String(i);
    const whenEl = document.createElement('span');
    whenEl.className = 'when';
    whenEl.textContent = when;
    const firstEl = document.createElement('span');
    firstEl.className = 'first';
    firstEl.textContent = first;
    li.append(whenEl, firstEl);
    li.addEventListener('click', onPick);
    el.historyList.append(li);
  }

  function markRow(i: number) {
    hist.index = i;
    for (const li of el.historyList.children) if (li instanceof HTMLElement) li.classList.toggle('is-active', Number(li.dataset.index) === i);
    el.historyRestoreBtn.disabled = false;
  }

  function showVersion(i: number) {
    markRow(i);
    renderDiff();
  }

  const comparingBefore = () => el.historyCompareSelect.value === 'before';
  const compareBase = (i: number) => comparingBefore() ? (i + 1 < hist.versions.length ? hist.versions[i + 1].body : '') : hist.current;
  const oldestLoaded = (i: number) => comparingBefore() && i + 1 >= hist.versions.length;

  function renderDiff() {
    const v = hist.versions[hist.index];
    if (!v) return;
    const segments = diffText(compareBase(hist.index), v.body);
    el.historyPreview.replaceChildren(...segments.map((s) => {
      if (s.kind === 'same') return document.createTextNode(s.text);
      const mark = document.createElement(s.kind === 'add' ? 'ins' : 'del');
      mark.textContent = s.text;
      return mark;
    }));
    el.historyDiffSummary.textContent = oldestLoaded(hist.index) ? 'The oldest version loaded, so all of it reads as added.' : diffSummary(diffCounts(segments));
    hist.changes = Array.from(el.historyPreview.querySelectorAll('ins, del')).filter((m, i, all) => !(m.tagName === 'INS' && i > 0 && all[i - 1].tagName === 'DEL'));
    hist.changeAt = -1;
    if (hist.changes.length) stepChange(1); else el.historyPreview.scrollTop = 0;
  }

  function stepChange(dir: 1 | -1) {
    if (!hist.changes.length) return;
    hist.changeAt = (hist.changeAt + dir + hist.changes.length) % hist.changes.length;
    hist.changes[hist.changeAt].scrollIntoView({ block: 'center' });
  }

  function changeCompare() {
    if (hist.versions.length) renderDiff();
  }

  async function openCopies(note: PublicNote) {
    el.historyHint.textContent = COPIES_HINT;
    el.historyRestoreBtn.textContent = 'Restore this copy';
    el.historyPreview.classList.add('is-copy');
    const opened = ++hist.opens;
    let copies: FileVersion[];
    try { copies = await api.files.versions(note.id); }
    catch (err) { if (opened === hist.opens) el.historyStatus.textContent = 'Could not list the earlier copies: ' + (err.message || err); return; }
    if (opened !== hist.opens) return;
    hist.copies = copies;
    el.historyStatus.textContent = copies.length === 0 ? 'No earlier copies yet. One is kept each time Notes saves this file.' : copies.length === 1 ? '1 earlier copy' : copies.length + ' earlier copies';
    copies.forEach((c, i) => addRow(i, H.sizeText(c.bytes), new Date(c.at).toLocaleString(), () => showCopy(i)));
    if (copies.length) showCopy(0);
  }

  function showCopy(i: number) {
    markRow(i);
    const c = hist.copies[i];
    el.historyPreview.textContent = 'The file as it was at ' + new Date(c.at).toLocaleString() + ', ' + H.sizeText(c.bytes) + '.';
  }

  async function restoreCopy() {
    const c = hist.copies[hist.index];
    const note = state.current;
    if (!c || !note) return;
    el.historyDialog.close();
    if (state.currentId !== hist.noteId || note.id !== hist.noteId || note.trashedAt || lockedNow()) { toast('This file cannot take the restored copy right now.'); return; }
    const r = await api.files.restoreVersion(note.id, c.name, note.fileMtime);
    if (!r.ok) { toast('Could not restore that copy: ' + (r.error || 'unknown error')); return; }
    const when = new Date(c.at).toLocaleString();
    if (await reloadFile()) toast('Restored the copy from ' + when + '. The file you had is kept as a copy too.');
    else toast('The copy from ' + when + ' is in place on disk; the view still shows the file as it was. Reload it to see the copy.');
  }

  async function restoreVersion() {
    if (hist.copies.length) { await restoreCopy(); return; }
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

  return { openHistory, restoreVersion, renderKeepOut, toggleKeepOut, recordAgain, changeCompare, stepChange };
}
