'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Store } = require('../../src/store');
const { LiveShare } = require('../../src/live');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notes-live-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(label, fn, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await fn()) return; await sleep(25); }
  throw new Error('Timed out: ' + label);
}

test('host and guest edit one note in real time; leaving keeps the note on both sides', async () => {
  const hostStore = new Store(tmp()).load();
  const guestStore = new Store(tmp()).load();
  const hostRemote = [], guestRemote = [], statuses = [];
  const hostLive = new LiveShare(hostStore, { onRemote: (id, r) => hostRemote.push(r), onStatus: (id, s) => statuses.push(s), pushDelayMs: 20 });
  const guestLive = new LiveShare(guestStore, { onRemote: (id, r) => guestRemote.push(r), pushDelayMs: 20 });
  const note = hostStore.create({ title: 'Plan', body: 'v1' });
  // Locked notes are refused.
  const locked = hostStore.create({ title: 'L', body: 'x' }); hostStore.lockNote(locked.id, 'pw');
  assert.throws(() => hostLive.host(locked.id), /locked/i);
  const status = await hostLive.host(note.id, { hostname: '127.0.0.1', advertise: '127.0.0.1' });
  assert.match(status.url, /^http:\/\/127\.0\.0\.1:\d+\/live\/[0-9a-f]{32}$/);
  assert.deepEqual(hostStore.get(note.id).live.role, 'host');
  // A wrong token is a 404, not a leak.
  const bad = await new Promise((resolve) => http.get(status.url.replace(/[0-9a-f]{32}$/, 'f'.repeat(32)), (res) => { res.resume(); resolve(res.statusCode); }));
  assert.equal(bad, 404);
  // Not a share link.
  await assert.rejects(guestLive.join('http://127.0.0.1:1/nope'), /not a live share link/i);

  const joined = await guestLive.join(status.url);
  const gNote = guestStore.get(joined.noteId);
  assert.equal(gNote.body, 'v1');
  assert.equal(gNote.live.role, 'guest');
  await until('guest connected', () => guestLive.statusOf(gNote.id).connected);
  await until('host sees a peer', () => hostLive.statusOf(note.id).peers === 1);

  // Host edits -> guest gets it.
  hostStore.update(note.id, { body: 'v2 from host', title: 'Plan!' });
  hostLive.noteChanged(note.id);
  await until('guest received', () => guestStore.get(gNote.id).body === 'v2 from host');
  assert.equal(guestStore.get(gNote.id).title, 'Plan!');
  assert.equal(guestRemote.at(-1).from, 'host');

  // Guest edits -> host gets it, and the guest does not re-apply its own echo.
  guestStore.update(gNote.id, { body: 'v3 from guest' });
  guestLive.noteChanged(gNote.id);
  await until('host received', () => hostStore.get(note.id).body === 'v3 from guest');
  assert.equal(hostRemote.at(-1).from, guestLive.clientId);
  await sleep(100);
  assert.equal(guestRemote.filter((r) => r.body === 'v3 from guest').length, 0, 'own edit not applied as remote');

  // A second guest joins late and gets the current state; a host edit reaches both.
  const guest2Store = new Store(tmp()).load();
  const guest2 = new LiveShare(guest2Store, { pushDelayMs: 20 });
  const j2 = await guest2.join(status.url);
  assert.equal(guest2Store.get(j2.noteId).body, 'v3 from guest');
  await until('two peers', () => hostLive.statusOf(note.id).peers === 2);
  hostStore.update(note.id, { body: 'v4' }); hostLive.noteChanged(note.id);
  await until('both guests', () => guestStore.get(gNote.id).body === 'v4' && guest2Store.get(j2.noteId).body === 'v4');

  // Guest leaves: its note stays, flag cleared, host peer count drops.
  guestLive.stop(gNote.id);
  assert.equal(guestStore.get(gNote.id).live, null);
  assert.equal(guestStore.get(gNote.id).body, 'v4');
  await until('peer left', () => hostLive.statusOf(note.id).peers === 1);

  // Host stops: the remaining guest is told, its note stays and is no longer live.
  hostLive.stop(note.id);
  assert.equal(hostStore.get(note.id).live, null);
  await until('guest2 disconnected', () => !guest2.statusOf(j2.noteId) || !guest2.statusOf(j2.noteId).connected);
  guest2.stop(j2.noteId);
  assert.equal(guest2Store.get(j2.noteId).body, 'v4');
});

