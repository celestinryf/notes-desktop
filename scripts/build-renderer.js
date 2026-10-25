'use strict';
const path = require('path');
const esbuild = require('esbuild');

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const ENTRIES = ['app', 'sticky'];
const OUT_DIR = path.join(RENDERER, 'vendor');

function buildRenderer({ write }) {
  return esbuild.buildSync({
    entryPoints: ENTRIES.map((name) => path.join(RENDERER, name + '.ts')),
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    outdir: OUT_DIR,
    entryNames: '[name].bundle',
    logLevel: 'silent',
    write,
  });
}

function bundlePath(name) {
  return path.join(OUT_DIR, name + '.bundle.js');
}

if (require.main === module) {
  buildRenderer({ write: true });
  console.log('wrote ' + ENTRIES.map((n) => path.relative(process.cwd(), bundlePath(n))).join(', '));
}

module.exports = { buildRenderer, bundlePath, ENTRIES, RENDERER };
