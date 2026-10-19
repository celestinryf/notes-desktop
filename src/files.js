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

// Shared with the renderer: the code editor picks its language by extOf, and both sides agree on which file is which.
const { extOf, WORD_EXT, OOXML_EXT, IMAGE_EXT, IMAGE_MIME } = require('./shared/helpers');

// Returns 'text' | 'pdf' | 'docx' (any Word document WordCraft opens) | 'image' | 'binary'. Text is decided by
// extension, then by sniffing for NUL bytes.
function kindOf(filePath) {
  const ext = extOf(filePath);
  if (ext === 'pdf') return 'pdf';
  if (WORD_EXT.has(ext)) return 'docx';
  if (IMAGE_EXT.has(ext)) return 'image';
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
// library is allowed to open it. want: names of parts to hand back, inflated ({ name: Buffer }).
async function assertSafeZip(buf, want) {
  const parts = {};
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
    const name = buf.toString('utf8', p + 46, Math.min(buf.length, p + 46 + buf.readUInt16LE(p + 28)));
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw zipError('This Word document is damaged (bad zip entry).');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + packed > buf.length) throw zipError('This Word document is damaged (truncated).');
    let data = null;
    if (method === 0) { total += packed; data = buf.subarray(start, start + packed); }
    else if (method === 8) {
      try { data = await inflateRaw(buf.subarray(start, start + packed), { maxOutputLength: MAX_ZIP_UNPACKED - total + 1 }); total += data.length; }
      catch (err) {
        if (err.code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) throw zipError(TOO_BIG_UNPACKED);
        throw zipError('This Word document is damaged (' + err.message + ').');
      }
    } else throw zipError('This Word document uses a compression Notes does not open.');
    if (total > MAX_ZIP_UNPACKED) throw zipError(TOO_BIG_UNPACKED);
    if (want && want.includes(name)) parts[name] = data;
  }
  return parts;
}

// Word documents that are zips (Word's own formats, and ODT), so the zip guard runs on them.
const isZipWord = (filePath) => OOXML_EXT.has(extOf(filePath)) || extOf(filePath) === 'odt';

// The bytes of a Word document, checked for size and (for the zip formats) for zip bombs. Everything that opens a Word
// document goes through here.
async function readDocxBuffer(filePath) {
  if (fs.statSync(filePath).size > MAX_DOCX_BYTES) throw Object.assign(new Error('This Word document is larger than 50 MB; use "Open with…" for it.'), { code: 'ETOOBIG' });
  const buf = fs.readFileSync(filePath);
  if (isZipWord(filePath)) await assertSafeZip(buf);
  return buf;
}

// The plain text of a Word document, kept as the note's body for search, the list snippet and links. The document
// itself is shown from its own bytes (files:docxBytes), never from this text.
// Word's zip formats are read by mammoth, ODT and RTF by the small readers below; the old binary .doc gives no text
// (WordCraft still opens it in full).
async function readDocxText(filePath) {
  const stat = fs.statSync(filePath);
  const ext = extOf(filePath);
  let body = '';
  if (OOXML_EXT.has(ext)) {
    const mammoth = require('mammoth');
    body = String((await mammoth.extractRawText({ buffer: await readDocxBuffer(filePath) })).value || '');
  } else if (ext === 'odt') {
    const parts = await assertSafeZip(await readDocxBuffer(filePath), ['content.xml']);
    body = parts['content.xml'] ? odtText(parts['content.xml'].toString('utf8')) : '';
  } else if (ext === 'rtf') {
    body = rtfText(await readDocxBuffer(filePath));
  }
  return { body: body.replace(/\r\n/g, '\n'), mtime: stat.mtimeMs, size: stat.size };
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
  if (e[0] !== '#') return XML_ENTITIES[e.toLowerCase()];
  const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
});

// The text of an ODT's content.xml: paragraphs and headings on their own lines, its tab, space and break elements.
function odtText(xml) {
  const bodyAt = xml.indexOf('<office:body');
  const body = bodyAt >= 0 ? xml.slice(bodyAt) : xml;
  return decodeXml(body
    .replace(/<text:line-break\s*\/>/g, '\n')
    .replace(/<text:tab\s*\/>/g, '\t')
    .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, n) => ' '.repeat(Math.min(Number(n) || 1, 1000)))
    .replace(/<\/text:(p|h)>/g, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/\n{3,}/g, '\n\n').trim();
}

// RTF groups that hold no document text (fonts, colours, styles, metadata, pictures, field codes).
const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'themedata', 'colorschememapping',
  'latentstyles', 'datastore', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'fldinst',
  'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'filetbl', 'revtbl']);
const RTF_CHARS = { emdash: '\u2014', endash: '\u2013', lquote: '\u2018', rquote: '\u2019', ldblquote: '\u201c', rdblquote: '\u201d', bullet: '\u2022' };
const CP1252 = new TextDecoder('windows-1252');

// The text of an RTF document, for the note's search text and list snippet (the document itself is shown by WordCraft).
function rtfText(buf) {
  const s = buf.toString('latin1');
  let out = '', skip = false, uc = 1, pending = 0;
  const stack = [];
  const put = (text) => { if (skip) return; if (pending > 0) { pending--; return; } out += text; };
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '{') { stack.push(skip); i++; continue; }
    if (c === '}') { skip = stack.length ? stack.pop() : false; i++; continue; }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (c !== '\\') { put(c); i++; continue; }
    const n = s[i + 1];
    if (n === '\\' || n === '{' || n === '}') { put(n); i += 2; continue; }
    if (n === '*') { skip = true; i += 2; continue; } // an ignorable destination: its group holds no text
    if (n === "'") { put(CP1252.decode(Uint8Array.of(parseInt(s.substr(i + 2, 2), 16) || 0x3f))); i += 4; continue; }
    if (n === '~') { put('\u00a0'); i += 2; continue; }
    if (n === '\r' || n === '\n') { if (!skip) out += '\n'; i += 2; continue; }
    const m = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(s.slice(i + 1, i + 46));
    if (!m) { i += 2; continue; }
    i += 1 + m[0].length;
    const word = m[1], arg = m[2] === undefined ? null : parseInt(m[2], 10);
    if (RTF_SKIP.has(word)) { skip = true; continue; }
    if (skip) continue;
    if (word === 'par' || word === 'line' || word === 'row' || word === 'sect' || word === 'page') out += '\n';
    else if (word === 'tab' || word === 'cell') out += '\t';
    else if (word === 'uc') uc = arg === null ? 1 : Math.max(0, arg);
    else if (word === 'u' && arg !== null) { out += String.fromCharCode(arg < 0 ? arg + 65536 : arg); pending = uc; }
    else if (RTF_CHARS[word]) out += RTF_CHARS[word];
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// An image file's bytes and media type, for the image viewer.
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
function readImage(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_IMAGE_BYTES) throw Object.assign(new Error('This image is larger than 64 MB; use "Open with…" for it.'), { code: 'ETOOBIG' });
  return { bytes: fs.readFileSync(filePath), mime: IMAGE_MIME[extOf(filePath)] || 'application/octet-stream', mtime: stat.mtimeMs };
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

module.exports = { kindOf, extOf, readText, writeTextInPlace, readDocxText, readDocxBuffer, readImage, odtText, rtfText, mtimeOf, pathKey, discoverAgentFiles, TEXT_EXT };
