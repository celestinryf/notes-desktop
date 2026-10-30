'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { GitHub, gitAuthEnv, isGitHubHttps, DEFAULT_CLIENT_ID } = require('../../src/github.mts');
const { validRepoName } = require('../../src/shared/helpers.mts');
const { TokenStore, CANNOT_KEEP } = require('../../src/github-token.mts');
const { GitHubSession } = require('../../src/github-session.mts');
const { tmpDir } = require('../helpers/tmp');

const reply = (status, body) => ({ status, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });

function fakeFetch(script) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = script.shift();
    if (!next) throw new Error('unexpected request ' + url);
    if (next.throws) throw new Error('offline');
    if (next.expect) next.expect(url, init);
    return reply(next.status, next.body);
  };
  return { fetch, calls };
}

function client(script, hooks) {
  const f = fakeFetch(script);
  let now = 1000000;
  const gh = new GitHub(Object.assign({ fetch: f.fetch, sleep: async () => {}, now: () => now, clientId: 'cid', webBase: 'https://web.test/', apiBase: 'https://api.test' }, hooks || {}));
  return { gh, calls: f.calls, tick: (ms) => { now += ms; } };
}

const fakeSafe = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from('enc:' + s, 'utf8'),
  decryptString: (b) => { const s = b.toString('utf8'); if (!s.startsWith('enc:')) throw new Error('bad'); return s.slice(4); },
});

test('requestCode posts the client id and scope and reads the device code', async () => {
  const { gh, calls } = client([{ status: 200, body: { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://web.test/login/device', expires_in: 900, interval: 5 } }]);
  const r = await gh.requestCode();
  assert.equal(r.ok, true);
  assert.deepEqual(r.code, { deviceCode: 'dc', userCode: 'ABCD-1234', verificationUri: 'https://web.test/login/device', expiresAt: 1000000 + 900000, intervalMs: 5000 });
  assert.equal(calls[0].url, 'https://web.test/login/device/code');
  assert.equal(calls[0].init.body, 'client_id=cid&scope=repo');
  assert.equal(calls[0].init.headers.Accept, 'application/json');
});

test('requestCode: offline, a refusal and an incomplete answer each give plain words', async () => {
  assert.equal((await client([{ throws: true }]).gh.requestCode()).error, 'Notes could not reach GitHub. Check the connection and try again.');
  assert.equal((await client([{ status: 404, body: { message: 'Not Found' } }]).gh.requestCode()).error, 'GitHub said: Not Found');
  assert.equal((await client([{ status: 200, body: { user_code: 'x' } }]).gh.requestCode()).error, 'GitHub gave an incomplete sign-in code.');
  assert.equal((await client([{ status: 200, body: 'not json' }]).gh.requestCode()).error, 'GitHub did not give a sign-in code (200).');
});

const code = () => ({ deviceCode: 'dc', userCode: 'ABCD-1234', verificationUri: 'u', expiresAt: 1000000 + 900000, intervalMs: 5000 });

test('waitForToken polls through pending and slow_down, then fetches the login', async () => {
  const { gh, calls } = client([
    { status: 200, body: { error: 'authorization_pending' } },
    { status: 200, body: { error: 'slow_down' } },
    { status: 200, body: { error: 'authorization_pending' } },
    { status: 200, body: { access_token: 'tok', token_type: 'bearer', scope: 'repo' } },
    { status: 200, body: { login: 'celestin' }, expect: (url, init) => { assert.equal(url, 'https://api.test/user'); assert.equal(init.headers.Authorization, 'Bearer tok'); } },
  ]);
  const r = await gh.waitForToken(code(), () => false);
  assert.deepEqual(r, { ok: true, token: 'tok', login: 'celestin' });
  assert.equal(calls.length, 5);
  assert.match(calls[0].init.body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code/);
  assert.match(calls[0].init.body, /device_code=dc/);
});

test('waitForToken: expiry, denial, cancel, an unknown error and going offline all stop with their own words', async () => {
  assert.equal((await client([{ status: 200, body: { error: 'expired_token' } }]).gh.waitForToken(code(), () => false)).error, 'The code expired before it was entered. Try again for a new code.');
  assert.equal((await client([{ status: 200, body: { error: 'access_denied' } }]).gh.waitForToken(code(), () => false)).error, 'The sign-in was cancelled on github.com. Nothing changed.');
  assert.equal((await client([{ status: 200, body: { error: 'incorrect_device_code', error_description: 'bad' } }]).gh.waitForToken(code(), () => false)).error, 'GitHub said: bad');
  assert.equal((await client([{ status: 200, body: { error: 'incorrect_device_code' } }]).gh.waitForToken(code(), () => false)).error, 'GitHub refused the sign-in (incorrect_device_code).');
  const flaky = client([{ throws: true }, { status: 502, body: '<html>' }, { status: 200, body: { access_token: 'tok' } }, { status: 200, body: { login: 'me' } }]);
  assert.deepEqual(await flaky.gh.waitForToken(code(), () => false), { ok: true, token: 'tok', login: 'me' }, 'two failed polls are ridden out');
  assert.equal((await client([{ throws: true }, { throws: true }, { throws: true }]).gh.waitForToken(code(), () => false)).error, 'Notes could not reach GitHub. Check the connection and try again.');
  assert.equal((await client([{ status: 200, body: { error: 'device_flow_disabled', error_description: 'Device Flow must be explicitly enabled for this App' } }]).gh.waitForToken(code(), () => false)).error, 'GitHub said: Device Flow must be explicitly enabled for this App');
  const c = client([]);
  c.tick(900001);
  assert.equal((await c.gh.waitForToken(code(), () => false)).error, 'The code expired before it was entered. Try again for a new code.');
  let polls = 0;
  const cancelled = client([{ status: 200, body: { error: 'authorization_pending' } }]);
  const r = await cancelled.gh.waitForToken(code(), () => polls++ > 1);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'The sign-in was cancelled.');
});

test('a token GitHub no longer accepts is reported as such by whoAmI, repos and createRepo', async () => {
  const rejected = 'GitHub no longer accepts this sign-in. Sign in again.';
  assert.equal((await client([{ status: 401, body: { message: 'Bad credentials' } }]).gh.whoAmI('t')).error, rejected);
  const repos = await client([{ status: 401, body: {} }]).gh.privateRepos('t');
  assert.equal(repos.error, rejected);
  assert.equal(repos.rejected, true);
  assert.equal((await client([{ status: 401, body: {} }]).gh.createPrivateRepo('t', 'notes')).rejected, true);
});

test('privateRepos asks for owned private repositories by last push and follows pages', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ name: 'r' + i, full_name: 'me/r' + i, clone_url: 'https://github.com/me/r' + i + '.git' }));
  const { gh, calls } = client([
    { status: 200, body: page1 },
    { status: 200, body: [{ name: 'last', full_name: 'me/last', clone_url: 'https://github.com/me/last.git', private: true, description: 'Notes, synced by the Notes app' }, { name: 'broken' }] },
  ]);
  const r = await gh.privateRepos('t');
  assert.equal(r.ok, true);
  assert.equal(r.repos.length, 101);
  assert.deepEqual(r.repos[100], { name: 'last', fullName: 'me/last', cloneUrl: 'https://github.com/me/last.git', fromNotes: true });
  assert.equal(r.repos[0].fromNotes, false, 'a repository without the Notes description was not made by Notes');
  assert.equal(calls[0].url, 'https://api.test/user/repos?affiliation=owner&visibility=private&sort=pushed&per_page=100&page=1');
  assert.equal(calls[1].url.endsWith('page=2'), true);
  assert.equal((await client([{ status: 200, body: { message: 'nope' } }]).gh.privateRepos('t')).error, 'GitHub said: nope');
});

