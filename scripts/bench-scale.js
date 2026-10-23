'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { performance, monitorEventLoopDelay } = require('perf_hooks');
const { Store } = require('../src/store.mts');
const { tmpDir } = require('../test/helpers/tmp');

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf('--' + name); return i === -1 ? fallback : args[i + 1]; };
const sizes = (name, fallback) => String(option(name, fallback)).split(',').filter(Boolean).map(Number);
const saveSizes = sizes('save', '1000,10000,50000');
const scanSizes = sizes('scan', '500,2000,5000,20000');
const readSizes = sizes('read', '1000,10000,50000');
const out = option('out', null);

let written = 0;
const writeFileSync = fs.writeFileSync;
fs.writeFileSync = function (file, data, ...rest) {
  written += typeof data === 'string' ? Buffer.byteLength(data) : (data && data.length) || 0;
  return writeFileSync.call(fs, file, data, ...rest);
};

const WORDS = 'the of and to in is that for it as with was on be at by this had not are but from or have an they which one you were all there would their we been has when who will more no if out so said what up its about into than them can only other new some could time these two may then do first any my now such like over even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still own see work long get here between both life being under never day same another know while last might great old year off come since against go came right used take three'.split(' ');
let seed = 12345;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const word = () => WORDS[Math.floor(random() * WORDS.length)];
function noteBody(i) {
  let s = '# Note ' + i + '\n\n';
  while (s.length < 1500) {
    const n = 8 + Math.floor(random() * 10);
    s += Array.from({ length: n }, word).join(' ') + '.\n';
    if (random() < 0.2) s += '\n- [ ] ' + word() + '\n';
  }
  return s;
}

const round = (x) => Math.round(x * 10) / 10;
const median = (xs) => round(xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]);
const gc = () => { if (global.gc) global.gc(); };

async function measure(fn) {
  const delay = monitorEventLoopDelay({ resolution: 5 });
  delay.enable();
  const before = written;
  const start = performance.now();
  const result = await fn();
  const ms = round(performance.now() - start);
  await new Promise((resolve) => setTimeout(resolve, 30));
  delay.disable();
  return { result, ms, stallMs: Math.round(delay.max / 1e6), bytes: written - before };
}

function report(row) {
  const line = JSON.stringify(row);
  console.log(line);
  if (out) fs.appendFileSync(out, line + '\n');
}

function seedLibrary(dir, count) {
  const now = Date.now();
  const notes = Array.from({ length: count }, (_, i) => ({ id: crypto.randomUUID(), title: '', body: noteBody(i), tags: i % 7 ? [] : ['work'], folderId: null, pinned: false, createdAt: now - i * 1000, updatedAt: now - i * 1000, trashedAt: null }));
  fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify({ schemaVersion: 1, settings: { gitEnabled: false }, folders: [], vaults: [], notes }, null, 2));
  return notes.map((n) => n.id);
}

async function benchSaves(count) {
  const dir = tmpDir('notes-bench-save-');
  const ids = seedLibrary(dir, count);
  gc();
  const load = await measure(() => new Store(dir).load());
  const store = load.result;
  const first = await measure(() => store.update(ids[0], { body: 'first save of the session' }));
  const saves = [];
  for (let k = 0; k < 25; k++) {
    const id = ids[Math.floor(random() * ids.length)];
    saves.push(await measure(() => store.update(id, { body: store.get(id).body + '\nedit ' + k })));
  }
  const reads = {};
  for (const [name, fn] of Object.entries({ related: () => store.related(ids[5]), tags: () => store.tags(), outline: () => store.noteOutline(), list: () => store.list().map((n) => store.publicNote(n)) })) {
    const times = [];
    for (let i = 0; i < 5; i++) times.push((await measure(fn)).ms);
    reads[name + 'Ms'] = median(times);
  }
  report(Object.assign({ kind: 'save', notes: count, loadMs: load.ms, firstSaveMs: first.ms, firstSaveBytes: first.bytes, saveMedianMs: median(saves.map((s) => s.ms)), saveMaxMs: Math.max(...saves.map((s) => s.ms)), bytesPerSaveMedian: median(saves.map((s) => s.bytes)), notesJsonBytes: fs.statSync(path.join(dir, 'notes.json')).size }, reads));
}

function makeVault(root, count) {
  for (let i = 0; i < count; i++) {
    const topic = Math.floor(i / 50);
    const dir = path.join(root, 'area-' + Math.floor(topic / 10), 'topic-' + topic);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'note-' + i + '.md'), noteBody(i));
  }
}

