type DiffKind = 'same' | 'add' | 'del';
type DiffSegment = { kind: DiffKind; text: string };
type DiffCounts = { added: number; removed: number; places: number };

const WORD = /[\p{L}\p{N}_]+/gu;
const WORD_TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;
const WORD_TOKEN_LIMIT = 40000;
const MAX_EDIT_DISTANCE = 3000;
const GROUP_GAP_WORDS = 2;

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

function myers(a: string[], b: string[]): DiffKind[] | null {
  const n = a.length, m = b.length, max = Math.min(n + m, MAX_EDIT_DISTANCE);
  if (!n && !m) return [];
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, d, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], dEnd: number, n: number, m: number): DiffKind[] {
  const ops: DiffKind[] = [];
  let x = n, y = m;
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d];
    const at = (k: number) => v[k + d];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push('same'); x--; y--; }
    if (x === prevX) { ops.push('add'); y--; } else { ops.push('del'); x--; }
  }
  while (x > 0 && y > 0) { ops.push('same'); x--; y--; }
  return ops.reverse();
}

function merge(segments: DiffSegment[], kind: DiffKind, text: string) {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.kind === kind) last.text += text;
  else segments.push({ kind, text });
}

function middleSegments(midA: string[], midB: string[]): DiffSegment[] {
  const segments: DiffSegment[] = [];
  const ops = myers(midA, midB);
  if (!ops) {
    merge(segments, 'del', midA.join(''));
    merge(segments, 'add', midB.join(''));
    return segments;
  }
  let i = 0, j = 0;
  for (const op of ops) {
    if (op === 'same') { merge(segments, 'same', midA[i]); i++; j++; }
    else if (op === 'del') { merge(segments, 'del', midA[i]); i++; }
    else { merge(segments, 'add', midB[j]); j++; }
  }
  return segments;
}

const countWords = (text: string) => (text.match(WORD) || []).length;

function groupReplacements(segments: readonly DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  let del = '', add = '', open = false, hasDel = false, hasAdd = false;
  const close = () => { merge(out, 'del', del); merge(out, 'add', add); del = ''; add = ''; open = false; hasDel = false; hasAdd = false; };
  segments.forEach((s, i) => {
    if (s.kind === 'same') {
      const next = segments[i + 1];
      const replacing = next && ((hasDel && hasAdd) || (hasDel && next.kind === 'add') || (hasAdd && next.kind === 'del'));
      if (open && replacing && countWords(s.text) <= GROUP_GAP_WORDS) { del += s.text; add += s.text; }
      else { if (open) close(); out.push({ kind: 'same', text: s.text }); }
      return;
    }
    open = true;
    if (s.kind === 'del') { del += s.text; hasDel = true; } else { add += s.text; hasAdd = true; }
  });
  if (open) close();
  return out;
}

function diffText(before: string, after: string): DiffSegment[] {
  if (before === after) return before ? [{ kind: 'same', text: before }] : [];
  let a = tokens(before, false), b = tokens(after, false);
  let ends = commonEnds(a, b);
  if (a.length + b.length - 2 * (ends.head + ends.tail) > WORD_TOKEN_LIMIT) { a = tokens(before, true); b = tokens(after, true); ends = commonEnds(a, b); }
  const { head, tail } = ends;
  const segments: DiffSegment[] = [];
  merge(segments, 'same', a.slice(0, head).join(''));
  for (const s of groupReplacements(middleSegments(a.slice(head, a.length - tail), b.slice(head, b.length - tail)))) merge(segments, s.kind, s.text);
  merge(segments, 'same', a.slice(a.length - tail).join(''));
  return segments;
}

function diffCounts(segments: readonly DiffSegment[]): DiffCounts {
  let added = 0, removed = 0, places = 0;
  segments.forEach((s, i) => {
    if (s.kind === 'same') return;
    if (s.kind === 'add') added += countWords(s.text); else removed += countWords(s.text);
    if (!(s.kind === 'add' && i > 0 && segments[i - 1].kind === 'del')) places++;
  });
  return { added, removed, places };
}

function diffSummary(counts: DiffCounts) {
  const words = (n: number) => n + (n === 1 ? ' word' : ' words');
  if (!counts.added && !counts.removed) return counts.places ? 'Only spacing or punctuation differs.' : 'No words differ.';
  const change = !counts.removed ? words(counts.added) + ' added' : !counts.added ? words(counts.removed) + ' removed' : words(counts.added) + ' added, ' + counts.removed + ' removed';
  return counts.places > 1 ? change + ', in ' + counts.places + ' places. F3 steps through them.' : change + '.';
}

export type { DiffKind, DiffSegment, DiffCounts };
export { diffText, diffCounts, diffSummary, WORD_TOKEN_LIMIT, MAX_EDIT_DISTANCE };
