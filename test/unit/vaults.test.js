'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Store } = require('../../src/store');
const { VaultManager } = require('../../src/vaults');

let gitAvailable = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (_) { gitAvailable = false; }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notes-vault-'));
const git = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

function makeVaultDir() {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'Projects', 'Deep'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.obsidian'));
  fs.writeFileSync(path.join(dir, 'Inbox.md'), '# Inbox\n\nhello\n');
  fs.writeFileSync(path.join(dir, 'Projects', 'Plan.md'), 'plan\n');
  fs.writeFileSync(path.join(dir, 'Projects', 'Deep', 'notes.txt'), 'deep\n');
  fs.writeFileSync(path.join(dir, 'Projects', 'image.png'), Buffer.from([0x89, 0x50]));
  fs.writeFileSync(path.join(dir, '.obsidian', 'app.json'), '{}');
  return dir;
}

test('scanVault mirrors directories as folders and text files as notes, skipping hidden dirs and non-text', async () => {
  const dir = makeVaultDir();
  const store = new Store(tmp()).load();
  const v = store.addVault({ path: dir, name: 'Vault' });
  const r = await store.scanVault(v.id);
  assert.equal(r.added, 3);
  const root = store.vaultRootFolder(v.id);
  assert.equal(root.name, 'Vault');
  const tree = store.folderTree();
  const vaultNode = tree.find((f) => f.id === root.id);
  assert.deepEqual(vaultNode.children.map((c) => c.name), ['Projects']);
  assert.deepEqual(vaultNode.children[0].children.map((c) => c.name), ['Deep']);
  const titles = store.list({ folderId: root.id }).map((n) => n.title);
  assert.deepEqual(titles, ['Inbox']);
  const deep = store.notes.find((n) => n.title === 'notes');
  assert.equal(deep.vaultId, v.id);
  assert.equal(deep.fileKind, 'text');
  // Idempotent.
  const r2 = await store.scanVault(v.id);
  assert.deepEqual([r2.added, r2.updated, r2.removed], [0, 0, 0]);
  // External additions and deletions are reflected.
  fs.writeFileSync(path.join(dir, 'New.md'), 'new\n');
  fs.rmSync(path.join(dir, 'Projects', 'Plan.md'));
  const r3 = await store.scanVault(v.id);
  assert.equal(r3.added, 1);
  assert.equal(r3.removed, 1);
  assert.ok(store.notes.some((n) => n.title === 'New'));
  assert.ok(!store.notes.some((n) => n.title === 'Plan'));
});

test('vault notes: create writes a file, rename renames it, move moves it, trash/restore/destroy use .trash', async () => {
  const dir = makeVaultDir();
  const store = new Store(tmp()).load();
  const v = store.addVault({ path: dir });
  await store.scanVault(v.id);
  const root = store.vaultRootFolder(v.id);
  const projects = store.folders.find((f) => f.name === 'Projects');

  const n = store.createVaultNote(root.id, { title: 'Meeting: notes?', body: 'agenda\n' });
  assert.equal(n.title, 'Meeting notes');
  assert.ok(fs.existsSync(path.join(dir, 'Meeting notes.md')));
  const n2 = store.createVaultNote(root.id, { title: 'Meeting notes' });
  assert.equal(n2.title, 'Meeting notes 2', 'clash gets a suffix');

  store.update(n.id, { title: 'Renamed' });
  assert.ok(fs.existsSync(path.join(dir, 'Renamed.md')) && !fs.existsSync(path.join(dir, 'Meeting notes.md')));
  store.update(n.id, { body: 'agenda\nitem\n' });
  assert.equal(fs.readFileSync(path.join(dir, 'Renamed.md'), 'utf8'), 'agenda\nitem\n');

  store.update(n.id, { folderId: projects.id });
  assert.ok(fs.existsSync(path.join(dir, 'Projects', 'Renamed.md')));
  assert.equal(store.get(n.id).folderId, projects.id);
  assert.throws(() => store.update(n.id, { folderId: null }), /within its vault/);

  store.trash(n.id);
  assert.ok(fs.existsSync(path.join(dir, '.trash', 'Renamed.md')));
  assert.ok(!fs.existsSync(path.join(dir, 'Projects', 'Renamed.md')));
  store.restore(n.id);
  assert.ok(fs.existsSync(path.join(dir, 'Projects', 'Renamed.md')));
  store.trash(n.id);
  store.destroy(n.id);
  assert.ok(!fs.existsSync(path.join(dir, '.trash', 'Renamed.md')), 'delete forever removes the file');
  assert.equal(store.get(n.id), null);

  // Folder operations mirror directories.
  const sub = store.createFolder({ name: 'Ideas', parentId: root.id });
  assert.ok(fs.existsSync(path.join(dir, 'Ideas')));
  const inSub = store.createVaultNote(sub.id, { title: 'One' });
  store.renameFolder(sub.id, 'Thoughts');
  assert.ok(fs.existsSync(path.join(dir, 'Thoughts', 'One.md')));
  assert.equal(store.get(inSub.id).filePath, path.join(dir, 'Thoughts', 'One.md'));
  assert.ok(store.moveFolder(sub.id, projects.id).folder);
  assert.ok(fs.existsSync(path.join(dir, 'Projects', 'Thoughts', 'One.md')));
  assert.equal(store.get(inSub.id).filePath, path.join(dir, 'Projects', 'Thoughts', 'One.md'));
  store.deleteFolder(sub.id);
  assert.ok(fs.existsSync(path.join(dir, 'Projects', 'One.md')), 'contents lifted to the parent directory');
  assert.ok(!fs.existsSync(path.join(dir, 'Projects', 'Thoughts')));
  assert.equal(store.get(inSub.id).folderId, projects.id);
  assert.ok(store.deleteFolder(root.id).error, 'vault root is removed via removeVault');

  store.removeVault(v.id);
  assert.equal(store.notes.filter((x) => x.vaultId === v.id).length, 0);
  assert.ok(fs.existsSync(path.join(dir, 'Inbox.md')), 'files untouched by removing the vault');
});