async function benchScan(count) {
  const vault = tmpDir('notes-bench-vault-');
  makeVault(vault, count);
  const data = tmpDir('notes-bench-data-');
  const store = new Store(data).load();
  const v = store.addVault({ path: vault, name: 'Bench' });
  gc();
  const first = await measure(() => store.scanVault(v.id));
  const rescan = await measure(() => store.scanVault(v.id));
  const edited = path.join(vault, 'area-0', 'topic-0', 'note-0.md');
  fs.writeFileSync(edited, noteBody(0) + '\nedited\n');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(edited, later, later);
  const targeted = await measure(() => store.scanVault(v.id, { paths: [path.relative(vault, edited)] }));
  const load = await measure(() => new Store(data).load());
  report({ kind: 'scan', files: count, firstScanMs: first.ms, firstScanStallMs: first.stallMs, firstScanBytes: first.bytes, added: first.result.added, rescanMs: rescan.ms, rescanStallMs: rescan.stallMs, oneEditScanMs: targeted.ms, oneEditStallMs: targeted.stallMs, oneEditUpdated: targeted.result.updated, loadMs: load.ms, notesJsonBytes: fs.statSync(path.join(data, 'notes.json')).size });
}

const RARE = 'zebracorn';
const QUERIES = { common: 'the', rare: RARE, twoWords: 'people world', short: 'zq', none: 'qqqxyzzy' };

function seedRichLibrary(dir, count) {
  const now = Date.now();
  const folders = [];
  const areas = Math.max(1, Math.round(count / 500));
  for (let a = 0; a < areas; a++) {
    const area = { id: crypto.randomUUID(), name: 'Area ' + a, parentId: null, createdAt: now };
    folders.push(area);
    for (let t = 0; t < 10; t++) folders.push({ id: crypto.randomUUID(), name: 'Topic ' + a + '.' + t, parentId: area.id, createdAt: now });
  }
  const ids = Array.from({ length: count }, () => crypto.randomUUID());
  const hub = ids[5];
  const notes = ids.map((id, i) => {
    let body = noteBody(i);
    if (i % 5000 === 17) body += '\nA ' + RARE + ' was here.\n';
    if (i % 10 === 0) body += '\nSee [this one](note://' + ids[(i * 7919) % count] + ').\n';
    if (i % 50 === 1) body += '\nBack to [the hub](note://' + hub + ').\n';
    const tags = [];
    if (i % 7 === 0) tags.push('work');
    if (i % 11 === 0) tags.push('idea');
    if (i % 13 === 0) tags.push('tag-' + (i % 40));
    return { id, title: i % 2 ? 'Title ' + word() + ' ' + i : '', body, tags, folderId: i % 5 ? folders[i % folders.length].id : null, pinned: i % 997 === 0, createdAt: now - i * 1000, updatedAt: now - i * 1000, trashedAt: i % 101 === 0 ? now : null };
  });
  fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify({ schemaVersion: 1, settings: { gitEnabled: false }, folders, vaults: [], notes }, null, 2));
  return { ids, hub };
}

const v8 = require('v8');
function ipcCopy(value) {
  const buf = v8.serialize(value);
  v8.deserialize(buf);
  return buf.length;
}

async function medianOf(fn, runs) {
  const times = [];
  let last;
  for (let i = 0; i < (runs || 5); i++) { const m = await measure(fn); times.push(m.ms); last = m.result; }
  return { ms: median(times), result: last };
}

async function benchReads(count) {
  const dir = tmpDir('notes-bench-read-');
  const { hub } = seedRichLibrary(dir, count);
  gc();
  const load = await measure(() => new Store(dir).load());
  const store = load.result;
  const row = { kind: 'read', notes: count, loadMs: load.ms };
  const parts = {
    list: () => ipcCopy(store.rows()),
    counts: () => ipcCopy(store.counts()),
    tags: () => ipcCopy(store.tags()),
    tree: () => ipcCopy(store.folderTree()),
    outline: () => ipcCopy(store.noteOutline()),
  };
  let refreshMs = 0;
  for (const [name, fn] of Object.entries(parts)) {
    const m = await medianOf(fn);
    row[name + 'Ms'] = m.ms;
    row[name + 'Bytes'] = m.result;
    refreshMs += m.ms;
  }
  row.refreshMs = round(refreshMs);
  for (const [name, query] of Object.entries(QUERIES)) {
    const m = await medianOf(() => { const hits = store.rows({ query }); ipcCopy(hits); return hits.length; });
    row['search_' + name + 'Ms'] = m.ms;
    row['search_' + name + 'Hits'] = m.result;
    row['palette_' + name + 'Ms'] = (await medianOf(() => ipcCopy(store.searchIds(query)))).ms;
  }
  const rel = await medianOf(() => store.related(hub));
  row.relatedMs = rel.ms;
  row.relatedIncoming = rel.result.incoming.length;
  row.outlineTitleMs = (await medianOf(() => ipcCopy(store.noteOutline('title')), 3)).ms;
  row.listTitleMs = (await medianOf(() => ipcCopy(store.rows({ sort: 'title' })), 3)).ms;
  report(row);
}

(async () => {
  for (const n of saveSizes) await benchSaves(n);
  for (const n of scanSizes) await benchScan(n);
  for (const n of readSizes) await benchReads(n);
})().catch((err) => { console.error(err); process.exitCode = 1; });
