export type PdfComment = { id: string, page: number, ref: number[] | null, kind: string, text: string, author: string, date: Date | null, rect: number[], replyTo: string | null };
export type PdfPoint = { page: number, x: number, y: number };
export function requireChild<T extends Element>(root: ParentNode, selector: string, type: new () => T): T {
  const node = root.querySelector(selector);
  if (!(node instanceof type)) throw new Error('The PDF panel is missing ' + selector + '.');
  return node;
}
export type PdfToolState = { mode: string, canUndo: boolean, canRedo: boolean, scale: number };
export type PdfEditorHooks = {
  onDirty?: (dirty: boolean) => void,
  onState?: (state: PdfToolState) => void,
  onLink?: (event: MouseEvent, href: string) => void,
};

export const NotesPdfEditor = (function () {
  'use strict';
  const PV = window.PdfView;
  if (!PV) return;
  const lib = PV.pdfjsLib;
  type LoadingTask = ReturnType<typeof lib.getDocument>;
  type PdfDocument = Awaited<LoadingTask['promise']>;
  type ViewLocation = { pageNumber: number, scale: number | string, top: number, left: number };
  const PKG = new URL('../../node_modules/pdfjs-dist/', document.baseURI).href;
  lib.GlobalWorkerOptions.workerSrc = PKG + 'build/pdf.worker.min.mjs';

  const T = lib.AnnotationEditorType;

  const plainFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (options) {
    return plainFocus.call(this, options === undefined && this.closest && this.closest('.pdf-viewport') ? { preventScroll: true } : options);
  };
  const LOAD_OPTIONS = {
    isEvalSupported: false,
    enableXfa: false,
    cMapUrl: PKG + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: PKG + 'standard_fonts/',
    wasmUrl: PKG + 'wasm/',
    iccUrl: PKG + 'iccs/',
  };

  async function drawPage(d: PdfDocument, index: number, canvas: HTMLCanvasElement, width: number) {
    const page = await d.getPage(index + 1);
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = Math.floor(viewport.width / ratio) + 'px';
    await page.render({ canvas, viewport, annotationMode: lib.AnnotationMode.ENABLE_STORAGE }).promise;
  }
  const MODES = { select: T.NONE, highlight: T.HIGHLIGHT, text: T.FREETEXT, draw: T.INK, picture: T.STAMP };
  type ModeName = keyof typeof MODES;
  const isModeName = (name: string): name is ModeName => name in MODES;
  const MARKUP = new Set(['Text', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly',
    'StrikeOut', 'Stamp', 'Caret', 'Ink', 'FileAttachment', 'Sound']);
  function refOf(id: string) {
    const m = /^(\d+)R(\d*)$/.exec(String(id || ''));
    return m ? [Number(m[1]), Number(m[2] || 0)] : null;
  }

  function create(root: HTMLElement, hooks: PdfEditorHooks) {
    const container = requireChild(root, '.pdf-viewport', HTMLDivElement);
    const eventBus = new PV.EventBus();
    const linkService = new PV.PDFLinkService({ eventBus });
    const viewer = new PV.PDFViewer({
      container,
      eventBus,
      linkService,
      annotationMode: lib.AnnotationMode.ENABLE_FORMS,
      annotationEditorMode: T.NONE,
      imageResourcesPath: PKG + 'web/images/',
      annotationEditorHighlightColors: 'yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F,'
        + 'yellow_HCM=#FFFFCC,green_HCM=#53FFBC,blue_HCM=#80EBFF,pink_HCM=#F6B8FF,red_HCM=#C50043',
    });
    linkService.setViewer(viewer);

    let task: LoadingTask | null = null, doc: PdfDocument | null = null, seq = 0, dirty = false, mode: ModeName = 'select', savedHash = '', modeEpoch = 0;
    let touched = false;
    const undo = { canUndo: false, canRedo: false };
    const report = () => hooks.onState && hooks.onState({ mode, canUndo: undo.canUndo, canRedo: undo.canRedo, scale: viewer.currentScale || 1 });

    let location: ViewLocation | null = null, restore: ViewLocation | null = null;
    eventBus.on('updateviewarea', (e: { location: ViewLocation }) => { location = e.location; });
    eventBus.on('pagesinit', () => {
      const at = restore;
      restore = null;
      if (!at || !doc) { viewer.currentScaleValue = 'page-width'; return; }
      viewer.currentScaleValue = typeof at.scale === 'number' ? String(at.scale / 100) : at.scale;
      viewer.scrollPageIntoView({ pageNumber: Math.min(at.pageNumber, doc.numPages), destArray: [null, { name: 'XYZ' }, at.left, at.top, null], allowNegativeOffset: true });
    });
    eventBus.on('scalechanging', report);
    let fittedWidth = 0;
    new ResizeObserver(() => {
      const w = container.clientWidth;
      if (!w || w === fittedWidth) return;
      fittedWidth = w;
      requestAnimationFrame(() => {
        const v = viewer.currentScaleValue;
        if (doc && (v === 'page-width' || v === 'page-fit' || v === 'auto')) viewer.currentScaleValue = v;
      });
    }).observe(container);
    eventBus.on('annotationlayerrendered', () => { if (!touched && doc) { savedHash = currentHash(); refreshDirty(); } });
    eventBus.on('editingstateschanged', ({ details }: { details: { hasSomethingToUndo: boolean } | { hasSomethingToRedo: boolean } }) => {
      if ('hasSomethingToUndo' in details) undo.canUndo = details.hasSomethingToUndo;
      if ('hasSomethingToRedo' in details) undo.canRedo = details.hasSomethingToRedo;
      refreshDirty();
      report();
    });
    const EDIT_LAYERS = '.annotationLayer, .annotationEditorLayer';
    for (const type of ['pointerdown', 'keydown']) {
      container.addEventListener(type, (e) => { if (e.target instanceof Element && e.target.closest(EDIT_LAYERS)) touched = true; }, true);
    }
    for (const type of ['pointerup', 'keyup', 'input', 'change', 'focusout']) container.addEventListener(type, () => setTimeout(refreshDirty, 0));

    container.addEventListener('click', (e) => {
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
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

    const others = new Set<LoadingTask>();
    async function openOther(bytes: Uint8Array) {
      const own = new Uint8Array(bytes);
      const t = lib.getDocument(Object.assign({ data: own.slice() }, LOAD_OPTIONS));
      others.add(t);
      const d = await t.promise;
      return { pages: d.numPages, draw: (i: number, canvas: HTMLCanvasElement, width: number) => drawPage(d, i, canvas, width), bytes: own };
    }

    function closeOthers() {
      for (const t of others) t.destroy().catch(() => {});
      others.clear();
    }

    async function unload() {
      cancelPick();
      closeOthers();
      // @ts-expect-error
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

    async function open(bytes: Uint8Array, opts?: { keepView?: boolean }) {
      const my = ++seq;
      const at = opts && opts.keepView ? location : null;
      await unload();
      if (my !== seq) return false;
      const t = lib.getDocument(Object.assign({ data: bytes }, LOAD_OPTIONS));
      task = t;
      const d = await t.promise;
      if (my !== seq) return false;
      if (d.numPages < 1) { task = null; await t.destroy().catch(() => {}); throw new Error('this PDF has no pages.'); }
      doc = d;
      restore = at;
      location = null;
      touched = false;
      savedHash = currentHash();
      const storage: { onSetModified: (() => void) | null, onResetModified: (() => void) | null } = doc.annotationStorage;
      storage.onSetModified = refreshDirty;
      storage.onResetModified = refreshDirty;
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

    function setMode(name: string, internal?: boolean) {
      if (!doc || !isModeName(name)) return false;
      try { viewer.annotationEditorMode = { mode: MODES[name] }; } catch (_) { return false; }
      if (!internal) { modeEpoch++; if (name !== 'select') touched = true; }
      mode = name;
      report();
      return true;
    }

    function modeSwitched(t: number): Promise<void> {
      return new Promise((resolve) => {
        const done = () => { clearTimeout(timer); eventBus.off('annotationeditormodechanged', onChanged); resolve(); };
        const onChanged = (e: { mode: number }) => { if (e.mode === t) done(); };
        const timer = setTimeout(done, 1000);
        eventBus.on('annotationeditormodechanged', onChanged);
      });
    }

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

    async function placePicture(file: File) {
      if (!doc) return false;
      if (mode !== 'picture') {
        const switched = modeSwitched(T.STAMP);
        if (!setMode('picture')) return false;
        await switched;
      }
      eventBus.dispatch('switchannotationeditorparams', { source: null, type: lib.AnnotationEditorParamsType.CREATE, value: { bitmapFile: file } });
      return true;
    }

    let picking: ((value: PdfPoint | null) => void) | null = null;
    function pickPoint(): Promise<PdfPoint | null> {
      cancelPick();
      if (!doc) return Promise.resolve(null);
      if (mode !== 'select') setMode('select');
      root.classList.add('picking');
      return new Promise((resolve) => {
        const onDown = (e: PointerEvent) => {
          const pageEl = e.button === 0 && e.target instanceof Element ? e.target.closest<HTMLElement>('.page[data-page-number]') : null;
          if (!pageEl) return;
          e.preventDefault();
          e.stopPropagation();
          const view = viewer.getPageView(Number(pageEl.dataset.pageNumber) - 1);
          const r = pageEl.getBoundingClientRect();
          const [x, y] = view.viewport.convertToPdfPoint(e.clientX - r.left - pageEl.clientLeft, e.clientY - r.top - pageEl.clientTop);
          const eat = (c: MouseEvent) => { c.preventDefault(); c.stopPropagation(); };
          container.addEventListener('click', eat, true);
          setTimeout(() => container.removeEventListener('click', eat, true), 400);
          finish({ page: view.id - 1, x, y });
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
        function finish(value: PdfPoint | null) {
          container.removeEventListener('pointerdown', onDown, true);
          window.removeEventListener('keydown', onKey, true);
          root.classList.remove('picking');
          picking = null;
          resolve(value);
        }
        container.addEventListener('pointerdown', onDown, true);
        window.addEventListener('keydown', onKey, true);
        picking = finish;
      });
    }
    function cancelPick() { if (picking) picking(null); }

    async function comments() {
      const d = doc, list: PdfComment[] = [];
      if (!d) return null;
      for (let i = 0; i < d.numPages; i++) {
        const annots = await (await d.getPage(i + 1)).getAnnotations();
        if (d !== doc) return null;
        for (const a of annots) {
          const text = (a.contentsObj && a.contentsObj.str) || '';
          if (!MARKUP.has(a.subtype) || (a.subtype !== 'Text' && !text.trim()) || a.state) continue;
          list.push({
            id: a.id,
            page: i,
            ref: refOf(a.id),
            kind: a.subtype,
            text,
            author: (a.titleObj && a.titleObj.str) || '',
            date: lib.PDFDateString.toDateObject(a.modificationDate || a.creationDate || ''),
            rect: a.rect,
            replyTo: a.inReplyTo || null,
          });
        }
      }
      return list;
    }

    function goTo(page: number, rect: number[]) {
      if (!doc || page >= doc.numPages) return;
      viewer.scrollPageIntoView({ pageNumber: page + 1, destArray: [null, { name: 'XYZ' }, rect[0] - 40, rect[3] + 40, null], allowNegativeOffset: true });
    }

    async function save() {
      if (!doc) return null;
      const hash = currentHash();
      const bytes = await doc.saveDocument();
      return { bytes, hash };
    }

    return {
      open,
      close,
      setMode,
      commit,
      placePicture,
      pickPoint,
      cancelPick,
      comments,
      goTo,
      save,
      pageCount: () => (doc ? doc.numPages : 0),
      drawPage: (i: number, canvas: HTMLCanvasElement, width: number) => (doc ? drawPage(doc, i, canvas, width) : Promise.resolve()),
      openOther,
      closeOthers,
      extractPages: (pageInfos: Parameters<PdfDocument['extractPages']>[0]) => { if (!doc) throw new Error('no PDF is open'); return doc.extractPages(pageInfos); },
      markSaved(hash: string) { if (doc) { savedHash = hash; refreshDirty(); } },
      isOpen: () => !!doc,
      isDirty: () => !!doc && currentHash() !== savedHash,
      hasPendingWork: () => !!doc && (currentHash() !== savedHash || mode !== 'select'),
      undo: () => eventBus.dispatch('editingaction', { source: null, name: 'undo' }),
      redo: () => eventBus.dispatch('editingaction', { source: null, name: 'redo' }),
      zoomIn: () => viewer.increaseScale(),
      zoomOut: () => viewer.decreaseScale(),
      fitWidth: () => { viewer.currentScaleValue = 'page-width'; },
    };
  }

  return { create, modes: Object.keys(MODES) };
})();

export type PdfController = ReturnType<NonNullable<typeof NotesPdfEditor>['create']>;
