'use strict';
/* Run with: npx electron scripts/make-icon.js
   Writes assets/icon.png and assets/icon.ico (PNG-compressed ICO) from the procedural icon. */
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');
const { drawIconBitmap } = require('../src/icon.mts');

function pngToIco(pngBuffers) {
  // ICO header + one directory entry per image, each entry pointing at a PNG payload.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngBuffers.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngBuffers.length;
  for (const { size, png } of pngBuffers) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngBuffers.map((p) => p.png)]);
}

app.whenReady().then(() => {
  const outDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  const sizes = [16, 32, 48, 256];
  const pngs = sizes.map((size) => ({ size, png: nativeImage.createFromBitmap(drawIconBitmap(size), { width: size, height: size }).toPNG() }));
  fs.writeFileSync(path.join(outDir, 'icon.png'), pngs[pngs.length - 1].png);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), pngToIco(pngs));
  console.log('wrote assets/icon.png and assets/icon.ico');
  app.quit();
});
