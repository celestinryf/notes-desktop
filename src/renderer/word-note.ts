import { el } from './dom.ts';
import { state } from './state.ts';
import { NotesDocxEditor } from './docx-editor.ts';
import { oneAtATime } from './one-at-a-time.ts';
import * as H from '../shared/helpers.mts';
import { ipcErrorText } from './text.ts';
import { toast } from './toast.ts';
import type { createCraftNotes } from './craft-notes.ts';

type DocxController = ReturnType<NonNullable<typeof NotesDocxEditor>['create']>;
type DocxOpened = NonNullable<Awaited<ReturnType<DocxController['open']>>>;
type DocxOnShow = { id: string, fileMtime: number | null };
type WordNoteDeps = {
  api: NotesApi,
  flushSave: (opts?: { fromBlur?: boolean }) => Promise<boolean>,
  showBanner: (text: string) => void,
  reportFileSaved: (target: DocxOnShow, r: SavedFile, explicit: boolean, what: string) => boolean,
  externalLinkClick: (e: MouseEvent, href: string) => void,
  crafts: ReturnType<typeof createCraftNotes>['crafts'],
  useWordCraft: () => boolean,
};

export function createWordNote({ api, flushSave, showBanner, reportFileSaved, externalLinkClick, crafts, useWordCraft }: WordNoteDeps) {
  const DOCX_FRAME = '<!doctype html><html><head><meta charset="utf-8"><meta name="notes-docx-frame">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:">'
    + '<style>html, body { margin: 0; } html body .docx-wrapper { background: #e9e4da; padding: 16px; align-items: safe center; } html body .docx-wrapper > section.docx { box-shadow: none; }</style></head><body></body></html>';
  let docxShownKey: string | null = null;
  let docxSeq = 0;
  let docx: DocxController | null = null, docxNote: DocxOnShow | null = null, docxBanner = '';
  function clearDocx() {
    crafts.wordcraft.clear();
    docxShownKey = null;
    docxSeq++;
    docxNote = null;
    if (docx) docx.close();
    el.docxEditor.classList.add('hidden');
    el.docxView.removeAttribute('srcdoc');
  }
  function freshDocxFrame(): Promise<Document> {
    return new Promise((resolve) => {
      const onLoad = () => {
        const doc = el.docxView.contentDocument;
        if (!doc || !doc.querySelector('meta[name="notes-docx-frame"]')) return;
        el.docxView.removeEventListener('load', onLoad);
        resolve(doc);
      };
      el.docxView.addEventListener('load', onLoad);
      el.docxView.srcdoc = DOCX_FRAME;
    });
  }
  function onDocxLinkClick(e: MouseEvent) {
    const frameWindow = el.docxView.contentDocument?.defaultView;
    const a = frameWindow && e.target instanceof frameWindow.Element ? e.target.closest('a[href]') : null;
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) {
      const doc = a.ownerDocument, name = decodeURIComponent(href.slice(1));
      const target = doc.getElementById(name) || doc.getElementsByName(name)[0];
      if (target) target.scrollIntoView();
      return;
    }
    externalLinkClick(e, href);
  }

  function docxController() {
    if (!docx && NotesDocxEditor) {
      docx = NotesDocxEditor.create({
        onDirty: (d) => { el.docxSaveBtn.textContent = d ? 'Save' : 'Saved'; },
        say: toast,
        onBlur: () => flushSave({ fromBlur: true }),
        onKey: (e) => {
          const ctrl = e.ctrlKey || e.metaKey;
          if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); flushDocx({ explicit: true }); }
          else if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); flushSave().then(() => api.app.hide()); }
        },
      });
    }
    return docx;
  }

  function docxBannerFor(res: DocxOpened) {
    const fixed = res.readOnly ? ' ' + res.readOnly + (res.readOnly === 1 ? ' paragraph has' : ' paragraphs have') + ' links, charts, text boxes, tracked changes or similar, and cannot be edited here; use "Open with…" for those.' : '';
    if (res.editable) return 'Click into the text to edit it. Ctrl+B, Ctrl+I and Ctrl+U (or the buttons) set bold, italic and underline. Save (Ctrl+S) writes your changes into the document, and the original is backed up first.' + fixed;
    return 'Word document, shown as laid out in the file. It cannot be edited here: ' + (res.block || 'none of its text is plain enough for Notes to write back safely') + '. Use "Open with…" to edit it in Word.';
  }

  async function showDocx(note: PublicNote) {
    if (useWordCraft()) { crafts.wordcraft.show(note); return; }
    if (!H.isOoxmlWordFile(note)) {
      el.docxEditor.classList.add('hidden');
      showBanner('Notes shows .' + H.extOf(note.filePath) + ' files in WordCraft, which is not available right now. Use "Open with…" to open it in Word.');
      return;
    }
    const key = note.id + ':' + note.fileMtime;
    if (docxShownKey === key) { if (docxBanner) showBanner(docxBanner); return; }
    docxShownKey = key;
    docxNote = null;
    docxBanner = '';
    const seq = ++docxSeq;
    try {
      const [doc, bytes] = await Promise.all([freshDocxFrame(), api.files.docxBytes(note.id)]);
      if (seq !== docxSeq) return;
      doc.addEventListener('click', onDocxLinkClick);
      const ctl = docxController();
      if (!ctl) throw new Error('the Word editor did not load.');
      const res = await ctl.open(doc, bytes);
      if (seq !== docxSeq || !res) return;
      if (ctl.isEditable()) docxNote = { id: note.id, fileMtime: note.fileMtime };
      el.docxEditor.classList.toggle('read-only', !ctl.isEditable());
      docxBanner = docxBannerFor(res);
      if (state.current && state.current.id === note.id) showBanner(docxBanner);
    } catch (err) {
      if (seq !== docxSeq) return;
      docxShownKey = null;
      el.docxView.removeAttribute('srcdoc');
      showBanner('Could not show this Word document: ' + ipcErrorText(err) + ' Use "Open with…" to open it in Word.');
    }
  }

  const docxDirty = () => !!(docx && docxNote && docx.isDirty());
  const flushDocx = oneAtATime(async (opts: { explicit?: boolean }) => {
    let explicit = !!opts.explicit;
    for (let i = 0; i < 3; i++) {
      if (!docxDirty()) return true;
      if (!(await saveDocxNow(explicit))) return false;
      explicit = false;
    }
    return !docxDirty();
  });

  async function saveDocxNow(explicit: boolean) {
    const target = docxNote, ed = docx;
    let c: ReturnType<DocxController['save']>;
    try {
      if (!target || !ed) throw new Error('no Word document is open');
      c = ed.save();
    } catch (err) { toast('Could not save the document: ' + (err.message || err) + '. Your changes are still here; use Reload to start again from the file.'); return false; }
    if (!c) return true;
    try {
      const r = await api.files.saveDocx(target.id, c.patches, target.fileMtime);
      if (docxNote !== target) return true;
      const inPlace = reportFileSaved(target, r, explicit, 'document');
      if (inPlace) docxShownKey = target.id + ':' + r.mtime;
      const synced = ed.markSaved();
      if (!synced.ok) {
        docxShownKey = null;
        if (state.current && state.current.id === target.id) showDocx(state.current);
        toast(synced.lost ? 'Saved. The document is shown again from the file, so what you typed while it saved is not in it; please type that again.' : 'Saved. The document is shown again from the file.');
      }
      return true;
    } catch (err) {
      ed.saveFailed();
      toast('Could not save the document: ' + ipcErrorText(err) + ' Your changes are still here.');
      return false;
    }
  }

  function onDocxToolbarClick(e: MouseEvent) {
    const b = e.target instanceof Element ? e.target.closest('button') : null;
    if (!b || !docx || !docxNote) return;
    if (b === el.docxSaveBtn) { flushDocx({ explicit: true }); return; }
    if (b.dataset.docxAct) docx.exec(b.dataset.docxAct);
  }

  function docxOpen() { return !!docxNote; }
  function forgetShownDocx() { docxShownKey = null; }
  function bindDocxEvents() {
    const docxTools = el.docxEditor.querySelector<HTMLElement>('.docx-toolbar');
    if (!docxTools) return;
    docxTools.addEventListener('mousedown', (e) => { if (e.target instanceof Element && e.target.closest('button')) e.preventDefault(); });
    docxTools.addEventListener('click', onDocxToolbarClick);
  }

  return { clearDocx, showDocx, docxDirty, flushDocx, docxOpen, forgetShownDocx, bindDocxEvents };
}
