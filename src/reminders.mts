import type { Store } from './store.mts';

class ReminderScheduler {
  store: Store;
  now: () => number;
  notify: (note: Note) => void;
  tickMs: number;
  timer: NodeJS.Timeout | null;
  constructor(store: Store, opts?: { now?: () => number, notify?: (note: Note) => void, tickMs?: number }) {
    opts = opts || {};
    this.store = store;
    this.now = opts.now || Date.now;
    this.notify = opts.notify || (() => {});
    this.tickMs = opts.tickMs || 30000;
    this.timer = null;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.tick(), this.tickMs);
    if (this.timer.unref) this.timer.unref();
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  due() {
    const now = this.now();
    return this.store.notes.filter((n) => !n.trashedAt && n.remindAt && n.remindAt <= now && !(n.remindedAt && n.remindedAt >= n.remindAt));
  }

  tick() {
    const fired: Note[] = [];
    for (const n of this.due()) {
      try { this.store.markReminded(n.id, this.now()); } catch (_) { continue; }
      fired.push(n);
      try { this.notify(n); } catch (_) {  }
    }
    return fired;
  }
}

export { ReminderScheduler };
