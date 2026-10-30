'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { gitBinary } = require('../../src/git-binary.mts');
const { run, runBytes, spawnGit } = require('../../src/git-run.mts');
const { tmpDir } = require('../helpers/tmp');

const dugiteGit = path.join(__dirname, '..', '..', 'node_modules', 'dugite', 'git');

test('gitBinary prefers the git that comes with Notes and sets up its environment', () => {
  const processEnv = { PATH: 'C:\\somewhere', HOME: 'h' };
  const git = gitBinary(processEnv);
  assert.equal(git.bundled, true);
  assert.equal(git.file, path.join(dugiteGit, 'cmd', 'git.exe'));
  assert.ok(fs.statSync(git.file).isFile());
  assert.ok(fs.statSync(git.env.GIT_EXEC_PATH).isDirectory(), 'GIT_EXEC_PATH points at the bundled git-core');
  assert.ok(git.env.PATH.startsWith(dugiteGit), 'the bundled bin folders lead PATH');
  assert.ok(git.env.PATH.endsWith('C:\\somewhere'), 'the caller PATH stays after them');
  assert.equal(git.env.HOME, 'h');
  assert.deepEqual(processEnv, { PATH: 'C:\\somewhere', HOME: 'h' }, 'the given environment is not changed');
});

test('gitBinary merges extra variables for one call', () => {
  const git = gitBinary({ PATH: '' }, { GIT_INDEX_FILE: 'x' });
  assert.equal(git.env.GIT_INDEX_FILE, 'x');
  assert.ok(git.env.GIT_EXEC_PATH);
});

test('gitBinary falls back to the git on PATH when the bundled one is missing', () => {
  const empty = tmpDir('notes-nogit-');
  const processEnv = { LOCAL_GIT_DIRECTORY: empty, PATH: 'p' };
  const git = gitBinary(processEnv);
  assert.equal(git.bundled, false);
  assert.equal(git.file, 'git');
  assert.equal(git.env, processEnv, 'no copy when nothing is added');
  const withExtra = gitBinary(processEnv, { GIT_INDEX_FILE: 'x' });
  assert.equal(withExtra.env.GIT_INDEX_FILE, 'x');
  assert.equal(withExtra.env.PATH, 'p');
  assert.equal(processEnv.GIT_INDEX_FILE, undefined);
});

test('run, runBytes and spawnGit use the bundled git', async () => {
  const git = gitBinary();
  const expected = execFileSync(git.file, ['--version'], { env: git.env, encoding: 'utf8' }).trim();
  assert.match(expected, /^git version /);
  const dir = tmpDir('notes-gitbin-');

  const r = await run(['--version'], dir);
  assert.equal(r.ok, true);
  assert.equal(r.code, 0);
  assert.equal(r.error, null);
  assert.equal(r.stdout.trim(), expected);

  const bytes = await runBytes(['--version'], dir, 1024 * 1024);
  assert.equal(bytes.toString('utf8').trim(), expected);

  const chunks = [];
  const child = spawnGit(['--version'], dir);
  child.stdout.on('data', (c) => chunks.push(c));
  await new Promise((resolve) => child.on('close', resolve));
  assert.equal(Buffer.concat(chunks).toString('utf8').trim(), expected);
});

test('run reports a failed command with its code and message', async () => {
  const dir = tmpDir('notes-gitbin-');
  const r = await run(['rev-parse', '--verify', 'nope'], dir);
  assert.equal(r.ok, false);
  assert.equal(r.code, 128);
  assert.ok(r.error.length > 0);
  assert.equal(r.stdout, '');
});

test('the bundled git is new enough to merge in the repository', async () => {
  const r = await run(['--version'], tmpDir('notes-gitbin-'));
  const m = /git version (\d+)\.(\d+)/.exec(r.stdout);
  assert.ok(m);
  assert.ok(Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 41), r.stdout);
});
