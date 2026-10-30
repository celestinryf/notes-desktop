import { el, setLabel, setIcon } from './dom.ts';
import * as H from '../shared/helpers.mts';
import { toast } from './toast.ts';
import { ipcErrorText } from './text.ts';

const PAGE = 100;
const LIST_STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 };
const GIT_DOWNLOAD = 'https://git-scm.com/download/win';
const KIND_WORDS: Record<VersionChangeKind, string> = { added: 'added', changed: 'changed', renamed: 'renamed', removed: 'removed' };

type HistoryLook = { icon: string, label: string, error: boolean };

export function historyLook(s: GitState, now?: number): HistoryLook {
  if (!s.enabled) return { icon: 'history', label: 'History is off', error: false };
  if (s.available === false) return { icon: 'circle-alert', label: 'History needs git', error: true };
  if (s.lastError) return { icon: 'cloud-alert', label: /^(push|sync) failed/.test(s.lastError) ? 'Sync failed' : 'History needs attention', error: true };
  if (s.pending) return { icon: 'cloud-upload', label: 'Saving a version…', error: false };
  if (!s.commits) return { icon: 'history', label: 'No versions yet', error: false };
  if (s.remote) return s.lastPushAt ? { icon: 'cloud-check', label: 'Synced ' + H.relativeTime(s.lastPushAt, now), error: false } : { icon: 'cloud-upload', label: 'Not synced yet', error: false };
  return { icon: 'history', label: 'Saved ' + H.relativeTime(s.lastCommitAt ?? 0, now) + ', this PC only', error: false };
}

function remoteName(url: string) {
  const m = /github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/i.exec(url.trim());
  return m ? 'github.com/' + m[1] : url.trim();
}

export function statusSentence(s: GitState) {
  if (!s.enabled) return 'History is off. Turn it on to keep every change to your notes, so any note can go back to an earlier version.';
  if (s.available === false) return 'Notes keeps history with git, and git is not installed on this PC. Install Git for Windows, then restart Notes.';
  const saved = s.commits ? 'The last version was saved ' + H.relativeTime(s.lastCommitAt ?? 0) + '.' : 'No versions yet.';
  if (!s.remote) return saved + ' They are on this PC only. Sync with a GitHub repository to keep a copy somewhere else and to have your notes on another computer.';
  return saved + ' ' + (s.lastPushAt ? 'Synced ' + H.relativeTime(s.lastPushAt) + ' with ' + remoteName(s.remote) + '.' : 'Not synced with ' + remoteName(s.remote) + ' yet.');
}

