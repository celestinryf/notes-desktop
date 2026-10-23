'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const FM = require('../../src/shared/front-matter.mts');

test('splitFrontMatter takes the block and the blank lines after it, and leaves other text alone', () => {
  assert.deepEqual(FM.splitFrontMatter('---\ntags: [a]\n---\n\n# Title\n'), { front: '---\ntags: [a]\n---\n\n', body: '# Title\n' });
  assert.deepEqual(FM.splitFrontMatter('---\n---\nbody'), { front: '---\n---\n', body: 'body' });
  assert.deepEqual(FM.splitFrontMatter('---\r\ntags:\r\n- x\r\n---\r\nBody\r\n'), { front: '---\r\ntags:\r\n- x\r\n---\r\n', body: 'Body\r\n' });
  for (const text of ['# Title\n---\nx: y\n---\n', '---\nHello world\n---\nA rule, not front matter', '---\ntags: [a]\nno closing line', '---', '']) {
    assert.deepEqual(FM.splitFrontMatter(text), { front: '', body: text }, JSON.stringify(text));
  }
});

test('splitFrontMatter slices by the real offset when line endings are mixed', () => {
  const text = '---\r\ntags: [a]\nx: y\r\n---\nBody';
  const { front, body } = FM.splitFrontMatter(text);
  assert.equal(front + body, text);
  assert.equal(body, 'Body');
});

test('noteTags reads flow, block, comma and legacy tag keys, plus inline tags outside code', () => {
  assert.deepEqual(FM.noteTags('---\ntags: [Alpha, "beta", \'Gamma\']\n---\nx'), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(FM.noteTags('---\ntitle: t\ntags:\n  - one\n  - "two" # note\n# comment\nother: y\n---\n'), ['one', 'two']);
  assert.deepEqual(FM.noteTags('---\ntags:\n- one\n- two\n---\n'), ['one', 'two']);
  assert.deepEqual(FM.noteTags('---\ntags: a, b\n---\n'), ['a', 'b']);
  assert.deepEqual(FM.noteTags('---\ntag: solo\n---\n'), ['solo']);
  assert.deepEqual(FM.noteTags('---\ntags: [a,\n  b]\n---\n'), ['a', 'b']);
  assert.deepEqual(FM.noteTags('Some #tag, #nested/one, #a-b-, url https://x.com/#frag, #123, `#code`, \\#escaped\n```\n#fenced\n```\n# Heading'), ['tag', 'nested/one', 'a-b']);
  assert.deepEqual(FM.noteTags('---\ntags: [a]\n---\nand #b'), ['a', 'b']);
  assert.deepEqual(FM.noteTags('no tags here'), []);
});

test('setNoteTags adds a block to a file without one, and the result splits back to the original body', () => {
  const out = FM.setNoteTags('Hello\n', ['x', 'y']);
  assert.equal(out, '---\ntags:\n  - x\n  - "y"\n---\nHello\n');
  assert.equal(FM.splitFrontMatter(out).body, 'Hello\n');
  assert.deepEqual(FM.noteTags(out), ['x', 'y']);
  assert.equal(FM.setNoteTags('Hello\n', []), 'Hello\n');
});

test('setNoteTags changes only the tags key, keeps its style, other keys, comments and line endings', () => {
  const block = '---\ntitle: x\ntags:\n  - one\n# c\nother: y\n---\nText\n';
  assert.equal(FM.setNoteTags(block, ['one', 'new']), '---\ntitle: x\ntags:\n  - one\n  - new\n# c\nother: y\n---\nText\n');
  const flow = '---\ntags: [Alpha, b]\ntitle: x\n---\n\nBody\n';
  assert.equal(FM.setNoteTags(flow, ['alpha', 'c']), '---\ntags: [Alpha, c]\ntitle: x\n---\n\nBody\n');
  assert.equal(FM.setNoteTags('---\r\ntags: [a]\r\n---\r\nB', ['b']), '---\r\ntags: [b]\r\n---\r\nB');
  assert.equal(FM.setNoteTags('---\nTags: [a]\n---\nB', ['a', 'b']), '---\nTags: [a, b]\n---\nB');
  assert.equal(FM.setNoteTags('---\ntitle: t\n---\nB', ['a']), '---\ntitle: t\ntags:\n  - a\n---\nB');
});

test('setNoteTags removes the key, and the whole block when nothing else is in it', () => {
  assert.equal(FM.setNoteTags('---\ntags: [a]\n---\n\n# T\n', []), '# T\n');
  assert.equal(FM.setNoteTags('---\ntags: [a]\nkeep: 1\n---\nB', []), '---\nkeep: 1\n---\nB');
});

test('setNoteTags leaves inline tags in the text and never writes them into the block', () => {
  const text = 'Body with #inline\n';
  assert.equal(FM.setNoteTags(text, ['inline']), text);
  assert.equal(FM.setNoteTags(text, ['inline', 'extra']), '---\ntags:\n  - extra\n---\nBody with #inline\n');
});

test('setNoteTags quotes values YAML would read as something else, and returns the same text when nothing changes', () => {
  const out = FM.setNoteTags('x', ['true', '123', 'a:b', 'ok']);
  assert.equal(out, '---\ntags:\n  - "true"\n  - "123"\n  - "a:b"\n  - ok\n---\nx');
  assert.deepEqual(FM.frontMatterTags(out), ['true', '123', 'a:b', 'ok']);
  const same = '---\ntags:\n  - "quoted"\n---\nB';
  assert.equal(FM.setNoteTags(same, ['quoted']), same);
});

test('isMarkdownPath names the extensions tags are kept in', () => {
  for (const p of ['a.md', 'C:\\x\\b.MARKDOWN', 'c.mdx']) assert.equal(FM.isMarkdownPath(p), true, p);
  for (const p of ['a.txt', 'b.org', '', null]) assert.equal(FM.isMarkdownPath(p), false, String(p));
});
