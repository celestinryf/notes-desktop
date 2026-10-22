'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../../src/store.mts');
const { ReminderScheduler } = require('../../src/reminders.mts');
const H = require('../../src/shared/helpers.mts');

const { tmpDir } = require('../helpers/tmp');
const tmp = () => tmpDir('notes-rem-'); // removed when the test process exits

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
  assert.ok(long.url.length <= 1900, 'kept under what mail clients accept: ' + long.url.length);
  assert.match(decodeURIComponent(long.url), /truncated/i);
  // The cap is on the encoded URL: newlines and non-ASCII expand when encoded.
  const cjk = H.mailtoFor({ title: 'CJK', body: '日本語の文章\n'.repeat(400) });
  assert.ok(cjk.url.length <= 1900, 'encoded length capped: ' + cjk.url.length);
  assert.doesNotThrow(() => decodeURIComponent(cjk.url));
  // A derived title (first line) with an emoji at the 60-character cut, and a very long explicit title.
  assert.doesNotThrow(() => H.mailtoFor({ title: '', body: 'a'.repeat(58) + '😀' + 'b'.repeat(20) }));
  assert.equal(H.truncate('a'.repeat(58) + '😀' + 'b'.repeat(20), 60), 'a'.repeat(58) + '😀' + '…');
  const longTitle = H.mailtoFor({ title: '長い題名'.repeat(300), body: 'x'.repeat(3000) });
  assert.ok(longTitle.url.length <= 1900, 'long title still capped: ' + longTitle.url.length);
  assert.ok(decodeURIComponent(longTitle.url).includes('Truncated'), 'body cut with notice');
  // Never cut through an emoji (a surrogate pair), which would make encodeURIComponent throw.
  for (let n = 1700; n < 1760; n++) {
    const body = 'a'.repeat(n) + '😀'.repeat(300);
    let m;
    assert.doesNotThrow(() => { m = H.mailtoFor({ title: 'E', body }); }, 'n=' + n);
    const decoded = decodeURIComponent(m.url);
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    assert.ok(decoded.indexOf('�') === -1 && !loneSurrogate.test(decoded), 'no lone surrogate at n=' + n);
    assert.ok(m.url.length <= 1900, 'capped at n=' + n);
  }
});
