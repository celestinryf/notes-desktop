/* The PDF viewer and editor for opened PDFs, exposed as window.NotesPdfEditor. It drives pdf.js's own viewer and
   Firefox's annotation editors (highlight, text box, drawing, picture); the PDF is parsed in pdf.js's worker, never
   on this page. Edits stay in pdf.js's annotation storage until save() turns them into the PDF's own bytes. */
(function () {
  'use strict';
  const PV = window.PdfView;
  if (!PV) return;
  const lib = PV.pdfjsLib;
  // pdf.js's worker, fonts and character maps load from its package, next to the app.
  const PKG = new URL('../../node_modules/pdfjs-dist/', document.baseURI).href;
  lib.GlobalWorkerOptions.workerSrc = PKG + 'build/pdf.worker.min.mjs';

  const T = lib.AnnotationEditorType;
  const LOAD_OPTIONS = {
    isEvalSupported: false,
    enableXfa: false,
    cMapUrl: PKG + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: PKG + 'standard_fonts/',
    wasmUrl: PKG + 'wasm/',
    iccUrl: PKG + 'iccs/',
  };

  // Draws page index (0-based) of document d into canvas, `width` CSS pixels wide, with any unsaved marks.
  async function drawPage(d, index, canvas, width) {
    const page = await d.getPage(index + 1);
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = Math.floor(viewport.width / ratio) + 'px';
    await page.render({ canvas, viewport, annotationMode: lib.AnnotationMode.ENABLE_STORAGE }).promise;
  }
  const MODES = { select: T.NONE, highlight: T.HIGHLIGHT, text: T.FREETEXT, draw: T.INK, picture: T.STAMP };

  // root holds a .pdf-viewport whose first child is the .pdfViewer element. hooks:
  //   onDirty(bool)  the edits now differ (or no longer differ) from what was last written to the file
  //   onState(state) { mode, canUndo, canRedo, scale } for the toolbar
  //   onLink(event, href) a link in the PDF was clicked (the caller decides whether to open it)
  function create(root, hooks) {
    const container = root.querySelector('.pdf-viewport');
    const eventBus = new PV.EventBus();
    const linkService = new PV.PDFLinkService({ eventBus });
    const viewer = new PV.PDFViewer({
      container,
      eventBus,
      linkService,
      annotationMode: lib.AnnotationMode.ENABLE_FORMS,
      annotationEditorMode: T.NONE,
      imageResourcesPath: PKG + 'web/images/',
      // pdf.js's default palette (its viewer's highlightEditorColors). Without it the highlight tool throws.
      annotationEditorHighlightColors: 'yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F,'
        + 'yellow_HCM=#FFFFCC,green_HCM=#53FFBC,blue_HCM=#80EBFF,pink_HCM=#F6B8FF,red_HCM=#C50043',
    });
    linkService.setViewer(viewer);

    // savedHash: pdf.js's hash of the edits last written to disk ('' = none). Unsaved means the current hash differs.
    // pdf.js's own "modified" flag cannot be used for this: saveDocument() clears it whether or not the write that
    // follows succeeds, and edits made while a save runs never set it again.
    let task = null, doc = null, seq = 0, dirty = false, mode = 'select', savedHash = '', modeEpoch = 0;
    // touched: the person has used an editing tool or a form field since the PDF was opened. Until then, what pdf.js
    // itself writes into the storage while drawing pages (form fields' default values) is not an edit.
    let touched = false;
    const undo = { canUndo: false, canRedo: false };
    const report = () => hooks.onState && hooks.onState({ mode, canUndo: undo.canUndo, canRedo: undo.canRedo, scale: viewer.currentScale || 1 });

    eventBus.on('pagesinit', () => { viewer.currentScaleValue = 'page-width'; });
    eventBus.on('scalechanging', report);
    eventBus.on('annotationlayerrendered', () => { if (!touched && doc) { savedHash = currentHash(); refreshDirty(); } });
    eventBus.on('editingstateschanged', ({ details }) => {
      if ('hasSomethingToUndo' in details) undo.canUndo = details.hasSomethingToUndo;
      if ('hasSomethingToRedo' in details) undo.canRedo = details.hasSomethingToRedo;
      refreshDirty();
      report();
    });
    // pdf.js reports some edits (moving, resizing, retyping a box) through no event at all, so the Save label is
    // checked again after anything the person does in the PDF.
    const EDIT_LAYERS = '.annotationLayer, .annotationEditorLayer';
    for (const type of ['pointerdown', 'keydown']) {
      container.addEventListener(type, (e) => { if (e.target && e.target.closest && e.target.closest(EDIT_LAYERS)) touched = true; }, true);
    }
    for (const type of ['pointerup', 'keyup', 'input', 'change', 'focusout']) container.addEventListener(type, () => setTimeout(refreshDirty, 0));

    // A link in the PDF never navigates the app page; the caller handles it (internal "#page" links are pdf.js's).
    container.addEventListener('click', (e) => {
      const a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) return;
      e.preventDefault();
      e.stopPropagation();
      if (hooks.onLink) hooks.onLink(e, a.href);
    }, true);

    const currentHash = () => (doc ? doc.annotationStorage.serializable.hash : '');
    function refreshDirty() {
      const v = !!doc && currentHash() !== savedHash;
      if (dirty === v) return;
      dirty = v;
      if (hooks.onDirty) hooks.onDirty(v);
    }

    // Other PDFs opened for their pages (adding pages from another PDF); closed with this one.
    const others = new Set();
    // bytes may be a view into a larger buffer (as IPC delivers it), which pdf.js's page extraction would read past,
    // so a tight copy of its own is kept; another copy goes to getDocument, which takes over what it is given.
    async function openOther(bytes) {
      const own = new Uint8Array(bytes);
      const t = lib.getDocument(Object.assign({ data: own.slice() }, LOAD_OPTIONS));
      others.add(t);
      const d = await t.promise;
      return { pages: d.numPages, draw: (i, canvas, width) => drawPage(d, i, canvas, width), bytes: own };
    }

    function closeOthers() {
      for (const t of others) t.destroy().catch(() => {});
      others.clear();
    }

    async function unload() {
      closeOthers();
      viewer.setDocument(null);
      linkService.setDocument(null);
      const t = task;
      task = null;
      doc = null;
      savedHash = '';
      refreshDirty();
      undo.canUndo = undo.canRedo = false;
      if (t) await t.destroy().catch(() => {});
    }

    // Shows the PDF in bytes (a Uint8Array). Resolves false if another open() or close() came first.
    async function open(bytes) {
      const my = ++seq;
      await unload();
      if (my !== seq) return false;
      const t = lib.getDocument(Object.assign({ data: bytes }, LOAD_OPTIONS));
      task = t;
      const d = await t.promise;
      if (my !== seq) return false;
      // pdf.js would only log this (and show nothing): a PDF without pages is refused here, so the caller can say so.
      if (d.numPages < 1) { task = null; await t.destroy().catch(() => {}); throw new Error('this PDF has no pages.'); }
      doc = d;
      touched = false;
      savedHash = currentHash();
      doc.annotationStorage.onSetModified = refreshDirty;
      doc.annotationStorage.onResetModified = refreshDirty;
      viewer.setDocument(doc);
      linkService.setDocument(doc, null);
      mode = 'select';
      report();
      return true;
    }

    async function close() {
      seq++;
      await unload();
    }

    // internal: a switch made by commit(), not by the person (who may pick another tool meanwhile).
    function setMode(name, internal) {
      if (!doc || !(name in MODES)) return false;
      try { viewer.annotationEditorMode = { mode: MODES[name] }; } catch (_) { return false; }
      if (!internal) { modeEpoch++; if (name !== 'select') touched = true; }
      mode = name;
      report();
      return true;
    }

    // Resolves once pdf.js has finished switching to editor type t (switches are asynchronous), or after a second.
    function modeSwitched(t) {
      return new Promise((resolve) => {
        const done = () => { clearTimeout(timer); eventBus.off('annotationeditormodechanged', onChanged); resolve(); };
        const onChanged = (e) => { if (e.mode === t) done(); };
        const timer = setTimeout(done, 1000);
        eventBus.on('annotationeditormodechanged', onChanged);
      });
    }

    // Finishes the drawing or typing in progress, so it counts as an edit: pdf.js commits it when the tool changes,
    // so the tool is left and, once that switch is done, taken up again.
    // If the person picks a tool while this waits, theirs stands.
    async function commit() {
      if (!doc || mode === 'select') return;
      const m = mode, epoch = modeEpoch;
      const left = modeSwitched(T.NONE);
      if (!setMode('select', true)) return;
      await left;
      if (modeEpoch !== epoch || !doc) return;
      const back = modeSwitched(MODES[m]);
      if (setMode(m, true)) await back;
    }

    // The PDF with its edits: { bytes, hash }, hash identifying exactly the edits in those bytes (pass it to
    // markSaved once they are on disk). null when nothing is open.
    async function save() {
      if (!doc) return null;
      const hash = currentHash(); // saveDocument() serializes the same storage, synchronously, in this same turn
      const bytes = await doc.saveDocument();
      return { bytes, hash };
    }

    return {
      open,
      close,
      setMode,
      commit,
      save,
      pageCount: () => (doc ? doc.numPages : 0),
      drawPage: (i, canvas, width) => (doc ? drawPage(doc, i, canvas, width) : Promise.resolve()),
      openOther,
      closeOthers,
      // A new PDF from pdf.js: pageInfos as for PDFDocumentProxy.extractPages (document null = this PDF). Only what
      // the kept pages use is written, so a removed page leaves nothing behind in the file.
      extractPages: (pageInfos) => doc.extractPages(pageInfos),
      markSaved(hash) { if (doc) { savedHash = hash; refreshDirty(); } },
      isOpen: () => !!doc,
      isDirty: () => !!doc && currentHash() !== savedHash,
      // Unsaved edits, or a tool in use whose stroke or text is not committed yet.
      hasPendingWork: () => !!doc && (currentHash() !== savedHash || mode !== 'select'),
      undo: () => eventBus.dispatch('editingaction', { source: null, name: 'undo' }),
      redo: () => eventBus.dispatch('editingaction', { source: null, name: 'redo' }),
      zoomIn: () => viewer.increaseScale(),
      zoomOut: () => viewer.decreaseScale(),
      fitWidth: () => { viewer.currentScaleValue = 'page-width'; },
    };
  }

  window.NotesPdfEditor = { create, modes: Object.keys(MODES) };
})();
