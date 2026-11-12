'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const createMarkdownIt = require('markdown-it');
const M = require('../../src/shared/math.mts');
const H = require('../../src/shared/helpers.mts');
const { tmpDir } = require('../helpers/tmp.js');

function parser() {
  const md = createMarkdownIt({ html: true });
  M.addMath(md, {
    inline: (latex, display) => '<M' + (display ? ' display' : '') + '>' + latex + '</M>',
    block: (latex) => '<B>' + JSON.stringify(latex) + '</B>\n',
    dollar: () => '<D>',
  });
  return md;
}

const render = (src) => parser().render(src);

test('mathAt reads inline math by Pandoc\'s rule', () => {
  assert.deepEqual(M.mathAt('$a_1$', 0), { end: 5, latex: 'a_1', display: false });
  assert.deepEqual(M.mathAt('x $y$ z', 2), { end: 5, latex: 'y', display: false });
  assert.equal(M.mathAt('x $y$ z', 0), null, 'only at a dollar');
});

test('an opening dollar followed by a space is not math', () => {
  assert.equal(M.mathAt('$ x$', 0), null);
  assert.equal(M.mathAt('$\tx$', 0), null);
});

test('a closing dollar after a space or before a digit is not math', () => {
  assert.equal(M.mathAt('$x $', 0), null);
  assert.equal(M.mathAt('$5 and $10', 0), null);
  assert.equal(M.mathAt('$x$5', 0), null);
  assert.deepEqual(M.mathAt('$x$a', 0), { end: 3, latex: 'x', display: false });
});

test('the first closing dollar decides, as in Pandoc', () => {
  assert.equal(M.mathAt('$a $b$', 0), null);
});

test('inline math never crosses a line or ends at an escaped dollar', () => {
  assert.equal(M.mathAt('$a\nb$', 0), null);
  assert.deepEqual(M.mathAt('$a\\$b$', 0), { end: 6, latex: 'a\\$b', display: false });
  assert.equal(M.mathAt('$a\\$', 0), null);
  assert.equal(M.mathAt('$a\\\nb$', 0), null);
});

test('display math with two dollars may span lines but not a blank line', () => {
  assert.deepEqual(M.mathAt('$$\nx\n$$', 0), { end: 7, latex: '\nx\n', display: true });
  assert.deepEqual(M.mathAt('$$ x $$', 0), { end: 7, latex: ' x ', display: true });
  assert.equal(M.mathAt('$$\n\nx\n$$', 0), null);
  assert.equal(M.mathAt('$$\n  \t\nx$$', 0), null);
  assert.equal(M.mathAt('$$$$', 0), null, 'empty');
  assert.equal(M.mathAt('$$x', 0), null, 'unclosed');
});

test('mathAt respects the end it is given', () => {
  assert.equal(M.mathAt('$a$', 0, 2), null);
  assert.equal(M.mathAt('$$a$$', 0, 4), null);
  assert.deepEqual(M.mathAt('$a$5', 0, 3), { end: 3, latex: 'a', display: false }, 'a digit past the end does not count');
});

test('the parser turns inline math into one token, before emphasis and escapes', () => {
  assert.equal(render('$a_1 * b_2$'), '<p><M>a_1 * b_2</M></p>\n');
  assert.equal(render('two $a$ and $b$ here'), '<p>two <M>a</M> and <M>b</M> here</p>\n');
  assert.equal(render('*$x_1$*'), '<p><em><M>x_1</M></em></p>\n');
});

test('prices stay text', () => {
  assert.equal(render('costs $5 and $10'), '<p>costs $5 and $10</p>\n');
  assert.equal(render('$20,000 and $30,000'), '<p>$20,000 and $30,000</p>\n');
  assert.equal(render('unclosed $x'), '<p>unclosed $x</p>\n');
});

test('an escaped dollar is its own token and never opens math', () => {
  assert.equal(render('\\$5'), '<p><D>5</p>\n');
  assert.equal(render('\\$a\\$'), '<p><D>a<D></p>\n');
  assert.equal(render('\\\\$a$'), '<p>\\<M>a</M></p>\n', 'an escaped backslash leaves the dollar free');
});

test('code keeps its dollars', () => {
  assert.equal(render('`$not math$`'), '<p><code>$not math$</code></p>\n');
  assert.equal(render('```\n$x$\n```'), '<pre><code>$x$\n</code></pre>\n');
  assert.equal(render('    $x$'), '<pre><code>$x$\n</code></pre>\n');
});

