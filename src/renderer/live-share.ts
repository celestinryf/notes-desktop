import { el } from './dom.ts';
import { state } from './state.ts';
import { toast } from './toast.ts';

interface LiveShareDeps {
  api: NotesApi;
  flushSave: () => Promise<boolean>;
  refreshCurrentMeta: () => Promise<unknown>;
  setView: (view: RendererState['view']) => Promise<unknown>;
  selectNoteNow: (id: string) => Promise<unknown>;
}

export function createLiveShare({ api, flushSave, refreshCurrentMeta, setView, selectNoteNow }: LiveShareDeps) {
  function renderLiveRow(note: PublicNote | null) {
    const live = note && note.live;
    el.liveRow.classList.toggle('hidden', !live);
    if (!live) return;
    const s = state.liveStatus[note.id];
    const peers = s ? s.peers : 0;
    const connected = s ? s.connected : false;
    el.liveRow.classList.toggle('is-off', !connected);
    el.liveText.textContent = live.role === 'host'
      ? ('Live: you are sharing this note · ' + peers + (peers === 1 ? ' person' : ' people') + ' connected' + (s && s.localOnly ? ' · no network found, the link only works on this computer' : '') + (s && s.error ? ' · ' + s.error : ''))
      : (connected ? ('Live: following a shared note' + (s && s.pending ? ' · sending your edits…' : '')) : ('Live: reconnecting to the host…' + (s && s.error ? ' (' + s.error + ')' : '') + (s && s.pending ? ' · your edits will be sent when it is back' : '')));
  }

  async function startLiveHost() {
    const note = state.current;
    if (!note) return;
    const r = await api.live.host(note.id);
    if (!r.ok) { toast('Could not share: ' + r.error); return; }
    await refreshCurrentMeta();
    if (r.status) openLiveDialog('link', r.status.url);
  }

  async function stopLive() {
    const note = state.current;
    if (!note || !note.live) return;
    await flushSave();
    await api.live.stop(note.id);
    delete state.liveStatus[note.id];
    await refreshCurrentMeta();
    toast('Live share ended. The note stays.');
  }

  function openLiveDialog(mode: 'link' | 'join', url = '') {
    el.liveDialog.dataset.mode = mode;
    const hosting = mode === 'link';
    el.liveDialogTitle.textContent = hosting ? 'Live share link' : 'Join a live share';
    el.liveDialogHint.textContent = hosting
      ? 'Anyone on your local network with this link edits this note with you, live. The link is not encrypted, so use it on networks you trust. Windows may ask once to allow Notes through the firewall; say yes or nobody can connect. Stop sharing from the Share menu when you are done.'
      : 'Paste the link the other person shared. You get your own copy of the note that stays in step while the share lasts.';
    el.liveLinkLabel.textContent = hosting ? 'Link' : 'Link to join';
    el.liveLinkInput.value = hosting ? url : '';
    el.liveLinkInput.readOnly = hosting;
    el.liveCopyBtn.classList.toggle('hidden', !hosting);
    el.liveSubmitBtn.classList.toggle('hidden', hosting);
    el.liveCancelBtn.textContent = hosting ? 'Close' : 'Cancel';
    el.liveError.textContent = '';
    el.liveDialog.showModal();
    el.liveLinkInput.focus();
    el.liveLinkInput.select();
  }

  async function submitLiveDialog() {
    if (el.liveDialog.dataset.mode !== 'join') { el.liveDialog.close(); return; }
    const url = el.liveLinkInput.value.trim();
    if (!url) { el.liveError.textContent = 'Paste a link.'; return; }
    el.liveSubmitBtn.disabled = true;
    el.liveError.textContent = 'Connecting…';
    try {
      const r = await api.live.join(url, state.view === 'folder' ? state.folderId : null);
      if (!r.ok) { el.liveError.textContent = r.error ?? ''; return; }
      el.liveDialog.close();
      if (r.status) state.liveStatus[r.noteId] = r.status;
      await setView('all');
      await selectNoteNow(r.noteId);
      toast('Joined. Edits on either side show up here as they happen.');
    } finally {
      el.liveSubmitBtn.disabled = false;
    }
  }

  return { renderLiveRow, startLiveHost, stopLive, openLiveDialog, submitLiveDialog };
}
