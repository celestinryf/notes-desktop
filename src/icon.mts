const INK = [0x12, 0x1a, 0x2a];
const TANGERINE = [0x3e, 0x7b, 0xf4];
const CREAM = [0xe4, 0xf1, 0xfb];

function drawIconBitmap(size: number) {
  const buf = Buffer.alloc(size * size * 4);
  const border = Math.max(1, Math.round(size / 16));
  const radius = Math.round(size / 6);
  const lineH = Math.max(1, Math.round(size / 16));
  const lineGap = Math.round(size / 5);
  const lineStart = Math.round(size * 0.3);
  const padX = Math.round(size * 0.25);
  const lines = [0, 1, 2].map((i) => lineStart + i * lineGap);

  const insideRounded = (x: number, y: number, inset: number) => {
    const lo = inset, hi = size - 1 - inset, r = Math.max(0, radius - inset);
    if (x < lo || x > hi || y < lo || y > hi) return false;
    const cx = x < lo + r ? lo + r : x > hi - r ? hi - r : x;
    const cy = y < lo + r ? lo + r : y > hi - r ? hi - r : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + r;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      let px: number[] | null = null;
      if (insideRounded(x, y, border)) {
        px = TANGERINE;
        for (const ly of lines) {
          const lineW = ly === lines[2] ? Math.round(size * 0.3) : size - padX * 2;
          if (y >= ly && y < ly + lineH && x >= padX && x < padX + lineW) px = CREAM;
        }
      } else if (insideRounded(x, y, 0)) {
        px = INK;
      }
      if (px) {
        buf[o] = px[0]; buf[o + 1] = px[1]; buf[o + 2] = px[2]; buf[o + 3] = 255;
      }
    }
  }
  return buf;
}

export { drawIconBitmap };
