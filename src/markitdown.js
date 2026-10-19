'use strict';
/* MarkItDown (Microsoft's Python converter, `pip install "markitdown[all]"`) reads the files Notes has no reader of
   its own for: spreadsheets, e-books, Outlook messages and zips. Its Markdown is made for text analysis, not for
   people (its own README says so): it is the text a note keeps for search and the bot, and the source of
   "Convert to…" for these files, never how they are shown. It is optional: without `markitdown` on PATH a
   spreadsheet still opens (in GridCraft), it just has no text. (Presentations are out of Notes' scope.)

   It runs with no shell and no plugins: a plugin can send the file to an AI service, and Notes never does that.
   Callers run the size limit and the zip guard (files.readDocumentBuffer) on a zip-based file before calling it. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { resolveExecutable, launchSpec } = require('./claude-bin');

// What MarkItDown reads that nothing else in Notes does (Word, PDF, HTML and text have their own readers): the
// extensions its converters accept by name (checked against markitdown 0.1.8; the macro and template variants and
// the OpenDocument formats are not among them).
const EXT = new Set(['xlsx', 'xls', 'epub', 'msg', 'zip']);
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
  if (!exe) throw new Error('MarkItDown is not installed (pip install "markitdown[all]").');
  if (fs.statSync(filePath).size > MAX_INPUT_BYTES) throw new Error('This file is larger than 100 MB.');
  // Its stdout follows the console's code page on Windows, which mangles anything beyond ASCII; a file is UTF-8.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-markitdown-'));
  const out = path.join(outDir, 'out.md');
  try {
    await run(exe, [filePath, '-o', out]);
    if (fs.statSync(out).size > MAX_OUTPUT_BYTES) throw new Error('The converted text is larger than 20 MB.');
    return { markdown: fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n'), warning: '' };
  } finally {
    // The process has ended by now (run waits for it), so nothing holds the file; still, a failed cleanup must not
    // turn a good read into an error.
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) { /* a stray temp folder, nothing more */ }
  }
}

// Runs MarkItDown to completion. Resolves on exit code 0; rejects with its last stderr line, or after the timeout,
// once the process (and on Windows the Python it starts) is gone.
function run(exe, args) {
  const spec = launchSpec(exe, args);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(spec.file, spec.args, {
        shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
        env: Object.assign({}, process.env, spec.env, { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }),
      });
    } catch (err) { reject(err); return; }
    let err = '';
    let timedOut = false;
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); }); // the exception is on the last line
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('MarkItDown took longer than 2 minutes.'));
      else if (code === 0) resolve();
      else reject(new Error('MarkItDown could not read this file' + (err.trim() ? ': ' + lastLine(err) : '.')));
    });
  });
}
// The markitdown.exe on Windows is a launcher that runs Python as a child; killing it alone leaves Python running.
function killTree(child) {
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => child.kill());
  else child.kill();
}
const lastLine = (s) => s.trim().split(/\r?\n/).pop().slice(0, 300);

module.exports = { EXT, available, reads, toMarkdown };
