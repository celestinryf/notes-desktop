import { el } from './dom.ts';
import { state } from './state.ts';
import { NotesPdfEditor, requireChild } from './pdf-editor.ts';
import type { PdfController } from './pdf-editor.ts';
import { NotesPdfPages } from './pdf-pages.ts';
import type { PdfPagesPlan } from './pdf-pages.ts';
import { NotesPdfComments } from './pdf-comments.ts';
import type { PdfCommentOp } from './pdf-comments.ts';
import { NotesSignPad } from './sign-pad.ts';
import { oneAtATime } from './one-at-a-time.ts';
import { ipcErrorText } from './text.ts';
import { toast } from './toast.ts';

type PdfOnShow = { id: string, fileMtime: number | null };
type FlushOptions = { commit?: boolean, explicit?: boolean };
type SavedAsCopy = Extract<SavedFile, { savedAs: string }>;
type CallFailure = { ok: false, error: string, canceled?: undefined };
type Rewritten = { mtime: number | null, backup: string };
type PdfNoteDeps = {
  api: NotesApi,
  externalLinkClick: (e: MouseEvent, href: string) => void,
  showBanner: (text: string) => void,
  openFiles: (paths?: string[]) => Promise<unknown>,
};

export function createPdfNote({ api, externalLinkClick, showBanner, openFiles }: PdfNoteDeps) {

  let pdf: PdfController | null = null;
  let pdfShownKey: string | null = null, pdfSeq = 0, pdfNote: PdfOnShow | null = null;

  function pdfController() {
    if (!pdf && NotesPdfEditor) {
      pdf = NotesPdfEditor.create(el.pdfEditor, {
        onDirty: (d) => { el.pdfSaveBtn.textContent = d ? 'Save' : 'Saved'; },
        onState: (s) => {
          for (const b of el.pdfEditor.querySelectorAll<HTMLElement>('[data-pdf-mode]')) b.classList.toggle('is-on', b.dataset.pdfMode === s.mode);
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

  async function showPdf(note: PublicNote, opts?: { keepView?: boolean }) {
    const key = note.id + ':' + note.fileMtime;
    if (pdfShownKey === key) return;
    closePdfPages();
    if (pdfComments) pdfComments.stop();
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
        if (pdfComments && pdfCommentsShown()) pdfComments.refresh();
      }
    } catch (err) {
      if (seq !== pdfSeq) return;
      pdfShownKey = null;
      showBanner('Could not show this PDF: ' + ipcErrorText(err) + ' Use "Open with…" for your PDF app.');
    }
  }

  const pdfDirty = () => !!(pdf && pdfNote && pdf.isDirty());
  const pdfBusy = () => !!(pdf && pdfNote && (pdf.hasPendingWork() || (pdfComments && pdfComments.busy())));

  const flushPdf = oneAtATime((opts: FlushOptions) => flushPdfNow(opts));

  async function flushPdfNow(opts: FlushOptions) {
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

  async function savePdfNow(explicit: boolean) {
    const target = pdfNote, ctl = pdf;
    try {
      if (!target || !ctl) throw new Error('no PDF is open.');
      const saved = await ctl.save();
      if (!saved) throw new Error('no PDF is open.');
      const { bytes, hash } = saved;
      const r = await api.files.savePdf(target.id, bytes, target.fileMtime);
      if (pdfNote === target) ctl.markSaved(hash);
      if (reportFileSaved(target, r, explicit, 'PDF') && pdfNote === target) pdfShownKey = target.id + ':' + r.mtime;
      return true;
    } catch (err) {
      toast('Could not save the PDF: ' + ipcErrorText(err) + ' Your changes are still here.');
      return false;
    }
  }

  const savedAsCopy = (r: SavedFile): r is SavedAsCopy => !!r.savedAs;

  function reportFileSaved(target: PdfOnShow, r: SavedFile, explicit: boolean, what: string) {
    if (savedAsCopy(r)) {
      if (r.newCopy || explicit) toast('This ' + what + ' changed on disk while you edited it, so your changes were saved as ' + r.savedAs.split(/[\\/]/).pop() + '.', { label: 'Open', run: () => openFiles([r.savedAs]) });
      return false;
    }
    noteFileWritten(target, r.mtime);
    if (explicit || r.backup) toast(r.backup ? 'Saved your changes into the ' + what + '. The original is backed up in the app\'s backups folder (Settings > Open data folder).' : 'Saved your changes into the ' + what + '.');
    return true;
  }

  let pdfPages: { open: () => void; } | null = null, pdfPagesFor: PdfOnShow | null = null;

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

  async function callOk<T extends { ok: boolean }>(promise: Promise<T>): Promise<T | CallFailure> {
    try { return await promise; } catch (err) { return { ok: false, error: ipcErrorText(err) }; }
  }

  async function pickPdfForPages() {
    const r = await callOk(api.files.pdfPickPages());
    if ('canceled' in r && r.canceled) return null;
    if (!r.ok) { toast('Could not add pages: ' + r.error); return null; }
    return r;
  }

  function noteFileWritten(target: PdfOnShow, mtime: number | null) {
    target.fileMtime = mtime;
    if (state.current && state.current.id === target.id) state.current.fileMtime = mtime;
  }

  function reloadPdf(target: PdfOnShow, mtime: number | null, keepView: boolean) {
    noteFileWritten(target, mtime);
    if (state.current && state.current.id === target.id) showPdf(state.current, { keepView: !!keepView });
  }

  async function rewriting<T>(promise: Promise<T>) {
    el.pdfEditor.classList.add('rewriting');
    try { return await promise; } finally { el.pdfEditor.classList.remove('rewriting'); }
  }

  function pdfRewritten(target: PdfOnShow, r: Rewritten, say: { done: string, undone: string }, keepView: boolean) {
    reloadPdf(target, r.mtime, keepView);
    toast(say.done, { label: 'Undo', run: () => undoPdfChange(target.id, r.backup, r.mtime, say.undone, keepView) });
  }

  async function applyPdfPages(plan: PdfPagesPlan) {
    const target = pdfNote;
    const ctl = pdf;
    if (!target || !ctl || pdfPagesFor !== target) { closePdfPages(); toast('That PDF changed while the pages were open, so they were not changed.'); return false; }
    if (!(await flushPdf({ commit: true }))) { toast('Your marks could not be saved, so the pages were not changed.'); return false; }
    let bytes: Uint8Array | null = null;
    if (plan.pageInfos) {
      let saved: Uint8Array;
      try { saved = new Uint8Array(await api.files.pdfBytes(target.id)); } catch (err) { toast('Could not read the PDF: ' + ipcErrorText(err)); return false; }
      const pageInfos = plan.pageInfos.map((info) => (info.document === null ? Object.assign({}, info, { document: saved }) : info));
      try { bytes = await ctl.extractPages(pageInfos); } catch (err) { toast('Could not rearrange the pages: ' + (err.message || err)); return false; }
      let pages = 0;
      try { if (bytes) pages = (await ctl.openOther(bytes)).pages; } catch (_) { pages = 0; }
      if (pages !== plan.rotations.length) { toast('Could not rearrange the pages: a PDF involved could not be read.'); return false; }
    }
    if (pdfNote !== target) return false;
    const r = await rewriting(callOk(api.files.pdfApplyPages(target.id, bytes, plan.rotations, target.fileMtime)));
    if (!r.ok) { toast('Could not change the pages: ' + r.error); return false; }
    pdfRewritten(target, r, { done: 'Pages updated.', undone: 'The pages are back as they were.' }, false);
    return true;
  }

  async function undoPdfChange(id: string, backup: string, mtime: number | null, undoneText: string, keepView: boolean) {
    if (!pdfNote || pdfNote.id !== id) { toast('Open that PDF again to undo.'); return; }
    if (pdfComments && pdfComments.busy()) { toast('Save or cancel the comment you are writing first, then undo.'); return; }
    const target = pdfNote;
    if (!(await flushPdf({ commit: true }))) { toast('Your marks could not be saved, so nothing was undone.'); return; }
    if (pdfNote !== target) return;
    const r = await rewriting(callOk(api.files.pdfRestore(id, backup, mtime)));
    if (!r.ok) { toast('Could not undo: ' + r.error); return; }
    reloadPdf(target, r.mtime, keepView);
    toast(undoneText);
  }

  let pdfComments: { refresh: () => Promise<void>; stop(): void; busy: () => boolean; } | null = null;
  const pdfCommentsShown = () => !!pdfComments && el.pdfEditor.classList.contains('commenting');

  function showPdfComments(show: boolean) {
    if (show && (!pdf || !pdfNote || !NotesPdfComments)) return;
    if (show && !pdfComments && pdf) pdfComments = NotesPdfComments.create(el.pdfComments, pdf, { change: changePdfComments, say: toast });
    el.pdfEditor.classList.toggle('commenting', show);
    el.pdfCommentsBtn.classList.toggle('is-on', show);
    if (!pdfComments) return;
    if (show) pdfComments.refresh();
    else pdfComments.stop();
  }

  async function changePdfComments(ops: PdfCommentOp[]) {
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

  let signPad: ReturnType<typeof NotesSignPad.create> | null = null, signFor: string | null = null, signBusy = false;
  const signSay = (text: string) => { el.signStatus.textContent = text; };

  async function openSignDialog() {
    if (!pdf || !pdfNote || !NotesSignPad || signBusy || el.signDialog.open) return;
    signBusy = true;
    try {
      const pad = signPad || NotesSignPad.create(el.signPad);
      signPad = pad;
      let saved: IpcResult<'signature:get'> = null;
      try { saved = await api.signature.get(); } catch (_) { saved = null; }
      if (!pdfNote) return;
      signFor = pdfNote.id;
      signSay('');
      el.signName.value = '';
      el.signDialog.showModal();
      pad.fit();
      el.signRemember.checked = !!saved;
      el.signForgetBtn.classList.toggle('hidden', !saved);
      if (saved) await pad.load(new Blob([saved], { type: 'image/png' })).catch(() => pad.clear());
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

  function onPdfToolbarClick(e: MouseEvent) {
    if (!(e.target instanceof Element)) return;
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

  async function commitPdf() { if (pdf && pdfNote) await pdf.commit(); }
  function pdfOpen() { return !!pdfNote; }
  function forgetShownPdf() { pdfShownKey = null; }

  function bindPdfEvents() {
    requireChild(el.pdfEditor, '.pdf-toolbar', HTMLElement).addEventListener('click', onPdfToolbarClick);
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
