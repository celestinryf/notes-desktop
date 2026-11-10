import { DEFAULT_PDF_TEXT_STYLE, PDF_TEXT_FONT_CSS, PDF_TEXT_PADDING, PDF_TEXT_MIN_WIDTH, MAX_PDF_TEXT, MAX_PDF_TEXT_MARKS, clampPdfTextSize, normalRect, parsePdfTextMark, parsePdfTextStyle, pdfTextLineHeight, pdfTextStyleOf, unwritablePdfChar } from '../shared/pdf-text-marks.mts';
import type { PdfTextMark, PdfTextStyle, PdfRect } from '../shared/pdf-text-marks.mts';

export type PdfTextSelection = { style: PdfTextStyle, selected: boolean, issue: string | null };
type Viewport = { scale: number, rotation: number, convertToViewportPoint: (x: number, y: number) => number[], convertToPdfPoint: (x: number, y: number) => number[], width: number, height: number };
type Hooks = {
  viewportOf: (page: number) => Viewport | null,
  pageElement: (page: number) => HTMLElement | null,
  onChange: () => void,
  onSelection: (sel: PdfTextSelection) => void,
};
type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'w' | 'e';
const HANDLES: readonly Handle[] = ['nw', 'ne', 'sw', 'se', 'w', 'e'];
const NEW_WIDTH = 200;
const UNDO_LIMIT = 100;
const MAX_TEXT_LENGTH_NOTICE = 'This text box is at its longest.';

const newId = () => 'tm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

