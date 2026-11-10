import { isRecord } from './helpers.mts';

export type PdfTextFont = 'sans' | 'serif' | 'mono';
export type PdfTextAlign = 'left' | 'center' | 'right';
export type PdfRect = [number, number, number, number];

export interface PdfTextStyle {
  font: PdfTextFont;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  fill: string | null;
  opacity: number;
  align: PdfTextAlign;
  lineHeight: number;
}

export interface PdfTextMark extends PdfTextStyle {
  id: string;
  page: number;
  rect: PdfRect;
  text: string;
}

export const PDF_TEXT_FONTS: readonly PdfTextFont[] = ['sans', 'serif', 'mono'];
export const PDF_TEXT_FONT_LABELS: Record<PdfTextFont, string> = { sans: 'Sans (Helvetica)', serif: 'Serif (Times)', mono: 'Mono (Courier)' };
export const PDF_TEXT_FONT_CSS: Record<PdfTextFont, string> = {
  sans: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
  mono: '"Courier New", Courier, "Liberation Mono", monospace',
};
export const PDF_TEXT_ALIGNS: readonly PdfTextAlign[] = ['left', 'center', 'right'];
export const PDF_TEXT_SIZES: readonly number[] = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
export const PDF_LINE_HEIGHTS: readonly number[] = [1, 1.15, 1.5, 2];
export const PDF_TEXT_FILLS: readonly { value: string, label: string }[] = [
  { value: '', label: 'None' }, { value: '#ffffff', label: 'White' }, { value: '#ffff98', label: 'Yellow' },
  { value: '#53ffbc', label: 'Green' }, { value: '#80ebff', label: 'Blue' }, { value: '#ffcbe6', label: 'Pink' },
];
export const DEFAULT_PDF_TEXT_STYLE: PdfTextStyle = { font: 'sans', size: 12, bold: false, italic: false, underline: false, strike: false, color: '#000000', fill: null, opacity: 1, align: 'left', lineHeight: 1.15 };
export const PDF_TEXT_STYLE_KEYS = Object.keys(DEFAULT_PDF_TEXT_STYLE) as (keyof PdfTextStyle)[];
export const PDF_TEXT_MARK_KEY = 'NotesTextMark';
export const PDF_TEXT_PADDING = 2;
export const PDF_TEXT_MIN_SIZE = 4;
export const PDF_TEXT_MAX_SIZE = 400;
export const PDF_TEXT_MIN_WIDTH = 12;
export const MAX_PDF_TEXT = 20000;
export const MAX_PDF_TEXT_MARKS = 2000;

const isFont = (v: unknown): v is PdfTextFont => typeof v === 'string' && (PDF_TEXT_FONTS as readonly string[]).includes(v);
const isAlign = (v: unknown): v is PdfTextAlign => typeof v === 'string' && (PDF_TEXT_ALIGNS as readonly string[]).includes(v);
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function clampPdfTextSize(size: number) {
  return clamp(Math.round(size * 2) / 2, PDF_TEXT_MIN_SIZE, PDF_TEXT_MAX_SIZE);
}

export function parsePdfTextStyle(value: unknown): PdfTextStyle {
  const v = isRecord(value) ? value : {};
  const d = DEFAULT_PDF_TEXT_STYLE;
  return {
    font: isFont(v.font) ? v.font : d.font,
    size: finite(v.size) ? clampPdfTextSize(v.size) : d.size,
    bold: v.bold === true,
    italic: v.italic === true,
    underline: v.underline === true,
    strike: v.strike === true,
    color: isHexColor(v.color) ? v.color.toLowerCase() : d.color,
    fill: isHexColor(v.fill) ? v.fill.toLowerCase() : null,
    opacity: finite(v.opacity) ? clamp(v.opacity, 0.05, 1) : d.opacity,
    align: isAlign(v.align) ? v.align : d.align,
    lineHeight: finite(v.lineHeight) ? clamp(v.lineHeight, 0.8, 4) : d.lineHeight,
  };
}

export function parsePdfTextMark(value: unknown): PdfTextMark | null {
  if (!isRecord(value)) return null;
  const { id, page, rect, text } = value;
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return null;
  if (!Number.isInteger(page) || typeof page !== 'number' || page < 0) return null;
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(finite)) return null;
  if (typeof text !== 'string' || text.length > MAX_PDF_TEXT) return null;
  const [x1, y1, x2, y2] = rect;
  return Object.assign(parsePdfTextStyle(value), { id, page, rect: normalRect([x1, y1, x2, y2]), text });
}

export function normalRect([x1, y1, x2, y2]: PdfRect): PdfRect {
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

export function pdfTextStyleOf(mark: PdfTextStyle): PdfTextStyle {
  const style: Partial<PdfTextStyle> = {};
  for (const key of PDF_TEXT_STYLE_KEYS) Object.assign(style, { [key]: mark[key] });
  return parsePdfTextStyle(style);
}

export const pdfTextLineHeight = (style: PdfTextStyle) => style.size * style.lineHeight;

export function wrapPdfText(text: string, width: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      const next = line ? line + ' ' + word : word;
      if (!line || measure(next) <= width) { line = next; continue; }
      lines.push(line);
      line = word;
    }
    for (const piece of breakLong(line, width, measure)) lines.push(piece);
  }
  return lines;
}

function breakLong(word: string, width: number, measure: (s: string) => number): string[] {
  if (measure(word) <= width || word.length < 2) return [word];
  const out: string[] = [];
  let piece = '';
  for (const ch of word) {
    if (piece && measure(piece + ch) > width) { out.push(piece); piece = ch; } else piece += ch;
  }
  out.push(piece);
  return out;
}

const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split('').map((c) => c.codePointAt(0) || 0));
export function unwritablePdfChar(text: string): string | null {
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0;
    if (code === 0x0a || code === 0x09) continue;
    if (code >= 0x20 && code <= 0x7e) continue;
    if (code >= 0xa0 && code <= 0xff) continue;
    if (WIN_ANSI_EXTRA.has(code)) continue;
    return ch;
  }
  return null;
}

export function pdfTextMarksKey(marks: readonly PdfTextMark[]) {
  const json = JSON.stringify(marks);
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h * 33) ^ json.charCodeAt(i)) >>> 0;
  return marks.length + ':' + json.length + ':' + h.toString(36);
}
