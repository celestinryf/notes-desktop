import { el, setLabel } from './dom.js';
import { state, lockedNow } from './state.js';
import { src } from './code-editor.js';
import H from '../shared/helpers.js';
import { toast } from './toast.js';
import { setActivity } from './activity.js';

const { isViewerOnlyFile } = H;

export function createAttachments({ api, tableShown, flushSave, refresh }) {
  function insertAttachmentLinks(items) {
    const ok = items.filter((x) => x && !x.error);
    const bad = items.filter((x) => x && x.error);
    for (const it of ok) insertLinkIntoNote('📎 ' + it.name, it.href);
    if (ok.length) toast(ok.length === 1 ? 'Attached ' + ok[0].name : 'Attached ' + ok.length + ' files');
    for (const b of bad) toast('Could not attach ' + b.name + ': ' + b.error);
  }

  // Puts a Markdown link at the caret in whichever view is up, and saves.
  // A CSV's table is read-only: adding a link, an attachment or a recording waits for its text view. Checked before a
  // file is picked or recorded, so nothing is copied for a link that cannot go in.
  function refuseInTable() {
    if (!tableShown()) return false;
    toast('Switch to Text (Ctrl+E) to add this to the file.');
    return true;
  }

  function insertLinkIntoNote(text, href) {
    if (!state.current || lockedNow()) return;
    if (refuseInTable()) return;
    if (state.sourceMode || !state.rich) {
      const ta = src;
      if (ta.readOnly) return;
      const at = typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length;
      const end = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : at;
      const md = '[' + text.replace(/[\[\]]/g, '') + '](' + href + ')';
      const before = ta.value.slice(0, at), after = ta.value.slice(end);
      const sep = before && !/\s$/.test(before) ? ' ' : '';
      ta.value = before + sep + md + ' ' + after;
      const pos = (before + sep + md + ' ').length;
      ta.setSelectionRange(pos, pos);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      state.rich.insertLink(text, href);
    }
  }

  async function attachFiles() {
    if (!state.current || lockedNow() || state.current.trashedAt || isViewerOnlyFile(state.current)) { toast('Open an editable, unlocked note first.'); return; }
    if (refuseInTable()) return;
    const forNote = state.current.id;
    await flushSave();
    const items = await api.attachments.pick();
    if (state.currentId === forNote) { insertAttachmentLinks(items); return; }
    // The person moved to another note while the picker was open: the files belong to the note they chose.
    const ok = items.filter((x) => x && !x.error);
    if (!ok.length) { insertAttachmentLinks(items); return; }
    const target = await api.notes.get(forNote);
    if (target && !target.locked && !target.trashedAt && !isViewerOnlyFile(target)) {
      const links = ok.map((it) => '[📎 ' + it.name.replace(/[[\]]/g, '') + '](' + it.href + ')').join('\n');
      await api.notes.update(forNote, { body: (target.body ? target.body.replace(/\s*$/, '') + '\n\n' : '') + links + '\n' });
      toast('Attached to "' + H.truncate(H.deriveTitle(target), 30) + '", the note that was open when you chose the files.');
      refresh({ keepEditor: true });
    } else toast('Attached files are kept in the attachments folder; that note can no longer take them.');
  }

  const rec = { recorder: null, chunks: [], startedAt: 0, timer: null, noteId: null, starting: false };

  async function toggleRecording() {
    if (rec.recorder) { rec.recorder.stop(); return; }
    if (rec.starting) return; // the microphone prompt is still up
    if (!state.current || lockedNow() || state.current.trashedAt || isViewerOnlyFile(state.current)) { toast('Open an editable, unlocked note first.'); return; }
    if (refuseInTable()) return;
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Recording is not available here.'); return; }
    rec.noteId = state.current.id;
    rec.starting = true;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (err) { rec.starting = false; toast('Microphone not available: ' + (err.message || err)); return; }
    rec.starting = false;
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    rec.recorder = recorder; rec.chunks = []; rec.startedAt = Date.now();
    recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) rec.chunks.push(ev.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(rec.timer);
      el.recordBtn.classList.remove('is-recording');
      setLabel(el.recordBtn, 'Record a voice memo');
      setActivity('record', null);
      const seconds = Math.max(1, Math.round((Date.now() - rec.startedAt) / 1000));
      rec.recorder = null;
      const blob = new Blob(rec.chunks, { type: 'audio/webm' });
      if (!blob.size) { toast('Nothing was recorded.'); return; }
      try {
        const saved = await api.attachments.saveRecording(new Uint8Array(await blob.arrayBuffer()), 'webm');
        const mm = String(Math.floor(seconds / 60)).padStart(2, '0'), ss = String(seconds % 60).padStart(2, '0');
        const label = '🎙 Voice memo ' + mm + ':' + ss;
        if (state.currentId === rec.noteId && !lockedNow()) {
          insertLinkIntoNote(label, saved.href);
          toast('Voice memo saved (' + mm + ':' + ss + '). Ctrl+click the link to play it.');
        } else {
          // The person moved to another note meanwhile: the memo still belongs to the note it was recorded in.
          const target = await api.notes.get(rec.noteId);
          if (target && !target.locked && !target.trashedAt && !isViewerOnlyFile(target)) {
            await api.notes.update(rec.noteId, { body: (target.body ? target.body.replace(/\s*$/, '') + '\n\n' : '') + '[' + label + '](' + saved.href + ')\n' });
            toast('Voice memo saved into "' + H.truncate(H.deriveTitle(target), 30) + '", the note it was recorded in.');
            refresh({ keepEditor: true });
          } else toast('Voice memo saved as ' + saved.name + ' (that note can no longer take it; Attach it where you want it).');
        }
      } catch (err) { toast('Could not save the recording: ' + (err.message || err)); }
    };
    recorder.start(250);
    el.recordBtn.classList.add('is-recording');
    const tick = () => {
      const s = Math.round((Date.now() - rec.startedAt) / 1000);
      const clock = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      setLabel(el.recordBtn, 'Stop recording (' + clock + ')');
      setActivity('record', { text: 'Recording ' + clock, icon: 'audio-lines', stop: toggleRecording, stopLabel: 'Stop recording (Ctrl+Shift+G)' });
    };
    tick(); rec.timer = setInterval(tick, 500);
  }

  return { attachFiles, toggleRecording };
}
