import { el, I, setLabel, setPressed } from './dom.ts';
import { state, lockedNow } from './state.ts';
import { find } from './find-state.ts';
import { src, renderCodePosition } from './code-editor.ts';
import { NotesCsv } from './csv-view.ts';
import * as H from '../shared/helpers.mts';
import { toast } from './toast.ts';

const { isViewerOnlyFile, isPlainTextFile } = H;

export function tableShown() { return !el.csvView.classList.contains('hidden'); }

export function focusBody() {
  if (tableShown()) el.csvView.focus();
  else if (state.sourceMode || !state.rich) src.focus();
  else state.rich.focus();
}

export function inTextField() {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || (a instanceof HTMLElement && a.isContentEditable) || el.richEditor.contains(a));
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

type InlineTrigger = { kind: 'slash' | 'link', query: string, from: number, to: number, rect: { left: number, top: number, bottom: number } };

type EditorViewDeps = {
  api: NotesApi,
  refresh: (opts?: { keepEditor?: boolean }) => Promise<unknown>,
  updateStatus: (note: PublicNote) => void,
  updateSettings: (patch: SettingsPatch) => Promise<unknown>,
  scopeListToNote: (note: PublicNote | null) => Promise<unknown>,
  selectNoteNow: (id: string) => Promise<unknown>,
  scheduleSave: () => void,
  runFind: (forward: boolean, fresh?: boolean, quiet?: boolean) => void,
  clearFindHighlights: () => void,
};

