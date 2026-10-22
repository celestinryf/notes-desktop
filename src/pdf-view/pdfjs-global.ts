// pdf.js's viewer components read the library from globalThis.pdfjsLib when they load, so it is set here first.
import * as pdfjsLib from 'pdfjs-dist';

declare global {
  var pdfjsLib: typeof import('pdfjs-dist');
}

globalThis.pdfjsLib = pdfjsLib;
export { pdfjsLib };
