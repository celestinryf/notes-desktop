'use strict';
/* Temporary folders for tests, removed again when the test process exits (pass, fail or forced exit), so
   repeated runs do not pile up folders in %TEMP%. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const created = [];

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

// Some files are read-only on Windows (git objects); make everything writable before removing.
function makeWritable(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try { fs.chmodSync(p, 0o666); } catch (_) { /* ignore */ }
    if (e.isDirectory()) makeWritable(p);
  }
}

function cleanup() {
  for (const dir of created.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); }
    catch (_) { makeWritable(dir); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch (_e) { /* leave it */ } }
  }
}

process.on('exit', cleanup);

module.exports = { tmpDir, cleanup };
