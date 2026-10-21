import { el } from './dom.js';
import { state } from './state.js';
import { NotesDocxEditor } from './docx-editor.js';
import { oneAtATime } from './one-at-a-time.js';
import H from '../shared/helpers.js';
import { ipcErrorText } from './text.js';
import { toast } from './toast.js';

export function createWordNote({ api, flushSave, showBanner, reportFileSaved, externalLinkClick, crafts, useWordCraft }) {
  // A Word document is shown from its own bytes, as laid out in the file, inside a frame of its own: sandboxed
  // (nothing in it runs), with a policy that allows only inline styles and data: images. So the file's styles
  // cannot reach the app, and it loads nothing from the network, so opening it cannot tell anyone you did.
  // docx-preview adds its own wrapper style after this one, so these rules are more specific to win. safe center: a page
  // wider than the frame starts at its left edge and scrolls, instead of being cut off on the left.
  const DOCX_FRAME = '<!doctype html><html><head><meta charset="utf-8"><meta name="notes-docx-frame">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:">'
    + '<style>html, body { margin: 0; } html body .docx-wrapper { background: #e9e4da; padding: 16px; align-items: safe center; } html body .docx-wrapper > section.docx { box-shadow: none; }</style></head><body></body></html>';
  // docxShownKey (note id + file version) skips re-rendering the same file; docxSeq drops a render that is
  // overtaken by a newer one.
  let docxShownKey = null;
  let docxSeq = 0;
  // docx: the editing controller; docxNote: the document on show and editable, { id, fileMtime } as loaded or saved;
  // docxBanner: what the banner says about it (shown again when the same version is shown again).
  let docx = null, docxNote = null, docxBanner = '';
  function clearDocx() {
    crafts.wordcraft.clear();
    docxShownKey = null;
    docxSeq++;
    docxNote = null;
    if (docx) docx.close();
    el.docxEditor.classList.add('hidden');
    el.docxView.removeAttribute('srcdoc');
  }
  // A fresh frame per document, so no styles from the last one linger. Only a load of this frame page counts: the
  // about:blank load from an earlier clearDocx can still arrive and must not be taken for it.
  function freshDocxFrame() {
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
  // Links in a document never navigate: a #bookmark scrolls to its place, a web link opens in the browser only
  // on Ctrl+click (like links in notes), and a plain click says where it goes.
  function onDocxLinkClick(e) {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
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
        // Keys pressed in the document never reach this page: Ctrl+S saves, Escape hides the window as elsewhere.
        onKey: (e) => {
          const ctrl = e.ctrlKey || e.metaKey;
          if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); flushDocx({ explicit: true }); }
          else if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); flushSave().then(() => api.app.hide()); }
        },
      });
    }
    return docx;
  }

  function docxBannerFor(res) {
    const fixed = res.readOnly ? ' ' + res.readOnly + (res.readOnly === 1 ? ' paragraph has' : ' paragraphs have') + ' links, charts, text boxes, tracked changes or similar, and cannot be edited here; use "Open with…" for those.' : '';
    if (res.editable) return 'Click into the text to edit it. Ctrl+B, Ctrl+I and Ctrl+U (or the buttons) set bold, italic and underline. Save (Ctrl+S) writes your changes into the document, and the original is backed up first.' + fixed;
    return 'Word document, shown as laid out in the file. It cannot be edited here: ' + (res.block || 'none of its text is plain enough for Notes to write back safely') + '. Use "Open with…" to edit it in Word.';
  }

  async function showDocx(note) {
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

  // Writes the document's edits into the file, like flushPdf for PDFs: one save at a time, each re-checking, so
  // typing during a save is saved too. opts.explicit: say so when done. Resolves false while edits are unsaved.
  const docxDirty = () => !!(docx && docxNote && docx.isDirty());
  const flushDocx = oneAtATime(async (opts) => {
    let explicit = !!opts.explicit;
    for (let i = 0; i < 3; i++) {
      if (!docxDirty()) return true;
      if (!(await saveDocxNow(explicit))) return false;
      explicit = false;
    }
    return !docxDirty();
  });

  async function saveDocxNow(explicit) {
    const target = docxNote;
    let c;
    try { c = docx.save(); } catch (err) { toast('Could not save the document: ' + (err.message || err) + '. Your changes are still here; use Reload to start again from the file.'); return false; }
    if (!c) return true;
    try {
      const r = await api.files.saveDocx(target.id, c.patches, target.fileMtime);
      if (docxNote !== target) return true;
      const inPlace = reportFileSaved(target, r, explicit, 'document');
      if (inPlace) docxShownKey = target.id + ':' + r.mtime;
      // The page now stands for the file as written; if it cannot be matched to it, the document is shown again.
      const synced = docx.markSaved();
      if (!synced.ok) {
        docxShownKey = null;
        if (state.current && state.current.id === target.id) showDocx(state.current);
        toast(synced.lost ? 'Saved. The document is shown again from the file, so what you typed while it saved is not in it; please type that again.' : 'Saved. The document is shown again from the file.');
      }
      return true;
    } catch (err) {
      docx.saveFailed();
      toast('Could not save the document: ' + ipcErrorText(err) + ' Your changes are still here.');
      return false;
    }
  }

  function onDocxToolbarClick(e) {
    const b = e.target.closest('button');
    if (!b || !docx || !docxNote) return;
    if (b === el.docxSaveBtn) { flushDocx({ explicit: true }); return; }
    if (b.dataset.docxAct) docx.exec(b.dataset.docxAct);
  }

  // The rest of the app's doors into the document on show.
  function docxOpen() { return !!docxNote; }
  // The next showDocx shows the file again even if it did not change (a reload from disk drops the edits).
  function forgetShownDocx() { docxShownKey = null; }
  function bindDocxEvents() {
    const docxTools = el.docxEditor.querySelector('.docx-toolbar');
    docxTools.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); }); // keep the text selection in the document
    docxTools.addEventListener('click', onDocxToolbarClick);
  }

  return { clearDocx, showDocx, docxDirty, flushDocx, docxOpen, forgetShownDocx, bindDocxEvents };
}
