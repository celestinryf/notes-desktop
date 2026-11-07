import * as H from '../shared/helpers.mts';

export type LinkChoice = { href: string; label: string; icon: string; keys: string; noteId: string | null };

const SCHEME = /^[a-z][a-z0-9+.-]*:\S/i;
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i;

export function webAddress(text: string) {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  if (/^www\./i.test(t)) return { href: 'https://' + t, certain: true };
  if (BARE_DOMAIN.test(t)) return { href: 'https://' + t, certain: false };
  if (SCHEME.test(t)) return { href: t, certain: true };
  return null;
}

export function matchingNotes<T extends ListRow>(rows: readonly T[], query: string, skipId: string | null, limit: number): T[] {
  const q = query.trim();
  const notes = rows.filter((n) => n.id !== skipId && !n.trashedAt);
  if (!q) return notes.slice(0, limit);
  return notes.map((n) => ({ n, s: H.fuzzyScore(q, H.deriveTitle(n)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.n);
}

export function linkChoices(text: string, rows: readonly ListRow[], skipId: string | null, limit: number): LinkChoice[] {
  const web = webAddress(text);
  const notes = matchingNotes(rows, text, skipId, web ? limit - 1 : limit).map((n): LinkChoice => ({
    href: 'note://' + n.id, label: H.deriveTitle(n), icon: n.locked ? 'lock' : 'notebook-text', keys: H.relativeTime(n.updatedAt), noteId: n.id,
  }));
  if (!web) return notes;
  const address: LinkChoice = { href: web.href, label: web.href, icon: 'link', keys: 'Web address', noteId: null };
  return web.certain ? [address].concat(notes) : notes.concat(address);
}
