'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildRenderer, bundlePath, ENTRIES, RENDERER } = require('../../scripts/build-renderer');

const fresh = buildRenderer({ write: false });
const freshText = (name) => {
  const file = fresh.outputFiles.find((f) => path.resolve(f.path) === path.resolve(bundlePath(name)));
  assert.ok(file, 'esbuild produced ' + name);
  return file.text;
};
const readsGlobal = (text, name) => new RegExp('window\\.' + name + '\\b(?! = )').test(text);
const scriptsOf = (page) => [...fs.readFileSync(path.join(RENDERER, page), 'utf8').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);

for (const name of ENTRIES) {
  test(`the tracked ${name}.bundle.js matches a fresh build (else run npm run build:app)`, () => {
    assert.equal(fs.readFileSync(bundlePath(name), 'utf8'), freshText(name));
  });
}

test('the app bundle reads nothing it bundles from window, and only the vendor globals and the bridge', () => {
  const app = freshText('app');
  for (const g of ['NotesHelpers', 'NotesThemes', 'NotesIcons', 'NotesPalette', 'NotesPdfEditor', 'NotesPdfPages', 'NotesPdfComments', 'NotesDocxEditor', 'NotesCraftFrame', 'NotesCsv', 'NotesSignPad']) {
    assert.ok(!readsGlobal(app, g), g + ' is still read from window');
  }
  for (const g of ['window.NotesEditor', 'window.NotesCode', 'window.PdfView', 'window.DocxView', 'window.notesApi']) {
    assert.ok(app.includes(g), g + ' is read from window');
  }
});

test('the sticky bundle carries helpers and icons and still reads the editor from window', () => {
  const sticky = freshText('sticky');
  assert.ok(!readsGlobal(sticky, 'NotesHelpers') && !readsGlobal(sticky, 'NotesIcons'));
  assert.ok(sticky.includes('window.NotesEditor') && sticky.includes('window.notesApi'));
  assert.ok(sticky.includes('function hydrate(') && sticky.includes('PANE_LIMITS'));
});

test('each page loads its vendor bundles and then one page bundle, no loose scripts', () => {
  assert.deepEqual(scriptsOf('index.html'), ['vendor/editor.bundle.js', 'vendor/docx.bundle.js', 'vendor/pdf.bundle.js', 'vendor/code.bundle.js', 'vendor/app.bundle.js']);
  assert.deepEqual(scriptsOf('sticky.html'), ['vendor/editor.bundle.js', 'vendor/sticky.bundle.js']);
});

test('no renderer source assigns a Notes global on window', () => {
  for (const f of fs.readdirSync(RENDERER).filter((f) => f.endsWith('.js') && f !== 'icons.js')) {
    assert.ok(!/^\s*window\.Notes\w+ = /m.test(fs.readFileSync(path.join(RENDERER, f), 'utf8')), f + ' assigns a window global');
  }
});

test('icons.js keeps its CommonJS export for the bundle and for make-icons', () => {
  const icons = require('../../src/renderer/icons');
  assert.equal(typeof icons.svg, 'function');
  assert.ok(icons.names.length > 0);
});

test('a build is deterministic, so the freshness check cannot flap', () => {
  const again = buildRenderer({ write: false });
  for (const name of ENTRIES) {
    assert.equal(again.outputFiles.find((f) => path.resolve(f.path) === path.resolve(bundlePath(name))).text, freshText(name));
  }
});
