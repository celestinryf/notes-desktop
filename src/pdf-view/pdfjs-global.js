// pdf.js's viewer components read the library from globalThis.pdfjsLib when they load, so it is set here first.
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

globalThis.pdfjsLib = pdfjsLib;
export { pdfjsLib };
