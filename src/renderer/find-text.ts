export function isQueryText(text: string, q: string) {
  return new RegExp('^' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i').test(text);
}

export function findOffsets(text: string, q: string) {
  const hits: number[] = [];
  if (!q) return hits;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let m;
  while ((m = re.exec(text)) !== null) { hits.push(m.index); if (m[0].length === 0) re.lastIndex++; }
  return hits;
}
