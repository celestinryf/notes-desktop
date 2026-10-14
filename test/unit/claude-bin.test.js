'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CB = require('../../src/claude-bin');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notes-cb-'));
const win = process.platform === 'win32';

test('an npm .cmd shim is resolved to the executable it runs, never run through a shell', { skip: !win && 'windows shim' }, () => {
  const bin = tmp();
  const exe = path.join(bin, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, 'MZ');
  fs.writeFileSync(path.join(bin, 'claude.cmd'), '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nexec node "$basedir/node_modules/@anthropic-ai/claude-code/cli.js" "$@"\n');
  const spec = CB.resolveClaude({ pathDirs: [tmp(), bin], home: tmp() });
  assert.deepEqual(spec, { file: exe, isScript: false });
  const launch = CB.launchSpec(spec, ['-p', 'hello\n& calc %PATH%']);
  assert.equal(launch.file, exe);
  assert.deepEqual(launch.args, ['-p', 'hello\n& calc %PATH%'], 'prompt passed as one argv entry, untouched');
});

test('a shim pointing at a cli.js runs under node; a .js override does too; a missing target gives null', () => {
  const bin = tmp();
  const cli = path.join(bin, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, '// cli');
  if (win) fs.writeFileSync(path.join(bin, 'claude.cmd'), '@ECHO off\r\nnode  "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n');
  else { fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nexec node "$basedir/node_modules/@anthropic-ai/claude-code/cli.js" "$@"\n', { mode: 0o755 }); }
  const spec = CB.resolveClaude({ pathDirs: [bin], home: tmp() });
  assert.deepEqual(spec, { file: cli, isScript: true });
  const fakeNode = path.join(bin, win ? 'node.exe' : 'node');
  fs.writeFileSync(fakeNode, 'node');
  const launch = CB.launchSpec(spec, ['-p', 'x'], { pathDirs: [bin] });
  assert.deepEqual(launch, { file: fakeNode, args: [cli, '-p', 'x'], env: {} });
  const hosted = CB.launchSpec(spec, ['-p', 'x'], { node: null });
  assert.equal(hosted.file, process.execPath);
  assert.equal(hosted.env.ELECTRON_RUN_AS_NODE, '1');
  // Override with a script stand-in (what the UI tests use).
  assert.deepEqual(CB.resolveClaude({ override: cli }), { file: cli, isScript: true });
  // Nothing installed.
  assert.equal(CB.resolveClaude({ pathDirs: [tmp()], home: tmp() }), null);
  // A shim whose target is gone.
  const broken = tmp();
  if (win) fs.writeFileSync(path.join(broken, 'claude.cmd'), '"%dp0%\\nowhere\\claude.exe" %*\r\n');
  else fs.writeFileSync(path.join(broken, 'claude'), 'exec node "$basedir/nowhere/cli.js"\n');
  assert.equal(CB.resolveClaude({ pathDirs: [broken], home: tmp() }), null);
});

test('the native installer location (~/.local/bin) is found when PATH has nothing', { skip: !win && 'exe check' }, () => {
  const home = tmp();
  const exe = path.join(home, '.local', 'bin', 'claude.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, 'MZ');
  assert.deepEqual(CB.resolveClaude({ pathDirs: [], home }), { file: exe, isScript: false });
});
