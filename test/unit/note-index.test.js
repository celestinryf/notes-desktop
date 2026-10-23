'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { NoteIndex, indexNoteOf, queryGrams, INDEX_VERSION } = require('../../src/note-index.mts');
const { Store } = require('../../src/store.mts');
const { tmpDir } = require('../helpers/tmp');

function makeStore() {
  let t = 1_000_000;
  return new Store(tmpDir('notes-index-store-'), { now: () => (t += 1000) }).load();
}

function indexFor(store) {
  const file = path.join(tmpDir('notes-index-'), 'search-index.sqlite');
  const index = new NoteIndex(file);
  index.sync(store.notes.map(indexNoteOf));
  store.onIndexChange = (update) => {
    if (update === null) { index.sync(store.notes.map(indexNoteOf)); return; }
    index.apply({ notes: update.notes.map(indexNoteOf), dropped: update.dropped.slice() }, !!update.purge);
    index.purgeIfPending();
  };
  return index;
}

function fillStore(store, count) {
  for (let i = 0; i < count; i++) store.create({ title: '', body: 'ordinary words about gardens and birds number ' + i + ' and more text to fill pages' });
}

function termsIn(file) {
  const db = new DatabaseSync(file);
  try {
    db.exec("CREATE VIRTUAL TABLE temp.v USING fts5vocab(main, grams, 'row')");
    return new Set(db.prepare('SELECT term FROM temp.v').all().map((r) => r.term));
  } finally { db.close(); }
}

const gramsInBytes = (file, word) => { const buf = fs.readFileSync(file); return queryGrams(word).filter((g) => buf.includes(Buffer.from(g))); };
const linear = (store, query) => store.list({ query }).map((n) => n.id);
const throughIndex = (store, index, query) => { const c = index.candidates(query); return store.list({ query }, c && new Set(c)).map((n) => n.id); };

test('a locked note is indexed by its title and tags only, and its old text leaves the index file', () => {
  const store = makeStore();
  fillStore(store, 150);
  const index = indexFor(store);
  const secret = 'qzxjvkwy';
  const note = store.create({ title: 'Diary', body: 'the vault word is ' + secret, tags: ['private'] });
  assert.deepEqual(index.candidates(secret), [note.id]);
  assert.ok(gramsInBytes(index.file, secret).length >= 4, 'the byte check must see the word before it is locked');

  store.lockNote(note.id, 'correct horse');
  assert.deepEqual(index.candidates(secret), []);
  for (const g of queryGrams(secret)) assert.equal(termsIn(index.file).has(g), false, 'term ' + g + ' left in the index');
  assert.deepEqual(gramsInBytes(index.file, secret), []);
  assert.deepEqual(index.candidates('diary'), [note.id]);
  assert.deepEqual(throughIndex(store, index, 'private'), [note.id]);

  store.unlockNote(note.id, 'correct horse');
  store.update(note.id, { body: 'a second secret wvutsrqp' });
  assert.deepEqual(index.candidates('wvutsrqp'), []);
  for (const g of queryGrams('wvutsrqp')) assert.equal(termsIn(index.file).has(g), false);
  assert.equal(fs.existsSync(index.file + '-journal'), false);
  index.close();
});

test('deleting forever and emptying the trash remove the text from the index file', () => {
  const store = makeStore();
  fillStore(store, 150);
  const index = indexFor(store);
  const one = store.create({ body: 'first gone word zyxwvutq' });
  const two = store.create({ body: 'second gone word pqjxkzmv' });
  store.trash(one.id);
  assert.deepEqual(throughIndex(store, index, 'zyxwvutq'), [], 'trashed notes leave the normal list');
  assert.deepEqual(store.list({ query: 'zyxwvutq', trashed: true }, new Set(index.candidates('zyxwvutq'))).map((n) => n.id), [one.id]);

  store.destroy(one.id);
  assert.deepEqual(index.candidates('zyxwvutq'), []);
  assert.deepEqual(gramsInBytes(index.file, 'zyxwvutq'), []);

  assert.ok(gramsInBytes(index.file, 'pqjxkzmv').length >= 4);
  store.trash(two.id);
  store.emptyTrash();
  assert.deepEqual(index.candidates('pqjxkzmv'), []);
  for (const g of queryGrams('pqjxkzmv')) assert.equal(termsIn(index.file).has(g), false);
  assert.deepEqual(gramsInBytes(index.file, 'pqjxkzmv'), []);
  assert.equal(fs.existsSync(index.file + '-journal'), false);
  index.close();
});

