/* Rendered Markdown editor built on Tiptap. Bundled by esbuild into src/renderer/vendor/editor.bundle.js
   and exposed as window.NotesEditor. Markdown stays the storage format: content goes in as Markdown and
   every change comes back out as Markdown. */
import { Editor, Extension, InputRule, mergeAttributes } from '@tiptap/core';
import { EditorState, TextSelection, Plugin, PluginKey } from '@tiptap/pm/state';
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

// Content fingerprint used to decide whether the rendered view can show a note without changing it.
// Escapes and formatting punctuation are ignored; the letters, digits, and URLs must survive.
function fingerprint(md) {
  let s = String(md || '').replace(/\r/g, '');
  // YAML front matter (a key: value block fenced by ---) turns into a rule plus paragraphs; never lossless.
  // A single key line counts too ("---\ntitle: x\n---" is the common case).
  if (/^---\n[A-Za-z_][\w-]*:[^\n]*\n(?:[\s\S]*?\n)?---(\n|$)/.test(s)) return 'front-matter:' + s;
  // Fences other than three backticks are always re-emitted as three backticks, which can break a block
  // that itself contains backticks; treat such notes as lossy.
  if (/^(~~~|````)/m.test(s)) return 'odd-fence:' + s;
  // A hard break followed directly by a block marker (quote, heading, list) splits the paragraph on reload.
  // Checked outside fenced code, and only on the very next line (a blank line in between is a normal break).
  if (/(\\| {2,})\n[ \t]*(>|#{1,6}\s|[-+*]\s|\d+[.)]\s)/.test(s.replace(/```[\s\S]*?```/g, ''))) return 'break-before-block:' + s;
  // Spacing inside inline code is content, but the HTML parser collapses runs of spaces; keep each space as a
  // letter-class marker so a collapse shows up as a difference and the note opens in source instead.
  s = s.replace(/`[^`\n]*`/g, (span) => span.replace(/ /g, 'ꞏ'));
  s = s
    .replace(/\\\n/g, '\n')                      // backslash hard break == newline
    .replace(/ {2,}\n/g, '\n')                   // two-space hard break == newline
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/^(\s*)\d+[.)]\s/gm, '$11. ');      // ordered lists are renumbered on output; that is not a loss
  // Compare line by line so lost or merged line breaks are noticed; blank lines and formatting are not.
  // Letters and digits in any script count, plus the characters that make URLs and angle brackets meaningful.
  return s.split('\n').map((l) => l.replace(/[^\p{L}\p{N}:/.<>]+/gu, '').toLowerCase()).filter(Boolean).join('\n');
}

// tiptap-markdown escapes every < and > as entities, so "x -> y" is stored as "x -&gt; y" and search for
// "->" fails. Only a < that could start an HTML tag needs escaping when html is enabled.
const PlainText = Text.extend({
  addStorage() {
    return {
      markdown: {
        // Escape a "<" that could open a tag and an "&" that would read as an entity; everything else as typed.
        serialize(state, node) {
          state.text(String(node.text).replace(/&(?=[A-Za-z]+;|#\d+;|#x[0-9A-Fa-f]+;)/g, '&amp;').replace(/<(?=[A-Za-z/!?])/g, '&lt;'));
        },
        parse: {},
      },
    };
  },
});

// Tab indents list items; outside a list it does nothing instead of moving focus away mid-sentence.
// Shift+Tab lifts a list item, or falls through to the browser so focus can move back to the tags field.
const NotesKeys = Extension.create({
  name: 'notesKeys',
  priority: 1000, // ahead of StarterKit so these bindings win
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive('table')) return false; // the table extension moves between cells
        if (this.editor.isActive('codeBlock')) return this.editor.commands.insertContent('\t');
        return this.editor.commands.sinkListItem('listItem') || this.editor.commands.sinkListItem('taskItem') || true;
      },
      'Shift-Tab': () => this.editor.commands.liftListItem('listItem') || this.editor.commands.liftListItem('taskItem'),
      // The app uses Ctrl+E to switch between rendered and source views; Tiptap would otherwise toggle inline code.
      'Mod-e': () => true,
      // Ctrl+Shift+S opens the app's Share menu; strikethrough moves to Ctrl+Shift+X.
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
      'Mod-Shift-s': () => true,
    };
  },
});

// tiptap-markdown only tracks "tight" (no blank lines between items) for bullet and numbered lists.
// Without this, every checklist serializes with blank lines between the boxes.
const TaskListTight = Extension.create({
  name: 'taskListTight',
  addGlobalAttributes() {
    return [{
      types: ['taskList'],
      attributes: {
        tight: {
          default: true,
          parseHTML: (el) => el.getAttribute('data-tight') === 'true' || !el.querySelector('li > div > p + p'),
          renderHTML: (attrs) => ({ 'data-tight': attrs.tight ? 'true' : null }),
        },
      },
    }];
  },
});

// Typing "- " makes a bullet immediately, so "- [ ] " never reaches Tiptap's own checklist rule.
// This rule watches for "[ ] " or "[x] " at the start of a bullet item and converts that list to a checklist.
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
        return true;
      },
    })];
  },
});

// Inline triggers: "/" at the start of a word (the block menu) and "[[" (link to a note). The editor only notices
// them and reports where they are; the app draws the menu. While a trigger is open the app gets first say on keys
// (arrows, Enter, Tab, Escape), so they drive the menu instead of moving the caret.
// Not in code blocks or inline code, and never with a selection.
export function detectTrigger(state) {
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

function triggers(options) {
  return Extension.create({
    name: 'notesTriggers',
    addProseMirrorPlugins() {
      let lastKey = null;
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

// The blocks the "/" menu can make. Each replaces the typed "/query" with that block at the caret.
const BLOCKS = {
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

// Where a picture is loaded from. Only the shown src changes; the Markdown keeps what was written.
// A relative path is read from the opened file's folder (base, a file:/// URL ending in "/"), not from the app's.
// A network path (//server/x, \\server\x, file://server/x, file:////server/x, with any whitespace tricks) is never
// loaded: Windows would fetch it over SMB and send the login to whoever runs that server. The check runs on the URL
// as the browser parses it, not on the raw text, since the parser drops whitespace and reads "\" as "/".
const NO_BASE = 'file:///notes-app-no-base/';
export function resolveImageSrc(src, base) {
  const s = String(src || '');
  if (/^\s*(data|https?|attachment|blob):/i.test(s)) return s; // cannot reach a share
  let u;
  try { u = new URL(s, base || NO_BASE); } catch (_) { return ''; }
  if (u.protocol === 'file:' && ((u.hostname && u.hostname !== 'localhost') || u.pathname.startsWith('//'))) return '';
  if (!base && !/^\s*[a-z][a-z0-9+.-]*:/i.test(s)) return s; // a relative path in a note with no file: as before
  return u.href;
}

// options.imageBase(): the file:/// folder URL relative pictures resolve against, or null for none.
// The written src travels in data-src, so copying a picture and pasting it back keeps the path as written.
function pictures(imageBase) {
  return Image.extend({
    addAttributes() {
      const parent = this.parent ? this.parent() : {};
      return Object.assign({}, parent, { src: Object.assign({}, parent.src, { parseHTML: (el) => el.getAttribute('data-src') || el.getAttribute('src') }) });
    },
    renderHTML({ HTMLAttributes }) {
      const written = HTMLAttributes.src;
      const attrs = Object.assign({}, HTMLAttributes, { src: resolveImageSrc(written, imageBase ? imageBase() : null), 'data-src': written });
      return ['img', mergeAttributes(this.options.HTMLAttributes, attrs)];
    },
  }).configure({ inline: true, allowBase64: true });
}

export function create(element, options) {
  options = options || {};
  let suppress = false;
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ text: false, heading: { levels: [1, 2, 3, 4, 5, 6] }, codeBlock: { HTMLAttributes: { spellcheck: 'false' } } }),
      PlainText,
      TaskList.configure({ HTMLAttributes: { 'data-type': 'taskList' } }),
      TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
      TaskListTight,
      DashCheckbox,
      // note:// links point at other notes; attachment:// links at files the app keeps. Both are opened by
      // the app, never by the browser.
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, protocols: ['note', 'attachment'], HTMLAttributes: { rel: 'noopener', target: '_blank' } }),
      // Inline, as Markdown models images: tiptap-markdown's image serializer never closes a block, so a
      // block image followed by text would be glued onto one line and misparse on reload.
      pictures(options.imageBase),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: options.placeholder || 'Start writing…' }),
      // html: true so a structure Markdown cannot express (a table cell with two paragraphs) is written as
      // HTML, which round-trips, instead of the literal placeholder "[table]" that would lose the table.
      // transformPastedText stays off: with html enabled, pasted plain text like "List<String>" would be
      // read as HTML tags and the angle-bracket text dropped. Pasted text arrives as text.
      Markdown.configure({ html: true, tightLists: true, bulletListMarker: '-', linkify: false, breaks: true, transformPastedText: false, transformCopiedText: true }),
      NotesKeys,
      triggers(options),
    ],
    content: options.content || '',
    autofocus: false,
    editorProps: { attributes: { class: 'rich-editor-content', spellcheck: 'true' } },
    onUpdate: () => { if (!suppress && options.onUpdate) options.onUpdate(getMarkdown()); },
  });

  function getMarkdown() {
    return editor.storage.markdown.getMarkdown();
  }

  // ProseMirror copies the browser selection into its state asynchronously. A shortcut pressed right after
  // Shift+Home (or a mouse drag) can run before that copy, so read the live DOM selection when it is ours.
  function liveRange() {
    const sel = element.ownerDocument.getSelection();
    if (!sel || sel.rangeCount === 0 || !editor.view.dom.contains(sel.anchorNode) || !editor.view.dom.contains(sel.focusNode)) return null;
    try {
      const a = editor.view.posAtDOM(sel.anchorNode, sel.anchorOffset);
      const f = editor.view.posAtDOM(sel.focusNode, sel.focusOffset);
      return { from: Math.min(a, f), to: Math.max(a, f) };
    } catch (_) { return null; }
  }

  function currentRange() {
    return liveRange() || { from: editor.state.selection.from, to: editor.state.selection.to };
  }

  // Loads Markdown and reports whether the rendered view preserves it: true when serializing the loaded
  // document gives back the same content, false when some construct would be rewritten or dropped.
  let lastExact = true;
  // opts.keepSelection: an in-place reload of the same note keeps the caret; opening another note starts at the top.
  function setMarkdown(md, opts) {
    const keepSelection = !!(opts && opts.keepSelection);
    suppress = true;
    try {
      const prev = editor.state.selection;
      editor.commands.setContent(md || '', false);
      // Loading a note is not an edit: a fresh state means Ctrl+Z cannot bring the previous note's text back.
      // The caret goes back where it was (clamped), so a remote or vault reload does not jump it to the end.
      const doc = editor.state.doc;
      const clamp = (p) => Math.max(0, Math.min(p, doc.content.size));
      let selection;
      try { selection = keepSelection ? TextSelection.create(doc, clamp(prev.from), clamp(prev.to)) : undefined; } catch (_) { selection = undefined; }
      editor.view.updateState(EditorState.create({ doc, plugins: editor.state.plugins, selection }));
    } finally { suppress = false; }
    const out = getMarkdown();
    // Exact: byte-for-byte apart from trailing whitespace. Used for file-backed notes, where even a changed
    // line-break style in someone's CLAUDE.md is a rewrite they did not ask for.
    lastExact = String(md || '').replace(/[ \t]+$/gm, '').trimEnd() === out.replace(/[ \t]+$/gm, '').trimEnd();
    return fingerprint(out) === fingerprint(md);
  }

  return {
    editor,
    getMarkdown,
    setMarkdown,
    // Tiptap's focus command defers the DOM focus to the next animation frame; a key pressed right after
    // Enter in the title would land in the title. Focus the DOM synchronously first, then place the caret.
    focus: (where) => { editor.view.focus(); return editor.commands.focus(where || null); },
    // Second argument false: setEditable would otherwise emit an update, and an update on a freshly loaded
    // note would write the editor's serialization back over the stored Markdown just for viewing it.
    setEditable: (on) => editor.setEditable(!!on, false),
    isEmpty: () => editor.isEmpty,
    // range: {from,to} captured with selectionRange() when the dialog opened, so the link lands on the text
    // the user had selected even though focus moved to the dialog in between.
    setLink: (href, range) => {
      let chain = editor.chain().focus();
      if (range && range.from !== range.to) chain = chain.setTextSelection(range);
      if (!href) return chain.extendMarkRange('link').unsetLink().run();
      return chain.extendMarkRange('link').setLink({ href }).run();
    },
    selectionRange: currentRange,
    lastRoundTripExact: () => lastExact,
    activeLink: () => (editor.getAttributes('link') || {}).href || '',
    // Replaces the text of DOM ranges (as produced by the app's find) in one transaction, last first so
    // earlier positions stay valid. Returns how many were replaced.
    replaceRanges: (domRanges, text) => {
      const spans = [];
      for (const r of domRanges) {
        try { spans.push({ from: editor.view.posAtDOM(r.startContainer, r.startOffset), to: editor.view.posAtDOM(r.endContainer, r.endOffset) }); } catch (_) { /* detached range */ }
      }
      spans.sort((a, b) => b.from - a.from);
      if (!spans.length) return 0;
      let tr = editor.state.tr;
      for (const s of spans) tr = tr.insertText(text, s.from, s.to);
      editor.view.dispatch(tr);
      return spans.length;
    },
    // Inserts a link at the caret (or over the selection), as Markdown would: [text](href).
    insertLink: (text, href) => editor.chain().focus().insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }).insertContent(' ').run(),
    hasSelection: () => { const r = currentRange(); return r.from !== r.to; },
    // The "/" menu: replace the typed trigger (range) with a block. Returns false for an unknown block.
    insertBlock: (range, kind) => {
      const make = BLOCKS[kind];
      if (!make) return false;
      return make(editor.chain().focus().deleteRange(range)).run();
    },
    blockKinds: () => Object.keys(BLOCKS),
    textAt: (range) => { try { return editor.state.doc.textBetween(range.from, range.to, undefined, '\ufffc'); } catch (_) { return null; } },
    // Plain text at the trigger (the "/" menu's date), as if typed.
    insertTextAt: (range, text) => editor.chain().focus().deleteRange(range).insertContent(text).run(),
    // "[[": replace the typed trigger with a link to a note.
    insertLinkAt: (range, text, href) => editor.chain().focus().deleteRange(range)
      .insertContent([{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }, { type: 'text', text: ' ' }]).run(),
    destroy: () => editor.destroy(),
  };
}
