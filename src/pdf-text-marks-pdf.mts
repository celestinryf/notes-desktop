import pdfLibModule from 'pdf-lib';
import type { PDFDocument, PDFFont, PDFPage, Color } from 'pdf-lib';
import { PDF_TEXT_MARK_KEY, PDF_TEXT_PADDING, MAX_PDF_TEXT_MARKS, parsePdfTextMark, wrapPdfText, pdfTextLineHeight, unwritablePdfChar } from './shared/pdf-text-marks.mts';
import type { PdfTextMark, PdfTextFont } from './shared/pdf-text-marks.mts';

const { PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString, StandardFonts, rgb, degrees, drawText, drawRectangle, drawLine } = pdfLibModule;

const KEY = PDFName.of(PDF_TEXT_MARK_KEY);
const STANDARD: Record<PdfTextFont, [string, string, string, string]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};
const DA_NAMES: Record<PdfTextFont, string> = { sans: 'Helv', serif: 'TiRo', mono: 'Cour' };
const ALIGN_Q = { left: 0, center: 1, right: 2 };
const PRINT_FLAG = 4;

export function standardFontName(mark: Pick<PdfTextMark, 'font' | 'bold' | 'italic'>) {
  return STANDARD[mark.font][(mark.bold ? 1 : 0) + (mark.italic ? 2 : 0)];
}

function hexToRgb(hex: string): Color {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const hexToDa = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => (c / 255).toFixed(3)).join(' ');
};

function decodeText(value: unknown): string | null {
  if (value instanceof PDFHexString || value instanceof PDFString) return value.decodeText();
  return null;
}

function annotRefs(page: PDFPage) {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  return annots ? annots.asArray().filter((r): r is pdfLibModule.PDFRef => r instanceof PDFRef) : [];
}

export function liftTextMarks(doc: PDFDocument): PdfTextMark[] {
  const marks: PdfTextMark[] = [];
  doc.getPages().forEach((page, index) => {
    for (const ref of annotRefs(page)) {
      const dict = doc.context.lookup(ref);
      if (!(dict instanceof PDFDict) || !dict.has(KEY)) continue;
      const raw = decodeText(dict.get(KEY));
      let parsed: unknown = null;
      try { parsed = raw === null ? null : JSON.parse(raw); } catch (_) { parsed = null; }
      const mark = parsePdfTextMark(parsed);
      page.node.removeAnnot(ref);
      const ap = dict.lookupMaybe(PDFName.of('AP'), PDFDict);
      const normal = ap && ap.get(PDFName.of('N'));
      if (normal instanceof PDFRef) doc.context.delete(normal);
      doc.context.delete(ref);
      if (mark && marks.length < MAX_PDF_TEXT_MARKS) marks.push(Object.assign(mark, { page: index }));
    }
  });
  return marks;
}

export async function writeTextMarks(doc: PDFDocument, marks: readonly PdfTextMark[]) {
  if (marks.length > MAX_PDF_TEXT_MARKS) throw new Error('this PDF has too many text boxes to save');
  const pages = doc.getPages();
  const fonts = new Map<string, PDFFont>();
  const fontFor = async (mark: PdfTextMark) => {
    const name = standardFontName(mark);
    let font = fonts.get(name);
    if (!font) { font = await doc.embedFont(name); fonts.set(name, font); }
    return font;
  };
  const now = PDFString.fromDate(new Date());
  for (const mark of marks) {
    const page = pages[mark.page];
    if (!page) throw new Error('a text box sits on a page that is not in the PDF any more');
    const bad = unwritablePdfChar(mark.text);
    if (bad !== null) throw new Error('the character "' + bad + '" cannot be written with the PDF\'s standard fonts. Replace it, then save again');
    const font = await fontFor(mark);
    const [x1, y1, x2, y2] = mark.rect;
    const width = Math.max(1, x2 - x1), height = Math.max(1, y2 - y1);
    const gs = doc.context.register(doc.context.obj({ Type: 'ExtGState', CA: mark.opacity, ca: mark.opacity }));
    const stream = doc.context.formXObject(appearanceOps(mark, font, width, height), {
      BBox: [0, 0, width, height],
      Resources: doc.context.obj({ Font: doc.context.obj({ F1: font.ref }), ExtGState: doc.context.obj({ GS: gs }) }),
    });
    const apRef = doc.context.register(stream);
    const dict = doc.context.obj({
      Type: 'Annot',
      Subtype: 'FreeText',
      Rect: [x1, y1, x2, y2],
      F: PRINT_FLAG,
      Q: ALIGN_Q[mark.align],
      CA: mark.opacity,
      P: page.ref,
      AP: doc.context.obj({ N: apRef }),
    });
    dict.set(PDFName.of('Contents'), PDFHexString.fromText(mark.text));
    dict.set(PDFName.of('DA'), PDFString.of('/' + DA_NAMES[mark.font] + ' ' + mark.size + ' Tf ' + hexToDa(mark.color) + ' rg'));
    dict.set(PDFName.of('DS'), PDFString.of(defaultStyle(mark)));
    dict.set(PDFName.of('NM'), PDFString.of(mark.id));
    dict.set(PDFName.of('M'), now);
    dict.set(KEY, PDFHexString.fromText(JSON.stringify(mark)));
    page.node.addAnnot(doc.context.register(dict));
  }
}

