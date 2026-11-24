'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

let pullFocusFromPeer;
test.before(async () => { ({ pullFocusFromPeer } = await import('../../src/renderer/side-focus.ts')); });

const fakeWindow = (hasFocus) => {
  const w = { focused: 0, focus() { w.focused++; }, document: { hasFocus: () => hasFocus } };
  return w;
};

test('focus moves back from the right side while the window is the active one', () => {
  const w = fakeWindow(true);
  pullFocusFromPeer(w);
  assert.equal(w.focused, 1);
});

test('an inactive window is never brought to the front to take focus from the right side', () => {
  const w = fakeWindow(false);
  pullFocusFromPeer(w);
  assert.equal(w.focused, 0);
});

test('app.ts moves focus between sides only through pullFocusFromPeer', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'src', 'renderer', 'app.ts'), 'utf8');
  assert.doesNotMatch(src, /window\.focus\(\)/);
  assert.match(src, /pullFocusFromPeer\(window\)/);
});
