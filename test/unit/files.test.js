'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('../../src/files');
const { Store } = require('../../src/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notes-files-'));

test('kindOf: extensions, sniffing, pdf and docx', () => {
  const dir = tmp();
  const md = path.join(dir, 'a.md'); fs.writeFileSync(md, '# hi');
  const noext = path.join(dir, 'Makefile'); fs.writeFileSync(noext, 'all:\n\techo');
  const bin = path.join(dir, 'blob.dat'); fs.writeFileSync(bin, Buffer.from([1, 2, 0, 4]));
  const pdf = path.join(dir, 'x.pdf'); fs.writeFileSync(pdf, '%PDF-1.4');
  const docx = path.join(dir, 'x.docx'); fs.writeFileSync(docx, 'PK');
  assert.equal(F.kindOf(md), 'text');
  assert.equal(F.kindOf(noext), 'text');
  assert.equal(F.kindOf(bin), 'binary');
  assert.equal(F.kindOf(pdf), 'pdf');
  assert.equal(F.kindOf(docx), 'docx');
  assert.equal(F.extOf('C:\\x\\notes.TXT'), 'txt');
});

test('writeTextInPlace keeps hard links joined and preserves CRLF files', () => {
  const dir = tmp();
  const a = path.join(dir, 'CLAUDE.md');
  const b = path.join(dir, 'AGENTS.md');
  fs.writeFileSync(a, 'one\r\ntwo\r\n');
  fs.linkSync(a, b);
  const inoBefore = fs.statSync(a).ino;
  F.writeTextInPlace(a, 'one\nTWO\nthree\n');
  assert.equal(fs.statSync(a).ino, inoBefore, 'same inode: written in place');
  assert.equal(fs.statSync(b).ino, inoBefore, 'the other name still points at it');
  assert.equal(fs.readFileSync(b, 'utf8'), 'one\r\nTWO\r\nthree\r\n', 'CRLF kept, visible through the other link');
  const lf = path.join(dir, 'lf.md');
  fs.writeFileSync(lf, 'a\nb\n');
  F.writeTextInPlace(lf, 'a\nb\nc\n');
  assert.equal(fs.readFileSync(lf, 'utf8'), 'a\nb\nc\n');
});

test('store.linkFile loads text, edits write through, external edits are picked up, same file links once', async () => {
  const dir = tmp();
  const file = path.join(dir, 'notes.md');
  fs.writeFileSync(file, '# Title\n\nbody\n');
  const store = new Store(path.join(dir, 'data')).load();
  const n = await store.linkFile(file);
  assert.equal(n.filePath, path.resolve(file));
  assert.equal(n.fileKind, 'text');
  assert.equal(n.title, 'notes.md');
  assert.equal(n.body, '# Title\n\nbody\n');
  store.update(n.id, { body: '# Title\n\nedited\n' });
  assert.equal(fs.readFileSync(file, 'utf8'), '# Title\n\nedited\n', 'edit written to the file');
  const again = await store.linkFile(file.toUpperCase());
  assert.equal(again.id, n.id, 'case-insensitive dedupe');
  assert.equal(store.list().length, 1);
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(file, 'changed outside\n');
  const r1 = await store.refreshFileNote(n.id);
  assert.equal(r1.changed, true);
  assert.equal(store.get(n.id).body, 'changed outside\n');
  const r2 = await store.refreshFileNote(n.id);
  assert.equal(r2.changed, false);
  store.trash(n.id);
  assert.ok(fs.existsSync(file), 'trash does not touch the file');
  const relinked = await store.linkFile(file);
  assert.equal(relinked.id, n.id);
  assert.equal(store.get(n.id).trashedAt, null, 'linking a trashed file note restores it');
  store.destroy(n.id);
  assert.ok(fs.existsSync(file), 'destroy only removes the link');
  assert.deepEqual(await store.refreshFileNote(n.id), { changed: false, missing: false }, 'unknown id is a no-op');
  const other = path.join(dir, 'other.md');
  fs.writeFileSync(other, 'temp');
  const o = await store.linkFile(other);
  fs.rmSync(other);
  assert.deepEqual(await store.refreshFileNote(o.id), { changed: false, missing: true }, 'deleted file is reported missing, note kept');
  assert.equal(store.get(o.id).body, 'temp');
});

