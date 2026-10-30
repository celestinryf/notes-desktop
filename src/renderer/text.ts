import * as H from '../shared/helpers.mts';

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s: unknown) {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export function highlight(text: unknown, query: string) {
  const raw = String(text);
  const tokens = H.tokenize(query);
  if (!tokens.length) return escapeHtml(raw);
  const re = new RegExp('(' + tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
  return raw.split(re).map((part, i) => (i % 2 ? '<span class="mark">' + escapeHtml(part) + '</span>' : escapeHtml(part))).join('');
}

type TrashSide = { vaultId: string | null, filePath: string | null };

export function trashedMessage(before: TrashSide, after: TrashSide | null, title: string) {
  const name = '"' + H.truncate(title, 30) + '"';
  if (H.isLinkedFile(before)) return 'Removed ' + name + ' from Notes. The file is still on disk.';
  if (!after || H.isRecycleBinPath(after.filePath)) return 'Moved ' + name + ' to the Recycle Bin';
  if (before.filePath) return 'Moved ' + name + " to Notes' Trash. It could not go to the Recycle Bin.";
  return 'Moved ' + name + ' to trash';
}

export function trashLabel(note: TrashSide) {
  if (H.isLinkedFile(note)) return 'Remove from Notes';
  return note.filePath ? 'Move to Recycle Bin' : 'Move to trash';
}

export function ipcErrorText(err: unknown) {
  const message = typeof err === 'object' && err !== null && 'message' in err ? err.message : undefined;
  return String(message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
