import { el } from './dom.js';
import { escapeHtml } from './text.js';

export function createBookReader({ book, collectBook, syncTitleBar }) {
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

  return { reader, openReader, closeReader, readerOpen };
}
