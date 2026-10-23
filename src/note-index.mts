import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { StatementSync } from 'node:sqlite';
import * as H from './shared/helpers.mts';

const INDEX_VERSION = 1;
const GRAM = 3;
const LINK_PREFIX = 'note://';
const LINK_TAIL_MAX = 128;
const MAX_CANDIDATE_SHARE = 0.25;

type IndexNote = Pick<Note, 'id' | 'title' | 'body' | 'tags'>;
type IndexChange = { notes: IndexNote[]; dropped: string[] };
type Row = Record<string, unknown>;

const SCHEMA = [
  'CREATE TABLE notes (rid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, hash TEXT NOT NULL)',
  "CREATE VIRTUAL TABLE grams USING fts5(doc, tokenize='trigram case_sensitive 1', content='', contentless_delete=1, detail='none')",
  "INSERT INTO grams(grams, rank) VALUES('secure-delete', 1)",
  'CREATE TABLE links (rid INTEGER NOT NULL, tail TEXT NOT NULL)',
  'CREATE INDEX links_tail ON links(tail)',
  'CREATE INDEX links_rid ON links(rid)',
  'PRAGMA user_version = ' + INDEX_VERSION,
];

const text = (row: Row | undefined, key: string) => (row && typeof row[key] === 'string' ? row[key] : null);
const integer = (row: Row | undefined, key: string) => (row && (typeof row[key] === 'number' || typeof row[key] === 'bigint') ? Number(row[key]) : null);
const isLoneSurrogate = (c: string) => c.length === 1 && c >= '\uD800' && c <= '\uDFFF';

function indexNoteOf(n: Note): IndexNote {
  return { id: n.id, title: n.title, body: n.lock ? '' : n.body, tags: n.tags };
}

function contentHash(n: IndexNote) {
  return crypto.createHash('sha1').update(JSON.stringify([n.title, n.body, n.tags])).digest('base64');
}

function searchDoc(n: IndexNote) {
  return H.searchHay(n).replace(/\u0000/g, ' ');
}

function linkTails(body: string) {
  const low = body.toLowerCase();
  const tails = new Set<string>();
  for (let at = low.indexOf(LINK_PREFIX); at !== -1; at = low.indexOf(LINK_PREFIX, at + 1)) {
    const start = at + LINK_PREFIX.length;
    const tail = low.slice(start, start + LINK_TAIL_MAX);
    const cut = tail.indexOf('\u0000');
    const kept = cut === -1 ? tail : tail.slice(0, cut);
    if (kept) tails.add(kept);
  }
  return Array.from(tails);
}

function queryGrams(query: string) {
  const grams = new Set<string>();
  for (const token of H.tokenize(query)) {
    if (token.includes('\u0000')) continue;
    const points = Array.from(token);
    if (points.length < GRAM || points.some(isLoneSurrogate)) continue;
    for (let i = 0; i + GRAM <= points.length; i++) grams.add(points.slice(i, i + GRAM).join(''));
  }
  return Array.from(grams);
}

