import { getHTMLFromFragment } from '@tiptap/core';
import type { MarkdownSerializerState } from '@tiptap/pm/markdown';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import type MarkdownIt from 'markdown-it';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { isRecord } from '../shared/helpers.mts';

type Align = '' | 'left' | 'right' | 'center';
type TableStyle = { delimiter: string; padded: boolean; aligned: boolean; aligns: Align[]; headJustify: Align[]; bodyJustify: Align[] };

const TABLE_LINE = /^ {0,3}\|.*\|[ \t]*$/;
const PIPE = /(?<!\\)\|/g;

const cellsOf = (line: string) => line.trim().slice(1, -1).split(PIPE);

function alignOf(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(':'), right = c.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
}

function styleOf(rows: string[]): TableStyle | null {
  if (rows.length < 2 || !rows.every((r) => TABLE_LINE.test(r))) return null;
  const lines = rows.map((r) => r.replace(/[ \t]+$/, '').replace(/^ +/, ''));
  const pipesAt = (l: string) => Array.from(l.matchAll(PIPE), (m) => m.index).join(',');
  const padded = /^\|[ \t]/.test(lines[0]);
  const aligned = padded && /^\|[ \t]/.test(lines[1]) && cellsOf(lines[1]).every((c) => c.trim().length >= 3) && lines.every((l) => l.length === lines[0].length && pipesAt(l) === pipesAt(lines[0]));
  const aligns = cellsOf(lines[1]).map(alignOf);
  const justifyOf = (rows: string[][]) => aligns.map((_, i): Align => {
    const cells = rows.map((r) => r[i] || '').filter((c) => c.trim());
    if (cells.every((c) => /^ \S/.test(c))) return 'left';
    if (cells.every((c) => /\S $/.test(c))) return 'right';
    return 'center';
  });
  return { delimiter: lines[1], padded, aligned, aligns, headJustify: justifyOf([cellsOf(lines[0])]), bodyJustify: justifyOf(lines.slice(2).map(cellsOf)) };
}

const asAligns = (list: unknown[]) => list.map((a): Align => (a === 'left' || a === 'right' || a === 'center' ? a : ''));

function readStyle(value: unknown): TableStyle | null {
  if (!isRecord(value) || typeof value.delimiter !== 'string' || typeof value.padded !== 'boolean' || typeof value.aligned !== 'boolean') return null;
  if (!Array.isArray(value.aligns) || !Array.isArray(value.headJustify) || !Array.isArray(value.bodyJustify)) return null;
  return { delimiter: value.delimiter, padded: value.padded, aligned: value.aligned, aligns: asAligns(value.aligns), headJustify: asAligns(value.headJustify), bodyJustify: asAligns(value.bodyJustify) };
}

function addTableStyles(md: MarkdownIt) {
  md.core.ruler.push('notes_table_style', (state) => {
    const lines = state.src.split('\n');
    for (const token of state.tokens) {
      if (token.type !== 'table_open' || !token.map) continue;
      const style = styleOf(lines.slice(token.map[0], token.map[1]).map((l) => l.replace(/\r$/, '')));
      if (style) token.attrSet('data-md-table', JSON.stringify(style));
    }
  });
}

const childrenOf = (node: PMNode) => { const out: PMNode[] = []; node.forEach((c) => out.push(c)); return out; };
const spans = (cell: PMNode) => cell.attrs.colspan > 1 || cell.attrs.rowspan > 1;

function fitsMarkdown(table: PMNode) {
  const [head, ...body] = childrenOf(table);
  if (!head || childrenOf(head).some((c) => c.type.name !== 'tableHeader' || spans(c) || c.childCount > 1)) return false;
  return !body.some((row) => childrenOf(row).some((c) => c.type.name === 'tableHeader' || spans(c) || c.childCount > 1));
}

function htmlBlock(node: PMNode, parent: PMNode | Fragment) {
  const html = getHTMLFromFragment(Fragment.from(node), node.type.schema);
  if (!(parent instanceof Fragment) && parent.type.name !== node.type.schema.topNodeType.name) return html;
  const element = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html').body.firstElementChild;
  if (!element) return html;
  element.innerHTML = element.innerHTML.trim() ? '\n' + element.innerHTML + '\n' : '\n';
  return element.outerHTML;
}

type CellWriter = (cell: PMNode) => string;