test('createPrivateRepo validates the name, posts private, and explains a taken name', async () => {
  const { gh, calls } = client([{ status: 201, body: { name: 'notes', full_name: 'me/notes', clone_url: 'https://github.com/me/notes.git' } }]);
  const r = await gh.createPrivateRepo('t', 'notes');
  assert.deepEqual(r, { ok: true, repo: { name: 'notes', fullName: 'me/notes', cloneUrl: 'https://github.com/me/notes.git', fromNotes: false } });
  assert.equal(calls[0].url, 'https://api.test/user/repos');
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: 'notes', private: true, auto_init: false, description: 'Notes, synced by the Notes app' });
  const taken = await client([{ status: 422, body: { message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] } }]).gh.createPrivateRepo('t', 'notes');
  assert.equal(taken.error, 'You already have a repository called notes. Pick it from the list or choose another name.');
  const bad = await client([]).gh.createPrivateRepo('t', 'my notes');
  assert.equal(bad.error, 'A repository name uses letters, digits, dots, dashes and underscores, and does not end in .git.');
  assert.equal((await client([]).gh.createPrivateRepo('t', '')).error, 'Give the repository a name.');
  assert.equal((await client([{ status: 403, body: { message: 'Resource not accessible' } }]).gh.createPrivateRepo('t', 'ok')).error, 'GitHub said: Resource not accessible');
});

test('validRepoName and isGitHubHttps', () => {
  assert.equal(validRepoName('notes'), true);
  assert.equal(validRepoName('my.notes-2_x'), true);
  assert.equal(validRepoName('..'), false);
  assert.equal(validRepoName(''), false);
  assert.equal(validRepoName('a/b'), false);
  assert.equal(validRepoName('notes.git'), false);
  assert.equal(isGitHubHttps('https://github.com/me/notes.git'), true);
  assert.equal(isGitHubHttps('  https://github.com/me/notes'), true);
  assert.equal(isGitHubHttps('git@github.com:me/notes.git'), false);
  assert.equal(isGitHubHttps('https://gitlab.com/me/notes.git'), false);
  assert.equal(isGitHubHttps('https://github.com.evil.test/x'), false);
});

