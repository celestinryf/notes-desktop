'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const { addSpacedImages, isSpacedImagePath, writtenImagePath } = require('../../src/shared/spaced-images.mts');
const convert = require('../../src/convert.mts');
const { tmpDir } = require('../helpers/tmp.js');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

function parser() {
  const md = new MarkdownIt({ html: true, linkify: false });
  addSpacedImages(md);
  return md;
}

function images(src) {
  const found = [];
  for (const block of parser().parse(src, {})) {
    for (const t of block.children || []) if (t.type === 'image') found.push({ src: t.attrGet('src'), alt: t.content, written: writtenImagePath(t) });
  }
  return found;
}

test('an image path with spaces, as Obsidian writes it, is a picture, with the path kept as written', () => {
  assert.deepEqual(images('![](Jide-1 screenshots/jide1-phone-03-feed-playing-late.png)'), [
    { src: 'Jide-1%20screenshots/jide1-phone-03-feed-playing-late.png', alt: '', written: 'Jide-1 screenshots/jide1-phone-03-feed-playing-late.png' },
  ]);
});

test('spaced image paths keep their alt text, any case of extension, and several on a line', () => {
  assert.deepEqual(images('Before ![Feed cards](my shots/one.PNG) and ![](my shots/two.jpeg) after.'), [
    { src: 'my%20shots/one.PNG', alt: 'Feed cards', written: 'my shots/one.PNG' },
    { src: 'my%20shots/two.jpeg', alt: '', written: 'my shots/two.jpeg' },
  ]);
});

test('a path without spaces still goes through the standard rule, unchanged', () => {
  assert.deepEqual(images('![x](shots/one.png)'), [{ src: 'shots/one.png', alt: 'x', written: null }]);
  assert.deepEqual(images('![x](<my shots/one.png>)'), [{ src: 'my%20shots/one.png', alt: 'x', written: null }]);
});

test('spaced paths that are not pictures, or that are not safe, stay text', () => {
  for (const src of [
    '![](my notes/plan.md)',
    '![](my shots/one.png "A title")',
    '![]( my shots/one.png)',
    '![](my shots/one.png )',
    '![](javascript:alert me.png)',
    '![](my shots/one)',
    '![](my shots/one.png',
    '[](my shots/one.png)',
  ]) assert.deepEqual(images(src), [], src);
});

test('a spaced image path works inside a table cell and a list item', () => {
  assert.equal(images('| Shot |\n| --- |\n| ![](my shots/one.png) |\n')[0].written, 'my shots/one.png');
  assert.equal(images('- ![](my shots/one.png)\n')[0].written, 'my shots/one.png');
});

test('rendered HTML carries a valid, encoded src', () => {
  assert.equal(parser().render('![Cards](Jide-1 screenshots/a b.png)').trim(), '<p><img src="Jide-1%20screenshots/a%20b.png" alt="Cards"></p>');
});

test('isSpacedImagePath needs a space, no edge spaces and a picture extension', () => {
  assert.equal(isSpacedImagePath('a b.png'), true);
  assert.equal(isSpacedImagePath('a b.avif'), true);
  assert.equal(isSpacedImagePath('ab.png'), false);
  assert.equal(isSpacedImagePath(' a b.png'), false);
  assert.equal(isSpacedImagePath('a b.png '), false);
  assert.equal(isSpacedImagePath('a b.md'), false);
  assert.equal(isSpacedImagePath('a b.png "title"'), false);
});

test('inlinePicturesOnly drops spaced picture links like any other, and leaves spaced text alone', () => {
  assert.equal(convert.inlinePicturesOnly('A ![Cards](my shots/one.png) B'), 'A *[Cards]* B');
  assert.equal(convert.inlinePicturesOnly('A ![](my shots/one.png) B'), 'A  B');
  assert.equal(convert.inlinePicturesOnly('A ![x](one.png "t") B ![y](<my shots/two.png>) C'), 'A *[x]* B *[y]* C');
  assert.equal(convert.inlinePicturesOnly('A ![](my notes/plan.md) B'), 'A ![](my notes/plan.md) B');
  assert.equal(convert.inlinePicturesOnly('A ![](data:image/png;base64,AAAA) B'), 'A ![](data:image/png;base64,AAAA) B');
});

function markdownFile(body) {
  const dir = tmpDir('notes-spaced-');
  fs.mkdirSync(path.join(dir, 'my shots'));
  fs.writeFileSync(path.join(dir, 'my shots', 'one.png'), PNG);
  const file = path.join(dir, 'Shots.md');
  fs.writeFileSync(file, body);
  return { id: 'n1', title: 'Shots', body, tags: [], folderId: null, filePath: file, fileKind: 'text', lock: null };
}

const printers = { html: async () => Buffer.alloc(0), docx: async () => ({ pdf: Buffer.alloc(0), warning: '' }) };

test('exporting to a web page keeps a spaced picture as an image', async () => {
  const note = markdownFile('# Shots\n\n![Cards](my shots/one.png)\n');
  const out = await convert.convertFile(note, 'html', printers);
  assert.match(fs.readFileSync(out.filePath, 'utf8'), /<img src="my%20shots\/one\.png" alt="Cards">/);
});

test('exporting to Word embeds a picture whose path has spaces', async () => {
  const withPicture = await convert.convertFile(markdownFile('# Shots\n\n![Cards](my shots/one.png)\n'), 'docx', printers);
  assert.ok(fs.readFileSync(withPicture.filePath).includes('word/media/'), 'the picture is in the document');
  const missing = await convert.convertFile(markdownFile('# Shots\n\n![Cards](my shots/missing.png)\n'), 'docx', printers);
  assert.ok(!fs.readFileSync(missing.filePath).includes('word/media/'), 'a missing picture embeds nothing');
});

test('markdownBlocks reads a spaced picture as an image run', () => {
  const blocks = convert.markdownBlocks('![Cards](my shots/one.png)\n');
  assert.deepEqual(blocks[0].runs, [{ img: 'my%20shots/one.png', alt: 'Cards' }]);
});
