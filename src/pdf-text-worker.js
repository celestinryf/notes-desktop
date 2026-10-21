// @ts-check
'use strict';
/* Pulls the text out of a PDF, in a worker thread so a long PDF never stalls the app. Posts back one list of
   paragraphs per page; a page with no text (a scanned image) comes back empty. */
const { parentPort, workerData } = require('worker_threads');
const port = parentPort;
if (!port) throw new Error('this script runs in a worker thread only');

const LIST_START = /^([•◦▪▫‣●○■□☐☑–—*-]|\d{1,3}[.)]|[a-z][.)]|\[[ xX]\])\s/;

// Lines are joined into paragraphs. A new one starts at a vertical gap well over a line's height, at a change of
// text size (a heading), and at a line that starts like a list item ("•", "3.", "a)").
const newParagraph = (prev, ln, text) => Math.abs(prev.y - ln.y) > 1.6 * Math.max(ln.h, prev.h)
  || Math.abs(ln.h - prev.h) > 0.15 * Math.max(ln.h, prev.h) || LIST_START.test(text);
function pageParagraphs(items) {
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue; // marked-content markers
    if (!cur) cur = { text: '', y: it.transform[5], h: it.height || Math.abs(it.transform[3]) || 10 };
    cur.text += it.str;
    if (it.hasEOL) { lines.push(cur); cur = null; }
  }
  if (cur) lines.push(cur);
  const paras = [];
  let para = null, prev = null;
  for (const ln of lines) {
    const text = ln.text.replace(/\s+/g, ' ').trim();
    if (!text) { para = null; continue; }
    if (!para || !prev || newParagraph(prev, ln, text)) { para = []; paras.push(para); }
    para.push(text);
    prev = ln;
  }
  // A line ending in a hyphen joins the next without a space ("well-" + "known"); others join with one.
  return paras.map((p) => p.reduce((acc, l) => (/-$/.test(acc) ? acc + l : acc + ' ' + l)));
}

(async () => {
  let task = null;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    task = pdfjs.getDocument({ data: new Uint8Array(workerData.bytes), disableFontFace: true, verbosity: 0 });
    const doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      pages.push(pageParagraphs((await page.getTextContent()).items));
      page.cleanup();
    }
    port.postMessage({ ok: true, pages });
  } catch (err) {
    port.postMessage({ ok: false, error: err.name === 'PasswordException' ? 'This PDF is password-protected.' : 'Could not read this PDF: ' + err.message });
  } finally {
    if (task) await task.destroy().catch(() => {});
  }
})();
