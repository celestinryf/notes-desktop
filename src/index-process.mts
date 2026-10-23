import { NoteIndex, isCorruption, removeIndexFiles } from './note-index.mts';
import type { IndexNote } from './note-index.mts';
import { isRecord } from './shared/helpers.mts';

let index: NoteIndex | null = null;
let file = '';
let syncing: { seq: number; seen: Set<string>; changed: number } | null = null;
const collectGarbage = typeof globalThis.gc === 'function' ? globalThis.gc : () => {};

const send = (msg: IndexReply) => process.parentPort.postMessage(msg);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function indexNotes(v: unknown): IndexNote[] {
  if (!Array.isArray(v)) return [];
  const out: IndexNote[] = [];
  for (const n of v) {
    if (!isRecord(n) || typeof n.id !== 'string' || typeof n.title !== 'string' || typeof n.body !== 'string') continue;
    out.push({ id: n.id, title: n.title, body: n.body, tags: strings(n.tags) });
  }
  return out;
}

function open() {
  if (index) index.close();
  index = new NoteIndex(file);
  return index;
}

function current() {
  return index || open();
}

function read(ask: () => string[] | null) {
  try { return ask(); } catch (err) {
    if (isCorruption(err)) throw err;
    return null;
  }
}

function handle(msg: Record<string, unknown>) {
  const seq = typeof msg.seq === 'number' ? msg.seq : 0;
  if (msg.type === 'open') { file = String(msg.file || ''); open(); return; }
  if (msg.type === 'sync-start') { syncing = { seq, seen: new Set(), changed: 0 }; return; }
  if (msg.type === 'sync-part') {
    if (syncing && syncing.seq === seq) syncing.changed += current().syncPart(indexNotes(msg.notes), syncing.seen);
    collectGarbage();
    return;
  }
  if (msg.type === 'sync-end') {
    if (!syncing || syncing.seq !== seq) return;
    const removed = current().removeUnseen(syncing.seen);
    current().purgeIfPending();
    send({ type: 'synced', seq, changed: syncing.changed, removed, size: current().size() });
    syncing = null;
    return;
  }
  if (msg.type === 'change') {
    current().apply({ notes: indexNotes(msg.notes), dropped: strings(msg.dropped) }, msg.purge === true);
    current().purgeIfPending();
    if (msg.purge === true) send({ type: 'purged', seq });
    return;
  }
  if (msg.type === 'candidates') { send({ type: 'answer', seq, ids: read(() => current().candidates(String(msg.query || ''))) }); return; }
  if (msg.type === 'incoming') { send({ type: 'answer', seq, ids: read(() => current().incoming(String(msg.id || ''), strings(msg.names))) }); return; }
}

process.parentPort.on('message', (e: { data: unknown }) => {
  const msg = e.data;
  if (!isRecord(msg)) return;
  try { handle(msg); } catch (err) {
    send({ type: 'failed', seq: typeof msg.seq === 'number' ? msg.seq : 0, error: err instanceof Error ? err.message : String(err) });
    syncing = null;
    try { if (index) index.close(); index = null; removeIndexFiles(file); open(); } catch (_) { process.exit(1); }
  }
});
