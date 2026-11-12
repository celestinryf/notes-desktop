'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { tmpDir } = require('../helpers/tmp.js');
const S = require('../../src/tex-sync.mts');
const { TexService } = require('../../src/tex-service.mts');

const SP = 65781.76;
const sp = (bp) => Math.round(bp * SP);
const hbox = (file, line, left, base, width, height) => ['(' + file + ',' + line + ':' + sp(left) + ',' + sp(base) + ':' + sp(width) + ',' + sp(height) + ',0', 'h' + file + ',' + line + ':' + sp(left) + ',' + sp(base) + ':' + sp(width) + ',' + sp(height) + ',0', ')'];

function syncText(extra) {
  return ['SyncTeX Version:1', 'Input:1:./main.tex', 'Input:2:./chapters/intro.tex', 'Output:pdf', 'Magnification:1000', 'Unit:1', 'X Offset:0', 'Y Offset:0', 'Content:',
    '{1', '[1,1:' + sp(72) + ',' + sp(770) + ':' + sp(450) + ',' + sp(700) + ',0',
    ...hbox(1, 3, 72, 100, 450, 10),
    ...hbox(1, 5, 72, 130, 450, 10),
    ...hbox(2, 2, 72, 160, 200, 10),
    ']', '}1',
    '{2', '[1,1:' + sp(72) + ',' + sp(770) + ':' + sp(450) + ',' + sp(700) + ',0',
    ...hbox(1, 9, 72, 100, 450, 10),
    ']', '}2',
    ...(extra || []),
    'Postamble:', 'Count:9', 'Post scriptum:'].join('\n') + '\n';
}

const base = path.resolve('/doc');

test('boxes come out in PDF points with pages from 0 and files resolved beside the SyncTeX file', () => {
  const boxes = S.boxesOf(syncText(), base);
  const first = boxes.find((b) => b.line === 3);
  assert.equal(first.file, path.join(base, 'main.tex'));
  assert.equal(first.page, 0);
  assert.ok(Math.abs(first.left - 72) < 0.01 && Math.abs(first.bottom - 100) < 0.01 && Math.abs(first.top - 90) < 0.01 && Math.abs(first.right - 522) < 0.01);
  assert.ok(boxes.some((b) => b.file === path.join(base, 'chapters', 'intro.tex') && b.line === 2));
  assert.equal(typeof globalThis.match, 'undefined', 'the parser runs in its own context and leaks no global');
});

test('forward search finds the line, or the nearest line after it, on the first page it appears', () => {
  const boxes = S.boxesOf(syncText(), base);
  const main = path.join(base, 'main.tex');
  const three = S.forwardSearch(boxes, main, 3);
  assert.equal(three.page, 0);
  assert.ok(Math.abs(three.top - 90) < 0.01);
  assert.ok(Math.abs(S.forwardSearch(boxes, main, 4).top - 120) < 0.01, 'line 4 has no box, so line 5 is used');
  assert.equal(S.forwardSearch(boxes, main, 9).page, 1);
  assert.ok(S.forwardSearch(boxes, path.join(base, 'chapters', 'intro.tex'), 2));
  assert.equal(S.forwardSearch(boxes, main, 40), null, 'too far from any box');
  assert.equal(S.forwardSearch(boxes, path.join(base, 'other.tex'), 3), null);
});

test('inverse search picks the box under the point, else the nearest on that page', () => {
  const boxes = S.boxesOf(syncText(), base);
  assert.deepEqual(S.inverseSearch(boxes, 0, 100, 95), { filePath: path.join(base, 'main.tex'), line: 3 });
  assert.deepEqual(S.inverseSearch(boxes, 0, 100, 155), { filePath: path.join(base, 'chapters', 'intro.tex'), line: 2 });
  assert.deepEqual(S.inverseSearch(boxes, 0, 100, 400), { filePath: path.join(base, 'chapters', 'intro.tex'), line: 2 }, 'below everything: the nearest');
  assert.equal(S.inverseSearch(boxes, 0, 100, 95).line, 3);
  assert.equal(S.inverseSearch(boxes, 5, 100, 95), null, 'no such page');
});

