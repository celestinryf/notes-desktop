'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { VersionClock, DEFAULT_TIMING, uniformTiming } = require('../../src/version-timing.mts');

const T = { quietMs: 450, maxWaitMs: 6000 };

test('every change restarts the full quiet, whatever was typed', () => {
  const clock = new VersionClock(T);
  assert.equal(clock.changed(1000), T.quietMs);
  assert.equal(clock.changed(1001), T.quietMs);
  assert.equal(clock.changed(1400), T.quietMs);
  assert.equal(clock.changed(1849), T.quietMs);
});

test('pending changes never wait longer than the cap, and a commit resets it', () => {
  const clock = new VersionClock(T);
  assert.equal(clock.changed(0), T.quietMs);
  assert.equal(clock.changed(5549), T.quietMs);
  assert.equal(clock.changed(5800), 200);
  assert.equal(clock.changed(6000), 0);
  assert.equal(clock.changed(7000), 0);
  clock.committed();
  assert.equal(clock.pendingSince, null);
  assert.equal(clock.changed(7001), T.quietMs);
});

test('committing with nothing pending is harmless', () => {
  const clock = new VersionClock(T);
  clock.committed();
  assert.equal(clock.changed(50), T.quietMs);
});

test('a person typing with pauses shorter than the quiet gets one version per sitting', () => {
  const clock = new VersionClock(DEFAULT_TIMING);
  let now = 0, due = null, versions = 0;
  const type = (gapMs) => {
    now += gapMs;
    if (due !== null && due <= now) { versions++; clock.committed(); }
    due = now + clock.changed(now);
  };
  for (let i = 0; i < 400; i++) type(i % 12 === 0 ? 4000 : 250);
  type(20 * 60 * 1000);
  for (let i = 0; i < 100; i++) type(900);
  assert.equal(versions, 1);
});

test('the defaults keep versions minutes apart, and a uniform timing sets both delays', () => {
  assert.equal(DEFAULT_TIMING.quietMs, 5 * 60 * 1000);
  assert.equal(DEFAULT_TIMING.maxWaitMs, 30 * 60 * 1000);
  assert.deepEqual(uniformTiming(10), { quietMs: 10, maxWaitMs: 200 });
});
