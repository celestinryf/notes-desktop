'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('../../src/shared/helpers.mts');
const F = require('../../src/files.mts');
const { Store } = require('../../src/store.mts');
const { tmpDir } = require('../helpers/tmp');

const textFile = (name) => ({ filePath: 'C:\\notes\\' + name, fileKind: 'text' });

test('HTML files and .url shortcuts are pages with their own view; Markdown, CSV and other files are not', () => {
  assert.equal(H.isHtmlPageFile(textFile('board.html')), true);
  assert.equal(H.isHtmlPageFile(textFile('OLD.HTM')), true);
  assert.equal(H.isWebLinkFile(textFile('dev.url')), true);
  assert.equal(H.isPageFile(textFile('board.html')), true);
  assert.equal(H.isPageFile(textFile('dev.url')), true);
  assert.equal(H.isPageFile(textFile('notes.md')), false);
  assert.equal(H.isPageFile(textFile('data.csv')), false);
  assert.equal(H.isPageFile({ filePath: 'C:\\x\\page.html', fileKind: 'binary' }), false, 'a binary file is not a page');
  assert.equal(H.isPageFile({ filePath: null, fileKind: null }), false);
  assert.equal(H.isPageFile(null), false);
  assert.equal(H.hasOwnView(textFile('data.csv')), true);
  assert.equal(H.hasOwnView(textFile('board.html')), true);
  assert.equal(H.hasOwnView(textFile('dev.url')), true);
  assert.equal(H.hasOwnView(textFile('tool.py')), false);
});

test('.url files are read as text notes and picked up by vault scans', () => {
  const dir = tmpDir('notes-url-kind-');
  const file = path.join(dir, 'dev.url');
  fs.writeFileSync(file, H.webLinkFileText('http://localhost:5173/'));
  assert.equal(F.kindOf(file), 'text');
  assert.equal(F.kindOf(path.join(dir, 'page.html')), 'text');
});

test('webLinkTarget reads URL= from the [InternetShortcut] section only', () => {
  assert.equal(H.webLinkTarget('[InternetShortcut]\r\nURL=http://localhost:5173/\r\n'), 'http://localhost:5173/');
  assert.equal(H.webLinkTarget('[InternetShortcut]\nIconIndex=0\n  url = http://127.0.0.1:8000/app  \n'), 'http://127.0.0.1:8000/app');
  assert.equal(H.webLinkTarget('[DEFAULT]\nBASEURL=http://other/\n[InternetShortcut]\nURL=http://localhost:3000/'), 'http://localhost:3000/');
  assert.equal(H.webLinkTarget('[DEFAULT]\nURL=http://wrong/\n'), null, 'a URL outside the section is ignored');
  assert.equal(H.webLinkTarget('URL=http://localhost/'), null, 'no section, no address');
  assert.equal(H.webLinkTarget('[InternetShortcut]\nURL=\n'), null, 'an empty address is no address');
  assert.equal(H.webLinkTarget(''), null);
  assert.equal(H.webLinkTarget(null), null);
  assert.equal(H.webLinkTarget(H.webLinkFileText('http://localhost:5173/')), 'http://localhost:5173/', 'what Notes writes it reads back');
});

test('loopbackUrl accepts only http(s) pages on this computer', () => {
  assert.equal(H.loopbackUrl('http://localhost:5173'), 'http://localhost:5173/');
  assert.equal(H.loopbackUrl('https://LOCALHOST:8443/app?x=1#top'), 'https://localhost:8443/app?x=1#top');
  assert.equal(H.loopbackUrl('http://127.0.0.1:8000/'), 'http://127.0.0.1:8000/');
  assert.equal(H.loopbackUrl('http://127.1.2.3/'), 'http://127.1.2.3/');
  assert.equal(H.loopbackUrl('http://[::1]:3000/'), 'http://[::1]:3000/');
  assert.equal(H.loopbackUrl('http://app.localhost:5173/'), 'http://app.localhost:5173/');
  assert.equal(H.loopbackUrl('  http://localhost:1234  '), 'http://localhost:1234/');
  assert.equal(H.loopbackUrl('https://example.com/'), null);
  assert.equal(H.loopbackUrl('http://localhost.example.com/'), null, 'a name that only starts with localhost is elsewhere');
  assert.equal(H.loopbackUrl('http://192.168.1.10:8080/'), null);
  assert.equal(H.loopbackUrl('http://128.0.0.1/'), null);
  assert.equal(H.loopbackUrl('ftp://localhost/'), null);
  assert.equal(H.loopbackUrl('file:///C:/x.html'), null);
  assert.equal(H.loopbackUrl('javascript:alert(1)'), null);
  assert.equal(H.loopbackUrl('http://user:pass@localhost/'), null, 'no credentials in the address');
  assert.equal(H.loopbackUrl('not a url'), null);
  assert.equal(H.loopbackUrl(''), null);
  assert.equal(H.loopbackUrl(null), null);
});