test('VaultManager syncs with a bare remote: commit, push, pull from another clone, conflict leaves work intact', { skip: !gitAvailable && 'git not installed' }, async () => {
  const bare = tmp();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const a = tmp();
  execFileSync('git', ['clone', '-q', bare, path.join(a, 'v')]);
  const aDir = path.join(a, 'v');
  fs.writeFileSync(path.join(aDir, 'Start.md'), 'start\n');
  git(aDir, ['add', '-A']); git(aDir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init']); git(aDir, ['push', '-q', '-u', 'origin', 'main']);

  const store = new Store(tmp()).load();
  // autoSync off: the watcher would otherwise start background syncs that interleave with the explicit ones below.
  const v = store.addVault({ path: aDir, remote: bare, autoSync: false });
  const changes = [];
  const vm = new VaultManager(store, { debounceMs: 50, rescanDebounceMs: 50, onChange: (id, s) => changes.push(s) });
  await vm.open(v.id, { pull: false });
  assert.ok(vm.statusOf(v.id).isRepo);
  assert.equal(vm.statusOf(v.id).branch, 'main');
  assert.ok(store.notes.some((n) => n.title === 'Start'));

  // Local change -> commit + push.
  const root = store.vaultRootFolder(v.id);
  store.createVaultNote(root.id, { title: 'Local', body: 'local\n' });
  const r1 = await vm.sync(v.id, 'test');
  assert.deepEqual(r1, { ok: true, reason: 'test' });
  assert.equal(git(bare, ['rev-list', '--count', 'main']), '2');
  assert.equal(vm.statusOf(v.id).dirty, false);

  // Remote change (another device) -> pull brings the note in.
  const b = tmp();
  execFileSync('git', ['clone', '-q', bare, path.join(b, 'v')]);
  const bDir = path.join(b, 'v');
  fs.writeFileSync(path.join(bDir, 'Remote.md'), 'from b\n');
  git(bDir, ['add', '-A']); git(bDir, ['-c', 'user.name=b', '-c', 'user.email=b@b', 'commit', '-q', '-m', 'b']); git(bDir, ['push', '-q']);
  const r2 = await vm.sync(v.id, 'test');
  assert.equal(r2.ok, true);
  assert.ok(fs.existsSync(path.join(aDir, 'Remote.md')));
  assert.ok(store.notes.some((n) => n.title === 'Remote'), 'pulled file became a note');

  // Conflict: both sides edit Start.md. Sync must fail cleanly, keep the local commit, and not leave a rebase in progress.
  fs.writeFileSync(path.join(bDir, 'Start.md'), 'b version\n');
  git(bDir, ['add', '-A']); git(bDir, ['-c', 'user.name=b', '-c', 'user.email=b@b', 'commit', '-q', '-m', 'b2']); git(bDir, ['push', '-q']);
  fs.writeFileSync(path.join(aDir, 'Start.md'), 'a version\n');
  const r3 = await vm.sync(v.id, 'test');
  assert.equal(r3.ok, false);
  assert.match(r3.error, /Conflicting|conflict/i);
  assert.equal(fs.readFileSync(path.join(aDir, 'Start.md'), 'utf8').replace(/\r\n/g, '\n'), 'a version\n', 'local work kept (git autocrlf may change line endings)');
  assert.ok(!fs.existsSync(path.join(aDir, '.git', 'rebase-merge')), 'no rebase left in progress');
  assert.match(vm.statusOf(v.id).lastError || '', /pull/);
  vm.closeAll();
});

test('initRepo turns a plain folder into a repository with a remote and ignores .trash', { skip: !gitAvailable && 'git not installed' }, async () => {
  const dir = makeVaultDir();
  const bare = tmp();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const store = new Store(tmp()).load();
  const v = store.addVault({ path: dir, autoSync: false });
  const vm = new VaultManager(store, { debounceMs: 50 });
  await vm.open(v.id, { pull: false });
  assert.equal(vm.statusOf(v.id).isRepo, false);
  const r = await vm.initRepo(v.id, bare);
  assert.equal(r.ok, true);
  assert.equal(vm.statusOf(v.id).isRepo, true);
  assert.equal(store.getVault(v.id).remote, bare);
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /\.trash/);
  const s = await vm.sync(v.id, 'test');
  assert.equal(s.ok, true);
  assert.equal(git(bare, ['rev-list', '--count', 'main']), '1');
  vm.closeAll();
});
