import fs from 'node:fs';
import path from 'node:path';
import { runWorker } from './run-worker.mts';
import { extOf, readText, readDocumentBuffer, readDocxText } from './files.mts';
import { OOXML_EXT, ZIP_DOC_EXT } from './shared/helpers.mts';
import * as markitdown from './markitdown.mts';
import { createRequire } from 'node:module';
import type MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import type { ParagraphChild, IParagraphOptions, IRunOptions, Paragraph, Table } from 'docx';
import { isFileNote } from './store.mts';

const requireWhenNeeded = createRequire(import.meta.url);


const FORMATS: Record<string, string> = {
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

function sourceOf(note: Note | null) {
  if (!note || !note.filePath) return null;
  if (note.fileKind === 'pdf') return 'pdf';
  if (note.fileKind === 'docx') return OOXML_EXT.has(extOf(note.filePath)) ? 'docx' : null;
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
const PDF_TEXT_ONLY = 'Text only: the PDF\'s layout, pictures and fonts are left out. A scanned PDF has no text to convert.';
const OFFICE_TEXT = 'The text, headings, lists and tables as MarkItDown reads them; layout, pictures, charts, formulas and formatting are left out.';
const LOSS: Record<string, Record<string, string>> = {
  md: { txt: 'Formatting marks are removed; a link keeps its address in brackets.', docx: 'Keeps headings, lists, bold and italic, links, code, quotes, tables and pictures on this PC; pictures from the web are left out.', pdf: 'Pictures from the web are left out.' },
  txt: {},
  code: { md: 'The text goes in a code block.', html: 'Shown as monospaced text.', docx: 'Shown as monospaced text.', pdf: 'Shown as monospaced text.', txt: 'The same text, saved as .txt.' },
  html: { md: 'Keeps the page\'s text, headings, lists, links, tables and pictures; its styling and scripts are left out.', txt: 'Text only.', docx: 'Keeps the page\'s text, headings, lists, links and tables; its styling, scripts and pictures from the web are left out.', pdf: 'Scripts do not run and pictures from the web are left out.' },
  docx: { md: DOCX_KEEPS.replace('pictures;', 'pictures (saved in a folder beside it);'), html: DOCX_KEEPS, txt: 'Text only: all formatting and pictures are left out.', pdf: 'Laid out as Notes shows it, which is close to Word but not exact: lines and pages can break in different places.' },
  pdf: { md: PDF_TEXT_ONLY, txt: 'Text only. A scanned PDF has no text to convert.', html: PDF_TEXT_ONLY, docx: PDF_TEXT_ONLY },
  office: { md: OFFICE_TEXT, txt: 'Text only, as MarkItDown reads it: layout, pictures, charts, formulas and formatting are left out.', html: OFFICE_TEXT, docx: OFFICE_TEXT, pdf: OFFICE_TEXT },
};

function options(note: Note | null) {
  const src = sourceOf(note);
  if (!src) return [];
  return Object.keys(FORMATS).filter((to) => to !== src).map((to) => ({ to, label: FORMATS[to], note: LOSS[src][to] || '' }));
}

function escapeMarkdownLine(line: string) {
  return line
    .replace(/[\\`*_[\]<>|~&]/g, '\\$&')
    .replace(/^(\s*)([#>+=-])/, '$1\\$2')
    .replace(/^(\s*)(\d+)([.)])/, '$1$2\\$3')
    .replace(/^[ \t]+/, (m: string) => '&nbsp;'.repeat(m.replace(/\t/g, '    ').length));
}

function textToMarkdown(text: string) {
  return String(text).replace(/\r\n?/g, '\n').split(/\n[ \t]*(?:\n[ \t]*)*\n/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim())
    .map((p) => p.split('\n').map(escapeMarkdownLine).join('\\\n'))
    .join('\n\n') + '\n';
}

function fence(text: string, lang: string) {
  const longest = Math.max(2, ...(String(text).match(/`+/g) || []).map((m) => m.length));
  const f = '`'.repeat(longest + 1);
  return f + (lang || '') + '\n' + String(text).replace(/\n$/, '') + '\n' + f + '\n';
}

type Turndown = { turndown: (html: string) => string, use: (plugin: unknown) => void, remove: (tags: string[]) => void };
let turndownService: Turndown | null = null;
function htmlToMarkdown(html: string) {
  if (!turndownService) {
    const TurndownService: new (options: object) => Turndown = requireWhenNeeded('turndown');
    turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
    turndownService.use(requireWhenNeeded('turndown-plugin-gfm').gfm);
    turndownService.remove(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'head']);
  }
  return turndownService.turndown(String(html)).trim() + '\n';
}

