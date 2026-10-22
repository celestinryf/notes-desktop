import type { EditableParagraph } from '../docx-edit/ooxml.mts';
export const NotesDocxEditor = (function () {
  'use strict';
  const DV = window.DocxView;
  if (!DV || !DV.Ooxml || !DV.JSZip) return;
  const X = DV.Ooxml;
  type Scan = Extract<ReturnType<typeof X.scanDocument>, { prefix: string }>;
  type Fmt = { b?: boolean, i?: boolean, u?: boolean };
  type ShownChar = { ch: string, fmt: Fmt, br: boolean, real?: boolean, picture?: string | null };
  type ShownBaseline = { chars: Fmt[], pictures: (string | null)[], empty: Fmt };
  type ShownPiece = { els: HTMLElement[], source: number | undefined, chars: ShownChar[] };
  type PlacedPiece = ShownPiece & { source: number };
  type SaveInFlight = { plan: { first: number, last: number, pieces: PlacedPiece[] }[], patches: DocxPatch[], edits: number };
  type Hooks = { onDirty?: (dirty: boolean) => void, say: (text: string) => void, onKey?: (e: KeyboardEvent) => void, onBlur?: () => void };
  const isElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;
  const isText = (node: Node): node is Text => node.nodeType === Node.TEXT_NODE;
  const isHtmlElement = (node: Element): node is HTMLElement => node.namespaceURI === 'http://www.w3.org/1999/xhtml';
  const TAB_SHOWN = ' ';
  const BREAK = { ch: X.PAGE_BREAK, fmt: {}, br: false };
  const NOT_TEXT = new Set([X.PAGE_BREAK, X.PICTURE]);
  const PIC = 'data-notes-picture';
  const REAL_BR = 'data-notes-br';
  const ALLOWED = new Set(['insertText', 'insertReplacementText', 'insertCompositionText', 'insertParagraph', 'insertLineBreak',
    'deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteWordForward', 'deleteSoftLineBackward',
    'deleteSoftLineForward', 'deleteHardLineBackward', 'deleteHardLineForward', 'deleteByCut', 'deleteContent',
    'formatBold', 'formatItalic', 'formatUnderline']);

  function create(hooks: Hooks) {
    let doc: Document | null = null, xml = '', scan: Scan | null = null, baselines = new Map<number, ShownBaseline>(), dirty = false, edits = 0, seq = 0;
    const shownDoc = (): Document => { if (!doc) throw new Error('no Word document is open'); return doc; };
    const shownScan = (): Scan => { if (!scan) throw new Error('no Word document is open for editing'); return scan; };
    let gen = 0;
    const SRC = 'data-notes-src';
    const REST = 'data-notes-rest';
    const map = {
      get(p: Element): number | undefined {
        const v = p.getAttribute(SRC);
        const m = v && /^(\d+):(\d+)$/.exec(v);
        return m && Number(m[1]) === gen ? Number(m[2]) : undefined;
      },
      has(p: Element): boolean { return map.get(p) !== undefined; },
      set(p: HTMLParagraphElement | HTMLElement, index: number) { p.setAttribute(SRC, gen + ':' + index); },
    };
    let saving: SaveInFlight | null = null;
    let styleCache = new WeakMap<Element, Fmt>();

    function setDirty(v: boolean) {
      if (dirty === v) return;
      dirty = v;
      if (hooks.onDirty) hooks.onDirty(v);
    }

    function fmtOf(el: Element): Fmt {
      const cached = styleCache.get(el);
      if (cached) return cached;
      const win = el.ownerDocument.defaultView;
      if (!win) throw new Error('the Word document has no window');
      const cs = win.getComputedStyle(el);
      let u = false;
      for (let e: Element | null = el; e && !u; e = e.parentElement) {
        u = /underline/.test(win.getComputedStyle(e).textDecorationLine);
        if (e.tagName === 'P') break;
      }
      const f = { b: parseInt(cs.fontWeight, 10) >= 600, i: /italic|oblique/.test(cs.fontStyle), u };
      styleCache.set(el, f);
      return f;
    }

    function charsOf(p: HTMLParagraphElement) {
      const out: ShownChar[] = [];
      styleCache = new WeakMap();
      const walk = (node: Element) => {
        for (let n = node.firstChild; n; n = n.nextSibling) {
          if (isText(n)) {
            const fmt = fmtOf(node);
            for (let k = 0; k < n.data.length; k++) if (!NOT_TEXT.has(n.data[k])) out.push({ ch: n.data[k] === TAB_SHOWN ? '\t' : n.data[k], fmt, br: false });
          } else if (isElement(n)) {
            if (n.tagName === 'BR') out.push({ ch: '\n', fmt: fmtOf(node), br: true, real: n.hasAttribute(REAL_BR) });
            else if (n.tagName === 'DIV') out.push({ ch: X.PICTURE, fmt: fmtOf(node), br: false, picture: n.getAttribute(PIC) });
            else walk(n);
          }
        }
      };
      walk(p);
      if (out.length && out[out.length - 1].br) out.pop();
      for (let k = out.length - 2; k >= 0; k--) if (out[k].br && !out[k].real && out[k + 1].ch === X.PICTURE) out.splice(k, 1);
      return out;
    }
    const textOf = (chars: ShownChar[]) => chars.map((c) => c.ch).join('');
    const baselineOf = (chars: ShownChar[], empty: Fmt): ShownBaseline => ({ chars: chars.map((c) => c.fmt), pictures: chars.map((c) => c.picture || null), empty });

    let pictureSeq = 0;
    function namePictures(p: HTMLParagraphElement) {
      for (const d of p.querySelectorAll('div')) {
        if (d.parentElement?.closest('div, p') !== p || d.hasAttribute(PIC)) continue;
        d.setAttribute(PIC, String(++pictureSeq));
        d.contentEditable = 'false';
      }
    }

    function shownByPage() {
      return [...shownDoc().querySelectorAll<HTMLElement>('article[contenteditable="true"]')].map((art) => ({
        art, list: [...art.querySelectorAll('p')].filter((p) => !p.closest('[contenteditable="false"]')),
      }));
    }
    const shownParagraphs = () => shownByPage().flatMap((pg) => pg.list);
    function sources(list: HTMLParagraphElement[]) {
      const out = new Map<HTMLElement, number>();
      let last: number | undefined;
      for (const p of list) {
        const at = map.get(p);
        if (at !== undefined) last = at;
        if (last !== undefined) out.set(p, last);
      }
      const firstKnown = list.find((p) => map.has(p));
      const first = firstKnown ? map.get(firstKnown) : undefined;
      for (const p of list) if (!out.has(p) && first !== undefined) out.set(p, first);
      return out;
    }

    async function open(frameDoc: Document, bytes: Uint8Array) {
      const my = ++seq;
      reset();
      const zip = await DV.JSZip.loadAsync(bytes);
      const part = zip.file('word/document.xml');
      let block: string | null = null, display = bytes, nextScan: ReturnType<typeof X.scanDocument> | null = null, nextXml = '';
      if (!part) block = 'it has no main document part';
      else {
        nextXml = await part.async('string');
        const settings = zip.file('word/settings.xml');
        block = X.settingsBlock(settings ? await settings.async('string') : '');
        if (!block) {
          try { nextScan = X.scanDocument(nextXml); } catch (err) { block = err.message; }
          if (nextScan && !nextScan.prefix) block = 'it is not a standard Word document';
        }
        if (!block && nextScan && nextScan.prefix && nextScan.paragraphs.some((p) => p.editable)) {
          zip.file('word/document.xml', X.markForDisplay(nextXml, nextScan));
          display = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
        }
      }
      if (my !== seq) return null;
      await DV.renderAsync(display, frameDoc.body, frameDoc.body, { useBase64URL: true, renderAltChunks: false });
      if (my !== seq) return null;
      doc = frameDoc;
      xml = nextXml;
      scan = !block && nextScan && nextScan.prefix ? nextScan : null;
      const counts = scan ? attach() : { editable: 0, readOnly: 0 };
      if (scan && !counts.editable) scan = null;
      return Object.assign(counts, { block });
    }

    function attach() {
      let editable = 0;
      const pages = [...shownDoc().querySelectorAll<HTMLElement>('section.docx > article')];
      const take = (id: string) => {
        const mark = shownDoc().getElementById(id);
        const p = mark && mark.closest('p');
        if (mark) mark.remove();
        return p;
      };
      for (const para of shownScan().paragraphs) {
        if (!para.editable) continue;
        const p = take(X.MARK + para.index);
        const rest = para.pageBreaks.length ? take(X.BREAK_MARK + para.index) : null;
        for (const el of [p, rest]) {
          if (!el) continue;
          namePictures(el);
          for (const br of el.querySelectorAll('br')) br.setAttribute(REAL_BR, '');
        }
        const shown = p && !map.has(p) && shownAs(para, p, rest, pages);
        if (!shown || textOf(shown.chars) !== para.text) continue;
        map.set(p, para.index);
        if (rest) { map.set(rest, para.index); rest.setAttribute(REST, ''); }
        if (shown.mark) shown.mark();
        baselines.set(para.index, baselineOf(shown.chars, fmtOf(p)));
        editable++;
      }
      X.limitTo(shownScan(), (i) => baselines.has(i));
      const readOnly = shownScan().paragraphs.length - editable;
      if (!editable) return { editable, readOnly };
      const holders = new Set<Element>();
      for (const art of shownDoc().querySelectorAll<HTMLElement>('section.docx > article')) {
        for (const p of art.querySelectorAll('p')) if (map.has(p)) for (let e = p.parentElement; e && e !== art; e = e.parentElement) holders.add(e);
        fix(art, holders);
        art.contentEditable = 'true';
        art.spellcheck = true;
      }
      shownDoc().addEventListener('beforeinput', onBeforeInput, true);
      shownDoc().addEventListener('input', onInput, true);
      shownDoc().addEventListener('paste', onPaste, true);
      shownDoc().addEventListener('drop', (e) => e.preventDefault(), true);
      shownDoc().addEventListener('keydown', onKeydown, true);
      const win = shownDoc().defaultView;
      if (win) win.addEventListener('blur', () => { if (hooks.onBlur) hooks.onBlur(); });
      return { editable, readOnly };
    }
    function shownAs(para: EditableParagraph, p: HTMLParagraphElement, rest: HTMLParagraphElement | null, pages: HTMLElement[]) {
      if (!para.pageBreaks.length) return { chars: charsOf(p) };
      if (para.pageBreaks.length > 1) return null;
      const page = p.parentElement, k = page ? pages.indexOf(page) : -1;
      if (!page || k < 0 || page.lastElementChild !== p) return null;
      if (!rest) return { chars: [...charsOf(p), BREAK], mark: () => { page.dataset.notesEnd = ''; } };
      const next = pages[k + 1];
      if (!next || rest.parentElement !== next || next.firstElementChild !== rest || map.has(rest)) return null;
      return { chars: [...charsOf(p), BREAK, ...charsOf(rest)], mark: () => { next.dataset.notesJoin = ''; } };
    }
    function fix(container: Element, holders: Set<Element>) {
      for (const el of container.children) {
        if (map.has(el)) continue;
        if (holders.has(el)) fix(el, holders);
        else if (isHtmlElement(el)) el.contentEditable = 'false';
      }
    }

    function close() {
      seq++;
      reset();
    }
    function reset() {
      doc = null;
      saving = null;
      xml = '';
      scan = null;
      gen++;
      baselines = new Map();
      edits = 0;
      setDirty(false);
    }

    const paraOf = (node: Node | null) => {
      const el = node && (isElement(node) ? node : node.parentElement);
      const p = el && el.closest('p');
      return p && !p.closest('[contenteditable="false"]') && p.closest('article[contenteditable="true"]') ? p : null;
    };
    function rangeAllowed(range: AbstractRange) {
      const a = paraOf(range.startContainer), b = paraOf(range.endContainer);
      if (!a || !b) return false;
      if (a === b) return true;
      const list = shownParagraphs();
      const src = sources(list);
      const i = list.indexOf(a), j = list.indexOf(b);
      if (i < 0 || j < 0) return false;
      const scanned = shownScan();
      const paragraphOf = (p: HTMLElement) => { const index = src.get(p); return index === undefined ? undefined : scanned.paragraphs[index]; };
      const start = paragraphOf(a);
      if (!start) return false;
      for (let k = Math.min(i, j); k <= Math.max(i, j); k++) {
        const para = paragraphOf(list[k]);
        if (!para || para.chain !== start.chain) return false;
        if (k > Math.min(i, j)) {
          const between = shownDoc().createRange();
          between.setStartAfter(list[k - 1]);
          between.setEndBefore(list[k]);
          const frag = between.cloneContents();
          if (frag.querySelector && frag.querySelector('[contenteditable="false"]')) return false;
        }
      }
      return true;
    }
    function selectionAllowed() {
      const sel = doc && doc.getSelection();
      if (!sel || !sel.rangeCount) return false;
      for (let k = 0; k < sel.rangeCount; k++) if (!rangeAllowed(sel.getRangeAt(k))) return false;
      return true;
    }

    function onBeforeInput(e: InputEvent) {
      if (!scan) { e.preventDefault(); return; }
      const t = e.inputType;
      if (t === 'historyUndo' || t === 'historyRedo') return;
      if (!ALLOWED.has(t)) { e.preventDefault(); if (t !== 'insertFromPaste') hooks.say('That kind of change cannot be saved into a Word document here.'); return; }
      const ranges = e.getTargetRanges ? e.getTargetRanges() : [];
      const ok = ranges.length ? ranges.every((r) => rangeAllowed(r)) : selectionAllowed();
      if (!ok) { e.preventDefault(); hooks.say('That part of the document cannot be changed here (a table, picture, link or similar is in the way).'); }
    }
    function onInput(e: Event) {
      edits++;
      setDirty(true);
      if ('inputType' in e && e.inputType === 'insertLineBreak') {
        const sel = shownDoc().getSelection();
        const p = sel && sel.rangeCount ? paraOf(sel.anchorNode) : null;
        if (p && sel) {
          const caret = sel.getRangeAt(0);
          const typed = [...p.querySelectorAll('br')].filter((br) => caret.comparePoint(br, 0) <= 0).pop();
          if (typed) typed.setAttribute(REAL_BR, '');
        }
      }
    }
    function onPaste(e: ClipboardEvent) {
      e.preventDefault();
      if (!scan) return;
      const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
      if (!text) return;
      if (!selectionAllowed()) { hooks.say('That part of the document cannot be changed here.'); return; }
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      lines.forEach((line, k) => {
        if (k) shownDoc().execCommand('insertParagraph');
        if (line) shownDoc().execCommand('insertText', false, line.replace(/\t/g, TAB_SHOWN).replace(/[\f\uFFFC]/g, ''));
      });
    }
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        if (selectionAllowed()) shownDoc().execCommand('insertText', false, TAB_SHOWN);
        return;
      }
      if (hooks.onKey) hooks.onKey(e);
    }

    function exec(cmd: string) {
      if (!doc || !scan) return false;
      if (cmd === 'undo' || cmd === 'redo') return doc.execCommand(cmd);
      if (!selectionAllowed()) { hooks.say('Select text in a paragraph you can edit first.'); return false; }
      return doc.execCommand(cmd);
    }

    const sameChars = (chars: ShownChar[], base: ShownBaseline, text: string) => chars.length === base.chars.length && X.sameShownText(text, textOf(chars))
      && chars.every((c, k) => !c.fmt.b === !base.chars[k].b && !c.fmt.i === !base.chars[k].i && !c.fmt.u === !base.chars[k].u
        && (c.picture || null) === base.pictures[k]);

    function changes() {
      if (!scan || !dirty) return null;
      const list = shownParagraphs();
      const src = sources(list);
      for (const art of shownDoc().querySelectorAll('article[contenteditable="true"]')) {
        for (const n of art.childNodes) if (n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim()) throw new Error('some text is outside any paragraph');
      }
      const pieces: ShownPiece[] = [];
      const lost = () => new Error('a page break could not be placed');
      const endWithBreak = (last: ShownPiece) => {
        if (last.chars.includes(BREAK)) pieces.push({ els: [], source: last.source, chars: [BREAK] });
        else last.chars.push(BREAK);
      };
      for (const { art, list: here } of shownByPage()) {
        const join = 'notesJoin' in art.dataset, end = 'notesEnd' in art.dataset;
        if ((join || end) && !here.length) throw lost();
        here.forEach((p, k) => {
          const chars = charsOf(p);
          const prev = pieces[pieces.length - 1];
          if (k === 0 && join && !prev) throw lost();
          if (k === 0 && join && p.hasAttribute(REST) && !prev.chars.includes(BREAK)) { prev.chars.push(BREAK, ...chars); prev.els.push(p); return; }
          if (k === 0 && join) endWithBreak(prev);
          pieces.push({ els: [p], source: src.get(p), chars });
        });
        if (end) endWithBreak(pieces[pieces.length - 1]);
      }
      const placed = pieces.filter((pc): pc is PlacedPiece => pc.source !== undefined);
      if (placed.length !== pieces.length) throw new Error('a paragraph could not be matched to the file');
      const known = new Set([...baselines.values()].flatMap((b) => b.pictures).filter(Boolean));
      if (placed.some((pc) => pc.chars.some((c) => c.ch === X.PICTURE && !known.has(c.picture ?? null)))) {
        throw new Error('a picture deleted in an earlier save cannot be brought back with Undo');
      }
      const bySource = new Map<number, PlacedPiece[]>();
      for (const pc of placed) { const same = bySource.get(pc.source) || []; same.push(pc); bySource.set(pc.source, same); }
      const spans = new Map<number, { first: number, last: number }>();
      for (const para of scan.paragraphs) {
        const base = baselines.get(para.index);
        if (!base || !para.editable) continue;
        const pcs = bySource.get(para.index) || [];
        if (pcs.length === 1 && sameChars(pcs[0].chars, base, para.text)) continue;
        const sp = spans.get(para.chain);
        spans.set(para.chain, sp ? { first: sp.first, last: para.index } : { first: para.index, last: para.index });
      }
      if (!spans.size) return null;
      const patches: DocxPatch[] = [], plan: SaveInFlight['plan'] = [];
      for (const { first, last } of spans.values()) {
        const group = placed.filter((pc) => pc.source >= first && pc.source <= last);
        const start = scan.paragraphs[first].start, end = scan.paragraphs[last].end;
        const out = X.rewriteParagraphs(xml, scan, first, last, group.map((pc) => ({ source: pc.source, chars: pc.chars })), baselines);
        patches.push({ start, end, old: xml.slice(start, end), xml: out });
        plan.push({ first, last, pieces: group });
      }
      return { patches, plan };
    }

    function save() {
      const c = changes();
      if (!c) { if (dirty && !saving) setDirty(false); return null; }
      saving = { plan: c.plan, patches: c.patches, edits };
      return { patches: c.patches };
    }

    function markSaved() {
      const s = saving;
      saving = null;
      if (!s || !scan) return { ok: false, lost: false };
      try {
        if (rebase(s, scan)) return { ok: true, lost: false };
      } catch (_) {  }
      return { ok: false, lost: edits !== s.edits };
    }
    function rebase(s: SaveInFlight, current: Scan) {
      const nextXml = X.applyPatches(xml, s.patches);
      const next = X.scanDocument(nextXml);
      if (!next.prefix) return false;
      const nextMap = new Map<HTMLElement, number>(), nextBase = new Map<number, ShownBaseline>();
      const byFirst = new Map(s.plan.map((g) => [g.first, g]));
      let ni = 0;
      for (let i = 0; i < current.paragraphs.length;) {
        const g = byFirst.get(i);
        if (g) {
          for (const pc of g.pieces) {
            const para = next.paragraphs[ni];
            if (!para || !para.editable || !X.sameShownText(para.text, textOf(pc.chars))) return false;
            for (const el of pc.els) nextMap.set(el, ni);
            const before = baselines.get(pc.source);
            nextBase.set(ni, baselineOf(pc.chars, before ? before.empty : {}));
            ni++;
          }
          i = g.last + 1;
          continue;
        }
        const kept = baselines.get(i);
        if (kept) nextBase.set(ni, kept);
        i++;
        ni++;
      }
      if (ni !== next.paragraphs.length) return false;
      const shift = new Map<number, number>();
      let at = 0;
      for (let i = 0; i < current.paragraphs.length;) {
        const g = byFirst.get(i);
        if (g) { at += g.pieces.length; i = g.last + 1; continue; }
        shift.set(i, at);
        at++;
        i++;
      }
      for (const p of shownParagraphs()) {
        const was = map.get(p);
        const to = was === undefined ? undefined : shift.get(was);
        if (to !== undefined && !nextMap.has(p)) nextMap.set(p, to);
      }
      X.limitTo(next, (i) => nextBase.has(i));
      xml = nextXml;
      scan = next;
      gen++;
      for (const [p, index] of nextMap) map.set(p, index);
      baselines = nextBase;
      setDirty(edits !== s.edits);
      return true;
    }
    function saveFailed() { saving = null; }

    return {
      open,
      close,
      exec,
      save,
      markSaved,
      saveFailed,
      isOpen: () => !!doc,
      isEditable: () => !!scan,
      isDirty: () => dirty,
    };
  }

  return { create };
})();