test('a display block on its own lines is a block token', () => {
  assert.equal(render('$$\n\\int_0^1 x\\,dx\n$$'), '<B>"\\n\\\\int_0^1 x\\\\,dx\\n"</B>\n');
  assert.equal(render('$$x^2$$'), '<B>"x^2"</B>\n');
  assert.equal(render('$$x^2$$   '), '<B>"x^2"</B>\n');
  assert.equal(render('  $$\n  x\n  $$'), '<B>"\\n  x\\n  "</B>\n');
});

test('a display block ends at its first closing pair', () => {
  assert.equal(render('$$a$$ and more'), '<p><M display>a</M> and more</p>\n');
  assert.equal(render('$$\na\n$$ more'), '<p><M display>\na\n</M> more</p>\n');
});

test('a blank line or the end of the note leaves the dollars as text', () => {
  assert.equal(render('$$\n\nx\n$$'), '<p>$$</p>\n<p>x\n$$</p>\n');
  assert.equal(render('$$\nx'), '<p>$$\nx</p>\n');
});

test('display math inside a paragraph is inline display math', () => {
  assert.equal(render('text\n$$\nx\n$$'), '<p>text\n<M display>\nx\n</M></p>\n');
});

test('blocks work inside lists and quotes', () => {
  assert.equal(render('- item\n\n  $$\n  y\n  $$'), '<ul>\n<li>\n<p>item</p>\n<B>"\\ny\\n"</B>\n</li>\n</ul>\n');
  assert.equal(render('> $$\n> q\n> $$'), '<blockquote>\n<B>"\\nq\\n"</B>\n</blockquote>\n');
});

test('math in a table cell', () => {
  assert.match(render('| a | b |\n|---|---|\n| $x^2$ | y |'), /<td><M>x\^2<\/M><\/td>/);
});

test('a parser gets the rules once', () => {
  const md = createMarkdownIt();
  const renderers = { inline: () => 'I', block: () => 'B', dollar: () => 'D' };
  M.addMath(md, renderers);
  M.addMath(md, renderers);
  assert.equal(md.render('$a$'), '<p>I</p>\n');
});

test('mathAsText keeps the TeX without delimiters, or drops it', () => {
  assert.equal(M.mathAsText('a $x^2$ b', true), 'a x^2 b');
  assert.equal(M.mathAsText('a $x^2$ b', false), 'a  b');
  assert.equal(M.mathAsText('$$\n\\frac{1}{2}\n  + y\n$$', true), '\\frac{1}{2} + y');
  assert.equal(M.mathAsText('costs $5 and $10', true), 'costs $5 and $10');
  assert.equal(M.mathAsText('\\$5 or $x$', true), '$5 or x');
  assert.equal(M.mathAsText('`$a$` and ``$b$`` and $c$', true), '`$a$` and ``$b$`` and c');
  assert.equal(M.mathAsText('an unclosed `tick $a$', true), 'an unclosed `tick a');
  assert.equal(M.mathAsText('no dollars \\* here', true), 'no dollars \\* here');
  assert.equal(M.mathAsText('', true), '');
});

test('hasMath finds real formulas only', () => {
  assert.equal(M.hasMath('$a$'), true);
  assert.equal(M.hasMath('$$\nx\n$$'), true);
  assert.equal(M.hasMath('costs $5 and $10'), false);
  assert.equal(M.hasMath('\\$a\\$'), false);
  assert.equal(M.hasMath('`$a$`'), false);
  assert.equal(M.hasMath('no dollars'), false);
});

test('escapeMathOpeners escapes each dollar that would open math, and only those', () => {
  assert.equal(M.escapeMathOpeners('$a$'), '\\$a$');
  assert.equal(M.escapeMathOpeners('$a$ $b$'), '\\$a$ \\$b$');
  assert.equal(M.escapeMathOpeners('$a$b$'), '\\$a\\$b$', 'the old closer may open the next span');
  assert.equal(M.escapeMathOpeners('costs $5 and $10'), 'costs $5 and $10');
  assert.equal(M.escapeMathOpeners('$$x$$'), '\\$\\$x$$');
  assert.equal(M.escapeMathOpeners('\\$a$'), '\\$a$', 'an escape stays as it is');
  for (const s of ['$a$', '$a$ $b$', '$a$b$', '$$x$$', 'x $$\ny\n$$']) assert.equal(M.hasMath(M.escapeMathOpeners(s)), false, s);
});

