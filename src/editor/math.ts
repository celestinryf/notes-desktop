import { Editor, InputRule, Mark, Node as TiptapNode, type Range as TextRange } from '@tiptap/core';
import type { MarkdownSerializerState } from '@tiptap/pm/markdown';
import type { Node as PMNode, NodeType } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state';
import type MarkdownIt from 'markdown-it';
import katex from 'katex';
import 'katex/contrib/mhchem';
import { KATEX_OPTIONS, addMath, blockLatexForSaving, formulaErrorText, inlineLatexForSaving, mathSource } from '../shared/math.mts';

export type MathKind = 'inline' | 'block';

export type MathEdit = {
  kind: MathKind,
  latex: string,
  anchor: HTMLElement,
  preview: (latex: string) => void,
  finish: (latex: string) => void,
  remove: () => void,
};

export type MathOptions = { onEditMath: ((edit: MathEdit) => void) | null };


export function renderMath(target: HTMLElement, latex: string, display: boolean) {
  const source = latex.trim();
  target.classList.toggle('is-empty', !source);
  if (!source) { target.textContent = display ? 'Empty formula' : 'Empty'; return; }
  katex.render(source, target, Object.assign({ displayMode: display }, KATEX_OPTIONS));
}

export function mathError(latex: string) {
  const source = latex.trim();
  if (!source) return null;
  try {
    katex.renderToString(source, Object.assign({}, KATEX_OPTIONS, { throwOnError: true }));
    return null;
  } catch (err) {
    return formulaErrorText(err instanceof Error ? err.message : String(err));
  }
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const parsersWithMath = new WeakSet<MarkdownIt>();
function addMathToParser(md: MarkdownIt) {
  if (parsersWithMath.has(md)) return;
  parsersWithMath.add(md);
  addMath(md, {
    inline: (latex, display) => '<span data-math="' + (display ? 'display' : 'inline') + '" data-latex="' + escapeAttr(latex) + '"></span>',
    block: (latex) => '<div data-math="block" data-latex="' + escapeAttr(latex) + '"></div>\n',
    dollar: () => '<span data-escaped-dollar="">$</span>',
  });
}

export const EscapedDollar = Mark.create({
  name: 'escapedDollar',
  inclusive: false,
  spanning: false,
  excludes: '',
  parseHTML() {
    return [{ tag: 'span[data-escaped-dollar]', priority: 60 }];
  },
  renderHTML() {
    return ['span', { 'data-escaped-dollar': '' }, 0];
  },
  addStorage() {
    return { markdown: { serialize: { open: '', close: '' }, parse: { setup: addMathToParser } } };
  },
});

export const hasEscapedDollar = (node: PMNode) => node.marks.some((m) => m.type.name === 'escapedDollar');

const nodeKind = (node: PMNode): MathKind | null => (node.type.name === 'inlineMath' ? 'inline' : node.type.name === 'blockMath' ? 'block' : null);

export function startMathEdit(editor: Editor, pos: number, onEditMath: MathOptions['onEditMath']) {
  const node = editor.state.doc.nodeAt(pos);
  const kind = node ? nodeKind(node) : null;
  const anchor = editor.view.nodeDOM(pos);
  if (!node || !kind || !onEditMath || !editor.isEditable || !(anchor instanceof HTMLElement)) return false;
  const type = node.type;
  const original = String(node.attrs.latex);
  let at = pos;
  let known = editor.state.doc;
  const locate = () => {
    if (editor.isDestroyed || editor.state.doc !== known) return null;
    const here = editor.state.doc.nodeAt(at);
    return here && here.type === type ? here : null;
  };
  const write = (latex: string, history: boolean) => {
    const here = locate();
    if (!here || here.attrs.latex === latex) return;
    const tr = editor.state.tr.setNodeMarkup(at, undefined, Object.assign({}, here.attrs, { latex }));
    if (!history) tr.setMeta('addToHistory', false);
    editor.view.dispatch(tr);
  };
  const mapper = ({ transaction }: { transaction: Transaction }) => {
    if (transaction.docChanged && transaction.before === known) at = transaction.mapping.map(at, 1);
    if (transaction.before === known) known = transaction.doc;
  };
  editor.on('transaction', mapper);
  let open = true;
  anchor.classList.add('is-editing');
  const close = () => { open = false; anchor.classList.remove('is-editing'); editor.off('transaction', mapper); };
  const caretAfter = () => {
    const here = locate();
    if (!here) return;
    const after = at + here.nodeSize;
    const tr = editor.state.tr;
    tr.setSelection(kind === 'inline' ? TextSelection.create(tr.doc, after) : NodeSelection.create(tr.doc, at));
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
  };
  onEditMath({
    kind,
    latex: kind === 'block' ? original.replace(/^\n|\n$/g, '') : original,
    anchor,
    preview: (latex) => { if (open) write(latex, false); },
    finish: (latex) => {
      if (!open) return;
      const saved = kind === 'inline' ? inlineLatexForSaving(latex) : blockLatexForSaving(latex);
      if (kind === 'inline' && !saved) { write(original, false); close(); removeAt(editor, at, type); editor.view.focus(); return; }
      write(original, false);
      write(saved, true);
      close();
      caretAfter();
    },
    remove: () => {
      if (!open) return;
      write(original, false);
      close();
      removeAt(editor, at, type);
      editor.view.focus();
    },
  });
  return true;
}

function removeAt(editor: Editor, pos: number, type: NodeType) {
  const here = editor.state.doc.nodeAt(pos);
  if (!here || here.type !== type) return;
  const tr = editor.state.tr.delete(pos, pos + here.nodeSize);
  editor.view.dispatch(tr.scrollIntoView());
}

function mathNodeView(display: (node: PMNode) => boolean, tag: 'span' | 'div', className: string, options: MathOptions) {
  return ({ node, editor, getPos }: { node: PMNode, editor: Editor, getPos: (() => number | undefined) | boolean }) => {
    const dom: HTMLElement = document.createElement(tag);
    dom.className = className;
    dom.contentEditable = 'false';
    let shown: string | null = null;
    let shownDisplay = false;
    const draw = (n: PMNode) => {
      const latex = String(n.attrs.latex);
      const asDisplay = display(n);
      if (latex === shown && asDisplay === shownDisplay) return;
      shown = latex;
      shownDisplay = asDisplay;
      dom.setAttribute('data-latex', latex);
      renderMath(dom, latex, asDisplay);
    };
    draw(node);
    dom.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || typeof getPos !== 'function') return;
      const pos = getPos();
      if (typeof pos === 'number') startMathEdit(editor, pos, options.onEditMath);
    });
    return {
      dom,
      update: (next: PMNode) => {
        if (next.type !== node.type) return false;
        draw(next);
        return true;
      },
      selectNode: () => dom.classList.add('is-selected'),
      deselectNode: () => dom.classList.remove('is-selected'),
      ignoreMutation: () => true,
    };
  };
}

