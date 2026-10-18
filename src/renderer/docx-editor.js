/* Editing an opened Word document in place, exposed as window.NotesDocxEditor. The document is shown by docx-preview
   inside the sandboxed frame (nothing in it runs); this page makes its paragraphs editable and listens from outside.

   Only paragraphs the Ooxml model can write back exactly are editable (see src/docx-edit/ooxml.js); the rest of the
   page cannot be changed. Each editable paragraph is found again on the page through a bookmark added to a display
   copy of the document, and checked to show exactly the text the file holds. Saving compares what is shown now with
   what was first shown, character by character, and sends main the span of paragraphs from the first to the last
   changed one in each chain (unchanged ones inside it are copied as they were).

   A page break is shown as the end of a page: docx-preview ends the page after the paragraph holding it, and shows
   the rest of that paragraph (if any) as the first paragraph of the next page. The break itself is not on the page,
   so it cannot be deleted or moved off its page boundary: the page body (article) before it is marked "ends with a
   page break", or the one after it "continues the paragraph before". */
(function () {
  'use strict';
  const DV = window.DocxView;
  if (!DV || !DV.Ooxml || !DV.JSZip) return;
  const X = DV.Ooxml;
  const TAB_SHOWN = ' '; // docx-preview shows a tab as an em space
  const BREAK = { ch: X.PAGE_BREAK, fmt: {}, br: false }; // a page break, as a character of a paragraph's text
  // What the person may do in the text, by input type. Anything else (pasting with formatting, dragging text, lists,
  // links...) is refused or, for pasting, done as plain text.
  const ALLOWED = new Set(['insertText', 'insertReplacementText', 'insertCompositionText', 'insertParagraph', 'insertLineBreak',
    'deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteWordForward', 'deleteSoftLineBackward',
    'deleteSoftLineForward', 'deleteHardLineBackward', 'deleteHardLineForward', 'deleteByCut', 'deleteContent',
    'formatBold', 'formatItalic', 'formatUnderline']);

  // hooks: onDirty(bool), say(text), onKey(KeyboardEvent) for keys the app handles (Ctrl+S, Escape), onBlur() when
  // the document loses focus (the app's own window blur does not fire while focus is inside the frame).
  function create(hooks) {
    // xml/scan: document.xml as last saved, and its paragraphs. map: which paragraph a shown element stands for.
    // baselines: paragraph index -> { chars: [fmt], empty: fmt } as shown after the last save. edits: input events
    // since the last save started.
    let doc = null, xml = '', scan = null, baselines = new Map(), dirty = false, edits = 0, seq = 0;
    // Which paragraph of the file a shown <p> stands for is written on the element itself (data-notes-src="gen:index"):
    // the browser copies it to both halves when Enter splits a paragraph, whichever half it puts first. gen changes on
    // every save and every opening, so an element an Undo brings back from before is not taken at its old word.
    let gen = 0;
    const SRC = 'data-notes-src';
    // On the element showing the rest of a paragraph after its page break (the browser copies it when Enter splits it).
    const REST = 'data-notes-rest';
    const map = {
      get(p) {
        const v = p.getAttribute(SRC);
        const m = v && /^(\d+):(\d+)$/.exec(v);
        return m && Number(m[1]) === gen ? Number(m[2]) : undefined;
      },
      has(p) { return map.get(p) !== undefined; },
      set(p, index) { p.setAttribute(SRC, gen + ':' + index); },
    };
    // saving: what save() handed out and markSaved() takes in: { plan, patches, edits (the count when it started) }.
    let saving = null;
    // Computed formatting per element, for one reading of the page only: editing can restyle an element in place.
    let styleCache = new WeakMap();

    function setDirty(v) {
      if (dirty === v) return;
      dirty = v;
      if (hooks.onDirty) hooks.onDirty(v);
    }

    // ---- What is shown -------------------------------------------------------------------------------------

    function fmtOf(el) {
      if (styleCache.has(el)) return styleCache.get(el);
      const win = el.ownerDocument.defaultView;
      const cs = win.getComputedStyle(el);
      let u = false;
      for (let e = el; e && !u; e = e.parentElement) {
        u = /underline/.test(win.getComputedStyle(e).textDecorationLine);
        if (e.tagName === 'P') break;
      }
      const f = { b: parseInt(cs.fontWeight, 10) >= 600, i: /italic|oblique/.test(cs.fontStyle), u };
      styleCache.set(el, f);
      return f;
    }

    // The characters of a shown paragraph, with bold/italic/underline: [{ ch, fmt }]. A line break the browser keeps
    // only to give an empty line its height (the last thing in the paragraph) does not count.
    function charsOf(p) {
      const out = [];
      styleCache = new WeakMap();
      const walk = (node) => {
        for (let n = node.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 3) {
            const fmt = fmtOf(n.parentElement);
            // By UTF-16 code unit, as the file's text is read (an emoji counts as two, on both sides).
            // A form feed in the text is not a page break (those are not shown as text): it is not counted.
            for (let k = 0; k < n.data.length; k++) if (n.data[k] !== X.PAGE_BREAK) out.push({ ch: n.data[k] === TAB_SHOWN ? '\t' : n.data[k], fmt, br: false });
          } else if (n.nodeType === 1) {
            if (n.tagName === 'BR') out.push({ ch: '\n', fmt: fmtOf(n.parentElement), br: true });
            else walk(n);
          }
        }
      };
      walk(p);
      if (out.length && out[out.length - 1].br) out.pop();
      return out;
    }
    const textOf = (chars) => chars.map((c) => c.ch).join('');

    // The editable paragraphs shown, in order: mapped ones, and ones the browser made by splitting (Enter); by page
    // body ([{ art, list }]) or all together.
    function shownByPage() {
      return [...doc.querySelectorAll('article[contenteditable="true"]')].map((art) => ({
        art, list: [...art.querySelectorAll('p')].filter((p) => !p.closest('[contenteditable="false"]')),
      }));
    }
    const shownParagraphs = () => shownByPage().flatMap((pg) => pg.list);
    // Which paragraph of the file each shown one belongs to: its own, or (made by Enter) the one before it.
    function sources(list) {
      const out = new Map();
      let last = null;
      for (const p of list) {
        if (map.has(p)) last = map.get(p);
        if (last !== null) out.set(p, last);
      }
      // Any before the first known one belong to the first known one.
      const firstKnown = list.find((p) => map.has(p));
      for (const p of list) if (!out.has(p) && firstKnown) out.set(p, map.get(firstKnown));
      return out;
    }

    // ---- Opening --------------------------------------------------------------------------------------------

    // Shows bytes (a .docx) in frameDoc, the frame's fresh document, editable where it can be.
    // Resolves { editable, readOnly, block }: counts of paragraphs, and why nothing is editable (or null).
    async function open(frameDoc, bytes) {
      const my = ++seq;
      reset();
      const zip = await DV.JSZip.loadAsync(bytes);
      const part = zip.file('word/document.xml');
      let block = null, display = bytes, nextScan = null, nextXml = '';
      if (!part) block = 'it has no main document part';
      else {
        nextXml = await part.async('string');
        const settings = zip.file('word/settings.xml');
        block = X.settingsBlock(settings ? await settings.async('string') : '');
        if (!block) {
          try { nextScan = X.scanDocument(nextXml); } catch (err) { block = err.message; }
          if (nextScan && !nextScan.prefix) block = 'it is not a standard Word document';
        }
        if (!block && nextScan.paragraphs.some((p) => p.editable)) {
          zip.file('word/document.xml', X.markForDisplay(nextXml, nextScan));
          display = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
        }
      }
      if (my !== seq) return null;
      // altChunks are raw HTML inside the file: never show them. Images become data: URLs, which the frame allows.
      await DV.renderAsync(display, frameDoc.body, frameDoc.body, { useBase64URL: true, renderAltChunks: false });
      if (my !== seq) return null;
      doc = frameDoc;
      xml = nextXml;
      scan = block ? null : nextScan;
      const counts = scan ? attach() : { editable: 0, readOnly: 0 };
      if (scan && !counts.editable) scan = null;
      return Object.assign(counts, { block });
    }

    // Finds the editable paragraphs on the page, makes them (and only them) editable, and listens.
    function attach() {
      let editable = 0;
      const pages = [...doc.querySelectorAll('section.docx > article')];
      const take = (id) => {
        const mark = doc.getElementById(id);
        const p = mark && mark.closest('p');
        if (mark) mark.remove();
        return p;
      };
      for (const para of scan.paragraphs) {
        if (!para.editable) continue;
        const p = take(X.MARK + para.index);
        const rest = para.pageBreaks.length ? take(X.BREAK_MARK + para.index) : null;
        // A paragraph not shown as the file has it stays as it is.
        const shown = p && !map.has(p) && shownAs(para, p, rest, pages);
        if (!shown || textOf(shown.chars) !== para.text) continue;
        map.set(p, para.index);
        if (rest) { map.set(rest, para.index); rest.setAttribute(REST, ''); }
        if (shown.mark) shown.mark();
        baselines.set(para.index, { chars: shown.chars.map((c) => c.fmt), empty: fmtOf(p) });
        editable++;
      }
      // Paragraphs the page does not show as the file holds them are not edited, nor any change spanning them.
      X.limitTo(scan, (i) => baselines.has(i));
      const readOnly = scan.paragraphs.length - editable;
      if (!editable) return { editable, readOnly };
      // Everything in the body that is not, and does not hold, an editable paragraph is fixed.
      const holders = new Set();
      for (const art of doc.querySelectorAll('section.docx > article')) {
        for (const p of art.querySelectorAll('p')) if (map.has(p)) for (let e = p.parentElement; e && e !== art; e = e.parentElement) holders.add(e);
        fix(art, holders);
        art.contentEditable = 'true';
        art.spellcheck = true;
      }
      doc.addEventListener('beforeinput', onBeforeInput, true);
      doc.addEventListener('input', onInput, true);
      doc.addEventListener('paste', onPaste, true);
      doc.addEventListener('drop', (e) => e.preventDefault(), true);
      doc.addEventListener('keydown', onKeydown, true);
      doc.defaultView.addEventListener('blur', () => { if (hooks.onBlur) hooks.onBlur(); });
      return { editable, readOnly };
    }
    // A paragraph as shown: { chars, mark } (mark records its page break on the page), or null when it is not shown
    // whole. p: the element it starts in; rest: the one its text after a page break is in, if any.
    function shownAs(para, p, rest, pages) {
      if (!para.pageBreaks.length) return { chars: charsOf(p) };
      if (para.pageBreaks.length > 1) return null; // docx-preview starts a new page at the first one only
      const page = p.parentElement, k = pages.indexOf(page);
      if (k < 0 || page.lastElementChild !== p) return null;
      if (!rest) return { chars: [...charsOf(p), BREAK], mark: () => { page.dataset.notesEnd = ''; } };
      const next = pages[k + 1];
      if (!next || rest.parentElement !== next || next.firstElementChild !== rest || map.has(rest)) return null;
      return { chars: [...charsOf(p), BREAK, ...charsOf(rest)], mark: () => { next.dataset.notesJoin = ''; } };
    }
    function fix(container, holders) {
      for (const el of container.children) {
        if (map.has(el)) continue;
        if (holders.has(el)) fix(el, holders);
        else el.contentEditable = 'false';
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

    // ---- Guarding what the person does ----------------------------------------------------------------------

    const paraOf = (node) => {
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      const p = el && el.closest('p');
      return p && !p.closest('[contenteditable="false"]') && p.closest('article[contenteditable="true"]') ? p : null;
    };
    // A range may change text only inside one chain of paragraphs (see ooxml.js): never across a table, a picture,
    // a read-only paragraph or a section break.
    function rangeAllowed(range) {
      const a = paraOf(range.startContainer), b = paraOf(range.endContainer);
      if (!a || !b) return false;
      if (a === b) return true;
      const list = shownParagraphs();
      const src = sources(list);
      const i = list.indexOf(a), j = list.indexOf(b);
      if (i < 0 || j < 0) return false;
      const chain = scan.paragraphs[src.get(a)].chain;
      for (let k = Math.min(i, j); k <= Math.max(i, j); k++) {
        if (scan.paragraphs[src.get(list[k])].chain !== chain) return false;
        // Nothing fixed may sit between two of them on the page.
        if (k > Math.min(i, j)) {
          const between = doc.createRange();
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

    function onBeforeInput(e) {
      if (!scan) { e.preventDefault(); return; }
      const t = e.inputType;
      if (t === 'historyUndo' || t === 'historyRedo') return;
      if (!ALLOWED.has(t)) { e.preventDefault(); if (t !== 'insertFromPaste') hooks.say('That kind of change cannot be saved into a Word document here.'); return; }
      const ranges = e.getTargetRanges ? e.getTargetRanges() : [];
      const ok = ranges.length ? ranges.every((r) => rangeAllowed(r)) : selectionAllowed();
      if (!ok) { e.preventDefault(); hooks.say('That part of the document cannot be changed here (a table, picture, link or similar is in the way).'); }
    }
    function onInput() {
      edits++;
      setDirty(true);
    }
    // Pasted text arrives as plain text: line breaks start new paragraphs, tabs stay tabs.
    function onPaste(e) {
      e.preventDefault();
      if (!scan) return;
      const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
      if (!text) return;
      if (!selectionAllowed()) { hooks.say('That part of the document cannot be changed here.'); return; }
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      lines.forEach((line, k) => {
        if (k) doc.execCommand('insertParagraph');
        if (line) doc.execCommand('insertText', false, line.replace(/\t/g, TAB_SHOWN).replace(/\f/g, ''));
      });
    }
    function onKeydown(e) {
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        if (selectionAllowed()) doc.execCommand('insertText', false, TAB_SHOWN);
        return;
      }
      if (hooks.onKey) hooks.onKey(e);
    }

    // Bold, italic, underline, undo, redo from the toolbar.
    function exec(cmd) {
      if (!doc || !scan) return false;
      if (cmd === 'undo' || cmd === 'redo') return doc.execCommand(cmd);
      if (!selectionAllowed()) { hooks.say('Select text in a paragraph you can edit first.'); return false; }
      return doc.execCommand(cmd);
    }

    // ---- Saving -------------------------------------------------------------------------------------------

    const sameChars = (chars, base, text) => chars.length === base.chars.length && textOf(chars) === text
      && chars.every((c, k) => !c.fmt.b === !base.chars[k].b && !c.fmt.i === !base.chars[k].i && !c.fmt.u === !base.chars[k].u);

    // The changes to save: { patches, plan } (plan is for markSaved), or null when nothing changed. Throws when the
    // page holds something that cannot be saved.
    function changes() {
      if (!scan || !dirty) return null;
      const list = shownParagraphs();
      const src = sources(list);
      for (const art of doc.querySelectorAll('article[contenteditable="true"]')) {
        for (const n of art.childNodes) if (n.nodeType === 3 && n.data.trim()) throw new Error('some text is outside any paragraph');
      }
      // One piece per paragraph to write, with the page breaks put back where the page shows them.
      const pieces = [];
      const lost = () => new Error('a page break could not be placed');
      // A paragraph already holding a break gets no second one (the page shows only one per paragraph): the break
      // becomes a paragraph of its own, as Ctrl+Enter makes in Word.
      const endWithBreak = (last) => {
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
          // The rest of the paragraph continues it. If another paragraph took its place (its rest deleted, then
          // joined up), or the paragraph before already holds a break, the break ends the previous page's paragraph and
          // this one stays a paragraph of its own.
          if (k === 0 && join && p.hasAttribute(REST) && !prev.chars.includes(BREAK)) { prev.chars.push(BREAK, ...chars); prev.els.push(p); return; }
          if (k === 0 && join) endWithBreak(prev);
          pieces.push({ els: [p], source: src.get(p), chars });
        });
        if (end) endWithBreak(pieces[pieces.length - 1]);
      }
      if (pieces.some((pc) => pc.source === undefined)) throw new Error('a paragraph could not be matched to the file');
      const bySource = new Map();
      for (const pc of pieces) { if (!bySource.has(pc.source)) bySource.set(pc.source, []); bySource.get(pc.source).push(pc); }
      // Changed paragraphs, then per chain the span from the first to the last of them.
      const spans = new Map();
      for (const para of scan.paragraphs) {
        if (!baselines.has(para.index)) continue;
        const pcs = bySource.get(para.index) || [];
        if (pcs.length === 1 && sameChars(pcs[0].chars, baselines.get(para.index), para.text)) continue;
        const sp = spans.get(para.chain);
        spans.set(para.chain, sp ? { first: sp.first, last: para.index } : { first: para.index, last: para.index });
      }
      if (!spans.size) return null;
      const patches = [], plan = [];
      for (const { first, last } of spans.values()) {
        const group = pieces.filter((pc) => pc.source >= first && pc.source <= last);
        const start = scan.paragraphs[first].start, end = scan.paragraphs[last].end;
        const out = X.rewriteParagraphs(xml, scan, first, last, group.map((pc) => ({ source: pc.source, chars: pc.chars })), baselines);
        patches.push({ start, end, old: xml.slice(start, end), xml: out });
        plan.push({ first, last, pieces: group });
      }
      return { patches, plan };
    }

    // The changes as patches for main ({ patches }), or null when there is nothing to save.
    function save() {
      const c = changes();
      if (!c) { if (dirty && !saving) setDirty(false); return null; }
      saving = { plan: c.plan, patches: c.patches, edits };
      return { patches: c.patches };
    }

    // The save that save() returned is on disk: what it wrote becomes what edits are compared with. Returns false when
    // the page could not be matched to the new file (the caller then shows the document again).
    // Returns { ok, lost }: lost when the page must be shown again and text typed during the save would go with it.
    function markSaved() {
      const s = saving;
      saving = null;
      if (!s || !scan) return { ok: false, lost: false };
      try {
        if (rebase(s)) return { ok: true, lost: false };
      } catch (_) { /* the page could not be matched to the file as written */ }
      return { ok: false, lost: edits !== s.edits };
    }
    function rebase(s) {
      const nextXml = X.applyPatches(xml, s.patches);
      const next = X.scanDocument(nextXml);
      const nextMap = new Map(), nextBase = new Map();
      const byFirst = new Map(s.plan.map((g) => [g.first, g]));
      let ni = 0; // index in the new document
      for (let i = 0; i < scan.paragraphs.length;) {
        const g = byFirst.get(i);
        if (g) {
          for (const pc of g.pieces) {
            const para = next.paragraphs[ni];
            if (!para || !para.editable || para.text !== textOf(pc.chars)) return false;
            for (const el of pc.els) nextMap.set(el, ni);
            nextBase.set(ni, { chars: pc.chars.map((c) => c.fmt), empty: (baselines.get(pc.source) || {}).empty || {} });
            ni++;
          }
          i = g.last + 1;
          continue;
        }
        if (baselines.has(i)) nextBase.set(ni, baselines.get(i));
        i++;
        ni++;
      }
      if (ni !== next.paragraphs.length) return false;
      // Paragraphs outside the changes keep their elements, at their new index.
      const shift = new Map();
      let at = 0;
      for (let i = 0; i < scan.paragraphs.length;) {
        const g = byFirst.get(i);
        if (g) { at += g.pieces.length; i = g.last + 1; continue; }
        shift.set(i, at);
        at++;
        i++;
      }
      for (const p of shownParagraphs()) if (map.has(p) && shift.has(map.get(p)) && !nextMap.has(p)) nextMap.set(p, shift.get(map.get(p)));
      X.limitTo(next, (i) => nextBase.has(i));
      xml = nextXml;
      scan = next;
      gen++;
      for (const [p, index] of nextMap) map.set(p, index);
      baselines = nextBase;
      // Typing during the save is still unsaved.
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

  window.NotesDocxEditor = { create };
})();
