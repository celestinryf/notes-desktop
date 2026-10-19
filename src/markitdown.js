'use strict';
/* MarkItDown (Microsoft's Python converter, `pip install markitdown`) reads the office files Notes has no reader of its
   own for: spreadsheets, presentations, e-books, Outlook messages and zips. Its Markdown is made for text analysis,
   not for people (its own README says so): it is the text a note keeps for search and the bot, and the source of
   "Convert to…" for these files, never how they are shown. It is optional: without `markitdown` on PATH these files
   still open (in GridCraft and DeckCraft), they just have no text.

   It runs with no shell and no plugins: a plugin can send the file to an AI service, and Notes never does that. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { resolveExecutable, launchSpec } = require('./claude-bin');

// What MarkItDown reads that nothing else in Notes does (Word, PDF, HTML and text have their own readers).
const EXT = new Set(['xlsx', 'xlsm', 'xls', 'xlsb', 'ods', 'pptx', 'pptm', 'potx', 'ppsx', 'odp', 'epub', 'msg', 'zip']);
const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 2 * 60 * 1000;
const NAMES = process.platform === 'win32' ? ['markitdown.exe', 'markitdown'] : ['markitdown'];

let found; // looked up once per run; null when it is not installed
function executable() {
  if (found === undefined) {
    const override = process.env.NOTES_APP_MARKITDOWN_BIN;
    found = override ? resolveExecutable([], { override }) : resolveExecutable(NAMES);
  }
  return found;
}
const available = () => !!executable();
const reads = (ext) => EXT.has(ext);

// The file's text as Markdown: { markdown, warning }. Throws when MarkItDown is missing, fails or takes too long.
async function toMarkdown(filePath) {
  const exe = executable();
  if (!exe) throw new Error('MarkItDown is not installed (pip install markitdown).');
  if (fs.statSync(filePath).size > MAX_INPUT_BYTES) throw new Error('This file is larger than 100 MB.');
  // Its stdout follows the console's code page on Windows, which mangles anything beyond ASCII; a file is UTF-8.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-markitdown-'));
  const out = path.join(outDir, 'out.md');
  try {
    await run(exe, [filePath, '-o', out]);
    if (fs.statSync(out).size > MAX_OUTPUT_BYTES) throw new Error('The converted text is larger than 20 MB.');
    return { markdown: fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n'), warning: '' };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

function run(exe, args) {
  const spec = launchSpec(exe, args);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
    let child;
    try {
      child = spawn(spec.file, spec.args, {
        shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
        env: Object.assign({}, process.env, spec.env, { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }),
      });
    } catch (err) { reject(err); return; }
    let err = '';
    child.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    const timer = setTimeout(() => { child.kill(); finish(reject, new Error('MarkItDown took longer than 2 minutes.')); }, TIMEOUT_MS);
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code) => {
      if (code === 0) finish(resolve);
      else finish(reject, new Error('MarkItDown could not read this file' + (err.trim() ? ': ' + lastLine(err) : '.')));
    });
  });
}
// A Python failure ends with the exception; that line is the one worth showing.
const lastLine = (s) => s.trim().split(/\r?\n/).pop().slice(0, 300);

module.exports = { EXT, available, reads, toMarkdown };
