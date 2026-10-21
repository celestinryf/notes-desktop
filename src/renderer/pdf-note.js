// @ts-check
import { el } from './dom.ts';
import { state } from './state.ts';
import { NotesPdfEditor } from './pdf-editor.js';
import { NotesPdfPages } from './pdf-pages.ts';
import { NotesPdfComments } from './pdf-comments.js';
import { NotesSignPad } from './sign-pad.ts';
import { oneAtATime } from './one-at-a-time.ts';
import { ipcErrorText } from './text.ts';
import { toast } from './toast.ts';

export function createPdfNote({ api, externalLinkClick, showBanner, openFiles }) {
  // pdf.js shows the PDF and holds the edits; saving writes them into the file through main, which backs up the
  // original on the first save of a session. pdfNote is the PDF on show: { id, fileMtime } as it was loaded or saved.

  let pdf = null;
  let pdfShownKey = null, pdfSeq = 0, pdfNote = null;

  function pdfController() {
    if (!pdf && NotesPdfEditor) {
      pdf = NotesPdfEditor.create(el.pdfEditor, {
        // Never disabled: a stroke or text box still in progress only counts once it is committed, which Save does.
        onDirty: (d) => { el.pdfSaveBtn.textContent = d ? 'Save' : 'Saved'; },
        onState: (s) => {
          for (const b of el.pdfEditor.querySelectorAll('[data-pdf-mode]')) b.classList.toggle('is-on', b.dataset.pdfMode === s.mode);
          el.pdfUndoBtn.disabled = !s.canUndo;
          el.pdfRedoBtn.disabled = !s.canRedo;
          el.pdfZoomLabel.textContent = Math.round(s.scale * 100) + '%';
        },
        onLink: externalLinkClick,
      });
    }
    return pdf;
  }

  function clearPdf() {
    closePdfPages();
    if (pdfComments) pdfComments.stop();
    pdfShownKey = null;
    pdfSeq++;
    pdfNote = null;
    el.pdfEditor.classList.add('hidden');
    if (pdf) pdf.close();
  }

  // opts.keepView: the PDF on show, reopened after the app rewrote it (same page and zoom).
  async function showPdf(note, opts) {
    const key = note.id + ':' + note.fileMtime;
    if (pdfShownKey === key) return;
    closePdfPages(); // its plan was for the PDF, or the version of it, shown before
    if (pdfComments) pdfComments.stop(); // a comment being written was for that one too
    const ctl = pdfController();
    if (!ctl) { showBanner('The PDF viewer failed to load. Use "Open with…" for your PDF app.'); return; }
    pdfShownKey = key;
    const seq = ++pdfSeq;
    pdfNote = null;
    try {
      const bytes = await api.files.pdfBytes(note.id);
      if (seq !== pdfSeq) return;
      if (await ctl.open(bytes, opts) && seq === pdfSeq) {
        pdfNote = { id: note.id, fileMtime: note.fileMtime };
        if (pdfCommentsShown()) pdfComments.refresh();
      }
    } catch (err) {
      if (seq !== pdfSeq) return;
      pdfShownKey = null;
      showBanner('Could not show this PDF: ' + ipcErrorText(err) + ' Use "Open with…" for your PDF app.');
    }
  }

  const pdfDirty = () => !!(pdf && pdfNote && pdf.isDirty());
  const pdfBusy = () => !!(pdf && pdfNote && (pdf.hasPendingWork() || (pdfComments && pdfComments.busy())));

  // Writes the PDF's edits into the file, whenever the app saves (leaving the note, hiding the window, quitting) and
  // on Save or Ctrl+S. opts.commit: finish a stroke or text box in progress first (not on a mere window blur, which
  // would end the person's drawing); opts.explicit: say so when done. Saves run one at a time, and each re-checks,
  // so edits made during an earlier save are saved too. Resolves false while edits are still unsaved.
  const flushPdf = oneAtATime((opts) => flushPdfNow(opts));

  async function flushPdfNow(opts) {
    let explicit = !!opts.explicit;
    for (let i = 0; i < 3; i++) {
      if (!pdf || !pdfNote) return true;
      if (opts.commit !== false) await pdf.commit();
      if (!pdfDirty()) return true;
      if (!(await savePdfNow(explicit))) return false;
      explicit = false;
    }
    return !pdfDirty();
  }

  async function savePdfNow(explicit) {
    const target = pdfNote;
    try {
      const { bytes, hash } = await pdf.save();
      const r = await api.files.savePdf(target.id, bytes, target.fileMtime);
      if (pdfNote === target) pdf.markSaved(hash);
      if (reportFileSaved(target, r, explicit, 'PDF') && pdfNote === target) pdfShownKey = target.id + ':' + r.mtime;
      return true;
    } catch (err) {
      toast('Could not save the PDF: ' + ipcErrorText(err) + ' Your changes are still here.');
      return false;
    }
  }

  // Says how main saved an edited file (r: { mtime, backup } in place, or { savedAs, newCopy } into a copy beside it,
  // when the file changed on disk since it was opened; later saves go to the same copy until it is reloaded).
  // what: 'PDF' or 'document'. Returns true when the file itself was written.
  function reportFileSaved(target, r, explicit, what) {
    if (r.savedAs) {
      if (r.newCopy || explicit) toast('This ' + what + ' changed on disk while you edited it, so your changes were saved as ' + r.savedAs.split(/[\\/]/).pop() + '.', { label: 'Open', run: () => openFiles([r.savedAs]) });
      return false;
    }
    noteFileWritten(target, r.mtime);
    if (explicit || r.backup) toast(r.backup ? 'Saved your changes into the ' + what + '. The original is backed up in the app\'s backups folder (Settings > Open data folder).' : 'Saved your changes into the ' + what + '.');
    return true;
  }

  // ---- PDF pages: turn, move, remove, add from another PDF ----------------------------------------

  // pdfPagesFor: the pdfNote the organizer's plan was made for. Applying it to anything else is refused.
  let pdfPages = null, pdfPagesFor = null;

  function openPdfPages() {
    if (!pdf || !pdfNote || !NotesPdfPages) return;
    if (!pdfPages) pdfPages = NotesPdfPages.create(el.pdfPages, pdf, { pickPdf: pickPdfForPages, apply: applyPdfPages, close: closePdfPages, say: toast });
    pdfPagesFor = pdfNote;
    el.pdfEditor.classList.add('organizing');
    pdfPages.open();
  }

  function closePdfPages() {
    pdfPagesFor = null;
    el.pdfEditor.classList.remove('organizing');
    if (pdf) pdf.closeOthers();
  }

  // An IPC call whose failure is reported as { ok: false, error } like its own refusals.
  async function callOk(promise) {
    try { return await promise; } catch (err) { return { ok: false, error: ipcErrorText(err) }; }
  }

  async function pickPdfForPages() {
    const r = await callOk(api.files.pdfPickPages());
    if (r.canceled) return null;
    if (!r.ok) { toast('Could not add pages: ' + r.error); return null; }
    return r;
  }

  // The app wrote the PDF itself: record the new time (so the poll does not reload it) on the note on show.
  function noteFileWritten(target, mtime) {
    target.fileMtime = mtime;
    if (state.current && state.current.id === target.id) state.current.fileMtime = mtime;
  }

  // Shows the PDF again from the file, which the app has just rewritten. keepView: the pages are laid out as before
  // (comments changed, not pages), so the same place is shown again.
  function reloadPdf(target, mtime, keepView) {
    noteFileWritten(target, mtime);
    if (state.current && state.current.id === target.id) showPdf(state.current, { keepView: !!keepView });
  }

  // While main rewrites the PDF, the pages and tools take no input: anything done meanwhile would be lost when the
  // rewritten file is shown.
  async function rewriting(promise) {
    el.pdfEditor.classList.add('rewriting');
    try { return await promise; } finally { el.pdfEditor.classList.remove('rewriting'); }
  }

  // Main rewrote the PDF (r: { mtime, backup }): show it again, and offer Undo, back to the backup taken just before.
  // say: { done, undone } texts; keepView as for reloadPdf, for the change and its Undo.
  function pdfRewritten(target, r, say, keepView) {
    reloadPdf(target, r.mtime, keepView);
    toast(say.done, { label: 'Undo', run: () => undoPdfChange(target.id, r.backup, r.mtime, say.undone, keepView) });
  }

  async function applyPdfPages(plan) {
    const target = pdfNote;
    if (!target || pdfPagesFor !== target) { closePdfPages(); toast('That PDF changed while the pages were open, so they were not changed.'); return false; }
    if (!(await flushPdf({ commit: true }))) { toast('Your marks could not be saved, so the pages were not changed.'); return false; }
    let bytes = null;
    if (plan.pageInfos) {
      // The pages come from the file as just saved, marks and form entries included: pdf.js would carry over drawn
      // marks from the open document but not typed form values.
      let saved;
      try { saved = new Uint8Array(await api.files.pdfBytes(target.id)); } catch (err) { toast('Could not read the PDF: ' + ipcErrorText(err)); return false; }
      const pageInfos = plan.pageInfos.map((info) => (info.document === null ? Object.assign({}, info, { document: saved }) : info));
      try { bytes = await pdf.extractPages(pageInfos); } catch (err) { toast('Could not rearrange the pages: ' + (err.message || err)); return false; }
      // pdf.js answers null, or silently leaves out a PDF it cannot read, instead of failing. Never write that, and
      // never turn pages of the old order instead: the turns belong to the new one.
      let pages = 0;
      try { if (bytes) pages = (await pdf.openOther(bytes)).pages; } catch (_) { pages = 0; }
      if (pages !== plan.rotations.length) { toast('Could not rearrange the pages: a PDF involved could not be read.'); return false; }
    }
    if (pdfNote !== target) return false;
    const r = await rewriting(callOk(api.files.pdfApplyPages(target.id, bytes, plan.rotations, target.fileMtime)));
    if (!r.ok) { toast('Could not change the pages: ' + r.error); return false; }
    pdfRewritten(target, r, { done: 'Pages updated.', undone: 'The pages are back as they were.' }, false);
    return true;
  }

  // Undo only while the file is exactly what the change wrote (mtime): anything saved since would be lost.
  async function undoPdfChange(id, backup, mtime, undoneText, keepView) {
    if (!pdfNote || pdfNote.id !== id) { toast('Open that PDF again to undo.'); return; }
    if (pdfComments && pdfComments.busy()) { toast('Save or cancel the comment you are writing first, then undo.'); return; }
    // Marks not yet saved are saved first: main then refuses the Undo, since the file is no longer what the change wrote.
    const target = pdfNote;
    if (!(await flushPdf({ commit: true }))) { toast('Your marks could not be saved, so nothing was undone.'); return; }
    if (pdfNote !== target) return;
    const r = await rewriting(callOk(api.files.pdfRestore(id, backup, mtime)));
    if (!r.ok) { toast('Could not undo: ' + r.error); return; }
    reloadPdf(target, r.mtime, keepView);
    toast(undoneText);
  }

  // ---- PDF comments: sticky notes, written into the file by main ---------------------------------------

  let pdfComments = null;
  const pdfCommentsShown = () => !!pdfComments && el.pdfEditor.classList.contains('commenting');

  function showPdfComments(show) {
    if (show && (!pdf || !pdfNote || !NotesPdfComments)) return;
    if (show && !pdfComments) pdfComments = NotesPdfComments.create(el.pdfComments, pdf, { change: changePdfComments, say: toast });
    el.pdfEditor.classList.toggle('commenting', show);
    el.pdfCommentsBtn.classList.toggle('is-on', show);
    if (!pdfComments) return;
    if (show) pdfComments.refresh();
    else pdfComments.stop();
  }

  // Marks not yet saved go into the file first, since main changes the file as it is on disk.
  async function changePdfComments(ops) {
    const target = pdfNote;
    if (!target) { toast('The PDF is still opening. Try again in a moment.'); return false; }
    if (!(await flushPdf({ commit: true }))) { toast('Your marks could not be saved, so the comment was not saved.'); return false; }
    if (pdfNote !== target) { toast('That PDF changed meanwhile, so the comment was not saved.'); return false; }
    const r = await rewriting(callOk(api.files.pdfComments(target.id, ops, target.fileMtime)));
    if (!r.ok) { toast('Could not save the comment: ' + r.error); return false; }
    const op = ops[0].op;
    pdfRewritten(target, r, { done: op === 'add' ? 'Comment added.' : op === 'edit' ? 'Comment changed.' : 'Comment deleted.', undone: 'The comments are back as they were.' }, true);
    return true;
  }

  // ---- PDF signature: drawn on a pad, placed with pdf.js's picture tool --------------------------------

  // signFor: the PDF note (id) the signature is for. signBusy: opening or placing is under way (double clicks).
  let signPad = null, signFor = null, signBusy = false;
  const signSay = (text) => { el.signStatus.textContent = text; }; // inside the dialog: a toast would sit behind it

  async function openSignDialog() {
    if (!pdf || !pdfNote || !NotesSignPad || signBusy || el.signDialog.open) return;
    signBusy = true;
    try {
      if (!signPad) signPad = NotesSignPad.create(el.signPad);
      let saved = null;
      try { saved = await api.signature.get(); } catch (_) { saved = null; }
      if (!pdfNote) return;
      signFor = pdfNote.id;
      signSay('');
      el.signName.value = '';
      el.signDialog.showModal();
      signPad.fit(); // after showModal, when the pad has its size
      el.signRemember.checked = !!saved;
      el.signForgetBtn.classList.toggle('hidden', !saved);
      if (saved) await signPad.load(new Blob([saved], { type: 'image/png' })).catch(() => signPad.clear());
    } finally {
      signBusy = false;
    }
  }

  async function placeSignature() {
    if (signBusy) return;
    signBusy = true;
    try {
      const blob = signPad && await signPad.toBlob();
      if (!blob) { signSay('Draw your signature, or type your name and press Write it.'); return; }
      el.signDialog.close();
      // Ticked keeps this signature for next time. Unticked keeps nothing new (Forget deletes a saved one).
      if (el.signRemember.checked) {
        const kept = await callOk(api.signature.set(new Uint8Array(await blob.arrayBuffer())));
        if (!kept.ok) toast('Could not remember the signature: ' + kept.error);
      }
      if (!pdf || !pdfNote || pdfNote.id !== signFor) { toast('The PDF changed while you signed, so the signature was not placed.'); return; }
      if (await pdf.placePicture(new File([blob], 'signature.png', { type: 'image/png' }))) toast('Signature placed. Drag it where it goes, or drag a corner to resize it.');
      else toast('This PDF does not allow changes.');
    } finally {
      signBusy = false;
    }
  }

  function onPdfToolbarClick(e) {
    const b = e.target.closest('button');
    if (!b || !pdf || !pdfNote) return;
    if (b.dataset.pdfMode) { if (!pdf.setMode(b.dataset.pdfMode)) toast('This PDF does not allow changes.'); return; }
    const act = b.dataset.pdfAct;
    if (act === 'undo') pdf.undo();
    else if (act === 'redo') pdf.redo();
    else if (act === 'zoom-in') pdf.zoomIn();
    else if (act === 'zoom-out') pdf.zoomOut();
    else if (act === 'fit') pdf.fitWidth();
    else if (act === 'pages') openPdfPages();
    else if (act === 'sign') openSignDialog();
    else if (act === 'comments') showPdfComments(!pdfCommentsShown());
    else if (b === el.pdfSaveBtn) flushPdf({ commit: true, explicit: true });
  }

  // The rest of the app's doors into the PDF on show.
  async function commitPdf() { if (pdf && pdfNote) await pdf.commit(); }
  function pdfOpen() { return !!pdfNote; }
  // The next showPdf shows the file again even if it did not change (a reload from disk drops the edits).
  function forgetShownPdf() { pdfShownKey = null; }

  function bindPdfEvents() {
    el.pdfEditor.querySelector('.pdf-toolbar').addEventListener('click', onPdfToolbarClick);
    el.pdfCommentsClose.addEventListener('click', () => showPdfComments(false));
    el.signForm.addEventListener('submit', (e) => { e.preventDefault(); placeSignature(); });
    el.signClearBtn.addEventListener('click', () => { if (signPad) signPad.clear(); signSay(''); });
    el.signTypeBtn.addEventListener('click', () => {
      if (signPad && signPad.writeName(el.signName.value)) signSay('');
      else signSay('Type your name first.');
    });
    el.signName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.signTypeBtn.click(); } });
    el.signCancelBtn.addEventListener('click', () => el.signDialog.close());
    el.signForgetBtn.addEventListener('click', async () => {
      const r = await callOk(api.signature.forget());
      if (!r.ok) { signSay('Could not forget the signature: ' + r.error); return; }
      el.signForgetBtn.classList.add('hidden');
      el.signRemember.checked = false;
      if (signPad) signPad.clear();
      signSay('The saved signature is gone from this PC.');
    });
  }

  return { clearPdf, showPdf, pdfDirty, pdfBusy, flushPdf, reportFileSaved, commitPdf, pdfOpen, forgetShownPdf, bindPdfEvents };
}
