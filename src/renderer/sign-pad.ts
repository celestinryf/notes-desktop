type Point = { x: number, y: number };
type Box = { x0: number, y0: number, x1: number, y1: number };

export const NotesSignPad = (function () {
  'use strict';
  const INK = '#1b1f4a';
  const PAD = 6;

  function create(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The signature pad needs a 2D canvas.');
    const ctx: CanvasRenderingContext2D = context;
    let drawing = false, last: Point | null = null, box: Box | null = null, scale = 1;

    function fit() {
      const r = canvas.getBoundingClientRect();
      scale = window.devicePixelRatio || 1;
      canvas.width = Math.round((r.width || 600) * scale);
      canvas.height = Math.round((r.height || 220) * scale);
      box = null;
    }

    function point(e: PointerEvent): Point {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
    }
    function grow(p: Point) {
      box = box
        ? { x0: Math.min(box.x0, p.x), y0: Math.min(box.y0, p.y), x1: Math.max(box.x1, p.x), y1: Math.max(box.y1, p.y) }
        : { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    }
    function pen() {
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
      ctx.lineWidth = 3 * scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
    function dot(p: Point) {
      pen();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5 * scale, 0, Math.PI * 2);
      ctx.fill();
      grow(p);
    }
    function line(a: Point, b: Point) {
      pen();
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      grow(a);
      grow(b);
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      last = point(e);
      dot(last);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || !last) return;
      const p = point(e);
      line(last, p);
      last = p;
    });
    const stop = () => { drawing = false; last = null; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);

    function clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      box = null;
    }

    async function load(blob: Blob) {
      clear();
      const img = await createImageBitmap(blob);
      const s = Math.min(1, canvas.width / img.width, canvas.height / img.height);
      const w = img.width * s, h = img.height * s, x = (canvas.width - w) / 2, y = (canvas.height - h) / 2;
      ctx.drawImage(img, x, y, w, h);
      img.close();
      box = { x0: x, y0: y, x1: x + w, y1: y + h };
    }

    function writeName(name: string) {
      clear();
      const text = String(name || '').trim();
      if (!text) return false;
      let size = canvas.height * 0.45;
      ctx.fillStyle = INK;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const font = (px: number) => 'italic 500 ' + px + 'px Fraunces, Georgia, serif';
      ctx.font = font(size);
      while (size > 8 && ctx.measureText(text).width > canvas.width * 0.9) ctx.font = font(size *= 0.9);
      const w = ctx.measureText(text).width;
      ctx.fillText(text, canvas.width / 2, canvas.height / 2);
      box = { x0: (canvas.width - w) / 2, y0: canvas.height / 2 - size * 0.7, x1: (canvas.width + w) / 2, y1: canvas.height / 2 + size * 0.7 };
      return true;
    }

    function toBlob(): Promise<Blob | null> {
      if (!box) return Promise.resolve(null);
      const pad = PAD * scale;
      const x0 = Math.max(0, Math.floor(box.x0 - pad)), y0 = Math.max(0, Math.floor(box.y0 - pad));
      const x1 = Math.min(canvas.width, Math.ceil(box.x1 + pad)), y1 = Math.min(canvas.height, Math.ceil(box.y1 + pad));
      const out = document.createElement('canvas');
      out.width = x1 - x0;
      out.height = y1 - y0;
      const ctx = out.getContext('2d');
      if (!ctx) return Promise.resolve(null);
      ctx.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    }

    return { fit, clear, load, writeName, toBlob, isEmpty: () => !box };
  }

  return { create };
})();