const INLINE_TYPED = /(?:^|[^\\$])(\$([^\s$](?:[^$\n]*[^\s$\\])?)\$)$/;
const BLOCK_TYPED = /^\$\$\s$/;

function editSelected(editor: Editor, options: MathOptions) {
  const sel = editor.state.selection;
  if (!(sel instanceof NodeSelection) || !nodeKind(sel.node)) return false;
  return startMathEdit(editor, sel.from, options.onEditMath);
}

export const InlineMath = TiptapNode.create<MathOptions>({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { onEditMath: null };
  },
  addAttributes() {
    return { latex: { default: '' }, display: { default: false } };
  },
  extendNodeSchema(extension) {
    return extension.name === 'inlineMath' ? { leafText: (node: PMNode) => String(node.attrs.latex) } : {};
  },
  parseHTML() {
    return [{ tag: 'span[data-math]', priority: 60, getAttrs: (el: HTMLElement) => ({ latex: el.getAttribute('data-latex') || '', display: el.getAttribute('data-math') === 'display' }) }];
  },
  renderHTML({ node }) {
    const display = node.attrs.display === true;
    return ['span', { 'data-math': display ? 'display' : 'inline', 'data-latex': String(node.attrs.latex) }, mathSource(String(node.attrs.latex), display)];
  },
  addNodeView() {
    return mathNodeView((n) => n.attrs.display === true, 'span', 'math-inline', this.options);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          const latex = String(node.attrs.latex);
          if (!latex) return;
          const inTable = 'inTable' in state && state.inTable === true;
          state.text(mathSource(inTable ? latex.replace(/(?<!\\)\|/g, '\\|') : latex, node.attrs.display === true), false);
        },
        parse: { setup: addMathToParser },
      },
    };
  },
  addInputRules() {
    return [new InputRule({
      find: INLINE_TYPED,
      handler: ({ state, range, match }) => {
        const whole = match[1];
        const from = range.to - (whole.length - 1);
        state.tr.replaceWith(from, range.to, this.type.create({ latex: match[2] }));
      },
    })];
  },
  addKeyboardShortcuts() {
    return { Enter: () => editSelected(this.editor, this.options) };
  },
});

