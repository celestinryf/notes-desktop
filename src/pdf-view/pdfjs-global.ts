import * as pdfjsLib from 'pdfjs-dist';

declare global {
  var pdfjsLib: typeof import('pdfjs-dist');
}

globalThis.pdfjsLib = pdfjsLib;
export { pdfjsLib };
