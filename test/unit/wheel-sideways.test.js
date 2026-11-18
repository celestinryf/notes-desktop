'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

let sidewaysWheelDistance, wheelScrollsSideways, WHEEL_LINE_PX;
test.before(async () => { ({ sidewaysWheelDistance, wheelScrollsSideways, WHEEL_LINE_PX } = await import('../../src/renderer/wheel-sideways.ts')); });

const PIXELS = 0;
const LINES = 1;
const PAGES = 2;

test('a vertical pixel wheel turns into the same sideways distance, both ways', () => {
  assert.equal(sidewaysWheelDistance({ deltaX: 0, deltaY: 100, deltaMode: PIXELS }, 500), 100);
  assert.equal(sidewaysWheelDistance({ deltaX: 0, deltaY: -53.5, deltaMode: PIXELS }, 500), -53.5);
});

test('a line wheel moves a line height per line and a page wheel the strip width per page', () => {
  assert.equal(sidewaysWheelDistance({ deltaX: 0, deltaY: 3, deltaMode: LINES }, 500), 3 * WHEEL_LINE_PX);
  assert.equal(sidewaysWheelDistance({ deltaX: 0, deltaY: -1, deltaMode: PAGES }, 480), -480);
});

test('a wheel that is already sideways, or no wheel at all, is left to the browser', () => {
  assert.equal(sidewaysWheelDistance({ deltaX: 120, deltaY: 0, deltaMode: PIXELS }, 500), 0);
  assert.equal(sidewaysWheelDistance({ deltaX: -40, deltaY: 30, deltaMode: PIXELS }, 500), 0);
  assert.equal(sidewaysWheelDistance({ deltaX: 50, deltaY: -50, deltaMode: PIXELS }, 500), 0);
  assert.equal(sidewaysWheelDistance({ deltaX: 0, deltaY: 0, deltaMode: PIXELS }, 500), 0);
});

test('a mostly vertical trackpad swipe with a little drift still scrolls sideways', () => {
  assert.equal(sidewaysWheelDistance({ deltaX: 4, deltaY: 60, deltaMode: PIXELS }, 500), 60);
});

class FakeStrip extends EventTarget {
  constructor(scrollWidth, clientWidth) { super(); this.scrollWidth = scrollWidth; this.clientWidth = clientWidth; this.scrollLeft = 0; }
}
const wheel = (init) => Object.assign(new Event('wheel', { cancelable: true }), { deltaX: 0, deltaY: 0, deltaMode: PIXELS, ctrlKey: false }, init);

test('the wheel scrolls an overflowing strip sideways and takes the event from the page', () => {
  const strip = new FakeStrip(1200, 400);
  wheelScrollsSideways(strip);
  const down = wheel({ deltaY: 100 });
  strip.dispatchEvent(down);
  assert.equal(strip.scrollLeft, 100);
  assert.equal(down.defaultPrevented, true);
  strip.dispatchEvent(wheel({ deltaY: -30 }));
  assert.equal(strip.scrollLeft, 70);
});

test('a strip that fits is left alone, so the wheel does nothing odd there', () => {
  const strip = new FakeStrip(400, 400);
  wheelScrollsSideways(strip);
  const e = wheel({ deltaY: 100 });
  strip.dispatchEvent(e);
  assert.equal(strip.scrollLeft, 0);
  assert.equal(e.defaultPrevented, false);
});

test('Ctrl+wheel stays a zoom and a sideways wheel keeps its native scroll', () => {
  const strip = new FakeStrip(1200, 400);
  wheelScrollsSideways(strip);
  const zoom = wheel({ deltaY: 100, ctrlKey: true });
  const sideways = wheel({ deltaX: 80 });
  strip.dispatchEvent(zoom);
  strip.dispatchEvent(sideways);
  assert.equal(strip.scrollLeft, 0);
  assert.equal(zoom.defaultPrevented, false);
  assert.equal(sideways.defaultPrevented, false);
});

test('the listener is registered as non-passive so it can stop the page scrolling', () => {
  const calls = [];
  const strip = { scrollWidth: 1200, clientWidth: 400, scrollLeft: 0, addEventListener: (type, fn, opts) => calls.push({ type, opts }) };
  wheelScrollsSideways(strip);
  assert.deepEqual(calls, [{ type: 'wheel', opts: { passive: false } }]);
});
