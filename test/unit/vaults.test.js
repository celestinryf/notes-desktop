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
const { tmpDir } = require('../helpers/tmp');
const tmp = () => tmpDir('notes-vault-'); // removed when the test process exits
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

test('vault trash survives a restart, restores to the original folder, and a plain note dropped into a vault becomes a file', async () => {
  const dir = makeVaultDir();
  const dataDir = tmp();
  let store = new Store(dataDir).load();
  const v = store.addVault({ path: dir });
  await store.scanVault(v.id);
  const projects = store.folders.find((f) => f.name === 'Projects');
  const plan = store.notes.find((n) => n.title === 'Plan');
  store.trash(plan.id);
  assert.ok(fs.existsSync(path.join(dir, '.trash', 'Plan.md')));
  // Restart.
  store = new Store(dataDir).load();
  const reloaded = store.get(plan.id);
  assert.ok(reloaded.trashedFrom, 'origin path persisted');
  store.restore(plan.id);
  assert.ok(fs.existsSync(path.join(dir, 'Projects', 'Plan.md')), 'restored to its original directory, not left in .trash');
  assert.equal(store.get(plan.id).folderId, projects.id);
  assert.equal(store.get(plan.id).trashedFrom, undefined);
  // A trashed note whose origin directory was deleted restores into the parent.
  const deep = store.notes.find((n) => n.title === 'notes');
  const deepFolder = store.getFolder(deep.folderId);
  store.trash(deep.id);
  store.deleteFolder(deepFolder.id);
  store.restore(deep.id);
  assert.ok(fs.existsSync(path.join(dir, 'Projects', 'notes.txt')), 'restored into the parent after its folder was deleted');
  // Older data without trashedFrom restores to the vault root.
  const inbox = store.notes.find((n) => n.title === 'Inbox');
  store.trash(inbox.id);
  delete store.get(inbox.id).trashedFrom;
  store.restore(inbox.id);
  assert.ok(fs.existsSync(path.join(dir, 'Inbox.md')));
  // Plain note into a vault folder: becomes a file, synced like the rest.
  const plain = store.create({ title: 'Loose idea', body: 'loose\n' });
  store.update(plain.id, { folderId: projects.id });
  const after = store.get(plain.id);
  assert.equal(after.vaultId, v.id);
  assert.equal(after.filePath, path.join(dir, 'Projects', 'Loose idea.md'));
  assert.equal(fs.readFileSync(after.filePath, 'utf8'), 'loose\n');
  // allowRemovals=false keeps mirrors of momentarily missing files.
  fs.renameSync(path.join(dir, 'Inbox.md'), path.join(dir, 'Inbox.md.tmp'));
  const r = await store.scanVault(v.id, { allowRemovals: false });
  assert.equal(r.removed, 0);
  assert.ok(store.get(inbox.id), 'kept during a transient absence');
  fs.renameSync(path.join(dir, 'Inbox.md.tmp'), path.join(dir, 'Inbox.md'));
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

  // A sync requested while one is running gets its own run afterwards (not the in-flight result), so a
  // remote change that lands mid-sync is still pulled by the second call.
  const first = vm.sync(v.id, 'first');
  fs.writeFileSync(path.join(bDir, 'Second.md'), 'second\n');
  git(bDir, ['add', '-A']); git(bDir, ['-c', 'user.name=b', '-c', 'user.email=b@b', 'commit', '-q', '-m', 'b-second']); git(bDir, ['push', '-q']);
  const second = vm.sync(v.id, 'second');
  const [f1, s2] = await Promise.all([first, second]);
  assert.equal(f1.ok, true); assert.equal(f1.reason, 'first');
  assert.equal(s2.ok, true); assert.equal(s2.reason, 'second', 'queued caller got a fresh run');
  assert.ok(store.notes.some((n) => n.title === 'Second'), 'change pushed mid-sync was pulled');

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

test('vault scan: an unavailable folder removes nothing; an external rename keeps the note; one bad file does not stop the scan; trash/delete only touch .trash', async () => {
  const dir = makeVaultDir();
  const store = new Store(tmp()).load();
  const v = store.addVault({ path: dir });
  await store.scanVault(v.id);
  const plan = store.notes.find((n) => n.title === 'Plan');
  store.update(plan.id, { tags: 'keep', pinned: true });
  // External rename: same content, new name -> same note id, tags and pin kept.
  fs.renameSync(path.join(dir, 'Projects', 'Plan.md'), path.join(dir, 'Projects', 'Roadmap.md'));
  const r1 = await store.scanVault(v.id);
  assert.equal(r1.removed, 0);
  const same = store.get(plan.id);
  assert.equal(same.title, 'Roadmap');
  assert.deepEqual(same.tags, ['keep']);
  assert.equal(same.pinned, true);
  // A file that is not UTF-8 any more does not abort the scan.
  fs.writeFileSync(path.join(dir, 'Inbox.md'), Buffer.from([0xff, 0xfe, 0x41]));
  fs.writeFileSync(path.join(dir, 'New.md'), 'new\n');
  const r2 = await store.scanVault(v.id);
  assert.equal(r2.added, 1, 'the new file after the bad one was still linked');
  // The vault folder disappears: nothing is removed.
  const away = dir + '-away';
  fs.renameSync(dir, away);
  const r3 = await store.scanVault(v.id);
  assert.equal(r3.unavailable, true);
  assert.ok(store.notes.some((n) => n.id === plan.id), 'notes kept while the folder is away');
  fs.renameSync(away, dir);
  // Overlapping vaults are refused.
  assert.throws(() => store.addVault({ path: path.join(dir, 'Projects') }), /overlaps/);
  // Delete forever only removes files inside .trash: a trashed note pointing at a live file is left alone.
  const deep = store.notes.find((n) => n.title === 'notes');
  store.trash(deep.id);
  assert.ok(fs.existsSync(path.join(dir, '.trash', 'notes.txt')));
  deep.filePath = path.join(dir, 'Projects', 'Roadmap.md'); // simulate a stale record pointing at a live file
  store.destroy(deep.id);
  assert.ok(fs.existsSync(path.join(dir, 'Projects', 'Roadmap.md')), 'live file untouched');
});

test('a file changed on disk is not overwritten by a stale save unless forced', async () => {
  const dir = makeVaultDir();
  const store = new Store(tmp()).load();
  const v = store.addVault({ path: dir });
  await store.scanVault(v.id);
  const inbox = store.notes.find((n) => n.title === 'Inbox');
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(path.join(dir, 'Inbox.md'), '# Inbox\nedited by git\n');
  assert.throws(() => store.update(inbox.id, { body: 'my version\n' }), /changed on disk/);
  assert.equal(fs.readFileSync(path.join(dir, 'Inbox.md'), 'utf8'), '# Inbox\nedited by git\n', 'their edit kept');
  store.update(inbox.id, { body: 'my version\n', force: true });
  assert.equal(fs.readFileSync(path.join(dir, 'Inbox.md'), 'utf8'), 'my version\n');
  // Reading the file first (as the app does on a rescan) makes a later save fine again.
  fs.writeFileSync(path.join(dir, 'Inbox.md'), 'theirs 2\n');
  await store.refreshFileNote(inbox.id);
  store.update(inbox.id, { body: 'theirs 2 plus mine\n' });
  assert.equal(fs.readFileSync(path.join(dir, 'Inbox.md'), 'utf8'), 'theirs 2 plus mine\n');
});

test('a failed save during trash or restore leaves the live note object exactly as before', async () => {
  const dir = makeVaultDir();
  const store = new Store(tmp()).load();
  const v = store.addVault({ path: dir });
  await store.scanVault(v.id);
  const inbox = store.notes.find((n) => n.title === 'Inbox');
  const realSave = store.save.bind(store);
  store.save = () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); };
  assert.throws(() => store.trash(inbox.id), /ENOSPC/);
  let now = store.get(inbox.id);
  assert.equal(now.trashedAt, null);
  assert.equal(now.filePath, path.join(dir, 'Inbox.md'), 'path back to the live file on the object the store holds now');
  assert.ok(fs.existsSync(path.join(dir, 'Inbox.md')));
  store.save = realSave;
  store.trash(inbox.id);
  store.save = () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); };
  assert.throws(() => store.restore(inbox.id), /ENOSPC/);
  now = store.get(inbox.id);
  assert.ok(now.trashedAt, 'still trashed');
  assert.ok(/\.trash/.test(now.filePath) && fs.existsSync(now.filePath), 'path points at the file in .trash');
  assert.ok(now.trashedFrom, 'origin kept for a later restore');
  store.save = realSave;
  store.restore(inbox.id);
  assert.ok(fs.existsSync(path.join(dir, 'Inbox.md')));
});

