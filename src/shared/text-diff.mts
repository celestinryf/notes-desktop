type DiffKind = 'same' | 'add' | 'del';
type DiffSegment = { kind: DiffKind; text: string };
type DiffCounts = { added: number; removed: number };

const WORD_TOKEN = /\s+|\w+|[^\s\w]/gu;
const WORD_TOKEN_LIMIT = 40000;

function tokens(text: string, byLine: boolean): string[] {
  if (!text) return [];
  if (byLine) return text.split(/(?<=\n)/);
  return text.match(WORD_TOKEN) || [];
}

function commonEnds(a: string[], b: string[]) {
  let head = 0;
  const max = Math.min(a.length, b.length);
  while (head < max && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < max - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return { head, tail };
}

function myers(a: string[], b: string[]): DiffKind[] {
  const n = a.length, m = b.length, max = n + m;
  if (!max) return [];
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, d, n, m, offset);
    }
  }
  return [];
}

function backtrack(trace: Int32Array[], dEnd: number, n: number, m: number, offset: number): DiffKind[] {
  const ops: DiffKind[] = [];
  let x = n, y = m;
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push('same'); x--; y--; }
    if (x === prevX) { ops.push('add'); y--; } else { ops.push('del'); x--; }
  }
  while (x > 0 && y > 0) { ops.push('same'); x--; y--; }
  return ops.reverse();
}

function merge(segments: DiffSegment[], kind: DiffKind, text: string) {
  const last = segments[segments.length - 1];
  if (last && last.kind === kind) last.text += text;
  else segments.push({ kind, text });
}

function diffText(before: string, after: string): DiffSegment[] {
  if (before === after) return before ? [{ kind: 'same', text: before }] : [];
  let a = tokens(before, false), b = tokens(after, false);
  if (a.length + b.length > WORD_TOKEN_LIMIT) { a = tokens(before, true); b = tokens(after, true); }
  const { head, tail } = commonEnds(a, b);
  const segments: DiffSegment[] = [];
  if (head) merge(segments, 'same', a.slice(0, head).join(''));
  const midA = a.slice(head, a.length - tail), midB = b.slice(head, b.length - tail);
  let i = 0, j = 0;
  for (const op of myers(midA, midB)) {
    if (op === 'same') { merge(segments, 'same', midA[i]); i++; j++; }
    else if (op === 'del') { merge(segments, 'del', midA[i]); i++; }
    else { merge(segments, 'add', midB[j]); j++; }
  }
  if (tail) merge(segments, 'same', a.slice(a.length - tail).join(''));
  return segments;
}

const countWords = (text: string) => (text.match(/\w+/gu) || []).length;

function diffCounts(segments: readonly DiffSegment[]): DiffCounts {
  let added = 0, removed = 0;
  for (const s of segments) {
    if (s.kind === 'add') added += countWords(s.text);
    else if (s.kind === 'del') removed += countWords(s.text);
  }
  return { added, removed };
}

function diffSummary(counts: DiffCounts) {
  const words = (n: number) => n + (n === 1 ? ' word' : ' words');
  if (!counts.added && !counts.removed) return 'No words differ.';
  if (!counts.removed) return words(counts.added) + ' added.';
  if (!counts.added) return words(counts.removed) + ' removed.';
  return words(counts.added) + ' added, ' + counts.removed + ' removed.';
}

export type { DiffKind, DiffSegment, DiffCounts };
export { diffText, diffCounts, diffSummary, WORD_TOKEN_LIMIT };
