import { Editor, Extension, InputRule, Node as TiptapNode, mergeAttributes, nodeInputRule, nodePasteRule, type Attributes, type ChainedCommands, type FocusPosition, type Range as TextRange } from '@tiptap/core';
import type { MarkdownSerializerState } from '@tiptap/pm/markdown';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type MarkdownIt from 'markdown-it';
import type { StateInline } from 'markdown-it';
import { isRecord, wikiLinkLabel, wikiLinkName } from '../shared/helpers.mts';
import StarterKit from '@tiptap/starter-kit';
import Text from '@tiptap/extension-text';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';

function fingerprint(md: string | null | undefined) {
  let s = String(md || '').replace(/\r/g, '');
  if (/^---\n[A-Za-z_][\w-]*:[^\n]*\n(?:[\s\S]*?\n)?---(\n|$)/.test(s)) return 'front-matter:' + s;
  if (/^(~~~|````)/m.test(s)) return 'odd-fence:' + s;
  if (/(\\| {2,})\n[ \t]*(>|#{1,6}\s|[-+*]\s|\d+[.)]\s)/.test(s.replace(/```[\s\S]*?```/g, ''))) return 'break-before-block:' + s;
  s = s.replace(/`[^`\n]*`/g, (span) => span.replace(/ /g, 'ꞏ'));
  s = s
    .replace(/\\\n/g, '\n')
    .replace(/ {2,}\n/g, '\n')
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/^(\s*)\d+[.)]\s/gm, '$11. ');
  return s.split('\n').map((l) => l.replace(/[^\p{L}\p{N}:/.<>]+/gu, '').toLowerCase()).filter(Boolean).join('\n');
}

const PlainText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          state.text(String(node.text).replace(/&(?=[A-Za-z]+;|#\d+;|#x[0-9A-Fa-f]+;)/g, '&amp;').replace(/<(?=[A-Za-z/!?])/g, '&lt;'));
        },
        parse: {},
      },
    };
  },
});

const NotesKeys = Extension.create({
  name: 'notesKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive('table')) return false;
        if (this.editor.isActive('codeBlock')) return this.editor.commands.insertContent('\t');
        return this.editor.commands.sinkListItem('listItem') || this.editor.commands.sinkListItem('taskItem') || true;
      },
      'Shift-Tab': () => this.editor.commands.liftListItem('listItem') || this.editor.commands.liftListItem('taskItem'),
      'Mod-e': () => true,
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
      'Mod-Shift-s': () => true,
    };
  },
});

const TaskListTight = Extension.create({
  name: 'taskListTight',
  addGlobalAttributes() {
    return [{
      types: ['taskList'],
      attributes: {
        tight: {
          default: true,
          parseHTML: (el: HTMLElement) => el.getAttribute('data-tight') === 'true' || !el.querySelector('li > div > p + p'),
          renderHTML: (attrs) => ({ 'data-tight': attrs.tight ? 'true' : null }),
        },
      },
    }];
  },
});

const DashCheckbox = Extension.create({
  name: 'dashCheckbox',
  addInputRules() {
    return [new InputRule({
      find: /^\[( |x|X)?\]\s$/,
      handler: ({ state, range, match, chain }) => {
        const $from = state.selection.$from;
        const item = $from.depth >= 2 ? $from.node(-1) : null;
        const list = $from.depth >= 3 ? $from.node(-2) : null;
        if (!item || !list || item.type.name !== 'listItem' || list.type.name !== 'bulletList') return null;
        const checked = (match[1] || '').toLowerCase() === 'x';
        chain().deleteRange(range).toggleTaskList().run();
        if (checked) chain().updateAttributes('taskItem', { checked: true }).run();
      },
    })];
  },
});

type TriggerOptions = {
  onTrigger?: (trigger: (Trigger & { rect: TriggerRect }) | null) => void,
  onTriggerKey?: (event: KeyboardEvent) => boolean | void,
};

export type Trigger = { kind: 'slash' | 'link', query: string, from: number, to: number };
export type TriggerRect = { left: number, top: number, bottom: number };

export function detectTrigger(state: EditorState): Trigger | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $p = sel.$from;
  const parent = $p.parent;
  if (!parent.isTextblock || parent.type.spec.code) return null;
  if ($p.marks().some((m) => m.type.spec.code)) return null;
  const before = parent.textBetween(0, $p.parentOffset, undefined, '￼');
  let m = /(?:^|\s)\/((?:[\p{L}\p{N}]{1,20}(?: [\p{L}\p{N}]{0,12})?)?)$/u.exec(before);
  if (m) { const q = m[1] || ''; return { kind: 'slash', query: q, from: $p.pos - q.length - 1, to: $p.pos }; }
  m = /\[\[([^[\]\n￼]{0,60})$/.exec(before);
  if (m) return { kind: 'link', query: m[1], from: $p.pos - m[1].length - 2, to: $p.pos };
  return null;
}

function triggers(options: TriggerOptions) {
  return Extension.create({
    name: 'notesTriggers',
    addProseMirrorPlugins() {
      let lastKey: string | null = null;
      return [new Plugin({
        key: new PluginKey('notesTriggers'),
        view: () => ({
          update: (view) => {
            const t = view.hasFocus() || lastKey ? detectTrigger(view.state) : null;
            const key = t ? t.kind + ':' + t.from + ':' + t.query : null;
            if (key === lastKey) return;
            lastKey = key;
            if (!options.onTrigger) return;
            if (!t) { options.onTrigger(null); return; }
            const at = view.coordsAtPos(t.from);
            options.onTrigger(Object.assign(t, { rect: { left: at.left, top: at.top, bottom: at.bottom } }));
          },
          destroy: () => { if (lastKey && options.onTrigger) options.onTrigger(null); lastKey = null; },
        }),
        props: {
          handleKeyDown: (_view, e) => (lastKey && options.onTriggerKey ? !!options.onTriggerKey(e) : false),
          handleDOMEvents: { blur: () => { if (lastKey && options.onTrigger) { lastKey = null; options.onTrigger(null); } return false; } },
        },
      })];
    },
  });
}

const WIKI_LINK_AT = /^(!?)\[\[([^[\]\n]+?)\]\]/;
const WIKI_LINK_TYPED = /(!?)\[\[([^[\]\n]+)\]\]$/;
const WIKI_LINK_PASTED = /(!?)\[\[([^[\]\n]+)\]\]/g;
const wikiAttrs = (m: RegExpMatchArray) => ({ raw: m[2], embed: m[1] === '!' });
const parsersWithWikiLinks = new WeakSet<MarkdownIt>();

function wikiLinkRule(state: StateInline, silent: boolean) {
  const first = state.src.charCodeAt(state.pos);
  if (first !== 0x5b && first !== 0x21) return false;
  const m = WIKI_LINK_AT.exec(state.src.slice(state.pos, state.posMax));
  if (!m) return false;
  if (!silent) state.push('wikilink', '', 0).meta = wikiAttrs(m);
  state.pos += m[0].length;
  return true;
}

function addWikiLinks(md: MarkdownIt) {
  if (parsersWithWikiLinks.has(md)) return;
  parsersWithWikiLinks.add(md);
  md.inline.ruler.before('link', 'wikilink', wikiLinkRule);
  md.renderer.rules.wikilink = (tokens, idx) => {
    const meta: unknown = tokens[idx].meta;
    if (!isRecord(meta) || typeof meta.raw !== 'string') return '';
    const esc = md.utils.escapeHtml;
    return '<a data-wikilink="' + esc(meta.raw) + '"' + (meta.embed === true ? ' data-embed=""' : '') + '>' + esc(wikiLinkLabel(meta.raw)) + '</a>';
  };
}

function lineEdge(view: EditorView, forward: boolean, extend: boolean) {
  const { state } = view;
  const sel = state.selection;
  const $head = state.doc.resolve(sel.head);
  if (!$head.parent.isTextblock) return false;
  let hasLink = false;
  $head.parent.forEach((n) => { if (n.type.name === 'wikiLink') hasLink = true; });
  if (!hasLink) return false;
  const start = $head.start(), end = $head.end();
  const here = view.coordsAtPos(sel.head, forward ? -1 : 1);
  const middle = (here.top + here.bottom) / 2;
  let pos = sel.head;
  for (let next = pos + (forward ? 1 : -1); next >= start && next <= end; next += forward ? 1 : -1) {
    const c = view.coordsAtPos(next, forward ? -1 : 1);
    if (middle < c.top || middle > c.bottom) break;
    pos = next;
  }
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, extend ? sel.anchor : pos, pos)).scrollIntoView());
  return true;
}

const WikiLink = TiptapNode.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { raw: { default: '' }, embed: { default: false } };
  },
  extendNodeSchema(extension) {
    return extension.name === 'wikiLink' ? { leafText: (node: PMNode) => wikiLinkLabel(String(node.attrs.raw)) } : {};
  },
  parseHTML() {
    return [{ tag: 'a[data-wikilink]', priority: 60, getAttrs: (el: HTMLElement) => ({ raw: el.getAttribute('data-wikilink') || '', embed: el.hasAttribute('data-embed') }) }];
  },
  renderHTML({ node }) {
    const raw = String(node.attrs.raw);
    const label = wikiLinkLabel(raw);
    return ['a', { class: 'wikilink', 'data-wikilink': raw, 'data-embed': node.attrs.embed ? '' : null, title: 'Open "' + label + '" (Ctrl+click or Alt+Enter)' }, label];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          const raw = String(node.attrs.raw);
          const inTable = 'inTable' in state && state.inTable === true;
          state.write((node.attrs.embed ? '!' : '') + '[[' + (inTable ? raw.replace(/(^|[^\\])\|/g, '$1\\|') : raw) + ']]');
        },
        parse: { setup: addWikiLinks },
      },
    };
  },
  addInputRules() {
    return [nodeInputRule({ find: WIKI_LINK_TYPED, type: this.type, getAttributes: wikiAttrs })];
  },
  addKeyboardShortcuts() {
    const edge = (forward: boolean, extend: boolean) => () => lineEdge(this.editor.view, forward, extend);
    return { End: edge(true, false), 'Shift-End': edge(true, true), Home: edge(false, false), 'Shift-Home': edge(false, true) };
  },
  addPasteRules() {
    return [nodePasteRule({ find: WIKI_LINK_PASTED, type: this.type, getAttributes: wikiAttrs })];
  },
});

export type WikiLinkResolver = (names: string[]) => Promise<(string | null)[] | null>;
type WikiStatus = { unresolved: ReadonlySet<string> };
const wikiStatusKey = new PluginKey<WikiStatus>('wikiLinkStatus');

function wikiNames(doc: PMNode) {
  const names = new Set<string>();
  doc.descendants((node) => { if (node.type.name === 'wikiLink') names.add(wikiLinkName(String(node.attrs.raw))); });
  return Array.from(names).sort();
}

function wikiLinkStatus(resolve: WikiLinkResolver | undefined, requests: { reset: () => void }) {
  return Extension.create({
    name: 'wikiLinkStatus',
    addProseMirrorPlugins() {
      let asked: string | null = null;
      return [new Plugin<WikiStatus>({
        key: wikiStatusKey,
        state: {
          init: () => ({ unresolved: new Set<string>() }),
          apply: (tr, value) => tr.getMeta(wikiStatusKey) || value,
        },
        props: {
          decorations(state) {
            const status = wikiStatusKey.getState(state);
            if (!status || !status.unresolved.size) return null;
            const found: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'wikiLink') return;
              const raw = String(node.attrs.raw);
              if (!status.unresolved.has(wikiLinkName(raw))) return;
              const title = node.attrs.embed ? 'Embedded file "' + wikiLinkLabel(raw) + '": the Markdown source (Ctrl+E) shows the embed' : 'No note named "' + wikiLinkLabel(raw) + '" in this vault';
              found.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-unresolved', title, 'aria-label': wikiLinkLabel(raw) + (node.attrs.embed ? ', embedded file' : ', no note in this vault') }));
            });
            return DecorationSet.create(state.doc, found);
          },
        },
        view: (view) => {
          const check = () => {
            if (!resolve) return;
            const names = wikiNames(view.state.doc);
            const key = names.join('\n');
            if (key === asked) return;
            asked = key;
            if (!names.length) { view.dispatch(view.state.tr.setMeta(wikiStatusKey, { unresolved: new Set() }).setMeta('addToHistory', false)); return; }
            resolve(names).then((ids) => {
              if (!ids || asked !== key || view.isDestroyed) return;
              const unresolved = new Set(names.filter((_, i) => !ids[i]));
              view.dispatch(view.state.tr.setMeta(wikiStatusKey, { unresolved }).setMeta('addToHistory', false));
            }).catch(() => {});
          };
          requests.reset = () => { asked = null; check(); };
          check();
          return { update: check };
        },
      })];
    },
  });
}

export type LinkAtCaret = { wiki: string } | { href: string } | null;

function caretLink(state: EditorState): LinkAtCaret {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === 'wikiLink') return { wiki: String(sel.node.attrs.raw) };
  for (const n of [sel.$from.nodeAfter, sel.$from.nodeBefore]) if (n && n.type.name === 'wikiLink') return { wiki: String(n.attrs.raw) };
  const link = sel.$from.marks().find((m) => m.type.name === 'link');
  return link && link.attrs.href ? { href: String(link.attrs.href) } : null;
}

function caretLinkWatch(onLinkAtCaret: ((on: boolean) => void) | undefined) {
  return Extension.create({
    name: 'caretLinkWatch',
    addProseMirrorPlugins() {
      let on = false;
      return [new Plugin({
        key: new PluginKey('caretLinkWatch'),
        view: () => ({
          update: (view) => {
            const next = view.hasFocus() && caretLink(view.state) !== null;
            if (next === on) return;
            on = next;
            if (onLinkAtCaret) onLinkAtCaret(on);
          },
        }),
        props: { handleDOMEvents: { blur: () => { if (on) { on = false; if (onLinkAtCaret) onLinkAtCaret(false); } return false; } } },
      })];
    },
  });
}

const BLOCKS: Record<string, (c: ChainedCommands) => ChainedCommands> = {
  h1: (c) => c.setNode('heading', { level: 1 }),
  h2: (c) => c.setNode('heading', { level: 2 }),
  h3: (c) => c.setNode('heading', { level: 3 }),
  text: (c) => c.setParagraph(),
  bullets: (c) => c.toggleBulletList(),
  numbers: (c) => c.toggleOrderedList(),
  checklist: (c) => c.toggleTaskList(),
  quote: (c) => c.toggleBlockquote(),
  code: (c) => c.toggleCodeBlock(),
  divider: (c) => c.setHorizontalRule(),
  table: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
};

export { fingerprint };

const NO_BASE = 'file:///notes-app-no-base/';
export function resolveImageSrc(src: string | null | undefined, base: string | null | undefined) {
  const s = String(src || '');
  if (/^\s*(data|https?|attachment|blob):/i.test(s)) return s;
  let u;
  try { u = new URL(s, base || NO_BASE); } catch (_) { return ''; }
  if (u.protocol === 'file:' && ((u.hostname && u.hostname !== 'localhost') || u.pathname.startsWith('//'))) return '';
  if (!base && !/^\s*[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return u.href;
}

function pictures(imageBase: (() => string | null) | undefined) {
  return Image.extend({
    addAttributes() {
      const parent: Partial<Attributes> = this.parent ? this.parent() : {};
      return Object.assign({}, parent, { src: Object.assign({}, parent.src, { parseHTML: (el: HTMLElement) => el.getAttribute('data-src') || el.getAttribute('src') }) });
    },
    renderHTML({ HTMLAttributes }) {
      const written = HTMLAttributes.src;
      const attrs = Object.assign({}, HTMLAttributes, { src: resolveImageSrc(written, imageBase ? imageBase() : null), 'data-src': written });
      return ['img', mergeAttributes(this.options.HTMLAttributes, attrs)];
    },
  }).configure({ inline: true, allowBase64: true });
}

export type EditorOptions = TriggerOptions & {
  content?: string,
  placeholder?: string,
  imageBase?: () => string | null,
  onUpdate?: (markdown: string) => void,
  resolveWikiLinks?: WikiLinkResolver,
  onLinkAtCaret?: (on: boolean) => void,
};

export function create(element: HTMLElement, options: EditorOptions) {
  options = options || {};
  let suppress = false;
  const wikiRequests = { reset: () => {} };
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ text: false, heading: { levels: [1, 2, 3, 4, 5, 6] }, codeBlock: { HTMLAttributes: { spellcheck: 'false' } } }),
      PlainText,
      TaskList.configure({ HTMLAttributes: { 'data-type': 'taskList' } }),
      TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
      TaskListTight,
      DashCheckbox,
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, protocols: ['note', 'attachment'], HTMLAttributes: { rel: 'noopener', target: '_blank' } }),
      pictures(options.imageBase),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: options.placeholder || 'Start writing…' }),
      Markdown.configure({ html: true, tightLists: true, bulletListMarker: '-', linkify: false, breaks: true, transformPastedText: false, transformCopiedText: true }),
      NotesKeys,
      triggers(options),
      WikiLink,
      wikiLinkStatus(options.resolveWikiLinks, wikiRequests),
      caretLinkWatch(options.onLinkAtCaret),
    ],
    content: options.content || '',
    autofocus: false,
    editorProps: { attributes: { class: 'rich-editor-content', spellcheck: 'true' } },
    onUpdate: () => { if (!suppress && options.onUpdate) options.onUpdate(getMarkdown()); },
  });

  function getMarkdown() {
    return editor.storage.markdown.getMarkdown();
  }

  function liveRange() {
    const sel = element.ownerDocument.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode || !editor.view.dom.contains(sel.anchorNode) || !editor.view.dom.contains(sel.focusNode)) return null;
    try {
      const a = editor.view.posAtDOM(sel.anchorNode, sel.anchorOffset);
      const f = editor.view.posAtDOM(sel.focusNode, sel.focusOffset);
      return { from: Math.min(a, f), to: Math.max(a, f) };
    } catch (_) { return null; }
  }

  function currentRange() {
    return liveRange() || { from: editor.state.selection.from, to: editor.state.selection.to };
  }

  let lastExact = true;
  function setMarkdown(md: string, opts?: { keepSelection?: boolean }) {
    const keepSelection = !!(opts && opts.keepSelection);
    suppress = true;
    try {
      const prev = editor.state.selection;
      editor.commands.setContent(md || '', false);
      const doc = editor.state.doc;
      const clamp = (p: number) => Math.max(0, Math.min(p, doc.content.size));
      let selection;
      try { selection = keepSelection ? TextSelection.create(doc, clamp(prev.from), clamp(prev.to)) : undefined; } catch (_) { selection = undefined; }
      editor.view.updateState(EditorState.create({ doc, plugins: editor.state.plugins, selection }));
    } finally { suppress = false; }
    wikiRequests.reset();
    const out = getMarkdown();
    lastExact = String(md || '').replace(/[ \t]+$/gm, '').trimEnd() === out.replace(/[ \t]+$/gm, '').trimEnd();
    return fingerprint(out) === fingerprint(md);
  }

  return {
    editor,
    getMarkdown,
    setMarkdown,
    focus: (where?: FocusPosition) => { editor.view.focus(); return editor.commands.focus(where || null); },
    setEditable: (on: boolean) => editor.setEditable(!!on, false),
    isEmpty: () => editor.isEmpty,
    setLink: (href: string, range: TextRange | null | undefined) => {
      let chain = editor.chain().focus();
      if (range && range.from !== range.to) chain = chain.setTextSelection(range);
      if (!href) return chain.extendMarkRange('link').unsetLink().run();
      return chain.extendMarkRange('link').setLink({ href }).run();
    },
    selectionRange: currentRange,
    lastRoundTripExact: () => lastExact,
    activeLink: () => (editor.getAttributes('link') || {}).href || '',
    replaceRanges: (domRanges: Range[], text: string) => {
      const spans: { from: number, to: number }[] = [];
      for (const r of domRanges) {
        try { spans.push({ from: editor.view.posAtDOM(r.startContainer, r.startOffset), to: editor.view.posAtDOM(r.endContainer, r.endOffset) }); } catch (_) {  }
      }
      spans.sort((a, b) => b.from - a.from);
      if (!spans.length) return 0;
      let tr = editor.state.tr;
      for (const s of spans) tr = tr.insertText(text, s.from, s.to);
      editor.view.dispatch(tr);
      return spans.length;
    },
    insertLink: (text: string, href: string) => editor.chain().focus().insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }).insertContent(' ').run(),
    hasSelection: () => { const r = currentRange(); return r.from !== r.to; },
    insertBlock: (range: TextRange, kind: string) => {
      const make = BLOCKS[kind];
      if (!make) return false;
      return make(editor.chain().focus().deleteRange(range)).run();
    },
    blockKinds: () => Object.keys(BLOCKS),
    textAt: (range: TextRange) => { try { return editor.state.doc.textBetween(range.from, range.to, undefined, '\ufffc'); } catch (_) { return null; } },
    insertTextAt: (range: TextRange, text: string) => editor.chain().focus().deleteRange(range).insertContent(text).run(),
    insertLinkAt: (range: TextRange, text: string, href: string) => editor.chain().focus().deleteRange(range)
      .insertContent([{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }, { type: 'text', text: ' ' }]).run(),
    insertWikiLinkAt: (range: TextRange, raw: string) => editor.chain().focus().deleteRange(range)
      .insertContent([{ type: 'wikiLink', attrs: { raw } }, { type: 'text', text: ' ' }]).run(),
    linkAtCaret: () => caretLink(editor.state),
    refreshWikiLinks: () => wikiRequests.reset(),
    destroy: () => editor.destroy(),
  };
}
