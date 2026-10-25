import { Editor, Extension, InputRule, Node as TiptapNode, mergeAttributes, nodePasteRule, type Attributes, type ChainedCommands, type FocusPosition, type Range as TextRange } from '@tiptap/core';
import type { MarkdownSerializerState } from '@tiptap/pm/markdown';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type MarkdownIt from 'markdown-it';
import type { StateInline } from 'markdown-it';
import { IMAGE_EXT, extOf, isRecord, wikiLinkLabel, wikiLinkName } from '../shared/helpers.mts';
import { splitFrontMatter } from '../shared/front-matter.mts';
import StarterKit from '@tiptap/starter-kit';
import Text from '@tiptap/extension-text';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { NotesTable, NotesTableCell, NotesTableHeader } from './tables.ts';
import TableRow from '@tiptap/extension-table-row';
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
        serialize(state: MarkdownSerializerState, node: PMNode, parent: PMNode, index: number) {
          const text = String(node.text).replace(/&(?=[A-Za-z]+;|#\d+;|#x[0-9A-Fa-f]+;)/g, '&amp;').replace(/<(?=[A-Za-z/!?])/g, '&lt;');
          const next = parent.maybeChild(index + 1);
          const beforeLink = !!next && next.type.name === 'wikiLink' && !next.attrs.embed && text.endsWith('!');
          state.text(beforeLink ? text.slice(0, -1) : text);
          if (beforeLink) state.write('\\!');
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

const insideLink = (state: StateInline) => 'linkLevel' in state && typeof state.linkLevel === 'number' && state.linkLevel > 0;

function wikiLinkRule(state: StateInline, silent: boolean) {
  if (silent || insideLink(state)) return false;
  const first = state.src.charCodeAt(state.pos);
  if (first !== 0x5b && first !== 0x21) return false;
  const m = WIKI_LINK_AT.exec(state.src.slice(state.pos, state.posMax));
  if (!m || state.src.charCodeAt(state.pos + m[0].length) === 0x28) return false;
  const token = state.push('wikilink', '', 0);
  token.meta = wikiAttrs(m);
  token.content = m[0];
  state.pos += m[0].length;
  return true;
}

function addWikiLinks(md: MarkdownIt) {
  if (parsersWithWikiLinks.has(md)) return;
  parsersWithWikiLinks.add(md);
  md.inline.ruler.before('link', 'wikilink', wikiLinkRule);
  const asText = md.renderer.renderInlineAsText.bind(md.renderer);
  md.renderer.renderInlineAsText = (tokens, options, env) => tokens.map((t) => (t.type === 'wikilink' ? t.content : asText([t], options, env))).join('');
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

type PictureLookup = (name: string) => Promise<string | null>;

function pictureName(raw: string) {
  const target = raw.split(/(?<!\\)\|/)[0].replace(/\\\|/g, '|').trim();
  return /\.[^./\\]+$/.test(target) && IMAGE_EXT.has(extOf(target)) ? target : null;
}

const isPictureEmbed = (node: PMNode) => node.attrs.embed === true && pictureName(String(node.attrs.raw)) !== null;

const wikiLinkAttrs = (raw: string, embed: boolean) => ({ class: 'wikilink', 'data-wikilink': raw, 'data-embed': embed ? '' : null, title: 'Open "' + wikiLinkLabel(raw) + '" (Ctrl+click or Alt+Enter)' });

function wikiLinkElement(raw: string, embed: boolean) {
  const a = document.createElement('a');
  for (const [k, v] of Object.entries(wikiLinkAttrs(raw, embed))) if (v !== null) a.setAttribute(k, v);
  a.textContent = wikiLinkLabel(raw);
  return a;
}

function pictureEmbed(raw: string, name: string, picture: PictureLookup) {
  const alias = raw.includes('|') ? raw.slice(raw.lastIndexOf('|') + 1).trim() : '';
  const size = /^(\d+)(?:x(\d+))?$/.exec(alias);
  const holder = document.createElement('span');
  holder.className = 'wiki-embed';
  const img = document.createElement('img');
  img.alt = size || !alias ? name : alias;
  img.title = name + ' (Ctrl+E shows the embed)';
  img.setAttribute('data-wikilink', raw);
  img.setAttribute('data-embed', '');
  if (size) { img.width = Number(size[1]); if (size[2]) img.height = Number(size[2]); }
  holder.append(img);
  const missing = (title: string) => {
    const link = wikiLinkElement(raw, true);
    link.classList.add('is-unresolved');
    link.title = title;
    holder.replaceChildren(link);
  };
  img.addEventListener('error', () => missing('Could not show the picture "' + name + '"'));
  picture(name).then((src) => { if (src) img.src = src; else missing('No picture named "' + name + '" in this vault'); });
  return holder;
}

const WikiLink = TiptapNode.create<{ picture: PictureLookup | null }>({
  name: 'wikiLink',
  addOptions() {
    return { picture: null };
  },
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
    return ['a', wikiLinkAttrs(raw, node.attrs.embed === true), wikiLinkLabel(raw)];
  },
  addNodeView() {
    const picture = this.options.picture;
    return ({ node }) => {
      const raw = String(node.attrs.raw);
      const name = node.attrs.embed === true ? pictureName(raw) : null;
      return { dom: picture && name ? pictureEmbed(raw, name, picture) : wikiLinkElement(raw, node.attrs.embed === true) };
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode) {
          const raw = String(node.attrs.raw);
          const inTable = 'inTable' in state && state.inTable === true;
          state.write((node.attrs.embed ? '!' : '') + '[[' + (inTable ? raw.replace(/(?<!\\)\|/g, '\\|') : raw) + ']]');
        },
        parse: { setup: addWikiLinks },
      },
    };
  },
  addInputRules() {
    return [new InputRule({ find: WIKI_LINK_TYPED, handler: ({ state, range, match }) => { state.tr.replaceWith(range.from, range.to, this.type.create(wikiAttrs(match))); } })];
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
  doc.descendants((node) => { if (node.type.name === 'wikiLink' && !isPictureEmbed(node)) names.add(wikiLinkName(String(node.attrs.raw))); });
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
          let queued = false;
          const check = () => {
            if (!resolve || view.isDestroyed) return;
            const names = wikiNames(view.state.doc);
            const key = names.join('\n');
            if (key === asked) return;
            asked = key;
            if (!names.length) {
              const status = wikiStatusKey.getState(view.state);
              if (status && status.unresolved.size) view.dispatch(view.state.tr.setMeta(wikiStatusKey, { unresolved: new Set() }).setMeta('addToHistory', false));
              return;
            }
            resolve(names).then((ids) => {
              if (!ids || asked !== key || view.isDestroyed) return;
              const unresolved = new Set(names.filter((_, i) => !ids[i]));
              view.dispatch(view.state.tr.setMeta(wikiStatusKey, { unresolved }).setMeta('addToHistory', false));
            }).catch(() => {});
          };
          const soon = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; check(); }); };
          requests.reset = () => { asked = null; soon(); };
          soon();
          return { update: soon };
        },
      })];
    },
  });
}

