'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const pages = require('../../src/page-host.mts');
const { tmpDir } = require('../helpers/tmp');

function pageFolder() {
  const dir = tmpDir('notes-page-host-');
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'board.html'), '<h1>Board</h1>');
  fs.writeFileSync(path.join(dir, 'data', 'items.json'), '{"items":[]}');
  fs.writeFileSync(path.join(dir, 'data', 'odd name #1.css'), 'h1{}');
  const host = pages.createPageHost();
  const url = host.pageUrl(path.join(dir, 'board.html'));
  const origin = url.slice(0, url.lastIndexOf('/'));
  return { dir, host, url, origin };
}

test('pageUrl serves the page from its own folder under a notespage address that stays the same', () => {
  const { dir, host, url, origin } = pageFolder();
  assert.match(url, /^notespage:\/\/[0-9a-f]{32}\/board\.html$/);
  assert.equal(host.pageUrl(path.join(dir, 'board.html')), url, 'the same file gets the same address');
  assert.equal(pages.createPageHost().pageUrl(path.join(dir, 'board.html')), url, 'and after a restart, so the page keeps its storage');
  assert.equal(host.pageUrl(path.join(dir, 'other.html')).slice(0, origin.length), origin, 'pages in one folder share an origin');
  const elsewhere = tmpDir('notes-page-host-other-');
  assert.notEqual(host.pageUrl(path.join(elsewhere, 'board.html')).slice(0, origin.length), origin, 'another folder is another origin');
  if (process.platform === 'win32') assert.equal(host.pageUrl(path.join(dir.toUpperCase(), 'board.html')).slice(0, origin.length), origin, 'Windows paths match whatever their case');
});

test('fileFor maps addresses to files inside the page folder only', () => {
  const { dir, host, origin } = pageFolder();
  const fileAt = (u) => { const found = host.fileFor(u); return found ? found.file : null; };
  assert.equal(fileAt(origin + '/board.html'), path.join(dir, 'board.html'));
  assert.equal(fileAt(origin + '/data/items.json'), path.join(dir, 'data', 'items.json'));
  assert.equal(fileAt(origin + '/data/odd%20name%20%231.css'), path.join(dir, 'data', 'odd name #1.css'));
  assert.equal(fileAt(origin + '/board.html?x=1#top'), path.join(dir, 'board.html'), 'query and hash do not change the file');
  assert.equal(fileAt(origin + '/../secret.txt'), path.join(dir, 'secret.txt'), 'the URL drops a plain .. before it reaches the folder');
  assert.equal(fileAt(origin + '/%2e%2e/secret.txt'), path.join(dir, 'secret.txt'), 'and an escaped one too');
  assert.equal(fileAt(origin + '/..%2fsecret.txt'), null, 'an escaped slash cannot climb out');
  assert.equal(fileAt(origin + '/data/..%2f..%2fsecret.txt'), null);
  assert.equal(fileAt(origin + '/..%5C..%5Csecret.txt'), null);
  assert.equal(fileAt(origin + '/C:%5CWindows%5Cwin.ini'), null);
  assert.equal(fileAt(origin + '/'), null, 'the folder itself is not a file');
  assert.equal(fileAt(origin + '/bad%zz'), null, 'a broken escape is refused');
  assert.equal(fileAt(origin + '/a%00b'), null);
  assert.equal(fileAt('notespage://' + '0'.repeat(32) + '/board.html'), null, 'a folder never opened is not served');
  assert.equal(fileAt('https://example.com/board.html'), null);
  assert.equal(fileAt('not a url'), null);
});

test('respond returns the file with its type, and 404 for folders, missing files and anything outside', async () => {
  const { host, origin } = pageFolder();
  const ok = await host.respond(origin + '/board.html');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(ok.headers.get('cache-control'), 'no-cache');
  assert.equal(await ok.text(), '<h1>Board</h1>');
  const json = await host.respond(origin + '/data/items.json');
  assert.equal(json.headers.get('content-type'), 'application/json');
  assert.equal((await host.respond(origin + '/data')).status, 404);
  assert.equal((await host.respond(origin + '/missing.js')).status, 404);
  assert.equal((await host.respond(origin + '/..%2fboard.html')).status, 404);
});

const frame = (id, url, parent) => ({ frameTreeNodeId: id, url, parent: parent || null });

