'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const RENDERER = path.join(__dirname, '..', '..', 'src', 'renderer');
const SCRIPT_GLOBALS = new Set(['app.js', 'sticky.js', 'icons.js']);
const UNDEFINED_NAME_CODES = new Set([2304, 2552, 2448, 2451, 2454]);

test('every extracted renderer module names only what it imports or receives', () => {
  const files = fs.readdirSync(RENDERER).filter((f) => f.endsWith('.js') && !SCRIPT_GLOBALS.has(f)).map((f) => path.join(RENDERER, f));
  assert.ok(files.length > 10, 'the renderer modules were found');
  const program = ts.createProgram(files, {
    allowJs: true, checkJs: true, noEmit: true, strict: false, noImplicitAny: false, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  });
  const bad = ts.getPreEmitDiagnostics(program)
    .filter((d) => UNDEFINED_NAME_CODES.has(d.code) && d.file)
    .map((d) => {
      const { line } = d.file.getLineAndCharacterOfPosition(d.start);
      return path.basename(d.file.fileName) + ':' + (line + 1) + ' ' + ts.flattenDiagnosticMessageText(d.messageText, ' ');
    });
  assert.deepEqual(bad, []);
});