function dayLabel(at: number, now: number) {
  const day = new Date(at); day.setHours(0, 0, 0, 0);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function changedSummary(v: LibraryVersion) {
  const titles = Array.from(new Set(v.changes.map((c) => c.title)));
  const shown = titles.slice(0, 2).join(', ');
  return titles.length > 2 ? shown + ' and ' + (titles.length - 2) + ' more' : shown;
}

interface LibraryDialogDeps {
  api: NotesApi;
  flushSave: () => Promise<boolean>;
  updateSettings: (patch: SettingsPatch) => Promise<unknown>;
  openSettingsAt: (sectionId: string) => void;
  openNoteHistory: (id: string, pick: { hash: string, at: number }) => Promise<unknown>;
  openNote: (id: string) => Promise<unknown>;
}

export function createLibraryDialog({ api, flushSave, updateSettings, openSettingsAt, openNoteHistory, openNote }: LibraryDialogDeps) {
  const lib: { status: GitState | null, versions: LibraryVersion[], index: number, limit: number, more: boolean, loads: number } = { status: null, versions: [], index: -1, limit: PAGE, more: false, loads: 0 };

  function renderStatus(s: GitState) {
    lib.status = s;
    const look = historyLook(s);
    setLabel(el.historyStatusBtn, look.label);
    setIcon(el.historyStatusBtn, look.icon);
    el.historyStatusBtn.classList.toggle('is-error', look.error);
    if (el.libraryDialog.open) renderDialogStatus(s);
  }

  function renderDialogStatus(s: GitState) {
    const problem = s.enabled && s.available !== false ? H.gitErrorText(s.lastError) : null;
    el.libraryStatusText.textContent = problem ? problem.text : statusSentence(s);
    el.libraryStatusText.classList.toggle('is-error', !!problem || s.available === false);
    el.libraryDetails.classList.toggle('hidden', !problem);
    el.libraryDetailsText.textContent = problem ? problem.details : '';
    el.librarySaveBtn.classList.toggle('hidden', !s.enabled || s.available === false);
    setLabel(el.libraryPrimaryBtn, !s.enabled ? 'Turn on history' : s.available === false ? 'How to get git' : !s.remote ? 'Set up sync…' : problem ? 'Try again' : 'Sync now');
  }

  async function openLibrary() {
    await flushSave();
    lib.limit = PAGE;
    el.libraryList.innerHTML = '';
    el.libraryChanges.innerHTML = '';
    el.libraryHint.textContent = 'Loading versions…';
    el.libraryMoreBtn.classList.add('hidden');
    const s = await api.git.status();
    renderStatus(s);
    renderDialogStatus(s);
    if (!el.libraryDialog.open) el.libraryDialog.showModal();
    el.libraryPrimaryBtn.focus();
    await loadVersions();
  }

  async function loadVersions() {
    const s = lib.status;
    const load = ++lib.loads;
    if (!s || !s.enabled || s.available === false) { lib.versions = []; lib.more = false; renderVersions(); return; }
    let r: LibraryVersions;
    try { r = await api.git.versions(lib.limit); } catch (err) { if (load === lib.loads) el.libraryHint.textContent = 'Could not list the versions: ' + ipcErrorText(err); return; }
    if (load !== lib.loads) return;
    lib.versions = r.versions;
    lib.more = r.more;
    renderVersions();
  }

  function renderVersions() {
    const keep = lib.index >= 0 && lib.versions[lib.index] ? lib.versions[lib.index].hash : null;
    el.libraryList.innerHTML = '';
    el.libraryList.removeAttribute('aria-activedescendant');
    el.libraryChanges.innerHTML = '';
    el.libraryMoreBtn.classList.toggle('hidden', !lib.more);
    const s = lib.status;
    const empty = !lib.versions.length;
    el.libraryLayout.classList.toggle('hidden', empty);
    const working = !!s && s.enabled && s.available !== false;
    el.libraryEmpty.classList.toggle('hidden', !empty || !working);
    if (empty) {
      lib.index = -1;
      el.libraryHint.textContent = '';
      el.libraryEmpty.textContent = 'No versions yet. Notes saves one a moment after you change a note.';
      return;
    }
    el.libraryHint.textContent = lib.versions.length + (lib.versions.length === 1 ? ' version' : ' versions') + (lib.more ? ' shown' : '');
    const now = Date.now();
    let day = '';
    lib.versions.forEach((v, i) => {
      const label = dayLabel(v.at, now);
      if (label !== day) {
        day = label;
        const head = document.createElement('li');
        head.className = 'history-day';
        head.setAttribute('role', 'presentation');
        head.textContent = label;
        el.libraryList.append(head);
      }
      const li = document.createElement('li');
      li.id = 'library-v' + i;
      li.setAttribute('role', 'option');
      li.dataset.index = String(i);
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = new Date(v.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const what = document.createElement('span');
      what.className = 'first';
      what.textContent = changedSummary(v);
      li.append(when, what);
      li.addEventListener('click', () => showVersion(i));
      el.libraryList.append(li);
    });
    const again = keep ? lib.versions.findIndex((v) => v.hash === keep) : -1;
    showVersion(again >= 0 ? again : 0);
  }

  function showVersion(i: number) {
    const v = lib.versions[i];
    if (!v) return;
    lib.index = i;
    for (const li of el.libraryList.children) {
      if (!(li instanceof HTMLElement) || li.dataset.index === undefined) continue;
      const on = Number(li.dataset.index) === i;
      li.classList.toggle('is-active', on);
      li.setAttribute('aria-selected', String(on));
      if (on) li.scrollIntoView({ block: 'nearest' });
    }
    el.libraryList.setAttribute('aria-activedescendant', 'library-v' + i);
    el.libraryChanges.innerHTML = '';
    const head = document.createElement('p');
    head.className = 'library-changes-head';
    const day = dayLabel(v.at, Date.now());
    head.textContent = 'Changed ' + (day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : 'on ' + day) + ' at ' + new Date(v.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const list = document.createElement('ul');
    list.className = 'library-change-list';
    for (const c of v.changes) {
      const row = document.createElement('li');
      const text = document.createElement('span');
      text.className = 'change-text';
      const title = document.createElement('span');
      title.className = 'change-title';
      title.textContent = c.title;
      title.title = c.path;
      const kind = document.createElement('span');
      kind.className = 'change-kind';
      kind.textContent = KIND_WORDS[c.kind];
      text.append(title, kind);
      row.append(text);
      const action = changeAction(v, c);
      if (action) row.append(action);
      list.append(row);
    }
    el.libraryChanges.append(head, list);
  }

  function changeAction(v: LibraryVersion, c: VersionChange) {
    const noteId = c.noteId;
    if (!noteId && !c.canBringBack) return null;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-small';
    if (noteId) {
      b.textContent = 'Open this version';
      b.title = 'Show this note as it was then, with a way to restore it';
      b.addEventListener('click', () => { el.libraryDialog.close(); openNoteHistory(noteId, { hash: v.hash, at: v.at }); });
    } else {
      b.textContent = 'Bring back';
      b.addEventListener('click', () => bringBack(v, c));
    }
    return b;
  }

  async function bringBack(v: LibraryVersion, c: VersionChange) {
    let r: BringBackResult;
    try { r = await api.git.bringBack(v.hash, c.path); } catch (err) { toast('Could not bring it back: ' + ipcErrorText(err)); return; }
    if (!r.ok) { toast(r.error); return; }
    el.libraryDialog.close();
    toast('Brought back "' + H.truncate(c.title, 30) + '" from ' + new Date(v.at).toLocaleString() + '.');
    if (r.noteId) await openNote(r.noteId);
  }

  function moveSelection(e: KeyboardEvent) {
    if (!lib.versions.length) return;
    const last = lib.versions.length - 1;
    if (e.key === 'Enter') { const first = el.libraryChanges.querySelector('button'); if (first instanceof HTMLButtonElement) { e.preventDefault(); first.focus(); } return; }
    const step = LIST_STEPS[e.key];
    const to = step !== undefined ? Math.max(0, Math.min(last, lib.index + step)) : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (to < 0) return;
    e.preventDefault();
    showVersion(to);
  }

  async function primaryAction() {
    const s = lib.status;
    if (!s) return;
    if (!s.enabled) { await updateSettings({ gitEnabled: true }); renderStatus(await api.git.status()); await loadVersions(); return; }
    if (s.available === false) { api.app.openExternal(GIT_DOWNLOAD); return; }
    if (!s.remote) { el.libraryDialog.close(); openSettingsAt('set-history'); return; }
    await syncNow();
  }

  async function syncNow() {
    const s = lib.status || await api.git.status();
    if (!s.enabled || !s.remote) { await openLibrary(); return; }
    await flushSave();
    const synced = await api.git.sync();
    const after = await api.git.status();
    renderStatus(after);
    if (el.libraryDialog.open) await loadVersions();
    const problem = (H.isLinkedNotice(after.lastError) ? null : H.gitErrorText(after.lastError)) || (synced.ok ? null : H.gitErrorText(synced.error || synced.skipped || 'sync failed'));
    if (!problem) toast('Synced with ' + remoteName(after.remote));
    else toast(problem.text, { label: 'Details', run: () => { openLibrary(); } });
  }

  async function saveVersionNow() {
    await flushSave();
    const r = await api.git.commit();
    const after = await api.git.status();
    renderStatus(after);
    if (el.libraryDialog.open) await loadVersions();
    if (!r.ok && r.skipped === 'disabled') { toast('History is off.'); return; }
    const problem = (H.isLinkedNotice(after.lastError) ? null : H.gitErrorText(after.lastError)) || (r.ok ? null : H.gitErrorText(r.error || 'commit failed'));
    if (problem) { toast(problem.text, { label: 'Details', run: () => { openLibrary(); } }); return; }
    toast(r.ok && r.nothingToCommit ? 'Nothing new to save. The last version has every change.' : 'Saved a version');
  }

  function bind() {
    el.historyStatusBtn.addEventListener('click', () => { openLibrary(); });
    el.libraryPrimaryBtn.addEventListener('click', () => { primaryAction(); });
    el.librarySaveBtn.addEventListener('click', () => { saveVersionNow(); });
    el.libraryCloseBtn.addEventListener('click', () => el.libraryDialog.close());
    el.libraryMoreBtn.addEventListener('click', () => { lib.limit += PAGE; loadVersions(); });
    el.libraryList.addEventListener('keydown', moveSelection);
    setInterval(() => { if (lib.status) renderStatus(lib.status); }, 60000);
  }

  function noticePulled(pulled: { changed: string[], copies: string[] }) {
    if (el.libraryDialog.open) loadVersions();
    if (!pulled.copies.length) return;
    const n = pulled.copies.length;
    toast(n === 1 ? 'A note was changed on both computers. The other version is saved beside it as a conflict copy.' : n + ' notes were changed on both computers. The other versions are saved beside them as conflict copies.', { label: 'Show', run: () => { openLibrary(); } });
  }

  return { bind, openLibrary, renderStatus, syncNow, saveVersionNow, noticePulled, statusNow: () => lib.status };
}