test('frameNavigation lets Notes load its own pages and never lets a web page load them', () => {
  const foreign = new Set();
  const top = frame(1, 'file:///C:/app/index.html');
  const rightPane = frame(2, 'file:///C:/app/index.html?pane=right', top);
  assert.equal(pages.frameNavigation('file:///C:/app/index.html?pane=right', rightPane, foreign), 'allow');
  const pageFrame = frame(3, '', top);
  assert.equal(pages.frameNavigation('notespage://abc/board.html', pageFrame, foreign), 'allow');
  assert.ok(foreign.has(3), 'the frame is marked as a web page');
  assert.equal(pages.frameNavigation('file:///C:/app/index.html?pane=right', pageFrame, foreign), 'block', 'a page cannot become Notes');
  assert.equal(pages.frameNavigation('about:blank', pageFrame, foreign), 'allow');
  assert.equal(pages.frameNavigation('file:///C:/app/index.html?pane=right', pageFrame, foreign), 'block', 'not even by way of about:blank');
  const nested = frame(4, '', frame(3, 'notespage://abc/board.html', top));
  assert.equal(pages.frameNavigation('file:///C:/app/index.html', nested, foreign), 'block', 'nor a frame inside it');
  assert.equal(pages.frameNavigation('file:///C:/app/index.html?pane=right', rightPane, foreign), 'allow', 'the right pane is untouched');
  assert.equal(pages.frameNavigation('file:///C:/x.html', null, foreign), 'block');
});

test('frameNavigation opens sites on the internet in the browser from the page frame, and leaves embeds alone', () => {
  const foreign = new Set();
  const top = frame(1, 'file:///C:/app/index.html');
  const pageFrame = frame(3, 'http://localhost:5173/', top);
  assert.equal(pages.frameNavigation('http://localhost:5173/other', pageFrame, foreign), 'allow');
  assert.equal(pages.frameNavigation('http://127.0.0.1:8000/', pageFrame, foreign), 'allow');
  assert.equal(pages.frameNavigation('https://example.com/', pageFrame, foreign), 'external');
  const embed = frame(5, '', pageFrame);
  assert.equal(pages.frameNavigation('https://www.youtube.com/embed/x', embed, foreign), 'allow', 'an embed inside the page loads in place');
  const craft = frame(6, '', top);
  assert.equal(pages.frameNavigation('wordcraft://app/index.html', craft, foreign), 'allow');
});

test('isForeignFrame and ownerFrame find the Notes page that holds a web page', () => {
  const foreign = new Set([3, 4]);
  const top = frame(1, 'file:///C:/app/index.html');
  const pageFrame = frame(3, 'notespage://abc/board.html', top);
  const nested = frame(4, 'notespage://abc/inner.html', pageFrame);
  assert.equal(pages.isForeignFrame(top, foreign), false);
  assert.equal(pages.isForeignFrame(pageFrame, foreign), true);
  assert.equal(pages.isForeignFrame(nested, foreign), true);
  assert.equal(pages.isForeignFrame(frame(9, 'about:blank', nested), foreign), true, 'anything inside a page is the page');
  assert.equal(pages.ownerFrame(nested, foreign), top);
  assert.equal(pages.ownerFrame(top, foreign), top);
});

const key = (k, mods) => Object.assign({ type: 'keyDown', key: k, code: '', control: false, meta: false, shift: false, alt: false }, mods);

test('pageShortcut forwards Notes shortcuts out of a page and leaves the page its own keys', () => {
  assert.deepEqual(pages.pageShortcut(key('F5')), { key: 'F5', code: '', ctrl: false, shift: false, alt: false, reload: true });
  assert.equal(pages.pageShortcut(key('r', { control: true })).reload, true);
  assert.equal(pages.pageShortcut(key('R', { control: true })).reload, true);
  assert.equal(pages.pageShortcut(key('e', { control: true })).reload, false);
  for (const k of ['e', 'p', 'n', 'o', 't', 'w', ',', 'Tab', '\\']) assert.ok(pages.pageShortcut(key(k, { control: true })), 'Ctrl+' + k);
  for (const k of ['b', 'B', 'N', 'Tab']) assert.ok(pages.pageShortcut(key(k, { control: true, shift: true })), 'Ctrl+Shift+' + k);
  assert.ok(pages.pageShortcut(key('e', { meta: true })), 'Cmd counts as Ctrl');
  for (const k of ['c', 'v', 'x', 'a', 'z', 'y', 'f', 's', 'k', 'l']) assert.equal(pages.pageShortcut(key(k, { control: true })), null, 'Ctrl+' + k + ' stays in the page');
  assert.equal(pages.pageShortcut(key('r', { control: true, shift: true })), null, 'Ctrl+Shift+R stays in the page');
  assert.equal(pages.pageShortcut(key('e', { control: true, alt: true })), null);
  assert.equal(pages.pageShortcut(key('F5', { alt: true })), null);
  assert.equal(pages.pageShortcut(key('e')), null);
  assert.equal(pages.pageShortcut(key('Escape')), null);
  assert.equal(pages.pageShortcut(Object.assign(key('F5'), { type: 'keyUp' })), null);
  assert.equal(pages.pageShortcut(null), null);
});