test('renaming a vault subfolder by case only keeps its name instead of adding " 2"', async () => {
  const dir = makeVaultDir();
  const store = new Store(tmp()).load();
  const v = store.addVault({ path: dir });
  await store.scanVault(v.id);
  const projects = store.folders.find((f) => f.name === 'Projects');
  store.renameFolder(projects.id, 'projects');
  assert.equal(store.getFolder(projects.id).name, 'projects');
  assert.ok(fs.readdirSync(dir).includes('projects'), 'directory renamed in place');
  assert.ok(!fs.readdirSync(dir).includes('projects 2'));
});

test('clearing a vault remote detaches origin so nothing is pushed any more', { skip: !gitAvailable && 'git not installed' }, async () => {
  const bare = tmp();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const dir = makeVaultDir();
  const store = new Store(tmp()).load();
  const v = store.addVault({ path: dir, autoSync: false });
  const vm = new VaultManager(store, { debounceMs: 50 });
  await vm.open(v.id, { pull: false });
  assert.equal((await vm.initRepo(v.id, bare)).ok, true);
  assert.equal((await vm.sync(v.id, 'test')).ok, true);
  assert.equal(git(bare, ['rev-list', '--count', 'main']), '1');
  assert.equal((await vm.initRepo(v.id, '')).ok, true);
  assert.equal(store.getVault(v.id).remote, '');
  assert.equal(git(dir, ['remote']), '', 'origin removed');
  fs.writeFileSync(path.join(dir, 'Later.md'), 'later\n');
  const r = await vm.sync(v.id, 'test');
  assert.equal(r.ok, true, 'local commit still fine');
  assert.equal(git(bare, ['rev-list', '--count', 'main']), '1', 'nothing pushed after detaching');
  assert.equal(vm.statusOf(v.id).remote, '', 'status does not resurrect the old URL');
  vm.closeAll();
});

