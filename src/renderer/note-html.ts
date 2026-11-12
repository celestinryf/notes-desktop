import { el } from './dom.ts';
import { state } from './state.ts';
import * as H from '../shared/helpers.mts';
import { escapeHtml } from './text.ts';

export function currentHtml(opts?: { formulasAsTex?: boolean }) {
  const live = !state.sourceMode && state.rich ? el.richEditor.querySelector('.rich-editor-content') : null;
  const html = live ? live.innerHTML : markdownToHtml(el.bodyInput.value, state.current);
  return opts && opts.formulasAsTex ? formulasAsTex(html) : html;
}

function formulasAsTex(html: string) {
  const host = document.createElement('div');
  host.innerHTML = html;
  for (const f of Array.from(host.querySelectorAll<HTMLElement>('.math-inline, .math-block'))) {
    const latex = f.getAttribute('data-latex') || '';
    const block = f.classList.contains('math-block');
    const tex = document.createElement(block ? 'p' : 'span');
    tex.textContent = block ? '$$' + latex.trim() + '$$' : (f.hasAttribute('data-display') ? '$$' + latex + '$$' : '$' + latex + '$');
    f.replaceWith(tex);
  }
  return host.innerHTML;
}

export function markdownToHtml(md: string, note: Parameters<typeof H.imageBaseFor>[0]) {
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