test('the notespage scheme can fetch, stream and keep storage', () => {
  const [scheme] = pages.privilegedSchemes();
  assert.equal(scheme.scheme, pages.SCHEME);
  assert.deepEqual(scheme.privileges, { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true });
});

test('ownerFrame skips frames inside a page that never loaded a page of their own', () => {
  const foreign = new Set([3]);
  const top = frame(1, 'file:///C:/app/index.html');
  const pageFrame = frame(3, 'notespage://abc/board.html', top);
  const srcdoc = frame(7, 'about:srcdoc', pageFrame);
  assert.equal(pages.isForeignFrame(srcdoc, foreign), true);
  assert.equal(pages.ownerFrame(srcdoc, foreign), top, 'a key pressed in a srcdoc frame still reaches Notes');
  const rightPane = frame(2, 'file:///C:/app/index.html?pane=right', top);
  assert.equal(pages.ownerFrame(frame(8, 'about:blank', frame(3, 'notespage://abc/board.html', rightPane)), foreign), rightPane, 'and the right side when the page is there');
});

test('createExternalGate opens outside only right after the person did something, and not twice in a second', () => {
  let t = 10_000;
  const gate = pages.createExternalGate(() => t);
  assert.equal(gate.allow(), false, 'nothing typed or clicked yet');
  gate.input('mouseMove');
  assert.equal(gate.allow(), false, 'moving the mouse is not a request');
  gate.input('mouseDown');
  t += 100;
  assert.equal(gate.allow(), true);
  t += 200;
  assert.equal(gate.allow(), false, 'a second open in the same second is dropped');
  gate.input('keyDown');
  t += 1500;
  assert.equal(gate.allow(), true);
  t += 5000;
  assert.equal(gate.allow(), false, 'an old click does not count');
});

test('permissionAllowed keeps Notes as it was and gives pages only fullscreen and copying', () => {
  for (const url of ['file:///C:/app/index.html', 'wordcraft://app/index.html', '']) assert.equal(pages.permissionAllowed('media', url), true, url || 'no url');
  for (const url of ['notespage://abc/board.html', 'http://localhost:5173/', 'https://127.0.0.1/']) {
    assert.equal(pages.permissionAllowed('fullscreen', url), true);
    assert.equal(pages.permissionAllowed('clipboard-sanitized-write', url), true);
    for (const p of ['clipboard-read', 'media', 'geolocation', 'notifications', 'openExternal']) assert.equal(pages.permissionAllowed(p, url), false, p + ' for ' + url);
  }
});

test('probeLocal says a local server answered for any reply or a certificate it cannot check, and never fetches elsewhere', async () => {
  const calls = [];
  const replying = async (url) => { calls.push(url); return new Response('hi', { status: 500 }); };
  assert.equal(await pages.probeLocal('http://localhost:5173', replying, 1000), true, 'any status is an answer');
  assert.deepEqual(calls, ['http://localhost:5173/']);
  const refused = async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }); };
  assert.equal(await pages.probeLocal('http://127.0.0.1:9', refused, 1000), false);
  const selfSigned = async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('self-signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }) }); };
  assert.equal(await pages.probeLocal('https://localhost:8443', selfSigned, 1000), true);
  const never = async () => { throw new Error('should not fetch'); };
  assert.equal(await pages.probeLocal('https://example.com/', never, 1000), false);
  assert.equal(await pages.probeLocal('not a url', never, 1000), false);
  assert.equal(await pages.probeLocal('http://app.localhost:5173/', never, 1000), true, 'Chromium resolves *.localhost itself');
});

test('respond refuses a file reached through a link that leads out of the page folder', { skip: process.platform !== 'win32' && 'junctions are a Windows feature' }, async () => {
  const { dir, host, origin } = pageFolder();
  const outside = tmpDir('notes-page-host-secret-');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.symlinkSync(outside, path.join(dir, 'link'), 'junction');
  assert.ok(host.fileFor(origin + '/link/secret.txt'), 'the path alone looks inside');
  assert.equal((await host.respond(origin + '/link/secret.txt')).status, 404);
  fs.mkdirSync(path.join(outside, 'pages'));
  fs.writeFileSync(path.join(outside, 'pages', 'ok.html'), 'ok');
  const viaLink = pages.createPageHost();
  const linkedUrl = viaLink.pageUrl(path.join(dir, 'link', 'pages', 'ok.html'));
  assert.equal((await viaLink.respond(linkedUrl)).status, 200, 'a page opened through a link is served from where it really is');
});