export const BlockMath = TiptapNode.create<MathOptions>({
  name: 'blockMath',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addOptions() {
    return { onEditMath: null };
  },
  addAttributes() {
    return { latex: { default: '\n' } };
  },
  extendNodeSchema(extension) {
    return extension.name === 'blockMath' ? { leafText: (node: PMNode) => String(node.attrs.latex).trim() } : {};
  },
  parseHTML() {
    return [{ tag: 'div[data-math="block"]', priority: 60, getAttrs: (el: HTMLElement) => ({ latex: el.getAttribute('data-latex') || '\n' }) }];
  },
  renderHTML({ node }) {
    return ['div', { 'data-math': 'block', 'data-latex': String(node.attrs.latex) }, mathSource(String(node.attrs.latex), true)];
  },
  addNodeView() {
    return mathNodeView(() => true, 'div', 'math-block', this.options);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          state.write('$$');
          state.text(String(node.attrs.latex), false);
          state.write('$$');
          state.closeBlock(node);
        },
        parse: { setup: addMathToParser },
      },
    };
  },
  addInputRules() {
    return [new InputRule({
      find: BLOCK_TYPED,
      handler: ({ state, range }) => {
        const $from = state.doc.resolve(range.from);
        if ($from.parent.type.name !== 'paragraph' || $from.depth < 1 || range.to !== $from.end()) return null;
        const start = $from.before();
        state.tr.replaceWith(start, $from.after(), this.type.create());
        const editor = this.editor;
        const options = this.options;
        setTimeout(() => { startMathEdit(editor, start, options.onEditMath); }, 0);
      },
    })];
  },
  addKeyboardShortcuts() {
    return { Enter: () => editSelected(this.editor, this.options) };
  },
});

export function insertMath(editor: Editor, kind: MathKind, range: TextRange | null, options: MathOptions) {
  if (!editor.isEditable) return false;
  const sel = editor.state.selection;
  const from = range ? range.from : sel.from;
  const to = range ? range.to : sel.to;
  const picked = from !== to ? editor.state.doc.textBetween(from, to, ' ') : '';
  if (kind === 'inline') {
    const node = editor.schema.nodes.inlineMath.create({ latex: inlineLatexForSaving(picked) });
    editor.view.dispatch(editor.state.tr.replaceWith(from, to, node).scrollIntoView());
    return startMathEdit(editor, from, options.onEditMath);
  }
  const ok = editor.chain().focus().deleteRange({ from, to }).insertContent({ type: 'blockMath', attrs: { latex: picked ? blockLatexForSaving(picked) : '\n' } }).run();
  if (!ok) return false;
  let at = -1;
  editor.state.doc.nodesBetween(Math.max(0, from - 2), Math.min(editor.state.doc.content.size, from + 4), (n, pos) => { if (at === -1 && n.type.name === 'blockMath') at = pos; });
  return at !== -1 && startMathEdit(editor, at, options.onEditMath);
}
