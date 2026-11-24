'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

let createHints, HINT_MS;
test.before(async () => { ({ createHints, HINT_MS } = await import('../../src/renderer/hints.ts')); });

function harness(seen) {
  const calls = { shown: [], hidden: 0, remembered: [] };
  let ids = seen;
  const hints = createHints({
    shown: () => ids,
    remember: (next) => { ids = next; calls.remembered.push(next); },
    show: (m) => calls.shown.push(m),
    hide: () => { calls.hidden++; },
  });
  return { hints, calls, ids: () => ids };
}

test('a tip shows once, is remembered, and goes away after five seconds', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { hints, calls, ids } = harness([]);
  assert.equal(HINT_MS, 5000);
  assert.equal(hints.hint('a', 'First tip'), true);
  assert.deepEqual(calls.shown, ['First tip']);
  assert.deepEqual(ids(), ['a']);
  assert.equal(hints.hint('a', 'First tip'), false, 'not twice');
  assert.deepEqual(calls.shown, ['First tip']);
  t.mock.timers.tick(4999);
  assert.equal(calls.hidden, 0);
  t.mock.timers.tick(1);
  assert.equal(calls.hidden, 1);
});

test('a second tip replaces the first and restarts the clock; a click dismisses at once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { hints, calls, ids } = harness(['old']);
  hints.hint('a', 'A');
  t.mock.timers.tick(3000);
  hints.hint('b', 'B');
  t.mock.timers.tick(3000);
  assert.equal(calls.hidden, 0, 'the second tip reset the clock');
  t.mock.timers.tick(2000);
  assert.equal(calls.hidden, 1);
  assert.deepEqual(ids(), ['old', 'a', 'b']);
  hints.hint('c', 'C');
  hints.dismiss();
  assert.equal(calls.hidden, 2);
  t.mock.timers.tick(6000);
  assert.equal(calls.hidden, 2, 'no second hide after a dismiss');
});

test('a tip is not shown twice while its remembering is still on its way, and a later tip remembers the earlier one too', () => {
  const shown = [];
  const remembered = [];
  const hints = createHints({ shown: () => ['old'], remember: (ids) => remembered.push(ids), show: (m) => shown.push(m), hide: () => {} });
  assert.equal(hints.hint('a', 'A'), true);
  assert.equal(hints.hint('a', 'A again'), false);
  assert.equal(hints.hint('b', 'B'), true);
  assert.deepEqual(shown, ['A', 'B']);
  assert.deepEqual(remembered, [['old', 'a'], ['old', 'a', 'b']], 'the stale list from the settings does not drop what this session showed');
  hints.forget();
  assert.equal(hints.hint('a', 'A'), true);
});

test('a tip waits while something covers the screen, and is not remembered until it shows', () => {
  let covered = true;
  const remembered = [];
  const hints = createHints({ shown: () => [], remember: (ids) => remembered.push(ids), show: () => {}, hide: () => {}, canShow: () => !covered });
  assert.equal(hints.hint('a', 'A'), false);
  assert.deepEqual(remembered, []);
  covered = false;
  assert.equal(hints.hint('a', 'A'), true);
  assert.deepEqual(remembered, [['a']]);
});

test('no settings yet means no tip; forgetting clears the list', () => {
  const { hints, calls, ids } = harness(null);
  assert.equal(hints.hint('a', 'A'), false);
  assert.deepEqual(calls.shown, []);
  const again = harness(['a', 'b']);
  again.hints.forget();
  assert.deepEqual(again.ids(), []);
  assert.equal(again.hints.hint('a', 'A'), true);
  assert.deepEqual(ids(), null);
});

test('every tip has one id, and ALL_HINTS lists each of them', async () => {
  const { HINT, ALL_HINTS } = await import('../../src/renderer/hints.ts');
  assert.deepEqual([...ALL_HINTS].sort(), Object.values(HINT).sort());
  assert.equal(new Set(ALL_HINTS).size, ALL_HINTS.length);
});

test('the page names tips only through HINT, so ALL_HINTS cannot miss one', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'src', 'renderer', 'app.ts'), 'utf8');
  const calls = src.match(/hints\.hint\([^,]+,/g) || [];
  assert.ok(calls.length >= 3, calls.join(' '));
  for (const c of calls) assert.match(c, /^hints\.hint\(HINT\.\w+,$/);
});

test('seen: a tip counts as seen once stored or shown this session, not after forgetting, and always while settings are missing', () => {
  const { hints } = harness(['stored']);
  assert.equal(hints.seen('stored'), true);
  assert.equal(hints.seen('a'), false);
  hints.hint('a', 'A');
  assert.equal(hints.seen('a'), true);
  hints.forget();
  assert.equal(hints.seen('a'), false);
  assert.equal(hints.seen('stored'), false);
  assert.equal(harness(null).hints.seen('a'), true);
});

test('seen: a tip shown while its remembering is on its way is already seen', () => {
  const hints = createHints({ shown: () => [], remember: () => {}, show: () => {}, hide: () => {} });
  hints.hint('a', 'A');
  assert.equal(hints.seen('a'), true);
  assert.equal(hints.seen('b'), false);
});

test('the first-run tip is not scheduled when it was already seen, so a later "Show the tips again" cannot bring it back on its own', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'src', 'renderer', 'app.ts'), 'utf8');
  assert.match(src, /function firstTip\(\) \{\s*if \(hints\.seen\(HINT\.palette\)\) return;/);
});
