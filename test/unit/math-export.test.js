'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const convert = require('../../src/convert.mts');
const { tmpDir } = require('../helpers/tmp.js');
const { SOURCE, TARGET, woff2Css, fontFiles } = require('../../scripts/vendor-katex.js');

const BODY = '# Physics\n\nEnergy is $E = mc^2$, prices like $5 and $10 stay text, and \\$3 is escaped.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nWater is $\\ce{H2O}$ and $\\frac{1}{$ is broken.\n';

function markdownFile(body) {
  const dir = tmpDir('notes-math-export-');
  const file = path.join(dir, 'Physics.md');
  fs.writeFileSync(file, body);
  return { id: 'n1', title: 'Physics', body, tags: [], folderId: null, filePath: file, fileKind: 'text', lock: null };
}

const printers = { html: async (doc) => Buffer.from(doc), docx: async () => ({ pdf: Buffer.alloc(0), warning: '' }) };

test('the vendored KaTeX stylesheet is the installed one with woff2 fonts only (else run node scripts/vendor-katex.js)', () => {
  const css = fs.readFileSync(path.join(TARGET, 'katex.min.css'), 'utf8');
  assert.equal(css, woff2Css());
  assert.doesNotMatch(css, /\.woff\)|\.ttf\)/);
  const fonts = fontFiles(css);
  assert.equal(fonts.length, 20);
  for (const font of fonts) assert.ok(fs.readFileSync(path.join(TARGET, font)).equals(fs.readFileSync(path.join(SOURCE, font))), font);
  assert.deepEqual(fs.readdirSync(path.join(TARGET, 'fonts')).sort(), fonts.map((f) => path.basename(f)).sort(), 'no stray files');
});

test('both pages load the vendored stylesheet', () => {
  for (const page of ['index.html', 'sticky.html']) {
    assert.match(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', page), 'utf8'), /<link rel="stylesheet" href="vendor\/katex\/katex\.min\.css" \/>/, page);
  }
});

test('a web page made from a note draws its formulas with KaTeX and carries the fonts inside', async () => {
  const out = await convert.convertFile(markdownFile(BODY), 'html', printers);
  const html = fs.readFileSync(out.filePath, 'utf8');
  assert.equal((html.match(/<span class="katex">/g) || []).length, 3, 'three inline formulas');
  assert.equal((html.match(/<div class="math-block"><span class="katex-display">/g) || []).length, 1);
  assert.match(html, /<annotation encoding="application\/x-tex">E = mc\^2<\/annotation>/);
  assert.match(html, /prices like \$5 and \$10 stay text, and \$3 is escaped/);
  assert.match(html, /class="katex-error"[^>]*style="color:var\(--danger\)"/);
  assert.match(html, /:root\{--danger:#a8340c\}/);
  assert.match(html, /url\(data:font\/woff2;base64,[A-Za-z0-9+/=]{100,}\)/);
  assert.doesNotMatch(html, /url\(fonts\//, 'no font is left to a relative path');
});

test('a PDF goes through the same page', async () => {
  const out = await convert.convertFile(markdownFile(BODY), 'pdf', printers);
  const doc = fs.readFileSync(out.filePath, 'utf8');
  assert.match(doc, /<span class="katex">/);
  assert.match(doc, /data:font\/woff2;base64,/);
});

test('a page with no formulas gets no KaTeX stylesheet', async () => {
  const out = await convert.convertFile(markdownFile('# Plain\n\nCosts $5 and $10.\n'), 'html', printers);
  const html = fs.readFileSync(out.filePath, 'utf8');
  assert.doesNotMatch(html, /KaTeX_Main|katex/);
});

test('Word and plain text keep each formula as TeX between dollar signs', async () => {
  const blocks = convert.markdownBlocks(BODY);
  assert.equal(blocks[1].runs.map((r) => r.text).join(''), 'Energy is $E = mc^2$, prices like $5 and $10 stay text, and $3 is escaped.');
  assert.deepEqual(blocks[2], { t: 'p', runs: [{ text: '$$\n\\int_0^1 x\\,dx\n$$' }] });
  assert.equal(blocks[3].runs.map((r) => r.text).join(''), 'Water is $\\ce{H2O}$ and $\\frac{1}{$ is broken.');
  const out = await convert.convertFile(markdownFile(BODY), 'txt', printers);
  const text = fs.readFileSync(out.filePath, 'utf8');
  assert.match(text, /Energy is \$E = mc\^2\$, prices/);
  assert.match(text, /\$\$\n\\int_0\^1 x\\,dx\n\$\$/);
  const docx = await convert.convertFile(markdownFile(BODY), 'docx', printers);
  assert.ok(fs.statSync(docx.filePath).size > 0);
});

test('the Convert to menu says what happens to formulas, only for a note that has them', () => {
  const withMath = Object.fromEntries(convert.options(markdownFile(BODY)).map((o) => [o.to, o.note]));
  assert.match(withMath.docx, /Formulas stay as TeX between dollar signs; Word does not draw them\.$/);
  assert.match(withMath.txt, /Formulas stay as TeX between dollar signs\.$/);
  assert.doesNotMatch(withMath.html, /Formulas/);
  assert.doesNotMatch(withMath.pdf, /Formulas/);
  const prices = Object.fromEntries(convert.options(markdownFile('Costs $5 and $10.')).map((o) => [o.to, o.note]));
  assert.doesNotMatch(prices.docx + prices.txt, /Formulas/);
});

test('plain text turned into Markdown keeps its dollars as text', () => {
  const md = convert.textToMarkdown('A $x$ here and $y$ there.\ncosts $5 and $10');
  assert.equal(md, 'A \\$x$ here and \\$y$ there.\\\ncosts $5 and $10\n');
});
