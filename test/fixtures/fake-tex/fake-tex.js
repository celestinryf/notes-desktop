'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write('pdfTeX 3.141592653-2.6-1.40.26 (Fake TeX 2026)\n');
  process.exit(0);
}
if (process.env.FAKE_LATEXMK_UPTODATE) process.exit(0);
const file = args.filter((a) => !a.startsWith('-')).pop();
if (!file) process.exit(2);
const cwd = process.cwd();
const stem = path.basename(file).replace(/\.[^.]+$/, '');
const source = fs.readFileSync(path.join(cwd, file), 'utf8').replace(/\r\n?/g, '\n');
const lines = source.split('\n');
const errorAt = lines.findIndex((l) => l.includes('\\FAKEERROR'));
const fatal = source.includes('\\FAKEFATAL');
const noLog = source.includes('\\FAKENOLOG');
const rerun = source.includes('\\FAKERERUN');
const bibliography = /\\bibliography\{/.test(source);
const runs = (() => { try { return Number(fs.readFileSync(path.join(cwd, stem + '.runs'), 'utf8')) || 0; } catch (_) { return 0; } })() + 1;
const log = ['This is pdfTeX, Version 3.141592653-2.6-1.40.26 (Fake TeX 2026) (preloaded format=pdflatex)', 'entering extended mode', ' file:line:error style messages enabled.', '**' + file, '(./' + file];
if (errorAt !== -1) {
  log.push('./' + file + ':' + (errorAt + 1) + ': Undefined control sequence.', 'l.' + (errorAt + 1) + ' ' + lines[errorAt].trim(), '', 'The control sequence at the end of the top line', 'of your error message was never \\def\'ed.', '');
}
lines.forEach((l, i) => {
  if (l.includes('\\FAKEWARNING')) log.push('', 'LaTeX Warning: Reference `fig:loop\' on page 1 undefined on input line ' + (i + 1) + '.', '');
});
if (rerun) log.push('', 'LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.', '');
if (fatal) {
  log.push('./' + file + ':1: Emergency stop.', '!  ==> Fatal error occurred, no output PDF file produced!');
} else {
  log.push('[1] (./' + stem + '.aux) )', 'Output written on ' + stem + '.pdf (1 page, 1024 bytes).', 'SyncTeX written on ' + stem + '.synctex.gz.');
}
function onePagePdf(text) {
  const safe = text.replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?');
  const stream = 'BT /F1 14 Tf 72 760 Td (' + safe + ') Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = out.length; out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n'; return at; });
  const xref = out.length;
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

const delay = Number(process.env.FAKE_TEX_DELAY_MS || 0);
setTimeout(async () => {
  fs.writeFileSync(path.join(cwd, stem + '.runs'), String(runs));
  if (noLog) process.exit(3);
  fs.writeFileSync(path.join(cwd, stem + '.log'), log.join('\n') + '\n');
  fs.writeFileSync(path.join(cwd, stem + '.aux'), bibliography ? '\\relax\n\\bibdata{refs}\n' : '\\relax\n');
  if (!fatal) {
    const title = (lines.find((l) => l.trim() && !l.trim().startsWith('%') && !l.trim().startsWith('\\')) || stem).slice(0, 60);
    fs.writeFileSync(path.join(cwd, stem + '.pdf'), onePagePdf(title));
  }
  process.exit(errorAt !== -1 || fatal ? 1 : 0);
}, delay);
