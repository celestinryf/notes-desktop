/* Rendered Markdown editor built on Tiptap. Bundled by esbuild into src/renderer/vendor/editor.bundle.js
   and exposed as window.NotesEditor. Markdown stays the storage format: content goes in as Markdown and
   every change comes back out as Markdown. */
import { Editor, Extension, InputRule } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';

// Tab indents list items; outside a list it does nothing instead of moving focus away mid-sentence.
// Shift+Tab lifts a list item, or falls through to the browser so focus can move back to the tags field.
const NotesKeys = Extension.create({
  name: 'notesKeys',
  priority: 1000, // ahead of StarterKit so these bindings win
  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.sinkListItem('listItem') || this.editor.commands.sinkListItem('taskItem') || true,
      'Shift-Tab': () => this.editor.commands.liftListItem('listItem') || this.editor.commands.liftListItem('taskItem'),
      // The app uses Ctrl+E to switch between rendered and source views; Tiptap would otherwise toggle inline code.
      'Mod-e': () => true,
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

export function create(element, options) {
  options = options || {};
  let suppress = false;
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, codeBlock: { HTMLAttributes: { spellcheck: 'false' } } }),
      TaskList.configure({ HTMLAttributes: { 'data-type': 'taskList' } }),
      TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
      TaskListTight,
      DashCheckbox,
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: 'noopener', target: '_blank' } }),
      Placeholder.configure({ placeholder: options.placeholder || 'Start writing…' }),
      Markdown.configure({ html: false, tightLists: true, bulletListMarker: '-', linkify: false, breaks: true, transformPastedText: true, transformCopiedText: true }),
      NotesKeys,
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

  function setMarkdown(md) {
    suppress = true;
    try { editor.commands.setContent(md || '', false); } finally { suppress = false; }
  }

  return {
    editor,
    getMarkdown,
    setMarkdown,
    // Tiptap's focus command defers the DOM focus to the next animation frame; a key pressed right after
    // Enter in the title would land in the title. Focus the DOM synchronously first, then place the caret.
    focus: (where) => { editor.view.focus(); return editor.commands.focus(where || null); },
    setEditable: (on) => editor.setEditable(!!on),
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
    activeLink: () => (editor.getAttributes('link') || {}).href || '',
    hasSelection: () => { const r = currentRange(); return r.from !== r.to; },
    destroy: () => editor.destroy(),
  };
}
