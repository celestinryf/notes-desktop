import { el, I, setLabel, setPressed } from './dom.js';
import { state, lockedNow } from './state.js';
import { find } from './find-state.js';
import { src, renderCodePosition } from './code-editor.js';
import { NotesCsv } from './csv-view.js';
import H from '../shared/helpers.js';
import { toast } from './toast.js';

const { isViewerOnlyFile, isPlainTextFile } = H;

export function tableShown() { return !el.csvView.classList.contains('hidden'); }

export function focusBody() {
  if (tableShown()) el.csvView.focus();
  else if (state.sourceMode || !state.rich) src.focus();
  else state.rich.focus();
}

export function inTextField() {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable || el.richEditor.contains(a));
}

export function bodyHasFocus() {
  return src.hasFocus() || el.richEditor.contains(document.activeElement);
}

export function autoGrow() {
  const ta = el.bodyInput;
  if (ta.classList.contains('hidden') || ta.classList.contains('uses-code')) return;
  ta.style.height = 'auto';
  ta.style.height = Math.max(320, ta.scrollHeight + 2) + 'px';
}

export function createEditorView({ api, refresh, updateStatus, updateSettings, scopeListToNote, selectNoteNow, scheduleSave, runFind, clearFindHighlights }) {
  // The textarea (#bodyInput) always mirrors the Markdown, whichever view is showing,
  // so saving, word counts, and the source view all read one place.
  function createRichEditor() {
    if (!window.NotesEditor) { toast('Rendered editor failed to load; showing Markdown source.'); applyEditorMode(true); return; }
    state.rich = window.NotesEditor.create(el.richEditor, {
      placeholder: 'Start writing. Type / for headings, lists and tables, or [[ to link a note.',
      imageBase: () => H.imageBaseFor(state.current),
      onTrigger: (t) => showInlineMenu(t),
      onTriggerKey: (e) => inlineMenuKey(e),
      onUpdate: (md) => {
        // A plain file (a CSV in its table view, say) is never the rendered editor's to write: its text is its own.
        if (state.sourceMode || !state.currentId || isPlainTextFile(state.current)) return;
        if (md === el.bodyInput.value) return;
        el.bodyInput.value = md;
        scheduleSave();
        if (find.open) runFind(true, true, true);
      },
    });
    el.richEditor.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (a && (e.ctrlKey || e.metaKey)) { e.preventDefault(); followLink(a.getAttribute('href')); }
    });
  }

  // ---- the inline menu: "/" for blocks, "[[" for a link to a note ------------------------------------
  // The editor reports the trigger (what was typed, and where); this draws the choices under it. Escape closes it
  // until the trigger starts again somewhere else.

  const SLASH = [
    { kind: 'h1', title: 'Heading 1', icon: 'type', keys: '# ', words: 'title big' },
    { kind: 'h2', title: 'Heading 2', icon: 'type', keys: '## ', words: 'subtitle section' },
    { kind: 'h3', title: 'Heading 3', icon: 'type', keys: '### ', words: 'small heading' },
    { kind: 'text', title: 'Text', icon: 'file-text', keys: '', words: 'paragraph plain normal' },
    { kind: 'checklist', title: 'Checklist', icon: 'check', keys: '- [ ] ', words: 'todo task checkbox' },
    { kind: 'bullets', title: 'Bulleted list', icon: 'list', keys: '- ', words: 'unordered bullet' },
    { kind: 'numbers', title: 'Numbered list', icon: 'list', keys: '1. ', words: 'ordered' },
    { kind: 'quote', title: 'Quote', icon: 'message-square', keys: '> ', words: 'blockquote citation' },
    { kind: 'code', title: 'Code block', icon: 'code-xml', keys: '```', words: 'snippet pre monospace' },
    { kind: 'table', title: 'Table', icon: 'layout-grid', keys: '', words: 'grid rows columns' },
    { kind: 'divider', title: 'Divider', icon: 'minus', keys: '---', words: 'rule line separator hr' },
    { kind: 'date', title: "Today's date", icon: 'bell', keys: '', words: 'now day time' },
    { kind: 'link', title: 'Link to a note', icon: 'link', keys: '[[', words: 'note reference wiki' },
  ];
  const inline = { trigger: null, items: [], active: 0, dismissedAt: null, notes: null, seq: 0 };

  async function showInlineMenu(t) {
    const seq = ++inline.seq;
    if (!t || state.sourceMode || !state.rich) { if (!t) inline.dismissedAt = null; hideInlineMenu(); return; }
    if (inline.dismissedAt === t.kind + ':' + t.from) { hideInlineMenu(); return; }
    let items;
    if (t.kind === 'slash') {
      items = SLASH.map((b) => ({ b, s: H.fuzzyScore(t.query, b.title + ' ' + b.words) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => Object.assign({ id: x.b.kind }, x.b));
      if (!t.query) items = SLASH.map((b) => Object.assign({ id: b.kind }, b));
    } else {
      if (!inline.notes || !inline.trigger || inline.trigger.kind !== 'link') inline.notes = await api.notes.list({ sort: 'updated' });
      if (seq !== inline.seq) return; // typing moved on while the notes loaded
      const q = t.query.trim();
      const notes = inline.notes.filter((n) => n.id !== state.currentId && !n.trashedAt);
      const scored = q ? notes.map((n) => ({ n, s: H.fuzzyScore(q, H.deriveTitle(n)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.n) : notes;
      items = scored.slice(0, 8).map((n) => ({ id: n.id, title: H.deriveTitle(n), icon: n.locked ? 'lock' : 'notebook-text', keys: H.relativeTime(n.updatedAt), note: n }));
      if (q) items.push({ id: 'new', title: 'New note "' + H.truncate(q, 40) + '"', icon: 'square-pen', keys: '', create: q });
    }
    inline.trigger = t;
    inline.items = items;
    inline.active = 0;
    if (!items.length) { hideInlineMenu(); return; }
    renderInlineMenu();
  }

  function renderInlineMenu() {
    const menu = el.inlineMenu;
    menu.innerHTML = '';
    inline.items.forEach((it, i) => {
      const b = document.createElement('div');
      b.className = 'inline-item' + (i === inline.active ? ' is-active' : '');
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(i === inline.active));
      b.innerHTML = I(it.icon) + '<span class="lbl"></span>' + (it.keys ? '<span class="keys' + (inline.trigger.kind === 'slash' ? ' md' : '') + '"></span>' : '');
      b.querySelector('.lbl').textContent = it.title;
      if (it.keys) b.querySelector('.keys').textContent = it.keys;
      // mousedown, not click: the editor must keep focus, or blurring it would close the menu first.
      b.addEventListener('mousedown', (e) => { e.preventDefault(); chooseInline(i); });
      b.addEventListener('mousemove', () => { if (inline.active !== i) { inline.active = i; paintInline(); } });
      menu.append(b);
    });
    menu.classList.remove('hidden');
    const r = inline.trigger.rect;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let x = Math.min(r.left, window.innerWidth - mw - 8);
    let y = r.bottom + 6;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 6);
    menu.style.left = Math.max(8, x) + 'px';
    menu.style.top = y + 'px';
  }

  function paintInline() {
    [...el.inlineMenu.children].forEach((c, i) => { c.classList.toggle('is-active', i === inline.active); c.setAttribute('aria-selected', String(i === inline.active)); if (i === inline.active) c.scrollIntoView({ block: 'nearest' }); });
  }

  function hideInlineMenu() {
    el.inlineMenu.classList.add('hidden');
    inline.trigger = null;
    inline.items = [];
  }

  // Keys while the menu is open. Returns true when the menu used the key.
  function inlineMenuKey(e) {
    if (e.isComposing || e.keyCode === 229) return false;
    if (!inline.trigger || el.inlineMenu.classList.contains('hidden')) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = inline.items.length;
      inline.active = (inline.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      paintInline();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); chooseInline(inline.active); return true; }
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); // Escape closes the menu, not the window
      inline.dismissedAt = inline.trigger.kind + ':' + inline.trigger.from;
      hideInlineMenu();
      return true;
    }
    return false;
  }

  async function chooseInline(i) {
    const it = inline.items[i];
    const t = inline.trigger;
    if (!it || !t || !state.rich) return;
    const range = { from: t.from, to: t.to };
    hideInlineMenu();
    if (t.kind === 'slash') {
      if (it.kind === 'date') { state.rich.insertTextAt(range, new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })); return; }
      if (it.kind === 'link') { state.rich.insertTextAt(range, '[['); return; } // reopens as the note picker
      state.rich.insertBlock(range, it.kind);
      return;
    }
    if (it.create) {
      const noteId = state.currentId;
      let created;
      try { created = await api.notes.create({ title: it.create, folderId: state.current ? state.current.folderId || null : null }); }
      catch (err) { toast('Could not create the note: ' + (err.message || err)); return; }
      if (state.currentId !== noteId) return; // moved to another note meanwhile; the new note still exists
      const typed = '[[' + t.query;
      const at = state.rich.textAt(range) === typed ? range : null;
      if (at) state.rich.insertLinkAt(at, it.create, 'note://' + created.id);
      else { const r = state.rich.selectionRange(); state.rich.insertLinkAt({ from: r.to, to: r.to }, it.create, 'note://' + created.id); }
      inline.notes = null;
      refresh({ keepEditor: true });
      toast('Created "' + H.truncate(it.create, 40) + '". Ctrl+click the link to open it.');
      return;
    }
    state.rich.insertLinkAt(range, it.title, 'note://' + it.note.id);
  }

  // Which view shows the open note's text: the rendered editor, or the source (the textarea, or the code editor in
  // its place). A PDF, Word or other binary file shows neither (its own viewer does), and nor does a locked note.
  // Set from the note every time, never left over from the last one: in source mode a text file opened after a Word
  // or PDF file used to keep the textarea hidden, and showed nothing.
  function syncTextViews(note) {
    const none = lockedNow() || isViewerOnlyFile(note);
    const isTable = H.isTableFile(note);
    const table = isTable && !state.sourceMode && !none;
    el.richEditor.classList.toggle('hidden', none || state.sourceMode || isTable);
    el.bodyInput.classList.toggle('hidden', none || !state.sourceMode);
    el.csvView.classList.toggle('hidden', !table);
    fillPane(table || (!!note && note.fileKind === 'image' && !lockedNow()));
    if (table) renderTable(note);
  }

  // A CSV or TSV file as a table (csv-view.js), from the text as it is now. Read-only: Ctrl+E edits it as text.
  let tableDrawn = null; // { id, text } last drawn, so a redraw (a mode switch, a poll) keeps the scroll
  let tableStats = null;
  function renderTable(note) {
    const text = el.bodyInput.value;
    if (!tableDrawn || tableDrawn.id !== note.id || tableDrawn.text !== text) {
      tableStats = NotesCsv.render(el.csvView, text, H.extOf(note.filePath));
      tableDrawn = { id: note.id, text };
    }
    updateStatus(note);
  }
  // A table or an image takes the rest of the pane, with its own scrolling, rather than a box scrolling in a page.
  function fillPane(on) {
    el.editorColumn.classList.toggle('fills-pane', on);
    el.editor.classList.toggle('fills-pane', on);
  }

  // The Source button names what it switches to: for Markdown the rendered view or the source, for a CSV the table or
  // the text. Set whenever the note or the mode changes.
  function syncSourceButton() {
    const table = H.isTableFile(state.current);
    const label = state.sourceMode ? (table ? 'Table' : 'Rendered') : (table ? 'Text' : 'Source');
    const what = state.sourceMode ? (table ? 'Show as a table' : 'Back to the rendered view') : (table ? 'Edit as text' : 'Show Markdown source');
    setLabel(el.sourceBtn, label);
    el.sourceBtn.setAttribute('aria-label', what);
    el.sourceBtn.title = what + ' (Ctrl+E)';
  }

  function applyEditorMode(source) {
    state.sourceMode = !!source;
    if (source) hideInlineMenu();
    if (find.open) { clearFindHighlights(); setTimeout(() => { if (find.open) runFind(true, true); }, 0); }
    setPressed(el.sourceBtn, state.sourceMode);
    syncSourceButton();
    syncTextViews(state.current);
    renderCodePosition();
    if (state.sourceMode) autoGrow();
    else if (state.rich && state.currentId && !isViewerOnlyFile(state.current) && !isPlainTextFile(state.current)) state.currentLossless = state.rich.setMarkdown(el.bodyInput.value);
  }

  function toggleSource(force) {
    const next = typeof force === 'boolean' ? force : !state.sourceMode;
    if (isViewerOnlyFile(state.current)) { toast('This file is shown as it is; it has no Markdown view to switch to.'); return; }
    if (next === state.sourceMode) return;
    if (!next && isPlainTextFile(state.current) && !H.isTableFile(state.current)) { toast('This is a plain-text file, so it is edited as the text it is.'); return; }
    if (!next && !state.rich && !H.isTableFile(state.current)) { toast('The rendered editor is unavailable; staying in Markdown source.'); return; }
    if (!next && state.currentId && !isPlainTextFile(state.current)) {
      // Re-check with the text as it is now: it may have become lossy (or clean) while editing in source.
      state.currentLossless = state.rich.setMarkdown(el.bodyInput.value);
      if (state.current && state.current.filePath && state.currentLossless && !state.rich.lastRoundTripExact()) state.currentLossless = false; // a real file gets the strict test
      if (state.currentLossless === false) {
        state.lossyOverride = state.currentId;
        toast('Heads up: editing this note in the rendered view will rewrite formatting it cannot show.');
      }
    }
    applyEditorMode(next);
    if (!H.isTableFile(state.current)) updateSettings({ editorMode: next ? 'source' : 'rendered' });
    focusBody();
  }

  // Ctrl+click on a link: a note link opens that note, an attachment opens with its app, the web goes outside.
  async function followLink(href) {
    href = String(href || '');
    if (/^note:\/\//i.test(href)) {
      const id = href.replace(/^note:\/\//i, '').replace(/\/$/, '');
      const target = await api.notes.get(id);
      if (!target) { toast('That note no longer exists.'); return; }
      await scopeListToNote(target);
      await selectNoteNow(id);
      return;
    }
    if (/^attachment:\/\//i.test(href)) { const r = await api.attachments.open(href); if (r) toast(String(r)); return; }
    api.app.openExternal(href);
  }

  function openLinkDialog() {
    if (!state.rich || state.sourceMode) return;
    const existing = state.rich.activeLink();
    if (!existing && !state.rich.hasSelection()) { toast('Select the text to link first'); return; }
    state.linkRange = state.rich.selectionRange();
    // The note picker lists every other live note by title.
    el.linkNoteSelect.innerHTML = '<option value="">— pick a note —</option>';
    api.notes.list({ sort: 'title' }).then((notes) => {
      for (const n of notes) { if (n.id === state.currentId) continue; const o = document.createElement('option'); o.value = 'note://' + n.id; o.textContent = H.truncate(H.deriveTitle(n), 60); el.linkNoteSelect.append(o); }
      if (/^note:\/\//.test(existing)) el.linkNoteSelect.value = existing;
    });
    el.linkInput.value = existing || 'https://';
    el.linkRemoveBtn.classList.toggle('hidden', !existing);
    el.linkDialog.showModal();
    el.linkInput.focus();
    el.linkInput.select();
  }

  // The table's rows and columns, for the status line while a table shows.
  function tableStatsNow() { return tableStats; }

  return { createRichEditor, inline, showInlineMenu, inlineMenuKey, syncTextViews, tableStatsNow, syncSourceButton, applyEditorMode, toggleSource, followLink, openLinkDialog };
}
