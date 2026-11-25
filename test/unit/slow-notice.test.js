'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

let noticeIfSlow, oneAtATime, SLOW_NOTICE_MS;
test.before(async () => { ({ noticeIfSlow, oneAtATime, SLOW_NOTICE_MS } = await import('../../src/renderer/slow-notice.ts')); });

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('no notice when the work ends in time', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const work = deferred();
  let notices = 0;
  const out = noticeIfSlow(work.promise, () => notices++);
  t.mock.timers.tick(SLOW_NOTICE_MS - 1);
  work.resolve('done');
  assert.equal(await out, 'done');
  t.mock.timers.tick(10000);
  assert.equal(notices, 0);
});

test('one notice once the work runs long, and the result still comes through', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const work = deferred();
  let notices = 0;
  const out = noticeIfSlow(work.promise, () => notices++);
  t.mock.timers.tick(SLOW_NOTICE_MS);
  assert.equal(notices, 1);
  t.mock.timers.tick(10000);
  assert.equal(notices, 1, 'not repeated');
  work.resolve(7);
  assert.equal(await out, 7);
});

test('a failure passes through and cancels the notice', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const work = deferred();
  let notices = 0;
  const out = noticeIfSlow(work.promise, () => notices++, 50);
  work.reject(new Error('git broke'));
  await assert.rejects(out, /git broke/);
  t.mock.timers.tick(1000);
  assert.equal(notices, 0);
});

test('a second call while the first runs joins it instead of starting another', async () => {
  const gate = deferred();
  let runs = 0;
  const save = oneAtATime(async () => { runs++; await gate.promise; });
  const a = save();
  const b = save();
  assert.equal(a, b);
  assert.equal(runs, 1);
  gate.resolve();
  await a;
  await save();
  assert.equal(runs, 2, 'a call after the first ended runs again');
});

test('a failed run does not block the next one', async () => {
  let runs = 0;
  const save = oneAtATime(async () => { runs++; if (runs === 1) throw new Error('first fails'); });
  await assert.rejects(save(), /first fails/);
  await save();
  assert.equal(runs, 2);
});
