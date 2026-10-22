import { el } from './dom.ts';
import { state } from './state.ts';
import * as H from '../shared/helpers.mts';
import { escapeHtml } from './text.ts';

// The note as HTML: what the rendered view shows, or a one-off render when the source view is up.
export function currentHtml() {
  const live = !state.sourceMode && state.rich ? el.richEditor.querySelector('.rich-editor-content') : null;
  if (live) return live.innerHTML;
  return markdownToHtml(el.bodyInput.value, state.current);
}

// Renders Markdown with the editor itself, off screen, so exports look like the rendered view. note: whose
// relative pictures these are (an opened file's are read from its folder).
export function markdownToHtml(md: string, note) {
  if (!window.NotesEditor) return '<pre>' + escapeHtml(md) + '</pre>';
  const host = document.createElement('div');
  host.style.position = 'absolute'; host.style.left = '-99999px';
  document.body.append(host);
  try {
    let ed: RichEditor | null = null;
    try {
      ed = window.NotesEditor.create(host, { imageBase: () => H.imageBaseFor(note) });
      ed.setMarkdown(String(md || ''));
      const content = host.querySelector('.rich-editor-content');
      return content ? content.innerHTML : '';
    } finally { if (ed) ed.destroy(); }
  } finally { host.remove(); }
}