test('gitAuthEnv hands the token to git through config variables, never arguments', () => {
  const env = gitAuthEnv('tok');
  assert.equal(env.GIT_CONFIG_COUNT, '2');
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.equal(env.GIT_CONFIG_VALUE_0, 'Authorization: Basic ' + Buffer.from('x-access-token:tok').toString('base64'));
  assert.equal(env.GIT_CONFIG_KEY_1, 'credential.helper');
  assert.equal(env.GIT_CONFIG_VALUE_1, '');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
});

test('the default client id is the registered OAuth App and env overrides it', () => {
  assert.equal(DEFAULT_CLIENT_ID, 'Ov23linEmloxI2IlHYcD');
  assert.equal(new GitHub({ fetch: async () => reply(500, '') }).clientId, DEFAULT_CLIENT_ID);
  assert.equal(new GitHub({ clientId: 'other' }).clientId, 'other');
});

test('TokenStore keeps the sign-in encrypted, reads it back, and refuses without encryption', () => {
  const file = path.join(tmpDir('notes-token-'), 'sub', 'github-token.bin');
  const store = new TokenStore(file, fakeSafe());
  assert.equal(store.read(), null);
  assert.deepEqual(store.write({ token: 'tok', login: 'me' }), { ok: true });
  assert.equal(fs.readFileSync(file, 'utf8').includes('tok'), true, 'the fake cipher keeps the text; the real one does not');
  assert.equal(fs.readFileSync(file, 'utf8').startsWith('enc:'), true);
  assert.deepEqual(store.read(), { token: 'tok', login: 'me' });
  assert.equal(fs.existsSync(file + '.tmp'), false);
  store.clear();
  assert.equal(store.read(), null);
  const off = new TokenStore(file, fakeSafe(false));
  assert.deepEqual(off.write({ token: 't', login: 'l' }), { ok: false, error: CANNOT_KEEP });
  assert.equal(off.canKeep(), false);
});

test('TokenStore treats an unreadable, undecryptable or malformed file as no sign-in', () => {
  const file = path.join(tmpDir('notes-token-'), 'github-token.bin');
  const store = new TokenStore(file, fakeSafe());
  fs.writeFileSync(file, 'garbage');
  assert.equal(store.read(), null);
  fs.writeFileSync(file, 'enc:not json');
  assert.equal(store.read(), null);
  fs.writeFileSync(file, 'enc:' + JSON.stringify({ token: '', login: 'x' }));
  assert.equal(store.read(), null);
  fs.writeFileSync(file, 'enc:' + JSON.stringify([1]));
  assert.equal(store.read(), null);
});

function session(script, opts) {
  const file = path.join(tmpDir('notes-session-'), 'github-token.bin');
  const store = new TokenStore(file, fakeSafe(opts && opts.canKeep === false ? false : true));
  const c = client(script);
  const changes = [];
  const s = new GitHubSession({ store, github: c.gh, dry: opts && opts.dry, onChange: (st) => changes.push(st) });
  return { s, store, changes, calls: c.calls };
}