test('the SyncTeX file is found beside the PDF or the root, gzipped or not, and read again only when it changes', () => {
  const dir = tmpDir('notes-tex-sync-');
  const pdf = path.join(dir, 'main.pdf');
  assert.equal(S.syncFileFor(pdf), null);
  assert.equal(S.loadBoxes(pdf), null);
  fs.writeFileSync(path.join(dir, 'main.synctex'), syncText());
  assert.equal(S.syncFileFor(pdf), path.join(dir, 'main.synctex'));
  const plain = S.loadBoxes(path.join(dir, 'main.tex'));
  assert.ok(plain.length > 0);
  assert.equal(S.loadBoxes(pdf), plain, 'the same file and time give the cached boxes');
  fs.writeFileSync(path.join(dir, 'main.synctex.gz'), zlib.gzipSync(syncText()));
  assert.equal(S.syncFileFor(pdf), path.join(dir, 'main.synctex.gz'), 'the gzipped file is preferred');
  assert.ok(S.loadBoxes(pdf).length > 0);
});

test('the service maps a line to a box in the compiled PDF and a point back to the line, after a compile', async () => {
  const bin = path.join(tmpDir('notes-tex-syncbin-'), 'bin');
  fs.mkdirSync(bin);
  const fake = path.join(__dirname, '..', 'fixtures', 'fake-tex');
  for (const f of fs.readdirSync(fake)) fs.copyFileSync(path.join(fake, f), path.join(bin, f));
  const svc = new TexService({ PATH: process.env.PATH, SystemDrive: 'Z:', NOTES_APP_TEX_DIR: bin });
  const file = path.join(tmpDir('notes-tex-syncdoc-'), 'paper.tex');
  fs.writeFileSync(file, '\\documentclass{article}\nHello\n\nWorld\n');
  assert.equal(svc.forward(file, 2), null, 'nothing before the first compile');
  assert.equal((await svc.compile('n1', file, { engine: 'pdflatex', haltOnError: false, compileOnSave: false })).ok, true);
  const box = svc.forward(file, 4);
  assert.equal(box.pdf, file.replace(/\.tex$/, '.pdf'));
  assert.equal(box.page, 0);
  const back = svc.inverse(box.pdf, box.page, (box.left + box.right) / 2, (box.top + box.bottom) / 2);
  assert.deepEqual(back, { filePath: file, line: 4 });
  assert.equal(svc.inverse(path.join(path.dirname(file), 'other.pdf'), 0, 10, 10), null);
  assert.equal(svc.sourceFor(box.pdf), file, 'a compiled PDF knows its source');
  const loose = path.join(path.dirname(file), 'loose.pdf');
  fs.writeFileSync(loose, '%PDF-1.4');
  fs.writeFileSync(path.join(path.dirname(file), 'loose.tex'), 'x');
  assert.equal(svc.sourceFor(loose), null, 'a PDF beside a .tex but with no SyncTeX file is not called compiled');
});

test('a truncated or broken SyncTeX file reads as no data instead of throwing', () => {
  const dir = tmpDir('notes-tex-sync-bad-');
  const gz = zlib.gzipSync(syncText());
  fs.writeFileSync(path.join(dir, 'main.synctex.gz'), gz.subarray(0, Math.floor(gz.length / 2)));
  assert.equal(S.loadBoxes(path.join(dir, 'main.pdf')), null);
});

test('an absolute input path is kept as written', () => {
  const abs = path.resolve('/elsewhere/part.tex');
  const text = syncText().replace('Input:2:./chapters/intro.tex', 'Input:2:' + abs);
  const boxes = S.boxesOf(text, base);
  assert.ok(boxes.some((b) => b.file === abs && b.line === 2));
  assert.ok(S.forwardSearch(boxes, abs, 2));
});

test('only the last eight SyncTeX files stay in memory', () => {
  const dirs = Array.from({ length: 10 }, () => tmpDir('notes-tex-sync-cache-'));
  for (const d of dirs) fs.writeFileSync(path.join(d, 'main.synctex'), syncText());
  const first = S.loadBoxes(path.join(dirs[0], 'main.pdf'));
  for (const d of dirs.slice(1)) S.loadBoxes(path.join(d, 'main.pdf'));
  assert.notEqual(S.loadBoxes(path.join(dirs[0], 'main.pdf')), first, 'the oldest was dropped and read again');
  const last = S.loadBoxes(path.join(dirs[9], 'main.pdf'));
  assert.equal(S.loadBoxes(path.join(dirs[9], 'main.pdf')), last, 'a recent one is still cached');
});
