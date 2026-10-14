'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../../src/store');
const { ReminderScheduler } = require('../../src/reminders');
const H = require('../../src/shared/helpers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notes-rem-'));

test('remindAt is set and cleared through update(), survives reload, and is listed and counted', () => {
  const dir = tmp();
  let store = new Store(dir).load();
  const a = store.create({ title: 'Dentist', body: '' });
  const b = store.create({ title: 'Taxes', body: '' });
  const c = store.create({ title: 'No reminder', body: '' });
  store.update(a.id, { remindAt: 2000 });
  store.update(b.id, { remindAt: 1000.6 });
  assert.equal(store.get(b.id).remindAt, 1001, 'rounded');
  store = new Store(dir).load();
  assert.deepEqual(store.list({ reminders: true }).map((n) => n.title), ['Taxes', 'Dentist'], 'soonest first regardless of sort');
  assert.equal(store.counts().reminders, 2);
  assert.equal(store.get(c.id).remindAt, null);
  // Junk is ignored; null clears; clearing also forgets that it rang.
  store.update(a.id, { remindAt: 'tomorrow' });
  assert.equal(store.get(a.id).remindAt, null);
  store.markReminded(b.id, 5000);
  assert.equal(store.get(b.id).remindedAt, 5000);
  store.update(b.id, { remindAt: 9000 });
  assert.equal(store.get(b.id).remindedAt, null, 'a new time rings again');
  // Trashed notes are not counted or listed.
  store.trash(b.id);
  assert.equal(store.counts().reminders, 0);
  assert.deepEqual(store.list({ reminders: true }), []);
});

test('the scheduler fires each reminder once, skips trashed notes, and re-fires when the time changes', () => {
  const store = new Store(tmp()).load();
  let now = 10000;
  const fired = [];
  const s = new ReminderScheduler(store, { now: () => now, notify: (n) => fired.push(n.title) });
  const a = store.create({ title: 'A', body: '' }); store.update(a.id, { remindAt: 10500 });
  const b = store.create({ title: 'B', body: '' }); store.update(b.id, { remindAt: 10100 });
  const t = store.create({ title: 'T', body: '' }); store.update(t.id, { remindAt: 10000 }); store.trash(t.id);
  assert.deepEqual(s.tick().map((n) => n.title), [], 'nothing due yet');
  now = 10200;
  assert.deepEqual(s.tick().map((n) => n.title), ['B']);
  assert.deepEqual(s.tick(), [], 'not twice');
  now = 11000;
  assert.deepEqual(s.tick().map((n) => n.title), ['A']);
  assert.deepEqual(fired, ['B', 'A']);
  assert.equal(store.get(b.id).remindedAt, 10200);
  // Moving the time forward rings again when it passes; moving it back does not ring immediately twice.
  store.update(b.id, { remindAt: 12000 });
  assert.deepEqual(s.tick(), []);
  now = 12001;
  assert.deepEqual(s.tick().map((n) => n.title), ['B']);
  // A notifier that throws still marks the note, so the reminder does not loop.
  const c = store.create({ title: 'C', body: '' }); store.update(c.id, { remindAt: 12000 });
  const s2 = new ReminderScheduler(store, { now: () => now, notify: () => { throw new Error('boom'); } });
  assert.deepEqual(s2.tick().map((n) => n.title), ['C']);
  assert.deepEqual(s2.tick(), []);
  // start() ticks immediately and the timer does not keep the process alive.
  const d = store.create({ title: 'D', body: '' }); store.update(d.id, { remindAt: 12000 });
  const s3 = new ReminderScheduler(store, { now: () => now, notify: (n) => fired.push(n.title), tickMs: 100000 });
  s3.start();
  assert.ok(fired.includes('D'));
  s3.stop();
});

test('formatWhen and mailtoFor', () => {
  const now = new Date(2026, 9, 14, 10, 0).getTime();
  assert.match(H.formatWhen(new Date(2026, 9, 14, 18, 30).getTime(), now), /^today /);
  assert.match(H.formatWhen(new Date(2026, 9, 15, 9, 0).getTime(), now), /^tomorrow /);
  assert.match(H.formatWhen(new Date(2026, 9, 13, 9, 0).getTime(), now), /^yesterday /);
  assert.doesNotMatch(H.formatWhen(new Date(2026, 9, 20, 9, 0).getTime(), now), /today|tomorrow|yesterday|2026/);
  assert.match(H.formatWhen(new Date(2027, 0, 2, 9, 0).getTime(), now), /2027/);
  const m = H.mailtoFor({ title: 'Plan & go', body: 'line 1\n**bold**' });
  assert.equal(m.truncated, false);
  assert.ok(m.url.startsWith('mailto:?subject=Plan%20%26%20go&body=line%201%0A**bold**'), m.url);
  const long = H.mailtoFor({ title: 'Long', body: 'x'.repeat(5000) });
  assert.equal(long.truncated, true);
  assert.ok(long.url.length < 2500, 'kept under what mail clients accept');
  assert.match(decodeURIComponent(long.url), /truncated/i);
});
