'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../src/window-input');

const key = (o) => Object.assign({ type: 'keyDown', control: true, meta: false, alt: false, shift: false }, o);

test('zoomAction: Ctrl+= zooms in (the key Electron\'s default menu missed), as do Ctrl+Plus and numpad +', () => {
  assert.equal(W.zoomAction(key({ key: '=', code: 'Equal' })), 'in');
  assert.equal(W.zoomAction(key({ key: '+', code: 'Equal', shift: true })), 'in');
  assert.equal(W.zoomAction(key({ key: '+', code: 'NumpadAdd' })), 'in');
  assert.equal(W.zoomAction(key({ key: '-', code: 'Minus' })), 'out');
  assert.equal(W.zoomAction(key({ key: '-', code: 'NumpadSubtract' })), 'out');
  assert.equal(W.zoomAction(key({ key: '0', code: 'Digit0' })), 'reset');
  assert.equal(W.zoomAction(key({ key: '0', code: 'Numpad0' })), 'reset');
  // Not zoom: no Ctrl, Alt held (AltGr layouts), key up, other keys, Ctrl+Shift+0.
  assert.equal(W.zoomAction(key({ key: '=', control: false })), null);
  assert.equal(W.zoomAction(key({ key: '=', alt: true })), null);
  assert.equal(W.zoomAction(key({ key: '=', type: 'keyUp' })), null);
  assert.equal(W.zoomAction(key({ key: 'n', code: 'KeyN' })), null);
  assert.equal(W.zoomAction(key({ key: ')', code: 'Digit0', shift: true })), null);
  assert.equal(W.zoomAction(null), null);
});

test('nextZoom steps by half a level, clamps, and resets', () => {
  assert.equal(W.nextZoom(0, 'in'), 0.5);
  assert.equal(W.nextZoom(0.5, 'out'), 0);
  assert.equal(W.nextZoom(W.ZOOM_MAX, 'in'), W.ZOOM_MAX);
  assert.equal(W.nextZoom(W.ZOOM_MIN, 'out'), W.ZOOM_MIN);
  assert.equal(W.nextZoom(3, 'reset'), 0);
  assert.equal(W.nextZoom(NaN, 'in'), 0.5);
});

test('contextMenuTemplate: editable text gets spelling, edit actions and zoom; links get open/copy; plain selection gets copy', () => {
  const edit = W.contextMenuTemplate({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'], editFlags: { canCut: true, canCopy: true, canPaste: true, canUndo: true, canRedo: false, canSelectAll: true } });
  const labels = edit.filter((i) => i.label).map((i) => i.label);
  assert.deepEqual(labels.slice(0, 3), ['the', 'ten', 'Add "teh" to dictionary']);
  assert.ok(labels.includes('Cut') && labels.includes('Copy') && labels.includes('Paste') && labels.includes('Select all'));
  // The rich editor (contenteditable) sends undo/redo to the page; a textarea uses the native roles.
  assert.equal(edit.find((i) => i.label === 'Undo').action, 'editUndo');
  const ta = W.contextMenuTemplate({ isEditable: true, formControlType: 'text-area', editFlags: { canUndo: true, canRedo: false } });
  assert.equal(ta.find((i) => i.label === 'Undo').role, 'undo');
  assert.equal(ta.find((i) => i.label === 'Redo').enabled, false);
  assert.equal(edit.find((i) => i.label === 'the').action, 'replaceMisspelling');
  assert.ok(labels.includes('Zoom in') && labels.includes('Zoom out') && labels.includes('Actual size'));
  // No suggestions: a disabled line, still "Add to dictionary".
  const none = W.contextMenuTemplate({ isEditable: true, misspelledWord: 'qzx', dictionarySuggestions: [] });
  assert.equal(none[0].enabled, false);
  // Links: http opens in the browser; other schemes are copy-only.
  const web = W.contextMenuTemplate({ linkURL: 'https://example.com' });
  assert.equal(web[0].action, 'openLink');
  const noteLink = W.contextMenuTemplate({ linkURL: 'note://abc' });
  assert.ok(!noteLink.some((i) => i.action === 'openLink'));
  assert.equal(noteLink[0].action, 'copyText');
  // Selected text outside an editor: Copy.
  const sel = W.contextMenuTemplate({ selectionText: 'hello' });
  assert.equal(sel[0].role, 'copy');
  // Nothing selected, not editable: zoom only, no leading separator.
  const bare = W.contextMenuTemplate({});
  assert.equal(bare[0].label, 'Zoom in');
  // Never two separators in a row.
  for (const t of [edit, none, web, noteLink, sel, bare]) for (let i = 1; i < t.length; i++) assert.ok(!(t[i].type === 'separator' && t[i - 1].type === 'separator'));
});