test('inline TeX is made safe to save between single dollars', () => {
  assert.equal(M.inlineLatexForSaving('  a + b  '), 'a + b');
  assert.equal(M.inlineLatexForSaving('a\n  + b'), 'a + b');
  assert.equal(M.inlineLatexForSaving('a$b'), 'a\\$b');
  assert.equal(M.inlineLatexForSaving('a\\$b'), 'a\\$b');
  assert.equal(M.inlineLatexForSaving('a\\\\$b'), 'a\\\\\\$b');
  assert.equal(M.inlineLatexForSaving('$$'), '\\$\\$');
  assert.equal(M.inlineLatexForSaving('a\\'), 'a', 'a lone trailing backslash would escape the closing dollar');
  assert.equal(M.inlineLatexForSaving('a\\\\'), 'a\\\\');
  assert.equal(M.inlineLatexForSaving('   '), '');
  for (const s of ['a$b', 'x \\', ' y ', '$$']) {
    const saved = M.inlineLatexForSaving(s);
    assert.deepEqual(M.mathAt('$' + saved + '$', 0), { end: saved.length + 2, latex: saved, display: false }, s);
  }
});

test('block TeX is made safe to save between double dollars', () => {
  assert.equal(M.blockLatexForSaving('x'), '\nx\n');
  assert.equal(M.blockLatexForSaving('\n\n  x\n\n'), '\n  x\n');
  assert.equal(M.blockLatexForSaving('a\n\nb'), '\na\nb\n', 'a blank line would end the block');
  assert.equal(M.blockLatexForSaving('a $$ b $ c'), '\na \\$$ b $ c\n');
  assert.equal(M.blockLatexForSaving('a\r\nb'), '\na\nb\n');
  assert.equal(M.blockLatexForSaving(''), '\n');
  assert.equal(M.blockLatexForSaving('  \n '), '\n');
  for (const s of ['x', 'a $$ b', 'a\n\nb', '']) {
    const saved = M.blockLatexForSaving(s);
    assert.match(render('$$' + saved + '$$'), /^<B>/, JSON.stringify(s));
  }
});

test('plain text of a note keeps the formula text, and speech skips it', () => {
  assert.equal(H.plainTextFromMarkdown('Area is $\\pi r^2$ here.'), 'Area is \\pi r^2 here.');
  assert.equal(H.plainTextFromMarkdown('Area is $\\pi r^2$ here.', 'skip'), 'Area is here.');
  assert.equal(H.plainTextFromMarkdown('costs $5 and $10'), 'costs $5 and $10');
  assert.equal(H.plainTextFromMarkdown('```\n$x$\n```'), 'code block omitted.');
});

test('search excerpts and card snippets show formulas without dollars', () => {
  const note = { title: 'Physics', body: '# Physics\n\nEnergy is $E = mc^2$ for a body at rest.\n\n$$\n\\int_0^1 x\\,dx\n$$\n' };
  assert.equal(H.matchExcerpt(note, 'rest'), '…is E = mc^2 for a body at rest. \\int_0^1 x\\,dx');
  assert.equal(H.snippet(note, 120), 'Energy is E = mc^2 for a body at rest. \\int_0^1 x\\,dx');
});

const CORPUS = [
  '$a_1 * b_2$',
  '$$\n\\int_0^1 x\\,dx\n$$',
  'costs $5 and $10',
  '\\$5',
  'costs \\$5, and $x$ is math',
  '\\$a\\$ stays text',
  '`$not math$` in code',
  '```\n$x$ in a fence\n```',
  '| a | b |\n| --- | --- |\n| $x^2$ | y |',
  '$x$ at the start of a line',
  'two $a$ and $b$ on one line',
  'an unclosed $x stays text',
  '$$x^2$$',
  '$a$5 stays text',
  '**bold $x_1$ text**',
  '# Energy $E = mc^2$',
  'Water is $\\ce{H2O}$.',
  'Broken $\\frac{1}{$ formula',
  '[see $x$](https://example.com)',
  '- [ ] solve $x^2 = 4$',
  '- item\n\n  $$\n  y = mx + b\n  $$',
  '> $$\n> q\n> $$',
  'A $\\$$ dollar inside',
  'Inline display $$\\sum_i i$$ in a sentence',
  'Line one\n\n$$\na \\\\\nb\n$$\n\nLine after',
];

