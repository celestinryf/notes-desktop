export type FindOptions = { matchCase?: boolean, wholeWord?: boolean };

const WORD_EDGE_BEFORE = '(?<![\\p{L}\\p{N}_])';
const WORD_EDGE_AFTER = '(?![\\p{L}\\p{N}_])';
const STARTS_WITH_WORD = /^[\p{L}\p{N}_]/u;
const ENDS_WITH_WORD = /[\p{L}\p{N}_]$/u;
const escapeRegExp = (q: string) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function queryRegExp(q: string, opts?: FindOptions, global?: boolean) {
  let body = escapeRegExp(q);
  if (opts && opts.wholeWord) {
    if (STARTS_WITH_WORD.test(q)) body = WORD_EDGE_BEFORE + body;
    if (ENDS_WITH_WORD.test(q)) body = body + WORD_EDGE_AFTER;
  }
  return new RegExp(body, 'u' + (global ? 'g' : '') + (opts && opts.matchCase ? '' : 'i'));
}

function unlessTooLarge<T>(fallback: T, run: () => T) {
  try { return run(); } catch (_) { return fallback; }
}

export function isQueryText(text: string, q: string, opts?: FindOptions) {
  return unlessTooLarge(false, () => {
    const inner = queryRegExp(q, opts);
    return new RegExp('^(?:' + inner.source + ')$', inner.flags).test(text);
  });
}

export function findOffsets(text: string, q: string, opts?: FindOptions) {
  if (!q) return [];
  return unlessTooLarge<number[]>([], () => {
    const hits: number[] = [];
    const re = queryRegExp(q, opts, true);
    let m;
    while ((m = re.exec(text)) !== null) { hits.push(m.index); if (m[0].length === 0) re.lastIndex++; }
    return hits;
  });
}
