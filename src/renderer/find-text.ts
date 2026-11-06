export type FindOptions = { matchCase?: boolean, wholeWord?: boolean };

const WORD_EDGE_BEFORE = '(?<![\\p{L}\\p{N}_])';
const WORD_EDGE_AFTER = '(?![\\p{L}\\p{N}_])';
const escapeRegExp = (q: string) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function queryRegExp(q: string, opts?: FindOptions, global?: boolean) {
  const body = opts && opts.wholeWord ? WORD_EDGE_BEFORE + escapeRegExp(q) + WORD_EDGE_AFTER : escapeRegExp(q);
  return new RegExp(body, 'u' + (global ? 'g' : '') + (opts && opts.matchCase ? '' : 'i'));
}

export function isQueryText(text: string, q: string, opts?: FindOptions) {
  const re = queryRegExp(q, opts);
  return new RegExp('^(?:' + re.source + ')$', re.flags).test(text);
}

export function findOffsets(text: string, q: string, opts?: FindOptions) {
  const hits: number[] = [];
  if (!q) return hits;
  const re = queryRegExp(q, opts, true);
  let m;
  while ((m = re.exec(text)) !== null) { hits.push(m.index); if (m[0].length === 0) re.lastIndex++; }
  return hits;
}
