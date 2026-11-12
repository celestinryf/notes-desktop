import { el, I, setIcon, setLabel } from './dom.ts';
import { state } from './state.ts';
import { toast } from './toast.ts';
import { placePopover } from './popover.ts';
import { src } from './code-editor.ts';
import { ipcErrorText } from './text.ts';
import * as H from '../shared/helpers.mts';
import { ENGINES, ENGINE_LABELS, DEFAULT_TEX_OPTIONS, readMagic, stemOf } from '../shared/tex-magic.mts';
import { ISSUE_ICON, dirOf, isWithin, joinPath, plural, samePath, sortedIssues, statusOf } from '../shared/tex-results.mts';

type Deps = {
  api: NotesApi,
  flushSave: () => Promise<unknown>,
  openFile: (filePath: string) => Promise<unknown>,
};

export function createCompileControls({ api, flushSave, openFile }: Deps) {
  const results = new Map<string, TexCompileResult>();
  const edited = new Set<string>();
  const visited = new Map<string, number>();
  let running: string | null = null;
  let pendingLine: { filePath: string, line: number } | null = null;

  const isTex = (n: PublicNote | null): n is PublicNote & { filePath: string } => !!n && !n.trashedAt && H.isTexFile(n);
  const optionsOf = (n: PublicNote) => n.texOptions || DEFAULT_TEX_OPTIONS;
  const resultOf = (n: PublicNote | null) => (n ? results.get(n.id) || null : null);

  function closeMenus() {
    for (const [pop, btn] of [[el.compileMenu, el.compileMenuBtn], [el.compileResults, el.compileStatus]] as const) {
      pop.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }
  }

  function render() {
    const n = state.current;
    const show = isTex(n);
    el.compileControls.classList.toggle('hidden', !show);
    el.moreCompileBtn.classList.toggle('hidden', !show);
    if (!show) { closeMenus(); return; }
    const busy = running === n.id;
    setIcon(el.compileBtn, busy ? 'square' : 'play');
    setLabel(el.compileBtn, busy ? 'Stop' : 'Compile');
    const engine = readMagic(src.value).program || optionsOf(n).engine;
    el.compileBtn.title = busy ? 'Stop compiling (Ctrl+Enter)' : 'Compile to PDF with ' + ENGINE_LABELS[engine] + ' (Ctrl+Enter)';
    setLabel(el.moreCompileBtn, busy ? 'Stop compiling' : 'Compile to PDF');
    const result = resultOf(n);
    const status = statusOf(result, busy, edited.has(n.id));
    setLabel(el.compileStatus, status.text);
    el.compileStatus.dataset.tone = status.tone;
    if (status.icon) setIcon(el.compileStatus, status.icon);
    else { delete el.compileStatus.dataset.icon; const icon = el.compileStatus.querySelector('.icon'); if (icon) icon.remove(); }
    el.compileStatus.title = result && result.ok ? 'Compiled with ' + ENGINE_LABELS[result.engine] + ' in ' + (result.ms / 1000).toFixed(1) + ' s. Show the results.' : 'Show the compile results';
  }

  async function compile() {
    const n = state.current;
    if (!isTex(n)) return;
    if (running === n.id) { await api.tex.stop(n.id).catch(() => false); return; }
    if (running) { toast('Another file is compiling. Wait for it or stop it first.'); return; }
    closeMenus();
    running = n.id;
    edited.delete(n.id);
    visited.delete(n.id);
    render();
    let result: TexCompileResult;
    try {
      await flushSave();
      result = await api.tex.compile(n.id);
    } catch (err) { result = { ok: false, root: null, reason: 'failed', message: ipcErrorText(err), log: null, ms: 0, steps: [] }; }
    running = null;
    results.set(n.id, result);
    render();
    if (state.currentId !== n.id) return;
    if (!result.ok && (result.reason === 'failed' || result.reason === 'no-tex')) openResults();
  }

  function issueButton(issue: TexIssue, root: string | null) {
    const b = document.createElement('button');
    b.className = 'menu-item compile-issue';
    b.setAttribute('role', 'menuitem');
    b.dataset.kind = issue.kind;
    const where = issue.file ? issue.file + (issue.line ? ':' + issue.line : '') : issue.line ? 'line ' + issue.line : '';
    const message = document.createElement('span');
    message.className = 'compile-issue-text';
    message.textContent = issue.message;
    const at = document.createElement('span');
    at.className = 'compile-issue-where';
    at.textContent = where;
    b.append(message, at);
    b.insertAdjacentHTML('afterbegin', I(ISSUE_ICON[issue.kind]));
    b.title = issue.message + (issue.detail && issue.kind === 'error' ? '\n' + issue.detail : '');
    b.disabled = !issue.line;
    b.addEventListener('click', () => { closeMenus(); goToIssue(issue, root); });
    return b;
  }

  function openResults() {
    const n = state.current;
    if (!isTex(n)) return;
    const result = resultOf(n);
    closeMenus();
    const log = result ? result.log : null;
    if (!result) el.compileSummary.textContent = 'Press Compile (Ctrl+Enter) to make a PDF from this file. Errors and warnings will be listed here.';
    else if (!result.ok) el.compileSummary.textContent = result.message;
    else el.compileSummary.textContent = [log && log.errors ? plural(log.errors, 'error') : '', log && log.warnings ? plural(log.warnings, 'warning') : '', log && log.badBoxes ? plural(log.badBoxes, 'overfull or underfull box', 'overfull or underfull boxes') : ''].filter(Boolean).join(', ') || 'Compiled with no errors or warnings.';
    const issues = log ? sortedIssues(log.issues) : [];
    el.compileIssueList.replaceChildren(...issues.map((i) => issueButton(i, result ? result.root : null)));
    el.compileIssueList.classList.toggle('hidden', !issues.length);
    el.compileHint.classList.toggle('hidden', !issues.some((i) => i.line));
    el.compileOpenPdfBtn.classList.toggle('hidden', !(result && result.ok && result.pdf));
    el.compileResultsLogBtn.classList.toggle('hidden', !(result && result.root));
    const noTex = !!(result && !result.ok && result.reason === 'no-tex');
    el.compileRetryFindBtn.classList.toggle('hidden', !noTex);
    for (const b of el.compileOutput.querySelectorAll<HTMLButtonElement>('.compile-get-tex')) b.classList.toggle('hidden', !noTex);
    placePopover(el.compileResults, el.compileStatus);
    el.compileStatus.setAttribute('aria-expanded', 'true');
  }

  function engineItem(engine: TexEngineName, chosen: TexEngineName, setByFile: boolean) {
    const b = document.createElement('button');
    b.className = 'menu-item';
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(engine === chosen));
    b.classList.toggle('is-on', engine === chosen);
    b.disabled = setByFile;
    const label = document.createElement('span');
    label.className = 'lbl';
    label.textContent = ENGINE_LABELS[engine];
    b.append(label);
    if (engine === chosen) b.insertAdjacentHTML('afterbegin', I('check'));
    if (setByFile && engine === chosen) { const why = document.createElement('span'); why.className = 'keys'; why.textContent = 'set by the file'; b.append(why); }
    b.addEventListener('click', () => { closeMenus(); setOptions({ engine }); });
    return b;
  }

  function openMenu() {
    const n = state.current;
    if (!isTex(n)) return;
    closeMenus();
    const options = optionsOf(n);
    const program = readMagic(src.value).program;
    el.compileEngines.replaceChildren(...ENGINES.map((e) => engineItem(e, program || options.engine, !!program)));
    el.compileHaltBtn.setAttribute('aria-checked', String(options.haltOnError));
    el.compileHaltBtn.classList.toggle('is-on', options.haltOnError);
    setIcon(el.compileHaltBtn, options.haltOnError ? 'square-check' : 'square');
    el.compileLogBtn.classList.toggle('hidden', !resultOf(n));
    placePopover(el.compileMenu, el.compileMenuBtn);
    el.compileMenuBtn.setAttribute('aria-expanded', 'true');
  }

  async function setOptions(patch: Partial<TexNoteOptions>) {
    const n = state.current;
    if (!isTex(n)) return;
    try {
      const fresh = await api.tex.setOptions(n.id, patch);
      if (fresh && state.current && state.current.id === fresh.id) state.current.texOptions = fresh.texOptions;
      if (patch.engine) toast('This file compiles with ' + ENGINE_LABELS[patch.engine] + '.');
      if (patch.haltOnError !== undefined) toast(patch.haltOnError ? 'Compiling stops at the first error.' : 'Compiling goes on past errors.');
    } catch (err) { toast('Could not change the compile options: ' + ipcErrorText(err)); }
  }

  function logPathOf(result: TexCompileResult | null) {
    return result && result.root ? stemOf(result.root) + '.log' : null;
  }

  async function showLog() {
    closeMenus();
    const path = logPathOf(resultOf(state.current));
    if (path) await openFile(path);
  }

  async function openPdf() {
    closeMenus();
    const result = resultOf(state.current);
    if (result && result.ok && result.pdf) await openFile(result.pdf);
  }

  async function clean() {
    closeMenus();
    const n = state.current;
    if (!isTex(n)) return;
    try {
      const removed = await api.tex.clean(n.id);
      results.delete(n.id);
      render();
      toast(removed ? 'Removed ' + plural(removed, 'build file') + '. The PDF and your files are kept.' : 'There were no build files to remove.');
    } catch (err) { toast('Could not clear the build files: ' + ipcErrorText(err)); }
  }

  async function findTex() {
    closeMenus();
    try {
      const status = await api.tex.status(true);
      toast(status.found ? 'Found ' + status.distribution + ' in ' + status.dir + '.' : status.problem || 'Still no TeX on this PC. Install MiKTeX or TeX Live, then look again.');
      const n = state.current;
      if (n && status.found) { results.delete(n.id); render(); }
    } catch (err) { toast('Could not look for TeX: ' + ipcErrorText(err)); }
  }

  function goToLine(line: number) {
    const text = src.value;
    let at = 0;
    for (let i = 1; i < line && at !== -1; i++) at = text.indexOf('\n', at) + 1 || -1;
    if (at === -1) at = text.length;
    src.focus();
    src.setSelectionRange(at, at);
    src.reveal(at);
  }

  async function goToIssue(issue: TexIssue, root: string | null) {
    const n = state.current;
    if (!isTex(n) || !issue.line) return;
    const file = issue.file && root ? joinPath(dirOf(root), issue.file) : n.filePath;
    if (samePath(file, n.filePath)) { goToLine(issue.line); return; }
    if (!root || !isWithin(dirOf(root), file)) { toast('That line is in ' + file + ', which belongs to TeX, not to your document.'); return; }
    pendingLine = { filePath: file, line: issue.line };
    await openFile(file);
  }

  function stepIssue(step: 1 | -1) {
    const n = state.current;
    if (!isTex(n)) return;
    const result = resultOf(n);
    const issues = result && result.log ? sortedIssues(result.log.issues).filter((i) => i.line) : [];
    if (!issues.length) { toast(result ? 'No errors or warnings with a line to go to.' : 'Compile first (Ctrl+Enter).'); return; }
    const last = visited.get(n.id);
    const at = last === undefined ? (step === 1 ? 0 : issues.length - 1) : (last + step + issues.length) % issues.length;
    visited.set(n.id, at);
    const issue = issues[at];
    closeMenus();
    toast((issue.kind === 'error' ? 'Error ' : issue.kind === 'warning' ? 'Warning ' : 'Box ') + (at + 1) + ' of ' + issues.length + ': ' + issue.message);
    goToIssue(issue, result ? result.root : null);
  }

  function noteShown() {
    render();
    const n = state.current;
    if (!pendingLine || !n || !n.filePath) return;
    const wanted = pendingLine;
    pendingLine = null;
    if (samePath(wanted.filePath, n.filePath)) requestAnimationFrame(() => goToLine(wanted.line));
  }

  el.compileBtn.addEventListener('click', () => { compile(); });
  el.moreCompileBtn.addEventListener('click', () => { compile(); });
  el.compileMenuBtn.addEventListener('click', () => { if (el.compileMenu.classList.contains('hidden')) openMenu(); else closeMenus(); });
  el.compileStatus.addEventListener('click', () => { if (el.compileResults.classList.contains('hidden')) openResults(); else closeMenus(); });
  el.compileHaltBtn.addEventListener('click', () => { closeMenus(); const n = state.current; if (isTex(n)) setOptions({ haltOnError: !optionsOf(n).haltOnError }); });
  el.compileLogBtn.addEventListener('click', () => { showLog(); });
  el.compileResultsLogBtn.addEventListener('click', () => { showLog(); });
  el.compileOpenPdfBtn.addEventListener('click', () => { openPdf(); });
  el.compileCleanBtn.addEventListener('click', () => { clean(); });
  el.compileFindBtn.addEventListener('click', () => { findTex(); });
  el.compileRetryFindBtn.addEventListener('click', () => { findTex(); });
  for (const b of el.compileOutput.querySelectorAll<HTMLButtonElement>('.compile-get-tex')) b.addEventListener('click', () => { closeMenus(); api.app.openExternal(b.dataset.url || ''); });
  el.bodyInput.addEventListener('input', () => {
    const n = state.current;
    if (!isTex(n) || edited.has(n.id) || !results.has(n.id) || running === n.id) return;
    edited.add(n.id);
    render();
  });
  document.addEventListener('pointerdown', (e) => {
    const target = e.target instanceof Node ? e.target : null;
    if (!el.compileMenu.classList.contains('hidden') && !el.compileMenu.contains(target) && !el.compileMenuBtn.contains(target)) closeMenus();
    if (!el.compileResults.classList.contains('hidden') && !el.compileResults.contains(target) && !el.compileStatus.contains(target)) closeMenus();
  });

  const openNow = () => !el.compileMenu.classList.contains('hidden') || !el.compileResults.classList.contains('hidden');

  function commands(noteOpen: boolean) {
    const n = state.current;
    const tex = noteOpen && isTex(n);
    const busy = !!n && running === n.id;
    const options = n && tex ? optionsOf(n) : DEFAULT_TEX_OPTIONS;
    const program = tex ? readMagic(src.value).program : null;
    return [
      { id: 'tex-stop', title: 'Stop compiling', icon: 'square', keys: 'Ctrl+Enter', run: compile, ok: tex && busy, keywords: 'latex tex cancel' },
      { id: 'tex-next', title: 'Go to the next compile error', icon: 'arrow-down', keys: 'F8', run: () => stepIssue(1), ok: tex && !!resultOf(n), keywords: 'latex tex error warning problem' },
      { id: 'tex-previous', title: 'Go to the previous compile error', icon: 'arrow-up', keys: 'Shift+F8', run: () => stepIssue(-1), ok: tex && !!resultOf(n), keywords: 'latex tex error warning problem' },
      { id: 'tex-results', title: 'Show the compile results', icon: 'circle-alert', keys: '', run: openResults, ok: tex && !!resultOf(n), keywords: 'latex tex errors warnings log' },
      { id: 'tex-log', title: 'Show the full compile log', icon: 'scroll-text', keys: '', run: showLog, ok: tex && !!logPathOf(resultOf(n)), keywords: 'latex tex log' },
      { id: 'tex-pdf', title: 'Open the compiled PDF', icon: 'file-text', keys: '', run: openPdf, ok: tex && (() => { const r = resultOf(n); return !!(r && r.ok && r.pdf); })(), keywords: 'latex tex pdf output' },
      { id: 'tex-halt', title: options.haltOnError ? 'Compile past errors' : 'Stop compiling at the first error', icon: 'circle-alert', keys: '', run: () => setOptions({ haltOnError: !options.haltOnError }), ok: tex, keywords: 'latex tex halt-on-error' },
      ...ENGINES.map((e) => ({ id: 'tex-engine-' + e, title: 'Compile with ' + ENGINE_LABELS[e], icon: 'play', keys: '', run: () => setOptions({ engine: e }), ok: tex && !program && options.engine !== e, keywords: 'latex tex engine compiler' })),
      { id: 'tex-clean', title: 'Clear build files', icon: 'eraser', keys: '', run: clean, ok: tex, keywords: 'latex tex aux log synctex clean' },
      { id: 'tex-find', title: 'Look for TeX again', icon: 'refresh-cw', keys: '', run: findTex, ok: true, keywords: 'latex miktex texlive install' },
    ];
  }

  return { render, compile, noteShown, closeMenus, openNow, commands, stepIssue, canCompile: () => isTex(state.current) };
}
