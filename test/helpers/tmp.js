'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const created = [];

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function makeWritable(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try { fs.chmodSync(p, 0o666); } catch (_) {  }
    if (e.isDirectory()) makeWritable(p);
  }
}

function cleanup() {
  for (const dir of created.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); }
    catch (_) { makeWritable(dir); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch (_e) {  } }
  }
}

process.on('exit', cleanup);

module.exports = { tmpDir, cleanup };