const ftsString = (s: string) => '"' + s.replace(/"/g, '""') + '"';

function removeIndexFiles(file: string) {
  for (const f of [file, file + '-journal', file + '-wal', file + '-shm']) fs.rmSync(f, { force: true });
}

class NoteIndex {
  file: string;
  db: DatabaseSync;
  statements: Record<string, StatementSync>;
  count: number;

  constructor(file: string) {
    this.file = file;
    const opened = NoteIndex._open(file);
    this.db = opened.db;
    this.statements = opened.statements;
    this.count = integer(this.statements.count.get(), 'n') || 0;
  }

  static _open(file: string) {
    try {
      const existing = NoteIndex._existing(file);
      if (existing) return NoteIndex._ready(existing);
    } catch (_) {  }
    removeIndexFiles(file);
    const db = NoteIndex._connect(file);
    try { NoteIndex._create(db); } catch (err) { db.close(); throw err; }
    return NoteIndex._ready(db);
  }

  static _existing(file: string) {
    const db = NoteIndex._connect(file);
    try {
      const version = integer(db.prepare('PRAGMA user_version').get(), 'user_version');
      if (version === INDEX_VERSION) return db;
      const tables = integer(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type IN ('table', 'index')").get(), 'n');
      if (version === 0 && tables === 0) { NoteIndex._create(db); return db; }
    } catch (_) {  }
    db.close();
    return null;
  }

  static _ready(db: DatabaseSync) {
    try {
      db.exec("CREATE VIRTUAL TABLE temp.vocab USING fts5vocab(main, grams, 'row')");
      return { db, statements: NoteIndex._prepare(db) };
    } catch (err) {
      db.close();
      throw err;
    }
  }

  static _connect(file: string) {
    const db = new DatabaseSync(file);
    try { db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = OFF; PRAGMA secure_delete = ON; PRAGMA temp_store = MEMORY;'); } catch (err) { db.close(); throw err; }
    return db;
  }

  static _create(db: DatabaseSync) {
    db.exec('BEGIN');
    try { for (const sql of SCHEMA) db.exec(sql); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  static _prepare(db: DatabaseSync): Record<string, StatementSync> {
    const p = (sql: string) => db.prepare(sql);
    return {
      noteById: p('SELECT rid, hash FROM notes WHERE id = ?'),
      addNote: p('INSERT INTO notes (id, hash) VALUES (?, ?)'),
      setHash: p('UPDATE notes SET hash = ? WHERE rid = ?'),
      dropNote: p('DELETE FROM notes WHERE rid = ?'),
      allNotes: p('SELECT rid, id FROM notes'),
      addGrams: p('INSERT INTO grams (rowid, doc) VALUES (?, ?)'),
      dropGrams: p('DELETE FROM grams WHERE rowid = ?'),
      addLink: p('INSERT INTO links (rid, tail) VALUES (?, ?)'),
      dropLinks: p('DELETE FROM links WHERE rid = ?'),
      match: p('SELECT n.id AS id FROM grams JOIN notes n ON n.rid = grams.rowid WHERE grams MATCH ?'),
      linksFrom: p('SELECT n.id AS id, l.tail AS tail FROM links l JOIN notes n ON n.rid = l.rid WHERE l.tail >= ? ORDER BY l.tail'),
      count: p('SELECT count(*) AS n FROM notes'),
      notesWith: p('SELECT doc FROM temp.vocab WHERE term = ?'),
    };
  }

  _transaction<T>(work: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = work();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      this.count = integer(this.statements.count.get(), 'n') || 0;
      throw err;
    }
  }

  _upsert(n: IndexNote) {
    const s = this.statements;
    const hash = contentHash(n);
    const row = s.noteById.get(n.id);
    let rid = integer(row, 'rid');
    if (rid !== null && text(row, 'hash') === hash) return false;
    if (rid !== null) {
      s.dropGrams.run(rid);
      s.dropLinks.run(rid);
      s.setHash.run(hash, rid);
    } else {
      rid = Number(s.addNote.run(n.id, hash).lastInsertRowid);
      this.count++;
    }
    s.addGrams.run(rid, searchDoc(n));
    for (const tail of linkTails(n.body)) s.addLink.run(rid, tail);
    return true;
  }

  _drop(rid: number) {
    const s = this.statements;
    s.dropGrams.run(rid);
    s.dropLinks.run(rid);
    s.dropNote.run(rid);
    this.count--;
  }

  sync(notes: readonly IndexNote[]) {
    const seen = new Set<string>();
    const changed = this.syncPart(notes, seen);
    return { changed, removed: this.removeUnseen(seen) };
  }

  syncPart(notes: readonly IndexNote[], seen: Set<string>) {
    return this._transaction(() => {
      let changed = 0;
      for (const n of notes) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        if (this._upsert(n)) changed++;
      }
      return changed;
    });
  }

  removeUnseen(seen: ReadonlySet<string>) {
    return this._transaction(() => {
      let removed = 0;
      for (const row of this.statements.allNotes.all()) {
        const id = text(row, 'id'), rid = integer(row, 'rid');
        if (id !== null && rid !== null && !seen.has(id)) { this._drop(rid); removed++; }
      }
      return removed;
    });
  }

  apply(change: IndexChange) {
    this._transaction(() => {
      for (const n of change.notes) this._upsert(n);
      for (const id of change.dropped) {
        const rid = integer(this.statements.noteById.get(id), 'rid');
        if (rid !== null) this._drop(rid);
      }
    });
  }

  candidates(query: string): string[] | null {
    const grams = queryGrams(query);
    if (!grams.length) return null;
    const limit = this.count * MAX_CANDIDATE_SHARE;
    let rarest = Infinity;
    for (const g of grams) rarest = Math.min(rarest, integer(this.statements.notesWith.get(g), 'doc') || 0);
    if (rarest === 0) return [];
    if (rarest > limit) return null;
    const ids = new Set<string>();
    for (const row of this.statements.match.all(grams.map(ftsString).join(' '))) { const id = text(row, 'id'); if (id !== null) ids.add(id); }
    return Array.from(ids);
  }

  incoming(id: string): string[] | null {
    const key = id.toLowerCase();
    if (!key || key.length > LINK_TAIL_MAX || key.includes('\u0000') || Array.from(key).some(isLoneSurrogate)) return null;
    const ids = new Set<string>();
    for (const row of this.statements.linksFrom.iterate(key)) {
      const tail = text(row, 'tail');
      if (tail === null || !tail.startsWith(key)) break;
      const src = text(row, 'id');
      if (src !== null) ids.add(src);
    }
    return Array.from(ids);
  }

  purge() {
    this.db.exec("INSERT INTO grams(grams) VALUES('optimize')");
  }

  size() {
    return this.count;
  }

  close() {
    try { this.db.close(); } catch (_) {  }
  }
}

export { NoteIndex, indexNoteOf, removeIndexFiles, queryGrams, linkTails, INDEX_VERSION };
export type { IndexNote, IndexChange };
