'use strict';
/* Live share: edit one note together in real time over the local network, with no service in between.
   The host runs a tiny HTTP server for that note (state + server-sent events + updates); guests join with
   the link, get a local copy, and every edit on either side is pushed within a few hundred milliseconds.
   Last writer wins at whole-note granularity; the host's state is the reference. Main process only. */
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { URL } = require('url');

const MAX_BODY = 2 * 1024 * 1024;

function lanAddress() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return '127.0.0.1';
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (err) { reject(err); } });
    req.on('error', reject);
  });
}

function sameToken(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

class LiveShare {
  constructor(store, opts) {
    opts = opts || {};
    this.store = store;
    this.onRemote = opts.onRemote || (() => {});   // (noteId, { title, body, from }) after a remote edit landed in the store
    this.onStatus = opts.onStatus || (() => {});   // (noteId, status)
    this.pushDelayMs = opts.pushDelayMs == null ? 250 : opts.pushDelayMs;
    this.sessions = new Map(); // noteId -> session
    this.hosting = new Map();  // noteId -> promise of host() in progress
    this.clientId = crypto.randomBytes(8).toString('hex');
  }

  statusOf(noteId) {
    const s = this.sessions.get(noteId);
    if (!s) return null;
    return { role: s.role, url: s.url, peers: s.role === 'host' ? s.clients.size : (s.connected ? 1 : 0), connected: s.role === 'host' ? true : !!s.connected, version: s.version, error: s.error || null, localOnly: !!s.local, pending: !!s.dirty };
  }

  _emit(noteId) { this.onStatus(noteId, this.statusOf(noteId)); }

  // ---- host ------------------------------------------------------------------

  host(noteId, opts) {
    opts = opts || {};
    const note = this.store.get(noteId);
    if (!note || note.trashedAt) throw new Error('Note not found');
    if (note.lock) throw new Error('A locked note cannot be shared live.');
    if (note.filePath) throw new Error('A file-backed note cannot be shared live; copy it into a plain note first.');
    if (this.sessions.has(noteId)) return Promise.resolve(this.statusOf(noteId));
    if (this.hosting.has(noteId)) return this.hosting.get(noteId); // a second click while the first listen() is pending
    const token = opts.token || crypto.randomBytes(16).toString('hex');
    const session = { role: 'host', token, clients: new Set(), version: 1, server: null, url: null, port: null };
    const server = http.createServer((req, res) => this._handle(session, noteId, req, res));
    server.on('clientError', (_err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (_) { /* ignore */ } });
    const p = new Promise((resolve, reject) => {
      server.once('error', (err) => {
        // The remembered port is taken (after a restart): take any free port; the link changes and the
        // status says so, which is better than a share that silently never comes back.
        if (err && err.code === 'EADDRINUSE' && opts.port) { this.host(noteId, Object.assign({}, opts, { port: 0, movedFrom: opts.port })).then(resolve, reject); return; }
        reject(err);
      });
      server.listen(opts.port || 0, opts.hostname || '0.0.0.0', () => {
        server.removeListener('error', reject);
        session.server = server;
        session.port = server.address().port;
        session.url = 'http://' + (opts.advertise || lanAddress()) + ':' + session.port + '/live/' + token;
        this.sessions.set(noteId, session);
        session.error = opts.movedFrom ? 'Port ' + opts.movedFrom + ' was busy; the link changed, share it again.' : null;
        session.local = (opts.advertise || lanAddress()) === '127.0.0.1';
        this.store.setLive(noteId, { role: 'host', url: session.url, token, port: session.port });
        this._emit(noteId);
        resolve(this.statusOf(noteId));
      });
    });
    this.hosting.set(noteId, p);
    p.finally(() => { if (this.hosting.get(noteId) === p) this.hosting.delete(noteId); }).catch(() => {});
    return p;
  }

  _state(noteId, session) {
    const n = this.store.get(noteId);
    return { id: noteId, title: n ? n.title : '', body: n ? n.body : '', version: session.version, updatedAt: n ? n.updatedAt : 0 };
  }

  async _handle(session, noteId, req, res) {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean); // ['live', token, ('events')?]
    res.setHeader('Cache-Control', 'no-store');
    if (parts[0] !== 'live' || !sameToken(parts[1], session.token)) { res.statusCode = 404; res.end('not found'); return; }
    const note = this.store.get(noteId);
    if (!note || note.trashedAt) { res.statusCode = 410; res.end('gone'); return; }
    if (req.method === 'GET' && parts[2] === 'events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write('retry: 1000\n\n');
      res.write('event: state\ndata: ' + JSON.stringify(this._state(noteId, session)) + '\n\n');
      session.clients.add(res);
      this._emit(noteId);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) { /* closed */ } }, 15000);
      req.on('close', () => { clearInterval(ping); session.clients.delete(res); this._emit(noteId); });
      return;
    }
    if (req.method === 'GET' && !parts[2]) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this._state(noteId, session)));
      return;
    }
    if (req.method === 'POST' && !parts[2]) {
      if (!/^application\/json/i.test(String(req.headers['content-type'] || ''))) { res.statusCode = 415; res.end('send application/json'); return; }
      if (note.lock || note.filePath) { res.statusCode = 410; res.end('gone'); this.stop(noteId); return; }
      let data;
      try { data = await readJson(req, MAX_BODY); } catch (err) { res.statusCode = 400; res.end(String(err.message)); return; }
      const patch = {};
      if (typeof data.title === 'string') patch.title = data.title.slice(0, 2000);
      if (typeof data.body === 'string') patch.body = data.body.slice(0, MAX_BODY);
      try { this.store.update(noteId, patch); } catch (err) { res.statusCode = 409; res.end('The host could not apply that change.'); return; }
      session.version++;
      this.onRemote(noteId, { title: patch.title, body: patch.body, from: String(data.clientId || 'guest') });
      this._broadcast(session, noteId, data.clientId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: session.version }));
      return;
    }
    res.statusCode = 405; res.end('method not allowed');
  }

  _broadcast(session, noteId, exceptClientId) {
    const payload = 'event: state\ndata: ' + JSON.stringify(Object.assign(this._state(noteId, session), { from: exceptClientId || 'host' })) + '\n\n';
    for (const res of session.clients) { try { res.write(payload); } catch (_) { session.clients.delete(res); } }
  }

  // ---- guest -----------------------------------------------------------------

  // Joins a share: fetches the note, creates a local copy flagged live, then follows the event stream.
  async join(url, opts) {
    opts = opts || {};
    const parsed = new URL(String(url).trim());
    if (!/^https?:$/.test(parsed.protocol) || !/^\/live\/[0-9a-f]{16,}$/i.test(parsed.pathname)) throw new Error('That is not a live share link.');
    let note, version = 0;
    if (opts.resume) {
      // After a restart: keep the local copy as it is; the first state from the host (or our own pending
      // push, when edits were made offline) brings the two sides together.
      note = this.store.get(opts.noteId);
      if (!note) throw new Error('Note not found');
    } else {
      const initial = await this._fetch(parsed.toString(), 'GET');
      note = opts.noteId ? this.store.get(opts.noteId) : this.store.create({ title: initial.title, body: initial.body, folderId: opts.folderId || null });
      if (!note) throw new Error('Note not found');
      if (opts.noteId) this.store.update(note.id, { title: initial.title, body: initial.body });
      version = initial.version;
    }
    const session = { role: 'guest', url: parsed.toString(), version, connected: false, req: null, retry: 0, pushTimer: null, pushing: false, dirty: !!opts.pending, pendingFlag: !!opts.pending, stopped: false, lastByteAt: 0 };
    this.sessions.set(note.id, session);
    this.store.setLive(note.id, { role: 'guest', url: session.url, pending: !!opts.pending });
    this._listen(note.id, session);
    if (session.dirty) this.noteChanged(note.id);
    return { noteId: note.id, status: this.statusOf(note.id) };
  }

  _fetch(url, method, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const data = body == null ? null : Buffer.from(JSON.stringify(body));
      const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}, timeout: 8000 }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) return reject(new Error(res.statusCode === 410 ? 'The host ended the share.' : (text || 'HTTP ' + res.statusCode)));
          try { resolve(JSON.parse(text)); } catch (err) { reject(err); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('timed out')));
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  _listen(noteId, session) {
    if (session.stopped) return;
    const u = new URL(session.url);
    const req = http.get({ hostname: u.hostname, port: u.port, path: u.pathname + '/events', headers: { Accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode === 404 || res.statusCode === 410) { res.resume(); this._ended(noteId, session); return; } // the share no longer exists
      if (res.statusCode !== 200) { res.resume(); this._scheduleReconnect(noteId, session, 'HTTP ' + res.statusCode); return; }
      session.connected = true; session.retry = 0; session.error = null; session.fresh = true; session.lastByteAt = Date.now();
      this._emit(noteId);
      // A host that vanished without closing the socket (sleep, Wi-Fi) is noticed by the missing pings.
      clearInterval(session.idleTimer);
      session.idleTimer = setInterval(() => { if (Date.now() - session.lastByteAt > 35000) { try { req.destroy(new Error('No data from the host')); } catch (_) { /* ignore */ } } }, 5000);
      if (session.idleTimer.unref) session.idleTimer.unref();
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        session.lastByteAt = Date.now();
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const lines = frame.split('\n');
          const eventLine = lines.find((x) => x.startsWith('event: '));
          if (eventLine && eventLine.slice(7).trim() === 'end') { this._ended(noteId, session); return; }
          const dataLine = lines.find((x) => x.startsWith('data: '));
          if (!dataLine) continue;
          try { this._onState(noteId, session, JSON.parse(dataLine.slice(6))); } catch (_) { /* ignore a bad frame */ }
        }
      });
      res.on('end', () => { clearInterval(session.idleTimer); this._scheduleReconnect(noteId, session, 'Connection closed'); });
      res.on('error', (err) => this._scheduleReconnect(noteId, session, err.message));
    });
    req.on('error', (err) => this._scheduleReconnect(noteId, session, err.message));
    session.req = req;
  }

  // The host said the share is over (or it no longer exists): the local note stays, as an ordinary note.
  _ended(noteId, session) {
    if (session.stopped) return;
    this.stop(noteId);
    this.onStatus(noteId, { role: 'guest', url: session.url, peers: 0, connected: false, version: session.version, error: null, ended: true });
  }

  _scheduleReconnect(noteId, session, why) {
    if (session.stopped) return;
    if (session.timer) return; // a destroyed request reports on both req and res; one reconnect is enough
    clearInterval(session.idleTimer);
    session.connected = false; session.error = why;
    this._emit(noteId);
    const delay = Math.min(10000, 1000 * Math.pow(2, Math.min(session.retry++, 4)));
    session.timer = setTimeout(() => { session.timer = null; this._listen(noteId, session); }, delay);
    if (session.timer.unref) session.timer.unref();
  }

  _onState(noteId, session, state) {
    if (!state || typeof state.version !== 'number') return;
    // The first state after (re)connecting is authoritative whatever its number: a restarted host counts
    // from one again. Later frames must not go backwards.
    const first = session.fresh;
    session.fresh = false;
    if (state.from === this.clientId) { session.version = Math.max(session.version, state.version); return; } // our own edit echoed back
    if (!first && state.version < session.version) return; // stale
    session.version = state.version;
    // Unpushed local edits are newer than anything the host can send; they go up first and come back as
    // the new state, so a reconnect never silently discards what was typed offline.
    if (session.dirty || session.pushing) { if (session.dirty && !session.pushTimer) this.noteChanged(noteId); return; }
    const note = this.store.get(noteId);
    if (!note) return;
    if (note.title === state.title && note.body === state.body) return;
    try { this.store.update(noteId, { title: state.title, body: state.body }); } catch (_) { return; }
    this.onRemote(noteId, { title: state.title, body: state.body, from: state.from || 'host' });
  }

  // ---- edits from this side ---------------------------------------------------

  // Called after a local edit of a note went into the store (through the app's normal save path).
  noteChanged(noteId) {
    const session = this.sessions.get(noteId);
    if (!session) return;
    if (session.role === 'host') { session.version++; this._broadcast(session, noteId, 'host'); return; }
    session.dirty = true;
    clearTimeout(session.pushTimer);
    session.pushTimer = setTimeout(() => { session.pushTimer = null; this._push(noteId, session); }, this.pushDelayMs);
  }

  async _push(noteId, session) {
    if (session.pushing || !session.dirty || session.stopped) return;
    session.pushing = true; session.dirty = false;
    const note = this.store.get(noteId);
    try {
      const r = await this._fetch(session.url, 'POST', { title: note.title, body: note.body, clientId: this.clientId, base: session.version });
      session.version = Math.max(session.version, r.version || 0);
      session.error = null;
      if (session.pendingFlag) { session.pendingFlag = false; try { this.store.setLive(noteId, { role: 'guest', url: session.url, pending: false }); } catch (_) { /* paused */ } }
    } catch (err) {
      if (/ended the share|HTTP 404/.test(err.message)) { this._ended(noteId, session); return; }
      session.dirty = true; session.error = 'push: ' + err.message;
      // Remember on the note that an edit is waiting, so a restart pushes it instead of taking the host's text.
      if (!session.pendingFlag) { session.pendingFlag = true; try { this.store.setLive(noteId, { role: 'guest', url: session.url, pending: true }); } catch (_) { /* paused */ } }
      session.pushTimer = setTimeout(() => { session.pushTimer = null; this._push(noteId, session); }, 2000);
    } finally {
      session.pushing = false;
      this._emit(noteId);
      if (session.dirty && !session.pushTimer) this.noteChanged(noteId);
    }
  }

  // Waits for a guest's pending push (used before quit).
  async flush(noteId) {
    const s = this.sessions.get(noteId);
    if (!s || s.role !== 'guest') return;
    clearTimeout(s.pushTimer); s.pushTimer = null;
    if (s.dirty) await this._push(noteId, s);
  }

  // ---- stop ------------------------------------------------------------------

  // Ends the share for this note. The note itself stays, as an ordinary note, on every side.
  stop(noteId) {
    const s = this.sessions.get(noteId);
    if (!s) {
      // A flag with no session (a resume that failed): clearing it is exactly what Stop is for.
      const n = this.store.get(noteId);
      if (n && n.live) { try { this.store.setLive(noteId, null); } catch (_) { /* paused */ } this.onStatus(noteId, null); return true; }
      return false;
    }
    this.sessions.delete(noteId);
    if (s.role === 'host') {
      for (const res of s.clients) { try { res.write('event: end\ndata: {}\n\n'); res.end(); } catch (_) { /* ignore */ } }
      s.clients.clear();
      try { s.server.close(); s.server.closeAllConnections(); } catch (_) { /* ignore */ }
    } else {
      s.stopped = true;
      clearTimeout(s.timer); clearTimeout(s.pushTimer); clearInterval(s.idleTimer);
      if (s.req) { try { s.req.destroy(); } catch (_) { /* ignore */ } }
    }
    try { this.store.setLive(noteId, null); } catch (_) { /* paused */ }
    this.onStatus(noteId, null);
    return true;
  }

  stopAll() {
    for (const id of Array.from(this.sessions.keys())) this.stop(id);
  }

  // Brings back sessions recorded on notes (after a restart): hosts listen again, guests reconnect.
  async restore() {
    for (const n of this.store.notes) {
      if (!n.live || n.trashedAt) continue;
      try {
        if (n.live.role === 'host') await this.host(n.id, { token: n.live.token, port: n.live.port });
        else await this.join(n.live.url, { noteId: n.id, resume: true, pending: !!n.live.pending });
      } catch (err) {
        // A port in use or an unreachable host: keep the flag so the user can stop or retry it, report the error.
        this.onStatus(n.id, { role: n.live.role, url: n.live.url, peers: 0, connected: false, version: 0, error: err.message });
      }
    }
  }
}

module.exports = { LiveShare, lanAddress };