const SAFE_HREF = /^(https?:|mailto:)/i;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type ImageConverter = Parameters<typeof import('mammoth').images.imgElement>[0];
function mammothOptions(convertImage?: ImageConverter | null) {
  const mammoth: typeof import('mammoth') = requireWhenNeeded('mammoth');
  const opts: NonNullable<Parameters<typeof mammoth.convertToHtml>[1]> = {
    transformDocument: (doc) => {
      // @ts-expect-error
      for (const h of mammoth.transforms.getDescendantsOfType(doc, 'hyperlink')) if (h.href && !SAFE_HREF.test(h.href)) h.href = '';
      return doc;
    },
  };
  if (convertImage) opts.convertImage = mammoth.images.imgElement(convertImage);
  return opts;
}

function tablesForMarkdown(html: string) {
  return String(html).replace(/<table>[\s\S]*?<\/table>/g, (table) => {
    if (table.indexOf('<table', 1) >= 0) return table;
    let t = table.replace(/<\/p>\s*<p>/g, '<br>').replace(/<\/?p>/g, '');
    if (!/<th[\s>]/.test(t)) {
      t = t.replace(/^<table>(<tbody>)?<tr>([\s\S]*?)<\/tr>/, (m, tbody, cells) =>
        '<table><thead><tr>' + cells.replace(/<td(\s|>)/g, '<th$1').replace(/<\/td>/g, '</th>') + '</tr></thead>' + (tbody || ''));
    }
    return t;
  });
}

async function docxToHtml(filePath: string, convertImage?: ImageConverter | null) {
  const mammoth: typeof import('mammoth') = requireWhenNeeded('mammoth');
  const res = await mammoth.convertToHtml({ buffer: await readDocumentBuffer(filePath) }, mammothOptions(convertImage));
  return res.value;
}

async function pdfToMarkdown(filePath: string) {
  if (fs.statSync(filePath).size > MAX_PDF_BYTES) throw new Error('This PDF is larger than 100 MB.');
  const res = await runWorker<{ pages: string[][] }>('pdf-text-worker.mts', { bytes: fs.readFileSync(filePath) }, PDF_TIMEOUT_MS, 'Reading the PDF took too long.');
  if (!res.ok) throw new Error(res.error);
  const empty = res.pages.filter((p) => !p.length).length;
  if (empty === res.pages.length) throw new Error('This PDF has no text to convert; it is probably scanned pages. Converting it needs OCR, which Notes does not do.');
  const markdown = res.pages.flat().map((p) => textToMarkdown(p).trim()).join('\n\n') + '\n';
  const warning = empty ? empty + (empty === 1 ? ' page has' : ' pages have') + ' no text (probably scanned) and ' + (empty === 1 ? 'is' : 'are') + ' missing.' : '';
  return { markdown, warning };
}

