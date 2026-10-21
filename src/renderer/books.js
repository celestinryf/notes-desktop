import { el } from './dom.js';
import { state } from './state.js';
import { markdownToHtml } from './note-html.js';
import H from '../shared/helpers.js';
import { escapeHtml, ipcErrorText } from './text.js';
import { toast } from './toast.js';
import { placePopover } from './popover.js';

const { isNonMarkdownFile } = H;

export function createBooks({ api, flattenTree, selectNote, selectNoteNow, refresh, flushSave, clearEditor, setView, trashCurrent, syncTitleBar }) {
  const book = { id: null, pages: [], dragId: null, seq: 0 };

  function bookOf(note) {
    if (!note || !note.folderId || note.trashedAt) return null;
    const f = flattenTree(state.tree).find((x) => x.id === note.folderId);
    return f && f.book ? f : null;
  }

  async function renderBookStrip(note) {
    const seq = ++book.seq; // only the newest call may draw: an older one resolving late must not revive a book
    const b = bookOf(note);
    el.bookStrip.classList.toggle('hidden', !b);
    if (!b) { book.id = null; book.pages = []; return; }
    const forNote = note.id;
    const pages = await api.notes.list({ folderId: b.id });
    if (seq !== book.seq || state.currentId !== forNote) return; // superseded, or moved on while loading
    book.id = b.id; book.pages = pages;
    el.bookName.textContent = b.name;
    el.bookTabs.innerHTML = '';
    pages.forEach((p, i) => {
      // A focusable div, not a <button>: Chromium does not start a drag from a button, and tabs reorder by dragging.
      const tab = document.createElement('div');
      tab.tabIndex = 0;
      tab.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tab.click(); } });
      tab.className = 'book-tab' + (p.id === note.id ? ' is-active' : '');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(p.id === note.id));
      tab.dataset.id = p.id;
      tab.draggable = true;
      tab.innerHTML = '<span class="no"></span><span class="t"></span>';
      tab.querySelector('.no').textContent = String(i + 1);
      tab.querySelector('.t').textContent = H.truncate(H.deriveTitle(p) || 'Untitled', 28);
      tab.title = H.deriveTitle(p) || 'Untitled';
      tab.addEventListener('click', () => { if (p.id !== state.currentId) selectNote(p.id); });
      tab.addEventListener('contextmenu', (e) => { e.preventDefault(); openPageMenu(p.id, tab, e); });
      tab.addEventListener('dragstart', (e) => { book.dragId = p.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'page'); });
      tab.addEventListener('dragover', (e) => { if (!book.dragId || book.dragId === p.id) return; e.preventDefault(); tab.classList.add('drop-before'); });
      tab.addEventListener('dragleave', () => tab.classList.remove('drop-before'));
      tab.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); tab.classList.remove('drop-before'); movePage(book.dragId, p.id); });
      tab.addEventListener('dragend', () => { book.dragId = null; });
      el.bookTabs.append(tab);
    });
    const idx = pages.findIndex((p) => p.id === note.id);
    el.bookPrevBtn.disabled = idx <= 0;
    el.bookNextBtn.disabled = idx === -1 || idx >= pages.length - 1;
    const active = el.bookTabs.querySelector('.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Moves page dragId so it sits just before page beforeId.
  async function movePage(dragId, beforeId) {
    if (!book.id || !dragId || dragId === beforeId) return;
    const ids = book.pages.map((p) => p.id).filter((x) => x !== dragId);
    const at = ids.indexOf(beforeId);
    ids.splice(at === -1 ? ids.length : at, 0, dragId);
    await api.folders.reorderPages(book.id, ids);
    await refresh({ keepEditor: true });
    if (state.current) renderBookStrip(state.current);
  }

  function stepPage(delta) {
    if (!book.id || !state.currentId) return false;
    const idx = book.pages.findIndex((p) => p.id === state.currentId);
    const next = book.pages[idx + delta];
    if (idx === -1 || !next) return false;
    selectNote(next.id);
    return true;
  }

  async function addPage() {
    if (!book.id) return;
    await flushSave();
    let note;
    try { note = await api.notes.create({ folderId: book.id, title: '' }); }
    catch (err) { toast('Could not add a page: ' + (err.message || err)); return; }
    await refresh({ keepEditor: true });
    await selectNoteNow(note.id);
    el.titleInput.focus();
  }

  async function toggleBook(folderId, on) {
    try { await api.folders.setBook(folderId, on); }
    catch (err) { toast('Could not change the folder: ' + (err.message || err)); return; }
    await refresh({ keepEditor: true });
    if (state.current) renderBookStrip(state.current);
    toast(on ? 'This folder is now a book: its notes are pages you can page through and reorder.' : 'Back to an ordinary folder.');
  }

  // ---- split a long note into a book at its headings -------------------------------

  async function openSplitDialog() {
    const note = state.current;
    if (!note || note.trashedAt) return;
    if (note.locked || note.lock) { toast('Unlock and remove the lock first: a locked note cannot be split.'); return; }
    if (note.filePath) { toast('This note is a file on disk; only notes kept in the app can be split.'); return; }
    await flushSave();
    if (!state.current || state.current.id !== note.id) return;
    const plan = H.splitAtHeadings(state.current.body, H.deriveTitle(state.current));
    if (plan.pages.length < 2) { toast('Add at least two headings (lines starting with #) to split this note into pages.'); return; }
    state.splitNoteId = note.id;
    el.splitLead.textContent = 'This makes a book with ' + plan.pages.length + ' pages, one per ' + (plan.level ? '#'.repeat(plan.level) + ' heading' : 'heading') + ':';
    el.splitPages.innerHTML = '';
    for (const p of plan.pages) {
      const li = document.createElement('li');
      li.textContent = p.title;
      const n = p.body ? p.body.split('\n').length : 0;
      const small = document.createElement('span');
      small.className = 'lines';
      small.textContent = n ? n + (n === 1 ? ' line' : ' lines') : 'empty';
      li.append(small);
      el.splitPages.append(li);
    }
    el.splitName.value = plan.name;
    el.splitKeep.checked = false;
    el.splitDialog.showModal();
    el.splitName.focus(); el.splitName.select();
  }

  async function applySplit() {
    const id = state.splitNoteId;
    state.splitNoteId = null;
    el.splitDialog.close();
    if (!id) return;
    await flushSave();
    let r;
    try { r = await api.notes.splitIntoBook(id, { name: el.splitName.value, keepOriginal: el.splitKeep.checked }); }
    catch (err) { toast('Could not split the note: ' + ipcErrorText(err)); return; }
    if (r.originalTrashed && state.currentId === id) clearEditor();
    await setView('folder', r.folder.id, { keepEditor: true });
    await selectNoteNow(r.pageIds[0]);
    toast('Made the book "' + H.truncate(r.folder.name, 30) + '" with ' + r.pageIds.length + ' pages' + (r.originalTrashed ? '; the original note is in the trash.' : '.'), {
      label: 'Undo',
      run: async () => {
        await flushSave();
        try { await api.notes.undoSplit(r.folder.id, r.pageIds, r.originalTrashed ? id : null); }
        catch (err) { toast('Could not undo the split: ' + ipcErrorText(err)); return; }
        // Go back to the original only if the person is still in the book; otherwise leave their view alone.
        const inBook = (state.view === 'folder' && state.folderId === r.folder.id) || r.pageIds.includes(state.currentId);
        if (!inBook) { await refresh(); return; }
        clearEditor();
        await setView('all', null, { keepEditor: true });
        await selectNoteNow(id);
      },
    });
  }

  // Puts page id right after page afterId in the book's reading order.
  async function placePageAfter(id, afterId) {
    const pages = await api.notes.list({ folderId: book.id });
    const ids = pages.map((p) => p.id).filter((x) => x !== id);
    const at = ids.indexOf(afterId);
    ids.splice(at === -1 ? ids.length : at + 1, 0, id);
    await api.folders.reorderPages(book.id, ids);
  }

  function openPageMenu(id, anchor, ev) {
    closeAllBookMenus();
    state.menuPageId = id;
    state.menuBookId = book.id;
    const idx = book.pages.findIndex((p) => p.id === id);
    el.pageMenu.querySelector('[data-action="move-left"]').disabled = idx <= 0;
    el.pageMenu.querySelector('[data-action="move-right"]').disabled = idx === -1 || idx >= book.pages.length - 1;
    placePopover(el.pageMenu, anchor, ev);
  }

  function openBookMenu() {
    closeAllBookMenus();
    if (!book.id) return;
    placePopover(el.bookMenu, el.bookName, null);
  }

  function closeAllBookMenus() {
    state.menuPageId = null;
    state.menuBookId = null;
    el.pageMenu.classList.add('hidden');
    el.bookMenu.classList.add('hidden');
  }

  async function pageMenuAction(action) {
    const id = state.menuPageId;
    const bookId = state.menuBookId;
    closeAllBookMenus();
    if (!id || !bookId) return;
    await flushSave();
    if (book.id !== bookId) return; // the person moved to another book meanwhile: act on nothing
    const idx = book.pages.findIndex((p) => p.id === id);
    const page = book.pages[idx];
    try {
      if (action === 'rename') {
        if (id !== state.currentId) await selectNoteNow(id);
        el.titleInput.focus(); el.titleInput.select();
      } else if (action === 'insert-after') {
        const note = await api.notes.create({ folderId: book.id, title: '' });
        await placePageAfter(note.id, id);
        await refresh({ keepEditor: true });
        await selectNoteNow(note.id);
        el.titleInput.focus();
      } else if (action === 'duplicate') {
        const copy = await api.notes.duplicate(id);
        await placePageAfter(copy.id, id);
        await refresh({ keepEditor: true });
        await selectNoteNow(copy.id);
        toast('Page duplicated');
      } else if (action === 'move-left' || action === 'move-right') {
        const ids = book.pages.map((p) => p.id);
        const to = idx + (action === 'move-left' ? -1 : 1);
        if (idx === -1 || to < 0 || to >= ids.length) return;
        ids.splice(idx, 1); ids.splice(to, 0, id);
        await api.folders.reorderPages(book.id, ids);
        await refresh({ keepEditor: true });
        if (state.current) renderBookStrip(state.current);
      } else if (action === 'copy-link') {
        await api.app.copy({ text: '[' + (H.deriveTitle(page) || 'Page') + '](note://' + id + ')' });
        toast('Copied. Paste it into another note to link to this page.');
      } else if (action === 'delete') {
        if (id === state.currentId) { await trashCurrent(); return; }
        const title = H.deriveTitle(page) || 'Untitled';
        await api.notes.trash(id);
        await refresh({ keepEditor: true });
        if (state.current) renderBookStrip(state.current);
        toast('Moved "' + H.truncate(title, 30) + '" to trash', { label: 'Undo', run: async () => { await api.notes.restore(id); await refresh({ keepEditor: true }); if (state.current) renderBookStrip(state.current); } });
      }
    } catch (err) {
      toast('Could not change the page: ' + (err.message || err));
    }
  }

  async function bookMenuAction(action) {
    closeAllBookMenus();
    if (!book.id) return;
    if (action === 'read') openReader();
    else if (action === 'export-md') exportBook('md');
    else if (action === 'export-html') exportBook('html');
    else if (action === 'export-pdf') exportBook('pdf');
    else if (action === 'print') exportBook('print');
    else if (action === 'rename') renameBookInline();
    else if (action === 'unbook') toggleBook(book.id, false);
  }

  // Renames the book in place: the strip's name becomes a text field.
  function renameBookInline() {
    const folder = flattenTree(state.tree).find((f) => f.id === book.id);
    if (!folder) return;
    const input = document.createElement('input');
    input.className = 'book-name-input';
    input.value = folder.name;
    input.setAttribute('aria-label', 'Book name');
    let done = false;
    const finish = async (save) => {
      if (done) return; done = true;
      const name = input.value.trim();
      input.replaceWith(el.bookName);
      if (save && name && name !== folder.name) {
        try { await api.folders.rename(folder.id, name); } catch (err) { toast('Could not rename the book: ' + (err.message || err)); }
        await refresh({ keepEditor: true });
      }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
    el.bookName.replaceWith(input);
    input.focus(); input.select();
  }

  // Gathers the current book: its name and pages in order, each with Markdown and HTML.
  // Locked pages stay locked: only their title goes in.
  async function collectBook(bookId) {
    await flushSave();
    const folder = flattenTree(state.tree).find((f) => f.id === bookId);
    const pages = await api.notes.list({ folderId: bookId });
    // One file at a time: a book of PDFs must not start a reader for every page at once.
    const bodies = [];
    for (const p of pages) bodies.push(p.locked && !p.unlocked ? '' : await pageMarkdown(p));
    return {
      name: folder ? folder.name : 'Book',
      pages: pages.map((p, i) => {
        const locked = !!(p.locked && !p.unlocked);
        const body = locked ? '' : bodies[i];
        return { id: p.id, no: i + 1, title: H.deriveTitle(p) || 'Untitled', locked, body, html: locked ? '' : markdownToHtml(body, p) };
      }),
    };
  }

  // A page as Markdown. An opened file that is not Markdown (plain text, Word, PDF) is converted the way "Convert
  // to… Markdown" would, so its text is never read as Markdown by accident.
  async function pageMarkdown(p) {
    if (!isNonMarkdownFile(p)) return String(p.body || '');
    try {
      const r = await api.files.asMarkdown(p.id);
      return r.ok ? r.markdown : '*Could not show this file: ' + r.error + '*';
    } catch (err) { return '*Could not show this file: ' + ipcErrorText(err) + '*'; }
  }

  function bookMarkdown(b) {
    const toc = b.pages.map((p) => p.no + '. ' + p.title).join('\n');
    const parts = b.pages.map((p) => '## ' + p.title + '\n\n' + (p.locked ? '_This page is locked._' : p.body.trim()) + '\n');
    return '# ' + b.name + '\n\n**Contents**\n\n' + toc + '\n\n' + parts.join('\n');
  }

  // The book as HTML: its name, a contents list linking to the pages, then one section per page.
  function bookHtml(b) {
    const toc = '<nav class="book-toc"><h2>Contents</h2><ol>' + b.pages.map((p) => '<li><a href="#page-' + p.no + '" data-page="' + p.no + '">' + escapeHtml(p.title) + '</a></li>').join('') + '</ol></nav>';
    const pages = b.pages.map((p) => '<section class="book-page" id="page-' + p.no + '"><h2>' + escapeHtml(p.title) + '</h2>' +
      (p.locked ? '<p class="book-page-locked">This page is locked.</p>' : p.html) + '</section>').join('\n');
    return '<h1>' + escapeHtml(b.name) + '</h1>' + toc + pages;
  }

  async function exportBook(format) {
    const bookId = readerOpen() ? reader.bookId : book.id; // the reader's buttons export the book being read
    if (!bookId) return;
    const b = await collectBook(bookId);
    if (!b.pages.length) { toast('This book has no pages yet.'); return; }
    const r = await api.book.export(format, { name: b.name, markdown: bookMarkdown(b), html: bookHtml(b) });
    if (r.ok) toast(format === 'print' ? 'Sent the book to the printer' : 'Saved the book to ' + r.filePath);
    else if (!r.canceled) toast('Could not export the book: ' + r.error);
  }

  // ---- the reading view: the whole book on one page ----

  // The reading view is a snapshot of one book; reader.bookId says which.
  const reader = { bookId: null, seq: 0 };

  async function openReader() {
    const bookId = book.id;
    if (!bookId) return;
    const seq = ++reader.seq;
    const b = await collectBook(bookId);
    if (seq !== reader.seq || book.id !== bookId) return; // moved on while the pages loaded
    reader.bookId = bookId;
    el.bookReaderTitle.textContent = b.name;
    el.bookReaderToc.innerHTML = '<h2>Contents</h2><ol>' + b.pages.map((p) => '<li><a data-page="' + p.no + '">' + escapeHtml(p.title) + '</a></li>').join('') + '</ol>';
    el.bookReaderBody.innerHTML = b.pages.map((p) => '<article class="book-page" id="reader-page-' + p.no + '">' +
      '<div class="book-page-head"><span class="no">' + p.no + '</span><h2>' + escapeHtml(p.title) + '</h2><button class="tool-btn" data-edit="' + p.id + '">Edit</button></div>' +
      (p.locked ? '<p class="book-page-locked">This page is locked. Open it to unlock.</p>' : '<div class="rich-editor-content">' + p.html + '</div>') + '</article>').join('');
    el.bookReader.classList.remove('hidden');
    syncTitleBar();
    el.bookReaderScroll.scrollTop = 0;
    el.bookReaderCloseBtn.focus();
  }

  function closeReader() {
    reader.seq++; // an opening still loading must not appear after this
    reader.bookId = null;
    el.bookReader.classList.add('hidden');
    el.bookReaderBody.innerHTML = '';
    syncTitleBar();
  }

  function readerOpen() { return !el.bookReader.classList.contains('hidden'); }

  return { book, bookOf, renderBookStrip, stepPage, addPage, toggleBook, openSplitDialog, applySplit, openBookMenu, closeAllBookMenus, pageMenuAction, bookMenuAction, exportBook, reader, openReader, closeReader, readerOpen };
}
