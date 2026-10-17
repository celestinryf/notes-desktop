'use strict';
/* Format-safe editing of a Word document's main part (word/document.xml), as text. No DOM: the renderer (bundled into
   docx.bundle.js) and main's save worker both use it.

   The document is scanned for its paragraphs. A paragraph is editable only when everything in it can be written back
   exactly: plain runs of text (with tabs and line breaks), bookmarks and comment ranges. Anything else (tracked
   changes, fields, links, pictures, content controls, hidden text...) makes it read-only. Saving replaces only the
   paragraphs that changed, as spliced text: every other byte of the part stays as it was, and inside a changed
   paragraph every run whose text and formatting were not touched is copied as it was. */

const W_MAIN = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ---- Reading the XML ------------------------------------------------------------------------------------

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[\s\S]*?>|<(\/?)([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|[^<]+/y;

// The tokens of xml from `from` to `to`: { type: open|close|empty|text|comment|pi|cdata|doctype, name, attrs, start, end }.
function* tokenize(xml, from = 0, to = xml.length) {
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
function parseNodes(xml, from, to) {
  const root = { children: [] };
  const stack = [root];
  for (const t of tokenize(xml, from, to)) {
    const parent = stack[stack.length - 1];
    if (t.type === 'open') {
      const node = { name: t.name, attrs: t.attrs, start: t.start, openEnd: t.end, children: [] };
      parent.children.push(node);
      stack.push(node);
    } else if (t.type === 'close') {
      const node = stack.pop();
      if (node === root || node.name !== t.name) throw new Error('the document XML is damaged near character ' + t.start);
      node.closeStart = t.start;
      node.end = t.end;
    } else if (t.type === 'empty') {
      parent.children.push({ name: t.name, attrs: t.attrs, start: t.start, openEnd: t.end, closeStart: t.end, end: t.end, children: [], empty: true });
    } else parent.children.push(t);
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
const readOnly = (why) => { throw new ReadOnly(why); };

// The run properties, checked: hidden text or tracked formatting make the paragraph read-only.
function checkRPr(node, W) {
  for (const c of node.children) {
    if (!c.name) continue;
    const n = local(c.name);
    if (c.name.startsWith(W + ':') && (n === 'vanish' || n === 'specVanish' || n === 'rPrChange' || n === 'ins' || n === 'del' || n === 'moveFrom' || n === 'moveTo' || n === 'webHidden')) readOnly(reasonFor(c.name));
  }
}

// A run: { kind: 'run', rPr (its XML, or ''), xml, text }, tabs as '\t' and line breaks as '\n'.
function readRun(xml, node, W) {
  let rPr = '', text = '';
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
    else if (n === 'br' && c.empty && /^\s*$/.test(c.attrs.replace(new RegExp('\\s' + W + ':type\\s*=\\s*"textWrapping"'), ''))) text += '\n';
    else if (n === 'lastRenderedPageBreak') continue;
    else readOnly(n === 'br' ? 'a page or column break' : reasonFor(c.name));
  }
  return { kind: 'run', rPr, xml: xml.slice(node.start, node.end), text };
}

// The editable model of the paragraph node, or throws ReadOnly.
function readParagraph(xml, node, W) {
  const p = { pPr: null, pPrNoSect: null, hasSect: false, markRPr: '', items: [], contentStart: node.openEnd };
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
    } else if (n === 'r') p.items.push(readRun(xml, c, W));
    else if (n === 'proofErr') continue; // a spelling mark Word recomputes
    else if (n === 'bookmarkStart' || n === 'bookmarkEnd' || n === 'commentRangeStart' || n === 'commentRangeEnd') p.items.push({ kind: 'marker', xml: xml.slice(c.start, c.end) });
    else readOnly(reasonFor(c.name));
  }
  return p;
}

/* All paragraphs of the document part, in order:
   { index, start, end, editable, reason, parentStart, openTag, selfClosing, pPr, pPrNoSect, hasSect, markRPr,
     items, text, chain }
   items: runs and markers (see readRun); text: the runs' text joined. chain: paragraphs with the same chain number
   are siblings next to each other with no section break, so text may move between them (joining or splitting).
   Returns { prefix, paragraphs } (prefix null when the part is not WordprocessingML). */
function scanDocument(xml) {
  const W = mainPrefix(xml);
  if (!W) return { prefix: null, paragraphs: [] };
  const P = W + ':p';
  const paragraphs = [];
  const stack = [];
  const openParas = [];
  for (const t of tokenize(xml)) {
    if (t.type === 'doctype') throw new Error('the document XML declares a DTD, which Word documents never do');
    if (t.type === 'open' || t.type === 'empty') {
      if (t.name === P) {
        const placeOk = stack.every((s) => s.name.startsWith(W + ':') && PLACES.has(local(s.name)));
        const para = { start: t.start, openEnd: t.end, placeOk, parentStart: stack.length ? stack[stack.length - 1].start : -1, selfClosing: t.type === 'empty' };
        paragraphs.push(para);
        if (t.type === 'empty') para.end = t.end;
        else openParas.push(para);
      }
      if (t.type === 'open') stack.push({ name: t.name, start: t.start });
    } else if (t.type === 'close') {
      const top = stack.pop();
      if (!top || top.name !== t.name) throw new Error('the document XML is damaged near character ' + t.start);
      if (t.name === P) openParas.pop().end = t.end;
    }
  }
  if (stack.length) throw new Error('the document XML is damaged (an element is not closed)');

  paragraphs.forEach((para, index) => {
    para.index = index;
    para.openTag = para.selfClosing ? '<' + P + '>' : xml.slice(para.start, para.openEnd);
    let model = null;
    try {
      if (!para.placeOk) readOnly('a text box or content control');
      model = para.selfClosing ? { pPr: null, pPrNoSect: null, hasSect: false, markRPr: '', items: [], contentStart: para.end } : readParagraph(xml, parseNodes(xml, para.start, para.end)[0], W);
    } catch (err) {
      if (!(err instanceof ReadOnly)) throw err;
      para.editable = false;
      para.reason = err.message;
    }
    if (model) {
      Object.assign(para, model);
      para.editable = true;
      para.reason = '';
      para.text = model.items.map((it) => (it.kind === 'run' ? it.text : '')).join('');
    }
    delete para.placeOk;
  });
  // Chains of paragraphs text may move between.
  let chain = 0;
  paragraphs.forEach((para, i) => {
    const prev = paragraphs[i - 1];
    const joins = prev && prev.editable && para.editable && !prev.hasSect && !para.hasSect
      && prev.parentStart === para.parentStart && !xml.slice(prev.end, para.start).trim();
    if (!joins) chain++;
    para.chain = chain;
  });
  return { prefix: W, paragraphs };
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
  const want = [];
  if (set.b !== undefined) want.push(['b', set.b ? '<' + W + ':b/>' : '<' + W + ':b ' + W + ':val="0"/>']);
  if (set.i !== undefined) want.push(['i', set.i ? '<' + W + ':i/>' : '<' + W + ':i ' + W + ':val="0"/>']);
  if (set.u !== undefined) want.push(['u', '<' + W + ':u ' + W + ':val="' + (set.u ? 'single' : 'none') + '"/>']);
  if (!want.length) return rPr;
  let open = '<' + W + ':rPr>', close = '</' + W + ':rPr>', kids = [];
  if (rPr) {
    const node = parseNodes(rPr, 0, rPr.length)[0];
    if (node.empty) open = rPr.replace(/\/>$/, '>');
    else {
      open = rPr.slice(0, node.openEnd - node.start);
      kids = node.children.filter((c) => c.name).map((c) => ({ name: c.name, xml: rPr.slice(c.start, c.end) }));
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

// The XML of a run with this text, tabs and line breaks as their own elements.
function runXml(rPr, text, W) {
  let out = '<' + W + ':r>' + rPr;
  for (const part of text.split(/([\t\n])/)) {
    if (part === '\t') out += '<' + W + ':tab/>';
    else if (part === '\n') out += '<' + W + ':br/>';
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
  const trace = [];
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
   pieces: [{ source: paragraph index, chars: [{ ch, fmt: { b, i, u } }] }] in order, each becoming one paragraph.
   baselines: paragraph index -> { chars: [fmt per char of its text], empty: fmt } as first shown.
   A paragraph that came through unchanged is copied as it was; so is each untouched run of a changed one. */
function rewriteParagraphs(xml, scan, first, last, pieces, baselines) {
  const W = scan.prefix;
  const paras = scan.paragraphs.slice(first, last + 1);
  if (paras.some((p) => !p.editable || p.chain !== paras[0].chain)) throw new Error('those paragraphs cannot be changed together');
  if (pieces.some((pc) => pc.source < first || pc.source > last)) throw new Error('a paragraph came from outside the change');

  // Old tokens: each paragraph's characters (with the run they are in), then a paragraph end.
  const old = [];
  const markerAt = []; // [{ at: old token index the marker sat before, xml, para }]
  const firstToken = new Map(); // paragraph index -> index of its first old token
  for (const p of paras) {
    let pos = 0;
    firstToken.set(p.index, old.length);
    for (const it of p.items) {
      if (it.kind === 'marker') { markerAt.push({ at: old.length, xml: it.xml, para: p.index }); continue; }
      for (let c = 0; c < it.text.length; c++) old.push({ ch: it.text[c], para: p.index, pos: pos++, item: it, first: c === 0, last: c === it.text.length - 1 });
    }
    old.push({ end: true, para: p.index });
  }
  const neu = [];
  for (const pc of pieces) {
    for (const c of pc.chars) neu.push({ ch: c.ch, fmt: c.fmt, piece: pc });
    neu.push({ end: true, piece: pc });
  }
  const keep = matchTokens(old, neu, (x, y) => (x.end ? !!y.end : !y.end && x.ch === y.ch));

  // Where each old token went in the new list (for the markers).
  const newIndexOf = new Array(old.length + 1).fill(-1);
  keep.forEach((o, j) => { if (o >= 0) newIndexOf[o] = j; });
  newIndexOf[old.length] = neu.length - 1;
  for (let o = old.length - 1; o >= 0; o--) if (newIndexOf[o] < 0) newIndexOf[o] = newIndexOf[o + 1];
  const markersBefore = new Map(); // new token index -> [xml]
  for (const m of markerAt) {
    const j = newIndexOf[m.at];
    if (!markersBefore.has(j)) markersBefore.set(j, []);
    markersBefore.get(j).push(m);
  }

  const count = new Map();
  for (const pc of pieces) count.set(pc.source, (count.get(pc.source) || 0) + 1);
  const seen = new Map();
  let out = '';
  let j = 0;
  for (const pc of pieces) {
    const src = scan.paragraphs[pc.source];
    const nth = (seen.get(pc.source) || 0) + 1;
    seen.set(pc.source, nth);
    const base = baselines.get(pc.source) || { chars: [], empty: {} };
    const startJ = j;
    // Each new character: the run it takes its properties from, and bold/italic/underline set where they changed.
    const chars = [];
    for (let k = 0; k < pc.chars.length; k++, j++) {
      const o = keep[j];
      const t = o >= 0 ? old[o] : null;
      chars.push({ ch: neu[j].ch, fmt: neu[j].fmt, from: t });
    }
    const endJ = j++; // the piece's end token
    // An added character takes the run (and the formatting as first shown) of the kept one before it, else after it.
    for (let k = 0; k < chars.length; k++) {
      if (chars[k].from) continue;
      let n = null;
      for (let q = k - 1; q >= 0 && !n; q--) if (chars[q].from) n = chars[q].from;
      for (let q = k + 1; q < chars.length && !n; q++) if (chars[q].from) n = chars[q].from;
      chars[k].like = n;
    }
    const baseFmt = (t) => (t ? ((baselines.get(t.para) || { chars: [] }).chars[t.pos] || {}) : base.empty);
    for (const c of chars) {
      const ref = c.from || c.like;
      const was = baseFmt(ref);
      const set = {};
      for (const f of ['b', 'i', 'u']) if (!!c.fmt[f] !== !!was[f]) set[f] = !!c.fmt[f];
      c.item = ref ? ref.item : null;
      c.set = set;
      c.key = fmtKey({ b: set.b === true, i: set.i === true, u: set.u === true }) + '|' + fmtKey({ b: set.b === false, i: set.i === false, u: set.u === false });
    }

    // Unchanged: the only piece of its paragraph, every character kept in order with nothing set, and the same
    // markers at the same places.
    const oldOfSrc = old.filter((t) => !t.end && t.para === pc.source);
    const markersHere = [];
    for (let q = startJ; q <= endJ; q++) for (const m of markersBefore.get(q) || []) markersHere.push(m);
    const unchanged = count.get(pc.source) === 1 && chars.length === oldOfSrc.length
      && chars.every((c, k) => c.from === oldOfSrc[k] && !Object.keys(c.set).length)
      && markersHere.length === markerAt.filter((m) => m.para === pc.source).length
      && markersHere.every((m) => m.para === pc.source && newIndexOf[m.at] - startJ === m.at - firstToken.get(pc.source));
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
      const whole = it && !Object.keys(span[0].set).length && span.length === it.text.length
        && span.every((c, q) => c.from && c.from.item === it && c.from.pos - span[0].from.pos === q) && span[0].from.first;
      if (whole) body += it.xml;
      else {
        const rPr = withFormatting(it ? it.rPr : src.markRPr, span[0].set, W);
        body += runXml(rPr, span.map((c) => c.ch).join(''), W);
      }
      k = e;
    }
    flushMarkers(endJ);
    out += openTag + (pPr || '') + body + '</' + W + ':p>';
  }
  return out;
}

// A copy of xml for display only, with an empty bookmark named `${MARK}<index>` at the start of each editable
// paragraph, so the shown paragraph can be found again (docx-preview shows a bookmark as <span id=name>).
const MARK = '_notesP';
function markForDisplay(xml, scan) {
  const W = scan.prefix;
  let out = xml;
  for (const p of [...scan.paragraphs].reverse()) {
    if (!p.editable) continue;
    const mark = '<' + W + ':bookmarkStart ' + W + ':id="' + (900000000 + p.index) + '" ' + W + ':name="' + MARK + p.index + '"/>';
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
    const props = new Set([null]);
    for (let i = first.index; i <= last.index; i++) { props.add(scan.paragraphs[i].pPr); props.add(scan.paragraphs[i].pPrNoSect); }
    for (const n of nodes) {
      let model;
      try { model = n.empty ? { pPr: null } : readParagraph(p.xml, n, W); } catch (err) {
        if (err instanceof ReadOnly) throw new Error('a change holds ' + err.message);
        throw err;
      }
      if (!props.has(model.pPr)) throw new Error('a change alters paragraph properties');
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

module.exports = { MARK, limitTo, tokenize, parseNodes, assertWellFormed, decodeText, escapeText, mainPrefix, scanDocument, settingsBlock, withFormatting, runXml, matchTokens, rewriteParagraphs, markForDisplay, checkPatches, applyPatches };
