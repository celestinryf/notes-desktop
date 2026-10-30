'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { execFileSync } = require('child_process');
const { gitBinary } = require('../src/git-binary.mts');

const root = path.join(__dirname, '..');
const BUNDLES = {
  'editor.bundle.js': 'src/editor/index.ts',
  'code.bundle.js': 'src/code/index.ts',
  'docx.bundle.js': 'src/docx-view/index.ts',
  'pdf.bundle.js': 'src/pdf-view/index.ts',
  'app.bundle.js': 'src/renderer/app.ts',
  'sticky.bundle.js': 'src/renderer/sticky.ts',
};
const STORED_LICENCES = { '@tiptap/': 'scripts/licenses/tiptap.txt' };
const LICENCE_FILE = /^(licen[sc]e|copying)(-mit)?(\.(md|markdown|txt))?$/i;
const NOTICE_FILE = /^notice(\.(md|txt))?$/i;
const DUGITE_DIR = path.join(root, 'node_modules', 'dugite');

async function bundledPackages() {
  const found = new Map();
  for (const [bundle, entry] of Object.entries(BUNDLES)) {
    const result = await esbuild.build({ entryPoints: [path.join(root, entry)], bundle: true, write: false, metafile: true, format: 'iife', target: 'chrome120', absWorkingDir: root, logLevel: 'silent' });
    for (const input of Object.keys(result.metafile.inputs)) {
      const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input.split(path.sep).join('/'));
      if (!match) continue;
      if (!found.has(match[1])) found.set(match[1], new Set());
      found.get(match[1]).add(bundle);
    }
  }
  found.set('lucide-static', new Set(['src/renderer/icons.js']));
  found.set('dugite', new Set(['src/git-binary.mts (the main process)']));
  return found;
}

function licenceOf(name) {
  const dir = path.join(root, 'node_modules', name);
  const files = fs.readdirSync(dir);
  const own = files.find((f) => LICENCE_FILE.test(f));
  const stored = Object.entries(STORED_LICENCES).find(([prefix]) => name.startsWith(prefix));
  const textFile = own ? path.join(dir, own) : stored ? path.join(root, stored[1]) : null;
  if (!textFile) throw new Error('no licence text for ' + name);
  const notice = files.find((f) => NOTICE_FILE.test(f));
  return {
    text: fs.readFileSync(textFile, 'utf8').replace(/\r\n/g, '\n').trim(),
    notice: notice ? fs.readFileSync(path.join(dir, notice), 'utf8').replace(/\r\n/g, '\n').trim() : '',
  };
}

function bundledGit() {
  const git = gitBinary();
  if (!git.bundled) throw new Error('the bundled git is missing; run npm install');
  const gitDir = path.join(DUGITE_DIR, 'git');
  const version = execFileSync(git.file, ['--version'], { env: git.env, encoding: 'utf8' }).trim().replace(/^git version /, '');
  const downloads = JSON.parse(fs.readFileSync(path.join(DUGITE_DIR, 'script', 'embedded-git.json'), 'utf8'));
  const url = downloads['win32-x64'].url;
  const release = url.slice(0, url.lastIndexOf('/')).replace('/download/', '/tag/');
  const components = fs.readFileSync(path.join(gitDir, 'etc', 'package-versions.txt'), 'utf8').replace(/\r\n/g, '\n').trim().split('\n');
  return {
    lines: [
      `git ${version} (GPL-2.0), the git program Notes runs, in node_modules/dugite/git`,
      `Source: https://github.com/git-for-windows/git/releases/tag/v${version}`,
      `Build: ${release} (downloaded by dugite's npm install)`,
      'This MinGit build also carries the components listed in node_modules/dugite/git/etc/package-versions.txt,',
      'each under its own licence; the texts are in node_modules/dugite/git/ucrt64/share/licenses and',
      'node_modules/dugite/git/ucrt64/doc/git-credential-manager/LICENSE. They are:',
      ...components.map((c) => '  ' + c),
    ],
    text: fs.readFileSync(path.join(gitDir, 'LICENSE.txt'), 'utf8').replace(/\r\n/g, '\n').trim(),
  };
}

async function main() {
  const packages = [...(await bundledPackages())].sort((a, b) => a[0].localeCompare(b[0]));
  const groups = new Map();
  for (const [name, bundles] of packages) {
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
    const { text, notice } = licenceOf(name);
    const key = text + '\n' + notice;
    if (!groups.has(key)) groups.set(key, { text, notice, members: [] });
    groups.get(key).members.push({ name, version: meta.version, licence: typeof meta.license === 'string' ? meta.license : 'see below', bundles: [...bundles].sort() });
  }
  const rule = '='.repeat(80);
  const parts = [
    'Third-party software in Notes',
    '',
    'The bundles in src/renderer/vendor and the icons in src/renderer/icons.js contain the',
    'packages below. Each entry gives the package, its version, its licence and where it is',
    'included, followed by the licence text. The fonts in assets/fonts are under the SIL Open',
    'Font License; their texts are in assets/fonts/OFL-Fraunces.txt and assets/fonts/OFL-Geist.txt.',
    'The main process runs the git program that the dugite package downloads into',
    'node_modules/dugite/git; its entry, with git\'s GPL-2.0 licence and where its source is, comes last.',
    'Regenerate this file with: npm run notices',
  ];
  for (const group of groups.values()) {
    parts.push('', rule);
    for (const m of group.members) parts.push(`${m.name} ${m.version} (${m.licence}), in ${m.bundles.join(', ')}`);
    parts.push(rule, '', group.text);
    if (group.notice) parts.push('', 'NOTICE', '', group.notice);
  }
  const git = bundledGit();
  parts.push('', rule, ...git.lines, rule, '', git.text);
  fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), parts.join('\n') + '\n');
  console.log('wrote THIRD_PARTY_NOTICES.txt: ' + packages.length + ' packages in ' + groups.size + ' licence texts, plus git');
}

main().catch((err) => { console.error(err); process.exit(1); });