const urlSegment = (s: string) => encodeURIComponent(s).replace(/[()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

async function toMarkdown(note: FileNote, imagesDir?: { parent: string, folder: () => string }) {
  const src = sourceOf(note);
  const file = note.filePath;
  if (src === 'pdf') return pdfToMarkdown(file);
  if (src === 'office') {
    if (ZIP_DOC_EXT.has(extOf(file))) await readDocumentBuffer(file);
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

let markdownIt: MarkdownIt | null = null;
function md(): MarkdownIt {
  if (!markdownIt) {
    const createMarkdownIt: typeof MarkdownIt = requireWhenNeeded('markdown-it');
    markdownIt = createMarkdownIt({ html: true, linkify: false });
  }
  return markdownIt;
}

const stripTags = (s: string) => String(s).replace(/<[^>]*>/g, '');

function renderMarkdown(markdown: string, forPrint?: boolean) {
  let html = md().render(markdown).replace(/<li>(<p>)?\[( |x|X)\]\s/g, (m, p, x) => '<li>' + (p || '') + (x === ' ' ? '☐ ' : '☑ '));
  if (forPrint) html = html.replace(/<img src="(?!data:|file:)[a-z][a-z0-9+.-]*:[^"]*" alt="([^"]*)"[^>]*>/gi, (m, alt) => (alt ? '<em>[' + alt + ']</em>' : ''));
  return html;
}

function inlineRuns(tok: Token | null): Run[] {
  const runs: Run[] = [];
  const st: { b: number, i: number, s: number, href: string | null } = { b: 0, i: 0, s: 0, href: null };
  const push = (text: string, extra?: { code: true }) => runs.push(Object.assign({ text, b: st.b > 0, i: st.i > 0, s: st.s > 0, href: st.href }, extra));
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
  }
  return runs;
}

type Run = { text?: string, b?: boolean, i?: boolean, s?: boolean, code?: boolean, href?: string | null, img?: string | null, alt?: string, br?: boolean };
type TableRow = { header: boolean, cells: Run[][] };
type Block = { tight?: boolean } & (
  | { t: 'h', level: number, runs: Run[] }
  | { t: 'p', runs: Run[] }
  | { t: 'list', ordered: boolean, start: number, items: Block[][] }
  | { t: 'code', lang: string, text: string }
  | { t: 'quote', blocks: Block[] }
  | { t: 'table', rows: TableRow[] }
  | { t: 'hr' });
type ListBlock = Extract<Block, { t: 'list' }>;
type QuoteBlock = Extract<Block, { t: 'quote' }>;
type TableBlock = Extract<Block, { t: 'table' }>;
function markdownBlocks(src: string) {
  const tokens = md().parse(String(src), {});
  const root: Block[] = [];
  const stack: ({ blocks: Block[], list?: undefined } | { list: ListBlock, blocks?: undefined })[] = [{ blocks: root }];
  const top = () => stack[stack.length - 1];
  const topBlocks = () => { const f = top(); if (!f.blocks) throw new Error('a block outside a list item'); return f.blocks; };
  const topItems = () => { const f = top(); if (!f.list || !f.list.items) throw new Error('a list item outside a list'); return f.list.items; };
  let table: TableBlock | null = null;
  let row: TableRow | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const inline = tokens[i + 1] && tokens[i + 1].type === 'inline' ? tokens[i + 1] : null;
    switch (t.type) {
      case 'heading_open': topBlocks().push({ t: 'h', level: Number(t.tag.slice(1)), runs: inlineRuns(inline) }); break;
      case 'paragraph_open': topBlocks().push({ t: 'p', runs: inlineRuns(inline), tight: !!t.hidden }); break;
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const list: ListBlock = { t: 'list', ordered: t.type === 'ordered_list_open', start: Number(t.attrGet('start')) || 1, items: [] };
        topBlocks().push(list);
        stack.push({ list });
        break;
      }
      case 'list_item_open': { const item: Block[] = []; topItems().push(item); stack.push({ blocks: item }); break; }
      case 'blockquote_open': { const q: QuoteBlock = { t: 'quote', blocks: [] }; topBlocks().push(q); stack.push({ blocks: q.blocks }); break; }
      case 'list_item_close': case 'bullet_list_close': case 'ordered_list_close': case 'blockquote_close': stack.pop(); break;
      case 'fence': case 'code_block': topBlocks().push({ t: 'code', lang: String(t.info || '').trim().split(/\s+/)[0], text: t.content.replace(/\n$/, '') }); break;
      case 'hr': topBlocks().push({ t: 'hr' }); break;
      case 'html_block': {
        if (/^\s*<(style|script)\b/i.test(t.content)) break;
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

function runsText(runs: Run[]) {
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

const indentLines = (text: string, pad: string) => text.split('\n').map((l) => (l ? pad + l : l)).join('\n');

function blocksToText(blocks: Block[]) {
  let out = '';
  blocks.forEach((b, k) => {
    const text = blockText(b);
    out += (k === 0 ? '' : blocks[k - 1].tight ? '\n' : '\n\n') + text;
  });
  return out;
}

function blockText(b: Block): string {
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

function imageInfo(buf: Buffer): { type: 'png' | 'gif' | 'bmp' | 'jpg', w: number, h: number } | null {
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

function isInside(file: string, dir: string) {
  if (/^[\\/]{2}/.test(file)) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function imageBytes(src: string | null | undefined, baseDir: string) {
  const s = String(src || '');
  const data = /^data:image\/[a-z+]+;base64,(.*)$/i.exec(s);
  if (data) return Buffer.from(data[1], 'base64');
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || /^[\\/]{2}/.test(s)) return null;
  let file;
  try { file = path.resolve(baseDir, decodeURIComponent(s.split(/[?#]/)[0])); } catch (_) { return null; }
  if (!isInside(file, baseDir)) return null;
  try { return fs.statSync(file).size <= MAX_IMAGE_BYTES ? fs.readFileSync(file) : null; } catch (_) { return null; }
}

const MAX_IMAGE_WIDTH = 600;

async function blocksToDocx(blocks: Block[], opts: { baseDir: string, title: string }) {
  const D: typeof import('docx') = requireWhenNeeded('docx');
  const baseDir = opts.baseDir;
  const numbering = new Map();
  let instance = 0;
  const numberingRef = (start: number) => {
    if (!numbering.has(start)) numbering.set(start, 'ordered-' + start);
    return numbering.get(start);
  };
  const headingLevels: Record<string, (typeof D.HeadingLevel)[keyof typeof D.HeadingLevel]> = D.HeadingLevel;
  const codeShading = { type: D.ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' };

  function imageRun(r: Run) {
    const buf = imageBytes(r.img, baseDir);
    const info = buf && imageInfo(buf);
    if (!info || !info.w || !info.h) return new D.TextRun({ text: r.alt ? '[' + r.alt + ']' : '', italics: true });
    const scale = Math.min(1, MAX_IMAGE_WIDTH / info.w);
    return new D.ImageRun({ type: info.type, data: buf, transformation: { width: Math.round(info.w * scale), height: Math.round(info.h * scale) }, altText: r.alt ? { name: r.alt, description: r.alt, title: r.alt } : undefined });
  }

  function runObjs(runs: Run[], extra?: Mutable<IRunOptions>) {
    const out: ParagraphChild[] = [];
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

  function taskRuns(runs: Run[]) {
    const first = runs[0];
    const text = first && !first.br && first.img === undefined ? first.text : undefined;
    const m = text === undefined ? null : /^\[( |x|X)\]\s+/.exec(text);
    if (!m || text === undefined) return runs;
    return [{ ...first, text: (m[1] === ' ' ? '☐ ' : '☑ ') + text.slice(m[0].length) }, ...runs.slice(1)];
  }

  function walk(list: Block[], ctx: IParagraphOptions, level: number, out: (Paragraph | Table)[]) {
    for (const b of list) {
      if (b.t === 'h') out.push(new D.Paragraph(Object.assign({ heading: headingLevels['HEADING_' + Math.min(6, b.level)], children: runObjs(b.runs) }, ctx)));
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

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escHtml = (s: string) => String(s).replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
function htmlDocument(title: string, bodyHtml: string, extraCss?: string) {
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + escHtml(title) + '</title>\n' +
    '<style>body{max-width:760px;margin:40px auto;padding:0 20px;font:16px/1.6 Georgia,serif;color:#2a1a12;background:#fbf1e4}h1,h2,h3{line-height:1.2}pre,code{font-family:ui-monospace,Consolas,monospace;font-size:.95em}pre{background:#f6dcc3;padding:12px;border-radius:8px;overflow:auto}blockquote{border-left:4px solid #f47b3e;margin:0;padding:4px 14px;color:#6b5546}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #c9b8a8;padding:4px 8px}ul[data-type="taskList"]{list-style:none;padding-left:0}' + (extraCss || '') + '</style></head>\n' +
    '<body>' + String(bodyHtml || '') + '</body></html>\n';
}
const PRINT_CSS = '@media print{body{background:#fff;margin:0;max-width:none;padding:0}pre{white-space:pre-wrap}}';

function inlinePicturesOnly(markdown: string) {
  return String(markdown).replace(/!\[([^\]]*)\]\((?!data:)(?:<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\)/g, (m, alt) => (alt ? '*[' + alt + ']*' : ''));
}

function firstFree(stem: string, ext: string, make: (name: string) => void) {
  for (let n = 1; n < 1000; n++) {
    const name = stem + (n > 1 ? ' (' + n + ')' : '') + ext;
    try { make(name); return name; } catch (err) { if (err.code !== 'EEXIST') throw err; }
  }
  throw new Error('Too many converted copies already exist next to this file.');
}

function writeNew(dir: string, base: string, ext: string, data: string | Buffer) {
  return path.join(dir, firstFree(base, '.' + ext, (name) => {
    const file = path.join(dir, name);
    const fd = fs.openSync(file, 'wx');
    try { fs.writeFileSync(fd, data); fs.closeSync(fd); } catch (err) {
      try { fs.closeSync(fd); } catch (_) {  }
      fs.rmSync(file, { force: true });
      throw err;
    }
  }));
}

const mkdirNew = (dir: string, name: string) => firstFree(name, '', (folder) => fs.mkdirSync(path.join(dir, folder)));

type Printers = {
  html: (doc: string, baseDir: string) => Promise<Buffer>,
  docx: (bytes: Buffer) => Promise<{ pdf: Buffer, warning: string }>,
};
async function convertFile(note: Note | null, to: string, print: Printers) {
  const src = sourceOf(note);
  if (!src || !isFileNote(note)) throw new Error('This file cannot be converted.');
  if (!FORMATS[to] || to === src) throw new Error('Notes cannot convert this file to that format.');
  if (note.lock) throw new Error('Unlock the note first.');
  const file = note.filePath;
  if (!fs.existsSync(file)) throw new Error('The file no longer exists at ' + file + '.');
  const dir = path.dirname(file);
  const base = path.basename(file, path.extname(file)) || path.basename(file);
  const title = base;

  if (src === 'docx' && to === 'pdf') {
    const out = await print.docx(await readDocumentBuffer(file));
    return { filePath: writeNew(dir, base, 'pdf', out.pdf), warning: out.warning || '' };
  }
  if (src === 'docx' && to === 'html') return { filePath: writeNew(dir, base, 'html', htmlDocument(title, await docxToHtml(file), PRINT_CSS)), warning: '' };
  if (src === 'docx' && to === 'txt') return { filePath: writeNew(dir, base, 'txt', (await readDocxText(file)).body), warning: '' };
  if (src === 'html' && to === 'pdf') return { filePath: writeNew(dir, base, 'pdf', await print.html(readText(file).body, dir)), warning: '' };
  if (src === 'code' && to === 'txt') return { filePath: writeNew(dir, base, 'txt', readText(file).body), warning: '' };

  if (src === 'docx' && to === 'md') {
    let folder: string | null = null;
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
  let data: string | Buffer;
  if (to === 'md') data = markdown;
  else if (to === 'txt') data = blocksToText(markdownBlocks(markdown)) + '\n';
  else if (to === 'html') data = htmlDocument(title, renderMarkdown(markdown), PRINT_CSS);
  else if (to === 'docx') data = await blocksToDocx(markdownBlocks(markdown), { baseDir: dir, title });
  else if (to === 'pdf') data = await print.html(htmlDocument(title, renderMarkdown(markdown, true), PRINT_CSS), dir);
  else throw new Error('Notes cannot convert this file to that format.');
  return { filePath: writeNew(dir, base, to, data), warning };
}

export { FORMATS, sourceOf, options, convertFile, toMarkdown, textToMarkdown, markdownBlocks, blocksToText, htmlDocument, escHtml, imageInfo, isInside, inlinePicturesOnly, writeNew };