function defaultStyle(mark: PdfTextMark) {
  const family = { sans: 'Helvetica', serif: 'Times', mono: 'Courier' }[mark.font];
  const decoration = [mark.underline ? 'underline' : '', mark.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
  return 'font: ' + (mark.bold ? 'bold ' : '') + (mark.italic ? 'italic ' : '') + mark.size + 'pt ' + family + '; color: ' + mark.color + '; text-align: ' + mark.align + '; text-decoration: ' + decoration + '; line-height: ' + mark.lineHeight;
}

export function appearanceOps(mark: PdfTextMark, font: PDFFont, width: number, height: number) {
  const ops = [];
  const zero = degrees(0);
  const common = { rotate: zero, xSkew: zero, ySkew: zero, graphicsState: 'GS' };
  if (mark.fill) ops.push(...drawRectangle({ x: 0, y: 0, width, height, borderWidth: 0, color: hexToRgb(mark.fill), borderColor: undefined, ...common }));
  const color = hexToRgb(mark.color);
  const lineH = pdfTextLineHeight(mark);
  const ascent = font.heightAtSize(mark.size, { descender: false });
  const inner = Math.max(1, width - 2 * PDF_TEXT_PADDING);
  const lines = wrapPdfText(mark.text, inner, (s) => font.widthOfTextAtSize(s, mark.size));
  const rule = Math.max(0.5, mark.size * 0.06);
  lines.forEach((line, i) => {
    const lineWidth = font.widthOfTextAtSize(line, mark.size);
    const x = mark.align === 'left' ? PDF_TEXT_PADDING : mark.align === 'center' ? (width - lineWidth) / 2 : width - PDF_TEXT_PADDING - lineWidth;
    const baseline = height - PDF_TEXT_PADDING - i * lineH - (lineH - mark.size) / 2 - ascent;
    if (line) ops.push(...drawText(font.encodeText(line), { x, y: baseline, size: mark.size, font: 'F1', color, ...common }));
    if (!line) return;
    if (mark.underline) ops.push(...drawLine({ start: { x, y: baseline - mark.size * 0.12 }, end: { x: x + lineWidth, y: baseline - mark.size * 0.12 }, thickness: rule, color, graphicsState: 'GS' }));
    if (mark.strike) ops.push(...drawLine({ start: { x, y: baseline + ascent * 0.35 }, end: { x: x + lineWidth, y: baseline + ascent * 0.35 }, thickness: rule, color, graphicsState: 'GS' }));
  });
  return ops;
}

export function textMarkLineCount(mark: PdfTextMark, font: PDFFont) {
  const inner = Math.max(1, mark.rect[2] - mark.rect[0] - 2 * PDF_TEXT_PADDING);
  return wrapPdfText(mark.text, inner, (s) => font.widthOfTextAtSize(s, mark.size)).length;
}
