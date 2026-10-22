'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../src/shared/themes.mts');

const HEX = /^#[0-9a-f]{6}$/;
const premade = Object.keys(T.SCHEMES).filter((id) => !T.SCHEMES[id].builtIn);

function assertReadable(tokens, label, bodyMin = 7) {
  const surfaces = ['chrome', 'base', 'paper', 'raised'].map((k) => tokens[k]);
  for (const s of surfaces) assert.match(s, HEX, label + ' surface ' + s);
  for (const k of ['fg', 'fg-2', 'fg-3', 'accent-text', 'danger', 'ok', 'syn-string', 'syn-atom']) {
    for (const s of surfaces) assert.ok(T.contrast(tokens[k], s) >= 4.5, label + ': ' + k + ' ' + tokens[k] + ' on ' + s + ' is ' + T.contrast(tokens[k], s).toFixed(2));
  }
  for (const s of surfaces) assert.ok(T.contrast(tokens.fg, s) >= bodyMin, label + ': body text ' + bodyMin + ':1 on ' + s);
  assert.ok(T.contrast(tokens['accent-fg'], tokens.accent) >= 4.5, label + ': text on the accent');
  assert.ok(T.contrast(tokens['selected-fg'], tokens.selected) >= 4.5, label + ': text on the selection');
  for (const name of T.TOKENS) assert.ok(tokens[name] !== undefined, label + ': token ' + name + ' is set');
}

test('every premade scheme has a light and a dark seed and reads in both', () => {
  assert.ok(premade.length >= 5, 'there are premade schemes');
  for (const id of premade) {
    const scheme = T.SCHEMES[id];
    assert.ok(scheme.name, id + ' has a name');
    for (const mode of ['light', 'dark']) {
      const seed = scheme[mode];
      assert.ok(seed && HEX.test(seed.background) && HEX.test(seed.text) && HEX.test(seed.accent), id + ' ' + mode + ' seed');
      assertReadable(T.derive(seed), id + ' ' + mode);
    }
  }
});

test('the built-in scheme sets nothing; a premade one and custom colours set the whole token list', () => {
  assert.equal(T.resolve({ colorScheme: 'notes' }, 'light'), null);
  assert.equal(T.resolve({ colorScheme: 'custom', customColors: null }, 'light'), null, 'custom with no colours is nothing');
  assert.equal(T.resolve({ colorScheme: 'custom', customColors: { light: T.SCHEMES.slate.light } }, 'dark'), null, 'no dark colours picked: the stylesheet');
  const slate = T.resolve({ colorScheme: 'slate' }, 'dark');
  assert.ok(slate && slate.paper, 'slate dark derived');
  assertReadable(slate, 'slate via resolve');
});

test('random seeds never produce unreadable text', () => {
  let x = 12345;
  const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x; };
  const hex = () => '#' + (rnd() & 0xffffff).toString(16).padStart(6, '0');
  for (let i = 0; i < 400; i++) {
    const seed = { background: hex(), text: hex(), accent: hex() };
    assertReadable(T.derive(seed), JSON.stringify(seed), 4.5);
  }
});

test('seedsOf: the built-in colours, a premade seed, the custom colours, and the fallbacks', () => {
  assert.deepEqual(T.seedsOf('notes', null, 'light'), T.BUILT_IN_SEEDS.light);
  assert.deepEqual(T.seedsOf('notes', null, 'dark'), T.BUILT_IN_SEEDS.dark);
  assert.deepEqual(T.seedsOf('forest', null, 'dark'), T.SCHEMES.forest.dark);
  const custom = { light: { background: '#ffffff', text: '#000000', accent: '#ff0000' } };
  assert.deepEqual(T.seedsOf('custom', custom, 'light'), custom.light);
  assert.deepEqual(T.seedsOf('custom', custom, 'dark'), T.BUILT_IN_SEEDS.dark, 'no dark colours yet: start from the built-in ones');
  assert.deepEqual(T.seedsOf('custom', null, 'light'), T.BUILT_IN_SEEDS.light);
  assert.deepEqual(T.seedsOf('no-such-scheme', null, 'light'), T.BUILT_IN_SEEDS.light, 'an unknown id is the built-in scheme');
  assert.deepEqual(T.seedsOf('forest', null, 'sideways'), T.SCHEMES.forest.light, 'an unknown mode is light');
});

test('swatch: the built-in sample is the stylesheet colours; others are the derived page colours', () => {
  assert.deepEqual(T.swatch('notes', null, 'light'), { paper: '#fffaf3', text: '#2a1a12', accent: '#f47b3e' });
  const slate = T.swatch('slate', null, 'dark');
  const derived = T.derive(T.SCHEMES.slate.dark);
  assert.deepEqual(slate, { paper: derived.paper, text: derived.fg, accent: derived.accent });
  assert.ok(T.contrast(slate.text, slate.paper) >= 7, 'the sample reads like the page');
  const custom = { dark: { background: '#101010', text: '#808080', accent: '#202020' } };
  const sw = T.swatch('custom', custom, 'dark');
  assert.ok(T.contrast(sw.text, sw.paper) >= 7, 'a custom sample shows the readable text, not the raw pick');
  assert.deepEqual(T.swatch('custom', null, 'light'), T.swatch('notes', null, 'light'), 'custom with nothing picked looks like the built-in scheme');
  assert.deepEqual(T.swatch('bogus', null, 'light'), T.swatch('notes', null, 'light'));
});

test('scheme ids are validated: premade ids pass, unknown ones and custom without colours fall back', () => {
  for (const id of premade) assert.equal(T.cleanSchemeId(id, null), id);
  assert.equal(T.cleanSchemeId('custom', null), 'notes');
  assert.equal(T.cleanSchemeId('custom', { light: T.SCHEMES.rose.light }), 'custom');
  assert.equal(T.cleanSchemeId('dracula', null), 'notes');
  assert.equal(T.cleanSchemeId(undefined, null), 'notes');
  assert.equal(T.cleanSchemeId('__proto__', null), 'notes');
});

test('custom colours are cleaned: case folded, a half seed dropped, nothing left is null', () => {
  assert.deepEqual(T.cleanCustom({ light: { background: '#FFFFFF', text: '#000000', accent: '#FF0000' }, dark: { background: '#000' } }),
    { light: { background: '#ffffff', text: '#000000', accent: '#ff0000' } });
  assert.equal(T.cleanCustom({ dark: { background: '#000' } }), null);
  assert.equal(T.cleanCustom('nope'), null);
  assert.equal(T.cleanCustom(null), null);
});

test('windowColors follows the scheme in use', () => {
  assert.deepEqual(T.windowColors({ colorScheme: 'notes' }, 'dark'), { background: '#211710', foreground: '#f6eadb' });
  const w = T.windowColors({ colorScheme: 'ocean' }, 'light');
  const d = T.derive(T.SCHEMES.ocean.light);
  assert.deepEqual(w, { background: d.paper, foreground: d.fg });
});
