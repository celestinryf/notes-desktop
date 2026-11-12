type VersionTiming = { quietMs: number; maxWaitMs: number };

const DEFAULT_TIMING: VersionTiming = { quietMs: 5 * 60 * 1000, maxWaitMs: 30 * 60 * 1000 };

const uniformTiming = (ms: number): VersionTiming => ({ quietMs: ms, maxWaitMs: ms * 20 });

class VersionClock {
  timing: VersionTiming;
  pendingSince: number | null;
  constructor(timing: VersionTiming) {
    this.timing = timing;
    this.pendingSince = null;
  }

  changed(now: number): number {
    if (this.pendingSince === null) this.pendingSince = now;
    return Math.max(0, Math.min(this.timing.quietMs, this.pendingSince + this.timing.maxWaitMs - now));
  }

  committed() {
    this.pendingSince = null;
  }
}

export type { VersionTiming };
export { VersionClock, DEFAULT_TIMING, uniformTiming };