function cellWriter(context: unknown): CellWriter | null {
  const editor = isRecord(context) ? context.editor : null;
  const storage = isRecord(editor) ? editor.storage : null;
  const markdown = isRecord(storage) ? storage.markdown : null;
  const serializer = isRecord(markdown) ? markdown.serializer : null;
  const serialize = isRecord(serializer) ? serializer.serialize : null;
  if (typeof serialize !== 'function') return null;
  return (cell) => {
    const md: unknown = serialize.call(serializer, cell);
    return typeof md === 'string' ? inCell(md) : '';
  };
}

function inCell(md: string) {
  return md
    .replace(/\\\n/g, '<br>')
    .replace(/\n/g, ' ')
    .replace(/^\\([-+>])/, '$1')
    .replace(/^(\d+)\\\./, '$1.')
    .replace(/^\\(#{1,6})(?=\s|$)/, '$1')
    .replace(/(\\*)\|/g, (all: string, slashes: string) => (slashes.length % 2 ? all : slashes + '\\|'));
}

function dashes(width: number, align: Align) {
  const w = Math.max(width, 3);
  if (align === 'center') return ':' + '-'.repeat(w - 2) + ':';
  if (align === 'left') return ':' + '-'.repeat(w - 1);
  if (align === 'right') return '-'.repeat(w - 1) + ':';
  return '-'.repeat(w);
}

function pad(text: string, width: number, align: Align) {
  const room = Math.max(0, width - text.length);
  if (align === 'right') return ' '.repeat(room) + text;
  if (align === 'center') return ' '.repeat(Math.floor(room / 2)) + text + ' '.repeat(room - Math.floor(room / 2));
  return text + ' '.repeat(room);
}

function tableLines(rows: string[][], aligns: Align[], style: TableStyle | null) {
  const keep = !!style && style.aligns.length === aligns.length && style.aligns.every((a, i) => a === aligns[i]);
  const padded = !style || style.padded;
  if (style && style.aligned) {
    const widths = aligns.map((_, i) => Math.max(3, ...rows.map((r) => r[i].length)));
    const justify = (from: Align[]) => aligns.map((a, i) => (keep ? from[i] : a) || 'left');
    const head = justify(style.headJustify), body = justify(style.bodyJustify);
    const line = (cells: string[]) => '| ' + cells.join(' | ') + ' |';
    const out = rows.map((r, n) => line(r.map((c, i) => pad(c, widths[i], (n ? body : head)[i]))));
    out.splice(1, 0, line(widths.map((w, i) => dashes(w, aligns[i]))));
    return out;
  }
  const line = (cells: string[]) => (padded ? '| ' + cells.join(' | ') + ' |' : '|' + cells.map((c) => (c.endsWith('\\') ? c + ' ' : c)).join('|') + '|');
  const delimiter = keep && style ? style.delimiter : line(aligns.map((a) => dashes(3, a)));
  const out = rows.map(line);
  out.splice(1, 0, delimiter);
  return out;
}

const alignAttribute = {
  align: {
    default: null,
    parseHTML: (el: HTMLElement) => { const a = el.style.textAlign; return a === 'left' || a === 'right' || a === 'center' ? a : null; },
    renderHTML: (attrs: Record<string, unknown>) => (attrs.align === 'left' || attrs.align === 'right' || attrs.align === 'center' ? { style: 'text-align: ' + attrs.align } : {}),
  },
};

export const NotesTableHeader = TableHeader.extend({
  addAttributes() { return Object.assign({}, this.parent ? this.parent() : {}, alignAttribute); },
});

export const NotesTableCell = TableCell.extend({
  addAttributes() { return Object.assign({}, this.parent ? this.parent() : {}, alignAttribute); },
});

export const NotesTable = Table.extend({
  addAttributes() {
    return Object.assign({}, this.parent ? this.parent() : {}, {
      mdTable: {
        default: null,
        parseHTML: (el: HTMLElement) => { try { return readStyle(JSON.parse(el.getAttribute('data-md-table') || 'null')); } catch (_) { return null; } },
        renderHTML: () => ({}),
      },
    });
  },
  addStorage() {
    return {
      markdown: {
        serialize(this: unknown, state: MarkdownSerializerState, node: PMNode, parent: PMNode | Fragment) {
          const write = cellWriter(this);
          if (!write || !fitsMarkdown(node)) { state.write(htmlBlock(node, parent)); state.closeBlock(node); return; }
          state.write('');
          const rows = childrenOf(node).map((row) => childrenOf(row).map(write));
          const aligns = childrenOf(childrenOf(node)[0]).map((cell) => asAligns([cell.attrs.align])[0]);
          tableLines(rows, aligns, readStyle(node.attrs.mdTable)).forEach((l) => { state.write(l); state.ensureNewLine(); });
          state.closeBlock(node);
        },
        parse: { setup: addTableStyles },
      },
    };
  },
});
