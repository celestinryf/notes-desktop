/* The PDF viewer and editor for opened PDFs: pdf.js with Firefox's annotation editors. Bundled by esbuild into
   src/renderer/vendor/pdf.bundle.js and exposed as window.PdfView. The parsing runs in pdf.js's worker, never on
   the app's page. */
export { pdfjsLib } from './pdfjs-global.js';
export { PDFViewer, EventBus, PDFLinkService } from 'pdfjs-dist/web/pdf_viewer.mjs';
