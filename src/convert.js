// @ts-check
'use strict';
/* "Convert to…": writes an opened file out in another format, as a new file next to the original. The original is
   never touched and no existing file is ever overwritten.

   Markdown is the hub. Every source can become Markdown (a .txt is escaped so it reads the same, code goes in a
   fence, a web page goes through turndown, a Word document through mammoth, a PDF gives its text), and every
   target can be made from Markdown. A few direct routes keep more: Word to PDF is printed from the layout Notes
   shows, Word to HTML and text come straight from mammoth, and a web page prints to PDF as itself. */
const fs = require('fs');
const path = require('path');
const { runWorker } = require('./run-worker');
const { extOf, readText, readDocumentBuffer, readDocxText } = require('./files');
const { OOXML_EXT, ZIP_DOC_EXT } = require('./shared/helpers.ts');
const markitdown = require('./markitdown');

const FORMATS = {
  md: 'Markdown (.md)',
  txt: 'Plain text (.txt)',
  html: 'Web page (.html)',
  docx: 'Word document (.docx)',
  pdf: 'PDF (.pdf)',
};
const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdx']);
const HTML_EXT = new Set(['html', 'htm']);
const PROSE_EXT = new Set(['txt', 'text', 'log']);
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const PDF_TIMEOUT_MS = 2 * 60 * 1000;

// What the file is, for conversion: md | txt | code | html | docx | pdf | office, or null when it cannot be converted.
function sourceOf(note) {
  if (!note || !note.filePath) return null;
  if (note.fileKind === 'pdf') return 'pdf';
  // Word's zip formats convert here; an .odt, .rtf or .doc is converted by WordCraft's own Save As instead.
  if (note.fileKind === 'docx') return OOXML_EXT.has(extOf(note.filePath)) ? 'docx' : null;
  // Spreadsheets, and the files Notes cannot show (an e-book, an Outlook message, a zip): their text, read by
  // MarkItDown when it is installed.
  if (note.fileKind === 'sheet' || note.fileKind === 'binary') {
    return markitdown.available() && markitdown.reads(extOf(note.filePath)) ? 'office' : null;
  }
  if (note.fileKind !== 'text') return null;
  const ext = extOf(note.filePath);
  if (MARKDOWN_EXT.has(ext)) return 'md';
  if (HTML_EXT.has(ext)) return 'html';
  return PROSE_EXT.has(ext) ? 'txt' : 'code';
}

const DOCX_KEEPS = 'Keeps headings, lists, bold and italic, links, tables and pictures; fonts, colours, page layout, headers, footers and comments are left out.';
// What each direction loses, said before the person picks it. '' means nothing of note is lost.
const PDF_TEXT_ONLY = 'Text only: the PDF\'s layout, pictures and fonts are left out. A scanned PDF has no text to convert.';
const OFFICE_TEXT = 'The text, headings, lists and tables as MarkItDown reads them; layout, pictures, charts, formulas and formatting are left out.';
const LOSS = {
  md: { txt: 'Formatting marks are removed; a link keeps its address in brackets.', docx: 'Keeps headings, lists, bold and italic, links, code, quotes, tables and pictures on this PC; pictures from the web are left out.', pdf: 'Pictures from the web are left out.' },
  txt: {},
  code: { md: 'The text goes in a code block.', html: 'Shown as monospaced text.', docx: 'Shown as monospaced text.', pdf: 'Shown as monospaced text.', txt: 'The same text, saved as .txt.' },
  html: { md: 'Keeps the page\'s text, headings, lists, links, tables and pictures; its styling and scripts are left out.', txt: 'Text only.', docx: 'Keeps the page\'s text, headings, lists, links and tables; its styling, scripts and pictures from the web are left out.', pdf: 'Scripts do not run and pictures from the web are left out.' },
  docx: { md: DOCX_KEEPS.replace('pictures;', 'pictures (saved in a folder beside it);'), html: DOCX_KEEPS, txt: 'Text only: all formatting and pictures are left out.', pdf: 'Laid out as Notes shows it, which is close to Word but not exact: lines and pages can break in different places.' },
  pdf: { md: PDF_TEXT_ONLY, txt: 'Text only. A scanned PDF has no text to convert.', html: PDF_TEXT_ONLY, docx: PDF_TEXT_ONLY },
  office: { md: OFFICE_TEXT, txt: 'Text only, as MarkItDown reads it: layout, pictures, charts, formulas and formatting are left out.', html: OFFICE_TEXT, docx: OFFICE_TEXT, pdf: OFFICE_TEXT },
};

