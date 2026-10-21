'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { quickPick, toLocalInputValue } = require('../../src/renderer/remind-times.ts');

const local = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms);
const enabled = new WeakSet();
const at = (t, when) => {
  if (enabled.has(t)) t.mock.timers.setTime(when.getTime());
  else { t.mock.timers.enable({ apis: ['Date'], now: when.getTime() }); enabled.add(t); }
};

test('toLocalInputValue formats a timestamp for a datetime-local input, zero-padded', () => {
  assert.equal(toLocalInputValue(local(2026, 3, 7, 9, 5).getTime()), '2026-03-07T09:05');
  assert.equal(toLocalInputValue(local(2026, 12, 31, 23, 59).getTime()), '2026-12-31T23:59');
});

test('quickPick 1h is one hour on, with seconds dropped', (t) => {
  at(t, local(2026, 10, 20, 14, 37, 42, 500));
  assert.equal(quickPick('1h'), local(2026, 10, 20, 15, 37).getTime());
});

test('quickPick evening is 18:00 today before six, tomorrow from six on', (t) => {
  at(t, local(2026, 10, 20, 11, 0));
  assert.equal(quickPick('evening'), local(2026, 10, 20, 18, 0).getTime());
  at(t, local(2026, 10, 20, 18, 0));
  assert.equal(quickPick('evening'), local(2026, 10, 21, 18, 0).getTime());
  at(t, local(2026, 10, 20, 23, 30));
  assert.equal(quickPick('evening'), local(2026, 10, 21, 18, 0).getTime());
});

test('quickPick tomorrow is 09:00 the next day, across a month end', (t) => {
  at(t, local(2026, 10, 31, 22, 0));
  assert.equal(quickPick('tomorrow'), local(2026, 11, 1, 9, 0).getTime());
});

test('quickPick monday is 09:00 next Monday, never today', (t) => {
  at(t, local(2026, 10, 20, 10, 0));
  assert.equal(new Date(quickPick('monday')).getDay(), 1);
  assert.equal(quickPick('monday'), local(2026, 10, 26, 9, 0).getTime());
  at(t, local(2026, 10, 26, 8, 0));
  assert.equal(quickPick('monday'), local(2026, 11, 2, 9, 0).getTime());
  at(t, local(2026, 10, 25, 8, 0));
  assert.equal(quickPick('monday'), local(2026, 10, 26, 9, 0).getTime());
});

test('quickPick returns null for an unknown kind', () => {
  assert.equal(quickPick('never'), null);
  assert.equal(quickPick(''), null);
  assert.equal(quickPick(undefined), null);
});
