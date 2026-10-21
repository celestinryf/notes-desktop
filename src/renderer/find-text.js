// @ts-check
// Positions of every case-insensitive occurrence of q in text.
// Case-insensitive, but measured on the ORIGINAL text: lower-casing can change string length ("İ" becomes
// two code units), which would shift every offset after it and make a replace hit the wrong characters.
// The same case rule as findOffsets (RegExp 'i'), so a guard never disagrees with the matcher (ς vs σ).
export function isQueryText(text, q) {
  return new RegExp('^' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i').test(text);
}

export function findOffsets(text, q) {
  const hits = [];
  if (!q) return hits;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let m;
  while ((m = re.exec(text)) !== null) { hits.push(m.index); if (m[0].length === 0) re.lastIndex++; }
  return hits;
}