// The formats this note can be converted to, with what each one loses.
function options(note) {
  const src = sourceOf(note);
  if (!src) return [];
  return Object.keys(FORMATS).filter((to) => to !== src).map((to) => ({ to, label: FORMATS[to], note: LOSS[src][to] || '' }));
}

// ---- Markdown in --------------------------------------------------------------------------------

// Escapes one line of plain text so Markdown shows it exactly as written.
function escapeMarkdownLine(line) {
  return line
    .replace(/[\\`*_[\]<>|~&]/g, '\\$&')
    .replace(/^(\s*)([#>+=-])/, '$1\\$2') // headings, quotes, list items, setext underlines
    .replace(/^(\s*)(\d+)([.)])/, '$1$2\\$3') // "1." would start a numbered list
    .replace(/^[ \t]+/, (m) => '&nbsp;'.repeat(m.replace(/\t/g, '    ').length)); // leading space would make a code block
}

// Plain text as Markdown that reads the same: blank lines separate paragraphs, single line breaks are kept.
function textToMarkdown(text) {
  return String(text).replace(/\r\n?/g, '\n').split(/\n[ \t]*(?:\n[ \t]*)*\n/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim())
    .map((p) => p.split('\n').map(escapeMarkdownLine).join('\\\n'))
    .join('\n\n') + '\n';
}

function fence(text, lang) {
  const longest = Math.max(2, ...(String(text).match(/`+/g) || []).map((m) => m.length));
  const f = '`'.repeat(longest + 1);
  return f + (lang || '') + '\n' + String(text).replace(/\n$/, '') + '\n' + f + '\n';
}

let turndownService = null;
function htmlToMarkdown(html) {
  if (!turndownService) {
    const TurndownService = require('turndown');
    turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
    turndownService.use(require('turndown-plugin-gfm').gfm);
    turndownService.remove(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'head']);
  }
  return turndownService.turndown(String(html)).trim() + '\n';
}

// Links in a Word document can point anywhere; only web and mail links are kept as links.
const SAFE_HREF = /^(https?:|mailto:)/i;
function mammothOptions(convertImage) {
  const mammoth = require('mammoth');
  const opts = {
    transformDocument: (doc) => {
      // @ts-expect-error mammoth's typings leave out transforms, which its documentation lists
      for (const h of mammoth.transforms.getDescendantsOfType(doc, 'hyperlink')) if (h.href && !SAFE_HREF.test(h.href)) h.href = '';
      return doc;
    },
  };
  if (convertImage) opts.convertImage = mammoth.images.imgElement(convertImage);
  return opts;
}

// Markdown tables need a header row and one line per cell. Word tables often have neither (mammoth marks a header
// only when Word does, and puts each cell's text in paragraphs), so the first row becomes the header and a cell's
// paragraphs become line breaks. A table holding another table is left as it is (turndown keeps it as HTML).
function tablesForMarkdown(html) {
  return String(html).replace(/<table>[\s\S]*?<\/table>/g, (table) => {
    if (table.indexOf('<table', 1) >= 0) return table; // the lazy match stopped at a nested table's end
    let t = table.replace(/<\/p>\s*<p>/g, '<br>').replace(/<\/?p>/g, '');
    if (!/<th[\s>]/.test(t)) {
      t = t.replace(/^<table>(<tbody>)?<tr>([\s\S]*?)<\/tr>/, (m, tbody, cells) =>
        '<table><thead><tr>' + cells.replace(/<td(\s|>)/g, '<th$1').replace(/<\/td>/g, '</th>') + '</tr></thead>' + (tbody || ''));
    }
    return t;
  });
}

