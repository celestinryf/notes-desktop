'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ts = require('typescript');

const CONFIG = path.join(__dirname, '..', '..', 'tsconfig.renderer.json');
const UNDEFINED_NAME_CODES = new Set([2304, 2552, 2448, 2451, 2454]);

test('every renderer module names only what it imports or receives, checked or not', () => {
  const cfg = ts.getParsedCommandLineOfConfigFile(CONFIG, { checkJs: true }, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, ' ')); },
  });
  assert.ok(cfg && cfg.fileNames.some((f) => /[\\/]renderer[\\/]app\.js$/.test(f)), 'the renderer config lists app.js');
  const program = ts.createProgram(cfg.fileNames, cfg.options);
  const bad = ts.getPreEmitDiagnostics(program)
    .filter((d) => UNDEFINED_NAME_CODES.has(d.code) && d.file && /[\\/]src[\\/]renderer[\\/]/.test(d.file.fileName))
    .map((d) => {
      const { line } = d.file.getLineAndCharacterOfPosition(d.start);
      return path.basename(d.file.fileName) + ':' + (line + 1) + ' ' + ts.flattenDiagnosticMessageText(d.messageText, ' ');
    });
  assert.deepEqual(bad, []);
});
