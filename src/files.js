'use strict';
/* File-backed notes: which files the app can show or edit, how to read them, and where your agent files live. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const TEXT_EXT = new Set(['md', 'markdown', 'mdx', 'txt', 'text', 'tex', 'latex', 'bib', 'rst', 'adoc', 'org',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'csv', 'tsv', 'log',
  'xml', 'html', 'htm', 'svg', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs',
  'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'swift', 'php', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql',
  'lua', 'luau', 'r', 'm', 'pl', 'gitignore', 'gitattributes', 'editorconfig', 'dockerfile', 'makefile']);
const MAX_TEXT_BYTES = 4 * 1024 * 1024;

function extOf(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (!base.includes('.')) return base; // Makefile, Dockerfile
  return base.slice(base.lastIndexOf('.') + 1);
}

// Returns 'text' | 'pdf' | 'docx' | 'binary'. Text is decided by extension, then by sniffing for NUL bytes.
function kindOf(filePath) {
  const ext = extOf(filePath);
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (TEXT_EXT.has(ext)) return 'text';
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return 'binary';
    return n === 0 ? 'text' : 'text';
  } catch (_) {
    return 'binary';
  }
}

const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });

// Strict UTF-8: a file that is not valid UTF-8 (Latin-1, UTF-16, binary) must never be rewritten as UTF-8 garbage.
function readText(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_TEXT_BYTES) throw Object.assign(new Error('File is larger than 4 MB'), { code: 'ETOOBIG' });
  const bytes = fs.readFileSync(filePath);
  let text;
  try { text = UTF8_STRICT.decode(bytes); } catch (_) { throw Object.assign(new Error('Not UTF-8 text'), { code: 'EENCODING' }); }
  return { body: text.replace(/\r\n/g, '\n'), mtime: stat.mtimeMs, size: stat.size, bom: bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf };
}

function hasBom(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const b = Buffer.alloc(3);
    const n = fs.readSync(fd, b, 0, 3, 0);
    fs.closeSync(fd);
    return n === 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  } catch (_) { return false; }
}

// Writes in place (truncate + write), never via rename, so hard links such as CLAUDE.md <-> AGENTS.md stay joined.
// Keeps the file's line-ending style and its byte-order mark if it had one.
function writeTextInPlace(filePath, body) {
  const eol = detectEol(filePath);
  const bom = hasBom(filePath);
  const text = eol === '\r\n' ? String(body).replace(/\r?\n/g, '\r\n') : String(body);
  fs.writeFileSync(filePath, (bom ? '﻿' : '') + text, 'utf8');
  return fs.statSync(filePath).mtimeMs;
}

function detectEol(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const s = buf.toString('utf8', 0, n);
    const crlf = (s.match(/\r\n/g) || []).length;
    const lf = (s.match(/(?<!\r)\n/g) || []).length;
    return crlf > lf ? '\r\n' : '\n';
  } catch (_) { return '\n'; }
}

const MAX_DOCX_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_UNPACKED = 100 * 1024 * 1024; // what the viewer parses on the page's own thread
const MAX_ZIP_ENTRIES = 20000;
const inflateRaw = (buf, opts) => new Promise((resolve, reject) => zlib.inflateRaw(buf, opts, (err, out) => (err ? reject(err) : resolve(out))));
const zipError = (msg) => Object.assign(new Error(msg), { code: 'EZIP' });
const TOO_BIG_UNPACKED = 'This Word document unpacks to more than 100 MB, so Notes will not open it.';

// A Word document is a zip. A crafted one can unpack to gigabytes from a few kilobytes and hang the app, and its
// directory can lie about sizes, so every entry is really inflated here (on the thread pool, capped) before any
// library is allowed to open it.
async function assertSafeZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22, min = Math.max(0, buf.length - 22 - 65535); i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw zipError('This is not a valid Word document (no zip directory).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw zipError('This Word document uses a zip format Notes does not open (zip64).');
  if (count > MAX_ZIP_ENTRIES) throw zipError('This Word document has too many parts to open safely.');
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw zipError('This Word document is damaged (bad zip directory).');
    const method = buf.readUInt16LE(p + 10);
    const packed = buf.readUInt32LE(p + 20);
    const local = buf.readUInt32LE(p + 42);
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw zipError('This Word document is damaged (bad zip entry).');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + packed > buf.length) throw zipError('This Word document is damaged (truncated).');
    if (method === 0) total += packed;
    else if (method === 8) {
      try { total += (await inflateRaw(buf.subarray(start, start + packed), { maxOutputLength: MAX_ZIP_UNPACKED - total + 1 })).length; }
      catch (err) {
        if (err.code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) throw zipError(TOO_BIG_UNPACKED);
        throw zipError('This Word document is damaged (' + err.message + ').');
      }
    } else throw zipError('This Word document uses a compression Notes does not open.');
    if (total > MAX_ZIP_UNPACKED) throw zipError(TOO_BIG_UNPACKED);
  }
}

// The bytes of a Word document, checked for size and for zip bombs. Everything that opens a .docx goes through here.
async function readDocxBuffer(filePath) {
  if (fs.statSync(filePath).size > MAX_DOCX_BYTES) throw Object.assign(new Error('This Word document is larger than 50 MB; use "Open with…" for it.'), { code: 'ETOOBIG' });
  const buf = fs.readFileSync(filePath);
  await assertSafeZip(buf);
  return buf;
}

// The plain text of a Word document, kept as the note's body for search, the list snippet and links. The document
// itself is shown from its own bytes (files:docxBytes), never from this text.
async function readDocxText(filePath) {
  const mammoth = require('mammoth');
  const stat = fs.statSync(filePath);
  const result = await mammoth.extractRawText({ buffer: await readDocxBuffer(filePath) });
  return { body: String(result.value || '').replace(/\r\n/g, '\n'), mtime: stat.mtimeMs, size: stat.size };
}

function mtimeOf(filePath) {
  try { return fs.statSync(filePath).mtimeMs; } catch (_) { return null; }
}

// Case-insensitive, separator-normalised identity for paths on Windows.
function pathKey(p) {
  return path.resolve(String(p)).replace(/\//g, '\\').toLowerCase();
}

// The files that steer coding agents on this machine: global and per-project instruction files, plus the
// user's Claude Code commands, output styles, and memory notes. Scans one level of project folders under home.
function discoverAgentFiles(opts) {
  opts = opts || {};
  const home = opts.home || os.homedir();
  const out = [];
  const seen = new Set();
  const add = (filePath, label) => {
    if (!filePath || !fs.existsSync(filePath)) return;
    const key = pathKey(filePath);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ filePath: path.resolve(filePath), label });
  };
  const claudeDir = path.join(home, '.claude');
  add(path.join(claudeDir, 'CLAUDE.md'), 'CLAUDE.md — global (same file as AGENTS.md)');
  // ~/.claude/AGENTS.md is a hard link of CLAUDE.md on this machine; one note covers both. Add it only if it is a separate file.
  try {
    const a = path.join(claudeDir, 'AGENTS.md'), c = path.join(claudeDir, 'CLAUDE.md');
    if (fs.existsSync(a) && fs.existsSync(c) && fs.statSync(a).ino !== fs.statSync(c).ino) add(a, 'AGENTS.md — global');
  } catch (_) { /* ignore */ }
  add(path.join(home, '.codex', 'AGENTS.md'), 'AGENTS.md — Codex global');
  for (const sub of ['commands', 'output-styles', 'rules', 'agents']) {
    const dir = path.join(claudeDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of safeList(dir)) if (/\.md$/i.test(f)) add(path.join(dir, f), f + ' — Claude ' + sub.replace('-', ' '));
  }
  const memDir = path.join(claudeDir, 'projects');
  for (const proj of safeList(memDir)) {
    const m = path.join(memDir, proj, 'memory');
    // Project folders are named after the path, e.g. "C--Users-celes-tennis"; keep the tail as the label.
    const slug = proj.replace(/^[A-Za-z]--Users-[^-]+-?/, '') || 'home';
    for (const f of safeList(m)) if (/\.md$/i.test(f)) add(path.join(m, f), f + ' — Claude memory (' + slug + ')');
  }
  const skip = new Set(['node_modules', '.git', 'AppData', '.vscode', '.cursor', 'scoop', 'pipx', 'curseforge', 'OneDrive']);
  const roots = [home].concat(opts.extraRoots || []);
  for (const root of roots) {
    for (const entry of safeList(root)) {
      if (skip.has(entry) || entry.startsWith('.')) continue;
      const dir = path.join(root, entry);
      let isDir = false;
      try { isDir = fs.statSync(dir).isDirectory(); } catch (_) { continue; }
      if (!isDir) continue;
      for (const name of ['CLAUDE.md', 'AGENTS.md', 'CLAUDE.local.md', 'CODEX.md', 'GEMINI.md']) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) {
          const other = name === 'CLAUDE.md' ? path.join(dir, 'AGENTS.md') : null;
          let dup = false;
          try { if (other && fs.existsSync(other) && fs.statSync(other).ino === fs.statSync(p).ino) dup = true; } catch (_) { /* ignore */ }
          add(p, name + ' — ' + entry + (dup ? ' (same file as AGENTS.md)' : ''));
        }
      }
      const nested = path.join(dir, '.claude', 'CLAUDE.md');
      if (fs.existsSync(nested)) add(nested, 'CLAUDE.md — ' + entry + '/.claude');
      const fieldGuide = path.join(dir, '.field-guide', 'CLAUDE.md');
      if (fs.existsSync(fieldGuide)) add(fieldGuide, 'CLAUDE.md — ' + entry + '/.field-guide');
    }
  }
  return out;
}

function safeList(dir) {
  try { return fs.readdirSync(dir); } catch (_) { return []; }
}

module.exports = { kindOf, extOf, readText, writeTextInPlace, readDocxText, readDocxBuffer, mtimeOf, pathKey, discoverAgentFiles, TEXT_EXT };
