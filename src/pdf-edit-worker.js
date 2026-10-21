// @ts-check
'use strict';
/* Changes pdf-lib makes to a PDF, in a worker thread. workerData: { bytes, task, ... }, task one of
     'check'     nothing is changed; refuses a digitally signed PDF (see below)
     'rotate'    rotations: one entry per page, each 0, 90, 180 or 270 degrees clockwise, added to the page's own
     'comments'  ops: [{ op: 'add', page, x, y, text } | { op: 'edit', page, ref, text } | { op: 'delete', page, ref }]
                 with page 0-based, x and y the note's top-left corner in the page's PDF space, ref [num, gen] of
                 the annotation (as pdf.js names it); author: the name a new note is signed with, or ''
   Posts back { ok, bytes } (no bytes for 'check') or { ok: false, error }.
   pdf-lib writes the whole file anew, which would break a digital signature, so a signed PDF is always refused. */
const { parentPort, workerData } = require('worker_threads');
const port = parentPort;
if (!port) throw new Error('this script runs in a worker thread only');
const { PDFDocument, PDFName, PDFNumber, PDFHexString, PDFString, PDFRef, PDFArray, PDFDict, degrees } = require('pdf-lib');

const NOTE_SIZE = 20; // points: the usual size of a sticky note's icon
const NOTE_FLAGS = 4 | 8 | 16; // Print, NoZoom, NoRotate: printed, and the icon keeps its size and stays upright
const NOTE_COLOR = [1, 0.82, 0.2];
const MAX_TEXT = 20000;

// Signed: the form says signatures exist, a signature field has a value, or the PDF is certified (DocMDP).
function isSigned(doc) {
  const perms = doc.catalog.lookupMaybe(PDFName.of('Perms'), PDFDict);
  if (perms && perms.has(PDFName.of('DocMDP'))) return true;
  const form = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (!form) return false;
  const flags = form.lookupMaybe(PDFName.of('SigFlags'), PDFNumber);
  if (flags && (flags.asNumber() & 1) === 1) return true;
  const seen = new Set();
  const signedField = (field) => {
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

function pageAt(doc, i) {
  const pages = doc.getPages();
  if (!Number.isInteger(i) || !pages[i]) throw new Error('that page is not in the PDF any more');
  return pages[i];
}

function text(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('a comment needs some text');
  if (value.length > MAX_TEXT) throw new Error('that comment is too long');
  return PDFHexString.fromText(value);
}

// The refs in a page's annotation list (the list itself may be an indirect object).
function annotRefs(page) {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  return annots ? annots.asArray().filter((r) => r instanceof PDFRef) : [];
}

// The annotation ref names on page, which must be one of that page's.
function annotOn(page, ref) {
  if (!Array.isArray(ref) || !Number.isInteger(ref[0]) || !Number.isInteger(ref[1])) throw new Error('that comment could not be found');
  const r = PDFRef.of(ref[0], ref[1]);
  if (!annotRefs(page).includes(r)) throw new Error('that comment is not in the PDF any more');
  return { ref: r, dict: page.doc.context.lookup(r, PDFDict) };
}

function addNote(doc, op, author) {
  const page = pageAt(doc, op.page);
  const { x: x0, y: y0, width, height } = page.getCropBox();
  if (!Number.isFinite(op.x) || !Number.isFinite(op.y)) throw new Error('the place for the comment was not valid');
  // Kept wholly on the page.
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

// Kinds whose comment can be retyped (PDF markup annotations, but not text boxes, whose text is on the page).
const MARKUP = new Set(['Text', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly',
  'StrikeOut', 'Stamp', 'Caret', 'Ink', 'FileAttachment', 'Sound'].map((k) => PDFName.of(k)));

function editNote(doc, op) {
  const { dict } = annotOn(pageAt(doc, op.page), op.ref);
  if (!MARKUP.has(dict.get(PDFName.of('Subtype')))) throw new Error('that mark has no comment to change');
  dict.set(PDFName.of('Contents'), text(op.text));
  dict.delete(PDFName.of('RC')); // a rich-text copy of the old comment, which some apps would show instead
  dict.set(PDFName.of('M'), PDFString.fromDate(new Date()));
}

// Removes the note, its pop-up, and the replies to it (with theirs), from the page and from the file.
function deleteNote(doc, op) {
  const page = pageAt(doc, op.page);
  const { ref, dict } = annotOn(page, op.ref);
  if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Text')) throw new Error('only sticky-note comments can be deleted here');
  // The replies, and replies to those, until no more are found.
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
    const { task } = workerData;
    if (task === 'check') {
      // Only the signature matters here: a PDF pdf-lib cannot read (encrypted, or slightly damaged) is not refused,
      // since what is written comes from pdf.js, which could read it.
      let signed = false;
      try { signed = isSigned(await PDFDocument.load(workerData.bytes, { updateMetadata: false, ignoreEncryption: true })); } catch (_) { signed = false; }
      if (signed) throw new Error(SIGNED);
      port.postMessage({ ok: true });
      return;
    }
    const doc = await PDFDocument.load(workerData.bytes, { updateMetadata: false });
    if (isSigned(doc)) throw new Error(SIGNED);
    if (task === 'rotate') {
      const pages = doc.getPages();
      if (pages.length !== workerData.rotations.length) throw new Error('the PDF has a different number of pages than expected');
      pages.forEach((page, i) => {
        const turn = workerData.rotations[i];
        if (turn) page.setRotation(degrees((page.getRotation().angle + turn) % 360));
      });
    } else if (task === 'comments') {
      if (!Array.isArray(workerData.ops) || !workerData.ops.length) throw new Error('there was no change to make');
      for (const op of workerData.ops) {
        const run = op && Object.hasOwn(COMMENT_OPS, op.op) && COMMENT_OPS[op.op];
        if (!run) throw new Error('that comment change was not valid');
        run(doc, op, workerData.author || '');
      }
    } else throw new Error('unknown task');
    port.postMessage({ ok: true, bytes: await doc.save() });
  } catch (err) {
    port.postMessage({ ok: false, error: /encrypt/i.test(err.message) ? 'this PDF is encrypted, so Notes cannot change it this way' : err.message });
  }
})();