async function docxToHtml(filePath, convertImage) {
  const mammoth = require('mammoth');
  const res = await mammoth.convertToHtml({ buffer: await readDocumentBuffer(filePath) }, mammothOptions(convertImage));
  return res.value;
}

// The text of a PDF as Markdown paragraphs. Says how many pages had no text (scanned), and refuses when none did.
async function pdfToMarkdown(filePath) {
  if (fs.statSync(filePath).size > MAX_PDF_BYTES) throw new Error('This PDF is larger than 100 MB.');
  const res = await runWorker('pdf-text-worker.js', { bytes: fs.readFileSync(filePath) }, PDF_TIMEOUT_MS, 'Reading the PDF took too long.');
  if (!res.ok) throw new Error(res.error);
  const empty = res.pages.filter((p) => !p.length).length;
  if (empty === res.pages.length) throw new Error('This PDF has no text to convert; it is probably scanned pages. Converting it needs OCR, which Notes does not do.');
  const markdown = res.pages.flat().map((p) => textToMarkdown(p).trim()).join('\n\n') + '\n';
  const warning = empty ? empty + (empty === 1 ? ' page has' : ' pages have') + ' no text (probably scanned) and ' + (empty === 1 ? 'is' : 'are') + ' missing.' : '';
  return { markdown, warning };
}

