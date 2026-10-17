/* A pad to draw a signature on, exposed as window.NotesSignPad. The picture it gives back is cropped to the strokes,
   on a transparent background, so it sits on a PDF page like ink. */
(function () {
  'use strict';
  const INK = '#1b1f4a';
  const PAD = 6; // px kept around the strokes when cropping

  // canvas: drawn at its CSS size times the screen's pixel ratio, so the signature stays sharp on a high-DPI screen
  // and when the PDF is zoomed or printed. Call fit() each time the pad is shown.
  function create(canvas) {
    const ctx = canvas.getContext('2d');
    let drawing = false, last = null, box = null, scale = 1;

    function fit() {
      const r = canvas.getBoundingClientRect();
      scale = window.devicePixelRatio || 1;
      canvas.width = Math.round((r.width || 600) * scale);
      canvas.height = Math.round((r.height || 220) * scale);
      box = null;
    }

    // Pointer position in the canvas's own pixels (it may be drawn at another size on screen).
    function point(e) {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
    }
    function grow(p) {
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
    function dot(p) {
      pen();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5 * scale, 0, Math.PI * 2);
      ctx.fill();
      grow(p);
    }
    function line(a, b) {
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
      if (!drawing) return;
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

    // Shows a saved signature (a PNG blob), centred, so it can be used as it is or drawn over.
    async function load(blob) {
      clear();
      const img = await createImageBitmap(blob);
      const s = Math.min(1, canvas.width / img.width, canvas.height / img.height);
      const w = img.width * s, h = img.height * s, x = (canvas.width - w) / 2, y = (canvas.height - h) / 2;
      ctx.drawImage(img, x, y, w, h);
      img.close();
      box = { x0: x, y0: y, x1: x + w, y1: y + h };
    }

    // Writes a typed name on the pad in a handwriting-like face: the way to sign without drawing.
    function writeName(name) {
      clear();
      const text = String(name || '').trim();
      if (!text) return false;
      let size = canvas.height * 0.45;
      ctx.fillStyle = INK;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const font = (px) => 'italic 500 ' + px + 'px Fraunces, Georgia, serif';
      ctx.font = font(size);
      while (size > 8 && ctx.measureText(text).width > canvas.width * 0.9) ctx.font = font(size *= 0.9);
      const w = ctx.measureText(text).width;
      ctx.fillText(text, canvas.width / 2, canvas.height / 2);
      box = { x0: (canvas.width - w) / 2, y0: canvas.height / 2 - size * 0.7, x1: (canvas.width + w) / 2, y1: canvas.height / 2 + size * 0.7 };
      return true;
    }

    // The strokes as a PNG blob, cropped; null when nothing is drawn.
    function toBlob() {
      if (!box) return Promise.resolve(null);
      const pad = PAD * scale;
      const x0 = Math.max(0, Math.floor(box.x0 - pad)), y0 = Math.max(0, Math.floor(box.y0 - pad));
      const x1 = Math.min(canvas.width, Math.ceil(box.x1 + pad)), y1 = Math.min(canvas.height, Math.ceil(box.y1 + pad));
      const out = document.createElement('canvas');
      out.width = x1 - x0;
      out.height = y1 - y0;
      out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    }

    return { fit, clear, load, writeName, toBlob, isEmpty: () => !box };
  }

  window.NotesSignPad = { create };
})();
