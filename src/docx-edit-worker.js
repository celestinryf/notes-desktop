// @ts-check
'use strict';
/* Writes edits into a Word document, in a worker thread. workerData: { bytes (the .docx the edits were made on),
   patches: changed paragraphs of word/document.xml as ooxml.js makes them }. Every other part of the file is kept
   as it was. Posts back { ok, bytes } or { ok: false, error }. */
const { parentPort, workerData } = require('worker_threads');
const port = parentPort;
if (!port) throw new Error('this script runs in a worker thread only');
const JSZip = require('jszip');
const X = require('./docx-edit/ooxml');

(async () => {
  try {
    const zip = await JSZip.loadAsync(workerData.bytes);
    const part = zip.file('word/document.xml');
    if (!part) throw new Error('the document has no main part');
    const xml = await part.async('string');
    const settings = zip.file('word/settings.xml');
    const block = X.settingsBlock(settings ? await settings.async('string') : '');
    if (block) throw new Error(block);
    X.checkPatches(xml, X.scanDocument(xml), workerData.patches);
    const out = X.applyPatches(xml, workerData.patches);
    X.assertWellFormed(out);
    zip.file('word/document.xml', out);
    port.postMessage({ ok: true, bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }) });
  } catch (err) {
    port.postMessage({ ok: false, error: err.message });
  }
})();
