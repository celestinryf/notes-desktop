import { el } from './dom.js';
import { state } from './state.js';
import H from '../shared/helpers.js';
import { escapeHtml } from './text.js';

// The note as HTML: what the rendered view shows, or a one-off render when the source view is up.
export function currentHtml() {
  const live = !state.sourceMode && state.rich ? el.richEditor.querySelector('.rich-editor-content') : null;
  if (live) return live.innerHTML;
  return markdownToHtml(el.bodyInput.value, state.current);
}

// Renders Markdown with the editor itself, off screen, so exports look like the rendered view. note: whose
// relative pictures these are (an opened file's are read from its folder).
export function markdownToHtml(md, note) {
  if (!window.NotesEditor) return '<pre>' + escapeHtml(md) + '</pre>';
  const host = document.createElement('div');
  host.style.position = 'absolute'; host.style.left = '-99999px';
  document.body.append(host);
  try {
    let ed = null;
    try {
      ed = window.NotesEditor.create(host, { imageBase: () => H.imageBaseFor(note) });
      ed.setMarkdown(String(md || ''));
      return host.querySelector('.rich-editor-content').innerHTML;
    } finally { if (ed) ed.destroy(); }
  } finally { host.remove(); }
}