export type LinkAtCaret = { wiki: string } | { href: string } | null;

function caretLink(state: EditorState): LinkAtCaret {
  const sel = state.selection;
  const followable = (n: PMNode | null | undefined): n is PMNode => !!n && n.type.name === 'wikiLink' && !isPictureEmbed(n);
  if (sel instanceof NodeSelection && followable(sel.node)) return { wiki: String(sel.node.attrs.raw) };
  for (const n of [sel.$from.nodeAfter, sel.$from.nodeBefore]) if (followable(n)) return { wiki: String(n.attrs.raw) };
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
  resolvePictures?: WikiLinkResolver,
  onLinkAtCaret?: (on: boolean) => void,
};

export function create(element: HTMLElement, options: EditorOptions) {
  options = options || {};
  let suppress = false;
  const wikiRequests = { reset: () => {} };
  const pictureCache = new Map<string, Promise<string | null>>();
  const resolvePictures = options.resolvePictures;
  const picture: PictureLookup | null = resolvePictures ? (name) => {
    let hit = pictureCache.get(name);
    if (!hit) {
      hit = resolvePictures([name]).then((rels) => {
        const rel = rels ? rels[0] : null;
        return rel ? resolveImageSrc(rel, options.imageBase ? options.imageBase() : null) || null : null;
      }, () => null);
      pictureCache.set(name, hit);
      hit.then((src) => { if (!src) pictureCache.delete(name); });
    }
    return hit;
  } : null;
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
      NotesTable.configure({ resizable: false }),
      TableRow,
      NotesTableHeader,
      NotesTableCell,
      Placeholder.configure({ placeholder: options.placeholder || 'Start writing…' }),
      Markdown.configure({ html: true, tightLists: true, bulletListMarker: '-', linkify: false, breaks: true, transformPastedText: false, transformCopiedText: true }),
      NotesKeys,
      triggers(options),
      WikiLink.configure({ picture }),
      wikiLinkStatus(options.resolveWikiLinks, wikiRequests),
      caretLinkWatch(options.onLinkAtCaret),
    ],
    content: options.content || '',
    autofocus: false,
    editorProps: { attributes: { class: 'rich-editor-content', spellcheck: 'true' } },
    onUpdate: () => { if (!suppress && options.onUpdate) options.onUpdate(getMarkdown()); },
  });

  let front = '';
  function getMarkdown() {
    return front + editor.storage.markdown.getMarkdown();
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
    const parts = splitFrontMatter(md || '');
    front = parts.front;
    suppress = true;
    try {
      const prev = editor.state.selection;
      editor.commands.setContent(parts.body, false);
      const doc = editor.state.doc;
      const clamp = (p: number) => Math.max(0, Math.min(p, doc.content.size));
      let selection;
      try { selection = keepSelection ? TextSelection.create(doc, clamp(prev.from), clamp(prev.to)) : undefined; } catch (_) { selection = undefined; }
      editor.view.updateState(EditorState.create({ doc, plugins: editor.state.plugins, selection }));
    } finally { suppress = false; }
    wikiRequests.reset();
    pictureCache.clear();
    const out = editor.storage.markdown.getMarkdown();
    lastExact = parts.body.replace(/[ \t]+$/gm, '').trimEnd() === out.replace(/[ \t]+$/gm, '').trimEnd();
    return fingerprint(out) === fingerprint(parts.body);
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
    setFrontMatter: (text: string) => { front = text; },
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
