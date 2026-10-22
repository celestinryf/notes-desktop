import { el } from './dom.ts';
import { state } from './state.ts';
import { NotesCraftFrame } from './craft-frame.ts';
import * as H from '../shared/helpers.mts';
import { ipcErrorText } from './text.ts';
import { toast } from './toast.ts';
import { craftTrace } from './craft-trace.ts';

type CraftKey = 'wordcraft' | 'gridcraft';
type CraftDoc = { id: string, fileMtime: number | null, name: string };
type CraftFrame = ReturnType<typeof NotesCraftFrame.create<CraftDoc | null>>;
type CraftUi = { label: string, what: string, frame: () => HTMLIFrameElement, bytes: (id: string) => Promise<Uint8Array>, openWith: string, without: string };
type CraftNotesDeps = {
  api: NotesApi,
  GUEST: boolean,
  setSaved: (label: string) => void,
  showBanner: (text: string) => void,
  openFiles: (paths?: string[]) => Promise<unknown>,
  reportFileSaved: (target: CraftDoc, r: SavedFile, explicit: boolean, what: string) => boolean,
  refresh: (opts?: { keepEditor?: boolean }) => Promise<unknown>,
  renderFileRow: (note: PublicNote) => void,
};

const baseName = (path: string) => {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1];
};

export function createCraftNotes({ api, GUEST, setSaved, showBanner, openFiles, reportFileSaved, refresh, renderFileRow }: CraftNotesDeps) {
  const CRAFT_UI: Record<CraftKey, CraftUi> = {
    wordcraft: { label: 'WordCraft', what: 'Word document', frame: () => el.wordcraftFrame, bytes: (id) => api.files.docxBytes(id), openWith: 'Word', without: 'Word documents open in the simple editor for now.' },
    gridcraft: { label: 'GridCraft', what: 'spreadsheet', frame: () => el.gridcraftFrame, bytes: (id) => api.files.documentBytes(id), openWith: 'Excel', without: 'spreadsheets cannot be shown for now.' },
  };
  function craftViewer(key: CraftKey) {
    const ui = CRAFT_UI[key];
    const frame = () => ui.frame();
    let fc: CraftFrame | null = null, note: CraftDoc | null = null, shownKey: string | null = null, seq = 0, down = false;
    const trace = (event: string, fields?: TraceFields) => craftTrace(event, Object.assign({ app: key }, fields));
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
          theme: 'dark',
          darkPage: true,
          trace,
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
    async function show(n: PublicNote) {
      const k = n.id + ':' + n.fileMtime;
      frame().classList.remove('hidden');
      trace('show', { id: n.id, kept: shownKey === k, frame: !!fc });
      if (shownKey === k) return;
      shownKey = k;
      const s = ++seq;
      note = null;
      if (fc) fc.close();
      frame().classList.add('is-opening');
      showBanner('Opening in ' + ui.label + '…');
      try {
        const asked = performance.now();
        const bytes = await ui.bytes(n.id);
        trace('bytes', { id: n.id, bytes: bytes.byteLength, ms: H.msSince(asked) });
        if (s !== seq || !state.current || state.current.id !== n.id) return;
        if (!n.filePath) throw new Error('the note has no file');
        const name = baseName(n.filePath);
        note = { id: n.id, fileMtime: n.fileMtime, name };
        controller().open(name, bytes, note);
      } catch (err) {
        if (s !== seq) return;
        clear();
        showBanner('Could not open this ' + ui.what + ' in ' + ui.label + ': ' + ipcErrorText(err) + ' Use "Open with…" to open it in ' + ui.openWith + '.');
      }
    }
    function clear() {
      if (shownKey !== null || note !== null) trace('clear', { id: note ? note.id : null });
      seq++;
      shownKey = null;
      note = null;
      if (fc) fc.close();
      frame().classList.add('hidden');
    }
    async function saveFromFrame(name: string, bytes: Uint8Array, target: CraftDoc | null) {
      if (!target) return { ok: false, own: true };
      try {
        const r = await api.files.saveCraft(target.id, bytes, name, target.fileMtime);
        if ('exported' in r) {
          const copy = baseName(r.exported);
          toast(r.own ? 'Saved as ' + copy + ' beside this file, which is unchanged.' : 'Saved ' + copy + ' next to the ' + ui.what + '.', { label: 'Open', run: () => openFiles([r.exported]) });
          return { ok: true, own: !!r.own };
        }
        if ('relinked' in r) { movedTo(target, r); return { ok: true, own: true }; }
        if (!('savedAs' in r)) {
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
    function movedTo(target: CraftDoc, r: Extract<CraftSave, { relinked: string }>) {
      target.fileMtime = r.mtime;
      toast('Saved as ' + baseName(r.relinked) + ' beside the original, which is unchanged. This note is that file now.');
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
    async function flush() {
      if (!fc || !dirty()) return true;
      const started = performance.now();
      trace('flush', { id: note ? note.id : null });
      const ok = await fc.requestSave(15000);
      trace('flush-done', { ok, ms: H.msSince(started) });
      return ok;
    }
    const forget = () => { shownKey = null; };
    return { usable, show, clear, dirty, flush, forget };
  }
  const crafts = { wordcraft: craftViewer('wordcraft'), gridcraft: craftViewer('gridcraft') };
  const useWordCraft = () => crafts.wordcraft.usable();
  const craftFor = (n: PublicNote | null) => {
    const key = n && n.filePath && n.fileKind ? H.CRAFT_OF[n.fileKind] : undefined;
    return key ? crafts[key] : null;
  };
  const craftDirty = () => Object.values(crafts).some((c) => c.dirty());
  async function flushCrafts() {
    let ok = true;
    for (const c of Object.values(crafts)) ok = (await c.flush()) && ok;
    return ok;
  }
  function showCraftOnly(n: PublicNote) {
    const key = n.fileKind ? H.CRAFT_OF[n.fileKind] : undefined;
    if (!key) return;
    if (crafts[key].usable()) { showBanner(''); crafts[key].show(n); return; }
    showBanner('Notes shows .' + H.extOf(n.filePath) + ' files in ' + CRAFT_UI[key].label + ', which is not available right now. Use "Open with…" to open it in ' + CRAFT_UI[key].openWith + '.');
  }

  return { crafts, useWordCraft, craftFor, craftDirty, flushCrafts, showCraftOnly };
}
