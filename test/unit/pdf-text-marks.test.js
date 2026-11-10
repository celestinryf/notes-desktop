'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, PDFName, PDFDict, PDFHexString, PDFString } = require('pdf-lib');
const M = require('../../src/shared/pdf-text-marks.mts');
const P = require('../../src/pdf-text-marks-pdf.mts');

const mark = (extra) => Object.assign({ id: 'tm-1', page: 0, rect: [72, 600, 272, 640], text: 'Reviewed' }, M.DEFAULT_PDF_TEXT_STYLE, extra);

test('parsePdfTextMark accepts a full mark and fills missing style from the defaults', () => {
  const m = M.parsePdfTextMark({ id: 'a-1', page: 2, rect: [10, 20, 5, 40], text: 'hi' });
  assert.ok(m);
  assert.deepEqual(m.rect, [5, 20, 10, 40]);
  assert.equal(m.font, 'sans');
  assert.equal(m.size, 12);
  assert.equal(m.fill, null);
  assert.equal(m.align, 'left');
});

test('parsePdfTextMark rejects bad shapes and clamps odd values', () => {
  assert.equal(M.parsePdfTextMark(null), null);
  assert.equal(M.parsePdfTextMark({ id: 'x', page: -1, rect: [0, 0, 1, 1], text: '' }), null);
  assert.equal(M.parsePdfTextMark({ id: 'bad id!', page: 0, rect: [0, 0, 1, 1], text: '' }), null);
  assert.equal(M.parsePdfTextMark({ id: 'x', page: 0, rect: [0, 0, 1], text: '' }), null);
  assert.equal(M.parsePdfTextMark({ id: 'x', page: 0, rect: [0, 0, 1, NaN], text: '' }), null);
  assert.equal(M.parsePdfTextMark({ id: 'x', page: 0, rect: [0, 0, 1, 1], text: 'a'.repeat(M.MAX_PDF_TEXT + 1) }), null);
  const m = M.parsePdfTextMark({ id: 'x', page: 0, rect: [0, 0, 1, 1], text: '', size: 9000, opacity: 7, color: 'red', fill: '#ABCDEF', font: 'comic', align: 'justify', lineHeight: 0 });
  assert.equal(m.size, M.PDF_TEXT_MAX_SIZE);
  assert.equal(m.opacity, 1);
  assert.equal(m.color, '#000000');
  assert.equal(m.fill, '#abcdef');
  assert.equal(m.font, 'sans');
  assert.equal(m.align, 'left');
  assert.equal(m.lineHeight, 0.8);
});

test('wrapPdfText wraps on spaces, keeps explicit lines, and breaks a word longer than the box', () => {
  const measure = (s) => s.length * 10;
  assert.deepEqual(M.wrapPdfText('one two three four', 95, measure), ['one two', 'three', 'four']);
  assert.deepEqual(M.wrapPdfText('a\n\nb', 1000, measure), ['a', '', 'b']);
  assert.deepEqual(M.wrapPdfText('abcdefgh', 30, measure), ['abc', 'def', 'gh']);
  assert.deepEqual(M.wrapPdfText('', 30, measure), ['']);
});

test('unwritablePdfChar flags what the standard fonts cannot write', () => {
  assert.equal(M.unwritablePdfChar('Plain text, café — “quotes” €'), null);
  assert.equal(M.unwritablePdfChar('line\nbreak\ttab'), null);
  assert.equal(M.unwritablePdfChar('π'), 'π');
  assert.equal(M.unwritablePdfChar('ok 😀'), '😀');
});

test('pdfTextMarksKey changes with any field and is stable', () => {
  const a = [mark()], b = [mark({ text: 'Reviewed!' })], c = [mark({ bold: true })];
  assert.equal(M.pdfTextMarksKey(a), M.pdfTextMarksKey([mark()]));
  assert.notEqual(M.pdfTextMarksKey(a), M.pdfTextMarksKey(b));
  assert.notEqual(M.pdfTextMarksKey(a), M.pdfTextMarksKey(c));
  assert.notEqual(M.pdfTextMarksKey([]), M.pdfTextMarksKey(a));
});

test('standardFontName picks the bold and italic faces', () => {
  assert.equal(P.standardFontName({ font: 'sans', bold: false, italic: false }), 'Helvetica');
  assert.equal(P.standardFontName({ font: 'sans', bold: true, italic: true }), 'Helvetica-BoldOblique');
  assert.equal(P.standardFontName({ font: 'serif', bold: true, italic: false }), 'Times-Bold');
  assert.equal(P.standardFontName({ font: 'mono', bold: false, italic: true }), 'Courier-Oblique');
});

async function blank() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  return doc;
}