test('GitHubSession: a sign-in keeps the token, reports the login, and gives git the auth env for github.com', async () => {
  const { s, store, changes } = session([
    { status: 200, body: { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://web.test/login/device', expires_in: 900, interval: 5 } },
    { status: 200, body: { access_token: 'tok' } },
    { status: 200, body: { login: 'me' } },
  ]);
  assert.deepEqual(s.status(), { signedIn: false, login: null, canKeep: true });
  assert.equal(s.authEnvFor('https://github.com/me/notes.git'), undefined);
  const started = await s.startSignIn();
  assert.equal(started.ok, true);
  assert.equal(started.userCode, 'ABCD-1234');
  assert.equal(started.verificationUri, 'https://web.test/login/device');
  assert.deepEqual(await s.waitSignIn(), { ok: true, login: 'me' });
  assert.deepEqual(s.status(), { signedIn: true, login: 'me', canKeep: true });
  assert.deepEqual(store.read(), { token: 'tok', login: 'me' });
  assert.deepEqual(changes, [{ signedIn: true, login: 'me', canKeep: true }]);
  assert.equal(s.authEnvFor('https://github.com/me/notes.git').GIT_CONFIG_VALUE_0, 'Authorization: Basic ' + Buffer.from('x-access-token:tok').toString('base64'));
  assert.equal(s.authEnvFor('git@github.com:me/notes.git'), undefined);
  assert.equal(s.authEnvFor(''), undefined);
  s.signOut();
  assert.deepEqual(s.status(), { signedIn: false, login: null, canKeep: true });
  assert.equal(store.read(), null);
  assert.equal(s.authEnvFor('https://github.com/me/notes.git'), undefined);
  assert.deepEqual(await s.waitSignIn(), { ok: false, error: 'No sign-in is waiting.' });
});

test('GitHubSession: a sign-in is refused up front when Windows cannot protect it, and a denied one keeps nothing', async () => {
  const off = session([], { canKeep: false });
  assert.deepEqual(await off.s.startSignIn(), { ok: false, error: CANNOT_KEEP });
  const denied = session([
    { status: 200, body: { device_code: 'dc', user_code: 'C', verification_uri: 'u', expires_in: 900, interval: 5 } },
    { status: 200, body: { error: 'access_denied' } },
  ]);
  assert.equal((await denied.s.startSignIn()).ok, true);
  assert.equal((await denied.s.waitSignIn()).error, 'The sign-in was cancelled on github.com. Nothing changed.');
  assert.equal(denied.s.status().signedIn, false);
  assert.equal(denied.store.read(), null);
  assert.equal(denied.changes.length, 0);
});

test('GitHubSession: cancelling a wait ends it, and a second start replaces the first', async () => {
  const { s } = session([
    { status: 200, body: { device_code: 'dc1', user_code: 'ONE', verification_uri: 'u', expires_in: 900, interval: 5 } },
    { status: 200, body: { error: 'authorization_pending' } },
    { status: 200, body: { error: 'authorization_pending' } },
    { status: 200, body: { error: 'authorization_pending' } },
  ]);
  assert.equal((await s.startSignIn()).userCode, 'ONE');
  const waited = s.waitSignIn();
  s.cancelSignIn();
  assert.equal((await waited).error, 'The sign-in was cancelled.');
  assert.equal(s.pending, null);
});

test('GitHubSession: a cancel that lands while a poll is in flight keeps nothing', async () => {
  let held = null;
  const { s, store } = session([
    { status: 200, body: { device_code: 'dc', user_code: 'C', verification_uri: 'u', expires_in: 900, interval: 5 } },
    { status: 200, body: { access_token: 'tok' }, expect: () => { held = s.pending.done; s.cancelSignIn(); } },
    { status: 200, body: { login: 'me' } },
  ]);
  assert.equal((await s.startSignIn()).ok, true);
  assert.ok(held, 'the poll ran');
  assert.equal((await held).error, 'The sign-in was cancelled.');
  assert.equal(s.status().signedIn, false);
  assert.equal(store.read(), null);
});

test('GitHubSession: the kept sign-in is read lazily, not in the constructor, and GitHub rejecting the token signs out', async () => {
  const file = path.join(tmpDir('notes-session-'), 'github-token.bin');
  let reads = 0;
  const safe = fakeSafe();
  const counting = Object.assign({}, safe, { decryptString: (b) => { reads++; return safe.decryptString(b); } });
  const store = new TokenStore(file, counting);
  store.write({ token: 'old', login: 'me' });
  const c = client([{ status: 401, body: {} }]);
  const s = new GitHubSession({ store, github: c.gh });
  assert.equal(reads, 0, 'nothing is decrypted before the first use');
  assert.deepEqual(s.status(), { signedIn: true, login: 'me', canKeep: true });
  const r = await s.repos();
  assert.equal(r.ok, false);
  assert.equal(s.status().signedIn, false);
  assert.equal(store.read(), null);
  assert.deepEqual(await s.createRepo('x'), { ok: false, error: 'Sign in with GitHub first.' });
});

test('GitHubSession dry modes: a fixed code that waits, and a signed-in account with fake repositories', async () => {
  const coded = session([], { dry: 'code' });
  const started = await coded.s.startSignIn();
  assert.equal(started.userCode, 'WDJB-MJHT');
  const waited = coded.s.waitSignIn();
  coded.s.cancelSignIn();
  assert.equal((await waited).ok, false);
  assert.equal(coded.calls.length, 0);
  const signed = session([], { dry: 'signed-in' });
  assert.deepEqual(signed.s.status(), { signedIn: true, login: 'you', canKeep: true });
  const repos = await signed.s.repos();
  assert.equal(repos.ok, true);
  assert.deepEqual(repos.repos.map((r) => r.name), ['notes', 'journal']);
  assert.deepEqual(await signed.s.createRepo('mine'), { ok: true, repo: { name: 'mine', fullName: 'you/mine', cloneUrl: 'https://github.com/you/mine.git', fromNotes: true } });
  assert.equal(signed.s.authEnvFor('https://github.com/you/mine.git'), undefined, 'dry mode never builds a real header');
  assert.equal(signed.store.read(), null, 'dry mode writes nothing');
  assert.equal(signed.calls.length, 0);
});
