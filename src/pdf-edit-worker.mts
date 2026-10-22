import { parentPort, workerData } from 'node:worker_threads';
const port = parentPort;
if (!port) throw new Error('this script runs in a worker thread only');
import pdfLibModule from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
const { PDFDocument, PDFName, PDFNumber, PDFHexString, PDFString, PDFRef, PDFArray, PDFDict, degrees } = pdfLibModule;

type CommentOp = { op: 'add' | 'edit' | 'delete', page: number, x: number, y: number, text: string, ref: [number, number] };
type WorkerTask = { bytes: Uint8Array, task: 'check' | 'rotate' | 'comments', rotations: number[], ops: CommentOp[], author: string };

const NOTE_SIZE = 20;
const NOTE_FLAGS = 4 | 8 | 16;
const NOTE_COLOR = [1, 0.82, 0.2];
const MAX_TEXT = 20000;

function isSigned(doc: pdfLibModule.PDFDocument) {
  const perms = doc.catalog.lookupMaybe(PDFName.of('Perms'), PDFDict);
  if (perms && perms.has(PDFName.of('DocMDP'))) return true;
  const form = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!form) return false;
  const flags = form.lookupMaybe(PDFName.of('SigFlags'), PDFNumber);
  if (flags && (flags.asNumber() & 1) === 1) return true;
  const seen = new Set();
  const signedField = (field?: pdfLibModule.PDFObject): boolean => {
    if (!(field instanceof PDFDict) || seen.has(field)) return false;
    seen.add(field);
    if (field.get(PDFName.of('FT')) === PDFName.of('Sig') && field.has(PDFName.of('V'))) return true;
    const kids = field.lookupMaybe(PDFName.of('Kids'), PDFArray);
    return !!kids && kids.asArray().some((k) => signedField(doc.context.lookup(k)));
  };
  const fields = form.lookupMaybe(PDFName.of('Fields'), PDFArray);
  return !!fields && fields.asArray().some((f) => signedField(doc.context.lookup(f)));
}
const SIGNED = 'this PDF is digitally signed, and changing it here would break the signature. Use your PDF app for this change';

function pageAt(doc: pdfLibModule.PDFDocument, i: number) {
  const pages = doc.getPages();
  if (!Number.isInteger(i) || !pages[i]) throw new Error('that page is not in the PDF any more');
  return pages[i];
}

function text(value: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('a comment needs some text');
  if (value.length > MAX_TEXT) throw new Error('that comment is too long');
  return PDFHexString.fromText(value);
}

function annotRefs(page: PDFPage) {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  return annots ? annots.asArray().filter((r) => r instanceof PDFRef) : [];
}

function annotOn(page: PDFPage, ref: [number, number]) {
  if (!Array.isArray(ref) || !Number.isInteger(ref[0]) || !Number.isInteger(ref[1])) throw new Error('that comment could not be found');
  const r = PDFRef.of(ref[0], ref[1]);
  if (!annotRefs(page).includes(r)) throw new Error('that comment is not in the PDF any more');
  return { ref: r, dict: page.doc.context.lookup(r, PDFDict) };
}

function addNote(doc: pdfLibModule.PDFDocument, op: CommentOp, author: string) {
  const page = pageAt(doc, op.page);
  const { x: x0, y: y0, width, height } = page.getCropBox();
  if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) throw new Error('the place for the comment was not valid');
  const x = Math.min(Math.max(op.x, x0), x0 + width - NOTE_SIZE);
  const y = Math.min(Math.max(op.y, y0 + NOTE_SIZE), y0 + height);
  const now = PDFString.fromDate(new Date());
  const dict = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [x, y - NOTE_SIZE, x + NOTE_SIZE, y],
    Contents: text(op.text),
    Name: 'Comment',
    Open: false,
    F: NOTE_FLAGS,
    C: NOTE_COLOR,
    P: page.ref,
  });
  dict.set(PDFName.of('M'), now);
  dict.set(PDFName.of('CreationDate'), now);
  dict.set(PDFName.of('NM'), PDFString.of('notes-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)));
  if (author) dict.set(PDFName.of('T'), PDFHexString.fromText(author));
  page.node.addAnnot(doc.context.register(dict));
}

const MARKUP = new Set<pdfLibModule.PDFObject | undefined>(['Text', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly',
  'StrikeOut', 'Stamp', 'Caret', 'Ink', 'FileAttachment', 'Sound'].map((k) => PDFName.of(k)));

function editNote(doc: pdfLibModule.PDFDocument, op: CommentOp) {
  const { dict } = annotOn(pageAt(doc, op.page), op.ref);
  if (!MARKUP.has(dict.get(PDFName.of('Subtype')))) throw new Error('that mark has no comment to change');
  dict.set(PDFName.of('Contents'), text(op.text));
  dict.delete(PDFName.of('RC'));
  dict.set(PDFName.of('M'), PDFString.fromDate(new Date()));
}

function deleteNote(doc: pdfLibModule.PDFDocument, op: CommentOp) {
  const page = pageAt(doc, op.page);
  const { ref, dict } = annotOn(page, op.ref);
  if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Text')) throw new Error('only sticky-note comments can be deleted here');
  const gone = new Set([ref]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of annotRefs(page)) {
      const d = doc.context.lookup(r);
      const irt = d instanceof PDFDict ? d.get(PDFName.of('IRT')) : undefined;
      if (!gone.has(r) && irt instanceof PDFRef && gone.has(irt)) { gone.add(r); grew = true; }
    }
  }
  for (const r of [...gone]) {
    const popup = doc.context.lookup(r, PDFDict).get(PDFName.of('Popup'));
    if (popup instanceof PDFRef) gone.add(popup);
  }
  for (const r of gone) {
    page.node.removeAnnot(r);
    doc.context.delete(r);
  }
}

const COMMENT_OPS = { add: addNote, edit: editNote, delete: deleteNote };

(async () => {
  try {
    const input: WorkerTask = workerData;
    const { task } = input;
    if (task === 'check') {
      let signed = false;
      try { signed = isSigned(await PDFDocument.load(input.bytes, { updateMetadata: false, ignoreEncryption: true })); } catch (_) { signed = false; }
      if (signed) throw new Error(SIGNED);
      port.postMessage({ ok: true });
      return;
    }
    const doc = await PDFDocument.load(input.bytes, { updateMetadata: false });
    if (isSigned(doc)) throw new Error(SIGNED);
    if (task === 'rotate') {
      const pages = doc.getPages();
      if (pages.length !== input.rotations.length) throw new Error('the PDF has a different number of pages than expected');
      pages.forEach((page, i) => {
        const turn = input.rotations[i];
        if (turn) page.setRotation(degrees((page.getRotation().angle + turn) % 360));
      });
    } else if (task === 'comments') {
      if (!Array.isArray(input.ops) || !input.ops.length) throw new Error('there was no change to make');
      for (const op of input.ops) {
        const run = op && Object.hasOwn(COMMENT_OPS, op.op) && COMMENT_OPS[op.op];
        if (!run) throw new Error('that comment change was not valid');
        run(doc, op, input.author || '');
      }
    } else throw new Error('unknown task');
    port.postMessage({ ok: true, bytes: await doc.save() });
  } catch (err) {
    port.postMessage({ ok: false, error: /encrypt/i.test(err.message) ? 'this PDF is encrypted, so Notes cannot change it this way' : err.message });
  }
})();