test('writeTextMarks adds a FreeText annotation with an appearance, and liftTextMarks takes it back out', async () => {
  const doc = await blank();
  const marks = [mark({ bold: true, fill: '#ffff98', align: 'center', underline: true, text: 'Reviewed\nby me' }), mark({ id: 'tm-2', page: 1, font: 'serif', italic: true, strike: true, opacity: 0.5 })];
  await P.writeTextMarks(doc, marks);
  const bytes = await doc.save({ useObjectStreams: false });
  assert.ok(Buffer.from(bytes).includes('/' + M.PDF_TEXT_MARK_KEY), 'the mark key is findable in the raw file');

  const again = await PDFDocument.load(bytes);
  const annots = again.getPage(0).node.Annots();
  assert.equal(annots.size(), 1);
  const dict = again.context.lookup(annots.get(0), PDFDict);
  assert.equal(dict.get(PDFName.of('Subtype')), PDFName.of('FreeText'));
  assert.equal(dict.get(PDFName.of('Q')).asNumber(), 1);
  assert.equal(dict.get(PDFName.of('NM')).asString(), 'tm-1');
  assert.match(dict.get(PDFName.of('DA')).asString(), /\/Helv 12 Tf/);
  assert.match(dict.get(PDFName.of('DS')).asString(), /bold 12pt Helvetica/);
  assert.ok(dict.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N')), 'has a normal appearance');
  assert.equal(dict.get(PDFName.of('Contents')).decodeText(), 'Reviewed\nby me');

  const lifted = P.liftTextMarks(again);
  assert.equal(lifted.length, 2);
  assert.deepEqual(lifted[0], marks[0]);
  assert.deepEqual(lifted[1], marks[1]);
  assert.equal(again.getPage(0).node.Annots().size(), 0, 'the annotation is gone from the page');
  assert.equal(again.getPage(1).node.Annots().size(), 0);
  assert.ok(!Buffer.from(await again.save({ useObjectStreams: false })).includes('/' + M.PDF_TEXT_MARK_KEY), 'nothing of the mark stays in the file');
});

test('liftTextMarks corrects the page of a mark whose page moved, and skips damaged marks', async () => {
  const doc = await blank();
  await P.writeTextMarks(doc, [mark({ page: 1 })]);
  const bytes = await doc.save({ useObjectStreams: false });
  const again = await PDFDocument.load(bytes);
  const [first, second] = again.getPages();
  again.removePage(0);
  again.insertPage(1, first);
  void second;
  const lifted = P.liftTextMarks(again);
  assert.equal(lifted.length, 1);
  assert.equal(lifted[0].page, 0, 'the mark follows its page to the new index');

  const broken = await blank();
  const dict = broken.context.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [0, 0, 10, 10] });
  dict.set(PDFName.of(M.PDF_TEXT_MARK_KEY), PDFHexString.fromText('{not json'));
  broken.getPage(0).node.addAnnot(broken.context.register(dict));
  const other = broken.context.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [0, 0, 10, 10] });
  other.set(PDFName.of(M.PDF_TEXT_MARK_KEY), PDFString.of('"a string, not a mark"'));
  broken.getPage(0).node.addAnnot(broken.context.register(other));
  assert.deepEqual(P.liftTextMarks(broken), []);
  assert.equal(broken.getPage(0).node.Annots().size(), 0, 'damaged marks are removed rather than left as stray annotations');
});

test('writeTextMarks refuses a character the standard fonts cannot write, and a page that is gone', async () => {
  const doc = await blank();
  await assert.rejects(P.writeTextMarks(doc, [mark({ text: 'pi is π' })]), /"π" cannot be written/);
  await assert.rejects(P.writeTextMarks(doc, [mark({ page: 7 })]), /not in the PDF any more/);
});

test('pdf.js reads the written annotation back with its appearance and draws text from it', async () => {
  const doc = await blank();
  await P.writeTextMarks(doc, [mark({ text: 'Reviewed', bold: true, fill: '#ffff98' })]);
  const bytes = await doc.save({ useObjectStreams: false });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const path = require('path');
  const fontsDir = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts').split(path.sep).join('/') + '/';
  const task = pdfjs.getDocument({ data: bytes, standardFontDataUrl: fontsDir, isEvalSupported: false, useWorkerFetch: false });
  const loaded = await task.promise;
  try {
    const page = await loaded.getPage(1);
    const [annot] = await page.getAnnotations();
    assert.equal(annot.subtype, 'FreeText');
    assert.equal(annot.hasAppearance, true);
    assert.equal(annot.contentsObj.str, 'Reviewed');
    const ops = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode.ENABLE });
    assert.ok(ops.fnArray.includes(pdfjs.OPS.showText), 'the appearance stream shows text');
    assert.ok(ops.fnArray.includes(pdfjs.OPS.beginAnnotation), 'the annotation is drawn on the page');
  } finally {
    await task.destroy();
  }
});

test('appearanceOps draws a fill, one text run per line, and rules for underline and strike', async () => {
  const doc = await blank();
  const font = await doc.embedFont('Helvetica');
  const plain = P.appearanceOps(mark({ text: 'one\ntwo' }), font, 200, 40);
  const names = (ops) => ops.map((op) => op.name);
  assert.equal(names(plain).filter((n) => n === 'Tj').length, 2);
  assert.equal(names(plain).filter((n) => n === 'f' || n === 'S').length, 0, 'no fill and no rules by default');
  const rich = P.appearanceOps(mark({ text: 'one', fill: '#ffffff', underline: true, strike: true }), font, 200, 40);
  assert.equal(names(rich).filter((n) => n === 'f').length, 1, 'one filled shape for the fill');
  assert.equal(names(rich).filter((n) => n === 'S').length, 2, 'one stroked rule each for underline and strike');
  const empty = P.appearanceOps(mark({ text: '' }), font, 200, 40);
  assert.equal(names(empty).filter((n) => n === 'Tj').length, 0);
});
