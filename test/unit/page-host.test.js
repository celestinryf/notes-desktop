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
  assert.equal(host.fileFor(origin + '/board.html'), path.join(dir, 'board.html'));
  assert.equal(host.fileFor(origin + '/data/items.json'), path.join(dir, 'data', 'items.json'));
  assert.equal(host.fileFor(origin + '/data/odd%20name%20%231.css'), path.join(dir, 'data', 'odd name #1.css'));
  assert.equal(host.fileFor(origin + '/board.html?x=1#top'), path.join(dir, 'board.html'), 'query and hash do not change the file');
  assert.equal(host.fileFor(origin + '/../secret.txt'), path.join(dir, 'secret.txt'), 'the URL drops a plain .. before it reaches the folder');
  assert.equal(host.fileFor(origin + '/%2e%2e/secret.txt'), path.join(dir, 'secret.txt'), 'and an escaped one too');
  assert.equal(host.fileFor(origin + '/..%2fsecret.txt'), null, 'an escaped slash cannot climb out');
  assert.equal(host.fileFor(origin + '/data/..%2f..%2fsecret.txt'), null);
  assert.equal(host.fileFor(origin + '/..%5C..%5Csecret.txt'), null);
  assert.equal(host.fileFor(origin + '/C:%5CWindows%5Cwin.ini'), null);
  assert.equal(host.fileFor(origin + '/'), null, 'the folder itself is not a file');
  assert.equal(host.fileFor(origin + '/bad%zz'), null, 'a broken escape is refused');
  assert.equal(host.fileFor(origin + '/a%00b'), null);
  assert.equal(host.fileFor('notespage://' + '0'.repeat(32) + '/board.html'), null, 'a folder never opened is not served');
  assert.equal(host.fileFor('https://example.com/board.html'), null);
  assert.equal(host.fileFor('not a url'), null);
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
