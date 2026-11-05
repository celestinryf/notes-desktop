'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { needsAppId } = require('../../src/start-menu.mts');

const EXE = 'C:\\Users\\me\\notes-app\\node_modules\\electron\\dist\\electron.exe';
const ROOT = 'C:\\Users\\me\\notes-app';
const ID = 'com.example.notes';
const ours = { target: EXE, args: '"' + ROOT + '"' };

test('needsAppId adds the app ID only to a shortcut that starts this copy of Notes', () => {
  assert.equal(needsAppId(ours, EXE, ROOT, ID), true);
  assert.equal(needsAppId({ ...ours, args: ROOT }, EXE, ROOT, ID), true, 'unquoted root');
  assert.equal(needsAppId({ target: EXE.toUpperCase(), args: '"' + ROOT.toLowerCase() + '\\"' }, EXE, ROOT, ID), true, 'Windows paths ignore case and a trailing slash');
  assert.equal(needsAppId({ ...ours, appUserModelId: 'someone.else' }, EXE, ROOT, ID), true, 'a different ID is replaced');
});

test('needsAppId leaves alone a shortcut that already has the ID, or belongs to another copy or another program', () => {
  assert.equal(needsAppId({ ...ours, appUserModelId: ID }, EXE, ROOT, ID), false, 'already done');
  assert.equal(needsAppId({ ...ours, args: '"C:\\Users\\me\\notes-app-topband"' }, EXE, ROOT, ID), false, 'another checkout');
  assert.equal(needsAppId({ ...ours, target: 'C:\\Users\\me\\notes-app-topband\\node_modules\\electron\\dist\\electron.exe' }, EXE, ROOT, ID), false, 'another checkout\u2019s Electron');
  assert.equal(needsAppId({ ...ours, args: '"' + ROOT + '" --hidden' }, EXE, ROOT, ID), false, 'arguments someone added');
  assert.equal(needsAppId({ target: 'C:\\Windows\\notepad.exe', args: '' }, EXE, ROOT, ID), false, 'another program');
  assert.equal(needsAppId({ target: '', args: '' }, EXE, ROOT, ID), false, 'an empty shortcut');
  assert.equal(needsAppId({ target: EXE, args: '   ' }, EXE, ROOT, ID), false, 'no arguments');
});

test('needsAppId treats a shortcut with no arguments field as not ours', () => {
  assert.equal(needsAppId({ target: EXE }, EXE, ROOT, ID), false);
});
