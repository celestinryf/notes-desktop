// Shows and edits opened .docx files as laid out in the file (docx-preview). Bundled by `npm run build` into
// src/renderer/vendor/docx.bundle.js, which exposes it as the global DocxView. JSZip (which docx-preview uses anyway)
// reads the parts; Ooxml is the same paragraph model main's save worker uses.
export { renderAsync } from 'docx-preview';
export { default as JSZip } from 'jszip';
export * as Ooxml from '../docx-edit/ooxml.js';
