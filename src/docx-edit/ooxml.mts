/* Format-safe editing of a Word document's main part (word/document.xml), as text. No DOM: the renderer (bundled into
   docx.bundle.js) and main's save worker both use it.

   The document is scanned for its paragraphs. A paragraph is editable only when everything in it can be written back
   exactly: plain runs of text (with tabs and line breaks), bookmarks and comment ranges. Anything else (tracked
   changes, fields, links, pictures, content controls, hidden text...) makes it read-only. Saving replaces only the
   paragraphs that changed, as spliced text: every other byte of the part stays as it was, and inside a changed
   paragraph every run whose text and formatting were not touched is copied as it was. */

const W_MAIN = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ---- Reading the XML ------------------------------------------------------------------------------------

type TagToken = { type: 'open' | 'close' | 'empty', name: string, attrs: string, start: number, end: number };
type OtherToken = { type: 'text' | 'comment' | 'pi' | 'cdata' | 'doctype', start: number, end: number, name?: undefined, attrs?: undefined };
type Token = TagToken | OtherToken;
type XmlElement = { name: string, attrs: string, start: number, openEnd: number, closeStart: number, end: number, children: XmlNode[], empty?: boolean, type?: undefined };
type XmlNode = XmlElement | OtherToken;
type PageBreak = { start: number, end: number, rPr: string };
type Run = { kind: 'run', rPr: string, xml: string, text: string, pageBreaks: PageBreak[], pictures: string[] };
type Marker = { kind: 'marker', xml: string, text?: undefined };
type Item = Run | Marker;
type ParagraphModel = { pPr: string | null, pPrNoSect: string | null, hasSect: boolean, markRPr: string, items: Item[], pageBreaks: PageBreak[], contentStart: number };
type ScannedParagraph = { start: number, openEnd: number, end?: number, placeOk: boolean, parentStart: number, selfClosing: boolean };
type ParagraphPlace = { index: number, start: number, openEnd: number, end: number, parentStart: number, selfClosing: boolean, openTag: string, chain: number };
type EditableParagraph = ParagraphPlace & ParagraphModel & { editable: true, reason: '', text: string };
type FixedParagraph = ParagraphPlace & { editable: false, reason: string };
type Paragraph = EditableParagraph | FixedParagraph;
type Scan = { prefix: string, paragraphs: Paragraph[] };
type Fmt = { b?: boolean, i?: boolean, u?: boolean };
type Baseline = { chars: Fmt[], pictures?: (string | null)[], empty: Fmt };
type Piece = { source: number, chars: { ch: string, fmt: Fmt, picture?: string | null }[] };
type OldChar = { end?: false, ch: string, para: number, pos: number, item: Run, first: boolean, last: boolean, picture?: string, name?: string | null };
type OldToken = OldChar | { end: true, para: number, ch?: undefined, name?: undefined };
type NewChar = { end?: false, ch: string, fmt: Fmt, name?: string | null, piece: Piece };
type NewToken = NewChar | { end: true, piece: Piece, ch?: undefined, name?: undefined };
type MarkerAt = { at: number, xml: string, para: number };
type NewRunChar = { ch: string, fmt: Fmt, from: OldChar | null, like: OldChar | null, item: Run | null, set: Fmt, key: string };
const FMT_KEYS: ('b' | 'i' | 'u')[] = ['b', 'i', 'u'];

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[\s\S]*?>|<(\/?)([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|[^<]+/y;

// The tokens of xml from `from` to `to`: { type: open|close|empty|text|comment|pi|cdata|doctype, name, attrs, start, end }.
function* tokenize(xml, from = 0, to = xml.length): Generator<Token> {
  TOKEN.lastIndex = from;
  while (TOKEN.lastIndex < to) {
    const start = TOKEN.lastIndex;
    const m = TOKEN.exec(xml);
    if (!m || m.index !== start) throw new Error('the document XML is damaged near character ' + start);
    const end = TOKEN.lastIndex;
    const s = m[0];
    if (m[2] !== undefined) {
      yield { type: m[1] ? 'close' : m[4] ? 'empty' : 'open', name: m[2], attrs: m[3] || '', start, end };
    } else if (s.startsWith('<!--')) yield { type: 'comment', start, end };
    else if (s.startsWith('<?')) yield { type: 'pi', start, end };
    else if (s.startsWith('<![CDATA[')) yield { type: 'cdata', start, end };
    else if (s.startsWith('<!')) yield { type: 'doctype', start, end };
    else yield { type: 'text', start, end };
  }
}

// The element tree of xml from `from` to `to` (which must be balanced): nodes { name, attrs, start, end, openEnd,
// closeStart, children } for elements, { type, start, end } for anything else.
function parseNodes(xml, from, to): XmlNode[] {
  const root: XmlElement = { name: '', attrs: '', start: 0, openEnd: 0, closeStart: 0, end: 0, children: [] };
  const stack = [root];
  for (const t of tokenize(xml, from, to)) {
    const parent = stack[stack.length - 1];
    if (t.type === 'open') {
      const node: XmlElement = { name: t.name, attrs: t.attrs, start: t.start, openEnd: t.end, closeStart: t.end, end: t.end, children: [] };
      parent.children.push(node);
      stack.push(node);
    } else if (t.type === 'close') {
      const node = stack.pop();
      if (!node || node === root || node.name !== t.name) throw new Error('the document XML is damaged near character ' + t.start);
      node.closeStart = t.start;
      node.end = t.end;
    } else if (t.type === 'empty') {
      parent.children.push({ name: t.name, attrs: t.attrs, start: t.start, openEnd: t.end, closeStart: t.end, end: t.end, children: [], empty: true });
    } else if (t.type === 'text' || t.type === 'comment' || t.type === 'pi' || t.type === 'cdata' || t.type === 'doctype') parent.children.push(t);
  }
  if (stack.length !== 1) throw new Error('the document XML is damaged (an element is not closed)');
  return root.children;
}

// Throws unless xml (a whole part, or a run of elements) is balanced and readable.
function assertWellFormed(xml) {
  parseNodes(xml, 0, xml.length);
}

const ENTITY = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g;
const NAMED = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
// Text is handled in UTF-16 code units everywhere (here, in the diff and on the page), so a character outside the
// Basic Multilingual Plane (an emoji) counts as two, the same on every side.
function decodeText(s) {
  return s.replace(ENTITY, (e) => {
    if (NAMED[e]) return NAMED[e];
    const code = e[2] === 'x' ? parseInt(e.slice(3, -1), 16) : parseInt(e.slice(2, -1), 10);
    return code <= 0x10FFFF ? String.fromCodePoint(code) : e; // not a character: kept as written, so it never matches
  });
}
// Characters XML cannot hold are dropped, and so is a carriage return (a reader would turn it into a line feed);
// & and < (and > for safety) are escaped.
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000D\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function escapeText(s) {
  return s.replace(NOT_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attr(attrs, qname) {
  const m = new RegExp('\\s' + qname.replace(/[.:]/g, '\\$&') + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')').exec(attrs);
  return m ? decodeText(m[1] !== undefined ? m[1] : m[2]) : null;
}
const isOn = (v) => v === null || !/^(0|false|off)$/i.test(v);

// The prefix the main WordprocessingML namespace has on the root element ('w' in practice), or null.
function mainPrefix(xml) {
  for (const t of tokenize(xml)) {
    if (t.type !== 'open' && t.type !== 'empty') continue;
    const m = /\sxmlns:([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = m.exec(t.attrs))) if ((a[2] !== undefined ? a[2] : a[3]) === W_MAIN) return a[1];
    return null;
  }
  return null;
}

// ---- Which paragraphs can be edited ----------------------------------------------------------------------

// Why a paragraph holding this element is read-only, by the element's local name.
const REASONS = {
  ins: 'tracked changes', del: 'tracked changes', moveFrom: 'tracked changes', moveTo: 'tracked changes',
  pPrChange: 'tracked changes', rPrChange: 'tracked changes', hyperlink: 'a link', fldSimple: 'a field',
  fldChar: 'a field', instrText: 'a field', drawing: 'a picture', pict: 'a picture', object: 'an object',
  sdt: 'a content control', smartTag: 'tagged text', customXml: 'tagged text', oMath: 'an equation',
  oMathPara: 'an equation', footnoteReference: 'a footnote', endnoteReference: 'an endnote',
  commentReference: 'a comment', annotationRef: 'a comment', sym: 'a symbol', vanish: 'hidden text',
  specVanish: 'hidden text', ruby: 'ruby text', ptab: 'a positioned tab',
};
const local = (name) => name.slice(name.indexOf(':') + 1);
const reasonFor = (name) => REASONS[local(name)] || 'content Notes cannot edit safely';
// Containers a paragraph may sit in and still be edited: the body, and table cells.
const PLACES = new Set(['document', 'body', 'tbl', 'tr', 'tc']);

class ReadOnly extends Error {}
const readOnly: (why: string) => never = (why) => { throw new ReadOnly(why); };

// The run properties, checked: hidden text or tracked formatting make the paragraph read-only.
function checkRPr(node, W) {
  for (const c of node.children) {
    if (!c.name) continue;
    const n = local(c.name);
    if (c.name.startsWith(W + ':') && (n === 'vanish' || n === 'specVanish' || n === 'rPrChange' || n === 'ins' || n === 'del' || n === 'moveFrom' || n === 'moveTo' || n === 'webHidden')) readOnly(reasonFor(c.name));
  }
}

// What a plain break element (no attribute but its type) stands for in the text: '\n' for a line break, '\f' for a
// page break, or null for any other (a column break, or one with other attributes).
const PAGE_BREAK = '\f';
function breakChar(attrs, W) {
  const m = new RegExp('^\\s*(?:' + W + ':type\\s*=\\s*"(textWrapping|page)"\\s*)?$').exec(attrs);
  return m ? (m[1] === 'page' ? PAGE_BREAK : '\n') : null;
}

// A picture: one object replacement character in the text, written back as its <w:drawing> exactly as it was.
// Only pictures (not charts, shapes or text boxes, which hold content of their own) are taken.
const PICTURE = '\uFFFC';
// A no-break space, as the browser writes some typed spaces.
const NBSP = '\u00A0';
// Whether text shown on the page is the file's text: the same, but for spaces the browser shows as no-break spaces.
function sameShownText(fileText, shownText) {
  if (fileText.length !== shownText.length) return false;
  for (let k = 0; k < fileText.length; k++) if (fileText[k] !== shownText[k] && !(fileText[k] === ' ' && shownText[k] === NBSP)) return false;
  return true;
}
const PICTURE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
function isPicture(drawingXml) {
  return drawingXml.includes('uri="' + PICTURE_URI + '"') && !/<[\w.-]+:(?:txbxContent|p|tbl)[\s/>]/.test(drawingXml)
    && (drawingXml.match(/<[\w.-]+:graphicData\b/g) || []).length === 1;
}

// A run: { kind: 'run', rPr (its XML, or ''), xml, text, pageBreaks, pictures }, tabs as '\t', line breaks as '\n',
// page breaks as '\f' and pictures as '\uFFFC' (characters a document cannot hold as text). pageBreaks:
// [{ start, end, rPr }], where each page break element is in xml, for the display copy. pictures: the XML of each
// picture's <w:drawing>, in order.
function readRun(xml, node: XmlElement, W): Run {
  let rPr = '', text = '';
  const pageBreaks: PageBreak[] = [];
  const pictures: string[] = [];
  for (const c of node.children) {
    if (!c.name) {
      if (c.type === 'text' && !xml.slice(c.start, c.end).trim()) continue;
      readOnly('content Notes cannot edit safely');
    }
    if (!c.name.startsWith(W + ':')) readOnly(reasonFor(c.name));
    const n = local(c.name);
    if (n === 'rPr') {
      if (rPr || text) readOnly('content Notes cannot edit safely');
      checkRPr(c, W);
      rPr = xml.slice(c.start, c.end);
    } else if (n === 't') {
      for (const t of c.children) {
        if (t.type !== 'text') readOnly('content Notes cannot edit safely');
        text += decodeText(xml.slice(t.start, t.end));
      }
    } else if (n === 'tab' && c.empty) text += '\t';
    else if (n === 'br' && c.empty && breakChar(c.attrs, W)) {
      const ch = breakChar(c.attrs, W);
      text += ch;
      if (ch === PAGE_BREAK) pageBreaks.push({ start: c.start, end: c.end, rPr });
    } else if (n === 'drawing' && isPicture(xml.slice(c.start, c.end))) {
      text += PICTURE;
      pictures.push(xml.slice(c.start, c.end));
    } else if (n === 'lastRenderedPageBreak') continue;
    else readOnly(n === 'br' ? 'a column break' : n === 'drawing' ? 'a chart, shape or text box' : reasonFor(c.name));
  }
  return { kind: 'run', rPr, xml: xml.slice(node.start, node.end), text, pageBreaks, pictures };
}

// The editable model of the paragraph node, or throws ReadOnly.
function readParagraph(xml, node: XmlElement, W): ParagraphModel {
  const p: ParagraphModel = { pPr: null, pPrNoSect: null, hasSect: false, markRPr: '', items: [], pageBreaks: [], contentStart: node.openEnd };
  for (const c of node.children) {
    if (!c.name) {
      if (c.type === 'text' && !xml.slice(c.start, c.end).trim()) continue;
      readOnly('content Notes cannot edit safely');
    }
    if (!c.name.startsWith(W + ':')) readOnly(reasonFor(c.name));
    const n = local(c.name);
    if (n === 'pPr') {
      if (p.pPr !== null || p.items.length) readOnly('content Notes cannot edit safely');
      p.pPr = xml.slice(c.start, c.end);
      p.pPrNoSect = p.pPr;
      p.contentStart = c.end;
      for (const k of c.children) {
        if (!k.name) continue;
        const kn = local(k.name);
        if (kn === 'pPrChange') readOnly('tracked changes');
        if (kn === 'rPr') { checkRPr(k, W); p.markRPr = xml.slice(k.start, k.end); }
        if (kn === 'sectPr') {
          p.hasSect = true;
          p.pPrNoSect = xml.slice(c.start, k.start) + xml.slice(k.end, c.end);
        }
      }
    } else if (n === 'r') {
      const run = readRun(xml, c, W);
      p.items.push(run);
      p.pageBreaks.push(...run.pageBreaks);
    }
    else if (n === 'proofErr') continue; // a spelling mark Word recomputes
    else if (n === 'bookmarkStart' || n === 'bookmarkEnd' || n === 'commentRangeStart' || n === 'commentRangeEnd') p.items.push({ kind: 'marker', xml: xml.slice(c.start, c.end) });
    else readOnly(reasonFor(c.name));
  }
  return p;
}

/* All paragraphs of the document part, in order:
   { index, start, end, editable, reason, parentStart, openTag, selfClosing, pPr, pPrNoSect, hasSect, markRPr,
     items, pageBreaks, text, chain }
   items: runs and markers (see readRun); text: the runs' text joined. chain: paragraphs with the same chain number
   are siblings next to each other with no section break, so text may move between them (joining or splitting).
   Returns { prefix, paragraphs } (prefix null when the part is not WordprocessingML). */
function scanDocument(xml) {
  const W = mainPrefix(xml);
  if (!W) return { prefix: null, paragraphs: [] };
  const P = W + ':p';
  const paragraphs: ScannedParagraph[] = [];
  const stack: { name: string, start: number }[] = [];
  const openParas: ScannedParagraph[] = [];
  for (const t of tokenize(xml)) {
    if (t.type === 'doctype') throw new Error('the document XML declares a DTD, which Word documents never do');
    if (t.type === 'open' || t.type === 'empty') {
      if (t.name === P) {
        const placeOk = stack.every((s) => s.name.startsWith(W + ':') && PLACES.has(local(s.name)));
        const para: ScannedParagraph = { start: t.start, openEnd: t.end, placeOk, parentStart: stack.length ? stack[stack.length - 1].start : -1, selfClosing: t.type === 'empty' };
        paragraphs.push(para);
        if (t.type === 'empty') para.end = t.end;
        else openParas.push(para);
      }
      if (t.type === 'open') stack.push({ name: t.name, start: t.start });
    } else if (t.type === 'close') {
      const top = stack.pop();
      if (!top || top.name !== t.name) throw new Error('the document XML is damaged near character ' + t.start);
      if (t.name === P) { const open = openParas.pop(); if (open) open.end = t.end; }
    }
  }
  if (stack.length) throw new Error('the document XML is damaged (an element is not closed)');

  const finished: Paragraph[] = paragraphs.map((para, index): Paragraph => {
    if (para.end === undefined) throw new Error('the document XML is damaged (a paragraph is not closed)');
    const place = { index, start: para.start, openEnd: para.openEnd, end: para.end, parentStart: para.parentStart, selfClosing: para.selfClosing,
      openTag: para.selfClosing ? '<' + P + '>' : xml.slice(para.start, para.openEnd), chain: 0 };
    let model: ParagraphModel;
    try {
      if (!para.placeOk) readOnly('a text box or content control');
      if (para.selfClosing) model = { pPr: null, pPrNoSect: null, hasSect: false, markRPr: '', items: [], pageBreaks: [], contentStart: para.end };
      else {
        const node = parseNodes(xml, para.start, para.end)[0];
        if (!node || !node.name) throw new Error('the paragraph element could not be read');
        model = readParagraph(xml, node, W);
      }
    } catch (err) {
      if (!(err instanceof ReadOnly)) throw err;
      return { ...place, editable: false, reason: err.message };
    }
    const text = model.items.map((it) => (it.kind === 'run' ? it.text : '')).join('');
    return { ...place, ...model, editable: true, reason: '', text };
  });
  // Chains of paragraphs text may move between.
  let chain = 0;
  finished.forEach((para, i) => {
    const prev = finished[i - 1];
    const joins = prev && prev.editable && para.editable && !prev.hasSect && !para.hasSect
      && prev.parentStart === para.parentStart && !xml.slice(prev.end, para.start).trim();
    if (!joins) chain++;
    para.chain = chain;
  });
  return { prefix: W, paragraphs: finished };
}

// Document-wide reasons not to edit: settings.xml (tracked changes on, or editing restricted), or null when none.
function settingsBlock(settingsXml) {
  if (!settingsXml) return null;
  for (const t of tokenize(settingsXml)) {
    if (t.type !== 'open' && t.type !== 'empty') continue;
    const n = local(t.name);
    const prefix = t.name.slice(0, t.name.indexOf(':'));
    if (n === 'trackRevisions' && isOn(attr(t.attrs, prefix + ':val'))) return 'Track Changes is on in this document, and Notes cannot record tracked changes';
    if (n === 'documentProtection' && isOn(attr(t.attrs, prefix + ':enforcement') || '0') && (attr(t.attrs, prefix + ':edit') || 'none') !== 'none') return 'this document is protected against editing';
  }
  return null;
}

// ---- Writing changed paragraphs back ---------------------------------------------------------------------------

// The order of run properties the schema requires (CT_RPr); an unknown one sorts last.
const RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss',
  'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u',
  'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];
const rprRank = (name, W) => (name.startsWith(W + ':') && RPR_ORDER.includes(local(name)) ? RPR_ORDER.indexOf(local(name)) : RPR_ORDER.length);

// rPr (XML, or '') with bold, italic or underline set on or off as in `set` ({ b, i, u }: true/false/undefined).
function withFormatting(rPr, set, W) {
  const want: (string[])[] = [];
  if (set.b !== undefined) want.push(['b', set.b ? '<' + W + ':b/>' : '<' + W + ':b ' + W + ':val="0"/>']);
  if (set.i !== undefined) want.push(['i', set.i ? '<' + W + ':i/>' : '<' + W + ':i ' + W + ':val="0"/>']);
  if (set.u !== undefined) want.push(['u', '<' + W + ':u ' + W + ':val="' + (set.u ? 'single' : 'none') + '"/>']);
  if (!want.length) return rPr;
  let open = '<' + W + ':rPr>', close = '</' + W + ':rPr>';
  let kids: { name: string, xml: string }[] = [];
  if (rPr) {
    const node = parseNodes(rPr, 0, rPr.length)[0];
    if (!node || !node.name) throw new Error('the run properties could not be read');
    if (node.empty) open = rPr.replace(/\/>$/, '>');
    else {
      open = rPr.slice(0, node.openEnd - node.start);
      kids = node.children.flatMap((c) => (c.name ? [{ name: c.name, xml: rPr.slice(c.start, c.end) }] : []));
    }
  }
  for (const [n, xml] of want) {
    kids = kids.filter((k) => k.name !== W + ':' + n);
    const rank = RPR_ORDER.indexOf(n);
    const at = kids.findIndex((k) => rprRank(k.name, W) > rank);
    kids.splice(at < 0 ? kids.length : at, 0, { name: W + ':' + n, xml });
  }
  return open + kids.map((k) => k.xml).join('') + close;
}

// The XML of a run with this text, tabs, line breaks, page breaks and pictures as their own elements. pictures: the
// <w:drawing> XML for each picture character, in order.
function runXml(rPr, text, W, pictures: (string | null)[] = []) {
  let out = '<' + W + ':r>' + rPr;
  let pic = 0;
  for (const part of text.split(/([\t\n\f\uFFFC])/)) {
    if (part === '\t') out += '<' + W + ':tab/>';
    else if (part === '\n') out += '<' + W + ':br/>';
    else if (part === PAGE_BREAK) out += '<' + W + ':br ' + W + ':type="page"/>';
    else if (part === PICTURE) {
      if (typeof pictures[pic] !== 'string') throw new Error('a picture could not be placed');
      out += pictures[pic++];
    }
    else if (part) out += '<' + W + ':t xml:space="preserve">' + escapeText(part) + '</' + W + ':t>';
  }
  return out + '</' + W + ':r>';
}

// The ids that must stay unique to one paragraph, dropped from the copies a split makes (Word assigns new ones).
const stripIds = (openTag) => openTag.replace(/\s+[\w.-]+:(?:paraId|textId)\s*=\s*(?:"[^"]*"|'[^']*')/g, '');

/* Myers' diff of two token lists: for each token of b, the index of the token of a it keeps, or -1 when inserted.
   eq(x, y) compares tokens. Beyond `limit` differences it gives up and keeps only the common start and end. */
function matchTokens(a, b, eq, limit = 2000) {
  const out = new Array(b.length).fill(-1);
  let s = 0;
  while (s < a.length && s < b.length && eq(a[s], b[s])) { out[s] = s; s++; }
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && eq(a[ea - 1], b[eb - 1])) { ea--; eb--; out[eb] = ea; }
  const n = ea - s, m = eb - s;
  if (!n || !m) return out;
  const max = Math.min(n + m, limit);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2)); // diagonals -d-1 .. d+1
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && eq(a[s + x], b[s + y])) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  if (found < 0) return out; // too different: the middle counts as replaced
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const band = trace[d], at = (k) => band[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const px = at(prevK), py = px - prevK;
    while (x > px && y > py) { x--; y--; out[s + y] = s + x; }
    x = px; y = py;
  }
  while (x > 0 && y > 0) { x--; y--; out[s + y] = s + x; }
  return out;
}

const fmtKey = (f) => (f.b ? 'b' : '') + (f.i ? 'i' : '') + (f.u ? 'u' : '');

/* The XML that replaces paragraphs first..last (indices into scan.paragraphs, one chain) given what is now shown:
   pieces: [{ source: paragraph index, chars: [{ ch, fmt: { b, i, u }, picture }] }] in order, each becoming one
   paragraph; picture: which picture a picture character is (named as in baselines).
   baselines: paragraph index -> { chars: [fmt per char of its text], pictures: [name per char, for pictures],
   empty: fmt } as first shown. A picture is kept only where it has the same name; it is never added.
   A paragraph that came through unchanged is copied as it was; so is each untouched run of a changed one. */
function rewriteParagraphs(xml, scan: Scan, first, last, pieces: Piece[], baselines: Map<number, Baseline>) {
  const W = scan.prefix;
  const paras: EditableParagraph[] = [];
  for (const p of scan.paragraphs.slice(first, last + 1)) {
    if (!p.editable || p.chain !== scan.paragraphs[first].chain) throw new Error('those paragraphs cannot be changed together');
    paras.push(p);
  }
  if (pieces.some((pc) => pc.source < first || pc.source > last)) throw new Error('a paragraph came from outside the change');

  // Old tokens: each paragraph's characters (with the run they are in), then a paragraph end.
  const old: OldToken[] = [];
  const markerAt: MarkerAt[] = []; // [{ at: old token index the marker sat before, xml, para }]
  const firstToken = new Map(); // paragraph index -> index of its first old token
  for (const p of paras) {
    let pos = 0;
    firstToken.set(p.index, old.length);
    const baseline = baselines.get(p.index);
    const names = (baseline && baseline.pictures) || [];
    for (const it of p.items) {
      if (it.kind === 'marker') { markerAt.push({ at: old.length, xml: it.xml, para: p.index }); continue; }
      let pic = 0;
      for (let c = 0; c < it.text.length; c++) {
        const t: OldChar = { ch: it.text[c], para: p.index, pos, item: it, first: c === 0, last: c === it.text.length - 1 };
        if (t.ch === PICTURE) { t.picture = it.pictures[pic++]; t.name = names[pos]; }
        old.push(t);
        pos++;
      }
    }
    old.push({ end: true, para: p.index });
  }
  const neu: NewToken[] = [];
  for (const pc of pieces) {
    for (const c of pc.chars) neu.push({ ch: c.ch, fmt: c.fmt, name: c.picture, piece: pc });
    neu.push({ end: true, piece: pc });
  }
  // The browser shows a space it would otherwise collapse (after a picture, at a line's end) as a no-break space; a
  // no-break space shown where the file has a space is that space.
  const same = (x: OldChar, y: NewChar) => (x.ch === y.ch || (x.ch === ' ' && y.ch === NBSP)) && (x.ch !== PICTURE || (x.name != null && x.name === y.name));
  const keep = matchTokens(old, neu, (x, y) => (x.end ? !!y.end : !y.end && same(x, y)));
  // Pictures are matched by name even where the diff gave up (too many changes): names are unique, and pictures
  // cannot change order on the page, so this keeps the matches in order.
  const used = new Set(keep.filter((o) => o >= 0));
  const oldPicture = new Map();
  old.forEach((t, o) => { if (!t.end && t.ch === PICTURE && t.name != null && !used.has(o)) oldPicture.set(t.name, o); });
  neu.forEach((t, j) => {
    if (keep[j] >= 0 || t.end || t.ch !== PICTURE || t.name == null) return;
    const o = oldPicture.get(t.name);
    if (o === undefined) return;
    keep[j] = o;
    oldPicture.delete(t.name);
  });

  // Where each old token went in the new list (for the markers).
  const newIndexOf = new Array(old.length + 1).fill(-1);
  keep.forEach((o, j) => { if (o >= 0) newIndexOf[o] = j; });
  newIndexOf[old.length] = neu.length - 1;
  for (let o = old.length - 1; o >= 0; o--) if (newIndexOf[o] < 0) newIndexOf[o] = newIndexOf[o + 1];
  const markersBefore: Map<number, MarkerAt[]> = new Map(); // new token index -> [xml]
  for (const m of markerAt) {
    const j = newIndexOf[m.at];
    const before = markersBefore.get(j) || [];
    before.push(m);
    markersBefore.set(j, before);
  }

  const count = new Map();
  for (const pc of pieces) count.set(pc.source, (count.get(pc.source) || 0) + 1);
  const seen = new Map();
  let out = '';
  let j = 0;
  for (const pc of pieces) {
    const src = paras[pc.source - first];
    const nth = (seen.get(pc.source) || 0) + 1;
    seen.set(pc.source, nth);
    const base = baselines.get(pc.source) || { chars: [], empty: {} };
    const startJ = j;
    // Each new character: the run it takes its properties from, and bold/italic/underline set where they changed.
    const chars: NewRunChar[] = [];
    for (let k = 0; k < pc.chars.length; k++, j++) {
      const o = keep[j];
      const cand = o >= 0 ? old[o] : null;
      const t = cand && !cand.end ? cand : null;
      const n = neu[j];
      // A kept character is written as the file has it; a typed no-break space is a space (Notes has no way to type
      // a real one: the browser makes them).
      if (n.end) throw new Error('a piece ended before its characters');
      chars.push({ ch: t ? t.ch : n.ch === NBSP ? ' ' : n.ch, fmt: n.fmt, from: t, like: null, item: null, set: {}, key: '' });
    }
    const endJ = j++; // the piece's end token
    // An added character takes the run (and the formatting as first shown) of the kept one before it, else after it.
    for (let k = 0; k < chars.length; k++) {
      if (chars[k].from) continue;
      let near: OldChar | null = null;
      for (let q = k - 1; q >= 0 && !near; q--) near = chars[q].from;
      for (let q = k + 1; q < chars.length && !near; q++) near = chars[q].from;
      chars[k].like = near;
    }
    const baseFmt = (t: OldChar | null): Fmt => (t ? ((baselines.get(t.para) || { chars: [] }).chars[t.pos] || {}) : base.empty);
    for (const c of chars) {
      const ref = c.from || c.like;
      const was = baseFmt(ref);
      const set: Fmt = {};
      for (const f of FMT_KEYS) if (!!c.fmt[f] !== !!was[f]) set[f] = !!c.fmt[f];
      c.item = ref ? ref.item : null;
      c.set = set;
      c.key = fmtKey({ b: set.b === true, i: set.i === true, u: set.u === true }) + '|' + fmtKey({ b: set.b === false, i: set.i === false, u: set.u === false });
    }

    // Unchanged: the only piece of its paragraph, every character kept in order with nothing set, and the same
    // markers at the same places.
    const oldOfSrc = old.filter((t) => !t.end && t.para === pc.source);
    const markersHere: MarkerAt[] = [];
    for (let q = startJ; q <= endJ; q++) for (const m of markersBefore.get(q) || []) markersHere.push(m);
    const unchanged = count.get(pc.source) === 1 && chars.length === oldOfSrc.length
      && chars.every((c, k) => c.from === oldOfSrc[k] && !Object.keys(c.set).length)
      && markersHere.length === markerAt.filter((m) => m.para === pc.source).length
      && markersHere.every((m) => m.para === pc.source && newIndexOf[m.at] - startJ === m.at - (firstToken.get(pc.source) ?? 0));
    if (unchanged) { out += xml.slice(src.start, src.end); continue; }

    const openTag = nth === 1 ? src.openTag : stripIds(src.openTag);
    const pPr = src.hasSect && nth !== count.get(pc.source) ? src.pPrNoSect : src.pPr;
    let body = '';
    let k = 0;
    const flushMarkers = (q) => { for (const m of markersBefore.get(q) || []) body += m.xml; };
    while (k < chars.length) {
      flushMarkers(startJ + k);
      // A stretch with the same source run and the same changes, not crossing a marker.
      let e = k + 1;
      while (e < chars.length && chars[e].item === chars[k].item && chars[e].key === chars[k].key && !markersBefore.has(startJ + e)) e++;
      const span = chars.slice(k, e);
      const it = span[0].item;
      const head = span[0].from;
      const whole = it && head && head.first && !Object.keys(span[0].set).length && span.length === it.text.length
        && span.every((c, q) => c.from && c.from.item === it && c.from.pos - head.pos === q);
      if (whole) body += it.xml;
      else {
        const rPr = withFormatting(it ? it.rPr : src.markRPr, span[0].set, W);
        body += runXml(rPr, span.map((c) => c.ch).join(''), W, span.filter((c) => c.ch === PICTURE).map((c) => (c.from && c.from.picture) || null));
      }
      k = e;
    }
    flushMarkers(endJ);
    out += openTag + (pPr || '') + body + '</' + W + ':p>';
  }
  return out;
}

/* A copy of xml for display only, with an empty bookmark named `${MARK}<index>` at the start of each editable
   paragraph, so the shown paragraph can be found again (docx-preview shows a bookmark as <span id=name>).
   docx-preview starts a new page at a paragraph's first page break and shows the rest of the paragraph there as a
   paragraph of its own, unless the break is the last thing in it. Where it will, a second bookmark
   `${BREAK_MARK}<index>` right after the break marks where that rest begins. The break gets a run of its own there:
   docx-preview moves the whole run holding a break to the next page, text before the break included. */
const MARK = '_notesP';
const BREAK_MARK = '_notesB';
const bookmark = (W, id, name) => '<' + W + ':bookmarkStart ' + W + ':id="' + id + '" ' + W + ':name="' + name + '"/>';
// Whether the paragraph's first page break is the last thing docx-preview sees in it (it skips spelling marks).
function breakIsLast(xml, p, W) {
  const e = (name) => W.replace(/\./g, '\\.') + ':' + name;
  return new RegExp('^\\s*</' + e('r') + '>(?:\\s*<' + e('proofErr') + '\\b[^>]*/>)*\\s*</' + e('p') + '>$').test(xml.slice(p.pageBreaks[0].end, p.end));
}
function markForDisplay(xml, scan) {
  const W = scan.prefix;
  let out = xml;
  for (const p of [...scan.paragraphs].reverse()) {
    if (!p.editable) continue;
    if (p.pageBreaks.length && !breakIsLast(xml, p, W)) {
      const { start, end, rPr } = p.pageBreaks[0];
      const cut = (between) => '</' + W + ':r>' + between + '<' + W + ':r>' + rPr;
      out = out.slice(0, start) + cut('') + out.slice(start, end) + cut(bookmark(W, 910000000 + p.index, BREAK_MARK + p.index)) + out.slice(end);
    }
    const mark = bookmark(W, 900000000 + p.index, MARK + p.index);
    out = p.selfClosing
      ? out.slice(0, p.start) + '<' + W + ':p>' + mark + '</' + W + ':p>' + out.slice(p.end)
      : out.slice(0, p.contentStart) + mark + out.slice(p.contentStart);
  }
  return out;
}

// Throws unless each patch replaces whole editable paragraphs of one chain (first..last) with paragraphs only.
function checkPatches(xml, scan, patches) {
  if (!Array.isArray(patches) || !patches.length) throw new Error('there was no change to save');
  const W = scan.prefix;
  const byStart = new Map(scan.paragraphs.map((p) => [p.start, p]));
  for (const p of patches) {
    const first = p && byStart.get(p.start);
    const last = first && scan.paragraphs.find((q) => q.end === p.end && q.index >= first.index);
    if (!first || !last) throw new Error('a change does not cover whole paragraphs');
    for (let i = first.index; i <= last.index; i++) {
      const q = scan.paragraphs[i];
      if (!q.editable || q.chain !== first.chain) throw new Error('a change covers a paragraph that cannot be edited');
    }
    if (typeof p.xml !== 'string') throw new Error('a change is missing its text');
    const nodes = parseNodes(p.xml, 0, p.xml.length);
    if (!nodes.length || nodes.some((n) => n.name !== W + ':p')) throw new Error('a change holds something other than paragraphs');
    // Each new paragraph must itself be one Notes could edit, with the properties of a paragraph it replaces.
    // Pictures can be kept or removed, never added or changed: each one written must be one of the replaced
    // paragraphs' pictures, byte for byte, and each of those is used at most once.
    const props: Set<string | null> = new Set([null]);
    const pictures = new Map();
    const picturesOf = (model) => model.items.flatMap((it) => it.pictures || []);
    for (let i = first.index; i <= last.index; i++) {
      const q = scan.paragraphs[i];
      props.add(q.pPr);
      props.add(q.pPrNoSect);
      for (const x of picturesOf(q)) pictures.set(x, (pictures.get(x) || 0) + 1);
    }
    for (const n of nodes) {
      if (!n.name) throw new Error('a change holds content Notes cannot edit safely');
      let model: { pPr: string | null, items: Item[] };
      try { model = n.empty ? { pPr: null, items: [] } : readParagraph(p.xml, n, W); } catch (err) {
        if (err instanceof ReadOnly) throw new Error('a change holds ' + err.message);
        throw err;
      }
      if (!props.has(model.pPr)) throw new Error('a change alters paragraph properties');
      for (const x of picturesOf(model)) {
        if (!pictures.get(x)) throw new Error('a change adds or alters a picture');
        pictures.set(x, pictures.get(x) - 1);
      }
    }
  }
}

// Keeps editing within what the page could show: paragraphs where usable(index) is false become read-only, and
// chains are cut around them, so a save never spans a paragraph that is not on the page as the file has it.
function limitTo(scan, usable) {
  const was = scan.paragraphs.map((p) => p.chain);
  let chain = 0;
  scan.paragraphs.forEach((p, i) => {
    if (p.editable && !usable(i)) { p.editable = false; p.reason = 'shown differently than the file holds it'; }
    const prev = scan.paragraphs[i - 1];
    if (!(prev && prev.editable && p.editable && was[i - 1] === was[i])) chain++;
    p.chain = chain;
  });
  return scan;
}

// Applies patches [{ start, end, old, xml }] (ranges of the part, old being exactly what is there) to xml.
function applyPatches(xml, patches) {
  const sorted = [...patches].sort((a, b) => b.start - a.start);
  let out = xml;
  let limit = xml.length;
  for (const p of sorted) {
    if (!Number.isInteger(p.start) || !Number.isInteger(p.end) || p.start < 0 || p.end > limit || p.start > p.end) throw new Error('a change does not fit the document');
    if (typeof p.old !== 'string' || xml.slice(p.start, p.end) !== p.old) throw new Error('the document is not the version the change was made for');
    if (typeof p.xml !== 'string') throw new Error('a change is missing its text');
    out = out.slice(0, p.start) + p.xml + out.slice(p.end);
    limit = p.start;
  }
  return out;
}

export { MARK, BREAK_MARK, PAGE_BREAK, PICTURE, sameShownText, limitTo, tokenize, parseNodes, assertWellFormed, decodeText, escapeText, mainPrefix, scanDocument, settingsBlock, withFormatting, runXml, matchTokens, rewriteParagraphs, markForDisplay, checkPatches, applyPatches };