test('an index rebuilt from scratch answers exactly like one kept up to date, and like a full scan', () => {
  const store = makeStore();
  const index = indexFor(store);
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const words = ['Hello', 'zebra', 'İstanbul', 'οδος', 'émile', '😀 smile', 'a"b', "it's", '日本語の文', 'the', 'people', 'world', 'naïve', 'ab'];
  const text = () => Array.from({ length: 2 + Math.floor(rnd() * 12) }, () => pick(words)).join(pick([' ', '\n']));
  const ids = () => store.notes.map((n) => n.id);
  for (let step = 0; step < 300; step++) {
    const r = rnd();
    const some = ids();
    if (r < 0.35 || !some.length) store.create({ title: rnd() < 0.4 ? text() : '', body: text() + (some.length && rnd() < 0.3 ? ' note://' + pick(some) : ''), tags: rnd() < 0.3 ? ['zebra'] : [] });
    else if (r < 0.65) store.update(pick(some), { body: text() + (rnd() < 0.3 ? ' NOTE://' + pick(some) : '') });
    else if (r < 0.72) store.trash(pick(some));
    else if (r < 0.78) store.restore(pick(some));
    else if (r < 0.83) store.destroy(pick(some));
    else if (r < 0.86) { const id = pick(some); if (!store.get(id).lock && !store.get(id).trashedAt) store.lockNote(id, 'pw'); }
    else if (r < 0.88) store.emptyTrash();
    else store.update(pick(some), { tags: rnd() < 0.5 ? ['zebra', 'émile'] : [] });
  }
  const rebuilt = new NoteIndex(path.join(tmpDir('notes-index-rebuilt-'), 'search-index.sqlite'));
  rebuilt.sync(store.notes.map(indexNoteOf));
  const queries = words.concat(['hel', 'zebra the', 'i̇stanbul', 'smile', 'xyz', 'ÉMILE people', 'a"b world']);
  for (const q of queries) {
    assert.deepEqual((index.candidates(q) || []).sort(), (rebuilt.candidates(q) || []).sort(), 'candidates for ' + q);
    assert.deepEqual(throughIndex(store, index, q), linear(store, q), 'list for ' + q);
  }
  for (const id of ids()) {
    assert.deepEqual((index.incoming(id) || []).sort(), (rebuilt.incoming(id) || []).sort(), 'incoming for ' + id);
    assert.deepEqual(store.related(id, undefined, new Set(index.incoming(id) || [])), store.related(id), 'related for ' + id);
  }
  assert.equal(index.size(), store.notes.length);
  index.close();
  rebuilt.close();
});

test('a deleted, damaged or outdated index file is rebuilt empty', () => {
  const dir = tmpDir('notes-index-files-');
  const file = path.join(dir, 'search-index.sqlite');
  const filler = Array.from({ length: 10 }, (_, i) => ({ id: 'f' + i, title: '', body: 'other text ' + i, tags: [] }));
  const notes = [{ id: 'a', title: 'Alpha', body: 'words about gardens', tags: [] }, { id: 'b', title: '', body: 'words about birds', tags: [] }].concat(filler);
  let index = new NoteIndex(file);
  index.sync(notes);
  assert.equal(index.size(), 12);
  index.close();

  fs.rmSync(file);
  index = new NoteIndex(file);
  assert.equal(index.size(), 0);
  index.sync(notes);
  assert.deepEqual(index.candidates('birds'), ['b']);
  index.close();

  fs.writeFileSync(file, 'this is not a database, it is garbage '.repeat(200));
  index = new NoteIndex(file);
  assert.equal(index.size(), 0);
  index.sync(notes);
  assert.deepEqual(index.candidates('gardens'), ['a']);
  index.close();

  const db = new DatabaseSync(file);
  db.exec('PRAGMA user_version = 999');
  db.close();
  index = new NoteIndex(file);
  assert.equal(index.size(), 0);
  index.close();

  fs.rmSync(file);
  const broken = new DatabaseSync(file);
  broken.exec('PRAGMA user_version = ' + INDEX_VERSION + '; CREATE TABLE unrelated (x)');
  broken.close();
  index = new NoteIndex(file);
  assert.equal(index.size(), 0);
  index.sync(notes);
  assert.deepEqual(index.candidates('birds'), ['b']);
  index.close();
});

test('queries the index cannot narrow come back as null, so the caller scans every note', () => {
  const file = path.join(tmpDir('notes-index-null-'), 'search-index.sqlite');
  const index = new NoteIndex(file);
  index.sync(Array.from({ length: 40 }, (_, i) => ({ id: 'n' + i, title: '', body: 'common text ' + (i === 7 ? 'rarebird' : ''), tags: [] })));
  assert.equal(index.candidates('ab'), null, 'two characters cannot use three-character pieces');
  assert.equal(index.candidates('\uDE00xy'), null, 'a broken surrogate pair');
  assert.equal(index.candidates('a\u0000bc'), null, 'a NUL character');
  assert.equal(index.candidates('common'), null, 'a word in every note is cheaper to scan for');
  assert.deepEqual(index.candidates('rarebird'), ['n7']);
  assert.deepEqual(index.candidates('nowhere'), []);
  assert.deepEqual(index.candidates('rarebird common'), ['n7']);
  index.close();
});

test('incoming links follow the substring rule for any id, in any case, and ignore titles', () => {
  const file = path.join(tmpDir('notes-index-links-'), 'search-index.sqlite');
  const index = new NoteIndex(file);
  index.sync([
    { id: 'n1', title: 'note://target-in-title', body: 'see NOTE://N1 and note://abc', tags: [] },
    { id: 'n2', title: '', body: 'two links note://n1x and note://ABCDEF', tags: [] },
    { id: 'n3', title: '', body: 'note://note://abc nested', tags: [] },
    { id: 'n4', title: '', body: 'no links here', tags: [] },
  ]);
  assert.deepEqual(index.incoming('n1').sort(), ['n1', 'n2']);
  assert.deepEqual(index.incoming('ABC').sort(), ['n1', 'n2', 'n3']);
  assert.deepEqual(index.incoming('abcdef'), ['n2']);
  assert.deepEqual(index.incoming('target-in-title'), []);
  assert.deepEqual(index.incoming('n9'), []);
  assert.equal(index.incoming('x'.repeat(200)), null, 'ids longer than a stored link fall back to a scan');
  index.close();
});
