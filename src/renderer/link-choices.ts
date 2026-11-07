import * as H from '../shared/helpers.mts';

export type LinkChoice = { href: string; label: string; icon: string; keys: string; noteId: string | null; folderId: string | null };

const KNOWN_SCHEME = /^(?:(?:https?|ftp|file|note|attachment):\/\/|(?:mailto|tel):)\S/i;
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i;
const LINK_LIKE = /[/#\\]|\.[a-z][a-z0-9]{0,7}$|^[a-z][a-z0-9+.-]*:\S/i;

export function webAddress(text: string) {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  if (/^www\.\S/i.test(t)) return { href: 'https://' + t, certain: true };
  if (KNOWN_SCHEME.test(t)) return { href: t, certain: true };
  if (BARE_DOMAIN.test(t)) return { href: 'https://' + t, certain: false };
  return null;
}

export function matchingNotes<T extends ListRow>(rows: readonly T[], query: string, skipId: string | null, limit: number): T[] {
  const q = query.trim();
  const notes = rows.filter((n) => n.id !== skipId && !n.trashedAt);
  if (!q) return notes.slice(0, limit);
  return notes.map((n) => ({ n, s: H.fuzzyScore(q, H.deriveTitle(n)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.n);
}

const noteChoices = (rows: readonly ListRow[], query: string, skipId: string | null, limit: number) => matchingNotes(rows, query, skipId, limit).map((n): LinkChoice => ({
  href: 'note://' + n.id, label: H.deriveTitle(n), icon: n.locked ? 'lock' : 'notebook-text', keys: H.relativeTime(n.updatedAt), noteId: n.id, folderId: n.folderId || null,
}));

const addressChoice = (href: string, keys: string): LinkChoice => ({ href, label: href, icon: 'link', keys, noteId: null, folderId: null });

export function linkChoices(text: string, rows: readonly ListRow[], skipId: string | null, limit: number, current?: string | null): LinkChoice[] {
  const t = text.trim();
  if (current && t === current && !current.startsWith('note://')) return [addressChoice(current, 'Current link')].concat(noteChoices(rows, t, skipId, limit - 1));
  const web = webAddress(t);
  const asTyped = !web && t && !/\s/.test(t) && LINK_LIKE.test(t) ? t : null;
  const notes = noteChoices(rows, t, skipId, web || asTyped ? limit - 1 : limit);
  if (web) return web.certain ? [addressChoice(web.href, 'Web address')].concat(notes) : notes.concat(addressChoice(web.href, 'Web address'));
  if (asTyped) return notes.concat(addressChoice(asTyped, 'As typed'));
  return notes;
}
