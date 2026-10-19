'use strict';
/* Sticky window page: one note, rendered editor, autosave. Talks to main through the same notesApi bridge. */
(function () {
  const api = window.notesApi;
  const H = window.NotesHelpers;
  const $ = (s) => document.querySelector(s);
  const el = {
    title: $('#stickyTitle'), colors: $('#stickyColors'), topBtn: $('#stickyTopBtn'), openBtn: $('#stickyOpenBtn'),
    closeBtn: $('#stickyCloseBtn'), editor: $('#stickyEditor'), missing: $('#stickyMissing'), status: $('#stickyStatus'),
  };
  window.NotesIcons.hydrate(document);
  const id = new URLSearchParams(location.search).get('id');
  const COLORS = ['peach', 'cream', 'leaf', 'sky', 'rose', 'ink'];
  const state = { note: null, rich: null, saveTimer: null, dirty: false, saving: false, readOnly: false, systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches, settings: null };

  function effectiveTheme() {
    const t = state.settings && state.settings.theme;
    if (t === 'light' || t === 'dark') return t;
    return state.systemDark ? 'dark' : 'light';
  }

  function applySticky(sticky) {
    const color = (sticky && sticky.color) || 'peach';
    document.documentElement.dataset.color = color;
    for (const b of el.colors.querySelectorAll('button')) b.classList.toggle('is-on', b.dataset.color === color);
    const onTop = !sticky || sticky.onTop !== false;
    el.topBtn.setAttribute('aria-pressed', String(onTop));
    el.topBtn.title = onTop ? 'Floating above other windows (click to let windows cover it)' : 'Behind other windows (click to float on top)';
  }

  function render(note) {
    state.note = note;
    if (!note || note.trashedAt) {
      el.editor.classList.add('hidden');
      el.missing.classList.remove('hidden');
      el.title.textContent = 'Sticky';
      return;
    }
    const title = note.title || (note.body.split('\n').find((l) => l.trim()) || 'Untitled').replace(/^#+\s*/, '').slice(0, 80);
    el.title.textContent = title;
    document.title = title;
    applySticky(note.sticky);
    if (state.rich && !state.dirty && (note.body !== state.shownBody || !state.shownOnce)) {
      state.shownBody = note.body; state.shownOnce = true; // an unchanged body is not re-set: the caret would jump
      const lossless = state.rich.setMarkdown(note.body);
      // Same rule as the main window: the rendered view may only edit what it can reproduce. A real file
      // gets the strict test. Otherwise the first keystroke would rewrite formatting the sticky cannot show.
      // A plain-text file is text, not Markdown: the rendered sticky would rewrite it, so it is read-only here.
      const viewerOnly = H.isViewerOnlyFile(note);
      const plain = H.isPlainTextFile(note);
      const exactEnough = lossless && (!note.filePath || state.rich.lastRoundTripExact());
      setReadOnly(viewerOnly || plain || !exactEnough, viewerOnly ? 'Read-only file. Open in Notes to view it.' : plain ? 'Plain-text file. Edit it in Notes (↗).' : 'Has formatting this sticky cannot show. Edit it in Notes (↗).');
    }
  }

  function setReadOnly(on, why) {
    state.readOnly = on;
    if (state.rich) state.rich.setEditable(!on);
    document.documentElement.classList.toggle('is-readonly', on);
    el.status.textContent = on ? why : '';
  }

  function scheduleSave() {
    if (state.readOnly) return;
    state.dirty = true;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(save, 500);
  }

  async function save() {
    if (!state.dirty || !state.rich || !state.note) return;
    const body = state.rich.getMarkdown();
    state.saving = true;
    try {
      const updated = await api.notes.update(id, { body });
      if (updated) { state.note = updated; state.shownBody = body; state.dirty = state.rich.getMarkdown() !== body; el.status.textContent = ''; }
      else { state.dirty = false; setReadOnly(true, 'This note is gone.'); }
      if (state.dirty) scheduleSave();
    } catch (err) {
      if (/changed on disk/i.test(String(err.message))) {
        // The file moved on under us; a sticky has no room for a merge choice: take the disk version and say so.
        state.dirty = false;
        try { await api.files.refresh(id); } catch (_) { /* the store copy may already be current */ } // read the disk version into the store
        state.shownBody = null; // force the editor to take it even if the store text equals what was shown before
        await reload();
        el.status.textContent = 'The file changed on disk; showing the new version. Your last edit was not saved.';
        return;
      }
      el.status.textContent = 'Save failed: ' + (err.message || err);
      setTimeout(scheduleSave, 3000);
    } finally { state.saving = false; }
  }

  async function reload() {
    const note = await api.notes.get(id);
    render(note);
  }

  function init() {
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.color = c; b.title = c;
      b.addEventListener('click', () => api.stickies.setColor(id, c).catch((err) => { el.status.textContent = 'Could not save: ' + (err.message || err); }));
      el.colors.append(b);
    }
    el.topBtn.addEventListener('click', () => { const on = el.topBtn.getAttribute('aria-pressed') === 'true'; api.stickies.setOnTop(id, !on).catch((err) => { el.status.textContent = 'Could not save: ' + (err.message || err); }); });
    el.openBtn.addEventListener('click', () => api.stickies.openInNotes(id));
    el.title.addEventListener('dblclick', () => api.stickies.openInNotes(id));
    el.closeBtn.addEventListener('click', async () => { await flush(); api.stickies.close(id, { forget: true }); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); flush().finally(() => api.stickies.close(id, { forget: false })); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); flush(); }
    });
    window.addEventListener('blur', () => { if (state.dirty) flush(); });
    api.on.flush(async () => { try { await flush(); } finally { api.app.flushDone(); } });
    window.addEventListener('beforeunload', () => { if (state.dirty) { try { api.notes.update(id, { body: state.rich.getMarkdown() }); } catch (_) { /* best effort */ } } });

    if (window.NotesEditor) {
      state.rich = window.NotesEditor.create(el.editor, {
        placeholder: 'Jot something… - [ ] makes a checkbox.',
        onUpdate: () => { if (!state.readOnly && state.note && state.rich.getMarkdown() !== state.note.body) scheduleSave(); },
      });
      el.editor.addEventListener('click', (e) => {
        const a = e.target.closest('a[href]');
        if (a && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          const href = a.getAttribute('href') || '';
          if (/^note:\/\//i.test(href)) api.stickies.openInNotes(href.replace(/^note:\/\//i, '').replace(/\/$/, ''));
          else if (/^attachment:\/\//i.test(href)) api.attachments.open(href).then((r) => { if (r) el.status.textContent = String(r); });
          else api.app.openExternal(href);
        }
      });
    } else {
      el.status.textContent = 'Editor failed to load';
    }

    api.on.settingsChanged((s) => { state.settings = s; document.documentElement.dataset.theme = effectiveTheme(); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (ev) => { state.systemDark = ev.matches; document.documentElement.dataset.theme = effectiveTheme(); });
    api.on.stickyChanged((sticky) => applySticky(sticky));
    api.on.editCommand((cmd) => { if (state.rich && !state.readOnly) state.rich.editor.chain().focus()[cmd === 'redo' ? 'redo' : 'undo']().run(); });
    api.on.noteChanged((info) => { if (info && info.id === id && !state.dirty) reload(); });
    api.on.reloaded(() => { if (!state.dirty) reload(); });

    api.settings.get().then((settings) => {
      state.settings = settings;
      document.documentElement.dataset.theme = effectiveTheme();
      return reload();
    }).then(() => { if (state.rich) state.rich.focus(); });
  }

  async function flush() {
    clearTimeout(state.saveTimer);
    await save();
  }

  init();
})();