test('localPageAddress turns what people type into a local address', () => {
  assert.equal(H.localPageAddress('5173'), 'http://localhost:5173/');
  assert.equal(H.localPageAddress('localhost:5173'), 'http://localhost:5173/');
  assert.equal(H.localPageAddress('127.0.0.1:8000/docs'), 'http://127.0.0.1:8000/docs');
  assert.equal(H.localPageAddress('https://localhost:8443'), 'https://localhost:8443/');
  assert.equal(H.localPageAddress('example.com'), null);
  assert.equal(H.localPageAddress('https://example.com'), null);
  assert.equal(H.localPageAddress('   '), null);
  assert.equal(H.webAddressFrom(''), '');
  assert.equal(H.webAddressFrom('ftp://x'), 'ftp://x', 'a typed scheme is kept, and then refused');
});

test('webLinkName names the shortcut after the host and port', () => {
  assert.equal(H.webLinkName('http://localhost:5173/'), 'localhost 5173');
  assert.equal(H.webLinkName('http://127.0.0.1/'), '127.0.0.1');
  assert.equal(H.webLinkName('http://[::1]:3000/'), 'localhost 3000');
  assert.equal(H.webLinkName('not a url'), 'Web page');
});

function homeStore() {
  let t = 1_000_000;
  const store = new Store(tmpDir('notes-web-data-'), { now: () => (t += 1000) }).load();
  const dir = tmpDir('notes-web-home-');
  const home = store.addHomeVault(dir);
  return { store, dir, home };
}

test('createWebLink writes a .url shortcut at the top of the notes folder and makes it a note', () => {
  const { store, dir, home } = homeStore();
  const n = store.createWebLink('http://localhost:5173/');
  assert.equal(n.filePath, path.join(dir, 'localhost 5173.url'));
  assert.equal(fs.readFileSync(n.filePath, 'utf8'), '[InternetShortcut]\r\nURL=http://localhost:5173/\r\n');
  assert.equal(n.body, '[InternetShortcut]\r\nURL=http://localhost:5173/\r\n');
  assert.equal(n.title, 'localhost 5173');
  assert.equal(n.fileKind, 'text');
  assert.equal(n.vaultId, home.id);
  assert.equal(n.folderId, null);
  assert.equal(H.isWebLinkFile(n), true);
  const again = store.createWebLink('http://localhost:5173/');
  assert.equal(path.basename(again.filePath), 'localhost 5173 2.url', 'a second shortcut to the same place gets its own file');
});

test('createWebLink saves into the chosen folder, and into the top of the notes folder for a folder that is not on disk', () => {
  const { store, dir } = homeStore();
  const work = store.createFolder({ name: 'Work' });
  const inWork = store.createWebLink('http://127.0.0.1:8000/', work.id);
  assert.equal(inWork.filePath, path.join(dir, 'Work', '127.0.0.1 8000.url'));
  assert.equal(inWork.folderId, work.id);
  const unknown = store.createWebLink('http://127.0.0.1:9000/', 'no-such-folder');
  assert.equal(path.dirname(unknown.filePath), dir);
  assert.equal(unknown.folderId, null);
});

test('createWebLink refuses addresses that are not on this computer and writes nothing', () => {
  const { store, dir } = homeStore();
  for (const bad of ['https://example.com/', 'file:///C:/Windows/win.ini', 'localhost:5173', '']) {
    assert.throws(() => store.createWebLink(bad), (err) => err.code === 'EBADURL', bad);
  }
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.url')), []);
});

test('createWebLink without a notes folder says so', () => {
  const store = new Store(tmpDir('notes-web-nohome-')).load();
  assert.throws(() => store.createWebLink('http://localhost:5173/'), /no notes folder/);
});

test('a vault scan lists .html pages and .url shortcuts, keeps their text as it is, and leaves other files out', async () => {
  const { store, dir, home } = homeStore();
  fs.mkdirSync(path.join(dir, 'Boards'));
  fs.writeFileSync(path.join(dir, 'Boards', 'board.html'), '<!doctype html><h1>Board</h1>');
  fs.writeFileSync(path.join(dir, 'Boards', 'old.htm'), '<p>old</p>');
  fs.writeFileSync(path.join(dir, 'dev.url'), H.webLinkFileText('http://localhost:3000/'));
  fs.writeFileSync(path.join(dir, 'Boards', 'data.json'), '{}');
  await store.scanVault(home.id);
  const byName = (name) => store.notes.find((n) => n.filePath && path.basename(n.filePath) === name);
  assert.ok(byName('board.html'), 'board.html is a note');
  assert.ok(byName('old.htm'), 'old.htm is a note');
  assert.ok(byName('dev.url'), 'dev.url is a note');
  assert.equal(byName('data.json'), undefined, 'data beside a page is not');
  assert.equal(byName('board.html').body, '<!doctype html><h1>Board</h1>');
  const page = byName('board.html');
  store.update(page.id, { tags: 'work' });
  assert.equal(fs.readFileSync(page.filePath, 'utf8'), '<!doctype html><h1>Board</h1>', 'tags never write front matter into a page');
  await store.scanVault(home.id);
  assert.ok(byName('dev.url'), 'a second scan keeps the shortcut');
});
