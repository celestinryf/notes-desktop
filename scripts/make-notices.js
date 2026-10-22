'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

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
    'Regenerate this file with: npm run notices',
  ];
  for (const group of groups.values()) {
    parts.push('', rule);
    for (const m of group.members) parts.push(`${m.name} ${m.version} (${m.licence}), in ${m.bundles.join(', ')}`);
    parts.push(rule, '', group.text);
    if (group.notice) parts.push('', 'NOTICE', '', group.notice);
  }
  fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), parts.join('\n') + '\n');
  console.log('wrote THIRD_PARTY_NOTICES.txt: ' + packages.length + ' packages in ' + groups.size + ' licence texts');
}

main().catch((err) => { console.error(err); process.exit(1); });
