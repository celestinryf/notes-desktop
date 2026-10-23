import path from 'node:path';
import { utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import { isRecord } from './shared/helpers.mts';
import { indexNoteOf } from './note-index.mts';

const ANSWER_TIMEOUT_MS = 2000;
const RESTART_DELAY_MS = 1000;
const MAX_RESTARTS = 3;
const MAX_FAILURES = 3;
const SYNC_PART = 1000;

type Logged = { at: number; ids: readonly string[] | null };
type Waiting = { mark: number; resolve: (ids: Set<string> | null) => void; timer: ReturnType<typeof setTimeout> };
type SyncInfo = { ms: number; postMs: number; changed: number; removed: number; size: number };

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function isReply(v: unknown): v is IndexReply {
  if (!isRecord(v) || typeof v.seq !== 'number') return false;
  if (v.type === 'answer') return v.ids === null || isStrings(v.ids);
  if (v.type === 'synced') return typeof v.changed === 'number' && typeof v.removed === 'number' && typeof v.size === 'number';
  if (v.type === 'purged') return true;
  return v.type === 'failed' && typeof v.error === 'string';
}

class SearchIndex {
  file: string;
  notes: () => readonly Note[];
  child: UtilityProcess | null;
  busy: Set<number>;
  posted: number;
  log: Logged[];
  waiting: Map<number, Waiting>;
  seq: number;
  syncSeq: number;
  syncedFrom: number;
  postMs: number;
  restarts: number;
  failures: number;
  stopped: boolean;
  onReady: ((info: SyncInfo) => void) | null;

  constructor(file: string, notes: () => readonly Note[]) {
    this.file = file;
    this.notes = notes;
    this.child = null;
    this.busy = new Set();
    this.posted = 0;
    this.log = [];
    this.waiting = new Map();
    this.seq = 0;
    this.syncSeq = 0;
    this.syncedFrom = 0;
    this.postMs = 0;
    this.restarts = 0;
    this.failures = 0;
    this.stopped = false;
    this.onReady = null;
  }

  get ready() {
    return !!this.child && this.busy.size === 0;
  }

  start() {
    if (this.stopped || this.child) return;
    const child = utilityProcess.fork(path.join(import.meta.dirname, 'index-process.mts'), [], { serviceName: 'Notes search index', stdio: 'ignore', execArgv: ['--js-flags=--expose-gc'] });
    this.child = child;
    child.on('message', (msg: unknown) => this._reply(msg));
    child.on('exit', () => this._exited(child));
    this._post({ type: 'open', file: this.file });
    this._sync();
  }

  stop() {
    this.stopped = true;
    this.busy.clear();
    this._answerAll();
    const child = this.child;
    this.child = null;
    if (child) child.kill();
  }

  changed(update: IndexUpdate) {
    if (!this.child) return;
    if (update === null) { this._remember(null); this._sync(); return; }
    const ids = update.notes.map((n) => n.id).concat(update.dropped);
    if (!ids.length) return;
    this._remember(ids);
    const seq = ++this.seq;
    if (update.purge) this.busy.add(seq);
    this._post({ type: 'change', seq, notes: update.notes.map(indexNoteOf), dropped: update.dropped.slice(), purge: !!update.purge });
  }

  candidates(query: string | undefined) {
    return query && query.trim() ? this._ask({ type: 'candidates', query }) : Promise.resolve(null);
  }

  incoming(id: string) {
    return this._ask({ type: 'incoming', id });
  }

  _sync() {
    if (this.syncSeq) this.busy.delete(this.syncSeq);
    const seq = this.syncSeq = ++this.seq;
    this.busy.add(seq);
    this.syncedFrom = performance.now();
    const notes = this.notes();
    this._post({ type: 'sync-start', seq });
    for (let i = 0; i < notes.length; i += SYNC_PART) this._post({ type: 'sync-part', seq, notes: notes.slice(i, i + SYNC_PART).map(indexNoteOf) });
    this._post({ type: 'sync-end', seq });
    this.postMs = Math.round(performance.now() - this.syncedFrom);
  }

  _post(msg: IndexRequest) {
    if (this.child) this.child.postMessage(msg);
  }

  _remember(ids: readonly string[] | null) {
    this.posted++;
    if (this.waiting.size) this.log.push({ at: this.posted, ids });
  }

  _ask(msg: { type: 'candidates'; query: string } | { type: 'incoming'; id: string }): Promise<Set<string> | null> {
    if (!this.ready) return Promise.resolve(null);
    const seq = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => this._answer(seq, null), ANSWER_TIMEOUT_MS);
      this.waiting.set(seq, { mark: this.posted, resolve, timer });
      this._post(Object.assign({ seq }, msg));
    });
  }

  _answer(seq: number, ids: readonly string[] | null) {
    const w = this.waiting.get(seq);
    if (!w) return;
    this.waiting.delete(seq);
    clearTimeout(w.timer);
    const later = this.log.filter((e) => e.at > w.mark);
    const oldest = Math.min(...Array.from(this.waiting.values(), (x) => x.mark));
    this.log = this.log.filter((e) => e.at > oldest);
    if (ids === null || later.some((e) => e.ids === null)) { w.resolve(null); return; }
    const out = new Set(ids);
    for (const e of later) for (const id of e.ids || []) out.add(id);
    w.resolve(out);
  }

  _answerAll() {
    for (const seq of Array.from(this.waiting.keys())) this._answer(seq, null);
  }

  _reply(msg: unknown) {
    if (!isReply(msg)) return;
    if (msg.type === 'answer') { this._answer(msg.seq, msg.ids); return; }
    if (msg.type === 'purged') { this.busy.delete(msg.seq); return; }
    if (msg.type === 'synced') {
      if (msg.seq !== this.syncSeq) return;
      this.busy.delete(msg.seq);
      this.failures = 0;
      if (this.onReady) this.onReady({ ms: Math.round(performance.now() - this.syncedFrom), postMs: this.postMs, changed: msg.changed, removed: msg.removed, size: msg.size });
      return;
    }
    console.error('[search-index] ' + msg.error);
    this._answer(msg.seq, null);
    this.busy.clear();
    if (++this.failures > MAX_FAILURES) { this.stop(); return; }
    this._sync();
  }

  _exited(child: UtilityProcess) {
    if (this.child !== child) return;
    this.child = null;
    this.busy.clear();
    this._answerAll();
    if (this.stopped || this.restarts >= MAX_RESTARTS) return;
    this.restarts++;
    setTimeout(() => this.start(), RESTART_DELAY_MS);
  }
}

export { SearchIndex };