const text = (t, marks) => Object.assign({ type: 'text', text: t }, marks ? { marks: marks.map((type) => ({ type })) } : {});
const formula = (latex, display) => ({ type: 'inlineMath', attrs: { latex, display: !!display } });
const paragraph = (...content) => ({ type: 'paragraph', content });
const DOCS = {
  splitByFormula: [paragraph(text('$a'), formula('x'), text('b$'))],
  splitByBold: [paragraph(text('$a '), text('b', ['bold']), text(' c$'))],
  splitByBreak: [paragraph(text('cost $$ a'), { type: 'hardBreak' }, text('b $$'))],
  plainDollars: [paragraph(text('$x$ and $y$ typed as text'))],
  dollarInFormula: [paragraph(text('a '), formula('p$q'), text(' b'))],
  blankLinesInBlock: [{ type: 'blockMath', attrs: { latex: 'a\n\n\nb' } }],
  emptyBlock: [{ type: 'blockMath', attrs: { latex: '' } }],
};

let editorRun = null;
function runEditor() {
  if (editorRun) return editorRun;
  const dir = tmpDir('notes-math-');
  const casesFile = path.join(dir, 'cases.json');
  const outFile = path.join(dir, 'out.json');
  fs.writeFileSync(casesFile, JSON.stringify({ markdown: CORPUS, docs: Object.values(DOCS) }));
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(require('electron'), [path.join(__dirname, '..', 'fixtures', 'editor-roundtrip.js'), casesFile, outFile], { env, timeout: 60000, encoding: 'utf8' });
  assert.ok(fs.existsSync(outFile), 'the editor window wrote no results: ' + (run.stderr || run.error || ''));
  const out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.ok(Array.isArray(out.markdown), String(out.error));
  const names = Object.keys(DOCS);
  editorRun = { markdown: new Map(out.markdown.map((r) => [r.md, r])), docs: Object.fromEntries(out.docs.map((r, i) => [names[i], r])), flows: out.flows };
  return editorRun;
}
const runCorpus = () => runEditor().markdown;

for (const md of CORPUS) {
  test('the rendered editor writes back ' + JSON.stringify(md) + ' unchanged', () => {
    const r = runCorpus().get(md);
    assert.equal(r.out.trimEnd(), md);
    assert.equal(r.exact, true);
    assert.equal(r.lossless, true);
  });
}

test('formulas become math nodes rendered by KaTeX, and prices do not', () => {
  const r = (md) => runCorpus().get(md);
  assert.equal(r('$a_1 * b_2$').nodes.inlineMath, 1);
  assert.deepEqual(r('$a_1 * b_2$').latex, ['a_1 * b_2']);
  assert.equal(r('$a_1 * b_2$').katex, 1);
  assert.equal(r('$$\n\\int_0^1 x\\,dx\n$$').nodes.blockMath, 1);
  assert.deepEqual(r('$$\n\\int_0^1 x\\,dx\n$$').latex, ['\n\\int_0^1 x\\,dx\n']);
  assert.equal(r('costs $5 and $10').nodes.inlineMath, undefined);
  assert.equal(r('two $a$ and $b$ on one line').nodes.inlineMath, 2);
  assert.equal(r('| a | b |\n| --- | --- |\n| $x^2$ | y |').nodes.inlineMath, 1);
  assert.equal(r('- item\n\n  $$\n  y = mx + b\n  $$').nodes.blockMath, 1);
  assert.equal(r('> $$\n> q\n> $$').nodes.blockMath, 1);
  assert.equal(r('Water is $\\ce{H2O}$.').errors, 0, 'mhchem is loaded');
  assert.equal(r('Inline display $$\\sum_i i$$ in a sentence').nodes.inlineMath, 1);
});

test('escaped dollars stay text with their escape remembered', () => {
  const r = runCorpus().get('\\$a\\$ stays text');
  assert.equal(r.nodes.inlineMath, undefined);
  assert.equal(r.nodes['mark:escapedDollar'], 2);
});

test('bad TeX shows as an error and still saves as written', () => {
  const r = runCorpus().get('Broken $\\frac{1}{$ formula');
  assert.equal(r.errors, 1);
  assert.equal(r.out, 'Broken $\\frac{1}{$ formula');
});

test('a TeX mistake is reported in one plain line', () => {
  const katex = require('katex');
  const messageOf = (tex) => { try { katex.renderToString(tex, { throwOnError: true }); return null; } catch (err) { return err.message; } };
  assert.equal(M.formulaErrorText(messageOf(String.raw`v^2 + \fracc{1}{2}`)), String.raw`Undefined control sequence: \fracc`);
  assert.equal(M.formulaErrorText(messageOf(String.raw`\frac{1}{`)), "Unexpected end of input in a macro argument, expected '}'");
  assert.equal(M.formulaErrorText('KaTeX parse error: '), 'This formula has a mistake.');
  assert.equal(M.formulaErrorText('something else'), 'something else');
});

