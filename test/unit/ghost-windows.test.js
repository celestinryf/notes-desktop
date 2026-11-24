'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ghost, ghostEveryWindow, GHOST_SWITCHES } = require('../../src/ghost-windows.mts');

class FakeWindow {
  constructor() { this.calls = []; }
  setOpacity(v) { this.calls.push(['opacity', v]); }
  setIgnoreMouseEvents(v) { this.calls.push(['ignoreMouse', v]); }
  setSkipTaskbar(v) { this.calls.push(['skipTaskbar', v]); }
}

class FakeApp extends EventEmitter {
  constructor() { super(); this.switches = []; this.commandLine = { appendSwitch: (name, value) => this.switches.push([name, value]) }; }
}

test('a ghost window is see-through, lets clicks fall through to what is under it and stays off the taskbar', () => {
  const w = new FakeWindow();
  ghost(w);
  assert.deepEqual(w.calls, [['opacity', 0], ['ignoreMouse', true], ['skipTaskbar', true]]);
});

test('every window the app opens afterwards becomes a ghost, not only the first', () => {
  const app = new FakeApp();
  ghostEveryWindow(app);
  const main = new FakeWindow();
  const sticky = new FakeWindow();
  app.emit('browser-window-created', {}, main);
  app.emit('browser-window-created', {}, sticky);
  assert.equal(main.calls.length, 3);
  assert.equal(sticky.calls.length, 3);
});

test('windows Windows thinks are hidden keep painting, so the tests still see real layout', () => {
  const app = new FakeApp();
  ghostEveryWindow(app);
  assert.deepEqual(app.switches, GHOST_SWITCHES);
  assert.deepEqual(GHOST_SWITCHES, [['disable-features', 'CalculateNativeWinOcclusion']]);
});

test('windows opened before ghosting starts are left as they are', () => {
  const app = new FakeApp();
  const early = new FakeWindow();
  app.emit('browser-window-created', {}, early);
  ghostEveryWindow(app);
  assert.deepEqual(early.calls, []);
});
