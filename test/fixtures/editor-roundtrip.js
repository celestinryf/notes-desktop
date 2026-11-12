'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const esbuild = require('esbuild');
const { app, BrowserWindow } = require('electron');

const [casesFile, outFile] = process.argv.slice(-2);
const ROOT = path.join(__dirname, '..', '..');

function bundleEditor(dir) {
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src', 'editor', 'index.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'NotesEditor',
    target: 'chrome120',
    outfile: path.join(dir, 'editor.js'),
    logLevel: 'silent',
  });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><body><div id="host"></div><script src="editor.js"></script>');
}

function probe(cases) {
  const host = document.getElementById('host');
  return cases.map((md) => {
    const ed = window.NotesEditor.create(host, {});
    try {
      const lossless = ed.setMarkdown(md);
      const nodes = {};
      ed.editor.state.doc.descendants((n) => {
        nodes[n.type.name] = (nodes[n.type.name] || 0) + 1;
        for (const m of n.marks) nodes['mark:' + m.type.name] = (nodes['mark:' + m.type.name] || 0) + 1;
      });
      const latex = [];
      ed.editor.state.doc.descendants((n) => { if (/Math$/.test(n.type.name)) latex.push(n.attrs.latex); });
      return { md, out: ed.getMarkdown(), exact: ed.lastRoundTripExact(), lossless, nodes, latex, katex: host.querySelectorAll('.katex').length, errors: host.querySelectorAll('.katex-error').length };
    } finally { ed.destroy(); host.replaceChildren(); }
  });
}

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-roundtrip-'));
  let code = 0;
  try {
    bundleEditor(dir);
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: false } });
    await win.loadFile(path.join(dir, 'index.html'));
    const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
    const results = await win.webContents.executeJavaScript('(' + probe.toString() + ')(' + JSON.stringify(cases) + ')');
    fs.writeFileSync(outFile, JSON.stringify(results));
  } catch (err) {
    fs.writeFileSync(outFile, JSON.stringify({ error: String(err && err.stack || err) }));
    code = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    app.exit(code);
  }
});