test('dollars split across a formula, bold text or a line break are escaped so they stay text', () => {
  const d = runEditor().docs;
  for (const name of ['splitByFormula', 'splitByBold', 'splitByBreak', 'plainDollars']) assert.equal(d[name].same, true, name + ' came back as ' + JSON.stringify(d[name].out));
  assert.equal(d.splitByFormula.out, '\\$a$x$b$');
  assert.equal(d.splitByBold.out, '\\$a **b** c$');
  assert.equal(d.plainDollars.out, '\\$x$ and \\$y$ typed as text');
  assert.equal(d.splitByFormula.nodes.inlineMath, 1);
});

test('a formula is saved safely even before its popover finishes', () => {
  const d = runEditor().docs;
  assert.equal(d.dollarInFormula.out, 'a $p\\$q$ b');
  assert.deepEqual(d.dollarInFormula.latex, ['p\\$q']);
  assert.equal(d.blankLinesInBlock.out, '$$a\nb$$');
  assert.equal(d.blankLinesInBlock.nodes.blockMath, 1);
  assert.equal(d.emptyBlock.out, '$$\n$$');
  assert.equal(d.emptyBlock.nodes.blockMath, 1);
});

test('inserting a formula and editing it is one undo step', () => {
  const f = runEditor().flows.insertThenUndo;
  assert.equal(f.after, 'Area$x^2$');
  assert.equal(f.undone, 'Area');
  assert.equal(f.nodes.inlineMath, undefined);
});

test('a new formula left empty leaves nothing behind, not even for undo', () => {
  const f = runEditor().flows.insertThenCancel;
  assert.equal(f.after, 'Area');
  assert.equal(f.nodesAfter.inlineMath, undefined);
  assert.equal(f.nodesUndone.inlineMath, undefined);
});

test('a new block formula with blank lines saves as one block', () => {
  const f = runEditor().flows.blockInsert;
  assert.equal(f.after, 'Text\n\n$$\na\nb\n$$');
  assert.equal(f.nodes.blockMath, 1);
});

test('the live preview never writes an unescaped dollar', () => {
  const f = runEditor().flows.previewSaves;
  assert.equal(f.opened, true);
  assert.equal(f.during, 'a $p\\$q$ b');
  assert.equal(f.after, 'a $p\\$q$ b');
});

test('emptying an existing formula removes it, and undo brings it back', () => {
  const f = runEditor().flows.emptiedExisting;
  assert.equal(f.after, 'a  b');
  assert.equal(f.undone, 'a $x$ b');
});

test('an outside change while the popover is open ends the edit and keeps the outside text', () => {
  const f = runEditor().flows.replacedWhileOpen;
  assert.equal(f.ended, 1);
  assert.equal(f.after, 'outside $z$ edit');
});

test('typing a closing dollar makes a formula only where formulas can be edited', () => {
  const [main, sticky] = runEditor().flows.typedDollars;
  assert.equal(main.formulas, 1);
  assert.equal(main.out, 'see $x$');
  assert.equal(sticky.formulas, 0);
  assert.equal(sticky.out, 'see \\$x$');
});

test('display and block TeX keep their lines but lose blank ones', () => {
  assert.equal(M.displayLatexForSaving('a\n\n\nb'), 'a\nb');
  assert.equal(M.displayLatexForSaving('a\n  \n\t\nb'), 'a\nb');
  assert.equal(M.displayLatexForSaving('\n x \n'), '\n x \n');
  assert.equal(M.displayLatexForSaving('a $$ b'), 'a \\$$ b');
  assert.equal(M.blockLatexForSaving('a\n\n\n\nb'), '\na\nb\n');
  assert.equal(M.blockLatexForSaving('a\n \n\t\n b'), '\na\n b\n');
});

test('mathOpeners skips what the caller marks as already-formula', () => {
  assert.deepEqual(M.mathOpeners('$a$x$b$'), [0, 2, 4]);
  assert.deepEqual(M.mathOpeners('$a$x$b$', (i) => (i === 2 ? 5 : -1)), [0]);
  assert.deepEqual(M.mathOpeners('no dollars'), []);
});

test('a dollar with no closer is not retried from inside, as in Pandoc', () => {
  assert.equal(render('$\\text{a $b$ c}$'), '<p>$\\text{a <M>b</M> c}$</p>\n');
});
