import { el } from './dom.ts';
import { state } from './state.ts';
import { NotesCraftFrame } from './craft-frame.ts';
import * as H from '../shared/helpers.mts';
import { ipcErrorText } from './text.ts';
import { toast } from './toast.ts';

export function createCraftNotes({ api, GUEST, setSaved, showBanner, openFiles, reportFileSaved, refresh, renderFileRow }) {
  // WordCraft (Word documents) and GridCraft (spreadsheets): the user's forks of ArtCraft's Rust office apps, built to
  // WebAssembly and shown in a frame each (craft-frame.js, one protocol for both). One controller per app. Its note
  // is the document on show, { id, fileMtime, name } as read or last saved.
  const CRAFT_UI = {
    wordcraft: { label: 'WordCraft', what: 'Word document', frame: () => el.wordcraftFrame, bytes: (id) => api.files.docxBytes(id), openWith: 'Word', without: 'Word documents open in the simple editor for now.' },
    gridcraft: { label: 'GridCraft', what: 'spreadsheet', frame: () => el.gridcraftFrame, bytes: (id) => api.files.documentBytes(id), openWith: 'Excel', without: 'spreadsheets cannot be shown for now.' },
  };
  function craftViewer(key) {
    const ui = CRAFT_UI[key];
    const frame = () => ui.frame();
    let fc: ReturnType<typeof NotesCraftFrame.create> | null = null, note: { id: string, fileMtime: number | null, name: string } | null = null, shownKey: string | null = null, seq = 0, down = false;
    // The build is there, this is the main window, and the app started the last time it was asked to.
    const usable = () => !!(state.info && state.info.crafts && state.info.crafts[key]) && !GUEST && !down;
    function controller() {
      if (!fc) {
        fc = NotesCraftFrame.create({
          frame: frame(),
          origin: key + '://app',
          url: key + '://app/index.html?host',
          onSave: saveFromFrame,
          onDirty: (d) => { if (note && state.currentId === note.id) setSaved(d ? 'Edited' : 'Saved'); },
          onOpened: () => { frame().classList.remove('is-opening'); if (note && state.currentId === note.id) showBanner(''); },
          onOpenFailed: (err) => {
            clear();
            showBanner(ui.label + ' could not open this ' + ui.what + ': ' + err + '. Use "Open with…" to open it in ' + ui.openWith + '.');
          },
          // The Craft apps are always dark: dark chrome and a dark page, whatever Notes' own theme (the user's choice,
          // 2026-10-19). The page's darkness is only how the app shows it; the file is unchanged.
          theme: 'dark',
          darkPage: true,
          // The build is there but did not start: its documents do without it until Notes restarts.
          onUnavailable: () => {
            down = true;
            clear();
            const n = state.current;
            if (n && n.filePath && n.fileKind && H.CRAFT_OF[n.fileKind] === key) renderFileRow(n);
            toast(ui.label + ' did not start, so ' + ui.without);
          },
        });
      }
      return fc;
    }
    async function show(n) {
      const k = n.id + ':' + n.fileMtime;
      frame().classList.remove('hidden');
      if (shownKey === k) return;
      shownKey = k;
      const s = ++seq;
      // The last document is closed at once, and the frame stays out of sight until the new one has opened, so
      // nothing is typed into a document that is about to be replaced.
      note = null;
      if (fc) fc.close();
      frame().classList.add('is-opening');
      showBanner('Opening in ' + ui.label + '…');
      try {
        const bytes = await ui.bytes(n.id);
        // Moved on (another note, or this one again) while the file was read: that later open wins.
        if (s !== seq || !state.current || state.current.id !== n.id) return;
        const name = n.filePath.split(/[\\/]/).pop();
        note = { id: n.id, fileMtime: n.fileMtime, name };
        controller().open(name, bytes, note);
      } catch (err) {
        if (s !== seq) return;
        clear();
        showBanner('Could not open this ' + ui.what + ' in ' + ui.label + ': ' + ipcErrorText(err) + ' Use "Open with…" to open it in ' + ui.openWith + '.');
      }
    }
    function clear() {
      seq++;
      shownKey = null;
      note = null;
      if (fc) fc.close();
      frame().classList.add('hidden');
    }
    // The app saved (Ctrl+S there, or a save Notes asked for): write it to the file with Notes' usual safety. target is
    // the document the save was made in, which may no longer be on show.
    // Returns { ok, own }: own when the save is the note's document (written over it, into its "(edited)" copy, or as
    // the file it moved to), not a copy under another name.
    async function saveFromFrame(name, bytes, target) {
      if (!target) return { ok: false, own: true };
      try {
        const r = await api.files.saveCraft(target.id, bytes, name, target.fileMtime);
        if (r.exported) {
          const copy = r.exported.split(/[\\/]/).pop();
          // own: the document's own save went into a copy beside the file (Notes never writes over a presentation),
          // so the document counts as saved; the file is unchanged.
          toast(r.own ? 'Saved as ' + copy + ' beside this file, which is unchanged.' : 'Saved ' + copy + ' next to the ' + ui.what + '.', { label: 'Open', run: () => openFiles([r.exported]) });
          return { ok: true, own: !!r.own };
        }
        if (r.relinked) { movedTo(target, r); return { ok: true, own: true }; }
        if (!r.savedAs) {
          target.fileMtime = r.mtime;
          if (note === target) shownKey = target.id + ':' + r.mtime;
        }
        reportFileSaved(target, r, false, ui.what);
        return { ok: true, own: true };
      } catch (err) {
        toast('Could not save the ' + ui.what + ': ' + ipcErrorText(err));
        return { ok: false, own: true };
      }
    }
    // The app saved a format it reads but does not write (an .odt as a .docx, an .xls as an .xlsx) beside the
    // original, and the note moved to that file. Once this save has settled (a save made while leaving the note must
    // finish first), the note is shown by its new file and opened again in the app under that name, so its next save
    // goes there.
    function movedTo(target, r) {
      target.fileMtime = r.mtime;
      toast('Saved as ' + r.relinked.split(/[\\/]/).pop() + ' beside the original, which is unchanged. This note is that file now.');
      setTimeout(async () => {
        const fresh = await api.notes.get(target.id);
        await refresh({ keepEditor: true });
        if (!fresh || !state.current || state.current.id !== fresh.id) return;
        state.current = fresh;
        el.titleInput.value = fresh.title;
        shownKey = null;
        renderFileRow(fresh);
      }, 0);
    }
    const dirty = () => !!(fc && note && fc.isDirty());
    // Leaving the note, hiding or quitting: have the app save first.
    const flush = async () => (fc && dirty() ? fc.requestSave(15000) : true);
    // The next show opens the document again from the file, even the same version (a reload from disk).
    const forget = () => { shownKey = null; };
    return { usable, show, clear, dirty, flush, forget };
  }
  const crafts = Object.fromEntries(Object.keys(CRAFT_UI).map((key) => [key, craftViewer(key)]));
  const useWordCraft = () => crafts.wordcraft.usable();
  // The Craft app for a file note, or null.
  const craftFor = (n) => {
    const key = n && n.filePath && n.fileKind ? H.CRAFT_OF[n.fileKind] : undefined;
    return key ? crafts[key] : null;
  };
  const craftDirty = () => Object.values(crafts).some((c) => c.dirty());
  async function flushCrafts() {
    let ok = true;
    for (const c of Object.values(crafts)) ok = (await c.flush()) && ok;
    return ok;
  }
  // A spreadsheet: GridCraft, or nothing but a banner (Notes has no editor of its own for it).
  function showCraftOnly(n) {
    const key = H.CRAFT_OF[n.fileKind];
    if (crafts[key].usable()) { showBanner(''); crafts[key].show(n); return; }
    showBanner('Notes shows .' + H.extOf(n.filePath) + ' files in ' + CRAFT_UI[key].label + ', which is not available right now. Use "Open with…" to open it in ' + CRAFT_UI[key].openWith + '.');
  }

  return { crafts, useWordCraft, craftFor, craftDirty, flushCrafts, showCraftOnly };
}
