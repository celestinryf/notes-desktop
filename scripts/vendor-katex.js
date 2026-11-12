'use strict';
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'node_modules', 'katex', 'dist');
const TARGET = path.join(__dirname, '..', 'src', 'renderer', 'vendor', 'katex');
const FONT_SOURCES = /src:url\((fonts\/[^)]+\.woff2)\) format\("woff2"\)(?:,url\([^)]+\) format\("[^"]+"\))*/g;

function woff2Css() {
  return fs.readFileSync(path.join(SOURCE, 'katex.min.css'), 'utf8').replace(FONT_SOURCES, 'src:url($1) format("woff2")');
}

const fontFiles = (css) => [...new Set([...css.matchAll(/url\((fonts\/[^)]+)\)/g)].map((m) => m[1]))];

function vendorKatex() {
  const css = woff2Css();
  fs.rmSync(TARGET, { recursive: true, force: true });
  fs.mkdirSync(path.join(TARGET, 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(TARGET, 'katex.min.css'), css);
  for (const font of fontFiles(css)) fs.copyFileSync(path.join(SOURCE, font), path.join(TARGET, font));
  return fontFiles(css).length;
}

if (require.main === module) console.log('vendored KaTeX\'s stylesheet and ' + vendorKatex() + ' woff2 fonts into ' + path.relative(process.cwd(), TARGET));

module.exports = { SOURCE, TARGET, woff2Css, fontFiles, vendorKatex };
