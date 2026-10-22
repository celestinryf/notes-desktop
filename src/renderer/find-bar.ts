import { el } from './dom.ts';
import { state, lockedNow } from './state.ts';
import { find } from './find-state.ts';
import { src } from './code-editor.ts';
import { currentHtml } from './note-html.ts';
import * as H from '../shared/helpers.mts';
import { escapeHtml } from './text.ts';
import { toast } from './toast.ts';
import { findOffsets, isQueryText } from './find-text.ts';
import { tableShown, focusBody } from './editor-view.ts';

const { isViewerOnlyFile } = H;

type FindBarDeps = { api: NotesApi, flushSave: () => Promise<unknown>, GUEST: boolean };

export function createFindBar({ api, flushSave, GUEST }: FindBarDeps) {
  function openFind() {
    if (!state.current) return;
    find.open = true;
    el.findBar.classList.remove('hidden');
    const selection = window.getSelection();
    const sel = (selection ? selection.toString() : '').trim();
    if (!sel && src.hasFocus()) {
      const t = src.value.slice(src.selectionStart, src.selectionEnd).trim();
      if (t) el.findInput.value = t;
    } else if (sel && sel.length < 200) el.findInput.value = sel;
    el.findInput.focus();
    el.findInput.select();
    runFind(true, true);
  }

  function toggleReplace(force?: boolean) {
    const on = typeof force === 'boolean' ? force : el.replaceRow.classList.contains('hidden');
    el.replaceRow.classList.toggle('hidden', !on);
    el.findReplaceToggle.setAttribute('aria-pressed', String(on));
    if (on) el.replaceInput.focus();
  }

  function replaceCurrent() {
    const q = el.findInput.value;
    const text = el.replaceInput.value;
    if (!q || lockedNow() || !state.current || state.current.trashedAt || isViewerOnlyFile(state.current)) return;
    if (state.sourceMode) {
      // Offsets can be stale (Tab, list keys and Restore change the text without an input event): recount
      // first, and only replace text that really is the query.
      const wanted = find.active;
      runFind(true, true, true);
      if (!find.sourceHits.length) { runFind(true, true); return; }
      find.active = Math.min(Math.max(wanted, 0), find.sourceHits.length - 1);
      const at = find.sourceHits[find.active];
      const ta = src;
      if (ta.readOnly) return;
      if (!isQueryText(ta.value.slice(at, at + q.length), q)) { showActiveMatch(); return; }
      ta.value = ta.value.slice(0, at) + text + ta.value.slice(at + q.length);
      ta.setSelectionRange(at + text.length, at + text.length);
      ta.dispatchEvent(new Event('input', { bubbles: true })); // autosave + recount
      runFind(true, true, true);
      // Select the match that now follows the replacement (no stepping, which would skip one).
      if (find.sourceHits.length) { const next = find.sourceHits.findIndex((h) => h >= at + text.length); find.active = next === -1 ? 0 : next; showActiveMatch(); }
      return;
    }
    if (tableShown()) { toast('Switch to Text (Ctrl+E) to replace in this file.'); return; }
    if (!state.rich) return;
    // Ranges may be stale (a restore or reload replaced the content): recount and check the text first.
    const wantedIdx = find.active;
    runFind(true, true, true);
    if (!find.ranges.length) { runFind(true, true); return; }
    find.active = Math.min(Math.max(wantedIdx, 0), find.ranges.length - 1);
    const idx = find.active;
    if (!isQueryText(String(find.ranges[idx]), q)) { showActiveMatch(); return; }
    state.rich.replaceRanges([find.ranges[idx]], text);
    runFind(true, true, true); // the quiet re-find keeps the index, which now points at the following match
    // A replacement that itself contains the query ("cat" -> "cats") creates matches at the same spot: skip them.
    const inside = findOffsets(text, q).length;
    if (find.ranges.length) { find.active = (idx + inside) % find.ranges.length; showActiveMatch(); }
  }

  // Selects / highlights and scrolls to find.active without changing it.
  function showActiveMatch() {
    const q = el.findInput.value;
    if (state.sourceMode) {
      const at = find.sourceHits[find.active];
      if (at === undefined) return;
      if (document.activeElement !== el.replaceInput) src.focus(); // Enter in the replace box keeps replacing
      src.setSelectionRange(at, at + q.length);
      src.reveal(at);
      el.findCount.textContent = (find.active + 1) + '/' + find.sourceHits.length;
      return;
    }
    if (window.CSS && CSS.highlights) CSS.highlights.set('notes-find-active', new Highlight(...(find.active >= 0 && find.ranges[find.active] ? [find.ranges[find.active]] : [])));
    const r = find.ranges[find.active];
    if (r) { const node = r.startContainer instanceof Element ? r.startContainer : r.startContainer.parentElement; if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    el.findCount.textContent = find.ranges.length ? (find.active + 1) + '/' + find.ranges.length : 'No matches';
  }

  function replaceAll() {
    const q = el.findInput.value;
    const text = el.replaceInput.value;
    if (!q || lockedNow() || !state.current || state.current.trashedAt || isViewerOnlyFile(state.current)) return;
    let n = 0;
    if (state.sourceMode) {
      const ta = src;
      if (ta.readOnly) return;
      const hits = findOffsets(ta.value, q);
      n = hits.length;
      if (!n) { toast('No matches'); return; }
      let out = '', last = 0;
      for (const at of hits) { out += ta.value.slice(last, at) + text; last = at + q.length; }
      ta.value = out + ta.value.slice(last);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      if (tableShown()) { toast('Switch to Text (Ctrl+E) to replace in this file.'); return; }
      if (!state.rich) return;
      runFind(true, true, true);
      n = state.rich.replaceRanges(find.ranges, text);
      if (!n) { toast('No matches'); return; }
    }
    runFind(true, true, true);
    toast('Replaced ' + n + (n === 1 ? ' match' : ' matches'));
  }

  function closeFind() {
    if (!find.open) return;
    find.open = false;
    el.findBar.classList.add('hidden');
    toggleReplace(false);
    el.findCount.textContent = '';
    clearFindHighlights();
    focusBody();
  }

  function clearFindHighlights() {
    if (window.CSS && CSS.highlights) { CSS.highlights.delete('notes-find'); CSS.highlights.delete('notes-find-active'); }
    find.ranges = []; find.sourceHits = []; find.active = -1;
  }

  // Ranges over the rendered editor's text nodes (matches may span node boundaries).
  function findRangesIn(root: HTMLDivElement, q: string) {
    const nodes: ({ node: Node; start: number; })[] = []; let text = '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const blockOf = (n: Node) => { let e = n.parentElement; while (e && e !== root && getComputedStyle(e).display === 'inline') e = e.parentElement; return e; };
    let lastBlock = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n instanceof Element) { if (n.tagName === 'BR' || n.tagName === 'IMG') text += '\n'; continue; } // line breaks and inline images separate: a match never straddles them
      const b = blockOf(n);
      if (lastBlock && b !== lastBlock) text += '\n'; // a separator no query can contain
      lastBlock = b;
      nodes.push({ node: n, start: text.length }); text += n.nodeValue;
    }
    const locate = (pos: number) => {
      let lo = 0, hi = nodes.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nodes[mid].start <= pos) lo = mid; else hi = mid - 1; }
      if (!nodes.length) return null;
      const node = nodes[lo].node;
      return { node, offset: Math.min(pos - nodes[lo].start, (node.nodeValue || '').length) }; // a position inside a separator clamps to the node's end
    };
    return findOffsets(text, q).map((pos) => {
      const s = locate(pos), e = locate(pos + q.length);
      if (!s || !e) return null;
      const r = document.createRange();
      r.setStart(s.node, s.offset);
      // The end may fall exactly at a node boundary: keep it inside the node where the match ends.
      const prev = e.offset === 0 && pos + q.length > 0 ? locate(pos + q.length - 1) : null;
      if (prev) r.setEnd(prev.node, prev.offset + 1); else r.setEnd(e.node, e.offset);
      return r;
    }).flatMap((r) => (r ? [r] : []));
  }

  // quiet: recount and re-highlight after the text changed, without moving the selection or scrolling.
  function runFind(forward?: boolean, fresh?: boolean, quiet?: boolean) {
    const q = el.findInput.value;
    const sameQuery = q === find.query;
    find.query = q;
    if (!q) { clearFindHighlights(); el.findCount.textContent = ''; return; }
    if (state.sourceMode) {
      if (fresh || !sameQuery || !find.sourceHits.length) {
        find.sourceHits = findOffsets(el.bodyInput.value, q);
        // Start from the caret so Enter finds the next match after where the person is.
        const caret = src.selectionStart || 0;
        const idx = find.sourceHits.findIndex((h) => h >= caret);
        find.active = find.sourceHits.length ? (idx === -1 ? 0 : idx) : -1; // past the last match wraps to the first
      } else if (find.sourceHits.length) {
        find.active = (find.active + (forward === false ? -1 : 1) + find.sourceHits.length) % find.sourceHits.length;
      }
      const n = find.sourceHits.length;
      if (n && find.active >= 0 && !quiet) {
        const at = find.sourceHits[find.active];
        // A textarea shows its selection only while focused, so stepping (Enter, F3) moves focus to the
        // text and keeps it there; F3 / Shift+F3 keep stepping from the text, Esc closes the bar.
        if (!fresh) src.focus();
        src.setSelectionRange(at, at + q.length);
        src.reveal(at);
      }
      el.findCount.textContent = n ? (find.active + 1) + '/' + n : 'No matches';
      el.findCount.classList.toggle('is-none', !n);
      return;
    }
    if (fresh || !sameQuery || !find.ranges.length) {
      find.ranges = findRangesIn(tableShown() ? el.csvView : el.richEditor, q);
      find.active = find.ranges.length ? (sameQuery && find.active >= 0 ? Math.min(find.active, find.ranges.length - 1) : 0) : -1; // after a replace, the next match now sits at the same index
    } else if (find.ranges.length) {
      find.active = (find.active + (forward === false ? -1 : 1) + find.ranges.length) % find.ranges.length;
    }
    if (window.CSS && CSS.highlights) {
      CSS.highlights.set('notes-find', new Highlight(...find.ranges));
      CSS.highlights.set('notes-find-active', new Highlight(...(find.active >= 0 ? [find.ranges[find.active]] : [])));
    }
    const n = find.ranges.length;
    if (n && find.active >= 0 && !quiet) {
      const r = find.ranges[find.active];
      const elNode = r.startContainer instanceof Element ? r.startContainer : r.startContainer.parentElement;
      if (elNode) elNode.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    el.findCount.textContent = n ? (find.active + 1) + '/' + n : 'No matches';
    el.findCount.classList.toggle('is-none', !n);
  }

  // The textarea auto-grows and .editor-scroll scrolls, so the match's visual position is measured with a
  // mirror element that wraps exactly like the textarea (newline counting would undershoot on long lines).
  function scrollTextareaToSelection(at: number) {
    const ta = el.bodyInput;
    const scroller = ta.closest('.editor-scroll') || ta;
    const cs = getComputedStyle(ta);
    const mirror = document.createElement('div');
    for (const prop of (['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'padding', 'border', 'boxSizing', 'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize'] as const)) mirror.style[prop] = cs[prop];
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.position = 'absolute'; mirror.style.visibility = 'hidden'; mirror.style.top = '0'; mirror.style.left = '-99999px';
    mirror.style.width = ta.clientWidth + 'px';
    mirror.textContent = ta.value.slice(0, at);
    const marker = document.createElement('span'); marker.textContent = '\u200b';
    mirror.append(marker);
    document.body.append(mirror);
    const y = marker.offsetTop;
    mirror.remove();
    const target = ta.offsetTop + y - scroller.clientHeight / 2;
    if (scroller !== ta) scroller.scrollTop = Math.max(0, target); else ta.scrollTop = Math.max(0, y - ta.clientHeight / 2);
  }

  async function printNote() {
    if (!state.current) return;
    await flushSave();
    const r = GUEST ? await api.book.export('print', exportOfCurrent()) : await api.app.print();
    if (!r.ok) toast('Could not print: ' + (r.error || 'unknown error'));
    else if (r.dry) toast('Print: dry run');
  }

  // The open note as a page of its own, for the export window (title, then the rendered body).
  function exportOfCurrent() {
    const note = state.current;
    if (!note) return { name: 'Note', html: '' };
    return { name: H.deriveTitle(note), html: (note.title ? '<h1>' + escapeHtml(note.title) + '</h1>' : '') + currentHtml() };
  }

  return { openFind, closeFind, runFind, toggleReplace, replaceCurrent, replaceAll, clearFindHighlights, scrollTextareaToSelection, printNote, exportOfCurrent };
}
