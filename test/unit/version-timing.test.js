'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { VersionClock, DEFAULT_TIMING, editEndsAtBoundary, uniformTiming } = require('../../src/version-timing.mts');

const T = { quietMs: 450, boundaryQuietMs: 80, attentionMs: 10, attentionWindowMs: 30, maxWaitMs: 6000 };

test('an edit ends at a boundary after a sentence, a paragraph or a line, and not mid-sentence or mid-word', () => {
  assert.equal(editEndsAtBoundary('Hello', 'Hello world.'), true);
  assert.equal(editEndsAtBoundary('Hello', 'Hello world. '), true);
  assert.equal(editEndsAtBoundary('Hello', 'Hello world!'), true);
  assert.equal(editEndsAtBoundary('Hello', 'Hello world?"'), true);
  assert.equal(editEndsAtBoundary('Hello', 'Hello world\n'), true);
  assert.equal(editEndsAtBoundary('Hello', 'Hello world\n\n'), true);
  assert.equal(editEndsAtBoundary('Hello', 'Hello wor'), false);
  assert.equal(editEndsAtBoundary('Hello', 'Hello world,'), false);
  assert.equal(editEndsAtBoundary('Hello', 'Hello world'), false);
});

test('an edit in the middle of the text is judged by the inserted text, not by the end of the note', () => {
  assert.equal(editEndsAtBoundary('One. Three.', 'One. Two. Three.'), true);
  assert.equal(editEndsAtBoundary('One. Three.', 'One. Tw Three.'), false);
  assert.equal(editEndsAtBoundary('# Title\n\nBody.', '# Title\n\nNew line\nBody.'), true);
});

test('a deletion is judged by the text left before it', () => {
  assert.equal(editEndsAtBoundary('One. Two. Three.', 'One. Three.'), true);
  assert.equal(editEndsAtBoundary('One. Two. Three.', 'One. Tw Three.'), false);
  assert.equal(editEndsAtBoundary('Hello world', 'Hello wor'), false);
  assert.equal(editEndsAtBoundary('Hello world.', 'Hello world'), false);
  assert.equal(editEndsAtBoundary('Anything at all', ''), true);
  assert.equal(editEndsAtBoundary('Anything', '   '), true);
});

test('a space after a word is not a boundary, but a space after a full stop is', () => {
  assert.equal(editEndsAtBoundary('Hello', 'Hello '), false);
  assert.equal(editEndsAtBoundary('One.', 'One. '), true);
  assert.equal(editEndsAtBoundary('One. Two', 'One.  Two'), true);
  assert.equal(editEndsAtBoundary('One Two', 'One  Two'), false);
});

test('a long run of one character is judged in bounded time', () => {
  const run = 'a'.repeat(200000);
  const started = Date.now();
  assert.equal(editEndsAtBoundary(run, run + 'a'), false);
  assert.equal(editEndsAtBoundary('x. ' + run, 'x. ' + run + 'a'), false);
  assert.ok(Date.now() - started < 500);
});

test('with no earlier text known, the end of the note decides', () => {
  assert.equal(editEndsAtBoundary(null, 'Done.'), true);
  assert.equal(editEndsAtBoundary(null, 'Not don'), false);
});

test('the clock waits the short quiet after a boundary and the long quiet otherwise, remembering each note', () => {
  const clock = new VersionClock(T);
  assert.equal(clock.changed([{ id: 'a', body: 'Writing a sente' }], 1000), T.quietMs);
  assert.equal(clock.changed([{ id: 'a', body: 'Writing a sentence.' }], 1100), T.boundaryQuietMs);
  assert.equal(clock.changed([{ id: 'a', body: 'Writing a sentence. And mo' }], 1200), T.quietMs);
  assert.equal(clock.changed([{ id: 'b', body: 'Other note, fresh.' }], 1300), T.boundaryQuietMs);
  assert.equal(clock.changed([{ id: 'b', body: 'Other note, fresh. Then' }], 1400), T.quietMs);
});

test('a change with no notes named counts as a finished task', () => {
  const clock = new VersionClock(T);
  assert.equal(clock.changed(undefined, 0), T.boundaryQuietMs);
  assert.equal(clock.changed([], 0), T.boundaryQuietMs);
});

test('attention lost commits soon, including the save that lands just after the window blurred', () => {
  const clock = new VersionClock(T);
  assert.equal(clock.attentionLost(0), null);
  assert.equal(clock.changed([{ id: 'a', body: 'mid-sent' }], 1000), T.quietMs);
  assert.equal(clock.attentionLost(1500), T.attentionMs);
  assert.equal(clock.changed([{ id: 'a', body: 'mid-sentence stil' }], 1520), T.attentionMs);
  assert.equal(clock.changed([{ id: 'a', body: 'mid-sentence still goin' }], 1600), T.quietMs);
  clock.attentionLost(2000);
  clock.attentionBack();
  assert.equal(clock.changed([{ id: 'a', body: 'mid-sentence still going o' }], 2010), T.quietMs);
});

test('settling (a note switch) commits soon without arming the attention window', () => {
  const clock = new VersionClock(T);
  assert.equal(clock.settle(0), null);
  clock.changed([{ id: 'a', body: 'mid-sent' }], 1000);
  assert.equal(clock.settle(1001), T.attentionMs);
  assert.equal(clock.changed([{ id: 'a', body: 'mid-sente' }], 1005), T.quietMs);
});

test('pending changes never wait longer than the cap, and a commit resets it', () => {
  const clock = new VersionClock(T);
  assert.equal(clock.changed([{ id: 'a', body: 'x' }], 0), T.quietMs);
  assert.equal(clock.changed([{ id: 'a', body: 'xy' }], 5800), 200);
  assert.equal(clock.changed([{ id: 'a', body: 'xyz' }], 7000), 0);
  clock.committed();
  assert.equal(clock.changed([{ id: 'a', body: 'xyzw' }], 7001), T.quietMs);
});

test('the memory of seen notes is bounded', () => {
  const clock = new VersionClock(T);
  for (let i = 0; i < 600; i++) clock.changed([{ id: 'n' + i, body: 'text ' + i }], i);
  assert.equal(clock.seen.size, 500);
  assert.equal(clock.seen.has('n0'), false);
  assert.equal(clock.seen.has('n599'), true);
});

test('the defaults are long enough to skip a thinking pause, and a uniform timing sets every delay', () => {
  assert.equal(DEFAULT_TIMING.quietMs, 120000);
  assert.equal(DEFAULT_TIMING.boundaryQuietMs, 30000);
  assert.equal(DEFAULT_TIMING.maxWaitMs, 600000);
  assert.ok(DEFAULT_TIMING.attentionMs <= 2000);
  assert.deepEqual(uniformTiming(10), { quietMs: 10, boundaryQuietMs: 10, attentionMs: 10, attentionWindowMs: 10, maxWaitMs: 200 });
});
