'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { gitBinary } = require('../../src/git-binary.mts');
const { tmpDir } = require('./tmp');

const git = gitBinary();
const AUTHOR = ['-c', 'user.name=t', '-c', 'user.email=t@x', '-c', 'commit.gpgsign=false'];

function sh(args, cwd) { return execFileSync(git.file, AUTHOR.concat(args), { cwd, env: git.env, encoding: 'utf8', windowsHide: true }).trim(); }

function commitIn(repo, name, text, message) {
  fs.writeFileSync(path.join(repo, name), text);
  sh(['add', name], repo);
  sh(['commit', '-q', '-m', message || name], repo);
  return sh(['rev-parse', 'HEAD'], repo);
}

function makeRepos(prefix) {
  const base = tmpDir(prefix);
  const upstream = path.join(base, 'upstream');
  const checkout = path.join(base, 'checkout');
  fs.mkdirSync(upstream);
  sh(['init', '-q', '-b', 'main'], upstream);
  const first = commitIn(upstream, 'package-lock.json', '{"v":1}', 'first');
  sh(['clone', '-q', upstream, checkout], base);
  const dataDir = path.join(base, 'data');
  fs.mkdirSync(dataDir);
  return { base, upstream, checkout, dataDir, first };
}

module.exports = { git, sh, commitIn, makeRepos };
