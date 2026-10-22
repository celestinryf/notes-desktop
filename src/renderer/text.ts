import * as H from '../shared/helpers.mts';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// Match on the raw text and escape each piece afterwards, so entities in notes are never split by a mark.
export function highlight(text, query) {
  const raw = String(text);
  const tokens = H.tokenize(query);
  if (!tokens.length) return escapeHtml(raw);
  const re = new RegExp('(' + tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
  return raw.split(re).map((part, i) => (i % 2 ? '<span class="mark">' + escapeHtml(part) + '</span>' : escapeHtml(part))).join('');
}

// The message of an error thrown in the main process, without Electron's "Error invoking remote method" prefix.
export function ipcErrorText(err) {
  return String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
