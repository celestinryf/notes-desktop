'use strict';
/* Reminders: a note can carry a remindAt time; when it passes, the note is marked reminded and the
   notifier is called once. Main process only; the clock and the notifier are injectable for tests. */

class ReminderScheduler {
  constructor(store, opts) {
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

  // Live notes whose reminder time has passed and has not been announced for that time yet.
  due() {
    const now = this.now();
    return this.store.notes.filter((n) => !n.trashedAt && n.remindAt && n.remindAt <= now && !(n.remindedAt && n.remindedAt >= n.remindAt));
  }

  // Marks first, notifies second: a notifier that throws must not cause a reminder to fire again and again.
  tick() {
    const fired = [];
    for (const n of this.due()) {
      try { this.store.markReminded(n.id, this.now()); } catch (_) { continue; } // saving paused: try again next tick
      fired.push(n);
      try { this.notify(n); } catch (_) { /* a broken notifier must not stop the others */ }
    }
    return fired;
  }
}

module.exports = { ReminderScheduler };