export function createEditorView({ api, refresh, updateStatus, updateSettings, scopeListToNote, selectNoteNow, scheduleSave, runFind, clearFindHighlights }: EditorViewDeps) {
  function createRichEditor() {
    if (!window.NotesEditor) { toast('Rendered editor failed to load; showing Markdown source.'); applyEditorMode(true); return; }
    state.rich = window.NotesEditor.create(el.richEditor, {
      placeholder: 'Start writing. Type / for headings, lists and tables, or [[ to link a note.',
      imageBase: () => H.imageBaseFor(state.current),
      resolveWikiLinks: async (names: string[]) => {
        const id = state.currentId;
        if (!id) return null;
        const ids = await api.notes.resolveLinks(id, names);
        return state.currentId === id ? ids : null;
      },
      resolvePictures: async (names: string[]) => {
        const id = state.currentId;
        if (!id) return null;
        const rels = await api.notes.resolvePictures(id, names);
        return state.currentId === id ? rels : null;
      },
      onLinkAtCaret: (on: boolean) => showLinkHint(on),
      onTrigger: (t: InlineTrigger | null) => showInlineMenu(t),
      onTriggerKey: (e: KeyboardEvent) => inlineMenuKey(e),
      onUpdate: (md: string) => {
        if (state.sourceMode || !state.currentId || isPlainTextFile(state.current)) return;
        if (md === el.bodyInput.value) return;
        el.bodyInput.value = md;
        scheduleSave();
        if (find.open) runFind(true, true, true);
      },
    });
    el.richEditor.addEventListener('click', (e) => {
      if (!(e.ctrlKey || e.metaKey) || !(e.target instanceof Element)) return;
      const wiki = e.target.closest('a[data-wikilink]');
      if (wiki) { e.preventDefault(); followWikiLink(wiki.getAttribute('data-wikilink') || ''); return; }
      const a = e.target.closest('a[href]');
      if (a) { e.preventDefault(); followLink(a.getAttribute('href')); }
    });
  }

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
  type InlineItem = { id: string, title: string, icon: string, keys: string, kind?: string, words?: string, note?: ListRow, create?: string, wiki?: string | null };
  const inline: { trigger: InlineTrigger | null, items: InlineItem[], active: number, dismissedAt: string | null, notes: ListRow[] | null, seq: number } = { trigger: null, items: [], active: 0, dismissedAt: null, notes: null, seq: 0 };

  async function showInlineMenu(t: InlineTrigger | null) {
    const seq = ++inline.seq;
    if (!t || state.sourceMode || !state.rich) { if (!t) inline.dismissedAt = null; hideInlineMenu(); return; }
    if (inline.dismissedAt === t.kind + ':' + t.from) { hideInlineMenu(); return; }
    let items: InlineItem[];
    if (t.kind === 'slash') {
      items = SLASH.map((b) => ({ b, s: H.fuzzyScore(t.query, b.title + ' ' + b.words) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => Object.assign({ id: x.b.kind }, x.b));
      if (!t.query) items = SLASH.map((b) => Object.assign({ id: b.kind }, b));
    } else {
      const known = !inline.notes || !inline.trigger || inline.trigger.kind !== 'link' ? await api.notes.rows({ sort: 'updated' }) : inline.notes;
      inline.notes = known;
      if (seq !== inline.seq) return;
      const q = t.query.trim();
      const notes = known.filter((n) => n.id !== state.currentId && !n.trashedAt);
      const scored = q ? notes.map((n) => ({ n, s: H.fuzzyScore(q, H.deriveTitle(n)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.n) : notes;
      items = scored.slice(0, 8).map((n) => ({ id: n.id, title: H.deriveTitle(n), icon: n.locked ? 'lock' : 'notebook-text', keys: H.relativeTime(n.updatedAt), note: n }));
      prefetchWikiLinks(items);
      if (q) items.push({ id: 'new', title: 'New note "' + H.truncate(q, 40) + '"', icon: 'square-pen', keys: '', create: q });
    }
    inline.trigger = t;
    inline.items = items;
    inline.active = 0;
    if (!items.length) { hideInlineMenu(); return; }
    renderInlineMenu();
  }

  function renderInlineMenu() {
    const trigger = inline.trigger;
    if (!trigger) return;
    const menu = el.inlineMenu;
    menu.innerHTML = '';
    inline.items.forEach((it, i) => {
      const b = document.createElement('div');
      b.className = 'inline-item' + (i === inline.active ? ' is-active' : '');
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(i === inline.active));
      b.innerHTML = I(it.icon);
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = it.title;
      b.append(lbl);
      if (it.keys) {
        const keys = document.createElement('span');
        keys.className = 'keys' + (trigger.kind === 'slash' ? ' md' : '');
        keys.textContent = it.keys;
        b.append(keys);
      }
      b.addEventListener('mousedown', (e) => { e.preventDefault(); chooseInline(i); });
      b.addEventListener('mousemove', () => { if (inline.active !== i) { inline.active = i; paintInline(); } });
      menu.append(b);
    });
    menu.classList.remove('hidden');
    const r = trigger.rect;
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

  const wikiTexts = new Map<string, string | null>();
  function hideInlineMenu() {
    el.inlineMenu.classList.add('hidden');
    inline.trigger = null;
    inline.items = [];
    wikiTexts.clear();
  }

  function inlineMenuKey(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return false;
    const trigger = inline.trigger;
    if (!trigger || el.inlineMenu.classList.contains('hidden')) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = inline.items.length;
      inline.active = (inline.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      paintInline();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); chooseInline(inline.active); return true; }
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      inline.dismissedAt = trigger.kind + ':' + trigger.from;
      hideInlineMenu();
      return true;
    }
    return false;
  }

  async function chooseInline(i: number) {
    const it = inline.items[i];
    const t = inline.trigger;
    const rich = state.rich;
    if (!it || !t || !rich) return;
    const range = { from: t.from, to: t.to };
    hideInlineMenu();
    if (t.kind === 'slash') {
      if (it.kind === 'date') { rich.insertTextAt(range, new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })); return; }
      if (it.kind === 'link') { rich.insertTextAt(range, '[['); return; }
      if (it.kind) rich.insertBlock(range, it.kind);
      return;
    }
    const typed = '[[' + t.query;
    const insertLink = async (title: string, targetId: string, known?: string | null) => {
      const noteId = state.currentId;
      const wiki = known !== undefined ? known : noteId && state.current && state.current.vaultId ? await api.notes.wikiLinkFor(noteId, targetId) : null;
      if (state.currentId !== noteId) return false;
      const r = rich.selectionRange();
      const at = rich.textAt(range) === typed ? range : { from: r.to, to: r.to };
      if (wiki) rich.insertWikiLinkAt(at, wiki); else rich.insertLinkAt(at, title, 'note://' + targetId);
      return true;
    };
    if (it.create) {
      let created;
      try { created = await api.notes.create({ title: it.create, folderId: state.current ? state.current.folderId || null : null }); }
      catch (err) { toast('Could not create the note: ' + (err.message || err)); return; }
      if (!(await insertLink(it.create, created.id))) return;
      inline.notes = null;
      refresh({ keepEditor: true });
      toast('Created "' + H.truncate(it.create, 40) + '". Ctrl+click the link to open it.');
      return;
    }
    if (it.note) await insertLink(it.title, it.note.id, it.wiki);
  }

  function prefetchWikiLinks(items: InlineItem[]) {
    const noteId = state.currentId;
    if (!noteId || !state.current || !state.current.vaultId) { for (const it of items) it.wiki = null; return; }
    for (const it of items) {
      if (!it.note) continue;
      const key = noteId + '\n' + it.note.id;
      const known = wikiTexts.get(key);
      if (known !== undefined) { it.wiki = known; continue; }
      api.notes.wikiLinkFor(noteId, it.note.id).then((wiki) => { wikiTexts.set(key, wiki); if (state.currentId === noteId) it.wiki = wiki; }).catch(() => {});
    }
  }

  function syncTextViews(note: PublicNote | null) {
    const none = lockedNow() || isViewerOnlyFile(note);
    const isTable = H.isTableFile(note);
    const table = isTable && !state.sourceMode && !none;
    el.richEditor.classList.toggle('hidden', none || state.sourceMode || isTable);
    el.bodyInput.classList.toggle('hidden', none || !state.sourceMode);
    el.csvView.classList.toggle('hidden', !table);
    fillPane(table || (!!note && note.fileKind === 'image' && !lockedNow()));
    if (table && note) renderTable(note);
  }

  let tableDrawn: { id: string, text: string } | null = null;
  let tableStats: { rows: number; cols: number; } | null = null;
  function renderTable(note: PublicNote) {
    const text = el.bodyInput.value;
    if (!tableDrawn || tableDrawn.id !== note.id || tableDrawn.text !== text) {
      tableStats = NotesCsv.render(el.csvView, text, H.extOf(note.filePath));
      tableDrawn = { id: note.id, text };
    }
    updateStatus(note);
  }
  function fillPane(on: boolean) {
    el.editorColumn.classList.toggle('fills-pane', on);
    el.editor.classList.toggle('fills-pane', on);
  }

  function syncSourceButton() {
    const table = H.isTableFile(state.current);
    const label = state.sourceMode ? (table ? 'Table' : 'Rendered') : (table ? 'Text' : 'Source');
    const what = state.sourceMode ? (table ? 'Show as a table' : 'Back to the rendered view') : (table ? 'Edit as text' : 'Show Markdown source');
    setLabel(el.sourceBtn, label);
    el.sourceBtn.setAttribute('aria-label', what);
    el.sourceBtn.title = what + ' (Ctrl+E)';
  }

  function applyEditorMode(source: boolean) {
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

  function toggleSource(force?: boolean) {
    const next = typeof force === 'boolean' ? force : !state.sourceMode;
    if (isViewerOnlyFile(state.current)) { toast('This file is shown as it is; it has no Markdown view to switch to.'); return; }
    if (next === state.sourceMode) return;
    if (!next && isPlainTextFile(state.current) && !H.isTableFile(state.current)) { toast('This is a plain-text file, so it is edited as the text it is.'); return; }
    if (!next && !state.rich && !H.isTableFile(state.current)) { toast('The rendered editor is unavailable; staying in Markdown source.'); return; }
    const rich = state.rich;
    if (!next && rich && state.currentId && !isPlainTextFile(state.current)) {
      state.currentLossless = rich.setMarkdown(el.bodyInput.value);
      if (state.current && state.current.filePath && !state.current.home && state.currentLossless && !rich.lastRoundTripExact()) state.currentLossless = false;
      if (state.currentLossless === false) {
        state.lossyOverride = state.currentId;
        toast('Heads up: editing this note in the rendered view will rewrite formatting it cannot show.');
      }
    }
    applyEditorMode(next);
    if (!H.isTableFile(state.current)) updateSettings({ editorMode: next ? 'source' : 'rendered' });
    focusBody();
  }

  const LINK_HINT = 'Alt+Enter opens the link';
  function showLinkHint(on: boolean) {
    if (on && (state.sourceMode || el.richEditor.classList.contains('hidden'))) return;
    if (on) { el.statusCode.textContent = LINK_HINT; el.statusCode.classList.remove('hidden'); return; }
    if (el.statusCode.textContent === LINK_HINT) { el.statusCode.textContent = ''; el.statusCode.classList.add('hidden'); }
  }

  async function followWikiLink(raw: string) {
    const id = state.currentId;
    if (!id) return;
    const [target] = await api.notes.resolveLinks(id, [H.wikiLinkName(raw)]);
    if (state.currentId !== id) return;
    if (target) { await followLink('note://' + target); return; }
    const name = H.wikiLinkTarget(raw).replace(/\.(md|markdown|mdx)$/i, '');
    const message = 'No note named "' + H.wikiLinkLabel(raw) + '" in this vault.';
    const folderId = state.current && state.current.vaultId ? state.current.folderId : null;
    if (!folderId || !name || name.includes('/') || /\.[a-z0-9]{2,5}$/i.test(name)) { toast(message); return; }
    toast(message, { label: 'Create note', run: () => createFromLink(name, folderId) });
  }

  async function createFromLink(name: string, folderId: string) {
    let created;
    try { created = await api.notes.create({ title: name, folderId }); }
    catch (err) { toast('Could not create the note: ' + (err.message || err)); return; }
    if (state.rich) state.rich.refreshWikiLinks();
    await refresh({ keepEditor: true });
    await followLink('note://' + created.id);
  }

  function openLinkAtCaret() {
    const at = state.rich && !state.sourceMode ? state.rich.linkAtCaret() : null;
    if (!at) { toast('Put the caret on a link to open it.'); return; }
    if ('wiki' in at) followWikiLink(at.wiki); else followLink(at.href);
  }

  async function followLink(href: string | null) {
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
    el.linkNoteSelect.innerHTML = '<option value="">— pick a note —</option>';
    api.notes.rows({ sort: 'title' }).then((notes) => {
      for (const n of notes) { if (n.id === state.currentId) continue; const o = document.createElement('option'); o.value = 'note://' + n.id; o.textContent = H.truncate(H.deriveTitle(n), 60); el.linkNoteSelect.append(o); }
      if (/^note:\/\//.test(existing)) el.linkNoteSelect.value = existing;
    });
    el.linkInput.value = existing || 'https://';
    el.linkRemoveBtn.classList.toggle('hidden', !existing);
    el.linkDialog.showModal();
    el.linkInput.focus();
    el.linkInput.select();
  }

  function tableStatsNow() { return tableStats; }

  return { createRichEditor, syncTextViews, renderTable, tableStatsNow, syncSourceButton, applyEditorMode, toggleSource, followLink, openLinkDialog, openLinkAtCaret };
}
