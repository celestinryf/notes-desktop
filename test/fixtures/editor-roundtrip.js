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

function probe(input) {
  const host = document.getElementById('host');
  const counts = (doc) => {
    const nodes = {};
    doc.descendants((n) => {
      nodes[n.type.name] = (nodes[n.type.name] || 0) + 1;
      for (const m of n.marks) nodes['mark:' + m.type.name] = (nodes['mark:' + m.type.name] || 0) + 1;
    });
    return nodes;
  };
  const latexOf = (doc) => { const out = []; doc.descendants((n) => { if (/Math$/.test(n.type.name)) out.push(n.attrs.latex); }); return out; };
  const withEditor = (options, fn) => {
    const ed = window.NotesEditor.create(host, options);
    try { return fn(ed); } finally { ed.destroy(); host.replaceChildren(); }
  };
  const markdown = input.markdown.map((md) => withEditor({}, (ed) => {
    const lossless = ed.setMarkdown(md);
    const doc = ed.editor.state.doc;
    return { md, out: ed.getMarkdown(), exact: ed.lastRoundTripExact(), lossless, nodes: counts(doc), latex: latexOf(doc), katex: host.querySelectorAll('.katex').length, errors: host.querySelectorAll('.katex-error').length };
  }));
  const withoutEscapes = (json) => {
    const marksOf = (n) => JSON.stringify((n.marks || []).filter((m) => m.type !== 'escapedDollar'));
    const flat = (n) => {
      if (!n.content) return Object.assign({}, n, { marks: undefined });
      const content = [];
      for (const child of n.content.map(flat)) {
        const last = content[content.length - 1];
        if (child.type === 'text' && last && last.type === 'text' && last.key === child.key) last.text += child.text;
        else content.push(child);
      }
      return Object.assign({}, n, { content });
    };
    const keyed = (n) => (n.type === 'text' ? { type: 'text', text: n.text, key: marksOf(n) } : n.content ? Object.assign({}, n, { content: n.content.map(keyed) }) : n);
    return JSON.stringify(flat(keyed(json)));
  };
  const docs = input.docs.map((content) => withEditor({}, (ed) => {
    ed.editor.commands.setContent({ type: 'doc', content }, false);
    const before = withoutEscapes(ed.editor.getJSON());
    const out = ed.getMarkdown();
    ed.setMarkdown(out);
    return { out, same: withoutEscapes(ed.editor.getJSON()) === before, nodes: counts(ed.editor.state.doc), latex: latexOf(ed.editor.state.doc) };
  }));
  const flows = {};
  const editing = () => {
    const seen = { edit: null, ended: 0 };
    return { seen, options: { onEditMath: (edit) => { seen.edit = edit; edit.onEnd(() => { seen.ended += 1; }); } } };
  };
  const caretAtEnd = (ed) => ed.editor.commands.setTextSelection(ed.editor.state.doc.content.size - 1);
  const typeChar = (ed, ch) => {
    const view = ed.editor.view;
    const pos = view.state.selection.from;
    const handled = view.someProp('handleTextInput', (f) => f(view, pos, pos, ch));
    if (!handled) view.dispatch(view.state.tr.insertText(ch, pos));
  };
  flows.insertThenUndo = (() => { const e = editing(); return withEditor(e.options, (ed) => {
    ed.setMarkdown('Area ');
    caretAtEnd(ed);
    ed.insertMath('inline');
    e.seen.edit.preview('x^');
    e.seen.edit.preview('x^2');
    e.seen.edit.finish('x^2');
    const after = ed.getMarkdown();
    ed.editor.commands.undo();
    return { after, undone: ed.getMarkdown(), nodes: counts(ed.editor.state.doc) };
  }); })();
  flows.insertThenCancel = (() => { const e = editing(); return withEditor(e.options, (ed) => {
    ed.setMarkdown('Area ');
    caretAtEnd(ed);
    ed.insertMath('inline');
    e.seen.edit.finish('');
    const after = ed.getMarkdown();
    const nodesAfter = counts(ed.editor.state.doc);
    ed.editor.commands.undo();
    return { after, nodesAfter, undone: ed.getMarkdown(), nodesUndone: counts(ed.editor.state.doc) };
  }); })();
  flows.blockInsert = (() => { const e = editing(); return withEditor(e.options, (ed) => {
    ed.setMarkdown('Text');
    caretAtEnd(ed);
    ed.editor.commands.splitBlock();
    ed.insertMath('block');
    e.seen.edit.finish('a\n\n\nb');
    const after = ed.getMarkdown();
    ed.setMarkdown(after);
    return { after, nodes: counts(ed.editor.state.doc) };
  }); })();
  flows.previewSaves = (() => { const e = editing(); return withEditor(e.options, (ed) => {
    ed.setMarkdown('a $x$ b');
    host.querySelector('.math-inline').click();
    e.seen.edit.preview('p$q');
    const during = ed.getMarkdown();
    e.seen.edit.finish('p$q');
    return { opened: !!e.seen.edit, during, after: ed.getMarkdown() };
  }); })();
  flows.emptiedExisting = (() => { const e = editing(); return withEditor(e.options, (ed) => {
    ed.setMarkdown('a $x$ b');
    host.querySelector('.math-inline').click();
    e.seen.edit.finish('');
    const after = ed.getMarkdown();
    ed.editor.commands.undo();
    return { after, undone: ed.getMarkdown() };
  }); })();
  flows.replacedWhileOpen = (() => { const e = editing(); return withEditor(e.options, (ed) => {
    ed.setMarkdown('a $x$ b');
    host.querySelector('.math-inline').click();
    e.seen.edit.preview('y');
    ed.setMarkdown('outside $z$ edit');
    e.seen.edit.finish('w');
    return { ended: e.seen.ended, after: ed.getMarkdown() };
  }); })();
  flows.typedDollars = [editing().options, {}].map((options) => withEditor(options, (ed) => {
    ed.setMarkdown('see $x');
    caretAtEnd(ed);
    typeChar(ed, '$');
    return { formulas: counts(ed.editor.state.doc).inlineMath || 0, out: ed.getMarkdown() };
  }));
  return { markdown, docs, flows };
}

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-roundtrip-'));
  let code = 0;
  try {
    bundleEditor(dir);
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: false } });
    await win.loadFile(path.join(dir, 'index.html'));
    const input = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
    const results = await win.webContents.executeJavaScript('(' + probe.toString() + ')(' + JSON.stringify(input) + ')');
    fs.writeFileSync(outFile, JSON.stringify(results));
  } catch (err) {
    fs.writeFileSync(outFile, JSON.stringify({ error: String(err && err.stack || err) }));
    code = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    app.exit(code);
  }
});
