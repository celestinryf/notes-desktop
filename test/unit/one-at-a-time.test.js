'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

let oneAtATime;
test.before(async () => { ({ oneAtATime } = await import('../../src/renderer/one-at-a-time.js')); });

const later = (ms, value) => new Promise((r) => setTimeout(() => r(value), ms));

test('calls run one at a time, in order, each waiting for the one before', async () => {
  const log = [];
  const run = oneAtATime(async (opts) => { log.push('start ' + opts.n); await later(opts.ms); log.push('end ' + opts.n); return opts.n; });
  const results = await Promise.all([run({ n: 1, ms: 30 }), run({ n: 2, ms: 5 }), run({ n: 3, ms: 1 })]);
  assert.deepEqual(results, [1, 2, 3]);
  assert.deepEqual(log, ['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
});

test('a call with no options gets an empty object', async () => {
  const run = oneAtATime(async (opts) => opts);
  assert.deepEqual(await run(), {});
});

test('a rejection reaches its caller and does not stop the calls after it', async () => {
  const run = oneAtATime(async (opts) => { if (opts.fail) throw new Error('disk full'); return 'ok ' + opts.n; });
  const first = run({ n: 1 });
  const second = run({ fail: true });
  const third = run({ n: 3 });
  assert.equal(await first, 'ok 1');
  await assert.rejects(second, /disk full/);
  assert.equal(await third, 'ok 3');
});

test('a plain return value is passed through', async () => {
  const run = oneAtATime((opts) => opts.n * 2);
  assert.equal(await run({ n: 21 }), 42);
});
