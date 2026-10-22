/* The page organizer for an open PDF, exposed as window.NotesPdfPages: turn, move and remove pages, and add pages
   from another PDF. Changes are only a plan until Apply; then pdf.js builds the new page order and main turns the
   pages and writes the file. */
import NotesIcons from './icons.js';
import { requireChild } from './pdf-editor.ts';
import type { PdfController } from './pdf-editor.ts';

export type PdfPageInfo = { document: Uint8Array | null, includePages: number[], pageIndices: number[] };
export type PdfPagesPlan = { pageInfos: PdfPageInfo[] | null, rotations: number[] };
export type PdfPagesHooks = {
  pickPdf: () => Promise<{ name: string, bytes: Uint8Array } | null>,
  apply: (plan: PdfPagesPlan) => Promise<boolean>,
  close: () => void,
  say: (text: string) => void,
};
type PageItem = { src: string, index: number, turn: number };
type PageSource = { name: string, draw: (index: number, canvas: HTMLCanvasElement, width: number) => Promise<void>, bytes: Uint8Array | null };

export const NotesPdfPages = (function () {
  'use strict';
  const THUMB_W = 130, THUMB_H = 170;

  // panel: the .pdf-pages element. ctl: the NotesPdfEditor controller of the open PDF. hooks:
  //   pickPdf() -> Promise<{ name, bytes } | null>   a PDF to take pages from
  //   apply({ pageInfos, rotations }) -> Promise<bool>   pageInfos null when the order is unchanged
  //   close()   say(text)
  function create(panel: HTMLElement, ctl: PdfController, hooks: PdfPagesHooks) {
    const grid = requireChild(panel, '.pdf-pages-grid', HTMLElement);
    // items: the pages in their new order, { src, index, turn }. src 'self' is this PDF; others are added PDFs.
    let items: PageItem[] = [], sources = new Map<string, PageSource>(), canvases = new Map<string, HTMLCanvasElement>(), added = 0, working = false;

    function open() {
      items = [];
      for (let i = 0; i < ctl.pageCount(); i++) items.push({ src: 'self', index: i, turn: 0 });
      sources = new Map([['self', { name: '', draw: ctl.drawPage, bytes: null }]]);
      canvases = new Map();
      added = 0;
      render();
    }

    // Each page is drawn once; a card is rebuilt around the same canvas when the plan changes.
    function sourceOf(src: string) {
      const source = sources.get(src);
      if (!source) throw new Error('No page source ' + src + '.');
      return source;
    }

    function canvasFor(it: PageItem) {
      const key = it.src + ':' + it.index;
      const known = canvases.get(key);
      if (known) return known;
      const c = document.createElement('canvas');
      canvases.set(key, c);
      sourceOf(it.src).draw(it.index, c, THUMB_W).then(() => fit(c), () => {});
      return c;
    }

    // A turned page is scaled so it still fits its box.
    function fit(c: HTMLCanvasElement) {
      const turn = Number(c.dataset.turn || 0);
      const w = c.offsetWidth || THUMB_W, h = c.offsetHeight || THUMB_H;
      const scale = turn % 180 ? Math.min(1, THUMB_W / h, THUMB_H / w) : 1;
      c.style.transform = 'rotate(' + turn + 'deg) scale(' + scale + ')';
    }

    function button(act: string, k: number, icon: string, title: string) {
      const b = document.createElement('button');
      b.className = 'tool-btn icon-only';
      b.dataset.act = act;
      b.dataset.k = String(k);
      b.innerHTML = NotesIcons.svg(icon);
      b.title = title;
      b.setAttribute('aria-label', title);
      return b;
    }

    function render() {
      grid.replaceChildren(...items.map((it, k) => {
        const card = document.createElement('figure');
        card.className = 'pdf-page-card';
        const box = document.createElement('div');
        box.className = 'pdf-page-thumb';
        const c = canvasFor(it);
        c.dataset.turn = String(it.turn);
        fit(c);
        box.append(c);
        const cap = document.createElement('figcaption');
        cap.className = 'pdf-page-num';
        const from = sourceOf(it.src).name;
        cap.textContent = (k + 1) + (from ? ' · ' + from + ' p. ' + (it.index + 1) : it.index !== k ? ' · was ' + (it.index + 1) : '');
        cap.title = cap.textContent;
        const acts = document.createElement('div');
        acts.className = 'pdf-page-acts';
        acts.append(
          button('left', k, 'chevron-left', 'Move earlier'),
          button('turn-left', k, 'rotate-ccw', 'Turn left'),
          button('turn-right', k, 'rotate-cw', 'Turn right'),
          button('remove', k, 'x', 'Remove this page'),
          button('right', k, 'chevron-right', 'Move later'),
        );
        card.append(box, cap, acts);
        return card;
      }));
    }

    function act(name: string, k: number) {
      const it = items[k];
      if (!it) return;
      if (name === 'left' && k > 0) [items[k - 1], items[k]] = [items[k], items[k - 1]];
      else if (name === 'right' && k < items.length - 1) [items[k + 1], items[k]] = [items[k], items[k + 1]];
      else if (name === 'turn-left') it.turn = (it.turn + 270) % 360;
      else if (name === 'turn-right') it.turn = (it.turn + 90) % 360;
      else if (name === 'remove') items.splice(k, 1);
      else return;
      render();
    }

    async function addFromPdf() {
      const picked = await hooks.pickPdf();
      if (!picked) return;
      let other: Awaited<ReturnType<PdfController['openOther']>>;
      try { other = await ctl.openOther(picked.bytes); } catch (err) { hooks.say('Could not read ' + picked.name + ': ' + (err.message || err)); return; }
      const src = 'added-' + (++added);
      sources.set(src, { name: picked.name, draw: other.draw, bytes: other.bytes });
      for (let i = 0; i < other.pages; i++) items.push({ src, index: i, turn: 0 });
      render();
      grid.scrollTop = grid.scrollHeight;
    }

    async function apply() {
      if (working) return;
      if (!items.length) { hooks.say('A PDF needs at least one page. Use Cancel to keep it as it is.'); return; }
      const reordered = items.length !== ctl.pageCount() || items.some((it, k) => it.src !== 'self' || it.index !== k);
      const rotations = items.map((it) => it.turn);
      if (!reordered && !rotations.some(Boolean)) { hooks.close(); return; }
      let pageInfos: PdfPageInfo[] | null = null;
      if (reordered) {
        // pdf.js takes each document's pages in their own order and puts them at the given new positions.
        const bySrc = new Map<string, { index: number, pos: number }[]>();
        items.forEach((it, pos) => {
          let list = bySrc.get(it.src);
          if (!list) { list = []; bySrc.set(it.src, list); }
          list.push({ index: it.index, pos });
        });
        pageInfos = [...bySrc].map(([src, list]) => {
          list.sort((a, b) => a.index - b.index);
          return { document: src === 'self' ? null : sourceOf(src).bytes, includePages: list.map((e) => e.index), pageIndices: list.map((e) => e.pos) };
        });
      }
      working = true;
      panel.classList.add('is-working');
      try { if (await hooks.apply({ pageInfos, rotations })) hooks.close(); } finally {
        working = false;
        panel.classList.remove('is-working');
      }
    }

    grid.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('button[data-act]') : null;
      if (b && b.dataset.act && !working) act(b.dataset.act, Number(b.dataset.k));
    });
    requireChild(panel, '.pdf-pages-bar', HTMLElement).addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>('button[data-pages-act]') : null;
      if (!b || working) return;
      if (b.dataset.pagesAct === 'add') addFromPdf();
      else if (b.dataset.pagesAct === 'cancel') hooks.close();
      else if (b.dataset.pagesAct === 'apply') apply();
    });

    return { open };
  }

  return { create };
})();
