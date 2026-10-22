import { el } from './dom.ts';
import { state, lockedNow } from './state.ts';
import { currentHtml } from './note-html.ts';
import { find } from './find-state.ts';
import * as H from '../shared/helpers.mts';
import { escapeHtml } from './text.ts';
import { toast } from './toast.ts';
import { placePopover } from './popover.ts';

interface SharingDeps {
  api: NotesApi;
  flushSave: () => Promise<boolean>;
  closeFind: () => void;
  GUEST: boolean;
  exportOfCurrent: () => { name: string; html: string };
  exportCurrent: () => Promise<unknown>;
  startLiveHost: () => Promise<unknown>;
  openLiveDialog: (mode: 'link' | 'join') => void;
  stopLive: () => Promise<unknown>;
}

export function createSharing({ api, flushSave, closeFind, GUEST, exportOfCurrent, exportCurrent, startLiveHost, openLiveDialog, stopLive }: SharingDeps) {
  // Which share actions apply to the open note; the share menu and the command palette both use it.
  function syncShareMenu() {
    const n = state.current;
    if (!n) return;
    el.shareReveal.classList.toggle('hidden', !n.filePath);
    el.shareLiveHost.classList.toggle('hidden', !!n.live || !!n.locked || !!n.filePath);
    el.shareLiveStop.classList.toggle('hidden', !n.live);
  }

  function openShareMenu() {
    if (!state.current || state.current.trashedAt) return;
    syncShareMenu();
    placePopover(el.shareMenu, el.shareBtn);
  }

  function closeShareMenu() {
    el.shareMenu.classList.add('hidden');
  }

  async function shareAction(action: string) {
    closeShareMenu();
    let note = state.current;
    if (!note) return;
    if (note.locked && !note.unlocked) { toast('Unlock the note first.'); return; }
    await flushSave();
    if (!state.current || state.current.id !== note.id) return; // the person moved on
    note = state.current; // the saved view, including a title typed a moment ago
    const titleLine = note.title ? note.title + '\n\n' : '';
    try {
      if (action === 'copy-md') { await api.app.copy({ text: H.noteToMarkdown(note) }); toast('Copied as Markdown'); }
      else if (action === 'copy-text') { await api.app.copy({ text: titleLine + H.plainTextFromMarkdown(el.bodyInput.value) }); toast('Copied as plain text'); }
      else if (action === 'copy-html') { await api.app.copy({ text: H.noteToMarkdown(note), html: (note.title ? '<h1>' + escapeHtml(note.title) + '</h1>' : '') + currentHtml() }); toast('Copied as rich text'); }
      else if (action === 'copy-note-link') { await api.app.copy({ text: '[' + (H.deriveTitle(note) || 'Note') + '](note://' + note.id + ')' }); toast('Copied. Paste it into another note to link here.'); }
      else if (action === 'email') { const r = await api.app.emailNote(note.id); toast(r.ok ? (r.truncated ? 'Opened your mail app. The note was long, so the email holds the first part; attach a PDF for the rest.' : 'Opened your mail app with the note.') : 'Could not open mail: ' + r.error); }
      else if (action === 'pdf') {
        if (find.open) closeFind();
        if (GUEST) {
          const r = await api.book.export('pdf', Object.assign(exportOfCurrent(), { dialogTitle: 'Save as PDF' }));
          if (r.ok) toast('Saved PDF to ' + r.filePath); else if (!r.canceled) toast('Could not save PDF: ' + r.error);
          return;
        }
        const chosen = await api.app.pdfPath(note.id);
        if (!chosen.ok) { if (!chosen.canceled) toast('Could not save PDF: ' + chosen.error); return; }
        // The page is what prints: it must still show this very note, unlocked, with nothing unsaved.
        if (state.currentId !== note.id || lockedNow()) { toast('The note changed while the dialog was open; nothing was saved.'); return; }
        await flushSave();
        const r = await api.app.writePdf(chosen.filePath);
        if (r.ok) toast('Saved PDF to ' + r.filePath); else toast('Could not save PDF: ' + r.error);
      }
      else if (action === 'html') { const r = await api.app.exportHtml(note.id, currentHtml()); if (r.ok) toast('Saved HTML to ' + r.filePath); else if (!r.canceled) toast('Could not save HTML: ' + r.error); }
      else if (action === 'md') { await exportCurrent(); }
      else if (action === 'reveal') { await api.files.reveal(note.id); }
      else if (action === 'live-host') { await startLiveHost(); }
      else if (action === 'live-join') { openLiveDialog('join'); }
      else if (action === 'live-stop') { await stopLive(); }
    } catch (err) {
      toast('Share failed: ' + (err.message || err));
    }
  }

  return { syncShareMenu, openShareMenu, closeShareMenu, shareAction };
}