// One path segment for a Markdown link: "#", "?" and brackets in a file name must not end or break the link.
const urlSegment = (s) => encodeURIComponent(s).replace(/[()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// The file as Markdown. imagesDir: where a Word document's pictures go ({ parent, folder() }, folder() making the
// folder on first use and returning its name); without it they are inlined as data: URLs.
async function toMarkdown(note, imagesDir) {
  const src = sourceOf(note);
  const file = note.filePath;
  if (src === 'pdf') return pdfToMarkdown(file);
  if (src === 'office') {
    if (ZIP_DOC_EXT.has(extOf(file))) await readDocumentBuffer(file); // the size limit and the zip guard first
    return markitdown.toMarkdown(file);
  }
  if (src === 'docx') {
    let n = 0;
    const html = await docxToHtml(file, imagesDir ? async (image) => {
      const ext = (String(image.contentType).split('/')[1] || 'bin').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '');
      const name = 'image' + (++n) + '.' + ext;
      const folder = imagesDir.folder();
      fs.writeFileSync(path.join(imagesDir.parent, folder, name), await image.read(), { flag: 'wx' });
      return { src: [folder, name].map(urlSegment).join('/') };
    } : null);
    return { markdown: htmlToMarkdown(tablesForMarkdown(html)), warning: '' };
  }
  const { body } = readText(file);
  if (src === 'md') return { markdown: body, warning: '' };
  if (src === 'html') return { markdown: htmlToMarkdown(body), warning: '' };
  if (src === 'code') return { markdown: fence(body, extOf(file)), warning: '' };
  return { markdown: textToMarkdown(body), warning: '' };
}

// ---- Markdown to blocks -------------------------------------------------------------------------
// A small document model shared by the text and Word writers:
//   { t: 'h', level, runs } | { t: 'p', runs } | { t: 'list', ordered, start, items: [[block]] } | { t: 'code', lang, text }
//   | { t: 'quote', blocks } | { t: 'table', rows: [{ header, cells: [runs] }] } | { t: 'hr' }
// A run is { text, b, i, s, code, href } or { br: true } or { img: src, alt }.

let markdownIt = null;
function md() {
  if (!markdownIt) markdownIt = require('markdown-it')({ html: true, linkify: false });
  return markdownIt;
}

const stripTags = (s) => String(s).replace(/<[^>]*>/g, '');

// Markdown as HTML, with task items ("- [ ] x") shown as boxes the way the editor shows them. forPrint: pictures on
// the web are replaced by their description, since the print window never fetches them.
function renderMarkdown(markdown, forPrint) {
  let html = md().render(markdown).replace(/<li>(<p>)?\[( |x|X)\]\s/g, (m, p, x) => '<li>' + (p || '') + (x === ' ' ? '☐ ' : '☑ '));
  if (forPrint) html = html.replace(/<img src="(?!data:|file:)[a-z][a-z0-9+.-]*:[^"]*" alt="([^"]*)"[^>]*>/gi, (m, alt) => (alt ? '<em>[' + alt + ']</em>' : ''));
  return html;
}

function inlineRuns(tok) {
  const runs = [];
  const st = { b: 0, i: 0, s: 0, href: null };
  const push = (text, extra) => runs.push(Object.assign({ text, b: st.b > 0, i: st.i > 0, s: st.s > 0, href: st.href }, extra));
  for (const c of (tok && tok.children) || []) {
    if (c.type === 'text') push(c.content);
    else if (c.type === 'softbreak') push(' ');
    else if (c.type === 'hardbreak') runs.push({ br: true });
    else if (c.type === 'strong_open') st.b++;
    else if (c.type === 'strong_close') st.b--;
    else if (c.type === 'em_open') st.i++;
    else if (c.type === 'em_close') st.i--;
    else if (c.type === 's_open') st.s++;
    else if (c.type === 's_close') st.s--;
    else if (c.type === 'code_inline') push(c.content, { code: true });
    else if (c.type === 'link_open') st.href = c.attrGet('href');
    else if (c.type === 'link_close') st.href = null;
    else if (c.type === 'image') runs.push({ img: c.attrGet('src'), alt: c.content });
    else if (c.type === 'html_inline' && /^<br\s*\/?>$/i.test(c.content)) runs.push({ br: true });
    // Other inline HTML tags are dropped; the text between them stays.
  }
  return runs;
}

/** @typedef {{ text?: string, bold?: boolean, italic?: boolean, code?: boolean, strike?: boolean, href?: string | null, img?: string | null, alt?: string, br?: boolean }} Run */
/** @typedef {{ header: boolean, cells: Run[][] }} TableRow */
/** @typedef {{ t: string, level?: number, runs?: Run[], tight?: boolean, ordered?: boolean, start?: number, items?: Block[][], rows?: TableRow[], lang?: string, text?: string, blocks?: Block[] }} Block */
function markdownBlocks(src) {
  const tokens = md().parse(String(src), {});
  /** @type {Block[]} */
  const root = [];
  /** @type {({ blocks: Block[], list?: undefined } | { list: Block, blocks?: undefined })[]} */
  const stack = [{ blocks: root }];
  const top = () => stack[stack.length - 1];
  // Blocks go into the open container; a list frame only takes items, so a block there is a markdown-it fault.
  const topBlocks = () => { const f = top(); if (!f.blocks) throw new Error('a block outside a list item'); return f.blocks; };
  const topItems = () => { const f = top(); if (!f.list || !f.list.items) throw new Error('a list item outside a list'); return f.list.items; };
  /** @type {Block | null} */
  let table = null;
  /** @type {TableRow | null} */
  let row = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const inline = tokens[i + 1] && tokens[i + 1].type === 'inline' ? tokens[i + 1] : null;
    switch (t.type) {
      case 'heading_open': topBlocks().push({ t: 'h', level: Number(t.tag.slice(1)), runs: inlineRuns(inline) }); break;
      case 'paragraph_open': topBlocks().push({ t: 'p', runs: inlineRuns(inline), tight: !!t.hidden }); break; // hidden: in a tight list
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const list = { t: 'list', ordered: t.type === 'ordered_list_open', start: Number(t.attrGet('start')) || 1, items: [] };
        topBlocks().push(list);
        stack.push({ list });
        break;
      }
      case 'list_item_open': { const item = []; topItems().push(item); stack.push({ blocks: item }); break; }
      case 'blockquote_open': { const q = { t: 'quote', blocks: [] }; topBlocks().push(q); stack.push({ blocks: q.blocks }); break; }
      case 'list_item_close': case 'bullet_list_close': case 'ordered_list_close': case 'blockquote_close': stack.pop(); break;
      case 'fence': case 'code_block': topBlocks().push({ t: 'code', lang: String(t.info || '').trim().split(/\s+/)[0], text: t.content.replace(/\n$/, '') }); break;
      case 'hr': topBlocks().push({ t: 'hr' }); break;
      case 'html_block': {
        if (/^\s*<(style|script)\b/i.test(t.content)) break; // code, not text
        const text = stripTags(t.content).trim();
        if (text) topBlocks().push({ t: 'p', runs: [{ text }] });
        break;
      }
      case 'table_open': table = { t: 'table', rows: [] }; topBlocks().push(table); break;
      case 'tr_open': row = { header: false, cells: [] }; if (table && table.rows) table.rows.push(row); break;
      case 'th_open': case 'td_open': if (row) { row.header = t.type === 'th_open'; row.cells.push(inlineRuns(inline)); } break;
      case 'table_close': table = null; break;
      default: break;
    }
  }
  return root;
}

