'use strict';
/* Turns pages of a PDF, in a worker thread. workerData: { bytes, rotations } with one entry per page, each 0, 90,
   180 or 270 degrees clockwise, added to the page's own rotation. Posts back { ok, bytes } or { ok: false, error }. */
const { parentPort, workerData } = require('worker_threads');
const { PDFDocument, degrees } = require('pdf-lib');

(async () => {
  try {
    const doc = await PDFDocument.load(workerData.bytes, { updateMetadata: false });
    const pages = doc.getPages();
    if (pages.length !== workerData.rotations.length) throw new Error('the PDF has a different number of pages than expected');
    pages.forEach((page, i) => {
      const turn = workerData.rotations[i];
      if (turn) page.setRotation(degrees((page.getRotation().angle + turn) % 360));
    });
    parentPort.postMessage({ ok: true, bytes: await doc.save() });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: /encrypt/i.test(err.message) ? 'this PDF is encrypted, so Notes cannot turn its pages' : err.message });
  }
})();