test('non-UTF-8 text is linked read-only instead of being transcoded; BOM is preserved', async () => {
  const dir = tmp();
  const latin1 = path.join(dir, 'latin1.txt');
  fs.writeFileSync(latin1, Buffer.from([0x63, 0x61, 0x66, 0xe9])); // "café" in Latin-1
  const utf16 = path.join(dir, 'wide.txt');
  fs.writeFileSync(utf16, Buffer.from('﻿hello', 'utf16le'));
  const bom = path.join(dir, 'bom.md');
  fs.writeFileSync(bom, '﻿# Title\n', 'utf8');
  const store = new Store(path.join(dir, 'data')).load();
  const a = await store.linkFile(latin1);
  assert.equal(a.fileKind, 'binary', 'Latin-1 is not rewritten as UTF-8');
  assert.throws(() => store.update(a.id, { body: 'x' }), /read-only/);
  assert.deepEqual(Array.from(fs.readFileSync(latin1)), [0x63, 0x61, 0x66, 0xe9], 'bytes untouched');
  const w = await store.linkFile(utf16);
  assert.equal(w.fileKind, 'binary');
  const b = await store.linkFile(bom);
  assert.equal(b.fileKind, 'text');
  assert.equal(b.body, '# Title\n', 'BOM not part of the text');
  store.update(b.id, { body: '# Title\n\nmore\n' });
  const bytes = fs.readFileSync(bom);
  assert.deepEqual(Array.from(bytes.slice(0, 3)), [0xef, 0xbb, 0xbf], 'BOM kept on write');
  assert.equal(bytes.slice(3).toString('utf8'), '# Title\n\nmore\n');
});

test('a metadata save failure after a successful file write keeps the cache equal to the file', async () => {
  const dir = tmp();
  const file = path.join(dir, 'n.md');
  fs.writeFileSync(file, 'one\n');
  const store = new Store(path.join(dir, 'data')).load();
  const n = await store.linkFile(file);
  const realSave = store.save.bind(store);
  store.save = () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); };
  assert.throws(() => store.update(n.id, { title: 'renamed', body: 'two\n' }), /ENOSPC/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'two\n', 'the file write landed');
  assert.equal(store.get(n.id).body, 'two\n', 'cache mirrors the file, not the stale pre-write text');
  assert.equal(store.get(n.id).title, 'n.md', 'title rolled back (not persisted)');
  store.save = realSave;
  assert.deepEqual(await store.refreshFileNote(n.id), { changed: false, missing: false }, 'no spurious change detected');
});

test('store.linkFile: binary and pdf are read-only, missing files are rejected', async () => {
  const dir = tmp();
  const pdf = path.join(dir, 'doc.pdf'); fs.writeFileSync(pdf, '%PDF-1.4 fake');
  const store = new Store(path.join(dir, 'data')).load();
  const n = await store.linkFile(pdf);
  assert.equal(n.fileKind, 'pdf');
  assert.equal(n.body, '');
  assert.throws(() => store.update(n.id, { body: 'nope' }), /read-only/);
  assert.equal(fs.readFileSync(pdf, 'utf8'), '%PDF-1.4 fake');
  store.update(n.id, { title: 'My PDF', tags: ['docs'] });
  assert.equal(store.get(n.id).title, 'My PDF');
  await assert.rejects(store.linkFile(path.join(dir, 'missing.md')), /not found/);
});

test('discoverAgentFiles finds global and per-project instruction files and labels hard-linked pairs once', () => {
  const home = tmp();
  const claude = path.join(home, '.claude');
  fs.mkdirSync(path.join(claude, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'projects', 'C--Users-me-tennis', 'memory'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'projects', 'P', 'memory'), { recursive: true });
  fs.writeFileSync(path.join(claude, 'projects', 'C--Users-me-tennis', 'memory', 'MEMORY.md'), 'mem');
  fs.writeFileSync(path.join(claude, 'CLAUDE.md'), 'global');
  fs.linkSync(path.join(claude, 'CLAUDE.md'), path.join(claude, 'AGENTS.md'));
  fs.writeFileSync(path.join(claude, 'commands', 'review.md'), 'cmd');
  fs.writeFileSync(path.join(claude, 'projects', 'P', 'memory', 'MEMORY.md'), 'mem');
  fs.mkdirSync(path.join(home, 'proj', '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, 'proj', 'CLAUDE.md'), 'p');
  fs.writeFileSync(path.join(home, 'proj', 'AGENTS.md'), 'different');
  fs.writeFileSync(path.join(home, 'proj', '.claude', 'CLAUDE.md'), 'nested');
  fs.mkdirSync(path.join(home, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(home, 'node_modules', 'x', 'CLAUDE.md'), 'skip');
  const found = F.discoverAgentFiles({ home });
  const labels = found.map((f) => f.label);
  assert.ok(labels.includes('CLAUDE.md — global (same file as AGENTS.md)'));
  assert.ok(!labels.some((l) => l === 'AGENTS.md — global'), 'hard-linked AGENTS.md is not listed twice');
  assert.ok(labels.includes('review.md — Claude commands'));
  assert.ok(labels.includes('MEMORY.md — Claude memory (P)'));
  assert.ok(labels.includes('MEMORY.md — Claude memory (tennis)'), 'project slug derived from the folder name: ' + labels.join(' | '));
  assert.ok(labels.includes('CLAUDE.md — proj'));
  assert.ok(labels.includes('AGENTS.md — proj'));
  assert.ok(labels.includes('CLAUDE.md — proj/.claude'));
  assert.ok(!found.some((f) => f.filePath.includes('node_modules')));
});
