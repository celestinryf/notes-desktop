type VersionTiming = { quietMs: number; boundaryQuietMs: number; attentionMs: number; attentionWindowMs: number; maxWaitMs: number };
type ChangedNote = { id: string; body: string };

const DEFAULT_TIMING: VersionTiming = { quietMs: 45000, boundaryQuietMs: 8000, attentionMs: 1000, attentionWindowMs: 3000, maxWaitMs: 10 * 60 * 1000 };
const SEEN_LIMIT = 500;
const BOUNDARY_END = /(?:[.!?…:][)\]"'”’»]*|\n)\s*$/u;
const TAIL_CHARS = 16;
const ALIGNMENT_STEPS = 64;

const endsAtBoundary = (text: string) => BOUNDARY_END.test(text.slice(-TAIL_CHARS));

const uniformTiming = (ms: number): VersionTiming => ({ quietMs: ms, boundaryQuietMs: ms, attentionMs: ms, attentionWindowMs: ms, maxWaitMs: ms * 20 });

function editEndsAtBoundary(before: string | null, after: string): boolean {
  if (!after.trim()) return true;
  if (before === null) return endsAtBoundary(after);
  let head = 0;
  const max = Math.min(before.length, after.length);
  while (head < max && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < max - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const inserted = after.slice(head, after.length - tail);
  const deleted = before.slice(head, before.length - tail);
  if (inserted && deleted) return endsAtBoundary(inserted);
  const edited = inserted ? after : before;
  const length = (inserted || deleted).length;
  for (let start = head, end = head + length, steps = 0; steps < ALIGNMENT_STEPS; start--, end--, steps++) {
    const endOfEdit = inserted && inserted.trim() ? edited.slice(start, end) : after.slice(0, inserted ? end : start);
    if (endsAtBoundary(endOfEdit)) return true;
    if (start === 0 || edited[start - 1] !== edited[end - 1]) return false;
  }
  return false;
}

class VersionClock {
  timing: VersionTiming;
  pendingSince: number | null;
  attentionLostAt: number | null;
  seen: Map<string, string>;
  constructor(timing: VersionTiming) {
    this.timing = timing;
    this.pendingSince = null;
    this.attentionLostAt = null;
    this.seen = new Map();
  }

  changed(notes: readonly ChangedNote[] | undefined, now: number): number {
    let boundary = true;
    if (notes && notes.length) {
      const last = notes[notes.length - 1];
      boundary = editEndsAtBoundary(this.seen.has(last.id) ? this.seen.get(last.id) ?? null : null, last.body);
      for (const n of notes) this._remember(n);
    }
    if (this.pendingSince === null) this.pendingSince = now;
    const quiet = boundary ? this.timing.boundaryQuietMs : this.timing.quietMs;
    const attention = this.attentionLostAt !== null && now - this.attentionLostAt <= this.timing.attentionWindowMs;
    return this._capped(attention ? Math.min(quiet, this.timing.attentionMs) : quiet, now);
  }

  attentionLost(now: number): number | null {
    this.attentionLostAt = now;
    return this.settle(now);
  }

  settle(now: number): number | null {
    return this.pendingSince === null ? null : this._capped(this.timing.attentionMs, now);
  }

  attentionBack() {
    this.attentionLostAt = null;
  }

  committed() {
    this.pendingSince = null;
  }

  _capped(delay: number, now: number) {
    const since = this.pendingSince === null ? now : this.pendingSince;
    return Math.max(0, Math.min(delay, since + this.timing.maxWaitMs - now));
  }

  _remember(n: ChangedNote) {
    if (!this.seen.has(n.id) && this.seen.size >= SEEN_LIMIT) {
      const oldest = this.seen.keys().next();
      if (!oldest.done) this.seen.delete(oldest.value);
    }
    this.seen.delete(n.id);
    this.seen.set(n.id, n.body);
  }
}

export type { VersionTiming, ChangedNote };
export { VersionClock, DEFAULT_TIMING, editEndsAtBoundary, uniformTiming };