// ---- writers ------------------------------------------------------------------------------------

function runsText(runs) {
  let out = '', linkText = '';
  runs.forEach((r, k) => {
    if (r.br) { out += '\n'; return; }
    const text = r.img !== undefined ? (r.alt ? '[' + r.alt + ']' : '') : r.text;
    out += text;
    if (!r.href) return;
    linkText += text;
    const next = runs[k + 1];
    if (next && next.href === r.href) return;
    const shown = r.href.replace(/^mailto:/i, '');
    if (SAFE_HREF.test(r.href) && shown !== linkText) out += ' (' + shown + ')';
    linkText = '';
  });
  return out;
}

const indentLines = (text, pad) => text.split('\n').map((l) => (l ? pad + l : l)).join('\n');

function blocksToText(blocks) {
  let out = '';
  blocks.forEach((b, k) => {
    const text = blockText(b);
    // In a tight list an item's text and its nested list sit on consecutive lines.
    out += (k === 0 ? '' : blocks[k - 1].tight ? '\n' : '\n\n') + text;
  });
  return out;
}

function blockText(b) {
  if (b.t === 'h' || b.t === 'p') return runsText(b.runs);
  if (b.t === 'code') return b.text;
  if (b.t === 'hr') return '* * *';
  if (b.t === 'quote') return indentLines(blocksToText(b.blocks), '> ');
  if (b.t === 'table') return b.rows.map((r) => r.cells.map((c) => runsText(c).replace(/\n/g, ' ')).join('\t')).join('\n');
  if (b.t === 'list') {
    return b.items.map((item, k) => {
      const marker = b.ordered ? (b.start + k) + '. ' : '- ';
      return marker + indentLines(blocksToText(item), ' '.repeat(marker.length)).slice(marker.length);
    }).join('\n');
  }
  return '';
}

// Pixel size of a PNG, JPEG, GIF or BMP, read from its header; null for anything else.
/** @returns {{ type: 'png' | 'gif' | 'bmp' | 'jpg', w: number, h: number } | null} */
function imageInfo(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 10 && buf.toString('latin1', 0, 4) === 'GIF8') return { type: 'gif', w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if (buf.length > 26 && buf.toString('latin1', 0, 2) === 'BM') return { type: 'bmp', w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22)) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let p = 2; p + 9 < buf.length;) {
      if (buf[p] !== 0xff) return null;
      const marker = buf[p + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { type: 'jpg', w: buf.readUInt16BE(p + 7), h: buf.readUInt16BE(p + 5) };
      p += 2 + buf.readUInt16BE(p + 2);
    }
  }
  return null;
}