export function createPdfTextMarks(container: HTMLElement, hooks: Hooks) {
  let marks: PdfTextMark[] = [];
  let defaults: PdfTextStyle = { ...DEFAULT_PDF_TEXT_STYLE };
  let active = false, selectedId: string | null = null, editingId: string | null = null;
  const past: string[] = [], future: string[] = [];
  let lastActionAt = 0;
  const elements = new Map<string, HTMLElement>();

  const snapshot = () => JSON.stringify(marks);
  function remember() {
    past.push(snapshot());
    if (past.length > UNDO_LIMIT) past.shift();
    future.length = 0;
    lastActionAt = Date.now();
  }
  function changed() { hooks.onChange(); }

  const byId = (id: string | null) => (id ? marks.find((m) => m.id === id) || null : null);
  const selected = () => byId(selectedId);

  function reportSelection() {
    const mark = selected();
    const text = mark ? mark.text : '';
    const bad = unwritablePdfChar(text);
    hooks.onSelection({
      style: mark ? pdfTextStyleOf(mark) : { ...defaults },
      selected: !!mark,
      issue: bad === null ? (text.length >= MAX_PDF_TEXT ? MAX_TEXT_LENGTH_NOTICE : null) : '"' + bad + '" cannot be written with the PDF\'s fonts, so this box will not save.',
    });
  }

  function layerFor(page: number) {
    const pageEl = hooks.pageElement(page);
    if (!pageEl) return null;
    let layer = pageEl.querySelector<HTMLElement>(':scope > .text-marks');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'text-marks';
      layer.dataset.page = String(page);
      layer.addEventListener('pointerdown', onLayerPointerDown);
      pageEl.append(layer);
    }
    layer.classList.toggle('is-active', active);
    return layer;
  }

  function layoutPage(page: number) {
    const layer = layerFor(page);
    const viewport = hooks.viewportOf(page);
    if (!layer || !viewport) return;
    for (const mark of marks) if (mark.page === page) placeMark(mark, layer, viewport);
    for (const [id, node] of elements) if (!byId(id)) { node.remove(); elements.delete(id); }
  }

  function layoutAll() {
    const pages = new Set(marks.map((m) => m.page));
    for (const page of pages) layoutPage(page);
  }

  function placeMark(mark: PdfTextMark, layer: HTMLElement, viewport: Viewport) {
    let node = elements.get(mark.id);
    if (!node) { node = buildMark(mark.id); elements.set(mark.id, node); }
    if (node.parentElement !== layer) layer.append(node);
    node.dataset.page = String(mark.page);
    node.dataset.rotation = String(((viewport.rotation % 360) + 360) % 360);
    const [vx1, vy1] = viewport.convertToViewportPoint(mark.rect[0], mark.rect[1]);
    const [vx2, vy2] = viewport.convertToViewportPoint(mark.rect[2], mark.rect[3]);
    const left = Math.min(vx1, vx2), top = Math.min(vy1, vy2), bw = Math.abs(vx2 - vx1), bh = Math.abs(vy2 - vy1);
    const iw = (mark.rect[2] - mark.rect[0]) * viewport.scale, ih = (mark.rect[3] - mark.rect[1]) * viewport.scale;
    Object.assign(node.style, { left: left + 'px', top: top + 'px', width: bw + 'px', height: bh + 'px' });
    const inner = node.children[0];
    if (inner instanceof HTMLElement) Object.assign(inner.style, { width: iw + 'px', height: ih + 'px', left: (bw - iw) / 2 + 'px', top: (bh - ih) / 2 + 'px', transform: viewport.rotation ? 'rotate(' + viewport.rotation + 'deg)' : '' });
    styleBody(mark, bodyOf(node), viewport.scale);
    node.classList.toggle('is-selected', mark.id === selectedId);
    node.classList.toggle('is-editing', mark.id === editingId);
  }

  const bodyOf = (node: HTMLElement) => {
    const body = node.querySelector<HTMLElement>('.text-mark-body');
    if (!body) throw new Error('a text box lost its body');
    return body;
  };

  function styleBody(mark: PdfTextMark, body: HTMLElement, scale: number) {
    Object.assign(body.style, {
      fontFamily: PDF_TEXT_FONT_CSS[mark.font],
      fontSize: mark.size * scale + 'px',
      lineHeight: pdfTextLineHeight(mark) * scale + 'px',
      fontWeight: mark.bold ? '700' : '400',
      fontStyle: mark.italic ? 'italic' : 'normal',
      textDecoration: [mark.underline ? 'underline' : '', mark.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none',
      color: mark.color,
      background: mark.fill || 'transparent',
      opacity: String(mark.opacity),
      textAlign: mark.align,
      padding: PDF_TEXT_PADDING * scale + 'px',
    });
    if (body.textContent !== mark.text && document.activeElement !== body) body.textContent = mark.text;
  }

  function buildMark(id: string) {
    const node = document.createElement('div');
    node.className = 'text-mark';
    node.dataset.id = id;
    const inner = document.createElement('div');
    inner.className = 'text-mark-inner';
    const body = document.createElement('div');
    body.className = 'text-mark-body';
    body.setAttribute('contenteditable', 'plaintext-only');
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-multiline', 'true');
    body.setAttribute('aria-label', 'Text box');
    body.spellcheck = false;
    inner.append(body);
    node.append(inner);
    for (const handle of HANDLES) {
      const h = document.createElement('div');
      h.className = 'text-mark-handle';
      h.dataset.handle = handle;
      h.addEventListener('pointerdown', (e) => startResize(e, id, handle));
      node.append(h);
    }
    node.addEventListener('pointerdown', (e) => onMarkPointerDown(e, id));
    node.addEventListener('dblclick', (e) => { e.stopPropagation(); edit(id); });
    body.addEventListener('input', () => onInput(id));
    body.addEventListener('focus', () => { if (active) { selectedId = id; editingId = id; refreshClasses(); reportSelection(); } });
    body.addEventListener('blur', (e) => onBlur(id, e.relatedTarget));
    body.addEventListener('keydown', (e) => onBodyKey(e, id));
    body.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData ? e.clipboardData.getData('text/plain') : '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
      document.execCommand('insertText', false, text);
    });
    return node;
  }

  function refreshClasses() {
    for (const [id, node] of elements) {
      node.classList.toggle('is-selected', id === selectedId);
      node.classList.toggle('is-editing', id === editingId);
    }
  }

  function select(id: string | null) {
    if (selectedId === id) return;
    if (editingId && editingId !== id) stopEditing();
    selectedId = id;
    if (id === null) pruneEmpty();
    refreshClasses();
    reportSelection();
  }

  function edit(id: string) {
    if (!active) return;
    const node = elements.get(id);
    if (!node) return;
    selectedId = id;
    editingId = id;
    refreshClasses();
    const body = bodyOf(node);
    if (document.activeElement !== body) {
      body.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    }
    reportSelection();
  }

  function stopEditing() {
    const id = editingId;
    editingId = null;
    if (id) {
      const node = elements.get(id);
      if (node && document.activeElement === bodyOf(node)) bodyOf(node).blur();
    }
    refreshClasses();
  }

  let textBefore: string | null = null;
  function onInput(id: string) {
    const mark = byId(id), node = elements.get(id);
    if (!mark || !node) return;
    const body = bodyOf(node);
    let text = body.innerText.replace(/\r\n?/g, '\n').replace(/\n$/, '').replace(/\t/g, '    ');
    if (text.length > MAX_PDF_TEXT) { text = text.slice(0, MAX_PDF_TEXT); body.textContent = text; }
    if (textBefore === null) { textBefore = mark.text; remember(); }
    mark.text = text;
    fitHeight(mark);
    changed();
    reportSelection();
  }

  let resumeEditId: string | null = null;
  function onBlur(id: string, to: EventTarget | null) {
    const mark = byId(id);
    textBefore = null;
    const toControls = to instanceof Node && !container.contains(to);
    resumeEditId = toControls && editingId === id ? id : null;
    if (mark && !mark.text.trim() && !toControls && document.hasFocus()) { removeMark(id, false); return; }
    if (editingId === id) { editingId = null; refreshClasses(); }
  }

  function pruneEmpty() {
    for (const mark of marks.slice()) if (!mark.text.trim() && mark.id !== editingId) removeMark(mark.id, false);
  }

  function fitHeight(mark: PdfTextMark) {
    const node = elements.get(mark.id), viewport = hooks.viewportOf(mark.page);
    if (!node || !viewport) return;
    const body = bodyOf(node);
    body.style.minHeight = '0';
    const natural = body.scrollHeight;
    body.style.minHeight = '';
    const px = Math.max(natural, pdfTextLineHeight(mark) * viewport.scale + 2 * PDF_TEXT_PADDING * viewport.scale);
    const h = px / viewport.scale;
    mark.rect = [mark.rect[0], mark.rect[3] - h, mark.rect[2], mark.rect[3]];
    const layer = layerFor(mark.page);
    if (layer) placeMark(mark, layer, viewport);
  }

  function removeMark(id: string, record = true) {
    const node = elements.get(id);
    if (!byId(id)) return;
    if (record) remember();
    marks = marks.filter((m) => m.id !== id);
    if (node) node.remove();
    elements.delete(id);
    if (selectedId === id) selectedId = null;
    if (editingId === id) editingId = null;
    changed();
    reportSelection();
  }

  function pagePoint(layer: HTMLElement, viewport: Viewport, e: PointerEvent) {
    const r = layer.getBoundingClientRect();
    const [x, y] = viewport.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top);
    return { x, y };
  }

  function onLayerPointerDown(e: PointerEvent) {
    if (!active || e.button !== 0 || !(e.currentTarget instanceof HTMLElement) || e.target !== e.currentTarget) return;
    const layer = e.currentTarget;
    const page = Number(layer.dataset.page);
    const viewport = hooks.viewportOf(page);
    if (!viewport) return;
    e.preventDefault();
    if (selectedId) { select(null); return; }
    if (marks.length >= MAX_PDF_TEXT_MARKS) return;
    const { x, y } = pagePoint(layer, viewport, e);
    const right = Math.max(viewport.convertToPdfPoint(0, 0)[0], viewport.convertToPdfPoint(viewport.width, viewport.height)[0]);
    const width = Math.min(NEW_WIDTH, Math.max(PDF_TEXT_MIN_WIDTH, right - x));
    const h = pdfTextLineHeight(defaults) + 2 * PDF_TEXT_PADDING;
    const mark: PdfTextMark = Object.assign({ id: newId(), page, rect: normalRect([x, y - h, x + width, y]), text: '' }, defaults);
    remember();
    marks.push(mark);
    layoutPage(page);
    changed();
    edit(mark.id);
  }

  type Drag = { id: string, startX: number, startY: number, rect: PdfRect, size: number, handle: Handle | 'move', moved: boolean, viewport: Viewport, remembered: boolean };
  let drag: Drag | null = null;

  function onMarkPointerDown(e: PointerEvent, id: string) {
    if (!active || e.button !== 0) return;
    const mark = byId(id), node = elements.get(id);
    if (!mark || !node) return;
    e.stopPropagation();
    const body = bodyOf(node);
    const onBody = e.target instanceof Node && body.contains(e.target);
    if (onBody && editingId === id) return;
    e.preventDefault();
    select(id);
    const viewport = hooks.viewportOf(mark.page);
    if (!viewport) return;
    drag = { id, startX: e.clientX, startY: e.clientY, rect: [...mark.rect], size: mark.size, handle: 'move', moved: false, viewport, remembered: false };
    trackDrag(e, onBody);
  }

  function startResize(e: PointerEvent, id: string, handle: Handle) {
    if (!active || e.button !== 0) return;
    const mark = byId(id);
    if (!mark) return;
    e.preventDefault();
    e.stopPropagation();
    select(id);
    const viewport = hooks.viewportOf(mark.page);
    if (!viewport) return;
    stopEditing();
    if (!byId(id)) return;
    drag = { id, startX: e.clientX, startY: e.clientY, rect: [...mark.rect], size: mark.size, handle, moved: false, viewport, remembered: false };
    trackDrag(e, false);
  }

  function trackDrag(e: PointerEvent, clickEdits: boolean) {
    const target = e.currentTarget instanceof HTMLElement ? e.currentTarget : container;
    const onMove = (m: PointerEvent) => { if (drag) applyDrag(m); };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      const d = drag;
      drag = null;
      if (!d) return;
      if (!d.moved && clickEdits) edit(d.id);
      else if (d.moved) { const mark = byId(d.id); if (mark && d.handle !== 'move') fitHeight(mark); changed(); }
    };
    target.setPointerCapture(e.pointerId);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  function applyDrag(m: PointerEvent) {
    const d = drag;
    const mark = d && byId(d.id);
    if (!d || !mark) return;
    const dx = (m.clientX - d.startX) / d.viewport.scale, dy = -(m.clientY - d.startY) / d.viewport.scale;
    if (!d.moved && Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    if (!d.remembered) { remember(); d.remembered = true; }
    d.moved = true;
    const [x1, y1, x2, y2] = d.rect;
    const { dx: rx, dy: ry } = rotateDelta(dx, dy, d.viewport.rotation);
    if (d.handle === 'move') mark.rect = [x1 + rx, y1 + ry, x2 + rx, y2 + ry];
    else if (d.handle === 'e') mark.rect = [x1, y1, Math.max(x1 + PDF_TEXT_MIN_WIDTH, x2 + rx), y2];
    else if (d.handle === 'w') mark.rect = [Math.min(x2 - PDF_TEXT_MIN_WIDTH, x1 + rx), y1, x2, y2];
    else {
      const w0 = x2 - x1;
      const grow = d.handle === 'ne' || d.handle === 'se' ? rx : -rx;
      const factor = Math.max(PDF_TEXT_MIN_WIDTH / w0, (w0 + grow) / w0);
      mark.size = clampPdfTextSize(d.size * factor);
      const w = w0 * (mark.size / d.size);
      mark.rect = d.handle === 'ne' || d.handle === 'se' ? [x1, y1, x1 + w, y2] : [x2 - w, y1, x2, y2];
    }
    const node = elements.get(mark.id);
    if (node && node.parentElement instanceof HTMLElement) placeMark(mark, node.parentElement, d.viewport);
    if (d.handle !== 'move') { fitHeight(mark); reportSelection(); }
  }

  function rotateDelta(dx: number, dy: number, rotation: number) {
    const r = ((rotation % 360) + 360) % 360;
    if (r === 90) return { dx: -dy, dy: dx };
    if (r === 180) return { dx: -dx, dy: -dy };
    if (r === 270) return { dx: dy, dy: -dx };
    return { dx, dy };
  }

  function onBodyKey(e: KeyboardEvent, id: string) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopEditing(); return; }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const toggles: Record<string, keyof PdfTextStyle> = { b: 'bold', i: 'italic', u: 'underline' };
    if (key in toggles) { e.preventDefault(); const mark = byId(id); if (mark) setStyle({ [toggles[key]]: !mark[toggles[key]] }); }
  }

  function onContainerKey(e: KeyboardEvent) {
    if (!active || !selectedId || editingId) return;
    const mark = selected();
    if (!mark) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeMark(mark.id); return; }
    if (e.key === 'Escape') { e.preventDefault(); select(null); return; }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); edit(mark.id); return; }
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (!(e.key in moves)) return;
    e.preventDefault();
    remember();
    const [dx, dy] = moves[e.key];
    const viewport = hooks.viewportOf(mark.page);
    const { dx: rx, dy: ry } = rotateDelta(dx, dy, viewport ? viewport.rotation : 0);
    mark.rect = [mark.rect[0] + rx, mark.rect[1] + ry, mark.rect[2] + rx, mark.rect[3] + ry];
    layoutPage(mark.page);
    changed();
  }
  container.addEventListener('keydown', onContainerKey);

  function setStyle(partial: Partial<PdfTextStyle>) {
    const mark = selected();
    if (!mark) {
      defaults = parsePdfTextStyle({ ...defaults, ...partial });
      reportSelection();
      return;
    }
    remember();
    const next = parsePdfTextStyle({ ...pdfTextStyleOf(mark), ...partial });
    Object.assign(mark, next);
    defaults = { ...next };
    layoutPage(mark.page);
    fitHeight(mark);
    changed();
    reportSelection();
    if (resumeEditId === mark.id) { resumeEditId = null; edit(mark.id); }
  }

  function restore(json: string) {
    textBefore = null;
    const parsed: unknown = JSON.parse(json);
    marks = Array.isArray(parsed) ? parsed.map(parsePdfTextMark).filter((m): m is PdfTextMark => m !== null) : [];
    selectedId = null;
    editingId = null;
    for (const node of elements.values()) node.remove();
    elements.clear();
    layoutAll();
    changed();
    reportSelection();
  }

  function undo() {
    const prev = past.pop();
    if (prev === undefined) return false;
    future.push(snapshot());
    lastActionAt = Date.now();
    restore(prev);
    return true;
  }

  function redo() {
    const next = future.pop();
    if (next === undefined) return false;
    past.push(snapshot());
    lastActionAt = Date.now();
    restore(next);
    return true;
  }

  function load(list: PdfTextMark[]) {
    marks = list.map((m) => ({ ...m, rect: normalRect(m.rect) }));
    past.length = 0;
    future.length = 0;
    lastActionAt = 0;
    textBefore = null;
    selectedId = null;
    editingId = null;
    for (const node of elements.values()) node.remove();
    elements.clear();
    layoutAll();
    reportSelection();
  }

  function setActive(on: boolean) {
    active = on;
    if (!on) { stopEditing(); selectedId = null; pruneEmpty(); refreshClasses(); }
    for (const layer of container.querySelectorAll<HTMLElement>('.text-marks')) layer.classList.toggle('is-active', on);
    reportSelection();
  }

  return {
    load,
    clear: () => load([]),
    marks: () => marks.map((m) => ({ ...m, rect: normalRect(m.rect) })),
    layoutPage,
    layoutAll,
    setActive,
    setStyle,
    commit: () => { if (editingId) stopEditing(); pruneEmpty(); },
    deselect: () => select(null),
    hasSelection: () => !!selected(),
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    undo,
    redo,
    lastActionAt: () => lastActionAt,
    count: () => marks.length,
  };
}