test('a guest keeps edits made while the host is unreachable and pushes them when it is back; restore() rehosts on the same port', async () => {
  const hostStore = new Store(tmp()).load();
  const guestStore = new Store(tmp()).load();
  const hostLive = new LiveShare(hostStore, { pushDelayMs: 20 });
  const guestLive = new LiveShare(guestStore, { pushDelayMs: 20 });
  const note = hostStore.create({ title: 'Doc', body: 'a' });
  const status = await hostLive.host(note.id, { hostname: '127.0.0.1', advertise: '127.0.0.1' });
  const joined = await guestLive.join(status.url);
  await until('connected', () => guestLive.statusOf(joined.noteId).connected);
  // Host goes away (server closed, flag kept as if the app crashed).
  const port = hostLive.sessions.get(note.id).port;
  const dead = hostLive.sessions.get(note.id).server;
  dead.close(); dead.closeAllConnections(); // a crash drops the open event streams too
  hostLive.sessions.delete(note.id);
  await until('guest noticed', () => !guestLive.statusOf(joined.noteId).connected);
  guestStore.update(joined.noteId, { body: 'offline edit' });
  guestLive.noteChanged(joined.noteId);
  await sleep(150);
  assert.match(guestLive.statusOf(joined.noteId).error || '', /push/);
  // Host restarts from its persisted flag: same port and token.
  const hostLive2 = new LiveShare(hostStore, { pushDelayMs: 20 });
  await hostLive2.restore();
  assert.equal(hostLive2.sessions.get(note.id).port, port);
  await until('guest reconnected', () => guestLive.statusOf(joined.noteId).connected, 8000);
  await until('offline edit delivered', () => hostStore.get(note.id).body === 'offline edit', 8000);
  guestLive.stop(joined.noteId);
  hostLive2.stop(note.id);
});

test('end event stops the guest cleanly; a stuck flag clears with stop(); a resumed guest pushes offline edits instead of taking the host text; POST needs JSON', async () => {
  const hostStore = new Store(tmp()).load();
  const guestStore = new Store(tmp()).load();
  const statuses = [];
  const hostLive = new LiveShare(hostStore, { pushDelayMs: 20 });
  const guestLive = new LiveShare(guestStore, { pushDelayMs: 20, onStatus: (id, s) => statuses.push(s) });
  const note = hostStore.create({ title: 'N', body: 'host text' });
  const status = await hostLive.host(note.id, { hostname: '127.0.0.1', advertise: '127.0.0.1' });
  const joined = await guestLive.join(status.url);
  await until('connected', () => guestLive.statusOf(joined.noteId).connected);
  // Host stops -> the guest's session ends by itself (no endless reconnect), flag cleared, note kept.
  hostLive.stop(note.id);
  await until('guest ended', () => !guestLive.sessions.has(joined.noteId));
  assert.equal(guestStore.get(joined.noteId).live, null);
  assert.ok(statuses.some((s) => s && s.ended), 'ended status reported');
  assert.equal(guestStore.get(joined.noteId).body, 'host text');
  // A flag without a session (failed resume) is cleared by stop().
  guestStore.setLive(joined.noteId, { role: 'guest', url: status.url });
  assert.equal(guestLive.stop(joined.noteId), true);
  assert.equal(guestStore.get(joined.noteId).live, null);
  // Resume with pending offline edits: the local text wins and reaches the host.
  const note2 = hostStore.create({ title: 'M', body: 'host v1' });
  const s2 = await hostLive.host(note2.id, { hostname: '127.0.0.1', advertise: '127.0.0.1' });
  const local = guestStore.create({ title: 'M', body: 'typed offline' });
  guestStore.setLive(local.id, { role: 'guest', url: s2.url, pending: true });
  const guestLive2 = new LiveShare(guestStore, { pushDelayMs: 20 });
  await guestLive2.restore();
  await until('offline text reached the host', () => hostStore.get(note2.id).body === 'typed offline');
  assert.equal(guestStore.get(local.id).body, 'typed offline', 'local copy not overwritten by the host state');
  await until('pending flag cleared', () => !guestStore.get(local.id).live.pending);
  // POST without a JSON content type is refused.
  const code = await new Promise((resolve) => { const u = new URL(s2.url); const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'text/plain' } }, (res) => { res.resume(); resolve(res.statusCode); }); req.end('{"body":"x"}'); });
  assert.equal(code, 415);
  // Locking a hosted note ends the share for guests (410 on their next push) rather than wiping them.
  hostStore.lockNote(note2.id, 'pw');
  guestStore.update(local.id, { body: 'after lock' }); guestLive2.noteChanged(local.id);
  await until('guest ended after lock', () => !guestLive2.sessions.has(local.id), 8000);
  assert.equal(guestStore.get(local.id).body, 'after lock', 'guest copy intact');
  hostLive.stopAll(); guestLive2.stopAll();
});