test('a vault subfolder cannot be given a dot name the scan would skip', async () => {
  const dir = makeVaultDir();
  const store = new Store(tmp()).load();
  const v = store.addVault({ path: dir });
  await store.scanVault(v.id);
  const root = store.vaultRootFolder(v.id);
  assert.throws(() => store.createFolder({ name: '.hidden', parentId: root.id }), /does not scan/);
  assert.ok(!fs.existsSync(path.join(dir, '.hidden')));
  const ok = store.createFolder({ name: 'visible', parentId: root.id });
  assert.ok(fs.existsSync(ok.dirPath));
});

test('vault folders cannot be renamed to a dot name or a skipped directory name', async () => {
  const dir = makeVaultDir();
  const store = new Store(tmp()).load();
  const v = store.addVault({ path: dir });
  await store.scanVault(v.id);
  const projects = store.folders.find((f) => f.name === 'Projects');
  assert.throws(() => store.renameFolder(projects.id, '.old'), /does not scan/);
  assert.throws(() => store.renameFolder(projects.id, 'node_modules'), /does not scan/);
  assert.throws(() => store.createFolder({ name: 'Node_Modules', parentId: store.vaultRootFolder(v.id).id }), /does not scan/);
  assert.equal(store.getFolder(projects.id).name, 'Projects');
  assert.ok(fs.existsSync(path.join(dir, 'Projects')));
});

test('unmerged paths with no merge marker block every sync until resolved (no conflict markers pushed)', { skip: !gitAvailable && 'git not installed' }, async () => {
  const bare = tmp();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const dir = makeVaultDir();
  const store = new Store(tmp()).load();
  const v = store.addVault({ path: dir, autoSync: false });
  const vm = new VaultManager(store, { debounceMs: 50 });
  await vm.open(v.id, { pull: false });
  await vm.initRepo(v.id, bare);
  assert.equal((await vm.sync(v.id, 'test')).ok, true);
  const pushed = git(bare, ['rev-list', '--count', 'main']);
  // Make a real UU entry: conflicting branch merged, then the MERGE_HEAD marker removed (as an autostash pop leaves it).
  const g = (args) => git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t'].concat(args));
  g(['checkout', '-q', '-b', 'other']);
  fs.writeFileSync(path.join(dir, 'Inbox.md'), 'other side\n'); g(['commit', '-qam', 'other']);
  g(['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(dir, 'Inbox.md'), 'main side\n'); g(['commit', '-qam', 'main']);
  try { g(['merge', 'other']); } catch (_) { /* conflict expected */ }
  fs.rmSync(path.join(dir, '.git', 'MERGE_HEAD'), { force: true });
  assert.match(git(dir, ['status', '--porcelain']), /^UU /m);
  for (let i = 0; i < 2; i++) {
    const r = await vm.sync(v.id, 'test');
    assert.equal(r.ok, false, 'sync ' + (i + 1) + ' refused');
    assert.equal(vm.statusOf(v.id).conflict, true);
  }
  assert.equal(git(bare, ['rev-list', '--count', 'main']), pushed, 'nothing pushed while unresolved');
  vm.closeAll();
});