// Whether file is inside dir (or is dir). Network paths (\\server\share) never are.
function isInside(file, dir) {
  if (/^[\\/]{2}/.test(file)) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// A picture's bytes, from a data: URL or a file in the source's folder. Pictures on the web or a network share are
// never fetched (a share would send the Windows login to whoever runs it), and nothing outside the folder is read.
function imageBytes(src, baseDir) {
  const s = String(src || '');
  const data = /^data:image\/[a-z+]+;base64,(.*)$/i.exec(s);
  if (data) return Buffer.from(data[1], 'base64');
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || /^[\\/]{2}/.test(s)) return null; // a URL, file: included, or a share
  let file;
  try { file = path.resolve(baseDir, decodeURIComponent(s.split(/[?#]/)[0])); } catch (_) { return null; }
  if (!isInside(file, baseDir)) return null;
  try { return fs.statSync(file).size <= MAX_IMAGE_BYTES ? fs.readFileSync(file) : null; } catch (_) { return null; }
}

const MAX_IMAGE_WIDTH = 600; // px, about the text width of an A4 or Letter page

async function blocksToDocx(blocks, opts) {
  const D = require('docx');
  const baseDir = opts.baseDir;
  const numbering = new Map(); // start number -> reference (every level of it counts from that number)
  let instance = 0;
  const numberingRef = (start) => {
    if (!numbering.has(start)) numbering.set(start, 'ordered-' + start);
    return numbering.get(start);
  };
  const codeShading = { type: D.ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' };

  function imageRun(r) {
    const buf = imageBytes(r.img, baseDir);
    const info = buf && imageInfo(buf);
    if (!info || !info.w || !info.h) return new D.TextRun({ text: r.alt ? '[' + r.alt + ']' : '', italics: true });
    const scale = Math.min(1, MAX_IMAGE_WIDTH / info.w);
    return new D.ImageRun({ type: info.type, data: buf, transformation: { width: Math.round(info.w * scale), height: Math.round(info.h * scale) }, altText: r.alt ? { name: r.alt, description: r.alt, title: r.alt } : undefined });
  }

  function runObjs(runs, extra) {
    const out = [];
    for (const r of runs) {
      if (r.br) { out.push(new D.TextRun({ text: '', break: 1 })); continue; }
      if (r.img !== undefined) { out.push(imageRun(r)); continue; }
      const o = Object.assign({ text: r.text }, extra);
      if (r.b) o.bold = true;
      if (r.i) o.italics = true;
      if (r.s) o.strike = true;
      if (r.code) Object.assign(o, { font: 'Consolas', shading: codeShading });
      if (r.href && SAFE_HREF.test(r.href)) out.push(new D.ExternalHyperlink({ link: r.href, children: [new D.TextRun(Object.assign(o, { style: 'Hyperlink' }))] }));
      else out.push(new D.TextRun(o));
    }
    return out;
  }

  // A task item's "[ ] " or "[x] " becomes a box.
  function taskRuns(runs) {
    const first = runs[0];
    const m = first && !first.br && first.img === undefined && /^\[( |x|X)\]\s+/.exec(first.text);
    if (!m) return runs;
    return [Object.assign({}, first, { text: (m[1] === ' ' ? '☐ ' : '☑ ') + first.text.slice(m[0].length) })].concat(runs.slice(1));
  }

  // ctx: paragraph properties that apply to everything inside (quote borders, list indents); level: list depth.
  function walk(list, ctx, level, out) {
    for (const b of list) {
      if (b.t === 'h') out.push(new D.Paragraph(Object.assign({ heading: D.HeadingLevel['HEADING_' + Math.min(6, b.level)], children: runObjs(b.runs) }, ctx)));
      else if (b.t === 'p') out.push(new D.Paragraph(Object.assign({ children: runObjs(b.runs) }, ctx)));
      else if (b.t === 'hr') out.push(new D.Paragraph({ thematicBreak: true, children: [] }));
      else if (b.t === 'code') {
        for (const line of b.text.split('\n')) out.push(new D.Paragraph(Object.assign({ children: [new D.TextRun({ text: line, font: 'Consolas' })], shading: codeShading, spacing: { before: 0, after: 0 } }, ctx)));
        out.push(new D.Paragraph(Object.assign({ children: [] }, ctx)));
      } else if (b.t === 'quote') {
        walk(b.blocks, Object.assign({}, ctx, { indent: { left: 720 * (level + 1) }, border: { left: { style: D.BorderStyle.SINGLE, size: 12, color: 'C9B8A8', space: 8 } } }), level, out);
      } else if (b.t === 'table') {
        const width = Math.max(1, ...b.rows.map((r) => r.cells.length));
        out.push(new D.Table({
          width: { size: 100, type: D.WidthType.PERCENTAGE },
          rows: b.rows.map((r) => new D.TableRow({
            tableHeader: r.header,
            children: Array.from({ length: width }, (_, k) => new D.TableCell({ children: [new D.Paragraph({ children: runObjs(r.cells[k] || [], r.header ? { bold: true } : {}) })] })),
          })),
        }));
        out.push(new D.Paragraph({ children: [] }));
      } else if (b.t === 'list') {
        const inst = ++instance;
        for (const item of b.items) {
          item.forEach((child, k) => {
            if (k === 0 && (child.t === 'p' || child.t === 'h')) {
              const marker = b.ordered ? { numbering: { reference: numberingRef(b.start), level: Math.min(8, level), instance: inst } } : { bullet: { level: Math.min(8, level) } };
              out.push(new D.Paragraph(Object.assign({ children: runObjs(taskRuns(child.runs)) }, ctx, marker)));
            } else if (child.t === 'list') walk([child], ctx, level + 1, out);
            else walk([child], Object.assign({}, ctx, { indent: { left: 720 * (level + 1) } }), level + 1, out);
          });
        }
      }
    }
    return out;
  }

  const children = walk(blocks, {}, 0, []);
  const config = [...numbering].map(([start, reference]) => ({
    reference,
    levels: Array.from({ length: 9 }, (_, l) => ({
      level: l, format: D.LevelFormat.DECIMAL, text: '%' + (l + 1) + '.', alignment: D.AlignmentType.START,
      start, style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } },
    })),
  }));
  const doc = new D.Document({ title: opts.title, numbering: { config }, sections: [{ children: children.length ? children : [new D.Paragraph({ children: [] })] }] });
  return D.Packer.toBuffer(doc);
}

// ---- HTML pages ---------------------------------------------------------------------------------

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// A standalone HTML page for an exported note, book or converted file. extraCss styles the parts (contents, page breaks).
function htmlDocument(title, bodyHtml, extraCss) {
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + escHtml(title) + '</title>\n' +
    '<style>body{max-width:760px;margin:40px auto;padding:0 20px;font:16px/1.6 Georgia,serif;color:#2a1a12;background:#fbf1e4}h1,h2,h3{line-height:1.2}pre,code{font-family:ui-monospace,Consolas,monospace;font-size:.95em}pre{background:#f6dcc3;padding:12px;border-radius:8px;overflow:auto}blockquote{border-left:4px solid #f47b3e;margin:0;padding:4px 14px;color:#6b5546}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #c9b8a8;padding:4px 8px}ul[data-type="taskList"]{list-style:none;padding-left:0}' + (extraCss || '') + '</style></head>\n' +
    '<body>' + String(bodyHtml || '') + '</body></html>\n';
}
// On paper a converted document is black on white, edge to edge of the printable area.
const PRINT_CSS = '@media print{body{background:#fff;margin:0;max-width:none;padding:0}pre{white-space:pre-wrap}}';

// Markdown pictures that are not inlined (data: URLs) become their description.
function inlinePicturesOnly(markdown) {
  return String(markdown).replace(/!\[([^\]]*)\]\((?!data:)(?:<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\)/g, (m, alt) => (alt ? '*[' + alt + ']*' : ''));
}

// ---- writing the new file -----------------------------------------------------------------------

// Calls make(name) with "<stem><ext>", then "<stem> (2)<ext>" and so on, until one is not taken (make throws EEXIST).
function firstFree(stem, ext, make) {
  for (let n = 1; n < 1000; n++) {
    const name = stem + (n > 1 ? ' (' + n + ')' : '') + ext;
    try { make(name); return name; } catch (err) { if (err.code !== 'EEXIST') throw err; }
  }
  throw new Error('Too many converted copies already exist next to this file.');
}

// Writes data to a new "<base>.<ext>" in dir and returns its path. Never overwrites ('wx'); a write that fails part
// way removes what it wrote.
function writeNew(dir, base, ext, data) {
  return path.join(dir, firstFree(base, '.' + ext, (name) => {
    const file = path.join(dir, name);
    const fd = fs.openSync(file, 'wx'); // throws EEXIST (or anything else) before anything is created
    try { fs.writeFileSync(fd, data); fs.closeSync(fd); } catch (err) {
      try { fs.closeSync(fd); } catch (_) { /* already closed */ }
      fs.rmSync(file, { force: true }); // ours: the open above created it
      throw err;
    }
  }));
}

// A new, empty folder "<name>" in dir; returns its name.
const mkdirNew = (dir, name) => firstFree(name, '', (folder) => fs.mkdirSync(path.join(dir, folder)));

// Converts the file behind note to format `to`. print renders PDFs, which needs a window that main owns:
// print.html(doc, baseDir) -> Buffer, print.docx(bytes) -> { pdf, warning }. Returns { filePath, warning }.
async function convertFile(note, to, print) {
  const src = sourceOf(note);
  if (!src) throw new Error('This file cannot be converted.');
  if (!FORMATS[to] || to === src) throw new Error('Notes cannot convert this file to that format.');
  if (note.lock) throw new Error('Unlock the note first.');
  const file = note.filePath;
  if (!fs.existsSync(file)) throw new Error('The file no longer exists at ' + file + '.');
  const dir = path.dirname(file);
  const base = path.basename(file, path.extname(file)) || path.basename(file);
  const title = base;

  // Direct routes, which keep more than going through Markdown.
  if (src === 'docx' && to === 'pdf') {
    const out = await print.docx(await readDocumentBuffer(file));
    return { filePath: writeNew(dir, base, 'pdf', out.pdf), warning: out.warning || '' };
  }
  if (src === 'docx' && to === 'html') return { filePath: writeNew(dir, base, 'html', htmlDocument(title, await docxToHtml(file), PRINT_CSS)), warning: '' };
  if (src === 'docx' && to === 'txt') return { filePath: writeNew(dir, base, 'txt', (await readDocxText(file)).body), warning: '' };
  if (src === 'html' && to === 'pdf') return { filePath: writeNew(dir, base, 'pdf', await print.html(readText(file).body, dir)), warning: '' };
  if (src === 'code' && to === 'txt') return { filePath: writeNew(dir, base, 'txt', readText(file).body), warning: '' };

  if (src === 'docx' && to === 'md') {
    // Pictures go in a folder beside the new file, made only if there are any; removed again if the conversion fails.
    let folder = null;
    const imagesDir = { parent: dir, folder: () => folder || (folder = mkdirNew(dir, base + ' pictures')) };
    try {
      const { markdown } = await toMarkdown(note, imagesDir);
      return { filePath: writeNew(dir, base, 'md', markdown), warning: folder ? 'Its pictures are in the folder "' + folder + '".' : '' };
    } catch (err) {
      if (folder) fs.rmSync(path.join(dir, folder), { recursive: true, force: true });
      throw err;
    }
  }

  const { markdown, warning } = await toMarkdown(note);
  let data;
  if (to === 'md') data = markdown;
  else if (to === 'txt') data = blocksToText(markdownBlocks(markdown)) + '\n';
  else if (to === 'html') data = htmlDocument(title, renderMarkdown(markdown), PRINT_CSS);
  else if (to === 'docx') data = await blocksToDocx(markdownBlocks(markdown), { baseDir: dir, title });
  else if (to === 'pdf') data = await print.html(htmlDocument(title, renderMarkdown(markdown, true), PRINT_CSS), dir);
  return { filePath: writeNew(dir, base, to, data), warning };
}

module.exports = { FORMATS, sourceOf, options, convertFile, toMarkdown, textToMarkdown, markdownBlocks, blocksToText, htmlDocument, escHtml, imageInfo, isInside, inlinePicturesOnly, writeNew };
