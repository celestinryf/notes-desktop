/* Renderer: vanilla JS, talks to the main process through window.notesApi (see preload.js). */
(function () {
  'use strict';

  const api = window.notesApi;
  const H = window.NotesHelpers;
  const { isViewerOnlyFile, isPlainTextFile } = H;
  // An opened file whose text is not Markdown: plain text, Word, PDF.
  const isNonMarkdownFile = (n) => isPlainTextFile(n) || isViewerOnlyFile(n);
  const $ = (sel) => document.querySelector(sel);

  const el = {
    app: $('#app'),
    sidebar: $('#sidebar'),
    newNoteBtn: $('#newNoteBtn'),
    navItems: Array.from(document.querySelectorAll('.nav-item[data-view]')),
    countAll: $('#countAll'), countPinned: $('#countPinned'), countTrash: $('#countTrash'), countReminders: $('#countReminders'),
    remindBtn: $('#remindBtn'), remindDialog: $('#remindDialog'), remindForm: $('#remindForm'), remindInput: $('#remindInput'), remindQuick: $('#remindQuick'),
    remindCurrent: $('#remindCurrent'), remindClearBtn: $('#remindClearBtn'), remindCancelBtn: $('#remindCancelBtn'),
    shareBtn: $('#shareBtn'), shareMenu: $('#shareMenu'), shareReveal: $('#shareReveal'),
    lockBtn: $('#lockBtn'), lockMenu: $('#lockMenu'), lockDialog: $('#lockDialog'), lockForm: $('#lockForm'), lockDialogTitle: $('#lockDialogTitle'), lockDialogHint: $('#lockDialogHint'),
    lockPassword: $('#lockPassword'), lockPassword2: $('#lockPassword2'), lockConfirmRow: $('#lockConfirmRow'), lockError: $('#lockError'), lockCancelBtn: $('#lockCancelBtn'), lockSubmitBtn: $('#lockSubmitBtn'),
    liveRow: $('#liveRow'), liveText: $('#liveText'), liveLinkBtn: $('#liveLinkBtn'), liveStopBtn: $('#liveStopBtn'), shareLiveHost: $('#shareLiveHost'), shareLiveStop: $('#shareLiveStop'),
    liveDialog: $('#liveDialog'), liveForm: $('#liveForm'), liveDialogTitle: $('#liveDialogTitle'), liveDialogHint: $('#liveDialogHint'), liveLinkLabel: $('#liveLinkLabel'), liveLinkInput: $('#liveLinkInput'),
    liveError: $('#liveError'), liveCopyBtn: $('#liveCopyBtn'), liveCancelBtn: $('#liveCancelBtn'), liveSubmitBtn: $('#liveSubmitBtn'),
    pageMenu: $('#pageMenu'), bookMenu: $('#bookMenu'), newBookBtn: $('#newBookBtn'),
    splitBtn: $('#splitBtn'), splitDialog: $('#splitDialog'), splitForm: $('#splitForm'), splitLead: $('#splitLead'), splitPages: $('#splitPages'), splitName: $('#splitName'), splitKeep: $('#splitKeep'), splitCancelBtn: $('#splitCancelBtn'),
    bookReader: $('#bookReader'), bookReaderTitle: $('#bookReaderTitle'), bookReaderToc: $('#bookReaderToc'), bookReaderBody: $('#bookReaderBody'), bookReaderScroll: $('#bookReaderScroll'),
    bookReaderPdfBtn: $('#bookReaderPdfBtn'), bookReaderPrintBtn: $('#bookReaderPrintBtn'), bookReaderCloseBtn: $('#bookReaderCloseBtn'),
    bookStrip: $('#bookStrip'), bookName: $('#bookName'), bookTabs: $('#bookTabs'), bookPrevBtn: $('#bookPrevBtn'), bookNextBtn: $('#bookNextBtn'), bookAddBtn: $('#bookAddBtn'),
    relatedPanel: $('#relatedPanel'), relatedOut: $('#relatedOut'), relatedIn: $('#relatedIn'), relatedTags: $('#relatedTags'), folderMenuBook: $('#folderMenuBook'),
    lockScreen: $('#lockScreen'), lockScreenPassword: $('#lockScreenPassword'), lockScreenBtn: $('#lockScreenBtn'), lockScreenError: $('#lockScreenError'),
    tagList: $('#tagList'),
    themeBtn: $('#themeBtn'), settingsBtn: $('#settingsBtn'),
    hotkeyHint: $('#hotkeyHint'), hotkeyHint2: $('#hotkeyHint2'),
    searchInput: $('#searchInput'), sortSelect: $('#sortSelect'),
    listTitle: $('#listTitle'), emptyTrashBtn: $('#emptyTrashBtn'),
    noteList: $('#noteList'), listEmpty: $('#listEmpty'),
    editorEmpty: $('#editorEmpty'), editor: $('#editor'),
    toggleSidebarBtn: $('#toggleSidebarBtn'), toggleListBtn: $('#toggleListBtn'), hideListBtn: $('#hideListBtn'), pinBtn: $('#pinBtn'), sourceBtn: $('#sourceBtn'),
    editorColumn: $('#editorColumn'), richEditor: $('#richEditor'),
    linkDialog: $('#linkDialog'), linkForm: $('#linkForm'), linkInput: $('#linkInput'), linkRemoveBtn: $('#linkRemoveBtn'), linkCancelBtn: $('#linkCancelBtn'),
    alignSeg: $('#alignSeg'), editorWidthInput: $('#editorWidthInput'), editorWidthValue: $('#editorWidthValue'), editorFullWidthInput: $('#editorFullWidthInput'),
    gitEnabledInput: $('#gitEnabledInput'), gitRemoteInput: $('#gitRemoteInput'), gitStatus: $('#gitStatus'), gitCommitBtn: $('#gitCommitBtn'), gitPushBtn: $('#gitPushBtn'),
    exportBtn: $('#exportBtn'), duplicateBtn: $('#duplicateBtn'), restoreBtn: $('#restoreBtn'),
    deleteBtn: $('#deleteBtn'), destroyBtn: $('#destroyBtn'),
    titleInput: $('#titleInput'), tagsInput: $('#tagsInput'), bodyInput: $('#bodyInput'),
    statusWords: $('#statusWords'), statusChars: $('#statusChars'), statusUpdated: $('#statusUpdated'), statusSaved: $('#statusSaved'),
    settingsDialog: $('#settingsDialog'), settingsForm: $('#settingsForm'),
    hotkeyInput: $('#hotkeyInput'), hotkeyError: $('#hotkeyError'), themeSelect: $('#themeSelect'),
    fontSizeInput: $('#fontSizeInput'), fontSizeValue: $('#fontSizeValue'),
    openAtLoginInput: $('#openAtLoginInput'), alwaysOnTopInput: $('#alwaysOnTopInput'),
    importBtn: $('#importBtn'), exportAllBtn: $('#exportAllBtn'), dataFolderBtn: $('#dataFolderBtn'),
    settingsInfo: $('#settingsInfo'),
    toast: $('#toast'),
    sidebarResizer: $('#sidebarResizer'), listResizer: $('#listResizer'),
    newFolderBtn: $('#newFolderBtn'), folderTree: $('#folderTree'), folderSelect: $('#folderSelect'), folderMenu: $('#folderMenu'),
    navAll: document.querySelector('.nav-item[data-view="all"]'),
    openFileBtn: $('#openFileBtn'), fileRow: $('#fileRow'), fileKind: $('#fileKind'), filePath: $('#filePath'),
    fileRevealBtn: $('#fileRevealBtn'), fileOpenBtn: $('#fileOpenBtn'), fileReloadBtn: $('#fileReloadBtn'), docxView: $('#docxView'),
    fileConvertBtn: $('#fileConvertBtn'), convertMenu: $('#convertMenu'),
    fileBanner: $('#fileBanner'), pdfEditor: $('#pdfEditor'), pdfSaveBtn: $('#pdfSaveBtn'), pdfUndoBtn: $('#pdfUndoBtn'), pdfRedoBtn: $('#pdfRedoBtn'), pdfZoomLabel: $('#pdfZoom'), pdfPages: $('#pdfPages'), agentFilesBtn: $('#agentFilesBtn'), agentFilesStatus: $('#agentFilesStatus'),
    signDialog: $('#signDialog'), signForm: $('#signForm'), signPad: $('#signPad'), signRemember: $('#signRemember'), signClearBtn: $('#signClearBtn'),
    signForgetBtn: $('#signForgetBtn'), signCancelBtn: $('#signCancelBtn'), signPlaceBtn: $('#signPlaceBtn'), signName: $('#signName'), signTypeBtn: $('#signTypeBtn'), signStatus: $('#signStatus'),
    readAloudBtn: $('#readAloudBtn'), dictateBtn: $('#dictateBtn'), ttsVoiceSelect: $('#ttsVoiceSelect'), ttsRateInput: $('#ttsRateInput'), ttsRateValue: $('#ttsRateValue'),
    vaultList: $('#vaultList'), vaultAddFolderBtn: $('#vaultAddFolderBtn'), vaultCloneBtn: $('#vaultCloneBtn'),
    vaultDialog: $('#vaultDialog'), vaultForm: $('#vaultForm'), vaultUrlInput: $('#vaultUrlInput'), vaultDestInput: $('#vaultDestInput'), vaultDestBtn: $('#vaultDestBtn'),
    vaultNameInput: $('#vaultNameInput'), vaultError: $('#vaultError'), vaultCancelBtn: $('#vaultCancelBtn'), vaultCloneSubmitBtn: $('#vaultCloneSubmitBtn'),
    folderMenuSync: $('#folderMenuSync'), folderMenuOpen: $('#folderMenuOpen'),
    stickyBtn: $('#stickyBtn'), botBtn: $('#botBtn'), printBtn: $('#printBtn'),
    findBar: $('#findBar'), findInput: $('#findInput'), findCount: $('#findCount'), findPrevBtn: $('#findPrevBtn'), findNextBtn: $('#findNextBtn'), findCloseBtn: $('#findCloseBtn'),
    findReplaceToggle: $('#findReplaceToggle'), replaceRow: $('#replaceRow'), replaceInput: $('#replaceInput'), replaceOneBtn: $('#replaceOneBtn'), replaceAllBtn: $('#replaceAllBtn'),
    attachBtn: $('#attachBtn'), recordBtn: $('#recordBtn'), historyBtn: $('#historyBtn'), linkNoteSelect: $('#linkNoteSelect'),
    historyDialog: $('#historyDialog'), historyList: $('#historyList'), historyPreview: $('#historyPreview'), historyStatus: $('#historyStatus'), historyCloseBtn: $('#historyCloseBtn'), historyRestoreBtn: $('#historyRestoreBtn'), botPanel: $('#botPanel'), botScope: $('#botScope'), botAllowEdits: $('#botAllowEdits'), botTerminalBtn: $('#botTerminalBtn'),
    botCloseBtn: $('#botCloseBtn'), botPrompt: $('#botPrompt'), botRunBtn: $('#botRunBtn'), botOutput: $('#botOutput'),
  };

  const state = {
    view: 'all',          // all | pinned | trash | tag | folder
    tag: null,
    folderId: null,
    tree: [],
    folderPath: [],
    menuFolderId: null,
    editingFolder: null,  // { mode: 'create' | 'rename', id, parentId }
    query: '',
    notes: [],
    currentId: null,
    current: null,
    sourceMode: false,    // false: rendered editor, true: raw Markdown textarea
    rich: null,           // rendered editor instance (window.NotesEditor)
    settings: null,
    info: null,
    systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
    dirty: false,
    saveTimer: null,
    savingFor: null,
  };

  // ---- utilities -----------------------------------------------------------

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Match on the raw text and escape each piece afterwards, so entities in notes are never split by a mark.
  function highlight(text, query) {
    const raw = String(text);
    const tokens = H.tokenize(query);
    if (!tokens.length) return escapeHtml(raw);
    const re = new RegExp('(' + tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
    return raw.split(re).map((part, i) => (i % 2 ? '<span class="mark">' + escapeHtml(part) + '</span>' : escapeHtml(part))).join('');
  }

  // The message of an error thrown in the main process, without Electron's "Error invoking remote method" prefix.
  function ipcErrorText(err) {
    return String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }

  let toastTimer = null;
  function toast(message, action) {
    clearTimeout(toastTimer);
    el.toast.innerHTML = '';
    el.toast.append(document.createTextNode(message));
    if (action) {
      const b = document.createElement('button');
      b.className = 'btn btn-small';
      b.style.marginLeft = '10px';
      b.textContent = action.label;
      b.addEventListener('click', () => { hideToast(); action.run(); });
      el.toast.append(b);
    }
    el.toast.classList.remove('hidden');
    toastTimer = setTimeout(hideToast, action ? 6000 : 2200);
  }
  function hideToast() { el.toast.classList.add('hidden'); }

  // ---- theme & settings ----------------------------------------------------

  function effectiveTheme() {
    const t = state.settings ? state.settings.theme : 'system';
    if (t === 'light' || t === 'dark') return t;
    return state.systemDark ? 'dark' : 'light';
  }

  function applySettings(settings) {
    state.settings = settings;
    document.documentElement.dataset.theme = effectiveTheme();
    document.documentElement.style.setProperty('--editor-font-size', settings.fontSize + 'px');
    el.app.classList.toggle('sidebar-collapsed', !!settings.sidebarCollapsed);
    syncListCollapsed();
    el.sortSelect.value = settings.sort;
    applyPaneWidths(settings.sidebarWidth, settings.listWidth);
    applyEditorLayout(settings);
    // A note flagged as lossy stays in source whatever the global preference, unless the user overrode it; a
    // plain-text file always does.
    const forcedSource = (state.currentLossless === false && state.lossyOverride !== state.currentId) || !state.rich || isPlainTextFile(state.current);
    const wantSource = settings.editorMode === 'source' || forcedSource;
    if (wantSource !== state.sourceMode) applyEditorMode(wantSource);
  }

  function applyEditorLayout(settings) {
    el.editorColumn.classList.remove('align-left', 'align-center', 'align-right');
    el.editorColumn.classList.add('align-' + settings.editorAlign);
    el.editorColumn.classList.toggle('full-width', !settings.editorWidth);
    el.editorColumn.style.setProperty('--editor-col-width', (settings.editorWidth || 760) + 'px');
  }

  // ---- resizable panes -----------------------------------------------------

  function paneBudget() {
    // Space the two left panes may share while the editor keeps its minimum width.
    return Math.max(0, window.innerWidth - H.EDITOR_MIN);
  }

  function fitPaneWidths(sidebar, list) {
    sidebar = H.clampPane('sidebarWidth', sidebar);
    list = H.clampPane('listWidth', list);
    const sidebarShown = state.settings && state.settings.sidebarCollapsed ? 0 : sidebar;
    const over = sidebarShown + list - paneBudget();
    if (over > 0) {
      // Shrink the list first, then the sidebar, never below their minimums.
      const listGive = Math.min(over, list - H.PANE_LIMITS.listWidth.min);
      list -= listGive;
      const rest = over - listGive;
      if (rest > 0 && sidebarShown) sidebar = Math.max(H.PANE_LIMITS.sidebarWidth.min, sidebar - rest);
    }
    return { sidebar, list };
  }

  function applyPaneWidths(sidebar, list) {
    const fit = fitPaneWidths(sidebar, list);
    el.app.style.setProperty('--sidebar-w', fit.sidebar + 'px');
    el.app.style.setProperty('--list-w', fit.list + 'px');
    return fit;
  }

  function currentPaneWidths() {
    return {
      sidebar: parseInt(el.app.style.getPropertyValue('--sidebar-w'), 10) || H.PANE_LIMITS.sidebarWidth.def,
      list: parseInt(el.app.style.getPropertyValue('--list-w'), 10) || H.PANE_LIMITS.listWidth.def,
    };
  }

  function setupResizer(handle, key) {
    const other = key === 'sidebarWidth' ? 'list' : 'sidebar';
    const mine = key === 'sidebarWidth' ? 'sidebar' : 'list';
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = currentPaneWidths();
      const startX = e.clientX;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      let latest = start[mine];
      const onMove = (ev) => {
        const widths = { sidebar: start.sidebar, list: start.list };
        widths[mine] = start[mine] + (ev.clientX - startX);
        const fit = applyPaneWidths(widths.sidebar, widths.list);
        latest = fit[mine];
        // Dragging the sidebar can squeeze the list; keep both panes honest.
        if (fit[other] !== start[other]) start[other] = fit[other];
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        handle.classList.remove('is-dragging');
        document.body.classList.remove('is-resizing');
        const widths = currentPaneWidths();
        updateSettings({ sidebarWidth: widths.sidebar, listWidth: widths.list });
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
    handle.addEventListener('dblclick', () => {
      const patch = {};
      patch[key] = H.PANE_LIMITS[key].def;
      updateSettings(patch);
    });
  }

  function applyInfo(info) {
    state.info = info;
    const text = info.hotkeyRegistered ? info.hotkeyDisplay : 'hotkey unavailable';
    el.hotkeyHint.textContent = text;
    el.hotkeyHint2.textContent = text;
    el.settingsInfo.textContent = 'Data: ' + info.dataDir + (info.hotkeyFallback ? '   (preferred hotkey was taken; using ' + info.hotkeyDisplay + ')' : '');
    if (info.saveBlocked) toast('Your notes file could not be read (it may be locked by another program). Saving is paused so nothing is overwritten; restart Notes once it is free.');
    else if (info.loadError && info.recoveredNotes) toast('Notes file was damaged; restored ' + info.recoveredNotes + (info.recoveredNotes === 1 ? ' note' : ' notes') + ' from the newest backup. The damaged file was kept beside it.');
    else if (info.loadError) toast('Notes file was damaged and no backup was found. The damaged file was kept beside notes.json.');
  }

  async function updateSettings(patch) {
    const res = await api.settings.set(patch);
    applySettings(res.settings);
    applyInfo(res.info);
    return res;
  }

  // ---- data loading --------------------------------------------------------

  async function refresh(opts) {
    opts = opts || {};
    const listOpts = { query: state.query, sort: state.settings.sort };
    if (state.view === 'trash') listOpts.trashed = true;
    else if (state.query) { /* a search looks across every live note, whatever is selected */ }
    else if (state.view === 'pinned') listOpts.pinned = true;
    else if (state.view === 'reminders') listOpts.reminders = true;
    else if (state.view === 'tag') listOpts.tag = state.tag;
    else if (state.view === 'folder') listOpts.folderId = state.folderId;
    const [notes, counts, tags, tree, folderPath] = await Promise.all([
      api.notes.list(listOpts), api.notes.counts(), api.notes.tags(), api.folders.tree(),
      state.view === 'folder' ? api.folders.path(state.folderId) : Promise.resolve([]),
    ]);
    state.notes = notes;
    state.tree = tree;
    state.folderPath = folderPath;
    if (state.view === 'folder' && !folderPath.length) {
      // The folder we were looking at is gone; fall back to all notes, and stop starting in it.
      state.view = 'all'; state.folderId = null;
      if (state.settings.lastFolderId) updateSettings({ lastFolderId: null }).catch(() => {});
      el.navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === 'all'));
      return refresh(opts);
    }
    renderCounts(counts);
    renderTags(tags);
    renderFolders();
    renderFolderSelect();
    renderList();
    // Page order or titles may have changed elsewhere (list, another window, a reorder): keep the strip in step.
    if (state.current && (book.id || bookOf(state.current))) renderBookStrip(state.current);
    const inList = notes.some((n) => n.id === state.currentId);
    if (!inList && !opts.keepEditor) {
      if (notes.length) await selectNote(notes[0].id);
      else clearEditor();
    } else if (inList) {
      const fresh = notes.find((n) => n.id === state.currentId);
      if (fresh && !state.dirty) updateStatus(fresh);
    }
  }

  function renderCounts(c) {
    el.countAll.textContent = c.all;
    el.countPinned.textContent = c.pinned;
    el.countTrash.textContent = c.trash;
    el.countReminders.textContent = c.reminders;
    el.countReminders.classList.toggle('is-overdue', !!c.overdue);
  }

  function renderTags(tags) {
    el.tagList.innerHTML = '';
    if (!tags.length) {
      const d = document.createElement('div');
      d.className = 'tags-empty';
      d.textContent = 'Add tags to a note to see them here.';
      el.tagList.append(d);
      return;
    }
    for (const { tag, count } of tags) {
      const b = document.createElement('button');
      b.className = 'nav-item' + (state.view === 'tag' && state.tag === tag ? ' is-active' : '');
      b.innerHTML = '<span></span><span class="count"></span>';
      b.firstChild.textContent = tag;
      b.lastChild.textContent = count;
      b.addEventListener('click', () => setView('tag', tag));
      el.tagList.append(b);
    }
  }

  function renderList() {
    const q = state.query;
    el.noteList.innerHTML = '';
    el.listEmpty.classList.toggle('hidden', state.notes.length > 0);
    el.emptyTrashBtn.classList.toggle('hidden', !(state.view === 'trash' && state.notes.length));
    const titles = { all: 'All notes', pinned: 'Pinned', trash: 'Trash', reminders: 'Reminders', tag: '#' + state.tag };
    el.listTitle.innerHTML = '';
    if (q) el.listTitle.textContent = 'Results';
    else if (state.view === 'folder') {
      state.folderPath.forEach((p, i) => {
        if (i < state.folderPath.length - 1) {
          const crumb = document.createElement('span');
          crumb.className = 'list-crumb';
          crumb.textContent = p.name + ' / ';
          el.listTitle.append(crumb);
        } else el.listTitle.append(document.createTextNode(p.name));
      });
    } else el.listTitle.textContent = titles[state.view];
    const viewingBook = state.view === 'folder' && !!(flattenTree(state.tree).find((x) => x.id === state.folderId) || {}).book;
    const frag = document.createDocumentFragment();
    state.notes.forEach((n, i) => {
      const li = document.createElement('li');
      li.className = 'note-card' + (n.id === state.currentId ? ' is-active' : '');
      li.dataset.id = n.id;
      li.setAttribute('role', 'option');
      li.style.animationDelay = Math.min(i, 12) * 20 + 'ms';
      li.innerHTML = cardHtml(n, q);
      if (viewingBook && !q) { const no = document.createElement('span'); no.className = 'page-no'; no.textContent = 'p. ' + (i + 1); li.querySelector('.note-card-title').prepend(no); }
      li.addEventListener('click', () => selectNote(n.id));
      if (!n.trashedAt) {
        li.draggable = true;
        li.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/x-note-id', n.id);
          e.dataTransfer.effectAllowed = 'move';
          li.classList.add('is-dragging');
        });
        li.addEventListener('dragend', () => li.classList.remove('is-dragging'));
      }
      frag.append(li);
    });
    el.noteList.append(frag);
  }

  function reminderMark(n) {
    if (!n.remindAt || n.trashedAt) return '';
    const overdue = n.remindAt <= Date.now();
    return '<span class="remind-mark' + (overdue ? ' is-overdue' : '') + '" title="' + (overdue ? 'Reminder went off' : 'Reminder') + '">⏰ ' + escapeHtml(H.formatWhen(n.remindAt)) + '</span>';
  }

  // One renderer for a card's contents, used by the full list render and by single-card refreshes, so the
  // pin, sticky, lock and reminder marks never disappear after a save.
  function cardHtml(n, q) {
    const tags = n.tags.map((t) => '<span class="tag">#' + escapeHtml(t) + '</span>').join('');
    const fileMark = n.filePath ? '<span class="file-mark" title="' + escapeHtml(n.filePath) + '">' + escapeHtml((n.fileKind || 'file').toUpperCase()) + '</span>' : '';
    const marks = (n.pinned ? '<span class="pin" title="Pinned">★</span>' : '')
      + (n.sticky ? '<span class="pin sticky-mark" title="On the desktop as a sticky">📌</span>' : '')
      + (n.locked ? '<span class="lock-mark" title="' + (n.unlocked ? 'Locked (unlocked for now)' : 'Locked') + '">' + (n.unlocked ? '🔓' : '🔒') + '</span>' : '')
      + (n.live ? '<span class="live-mark" title="Live share (' + n.live.role + ')">LIVE</span>' : '');
    const snippet = n.locked && !n.unlocked ? '<div class="note-card-snippet is-locked">Locked note</div>' : '<div class="note-card-snippet">' + highlight(H.snippet(n, 120), q) + '</div>';
    return '<div class="note-card-title">' + marks + highlight(H.deriveTitle(n), q) + fileMark + '</div>' + snippet +
      '<div class="note-card-meta"><span>' + escapeHtml(H.relativeTime(n.trashedAt || n.updatedAt)) + '</span>' + reminderMark(n) + tags + '</div>';
  }

  function refreshCard(note) {
    const li = el.noteList.querySelector('.note-card[data-id="' + note.id + '"]');
    if (!li) return;
    li.innerHTML = cardHtml(note, state.query);
  }

  // ---- views ---------------------------------------------------------------

  async function setView(view, arg, refreshOpts) {
    await flushSave();
    state.view = view;
    state.tag = view === 'tag' ? arg : null;
    state.folderId = view === 'folder' ? arg : null;
    el.navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    // Remember the folder so the app starts in it next time.
    if ((state.settings.lastFolderId || null) !== state.folderId) updateSettings({ lastFolderId: state.folderId }).catch(() => {});
    await refresh(refreshOpts);
  }

  // The list shows the folder (or book) of the note in front of the user. Called when a note is opened from
  // outside the list (a link, the related panel, a search result) so the list never shows some other folder.
  // A search keeps looking everywhere until it is cleared; the trash and unfiled notes keep their own views.
  async function scopeListToNote(note) {
    if (!note || state.query) return;
    if (note.trashedAt) { if (state.view !== 'trash') await setView('trash', null, { keepEditor: true }); return; }
    if (note.folderId) { if (!(state.view === 'folder' && state.folderId === note.folderId)) await setView('folder', note.folderId, { keepEditor: true }); return; }
    if (state.view === 'folder' || state.view === 'trash') await setView('all', null, { keepEditor: true });
  }

  // Applies the search box. Clearing a search brings the list back to the folder of the note now open.
  let searchTimer = null;
  async function endSearchStep() {
    const had = !!state.query;
    state.query = el.searchInput.value.trim();
    await refresh({ keepEditor: true });
    if (had && !state.query) await scopeListToNote(state.current);
  }

  // The list can be put away while a note is open; with no note open it always shows, so there is a way back.
  function syncListCollapsed() {
    const collapsed = !!(state.settings && state.settings.listCollapsed && state.current);
    el.app.classList.toggle('list-collapsed', collapsed);
    if (el.toggleListBtn) el.toggleListBtn.classList.toggle('is-on', !collapsed);
  }

  function toggleList() {
    updateSettings({ listCollapsed: !state.settings.listCollapsed });
  }

  // Search lives in the list, so anything that needs it brings the list back first.
  async function showList() {
    if (state.settings.listCollapsed) await updateSettings({ listCollapsed: false });
  }

  // ---- folders -------------------------------------------------------------

  function expandedSet() {
    return new Set(state.settings.expandedFolders || []);
  }

  async function setExpanded(id, open) {
    const set = expandedSet();
    if (open) set.add(id); else set.delete(id);
    await updateSettings({ expandedFolders: Array.from(set) });
    renderFolders();
  }

  function flattenTree(nodes, out) {
    out = out || [];
    for (const n of nodes) { out.push(n); flattenTree(n.children, out); }
    return out;
  }

  function editKey(edit) {
    return edit ? edit.mode + ':' + (edit.id || edit.parentId || 'root') : '';
  }

  function renderFolders() {
    const open = expandedSet();
    const editing = state.editingFolder;
    // A background refresh must not rebuild the tree under an open name field: that would blur it and commit early.
    const liveInput = el.folderTree.querySelector('.folder-input');
    if (editing && liveInput && liveInput.dataset.editKey === editKey(editing)) return;
    el.folderTree.innerHTML = '';
    if (!state.tree.length && !(editing && editing.mode === 'create' && !editing.parentId)) {
      const d = document.createElement('div');
      d.className = 'folders-empty';
      d.textContent = 'No folders yet. Press + to make one.';
      el.folderTree.append(d);
      return;
    }
    const frag = document.createDocumentFragment();
    const addRow = (node) => {
      const row = document.createElement('div');
      row.className = 'folder-row' + (state.view === 'folder' && state.folderId === node.id ? ' is-active' : '');
      row.dataset.id = node.id;
      row.style.setProperty('--depth', node.depth);
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-expanded', node.children.length ? String(open.has(node.id)) : 'false');
      row.draggable = !(editing && editing.mode === 'rename' && editing.id === node.id);

      const chevron = document.createElement('button');
      chevron.className = 'folder-chevron' + (node.children.length ? (open.has(node.id) ? ' is-open' : '') : ' is-leaf');
      chevron.textContent = '▶';
      chevron.title = open.has(node.id) ? 'Collapse' : 'Expand';
      chevron.setAttribute('aria-label', chevron.title);
      chevron.addEventListener('click', (e) => { e.stopPropagation(); setExpanded(node.id, !open.has(node.id)); });
      row.append(chevron);

      const icon = document.createElement('span');
      icon.className = 'folder-icon';
      icon.textContent = node.book ? '📖' : '▰';
      row.append(icon);
      if (node.isVaultRoot) {
        const st = state.vaultStatus[node.vaultId] || {};
        const badge = document.createElement('span');
        badge.className = 'vault-badge' + (st.syncing ? ' is-syncing' : '') + (st.lastError || st.conflict ? ' is-error' : '');
        badge.textContent = st.isRepo ? '⟳' : '⌂';
        badge.title = st.isRepo ? ('git' + (st.remote ? ' · ' + st.remote : ' · no remote') + (st.lastError ? '\n' + st.lastError : '')) : 'Folder vault (no git)';
        row.append(badge);
      }

      if (editing && editing.mode === 'rename' && editing.id === node.id) {
        row.append(folderInput(node.name, (value) => commitFolderEdit(value)));
      } else {
        const name = document.createElement('span');
        name.className = 'folder-name';
        name.textContent = node.name;
        name.title = node.name;
        row.append(name);
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = node.count;
        row.append(count);
        const menu = document.createElement('button');
        menu.className = 'folder-menu-btn';
        menu.textContent = '⋯';
        menu.title = 'Folder actions';
        menu.setAttribute('aria-label', 'Folder actions for ' + node.name);
        menu.addEventListener('click', (e) => { e.stopPropagation(); openFolderMenu(node.id, menu); });
        row.append(menu);
      }

      row.addEventListener('click', () => { if (!(editing && editing.id === node.id)) setView('folder', node.id); });
      row.addEventListener('dblclick', (e) => { if (!e.target.closest('.folder-input')) { e.preventDefault(); startRename(node.id); } });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); openFolderMenu(node.id, row, e); });
      wireDropTarget(row, node.id);
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-folder-id', node.id);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('is-dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      frag.append(row);

      if (editing && editing.mode === 'create' && editing.parentId === node.id) frag.append(createRow(node.depth + 1));
      if (open.has(node.id)) node.children.forEach(addRow);
    };
    const createRow = (depth) => {
      const row = document.createElement('div');
      row.className = 'folder-row is-active';
      row.style.setProperty('--depth', depth);
      const icon = document.createElement('span');
      icon.className = 'folder-icon';
      icon.textContent = editing.book ? '📖' : '▰';
      row.append(document.createElement('span'), icon);
      row.firstChild.className = 'folder-chevron is-leaf';
      row.append(folderInput('', (value) => commitFolderEdit(value)));
      return row;
    };
    if (editing && editing.mode === 'create' && !editing.parentId) frag.append(createRow(0));
    state.tree.forEach(addRow);
    el.folderTree.append(frag);
    const input = el.folderTree.querySelector('.folder-input');
    if (input) { input.focus(); input.select(); }
  }

  function folderInput(value, commit) {
    const input = document.createElement('input');
    input.className = 'folder-input';
    input.dataset.editKey = editKey(state.editingFolder);
    input.value = value;
    const what = state.editingFolder && state.editingFolder.book ? 'Book name' : 'Folder name';
    input.placeholder = what;
    input.setAttribute('aria-label', what);
    input.spellcheck = false;
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) commit(input.value);
      else cancelFolderEdit();
    };
    input.addEventListener('blur', () => { if (input.isConnected) finish(true); });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
    return input;
  }

  function startCreateFolder(parentId, asBook) {
    closeFolderMenu();
    if (state.settings.sidebarCollapsed) updateSettings({ sidebarCollapsed: false }); // the name field lives there
    state.editingFolder = { mode: 'create', parentId: parentId || null, book: !!asBook };
    if (parentId) {
      const set = expandedSet();
      if (!set.has(parentId)) { set.add(parentId); updateSettings({ expandedFolders: Array.from(set) }).then(renderFolders); return; }
    }
    renderFolders();
  }

  function startRename(id) {
    closeFolderMenu();
    state.editingFolder = { mode: 'rename', id };
    renderFolders();
  }

  function cancelFolderEdit() {
    state.editingFolder = null;
    renderFolders();
  }

  async function commitFolderEdit(value) {
    const edit = state.editingFolder;
    state.editingFolder = null;
    if (!edit) return;
    const name = String(value || '').trim();
    try {
      if (edit.mode === 'create') {
        if (!name) { renderFolders(); return; }
        const folder = await api.folders.create({ name, parentId: edit.parentId });
        if (edit.book) {
          // A new book opens on its first page, ready for a title.
          await api.folders.setBook(folder.id, true);
          const page = await api.notes.create({ folderId: folder.id, title: '' });
          await setView('folder', folder.id, { keepEditor: true });
          await selectNoteNow(page.id);
          el.titleInput.focus();
          toast('Book "' + H.truncate(folder.name, 30) + '" created. Give the first page a title; + Page adds more.');
          return;
        }
        await setView('folder', folder.id);
        toast('Folder "' + H.truncate(folder.name, 30) + '" created');
      } else {
        if (name) await api.folders.rename(edit.id, name);
        await refresh({ keepEditor: true });
      }
    } catch (err) {
      renderFolders(); // never leave a dead name field behind
      toast('Could not save the folder: ' + (err.message || err));
    }
  }

  async function deleteFolder(id) {
    closeFolderMenu();
    const node = flattenTree(state.tree).find((n) => n.id === id);
    if (!node) return;
    const what = [];
    if (node.count) what.push(node.count + (node.count === 1 ? ' note' : ' notes'));
    if (node.children.length) what.push(node.children.length + (node.children.length === 1 ? ' subfolder (with its contents)' : ' subfolders (with their contents)'));
    const detail = what.length ? ' Its ' + what.join(' and ') + ' move up one level; nothing is deleted.' : '';
    if (!window.confirm('Delete folder "' + node.name + '"?' + detail)) return;
    await flushSave();
    const res = await api.folders.delete(id);
    if (state.current && state.current.folderId === id) state.current.folderId = res ? res.parentId : null;
    if (state.view === 'folder' && (state.folderId === id || !flattenTree(state.tree).some((n) => n.id === state.folderId))) {
      if (res && res.parentId) await setView('folder', res.parentId); else await setView('all');
    } else await refresh({ keepEditor: true });
    toast('Folder deleted');
  }

  async function moveNoteToFolder(noteId, folderId) {
    const existing = state.notes.find((n) => n.id === noteId) || (state.currentId === noteId ? state.current : null);
    if (existing && (existing.folderId || null) === (folderId || null)) return; // already there
    await flushSave();
    let updated;
    try { updated = await api.notes.update(noteId, { folderId: folderId || null }); }
    catch (err) { const msg = ipcErrorText(err); toast(/locked/i.test(msg) ? msg : (/vault/i.test(msg) ? 'Vault notes stay inside their vault; move them between its folders instead.' : 'Could not move: ' + msg)); renderFolderSelect(); return; }
    if (state.currentId === noteId && updated) state.current = updated;
    await refresh({ keepEditor: true });
    const name = folderId ? (flattenTree(state.tree).find((n) => n.id === folderId) || {}).name : null;
    toast(name ? 'Moved to ' + H.truncate(name, 30) : 'Moved out of folders');
  }

  async function moveFolderTo(folderId, parentId) {
    const res = await api.folders.move(folderId, parentId || null);
    if (res && res.error) { toast(res.error); return; }
    if (parentId) { const set = expandedSet(); if (!set.has(parentId)) { set.add(parentId); await updateSettings({ expandedFolders: Array.from(set) }); } }
    await refresh({ keepEditor: true });
  }

  function wireDropTarget(target, folderId) {
    const accepts = (e) => e.dataTransfer && (e.dataTransfer.types.includes('text/x-note-id') || e.dataTransfer.types.includes('text/x-folder-id'));
    target.addEventListener('dragover', (e) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      target.classList.add('is-drop-target');
    });
    target.addEventListener('dragleave', () => target.classList.remove('is-drop-target'));
    target.addEventListener('drop', (e) => {
      target.classList.remove('is-drop-target');
      const noteId = e.dataTransfer.getData('text/x-note-id');
      const movingFolder = e.dataTransfer.getData('text/x-folder-id');
      if (!noteId && !movingFolder) return;
      e.preventDefault();
      e.stopPropagation();
      if (noteId) moveNoteToFolder(noteId, folderId);
      else if (movingFolder && movingFolder !== folderId) moveFolderTo(movingFolder, folderId);
    });
  }

  function renderFolderSelect() {
    const sel = el.folderSelect;
    const current = state.current ? (state.current.folderId || '') : '';
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'No folder';
    sel.append(none);
    for (const node of flattenTree(state.tree)) {
      const opt = document.createElement('option');
      opt.value = node.id;
      opt.textContent = '  '.repeat(node.depth) + (node.depth ? '└ ' : '') + node.name;
      sel.append(opt);
    }
    sel.value = current;
    if (sel.value !== current) sel.value = '';
  }

  function openFolderMenu(id, anchor, ev) {
    state.menuFolderId = id;
    const menu = el.folderMenu;
    const node = flattenTree(state.tree).find((n) => n.id === id) || {};
    el.folderMenuSync.classList.toggle('hidden', !node.isVaultRoot);
    el.folderMenuBook.textContent = node.book ? 'Turn back into a folder' : 'Turn into a book';
    el.folderMenuOpen.classList.toggle('hidden', !node.vaultId);
    menu.querySelector('[data-action="delete"]').textContent = node.isVaultRoot ? 'Remove vault (keeps files)' : 'Delete folder';
    placePopover(menu, anchor, ev);
  }

  // Shows a popover menu at the pointer (right-click) or under its anchor, kept inside the window.
  function placePopover(menu, anchor, ev) {
    menu.classList.remove('hidden');
    const rect = anchor.getBoundingClientRect();
    let x = ev ? ev.clientX : rect.left;
    let y = ev ? ev.clientY : rect.bottom + 4;
    menu.style.left = '0px'; menu.style.top = '0px';
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
    if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
    menu.style.left = Math.max(8, x) + 'px';
    menu.style.top = Math.max(8, y) + 'px';
    const first = menu.querySelector('button:not(.hidden):not(:disabled)');
    if (first) first.focus();
  }

  function closeFolderMenu() {
    state.menuFolderId = null;
    el.folderMenu.classList.add('hidden');
  }

  async function folderMenuAction(action) {
    const id = state.menuFolderId;
    closeFolderMenu();
    if (!id) return;
    const node = flattenTree(state.tree).find((n) => n.id === id) || {};
    if (action === 'new-note') { await setView('folder', id); await newNote(); }
    else if (action === 'new-subfolder') startCreateFolder(id);
    else if (action === 'rename') startRename(id);
    else if (action === 'toggle-book') toggleBook(id, !node.book);
    else if (action === 'sync' && node.vaultId) syncVault(node.vaultId);
    else if (action === 'open-folder' && node.vaultId) api.vaults.openFolder(node.vaultId);
    else if (action === 'delete' && node.isVaultRoot) removeVault(node.vaultId);
    else if (action === 'delete') deleteFolder(id);
  }

  // ---- vaults ----------------------------------------------------------------

  state.vaultStatus = {};

  async function syncVault(id) {
    toast('Syncing vault…');
    const r = await api.vaults.sync(id);
    if (r.ok) toast('Vault synced.');
    else if (r.skipped) toast('This vault is a plain folder (' + r.skipped + '). Add a remote in Settings to sync it.');
    else toast('Vault sync failed: ' + r.error);
    await refresh({ keepEditor: true });
    renderVaultList();
  }

  async function removeVault(id) {
    if (!window.confirm('Remove this vault from Notes? The folder and its files stay on disk untouched.')) return;
    await flushSave();
    await api.vaults.remove(id);
    if (state.view === 'folder') await setView('all'); else await refresh({ keepEditor: true });
    renderVaultList();
    toast('Vault removed. Files kept.');
  }

  async function addVaultFolder() {
    const dir = await api.vaults.pickFolder();
    if (!dir) return;
    try {
      const v = await api.vaults.add({ path: dir });
      el.settingsDialog.close();
      await setView('folder', v.rootFolderId);
      await setExpanded(v.rootFolderId, true);
      toast('Vault "' + v.name + '" added' + (v.status.isRepo ? ' (git repository' + (v.status.remote ? ', syncing with ' + v.status.remote : ', no remote') + ')' : ''));
    } catch (err) {
      toast('Could not add vault: ' + (err.message || err));
    }
  }

  function openCloneDialog() {
    el.vaultUrlInput.value = '';
    el.vaultNameInput.value = '';
    el.vaultError.textContent = '';
    if (!el.vaultDestInput.value && state.info && state.info.documentsDir) el.vaultDestInput.value = state.info.documentsDir;
    el.vaultDialog.showModal();
    el.vaultUrlInput.focus();
  }

  async function submitClone() {
    const url = el.vaultUrlInput.value.trim();
    const dest = el.vaultDestInput.value.trim();
    if (!url) { el.vaultError.textContent = 'Enter a repository URL.'; return; }
    if (!dest) { el.vaultError.textContent = 'Choose where to clone.'; return; }
    el.vaultCloneSubmitBtn.disabled = true;
    el.vaultError.textContent = 'Cloning…';
    try {
      const r = await api.vaults.clone(url, dest, el.vaultNameInput.value.trim());
      if (!r.ok) { el.vaultError.textContent = r.error; return; }
      el.vaultDialog.close();
      el.settingsDialog.close();
      await setView('folder', r.vault.rootFolderId);
      await setExpanded(r.vault.rootFolderId, true);
      toast('Cloned "' + r.vault.name + '". Changes will sync automatically.');
    } catch (err) {
      el.vaultError.textContent = String(err.message || err);
    } finally {
      el.vaultCloneSubmitBtn.disabled = false;
    }
  }

  async function renderVaultList() {
    if (!el.settingsDialog.open) return;
    let list;
    try { list = await api.vaults.list(); } catch (_) { return; }
    el.vaultList.innerHTML = '';
    if (!list.length) {
      const d = document.createElement('div');
      d.className = 'vault-empty';
      d.textContent = 'No vaults yet. Add a folder of Markdown files, or clone a repository.';
      el.vaultList.append(d);
      return;
    }
    for (const v of list) {
      state.vaultStatus[v.id] = v.status;
      const item = document.createElement('div');
      item.className = 'vault-item';
      item.dataset.id = v.id;
      const head = document.createElement('div');
      head.className = 'vault-head';
      head.innerHTML = '<span></span><span class="vault-path"></span>';
      head.firstChild.textContent = v.name;
      head.lastChild.textContent = v.path;
      head.lastChild.title = v.path;
      item.append(head);
      const st = document.createElement('div');
      st.className = 'vault-status' + (v.status.lastError || v.status.conflict ? ' is-error' : '');
      st.textContent = describeVaultStatus(v);
      item.append(st);
      const actions = document.createElement('div');
      actions.className = 'vault-actions';
      const remote = document.createElement('input');
      remote.className = 'input';
      remote.placeholder = v.status.isRepo ? 'Remote URL (origin)' : 'Add a remote URL to turn this folder into a synced repo';
      remote.value = v.remote || v.status.remote || '';
      remote.addEventListener('change', async () => { const r = await api.vaults.update(v.id, { remote: remote.value.trim() }); if (r && r.ok === false) toast(r.error); renderVaultList(); });
      actions.append(remote);
      const mk = (label, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-small' + (cls ? ' ' + cls : ''); b.textContent = label; b.addEventListener('click', fn); actions.append(b); };
      mk('Sync now', () => syncVault(v.id));
      mk('Rescan', async () => { const r = await api.vaults.scan(v.id); toast('Rescanned: +' + r.added + ' changed ' + r.updated + ' removed ' + r.removed); await refresh({ keepEditor: true }); });
      mk('Open folder', () => api.vaults.openFolder(v.id));
      const auto = document.createElement('label');
      auto.className = 'field-check';
      auto.innerHTML = '<input type="checkbox"><span>Auto-sync</span>';
      auto.firstChild.checked = v.autoSync;
      auto.firstChild.addEventListener('change', async () => { await api.vaults.update(v.id, { autoSync: auto.firstChild.checked }); renderVaultList(); });
      actions.append(auto);
      mk('Remove', () => removeVault(v.id), 'btn-danger');
      item.append(actions);
      el.vaultList.append(item);
    }
  }

  function describeVaultStatus(v) {
    const s = v.status || {};
    if (!s.isRepo) return 'Plain folder: notes mirror the files, no git. Add a remote URL to start syncing.';
    const parts = ['git on ' + (s.branch || '?')];
    if (s.remote) parts.push(s.ahead || s.behind ? (s.ahead + ' ahead, ' + s.behind + ' behind') : 'in sync with remote');
    else parts.push('no remote (local history only)');
    if (s.dirty) parts.push('uncommitted changes');
    if (s.syncing) parts.push('syncing…');
    if (s.lastSyncAt) parts.push('last sync ' + H.relativeTime(s.lastSyncAt));
    if (s.conflict) parts.push('CONFLICT: resolve in the folder');
    if (s.lastError) parts.push('error: ' + s.lastError);
    return parts.join(' · ');
  }

  // ---- editor --------------------------------------------------------------

  function clearEditor() {
    stashIfDirty();
    clearPdf();
    state.currentId = null;
    state.current = null;
    state.dirty = false;
    syncListCollapsed();
    el.editor.classList.add('hidden');
    el.editorEmpty.classList.remove('hidden');
    el.noteList.querySelectorAll('.note-card.is-active').forEach((c) => c.classList.remove('is-active'));
  }

  // Selections run one at a time: two quick switches must not interleave their loads and flushes.
  state.selecting = Promise.resolve();
  function selectNote(id) {
    const run = state.selecting.then(() => selectNoteNow(id)).catch((err) => console.error('selectNote failed', err));
    state.selecting = run;
    return run;
  }

  async function selectNoteNow(id) {
    if (state.currentId === id && state.current) return;
    if (tts.active) stopReadAloud();
    // Flush the outgoing note first, and again if keystrokes landed while the flush was in flight,
    // so nothing typed during the switch is dropped.
    // A PDF's edits are not text, so state.dirty does not cover them. If they cannot be written, stay on the PDF:
    // switching would close it and lose them.
    if (!(await flushPdf({ commit: true })) && !window.confirm('Your changes to this PDF could not be saved (is it open in another app?). Leave it anyway and lose them?')) return;
    let guard = 0;
    while (state.dirty && guard++ < 3) await flushSave();
    stashIfDirty(); // still dirty means the disk is refusing writes; the patch lives on and is retried
    if (state.inflight.has(id)) await state.inflight.get(id); // a write for the incoming note is still landing
    // Read the incoming note only now, after every write that could change it has settled.
    const note = await api.notes.get(id);
    if (!note) return;
    // Keystrokes that arrived during that read belong to the outgoing note: save or stash them too.
    if (state.dirty) { await flushSave(); stashIfDirty(); }
    state.currentId = note.id;
    state.current = note;
    state.dirty = false;
    syncListCollapsed();
    closeAllBookMenus(); // a page or book menu belongs to the note that was open
    if (readerOpen() && (bookOf(note) || {}).id !== reader.bookId) closeReader(); // left that book: its reading view goes too
    el.titleInput.value = note.title;
    el.tagsInput.value = note.tags.join(', ');
    el.bodyInput.value = note.body;
    const hasPending = applyPendingTo(note);
    // Only Markdown goes into the rendered editor. A plain-text file is always shown as the text it is, and a
    // PDF or Word file is shown by its own viewer, so neither gets the Markdown checks or their toasts.
    const plainFile = isPlainTextFile(note);
    const markdown = !plainFile && !isViewerOnlyFile(note);
    let lossless = true;
    if (state.rich) {
      lossless = state.rich.setMarkdown(markdown ? el.bodyInput.value : '');
      // A real file on disk gets the strict test: the rendered view may only be used if it reproduces the
      // file exactly, otherwise the first keystroke would reformat someone's CLAUDE.md or README.
      if (markdown && note.filePath && lossless && !state.rich.lastRoundTripExact()) lossless = false;
    }
    state.currentLossless = lossless;
    state.lossyOverride = null;
    el.bodyInput.placeholder = plainFile ? 'Plain text.' : 'Markdown source. Ctrl+E switches back to the rendered view.';
    // A note the rendered view cannot show faithfully opens as source, so nothing is rewritten by just looking.
    const wantSource = plainFile || state.settings.editorMode === 'source' || !lossless || !state.rich;
    if (wantSource !== state.sourceMode) applyEditorMode(wantSource);
    if (markdown && !lossless && state.lossyToastFor !== note.id) {
      state.lossyToastFor = note.id;
      toast(note.filePath
        ? 'Opened as source: the rendered view would reformat this file. Ctrl+E switches anyway.'
        : 'Opened as Markdown source: the rendered view would change some of this note’s formatting.');
    }
    autoGrow();
    const inTrash = !!note.trashedAt;
    const fileReadOnly = isViewerOnlyFile(note);
    el.sourceBtn.classList.toggle('hidden', plainFile || fileReadOnly); // nothing to switch between
    [el.titleInput, el.tagsInput].forEach((i) => { i.readOnly = inTrash; });
    el.bodyInput.readOnly = inTrash || fileReadOnly;
    renderLockState(note);
    if (state.rich) state.rich.setEditable(!inTrash && !fileReadOnly);
    renderFileRow(note);
    renderStickyButton(note);
    renderRemindButton(note);
    renderLiveRow(note);
    renderBookStrip(note);
    renderRelated(note);
    el.shareBtn.classList.toggle('hidden', !!note.trashedAt);
    if (find.open) closeFind();
    if (bot.open) describeBotScope();
    el.pinBtn.classList.toggle('hidden', inTrash);
    el.deleteBtn.classList.toggle('hidden', inTrash);
    el.lockBtn.classList.toggle('hidden', inTrash || !!note.filePath || !!note.vaultId);
    el.attachBtn.classList.toggle('hidden', inTrash || fileReadOnly);
    el.recordBtn.classList.toggle('hidden', inTrash || fileReadOnly);
    el.historyBtn.classList.toggle('hidden', inTrash);
    el.duplicateBtn.classList.toggle('hidden', inTrash);
    el.splitBtn.classList.toggle('hidden', inTrash);
    el.restoreBtn.classList.toggle('hidden', !inTrash);
    el.destroyBtn.classList.toggle('hidden', !inTrash);
    el.pinBtn.textContent = note.pinned ? '★' : '☆';
    el.pinBtn.classList.toggle('is-on', note.pinned);
    el.folderSelect.disabled = inTrash;
    renderFolderSelect();
    el.editorEmpty.classList.add('hidden');
    el.editor.classList.remove('hidden');
    el.noteList.querySelectorAll('.note-card').forEach((c) => c.classList.toggle('is-active', c.dataset.id === id));
    updateStatus(note);
    if (hasPending) { state.dirty = true; setSaved('Save failed'); scheduleRetry(); }
    else setSaved('Saved');
  }

  function updateStatus(note) {
    const body = el.bodyInput.value;
    const words = H.countWords(body);
    el.statusWords.textContent = words + (words === 1 ? ' word' : ' words');
    el.statusChars.textContent = body.length + (body.length === 1 ? ' character' : ' characters');
    el.statusUpdated.textContent = note.trashedAt ? 'Trashed ' + H.relativeTime(note.trashedAt) : 'Edited ' + H.relativeTime(note.updatedAt);
  }

  function setSaved(label) {
    el.statusSaved.textContent = label;
    el.statusSaved.classList.toggle('is-saving', label === 'Saving…');
    el.statusSaved.classList.toggle('is-saved', label === 'Saved');
  }

  // ---- books: folders read as pages ---------------------------------------------

  const book = { id: null, pages: [], dragId: null, seq: 0 };

  function bookOf(note) {
    if (!note || !note.folderId || note.trashedAt) return null;
    const f = flattenTree(state.tree).find((x) => x.id === note.folderId);
    return f && f.book ? f : null;
  }

  async function renderBookStrip(note) {
    const seq = ++book.seq; // only the newest call may draw: an older one resolving late must not revive a book
    const b = bookOf(note);
    el.bookStrip.classList.toggle('hidden', !b);
    if (!b) { book.id = null; book.pages = []; return; }
    const forNote = note.id;
    const pages = await api.notes.list({ folderId: b.id });
    if (seq !== book.seq || state.currentId !== forNote) return; // superseded, or moved on while loading
    book.id = b.id; book.pages = pages;
    el.bookName.textContent = b.name;
    el.bookTabs.innerHTML = '';
    pages.forEach((p, i) => {
      // A focusable div, not a <button>: Chromium does not start a drag from a button, and tabs reorder by dragging.
      const tab = document.createElement('div');
      tab.tabIndex = 0;
      tab.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tab.click(); } });
      tab.className = 'book-tab' + (p.id === note.id ? ' is-active' : '');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(p.id === note.id));
      tab.dataset.id = p.id;
      tab.draggable = true;
      tab.innerHTML = '<span class="no"></span><span class="t"></span>';
      tab.querySelector('.no').textContent = String(i + 1);
      tab.querySelector('.t').textContent = H.truncate(H.deriveTitle(p) || 'Untitled', 28);
      tab.title = H.deriveTitle(p) || 'Untitled';
      tab.addEventListener('click', () => { if (p.id !== state.currentId) selectNote(p.id); });
      tab.addEventListener('contextmenu', (e) => { e.preventDefault(); openPageMenu(p.id, tab, e); });
      tab.addEventListener('dragstart', (e) => { book.dragId = p.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'page'); });
      tab.addEventListener('dragover', (e) => { if (!book.dragId || book.dragId === p.id) return; e.preventDefault(); tab.classList.add('drop-before'); });
      tab.addEventListener('dragleave', () => tab.classList.remove('drop-before'));
      tab.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); tab.classList.remove('drop-before'); movePage(book.dragId, p.id); });
      tab.addEventListener('dragend', () => { book.dragId = null; });
      el.bookTabs.append(tab);
    });
    const idx = pages.findIndex((p) => p.id === note.id);
    el.bookPrevBtn.disabled = idx <= 0;
    el.bookNextBtn.disabled = idx === -1 || idx >= pages.length - 1;
    const active = el.bookTabs.querySelector('.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Moves page dragId so it sits just before page beforeId.
  async function movePage(dragId, beforeId) {
    if (!book.id || !dragId || dragId === beforeId) return;
    const ids = book.pages.map((p) => p.id).filter((x) => x !== dragId);
    const at = ids.indexOf(beforeId);
    ids.splice(at === -1 ? ids.length : at, 0, dragId);
    await api.folders.reorderPages(book.id, ids);
    await refresh({ keepEditor: true });
    if (state.current) renderBookStrip(state.current);
  }

  function stepPage(delta) {
    if (!book.id || !state.currentId) return false;
    const idx = book.pages.findIndex((p) => p.id === state.currentId);
    const next = book.pages[idx + delta];
    if (idx === -1 || !next) return false;
    selectNote(next.id);
    return true;
  }

  async function addPage() {
    if (!book.id) return;
    await flushSave();
    let note;
    try { note = await api.notes.create({ folderId: book.id, title: '' }); }
    catch (err) { toast('Could not add a page: ' + (err.message || err)); return; }
    await refresh({ keepEditor: true });
    await selectNoteNow(note.id);
    el.titleInput.focus();
  }

  async function toggleBook(folderId, on) {
    try { await api.folders.setBook(folderId, on); }
    catch (err) { toast('Could not change the folder: ' + (err.message || err)); return; }
    await refresh({ keepEditor: true });
    if (state.current) renderBookStrip(state.current);
    toast(on ? 'This folder is now a book: its notes are pages you can page through and reorder.' : 'Back to an ordinary folder.');
  }

  // ---- split a long note into a book at its headings -------------------------------

  async function openSplitDialog() {
    const note = state.current;
    if (!note || note.trashedAt) return;
    if (note.locked || note.lock) { toast('Unlock and remove the lock first: a locked note cannot be split.'); return; }
    if (note.filePath) { toast('This note is a file on disk; only notes kept in the app can be split.'); return; }
    await flushSave();
    if (!state.current || state.current.id !== note.id) return;
    const plan = H.splitAtHeadings(state.current.body, H.deriveTitle(state.current));
    if (plan.pages.length < 2) { toast('Add at least two headings (lines starting with #) to split this note into pages.'); return; }
    state.splitNoteId = note.id;
    el.splitLead.textContent = 'This makes a book with ' + plan.pages.length + ' pages, one per ' + (plan.level ? '#'.repeat(plan.level) + ' heading' : 'heading') + ':';
    el.splitPages.innerHTML = '';
    for (const p of plan.pages) {
      const li = document.createElement('li');
      li.textContent = p.title;
      const n = p.body ? p.body.split('\n').length : 0;
      const small = document.createElement('span');
      small.className = 'lines';
      small.textContent = n ? n + (n === 1 ? ' line' : ' lines') : 'empty';
      li.append(small);
      el.splitPages.append(li);
    }
    el.splitName.value = plan.name;
    el.splitKeep.checked = false;
    el.splitDialog.showModal();
    el.splitName.focus(); el.splitName.select();
  }

  async function applySplit() {
    const id = state.splitNoteId;
    state.splitNoteId = null;
    el.splitDialog.close();
    if (!id) return;
    await flushSave();
    let r;
    try { r = await api.notes.splitIntoBook(id, { name: el.splitName.value, keepOriginal: el.splitKeep.checked }); }
    catch (err) { toast('Could not split the note: ' + ipcErrorText(err)); return; }
    if (r.originalTrashed && state.currentId === id) clearEditor();
    await setView('folder', r.folder.id, { keepEditor: true });
    await selectNoteNow(r.pageIds[0]);
    toast('Made the book "' + H.truncate(r.folder.name, 30) + '" with ' + r.pageIds.length + ' pages' + (r.originalTrashed ? '; the original note is in the trash.' : '.'), {
      label: 'Undo',
      run: async () => {
        await flushSave();
        try { await api.notes.undoSplit(r.folder.id, r.pageIds, r.originalTrashed ? id : null); }
        catch (err) { toast('Could not undo the split: ' + ipcErrorText(err)); return; }
        // Go back to the original only if the person is still in the book; otherwise leave their view alone.
        const inBook = (state.view === 'folder' && state.folderId === r.folder.id) || r.pageIds.includes(state.currentId);
        if (!inBook) { await refresh(); return; }
        clearEditor();
        await setView('all', null, { keepEditor: true });
        await selectNoteNow(id);
      },
    });
  }

  // Puts page id right after page afterId in the book's reading order.
  async function placePageAfter(id, afterId) {
    const pages = await api.notes.list({ folderId: book.id });
    const ids = pages.map((p) => p.id).filter((x) => x !== id);
    const at = ids.indexOf(afterId);
    ids.splice(at === -1 ? ids.length : at + 1, 0, id);
    await api.folders.reorderPages(book.id, ids);
  }

  function openPageMenu(id, anchor, ev) {
    closeAllBookMenus();
    state.menuPageId = id;
    state.menuBookId = book.id;
    const idx = book.pages.findIndex((p) => p.id === id);
    el.pageMenu.querySelector('[data-action="move-left"]').disabled = idx <= 0;
    el.pageMenu.querySelector('[data-action="move-right"]').disabled = idx === -1 || idx >= book.pages.length - 1;
    placePopover(el.pageMenu, anchor, ev);
  }

  function openBookMenu() {
    closeAllBookMenus();
    if (!book.id) return;
    placePopover(el.bookMenu, el.bookName, null);
  }

  function closeAllBookMenus() {
    state.menuPageId = null;
    state.menuBookId = null;
    el.pageMenu.classList.add('hidden');
    el.bookMenu.classList.add('hidden');
  }

  async function pageMenuAction(action) {
    const id = state.menuPageId;
    const bookId = state.menuBookId;
    closeAllBookMenus();
    if (!id || !bookId) return;
    await flushSave();
    if (book.id !== bookId) return; // the person moved to another book meanwhile: act on nothing
    const idx = book.pages.findIndex((p) => p.id === id);
    const page = book.pages[idx];
    try {
      if (action === 'rename') {
        if (id !== state.currentId) await selectNoteNow(id);
        el.titleInput.focus(); el.titleInput.select();
      } else if (action === 'insert-after') {
        const note = await api.notes.create({ folderId: book.id, title: '' });
        await placePageAfter(note.id, id);
        await refresh({ keepEditor: true });
        await selectNoteNow(note.id);
        el.titleInput.focus();
      } else if (action === 'duplicate') {
        const copy = await api.notes.duplicate(id);
        await placePageAfter(copy.id, id);
        await refresh({ keepEditor: true });
        await selectNoteNow(copy.id);
        toast('Page duplicated');
      } else if (action === 'move-left' || action === 'move-right') {
        const ids = book.pages.map((p) => p.id);
        const to = idx + (action === 'move-left' ? -1 : 1);
        if (idx === -1 || to < 0 || to >= ids.length) return;
        ids.splice(idx, 1); ids.splice(to, 0, id);
        await api.folders.reorderPages(book.id, ids);
        await refresh({ keepEditor: true });
        if (state.current) renderBookStrip(state.current);
      } else if (action === 'copy-link') {
        await api.app.copy({ text: '[' + (H.deriveTitle(page) || 'Page') + '](note://' + id + ')' });
        toast('Copied. Paste it into another note to link to this page.');
      } else if (action === 'delete') {
        if (id === state.currentId) { await trashCurrent(); return; }
        const title = H.deriveTitle(page) || 'Untitled';
        await api.notes.trash(id);
        await refresh({ keepEditor: true });
        if (state.current) renderBookStrip(state.current);
        toast('Moved "' + H.truncate(title, 30) + '" to trash', { label: 'Undo', run: async () => { await api.notes.restore(id); await refresh({ keepEditor: true }); if (state.current) renderBookStrip(state.current); } });
      }
    } catch (err) {
      toast('Could not change the page: ' + (err.message || err));
    }
  }

  async function bookMenuAction(action) {
    closeAllBookMenus();
    if (!book.id) return;
    if (action === 'read') openReader();
    else if (action === 'export-md') exportBook('md');
    else if (action === 'export-html') exportBook('html');
    else if (action === 'export-pdf') exportBook('pdf');
    else if (action === 'print') exportBook('print');
    else if (action === 'rename') renameBookInline();
    else if (action === 'unbook') toggleBook(book.id, false);
  }

  // Renames the book in place: the strip's name becomes a text field.
  function renameBookInline() {
    const folder = flattenTree(state.tree).find((f) => f.id === book.id);
    if (!folder) return;
    const input = document.createElement('input');
    input.className = 'book-name-input';
    input.value = folder.name;
    input.setAttribute('aria-label', 'Book name');
    let done = false;
    const finish = async (save) => {
      if (done) return; done = true;
      const name = input.value.trim();
      input.replaceWith(el.bookName);
      if (save && name && name !== folder.name) {
        try { await api.folders.rename(folder.id, name); } catch (err) { toast('Could not rename the book: ' + (err.message || err)); }
        await refresh({ keepEditor: true });
      }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
    el.bookName.replaceWith(input);
    input.focus(); input.select();
  }

  // Gathers the current book: its name and pages in order, each with Markdown and HTML.
  // Locked pages stay locked: only their title goes in.
  async function collectBook(bookId) {
    await flushSave();
    const folder = flattenTree(state.tree).find((f) => f.id === bookId);
    const pages = await api.notes.list({ folderId: bookId });
    // One file at a time: a book of PDFs must not start a reader for every page at once.
    const bodies = [];
    for (const p of pages) bodies.push(p.locked && !p.unlocked ? '' : await pageMarkdown(p));
    return {
      name: folder ? folder.name : 'Book',
      pages: pages.map((p, i) => {
        const locked = !!(p.locked && !p.unlocked);
        const body = locked ? '' : bodies[i];
        return { id: p.id, no: i + 1, title: H.deriveTitle(p) || 'Untitled', locked, body, html: locked ? '' : markdownToHtml(body, p) };
      }),
    };
  }

  // A page as Markdown. An opened file that is not Markdown (plain text, Word, PDF) is converted the way "Convert
  // to… Markdown" would, so its text is never read as Markdown by accident.
  async function pageMarkdown(p) {
    if (!isNonMarkdownFile(p)) return String(p.body || '');
    try {
      const r = await api.files.asMarkdown(p.id);
      return r.ok ? r.markdown : '*Could not show this file: ' + r.error + '*';
    } catch (err) { return '*Could not show this file: ' + ipcErrorText(err) + '*'; }
  }

  function bookMarkdown(b) {
    const toc = b.pages.map((p) => p.no + '. ' + p.title).join('\n');
    const parts = b.pages.map((p) => '## ' + p.title + '\n\n' + (p.locked ? '_This page is locked._' : p.body.trim()) + '\n');
    return '# ' + b.name + '\n\n**Contents**\n\n' + toc + '\n\n' + parts.join('\n');
  }

  // The book as HTML: its name, a contents list linking to the pages, then one section per page.
  function bookHtml(b) {
    const toc = '<nav class="book-toc"><h2>Contents</h2><ol>' + b.pages.map((p) => '<li><a href="#page-' + p.no + '" data-page="' + p.no + '">' + escapeHtml(p.title) + '</a></li>').join('') + '</ol></nav>';
    const pages = b.pages.map((p) => '<section class="book-page" id="page-' + p.no + '"><h2>' + escapeHtml(p.title) + '</h2>' +
      (p.locked ? '<p class="book-page-locked">This page is locked.</p>' : p.html) + '</section>').join('\n');
    return '<h1>' + escapeHtml(b.name) + '</h1>' + toc + pages;
  }

  async function exportBook(format) {
    const bookId = readerOpen() ? reader.bookId : book.id; // the reader's buttons export the book being read
    if (!bookId) return;
    const b = await collectBook(bookId);
    if (!b.pages.length) { toast('This book has no pages yet.'); return; }
    const r = await api.book.export(format, { name: b.name, markdown: bookMarkdown(b), html: bookHtml(b) });
    if (r.ok) toast(format === 'print' ? 'Sent the book to the printer' : 'Saved the book to ' + r.filePath);
    else if (!r.canceled) toast('Could not export the book: ' + r.error);
  }

  // ---- whole-book reading view ----------------------------------------------------

  // The reading view is a snapshot of one book; reader.bookId says which.
  const reader = { bookId: null, seq: 0 };

  async function openReader() {
    const bookId = book.id;
    if (!bookId) return;
    const seq = ++reader.seq;
    const b = await collectBook(bookId);
    if (seq !== reader.seq || book.id !== bookId) return; // moved on while the pages loaded
    reader.bookId = bookId;
    el.bookReaderTitle.textContent = b.name;
    el.bookReaderToc.innerHTML = '<h2>Contents</h2><ol>' + b.pages.map((p) => '<li><a data-page="' + p.no + '">' + escapeHtml(p.title) + '</a></li>').join('') + '</ol>';
    el.bookReaderBody.innerHTML = b.pages.map((p) => '<article class="book-page" id="reader-page-' + p.no + '">' +
      '<div class="book-page-head"><span class="no">' + p.no + '</span><h2>' + escapeHtml(p.title) + '</h2><button class="tool-btn" data-edit="' + p.id + '">Edit</button></div>' +
      (p.locked ? '<p class="book-page-locked">This page is locked. Open it to unlock.</p>' : '<div class="rich-editor-content">' + p.html + '</div>') + '</article>').join('');
    el.bookReader.classList.remove('hidden');
    el.bookReaderScroll.scrollTop = 0;
    el.bookReaderCloseBtn.focus();
  }

  function closeReader() {
    reader.seq++; // an opening still loading must not appear after this
    reader.bookId = null;
    el.bookReader.classList.add('hidden');
    el.bookReaderBody.innerHTML = '';
  }

  function readerOpen() { return !el.bookReader.classList.contains('hidden'); }

  // ---- related notes --------------------------------------------------------------

  let relatedTimer = null;
  function renderRelatedSoon() { clearTimeout(relatedTimer); relatedTimer = setTimeout(() => { if (state.current) renderRelated(state.current); }, 400); }

  async function renderRelated(note) {
    if (!note || note.trashedAt) { el.relatedPanel.classList.add('hidden'); return; }
    const forNote = note.id;
    let r;
    try { r = await api.notes.related(note.id); } catch (_) { r = null; }
    if (state.currentId !== forNote) return;
    if (!r) { el.relatedPanel.classList.add('hidden'); return; }
    const fill = (group, items) => {
      const ul = group.querySelector('ul');
      ul.innerHTML = '';
      for (const it of items) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = (it.locked ? '🔒 ' : '') + it.title;
        if (it.sharedTags && it.sharedTags.length) { const t = document.createElement('span'); t.className = 'tags'; t.textContent = it.sharedTags.map((x) => '#' + x).join(' '); b.append(t); }
        if (it.missing) { b.classList.add('is-missing'); b.disabled = true; b.title = 'This link points at a note that no longer exists.'; }
        else { b.title = it.trashed ? 'In the trash' : 'Open'; b.addEventListener('click', () => followLink('note://' + it.id)); }
        li.append(b);
        ul.append(li);
      }
      group.classList.toggle('hidden', !items.length);
    };
    fill(el.relatedOut, r.outgoing);
    fill(el.relatedIn, r.incoming);
    fill(el.relatedTags, r.byTags);
    el.relatedPanel.classList.toggle('hidden', !(r.outgoing.length || r.incoming.length || r.byTags.length));
  }

  // ---- live share --------------------------------------------------------------

  state.lastTypedAt = 0;
  state.liveStatus = {};

  function renderLiveRow(note) {
    const live = note && note.live;
    el.liveRow.classList.toggle('hidden', !live);
    if (!live) return;
    const s = state.liveStatus[note.id];
    const peers = s ? s.peers : 0;
    const connected = s ? s.connected : false;
    el.liveRow.classList.toggle('is-off', !connected);
    el.liveText.textContent = live.role === 'host'
      ? ('Live: you are sharing this note · ' + peers + (peers === 1 ? ' person' : ' people') + ' connected' + (s && s.localOnly ? ' · no network found, the link only works on this computer' : '') + (s && s.error ? ' · ' + s.error : ''))
      : (connected ? ('Live: following a shared note' + (s && s.pending ? ' · sending your edits…' : '')) : ('Live: reconnecting to the host…' + (s && s.error ? ' (' + s.error + ')' : '') + (s && s.pending ? ' · your edits will be sent when it is back' : '')));
  }

  async function startLiveHost() {
    const note = state.current;
    if (!note) return;
    const r = await api.live.host(note.id);
    if (!r.ok) { toast('Could not share: ' + r.error); return; }
    await refreshCurrentMeta();
    openLiveDialog('link', r.status.url);
  }

  async function stopLive() {
    const note = state.current;
    if (!note || !note.live) return;
    await flushSave();
    await api.live.stop(note.id);
    delete state.liveStatus[note.id];
    await refreshCurrentMeta();
    toast('Live share ended. The note stays.');
  }

  function openLiveDialog(mode, url) {
    el.liveDialog.dataset.mode = mode;
    const hosting = mode === 'link';
    el.liveDialogTitle.textContent = hosting ? 'Live share link' : 'Join a live share';
    el.liveDialogHint.textContent = hosting
      ? 'Anyone on your local network with this link edits this note with you, live. The link is not encrypted, so use it on networks you trust. Windows may ask once to allow Notes through the firewall; say yes or nobody can connect. Stop sharing from the Share menu when you are done.'
      : 'Paste the link the other person shared. You get your own copy of the note that stays in step while the share lasts.';
    el.liveLinkLabel.textContent = hosting ? 'Link' : 'Link to join';
    el.liveLinkInput.value = hosting ? url : '';
    el.liveLinkInput.readOnly = hosting;
    el.liveCopyBtn.classList.toggle('hidden', !hosting);
    el.liveSubmitBtn.classList.toggle('hidden', hosting);
    el.liveCancelBtn.textContent = hosting ? 'Close' : 'Cancel';
    el.liveError.textContent = '';
    el.liveDialog.showModal();
    el.liveLinkInput.focus();
    el.liveLinkInput.select();
  }

  async function submitLiveDialog() {
    if (el.liveDialog.dataset.mode !== 'join') { el.liveDialog.close(); return; }
    const url = el.liveLinkInput.value.trim();
    if (!url) { el.liveError.textContent = 'Paste a link.'; return; }
    el.liveSubmitBtn.disabled = true;
    el.liveError.textContent = 'Connecting…';
    try {
      const r = await api.live.join(url, state.view === 'folder' ? state.folderId : null);
      if (!r.ok) { el.liveError.textContent = r.error; return; }
      el.liveDialog.close();
      state.liveStatus[r.noteId] = r.status;
      await setView('all');
      await selectNoteNow(r.noteId);
      toast('Joined. Edits on either side show up here as they happen.');
    } finally {
      el.liveSubmitBtn.disabled = false;
    }
  }

  // ---- locking -----------------------------------------------------------------

  const lockedNow = () => !!(state.current && state.current.locked && !state.current.unlocked);

  function renderLockState(note) {
    const locked = !!(note && note.locked);
    const open = !!(note && note.unlocked);
    el.lockScreen.classList.toggle('hidden', !(locked && !open));
    el.lockScreenError.textContent = '';
    el.lockScreenPassword.value = '';
    el.lockBtn.classList.toggle('is-on', locked);
    el.lockBtn.textContent = !locked ? '🔒 Lock' : (open ? '🔓 Unlocked' : '🔒 Locked');
    el.lockBtn.title = !locked ? 'Lock this note with a password (Ctrl+L)' : (open ? 'Unlocked for now: lock again or remove the lock (Ctrl+L)' : 'Locked. Enter the password below to read it (Ctrl+L)');
    if (locked && !open) {
      el.richEditor.classList.add('hidden');
      el.bodyInput.classList.add('hidden');
      if (state.rich) state.rich.setEditable(false);
    } else if (note) {
      renderFileRow(note); // restores the right editor for the mode
      if (state.rich) state.rich.setEditable(!note.trashedAt && !isViewerOnlyFile(note));
    }
  }

  function onLockButton() {
    const note = state.current;
    if (!note || note.trashedAt || note.filePath) return;
    if (!note.locked) { openLockDialog('set'); return; }
    if (!note.unlocked) { el.lockScreenPassword.focus(); return; }
    placePopover(el.lockMenu, el.lockBtn);
    el.lockMenu.querySelector('button').focus();
  }

  function openLockDialog(mode) {
    el.lockDialog.dataset.mode = mode;
    el.lockDialogTitle.textContent = mode === 'set' ? 'Lock note' : 'Remove lock';
    el.lockDialogHint.textContent = mode === 'set'
      ? 'The text is encrypted with this password. There is no recovery: if you forget it, the note stays locked.'
      : 'Enter the password to store this note in clear again.';
    el.lockConfirmRow.classList.toggle('hidden', mode !== 'set');
    el.lockSubmitBtn.textContent = mode === 'set' ? 'Lock' : 'Remove lock';
    el.lockPassword.value = ''; el.lockPassword2.value = ''; el.lockError.textContent = '';
    el.lockDialog.showModal();
    el.lockPassword.focus();
  }

  async function submitLockDialog() {
    const note = state.current;
    if (!note) return;
    const mode = el.lockDialog.dataset.mode;
    const pw = el.lockPassword.value;
    if (!pw) { el.lockError.textContent = 'Enter a password.'; return; }
    if (mode === 'set' && pw !== el.lockPassword2.value) { el.lockError.textContent = 'The two passwords differ.'; return; }
    await flushSave();
    try {
      const updated = mode === 'set' ? await api.lock.set(note.id, pw) : await api.lock.remove(note.id, pw);
      el.lockDialog.close();
      applyLockedNote(updated);
      toast(mode === 'set' ? 'Locked. It stays readable until you hide the app or choose Lock now.' : 'Lock removed.');
    } catch (err) {
      el.lockError.textContent = ipcErrorText(err);
    }
  }

  async function unlockFromScreen() {
    const note = state.current;
    if (!note) return;
    const pw = el.lockScreenPassword.value;
    if (!pw) { el.lockScreenError.textContent = 'Enter the password.'; return; }
    try {
      const updated = await api.lock.unlock(note.id, pw);
      applyLockedNote(updated);
      focusBody();
    } catch (err) {
      el.lockScreenError.textContent = /wrong password/i.test(String(err.message)) ? 'Wrong password.' : ipcErrorText(err);
      el.lockScreenPassword.select();
    }
  }

  // Swaps the open note for its fresh view after a lock change: body, editor, button, card.
  function applyLockedNote(updated) {
    if (!updated || updated.id !== state.currentId) return;
    state.current = updated;
    // Keystrokes that landed while the lock call ran (scrypt takes a moment) are kept and saved again;
    // a relocked note, on the other hand, must show no plaintext at all.
    const keepTyping = state.dirty && updated.unlocked;
    if (!keepTyping) {
      state.dirty = false;
      el.bodyInput.value = updated.body;
      if (state.rich) {
        state.currentLossless = state.rich.setMarkdown(updated.body);
        // Same rule as opening a note: text the rendered view would rewrite opens as source.
        if (updated.unlocked && state.currentLossless === false && !state.sourceMode && state.lossyOverride !== updated.id) { applyEditorMode(true); toast('Switched to source: this note contains formatting the rendered view would change.'); }
      }
      state.pending.delete(updated.id);
      autoGrow();
      if (find.open) runFind(true, true, true);
    } else scheduleSave();
    renderLockState(updated);
    renderStickyButton(updated);
    updateStatus(updated);
    const idx = state.notes.findIndex((n) => n.id === updated.id);
    if (idx !== -1) { state.notes[idx] = updated; refreshCard(updated); }
  }

  async function lockMenuAction(action) {
    el.lockMenu.classList.add('hidden');
    const note = state.current;
    if (!note || !note.locked) return;
    if (action === 'relock') {
      const saved = await flushSave();
      if (!saved) { toast('Your latest typing could not be saved yet, so the note was not locked. Try again in a moment.'); return; }
      state.pending.delete(note.id);
      applyLockedNote(await api.lock.relock(note.id));
      toast('Locked.');
    }
    else if (action === 'remove') openLockDialog('remove');
  }

  // ---- reminders ---------------------------------------------------------------

  function renderRemindButton(note) {
    const on = !!(note && note.remindAt);
    el.remindBtn.classList.toggle('hidden', !note || !!note.trashedAt);
    el.remindBtn.classList.toggle('is-on', on);
    el.remindBtn.textContent = on ? '⏰ ' + H.formatWhen(note.remindAt) : '⏰ Remind';
    el.remindBtn.title = on ? 'Reminder set for ' + H.formatWhen(note.remindAt) + ' (Ctrl+Shift+M to change)' : 'Remind me about this note (Ctrl+Shift+M)';
  }

  function toLocalInputValue(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function quickPick(kind) {
    const d = new Date();
    d.setSeconds(0, 0);
    if (kind === '1h') { d.setTime(d.getTime() + 3600 * 1000); return d.getTime(); }
    if (kind === 'evening') { if (d.getHours() >= 18) d.setDate(d.getDate() + 1); d.setHours(18, 0, 0, 0); return d.getTime(); }
    if (kind === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime(); }
    if (kind === 'monday') { const add = ((8 - d.getDay()) % 7) || 7; d.setDate(d.getDate() + add); d.setHours(9, 0, 0, 0); return d.getTime(); }
    return null;
  }

  function openRemindDialog() {
    const note = state.current;
    if (!note || note.trashedAt) return;
    const base = note.remindAt || (Math.ceil(Date.now() / (3600 * 1000)) * 3600 * 1000);
    el.remindInput.value = toLocalInputValue(base);
    el.remindCurrent.textContent = note.remindAt ? ('Currently: ' + H.formatWhen(note.remindAt) + (note.remindedAt ? ' (went off)' : '')) : 'No reminder on this note.';
    el.remindClearBtn.classList.toggle('hidden', !note.remindAt);
    el.remindDialog.showModal();
    el.remindInput.focus();
  }

  async function setReminder(at) {
    const note = state.current;
    if (!note) return;
    el.remindDialog.close();
    await flushSave();
    try {
      await api.notes.update(note.id, { remindAt: at });
      await refreshCurrentMeta();
      toast(at ? 'Reminder set for ' + H.formatWhen(at) : 'Reminder cleared');
    } catch (err) {
      toast('Could not save the reminder: ' + (err.message || err));
    }
  }

  // ---- sharing -----------------------------------------------------------------

  function placePopover(menu, anchor) {
    menu.classList.remove('hidden');
    const rect = anchor.getBoundingClientRect();
    let x = rect.left, y = rect.bottom + 4;
    menu.style.left = '0px'; menu.style.top = '0px';
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
    if (y + mh > window.innerHeight - 8) y = rect.top - mh - 4;
    menu.style.left = Math.max(8, x) + 'px';
    menu.style.top = Math.max(8, y) + 'px';
  }

  function openShareMenu() {
    if (!state.current || state.current.trashedAt) return;
    el.shareReveal.classList.toggle('hidden', !state.current.filePath);
    el.shareLiveHost.classList.toggle('hidden', !!state.current.live || !!state.current.locked || !!state.current.filePath);
    el.shareLiveStop.classList.toggle('hidden', !state.current.live);
    placePopover(el.shareMenu, el.shareBtn);
    const first = el.shareMenu.querySelector('button:not(.hidden)');
    if (first) first.focus();
  }

  function closeShareMenu() {
    el.shareMenu.classList.add('hidden');
  }

  // The note as HTML: what the rendered view shows, or a one-off render when the source view is up.
  function currentHtml() {
    const live = !state.sourceMode && state.rich ? el.richEditor.querySelector('.rich-editor-content') : null;
    if (live) return live.innerHTML;
    return markdownToHtml(el.bodyInput.value, state.current);
  }

  // Renders Markdown with the editor itself, off screen, so exports look like the rendered view. note: whose
  // relative pictures these are (an opened file's are read from its folder).
  function markdownToHtml(md, note) {
    if (!window.NotesEditor) return '<pre>' + escapeHtml(md) + '</pre>';
    const host = document.createElement('div');
    host.style.position = 'absolute'; host.style.left = '-99999px';
    document.body.append(host);
    try {
      let ed = null;
      try {
        ed = window.NotesEditor.create(host, { imageBase: () => H.imageBaseFor(note) });
        ed.setMarkdown(String(md || ''));
        return host.querySelector('.rich-editor-content').innerHTML;
      } finally { if (ed) ed.destroy(); }
    } finally { host.remove(); }
  }

  async function shareAction(action) {
    closeShareMenu();
    let note = state.current;
    if (!note) return;
    if (note.locked && !note.unlocked) { toast('Unlock the note first.'); return; }
    await flushSave();
    if (!state.current || state.current.id !== note.id) return; // the person moved on
    note = state.current; // the saved view, including a title typed a moment ago
    const titleLine = note.title ? note.title + '\n\n' : '';
    try {
      if (action === 'copy-md') { await api.app.copy({ text: H.noteToMarkdown(note) }); toast('Copied as Markdown'); }
      else if (action === 'copy-text') { await api.app.copy({ text: titleLine + H.plainTextFromMarkdown(el.bodyInput.value) }); toast('Copied as plain text'); }
      else if (action === 'copy-html') { await api.app.copy({ text: H.noteToMarkdown(note), html: (note.title ? '<h1>' + escapeHtml(note.title) + '</h1>' : '') + currentHtml() }); toast('Copied as rich text'); }
      else if (action === 'copy-note-link') { await api.app.copy({ text: '[' + (H.deriveTitle(note) || 'Note') + '](note://' + note.id + ')' }); toast('Copied. Paste it into another note to link here.'); }
      else if (action === 'email') { const r = await api.app.emailNote(note.id); toast(r.ok ? (r.truncated ? 'Opened your mail app. The note was long, so the email holds the first part; attach a PDF for the rest.' : 'Opened your mail app with the note.') : 'Could not open mail: ' + r.error); }
      else if (action === 'pdf') {
        if (find.open) closeFind();
        const chosen = await api.app.pdfPath(note.id);
        if (!chosen.ok) { if (!chosen.canceled) toast('Could not save PDF: ' + chosen.error); return; }
        // The page is what prints: it must still show this very note, unlocked, with nothing unsaved.
        if (state.currentId !== note.id || lockedNow()) { toast('The note changed while the dialog was open; nothing was saved.'); return; }
        await flushSave();
        const r = await api.app.writePdf(chosen.filePath);
        if (r.ok) toast('Saved PDF to ' + r.filePath); else toast('Could not save PDF: ' + r.error);
      }
      else if (action === 'html') { const r = await api.app.exportHtml(note.id, currentHtml()); if (r.ok) toast('Saved HTML to ' + r.filePath); else if (!r.canceled) toast('Could not save HTML: ' + r.error); }
      else if (action === 'md') { await exportCurrent(); }
      else if (action === 'reveal') { await api.files.reveal(note.id); }
      else if (action === 'live-host') { await startLiveHost(); }
      else if (action === 'live-join') { openLiveDialog('join'); }
      else if (action === 'live-stop') { await stopLive(); }
    } catch (err) {
      toast('Share failed: ' + (err.message || err));
    }
  }

  // ---- attachments and voice memos --------------------------------------------

  function insertAttachmentLinks(items) {
    const ok = items.filter((x) => x && !x.error);
    const bad = items.filter((x) => x && x.error);
    for (const it of ok) insertLinkIntoNote('📎 ' + it.name, it.href);
    if (ok.length) toast(ok.length === 1 ? 'Attached ' + ok[0].name : 'Attached ' + ok.length + ' files');
    for (const b of bad) toast('Could not attach ' + b.name + ': ' + b.error);
  }

  // Puts a Markdown link at the caret in whichever view is up, and saves.
  function insertLinkIntoNote(text, href) {
    if (!state.current || lockedNow()) return;
    if (state.sourceMode || !state.rich) {
      const ta = el.bodyInput;
      if (ta.readOnly) return;
      const at = typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length;
      const end = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : at;
      const md = '[' + text.replace(/[\[\]]/g, '') + '](' + href + ')';
      const before = ta.value.slice(0, at), after = ta.value.slice(end);
      const sep = before && !/\s$/.test(before) ? ' ' : '';
      ta.value = before + sep + md + ' ' + after;
      const pos = (before + sep + md + ' ').length;
      ta.setSelectionRange(pos, pos);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      state.rich.insertLink(text, href);
    }
  }

  async function attachFiles() {
    if (!state.current || lockedNow() || state.current.trashedAt || isViewerOnlyFile(state.current)) { toast('Open an editable, unlocked note first.'); return; }
    const forNote = state.current.id;
    await flushSave();
    const items = await api.attachments.pick();
    if (state.currentId === forNote) { insertAttachmentLinks(items); return; }
    // The person moved to another note while the picker was open: the files belong to the note they chose.
    const ok = items.filter((x) => x && !x.error);
    if (!ok.length) { insertAttachmentLinks(items); return; }
    const target = await api.notes.get(forNote);
    if (target && !target.locked && !target.trashedAt && !isViewerOnlyFile(target)) {
      const links = ok.map((it) => '[📎 ' + it.name.replace(/[[\]]/g, '') + '](' + it.href + ')').join('\n');
      await api.notes.update(forNote, { body: (target.body ? target.body.replace(/\s*$/, '') + '\n\n' : '') + links + '\n' });
      toast('Attached to "' + H.truncate(H.deriveTitle(target), 30) + '", the note that was open when you chose the files.');
      refresh({ keepEditor: true });
    } else toast('Attached files are kept in the attachments folder; that note can no longer take them.');
  }

  const rec = { recorder: null, chunks: [], startedAt: 0, timer: null, noteId: null, starting: false };

  async function toggleRecording() {
    if (rec.recorder) { rec.recorder.stop(); return; }
    if (rec.starting) return; // the microphone prompt is still up
    if (!state.current || lockedNow() || state.current.trashedAt || isViewerOnlyFile(state.current)) { toast('Open an editable, unlocked note first.'); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Recording is not available here.'); return; }
    rec.noteId = state.current.id;
    rec.starting = true;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (err) { rec.starting = false; toast('Microphone not available: ' + (err.message || err)); return; }
    rec.starting = false;
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    rec.recorder = recorder; rec.chunks = []; rec.startedAt = Date.now();
    recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) rec.chunks.push(ev.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(rec.timer);
      el.recordBtn.classList.remove('is-recording');
      el.recordBtn.textContent = '🎙 Record';
      const seconds = Math.max(1, Math.round((Date.now() - rec.startedAt) / 1000));
      rec.recorder = null;
      const blob = new Blob(rec.chunks, { type: 'audio/webm' });
      if (!blob.size) { toast('Nothing was recorded.'); return; }
      try {
        const saved = await api.attachments.saveRecording(new Uint8Array(await blob.arrayBuffer()), 'webm');
        const mm = String(Math.floor(seconds / 60)).padStart(2, '0'), ss = String(seconds % 60).padStart(2, '0');
        const label = '🎙 Voice memo ' + mm + ':' + ss;
        if (state.currentId === rec.noteId && !lockedNow()) {
          insertLinkIntoNote(label, saved.href);
          toast('Voice memo saved (' + mm + ':' + ss + '). Ctrl+click the link to play it.');
        } else {
          // The person moved to another note meanwhile: the memo still belongs to the note it was recorded in.
          const target = await api.notes.get(rec.noteId);
          if (target && !target.locked && !target.trashedAt && !isViewerOnlyFile(target)) {
            await api.notes.update(rec.noteId, { body: (target.body ? target.body.replace(/\s*$/, '') + '\n\n' : '') + '[' + label + '](' + saved.href + ')\n' });
            toast('Voice memo saved into "' + H.truncate(H.deriveTitle(target), 30) + '", the note it was recorded in.');
            refresh({ keepEditor: true });
          } else toast('Voice memo saved as ' + saved.name + ' (that note can no longer take it; Attach it where you want it).');
        }
      } catch (err) { toast('Could not save the recording: ' + (err.message || err)); }
    };
    recorder.start(250);
    el.recordBtn.classList.add('is-recording');
    const tick = () => { const s = Math.round((Date.now() - rec.startedAt) / 1000); el.recordBtn.textContent = '⏹ ' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
    tick(); rec.timer = setInterval(tick, 500);
  }

  // ---- earlier versions ----------------------------------------------------------

  const hist = { versions: [], index: -1, noteId: null };

  async function openHistory() {
    const note = state.current;
    if (!note) return;
    if (note.trashedAt) { toast('Restore the note from the trash first; then its earlier versions can be restored.'); return; }
    await flushSave();
    el.historyList.innerHTML = '';
    el.historyPreview.textContent = '';
    el.historyRestoreBtn.disabled = true;
    el.historyStatus.textContent = 'Loading…';
    el.historyDialog.showModal();
    const r = await api.app.historyVersions(note.id, 80);
    if (!r.ok) { el.historyStatus.textContent = r.error; return; }
    hist.noteId = note.id; // Restore only ever writes into the note these versions belong to
    hist.versions = r.versions.filter((v) => v.body !== r.current); // what differs from now
    hist.index = -1;
    el.historyStatus.textContent = hist.versions.length ? hist.versions.length + (hist.versions.length === 1 ? ' earlier version' : ' earlier versions') : 'No earlier version differs from the current text yet.';
    hist.versions.forEach((v, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.index = i;
      const first = (v.body.split('\n').find((l) => l.trim()) || '(empty)').replace(/^#+\s*/, '');
      li.innerHTML = '<span class="when"></span><span class="first"></span>';
      li.querySelector('.when').textContent = new Date(v.at).toLocaleString() + ' · ' + v.chars + ' chars';
      li.querySelector('.first').textContent = H.truncate(first, 48);
      li.addEventListener('click', () => showVersion(i));
      el.historyList.append(li);
    });
    if (hist.versions.length) showVersion(0);
  }

  function showVersion(i) {
    hist.index = i;
    for (const li of el.historyList.children) li.classList.toggle('is-active', Number(li.dataset.index) === i);
    el.historyPreview.textContent = hist.versions[i].body;
    el.historyRestoreBtn.disabled = false;
  }

  async function restoreVersion() {
    const v = hist.versions[hist.index];
    const note = state.current;
    if (!v || !note) return;
    el.historyDialog.close();
    if (state.currentId !== hist.noteId || note.id !== hist.noteId || note.trashedAt || lockedNow() || isViewerOnlyFile(note)) { toast('This note cannot take the restored text right now.'); return; }
    el.bodyInput.value = v.body;
    if (state.rich) {
      let lossless = state.rich.setMarkdown(v.body);
      if (note.filePath && lossless && !state.rich.lastRoundTripExact()) lossless = false; // a real file gets the strict test
      state.currentLossless = lossless;
      state.lossyOverride = null;
      if (!lossless && !state.sourceMode) applyEditorMode(true); // text the rendered view would rewrite opens as source
    }
    autoGrow();
    if (find.open) runFind(true, true, true); // the text changed under the find bar
    scheduleSave();
    const ok = await flushSave();
    if (ok) toast('Restored the version from ' + new Date(v.at).toLocaleString() + '. The text you had is still in history.');
    else if (state.conflictShown !== note.id) toast('Could not save the restored text yet; it will be retried.');
  }

  // ---- find in note, print ---------------------------------------------------

  // Done in the page, not with Chromium's page-wide find: only the note is searched, the count is exact,
  // and it works whether the note is shown rendered (Custom Highlight API) or as source (textarea selection).
  const find = { open: false, query: '', ranges: [], active: -1, sourceHits: [] };

  function openFind() {
    if (!state.current) return;
    find.open = true;
    el.findBar.classList.remove('hidden');
    const sel = String(window.getSelection && window.getSelection().toString() || '').trim();
    if (!sel && document.activeElement === el.bodyInput) {
      const t = el.bodyInput.value.slice(el.bodyInput.selectionStart, el.bodyInput.selectionEnd).trim();
      if (t) el.findInput.value = t;
    } else if (sel && sel.length < 200) el.findInput.value = sel;
    el.findInput.focus();
    el.findInput.select();
    runFind(true, true);
  }

  function toggleReplace(force) {
    const on = typeof force === 'boolean' ? force : el.replaceRow.classList.contains('hidden');
    el.replaceRow.classList.toggle('hidden', !on);
    el.findReplaceToggle.setAttribute('aria-pressed', String(on));
    if (on) el.replaceInput.focus();
  }

  function replaceCurrent() {
    const q = el.findInput.value;
    const text = el.replaceInput.value;
    if (!q || lockedNow() || !state.current || state.current.trashedAt || isViewerOnlyFile(state.current)) return;
    if (state.sourceMode) {
      // Offsets can be stale (Tab, list keys and Restore change the text without an input event): recount
      // first, and only replace text that really is the query.
      const wanted = find.active;
      runFind(true, true, true);
      if (!find.sourceHits.length) { runFind(true, true); return; }
      find.active = Math.min(Math.max(wanted, 0), find.sourceHits.length - 1);
      const at = find.sourceHits[find.active];
      const ta = el.bodyInput;
      if (ta.readOnly) return;
      if (!isQueryText(ta.value.slice(at, at + q.length), q)) { showActiveMatch(); return; }
      ta.value = ta.value.slice(0, at) + text + ta.value.slice(at + q.length);
      ta.setSelectionRange(at + text.length, at + text.length);
      ta.dispatchEvent(new Event('input', { bubbles: true })); // autosave + recount
      runFind(true, true, true);
      // Select the match that now follows the replacement (no stepping, which would skip one).
      if (find.sourceHits.length) { const next = find.sourceHits.findIndex((h) => h >= at + text.length); find.active = next === -1 ? 0 : next; showActiveMatch(); }
      return;
    }
    if (!state.rich) return;
    // Ranges may be stale (a restore or reload replaced the content): recount and check the text first.
    const wantedIdx = find.active;
    runFind(true, true, true);
    if (!find.ranges.length) { runFind(true, true); return; }
    find.active = Math.min(Math.max(wantedIdx, 0), find.ranges.length - 1);
    const idx = find.active;
    if (!isQueryText(String(find.ranges[idx]), q)) { showActiveMatch(); return; }
    state.rich.replaceRanges([find.ranges[idx]], text);
    runFind(true, true, true); // the quiet re-find keeps the index, which now points at the following match
    // A replacement that itself contains the query ("cat" -> "cats") creates matches at the same spot: skip them.
    const inside = findOffsets(text, q).length;
    if (find.ranges.length) { find.active = (idx + inside) % find.ranges.length; showActiveMatch(); }
  }

  // Selects / highlights and scrolls to find.active without changing it.
  function showActiveMatch() {
    const q = el.findInput.value;
    if (state.sourceMode) {
      const at = find.sourceHits[find.active];
      if (at === undefined) return;
      if (document.activeElement !== el.replaceInput) el.bodyInput.focus(); // Enter in the replace box keeps replacing
      el.bodyInput.setSelectionRange(at, at + q.length);
      scrollTextareaToSelection(at);
      el.findCount.textContent = (find.active + 1) + '/' + find.sourceHits.length;
      return;
    }
    if (window.CSS && CSS.highlights) CSS.highlights.set('notes-find-active', new Highlight(...(find.active >= 0 && find.ranges[find.active] ? [find.ranges[find.active]] : [])));
    const r = find.ranges[find.active];
    if (r) { const node = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement; if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    el.findCount.textContent = find.ranges.length ? (find.active + 1) + '/' + find.ranges.length : 'No matches';
  }

  function replaceAll() {
    const q = el.findInput.value;
    const text = el.replaceInput.value;
    if (!q || lockedNow() || !state.current || state.current.trashedAt || isViewerOnlyFile(state.current)) return;
    let n = 0;
    if (state.sourceMode) {
      const ta = el.bodyInput;
      if (ta.readOnly) return;
      const hits = findOffsets(ta.value, q);
      n = hits.length;
      if (!n) { toast('No matches'); return; }
      let out = '', last = 0;
      for (const at of hits) { out += ta.value.slice(last, at) + text; last = at + q.length; }
      ta.value = out + ta.value.slice(last);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      if (!state.rich) return;
      runFind(true, true, true);
      n = state.rich.replaceRanges(find.ranges, text);
      if (!n) { toast('No matches'); return; }
    }
    runFind(true, true, true);
    toast('Replaced ' + n + (n === 1 ? ' match' : ' matches'));
  }

  function closeFind() {
    if (!find.open) return;
    find.open = false;
    el.findBar.classList.add('hidden');
    toggleReplace(false);
    el.findCount.textContent = '';
    clearFindHighlights();
    focusBody();
  }

  function clearFindHighlights() {
    if (window.CSS && CSS.highlights) { CSS.highlights.delete('notes-find'); CSS.highlights.delete('notes-find-active'); }
    find.ranges = []; find.sourceHits = []; find.active = -1;
  }

  // Positions of every case-insensitive occurrence of q in text.
  // Case-insensitive, but measured on the ORIGINAL text: lower-casing can change string length ("İ" becomes
  // two code units), which would shift every offset after it and make a replace hit the wrong characters.
  // The same case rule as findOffsets (RegExp 'i'), so a guard never disagrees with the matcher (ς vs σ).
  function isQueryText(text, q) {
    return new RegExp('^' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i').test(text);
  }

  function findOffsets(text, q) {
    const hits = [];
    if (!q) return hits;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let m;
    while ((m = re.exec(text)) !== null) { hits.push(m.index); if (m[0].length === 0) re.lastIndex++; }
    return hits;
  }

  // Ranges over the rendered editor's text nodes (matches may span node boundaries).
  function findRangesIn(root, q) {
    const nodes = []; let text = '';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const blockOf = (n) => { let e = n.parentElement; while (e && e !== root && getComputedStyle(e).display === 'inline') e = e.parentElement; return e; };
    let lastBlock = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 1) { if (n.tagName === 'BR' || n.tagName === 'IMG') text += '\n'; continue; } // line breaks and inline images separate: a match never straddles them
      const b = blockOf(n);
      if (lastBlock && b !== lastBlock) text += '\n'; // a separator no query can contain
      lastBlock = b;
      nodes.push({ node: n, start: text.length }); text += n.nodeValue;
    }
    const locate = (pos) => {
      let lo = 0, hi = nodes.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nodes[mid].start <= pos) lo = mid; else hi = mid - 1; }
      if (!nodes.length) return null;
      const node = nodes[lo].node;
      return { node, offset: Math.min(pos - nodes[lo].start, node.nodeValue.length) }; // a position inside a separator clamps to the node's end
    };
    return findOffsets(text, q).map((pos) => {
      const s = locate(pos), e = locate(pos + q.length);
      if (!s || !e) return null;
      const r = document.createRange();
      r.setStart(s.node, s.offset);
      // The end may fall exactly at a node boundary: keep it inside the node where the match ends.
      if (e.offset === 0 && pos + q.length > 0) { const prev = locate(pos + q.length - 1); r.setEnd(prev.node, prev.offset + 1); } else r.setEnd(e.node, e.offset);
      return r;
    }).filter(Boolean);
  }

  // quiet: recount and re-highlight after the text changed, without moving the selection or scrolling.
  function runFind(forward, fresh, quiet) {
    const q = el.findInput.value;
    const sameQuery = q === find.query;
    find.query = q;
    if (!q) { clearFindHighlights(); el.findCount.textContent = ''; return; }
    if (state.sourceMode) {
      if (fresh || !sameQuery || !find.sourceHits.length) {
        find.sourceHits = findOffsets(el.bodyInput.value, q);
        // Start from the caret so Enter finds the next match after where the person is.
        const caret = el.bodyInput.selectionStart || 0;
        const idx = find.sourceHits.findIndex((h) => h >= caret);
        find.active = find.sourceHits.length ? (idx === -1 ? 0 : idx) : -1; // past the last match wraps to the first
      } else if (find.sourceHits.length) {
        find.active = (find.active + (forward === false ? -1 : 1) + find.sourceHits.length) % find.sourceHits.length;
      }
      const n = find.sourceHits.length;
      if (n && find.active >= 0 && !quiet) {
        const at = find.sourceHits[find.active];
        // A textarea shows its selection only while focused, so stepping (Enter, F3) moves focus to the
        // text and keeps it there; F3 / Shift+F3 keep stepping from the text, Esc closes the bar.
        if (!fresh) el.bodyInput.focus();
        el.bodyInput.setSelectionRange(at, at + q.length);
        scrollTextareaToSelection(at);
      }
      el.findCount.textContent = n ? (find.active + 1) + '/' + n : 'No matches';
      el.findCount.classList.toggle('is-none', !n);
      return;
    }
    if (fresh || !sameQuery || !find.ranges.length) {
      find.ranges = findRangesIn(el.richEditor, q);
      find.active = find.ranges.length ? (sameQuery && find.active >= 0 ? Math.min(find.active, find.ranges.length - 1) : 0) : -1; // after a replace, the next match now sits at the same index
    } else if (find.ranges.length) {
      find.active = (find.active + (forward === false ? -1 : 1) + find.ranges.length) % find.ranges.length;
    }
    if (window.CSS && CSS.highlights) {
      CSS.highlights.set('notes-find', new Highlight(...find.ranges));
      CSS.highlights.set('notes-find-active', new Highlight(...(find.active >= 0 ? [find.ranges[find.active]] : [])));
    }
    const n = find.ranges.length;
    if (n && find.active >= 0 && !quiet) {
      const r = find.ranges[find.active];
      const elNode = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
      if (elNode && elNode.scrollIntoView) elNode.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    el.findCount.textContent = n ? (find.active + 1) + '/' + n : 'No matches';
    el.findCount.classList.toggle('is-none', !n);
  }

  // The textarea auto-grows and .editor-scroll scrolls, so the match's visual position is measured with a
  // mirror element that wraps exactly like the textarea (newline counting would undershoot on long lines).
  function scrollTextareaToSelection(at) {
    const ta = el.bodyInput;
    const scroller = ta.closest('.editor-scroll') || ta;
    const cs = getComputedStyle(ta);
    const mirror = document.createElement('div');
    for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'padding', 'border', 'boxSizing', 'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize']) mirror.style[prop] = cs[prop];
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.position = 'absolute'; mirror.style.visibility = 'hidden'; mirror.style.top = '0'; mirror.style.left = '-99999px';
    mirror.style.width = ta.clientWidth + 'px';
    mirror.textContent = ta.value.slice(0, at);
    const marker = document.createElement('span'); marker.textContent = '\u200b';
    mirror.append(marker);
    document.body.append(mirror);
    const y = marker.offsetTop;
    mirror.remove();
    const target = ta.offsetTop + y - scroller.clientHeight / 2;
    if (scroller !== ta) scroller.scrollTop = Math.max(0, target); else ta.scrollTop = Math.max(0, y - ta.clientHeight / 2);
  }

  async function printNote() {
    if (!state.current) return;
    await flushSave();
    const r = await api.app.print();
    if (!r.ok) toast('Could not print: ' + (r.error || 'unknown error'));
    else if (r.dry) toast('Print: dry run');
  }

  // ---- desktop stickies ------------------------------------------------------

  function renderStickyButton(note) {
    const on = !!(note && note.sticky);
    el.stickyBtn.classList.toggle('is-on', on);
    el.stickyBtn.textContent = on ? '📌 Stuck' : '📌 Stick';
    el.stickyBtn.title = on ? 'Remove this note from the desktop (Ctrl+Shift+T)' : 'Put this note on the desktop as a sticky (Ctrl+Shift+T)';
    // A sticky shows rendered Markdown, so neither a PDF/Word file nor a plain-text file can become one (one that
    // already is can still be removed).
    const notMarkdown = isViewerOnlyFile(note) || isPlainTextFile(note);
    el.stickyBtn.disabled = !note || !!note.trashedAt || (notMarkdown && !on) || !!note.locked;
    el.stickyBtn.title = note && note.locked ? 'Locked notes cannot be stickies' : el.stickyBtn.title;
  }

  async function toggleSticky() {
    const note = state.current;
    if (!note || el.stickyBtn.disabled) return;
    await flushSave();
    try {
      if (note.sticky) {
        await api.stickies.close(note.id, { forget: true });
        toast('Removed from the desktop. The note is kept.');
      } else {
        await api.stickies.open(note.id);
        toast('On the desktop. Drag its top bar to move it; ✕ on it removes it, Esc just hides it (tray → Stickies brings it back).');
      }
    } catch (err) {
      toast('Could not change the sticky: ' + (err.message || err));
    }
    await refreshCurrentMeta();
  }

  // Re-reads the open note's metadata (not its body) after something outside the editor changed it.
  async function refreshCurrentMeta() {
    if (!state.currentId) return;
    const fresh = await api.notes.get(state.currentId);
    if (!fresh || !state.current || fresh.id !== state.current.id) return;
    state.current.sticky = fresh.sticky;
    state.current.pinned = fresh.pinned;
    state.current.remindAt = fresh.remindAt;
    state.current.remindedAt = fresh.remindedAt;
    state.current.live = fresh.live;
    renderStickyButton(state.current);
    renderRemindButton(state.current);
    renderLiveRow(state.current);
    await refresh({ keepEditor: true });
  }

  // ---- bot: Claude Code over the notes -------------------------------------

  const bot = { open: false, running: false };

  function toggleBot(force) {
    bot.open = typeof force === 'boolean' ? force : !bot.open;
    el.botPanel.classList.toggle('hidden', !bot.open);
    el.botBtn.classList.toggle('is-on', bot.open);
    if (bot.open) { describeBotScope(); el.botPrompt.focus(); }
  }

  function describeBotScope() {
    const n = state.current;
    let text = 'Scope: all plain notes (exported to a workspace folder for the run)';
    if (n && n.vaultId) text = 'Scope: this note’s vault folder';
    else if (n && n.filePath) text = 'Scope: the folder containing this file';
    el.botScope.textContent = text;
    el.botScope.title = text;
  }

  function botAppend(text, cls) {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    el.botOutput.append(span);
    el.botOutput.scrollTop = el.botOutput.scrollHeight;
  }

  async function runBot() {
    if (bot.running) { await api.bot.cancel(); return; }
    const prompt = el.botPrompt.value.trim();
    await flushSave();
    el.botOutput.textContent = '';
    if (!prompt) {
      // Empty prompt: pull in whatever a terminal session changed in the workspace.
      const r = await api.bot.importWorkspace();
      botAppend(r.error ? ('Import failed: ' + r.error + '\n') : ('Pulled in workspace edits. ' + importSummary(r) + '\n' + (r.details || []).map((d) => '  ' + d).join('\n') + (r.details && r.details.length ? '\n' : '')), r.error ? 'bot-err' : 'bot-meta');
      await refresh({ keepEditor: true });
      el.botPrompt.focus();
      return;
    }
    const res = await api.bot.run({ prompt, noteId: state.currentId, allowEdits: el.botAllowEdits.checked });
    if (!res.ok) { botAppend(res.error + '\n', 'bot-err'); return; }
  }

  function onBotEvent(ev) {
    if (ev.type === 'start') {
      bot.running = true;
      el.botPanel.classList.add('is-running');
      el.botRunBtn.textContent = 'Stop';
      botAppend('Claude Code, on your Claude ' + (ev.plan ? ev.plan.charAt(0).toUpperCase() + ev.plan.slice(1) + ' ' : '') + 'subscription (no API credits)\n', 'bot-meta');
      botAppend('Working in ' + ev.cwd + (ev.focus ? '  (looking at ' + ev.focus + ')' : '') + '\n', 'bot-meta');
      if (ev.imported && (ev.imported.updated || ev.imported.created || ev.imported.conflicts)) botAppend('Pulled in earlier workspace edits first. ' + importSummary(ev.imported) + '\n', 'bot-meta');
    } else if (ev.type === 'out') {
      botAppend(ev.text);
    } else if (ev.type === 'err') {
      botAppend(ev.text, 'bot-err');
    } else if (ev.type === 'end') {
      bot.running = false;
      el.botPanel.classList.remove('is-running');
      el.botRunBtn.textContent = 'Run';
      if (ev.error) botAppend('\n' + ev.error + '\n', 'bot-err');
      else {
        const imp = ev.imported;
        const summary = imp && !imp.error ? ' ' + importSummary(imp) : '';
        botAppend('\nDone' + (ev.code === 0 ? '' : ' (exit code ' + ev.code + ')') + '.' + summary + '\n', 'bot-meta');
        if (imp && imp.conflicts) botAppend((imp.details || []).filter((d) => d.startsWith('conflict')).map((d) => '  ' + d).join('\n') + '\n', 'bot-err');
      }
      refresh({ keepEditor: true }).then(async () => {
        // Reload the open note from the store in case the agent edited it.
        if (state.currentId && !state.dirty) { const wanted = state.currentId; const fresh = await api.notes.get(wanted); if (fresh && fresh.id === state.currentId && !state.dirty && !state.inflight.has(fresh.id) && fresh.body !== el.bodyInput.value) { applyFreshFileBody(fresh); toast('This note was updated by the bot.'); } }
      });
    } else if (ev.type === 'reloaded') {
      refresh({ keepEditor: true });
    }
  }

  function importSummary(imp) {
    return 'Notes updated: ' + imp.updated + ', created: ' + imp.created + (imp.conflicts ? ', conflicts: ' + imp.conflicts : '') + (imp.missing ? ', files removed by the agent (notes kept): ' + imp.missing : '') + '.';
  }

  async function openBotTerminal() {
    await flushSave();
    const res = await api.bot.openTerminal(state.currentId);
    if (!res.ok) { toast('Could not open a terminal: ' + res.error); return; }
    toast('Claude Code opened in a terminal at ' + res.cwd + (res.kind === 'workspace' ? '. Its edits are pulled in on the next Run, or press Run with an empty prompt.' : ''));
  }

  // ---- speech: read aloud and dictate --------------------------------------

  const tts = { active: false, queue: [], index: 0 };

  function selectedTextForSpeech() {
    if (state.sourceMode) {
      const ta = el.bodyInput;
      if (ta.selectionStart !== ta.selectionEnd) return ta.value.slice(ta.selectionStart, ta.selectionEnd);
      return '';
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && el.richEditor.contains(sel.anchorNode)) return sel.toString();
    return '';
  }

  function textForSpeech() {
    const selected = selectedTextForSpeech().trim();
    if (selected) return selected;
    const title = el.titleInput.value.trim();
    // Only Markdown has marks to strip; a plain-text or Word file is read as the text it is.
    const note = state.current;
    const body = isNonMarkdownFile(note) ? el.bodyInput.value : H.plainTextFromMarkdown(el.bodyInput.value);
    return (title ? title + '.\n' : '') + body;
  }

  function pickVoice() {
    const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    const wanted = state.settings && state.settings.ttsVoice;
    return voices.find((v) => v.name === wanted) || null;
  }

  function setReadAloudState(active) {
    tts.active = active;
    el.readAloudBtn.textContent = active ? '⏹ Stop' : '🔊 Read';
    el.readAloudBtn.classList.toggle('is-on', active);
  }

  function stopReadAloud() {
    tts.queue = [];
    tts.index = 0;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setReadAloudState(false);
  }

  function speakNext() {
    if (!tts.active || tts.index >= tts.queue.length) { setReadAloudState(false); return; }
    const u = new SpeechSynthesisUtterance(tts.queue[tts.index++]);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = (state.settings && state.settings.ttsRate) || 1;
    u.onend = () => speakNext();
    u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') toast('Read aloud stopped: ' + e.error); setReadAloudState(false); };
    window.speechSynthesis.speak(u);
  }

  function toggleReadAloud() {
    if (!window.speechSynthesis) { toast('Speech is not available on this system.'); return; }
    if (tts.active) { stopReadAloud(); return; }
    if (!state.current) return;
    const text = textForSpeech();
    if (!text.trim()) { toast('Nothing to read yet.'); return; }
    tts.queue = H.speechChunks(text);
    tts.index = 0;
    setReadAloudState(true);
    window.speechSynthesis.cancel();
    speakNext();
  }

  function populateVoices() {
    if (!window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices().slice().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
    const current = state.settings ? state.settings.ttsVoice : '';
    el.ttsVoiceSelect.innerHTML = '<option value="">System default</option>';
    for (const v of voices) {
      const o = document.createElement('option');
      o.value = v.name;
      o.textContent = v.name + ' (' + v.lang + ')' + (v.default ? ' • default' : '');
      el.ttsVoiceSelect.append(o);
    }
    el.ttsVoiceSelect.value = voices.some((v) => v.name === current) ? current : '';
  }

  async function startDictation() {
    if (!state.current || isViewerOnlyFile(state.current) || state.current.trashedAt) { toast('Open an editable note first.'); return; }
    focusBody();
    const res = await api.app.dictate();
    if (!res.ok) toast(res.error || 'Dictation could not start.');
    else toast('Windows dictation opened: speak now. Say "stop dictating" or press Win+H to finish.');
  }

  // ---- file-backed notes ---------------------------------------------------

  // A Word document is shown from its own bytes, as laid out in the file, inside a frame of its own: sandboxed
  // (nothing in it runs), with a policy that allows only inline styles and data: images. So the file's styles
  // cannot reach the app, and it loads nothing from the network, so opening it cannot tell anyone you did.
  const DOCX_FRAME = '<!doctype html><html><head><meta charset="utf-8"><meta name="notes-docx-frame">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:">'
    + '<style>html, body { margin: 0; } .docx-wrapper { background: #e9e4da; padding: 16px; }</style></head><body></body></html>';
  // docxShownKey (note id + file version) skips re-rendering the same file; docxSeq drops a render that is
  // overtaken by a newer one.
  let docxShownKey = null;
  let docxSeq = 0;
  function clearDocx() {
    docxShownKey = null;
    docxSeq++;
    el.docxView.classList.add('hidden');
    el.docxView.removeAttribute('srcdoc');
  }
  // A fresh frame per document, so no styles from the last one linger. Only a load of this frame page counts: the
  // about:blank load from an earlier clearDocx can still arrive and must not be taken for it.
  function freshDocxFrame() {
    return new Promise((resolve) => {
      const onLoad = () => {
        const doc = el.docxView.contentDocument;
        if (!doc || !doc.querySelector('meta[name="notes-docx-frame"]')) return;
        el.docxView.removeEventListener('load', onLoad);
        resolve(doc);
      };
      el.docxView.addEventListener('load', onLoad);
      el.docxView.srcdoc = DOCX_FRAME;
    });
  }
  // Links in a document never navigate: a #bookmark scrolls to its place, a web link opens in the browser only
  // on Ctrl+click (like links in notes), and a plain click says where it goes.
  function onDocxLinkClick(e) {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) {
      const doc = a.ownerDocument, name = decodeURIComponent(href.slice(1));
      const target = doc.getElementById(name) || doc.getElementsByName(name)[0];
      if (target) target.scrollIntoView();
      return;
    }
    externalLinkClick(e, href);
  }

  // A link inside a shown document (Word, PDF): a web link opens only on Ctrl+click, anything else never.
  function externalLinkClick(e, href) {
    if (!/^https?:\/\//i.test(href)) return;
    if (e.ctrlKey || e.metaKey) api.app.openExternal(href);
    else toast('This link goes to ' + href + '. Ctrl+click to open it.');
  }

  async function showDocx(note) {
    const key = note.id + ':' + note.fileMtime;
    if (docxShownKey === key) return;
    docxShownKey = key;
    const seq = ++docxSeq;
    try {
      const [doc, bytes] = await Promise.all([freshDocxFrame(), api.files.docxBytes(note.id)]);
      if (seq !== docxSeq) return;
      doc.addEventListener('click', onDocxLinkClick);
      // altChunks are raw HTML inside the file: never show them. Images become data: URLs, which the frame allows.
      await DocxView.renderAsync(bytes, doc.body, doc.body, { useBase64URL: true, renderAltChunks: false });
    } catch (err) {
      if (seq !== docxSeq) return;
      docxShownKey = null;
      el.docxView.removeAttribute('srcdoc');
      showBanner('Could not show this Word document: ' + ipcErrorText(err) + ' Use "Open with…" to open it in Word.');
    }
  }

  function renderFileRow(note) {
    const isFile = !!(note && note.filePath);
    el.fileRow.classList.toggle('hidden', !isFile);
    el.fileBanner.classList.add('hidden');
    if (!(isFile && note.fileKind === 'docx')) clearDocx();
    if (!(isFile && note.fileKind === 'pdf')) clearPdf();
    closeConvertMenu();
    el.editorColumn.classList.toggle('shows-document', isFile && (note.fileKind === 'pdf' || note.fileKind === 'docx'));
    if (!isFile) { const hid = lockedNow(); el.richEditor.classList.toggle('hidden', hid || state.sourceMode); el.bodyInput.classList.toggle('hidden', hid || !state.sourceMode); return; }
    el.fileKind.textContent = (note.fileKind || 'file').toUpperCase();
    el.filePath.textContent = note.filePath;
    el.filePath.title = note.filePath;
    if (note.fileKind === 'pdf') {
      el.richEditor.classList.add('hidden');
      el.bodyInput.classList.add('hidden');
      el.pdfEditor.classList.remove('hidden');
      showBanner('Highlight, add text, draw or add a picture with the tools above; with a tool on, click a mark to move or delete it. Save writes your changes into this PDF, and the original is backed up first.');
      showPdf(note);
    } else if (note.fileKind === 'docx') {
      el.richEditor.classList.add('hidden');
      el.bodyInput.classList.add('hidden');
      el.docxView.classList.remove('hidden');
      showBanner('Word document, shown as laid out in the file. It is read-only here for now; use "Open with…" to edit it in Word.');
      showDocx(note);
    } else if (note.fileKind === 'binary') {
      el.richEditor.classList.add('hidden');
      el.bodyInput.classList.add('hidden');
      showBanner('This file type cannot be shown here. Use "Open with…" to open it in its own app.');
    }
  }

  // ---- Convert to… (a copy in another format, written next to the file) ------------------------------

  async function openConvertMenu() {
    const note = state.current;
    if (!note || !note.filePath) return;
    let opts;
    try { opts = await api.files.convertOptions(note.id); } catch (err) { toast('Could not convert: ' + ipcErrorText(err)); return; }
    if (state.currentId !== note.id) return;
    if (!opts.length) { toast('Notes cannot convert this kind of file.'); return; }
    el.convertMenu.replaceChildren(...opts.map((o) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      b.dataset.to = o.to;
      b.append(o.label);
      if (o.note) { const n = document.createElement('span'); n.className = 'menu-note'; n.textContent = o.note; b.append(n); }
      return b;
    }));
    placePopover(el.convertMenu, el.fileConvertBtn);
    el.convertMenu.querySelector('button').focus();
  }

  function closeConvertMenu() { el.convertMenu.classList.add('hidden'); }

  let converting = false;
  async function convertCurrent(to) {
    closeConvertMenu();
    const note = state.current;
    if (!note || !note.filePath || converting) return;
    converting = true;
    el.fileConvertBtn.disabled = true;
    try {
      await flushSave(); // a text file converts what is on disk, so unsaved typing goes there first
      toast('Converting…');
      const r = await api.files.convert(note.id, to);
      if (!r.ok) { toast('Could not convert: ' + r.error); return; }
      const name = r.filePath.split(/[\\/]/).pop();
      toast('Saved ' + name + ' next to the original.' + (r.warning ? ' ' + r.warning : ''), { label: 'Open', run: () => openFiles([r.filePath]) });
    } catch (err) {
      toast('Could not convert: ' + ipcErrorText(err));
    } finally {
      converting = false;
      el.fileConvertBtn.disabled = false;
    }
  }

  // ---- PDF viewer and editor ------------------------------------------------------------------------
  // pdf.js shows the PDF and holds the edits; saving writes them into the file through main, which backs up the
  // original on the first save of a session. pdfNote is the PDF on show: { id, fileMtime } as it was loaded or saved.

  let pdf = null;
  let pdfShownKey = null, pdfSeq = 0, pdfNote = null, pdfQueue = Promise.resolve(true);

  function pdfController() {
    if (!pdf && window.NotesPdfEditor) {
      pdf = window.NotesPdfEditor.create(el.pdfEditor, {
        // Never disabled: a stroke or text box still in progress only counts once it is committed, which Save does.
        onDirty: (d) => { el.pdfSaveBtn.textContent = d ? 'Save' : 'Saved'; },
        onState: (s) => {
          for (const b of el.pdfEditor.querySelectorAll('[data-pdf-mode]')) b.classList.toggle('is-on', b.dataset.pdfMode === s.mode);
          el.pdfUndoBtn.disabled = !s.canUndo;
          el.pdfRedoBtn.disabled = !s.canRedo;
          el.pdfZoomLabel.textContent = Math.round(s.scale * 100) + '%';
        },
        onLink: externalLinkClick,
      });
    }
    return pdf;
  }

  function clearPdf() {
    closePdfPages();
    pdfShownKey = null;
    pdfSeq++;
    pdfNote = null;
    el.pdfEditor.classList.add('hidden');
    if (pdf) pdf.close();
  }

  async function showPdf(note) {
    const key = note.id + ':' + note.fileMtime;
    if (pdfShownKey === key) return;
    closePdfPages(); // its plan was for the PDF, or the version of it, shown before
    const ctl = pdfController();
    if (!ctl) { showBanner('The PDF viewer failed to load. Use "Open with…" for your PDF app.'); return; }
    pdfShownKey = key;
    const seq = ++pdfSeq;
    pdfNote = null;
    try {
      const bytes = await api.files.pdfBytes(note.id);
      if (seq !== pdfSeq) return;
      if (await ctl.open(bytes) && seq === pdfSeq) pdfNote = { id: note.id, fileMtime: note.fileMtime };
    } catch (err) {
      if (seq !== pdfSeq) return;
      pdfShownKey = null;
      showBanner('Could not show this PDF: ' + ipcErrorText(err) + ' Use "Open with…" for your PDF app.');
    }
  }

  const pdfDirty = () => !!(pdf && pdfNote && pdf.isDirty());
  const pdfBusy = () => !!(pdf && pdfNote && pdf.hasPendingWork());

  // Writes the PDF's edits into the file, whenever the app saves (leaving the note, hiding the window, quitting) and
  // on Save or Ctrl+S. opts.commit: finish a stroke or text box in progress first (not on a mere window blur, which
  // would end the person's drawing); opts.explicit: say so when done. Saves run one at a time, and each re-checks,
  // so edits made during an earlier save are saved too. Resolves false while edits are still unsaved.
  function flushPdf(opts) {
    const run = pdfQueue.then(() => flushPdfNow(opts || {}));
    pdfQueue = run.catch(() => false);
    return run;
  }

  async function flushPdfNow(opts) {
    let explicit = !!opts.explicit;
    for (let i = 0; i < 3; i++) {
      if (!pdf || !pdfNote) return true;
      if (opts.commit !== false) await pdf.commit();
      if (!pdfDirty()) return true;
      if (!(await savePdfNow(explicit))) return false;
      explicit = false;
    }
    return !pdfDirty();
  }

  async function savePdfNow(explicit) {
    const target = pdfNote;
    try {
      const { bytes, hash } = await pdf.save();
      const r = await api.files.savePdf(target.id, bytes, target.fileMtime);
      if (pdfNote === target) pdf.markSaved(hash);
      if (r.savedAs) {
        // The file changed on disk since it was opened: main never writes over that, so the edits went to a copy
        // (the same copy on every later save, until the PDF is reloaded).
        if (r.newCopy || explicit) toast('This PDF changed on disk while you edited it, so your changes were saved as ' + r.savedAs.split(/[\\/]/).pop() + '.', { label: 'Open', run: () => openFiles([r.savedAs]) });
        return true;
      }
      noteFileWritten(target, r.mtime);
      if (pdfNote === target) pdfShownKey = target.id + ':' + r.mtime;
      if (explicit || r.backup) toast(r.backup ? 'Saved your changes into the PDF. The original is backed up in the app\'s backups folder (Settings > Open data folder).' : 'Saved your changes into the PDF.');
      return true;
    } catch (err) {
      toast('Could not save the PDF: ' + ipcErrorText(err) + ' Your changes are still here.');
      return false;
    }
  }

  // ---- PDF pages: turn, move, remove, add from another PDF ----------------------------------------

  // pdfPagesFor: the pdfNote the organizer's plan was made for. Applying it to anything else is refused.
  let pdfPages = null, pdfPagesFor = null;

  function openPdfPages() {
    if (!pdf || !pdfNote || !window.NotesPdfPages) return;
    if (!pdfPages) pdfPages = window.NotesPdfPages.create(el.pdfPages, pdf, { pickPdf: pickPdfForPages, apply: applyPdfPages, close: closePdfPages, say: toast });
    pdfPagesFor = pdfNote;
    el.pdfEditor.classList.add('organizing');
    pdfPages.open();
  }

  function closePdfPages() {
    pdfPagesFor = null;
    el.pdfEditor.classList.remove('organizing');
    if (pdf) pdf.closeOthers();
  }

  // An IPC call whose failure is reported as { ok: false, error } like its own refusals.
  async function callOk(promise) {
    try { return await promise; } catch (err) { return { ok: false, error: ipcErrorText(err) }; }
  }

  async function pickPdfForPages() {
    const r = await callOk(api.files.pdfPickPages());
    if (r.canceled) return null;
    if (!r.ok) { toast('Could not add pages: ' + r.error); return null; }
    return r;
  }

  // The app wrote the PDF itself: record the new time (so the poll does not reload it) on the note on show.
  function noteFileWritten(target, mtime) {
    target.fileMtime = mtime;
    if (state.current && state.current.id === target.id) state.current.fileMtime = mtime;
  }

  // Shows the PDF again from the file, which the app has just rewritten.
  function reloadPdf(target, mtime) {
    noteFileWritten(target, mtime);
    if (state.current && state.current.id === target.id) showPdf(state.current);
  }

  async function applyPdfPages(plan) {
    const target = pdfNote;
    if (!target || pdfPagesFor !== target) { closePdfPages(); toast('That PDF changed while the pages were open, so they were not changed.'); return false; }
    if (!(await flushPdf({ commit: true }))) { toast('Your marks could not be saved, so the pages were not changed.'); return false; }
    let bytes = null;
    if (plan.pageInfos) {
      // The pages come from the file as just saved, marks and form entries included: pdf.js would carry over drawn
      // marks from the open document but not typed form values.
      let saved;
      try { saved = new Uint8Array(await api.files.pdfBytes(target.id)); } catch (err) { toast('Could not read the PDF: ' + ipcErrorText(err)); return false; }
      const pageInfos = plan.pageInfos.map((info) => (info.document === null ? Object.assign({}, info, { document: saved }) : info));
      try { bytes = await pdf.extractPages(pageInfos); } catch (err) { toast('Could not rearrange the pages: ' + (err.message || err)); return false; }
      // pdf.js answers null, or silently leaves out a PDF it cannot read, instead of failing. Never write that, and
      // never turn pages of the old order instead: the turns belong to the new one.
      let pages = 0;
      try { if (bytes) pages = (await pdf.openOther(bytes)).pages; } catch (_) { pages = 0; }
      if (pages !== plan.rotations.length) { toast('Could not rearrange the pages: a PDF involved could not be read.'); return false; }
    }
    if (pdfNote !== target) return false;
    const r = await callOk(api.files.pdfApplyPages(target.id, bytes, plan.rotations, target.fileMtime));
    if (!r.ok) { toast('Could not change the pages: ' + r.error); return false; }
    reloadPdf(target, r.mtime);
    toast('Pages updated.', { label: 'Undo', run: () => undoPdfPages(target.id, r.backup, r.mtime) });
    return true;
  }

  // Undo only while the file is exactly what the page change wrote (mtime): anything saved since would be lost.
  async function undoPdfPages(id, backup, mtime) {
    if (!pdfNote || pdfNote.id !== id) { toast('Open that PDF again to undo.'); return; }
    if (pdfDirty()) { toast('You have changed the PDF since, so the page change was not undone. Its earlier versions are in the backups folder.'); return; }
    const r = await callOk(api.files.pdfRestore(id, backup, mtime));
    if (!r.ok) { toast('Could not undo: ' + r.error); return; }
    reloadPdf(pdfNote, r.mtime);
    toast('The pages are back as they were.');
  }

  // ---- PDF signature: drawn on a pad, placed with pdf.js's picture tool --------------------------------

  // signFor: the PDF note (id) the signature is for. signBusy: opening or placing is under way (double clicks).
  let signPad = null, signFor = null, signBusy = false;
  const signSay = (text) => { el.signStatus.textContent = text; }; // inside the dialog: a toast would sit behind it

  async function openSignDialog() {
    if (!pdf || !pdfNote || !window.NotesSignPad || signBusy || el.signDialog.open) return;
    signBusy = true;
    try {
      if (!signPad) signPad = window.NotesSignPad.create(el.signPad);
      let saved = null;
      try { saved = await api.signature.get(); } catch (_) { saved = null; }
      if (!pdfNote) return;
      signFor = pdfNote.id;
      signSay('');
      el.signName.value = '';
      el.signDialog.showModal();
      signPad.fit(); // after showModal, when the pad has its size
      el.signRemember.checked = !!saved;
      el.signForgetBtn.classList.toggle('hidden', !saved);
      if (saved) await signPad.load(new Blob([saved], { type: 'image/png' })).catch(() => signPad.clear());
    } finally {
      signBusy = false;
    }
  }

  async function placeSignature() {
    if (signBusy) return;
    signBusy = true;
    try {
      const blob = signPad && await signPad.toBlob();
      if (!blob) { signSay('Draw your signature, or type your name and press Write it.'); return; }
      el.signDialog.close();
      // Ticked keeps this signature for next time. Unticked keeps nothing new (Forget deletes a saved one).
      if (el.signRemember.checked) {
        const kept = await callOk(api.signature.set(new Uint8Array(await blob.arrayBuffer())));
        if (!kept.ok) toast('Could not remember the signature: ' + kept.error);
      }
      if (!pdf || !pdfNote || pdfNote.id !== signFor) { toast('The PDF changed while you signed, so the signature was not placed.'); return; }
      if (await pdf.placePicture(new File([blob], 'signature.png', { type: 'image/png' }))) toast('Signature placed. Drag it where it goes, or drag a corner to resize it.');
      else toast('This PDF does not allow changes.');
    } finally {
      signBusy = false;
    }
  }

  function onPdfToolbarClick(e) {
    const b = e.target.closest('button');
    if (!b || !pdf || !pdfNote) return;
    if (b.dataset.pdfMode) { if (!pdf.setMode(b.dataset.pdfMode)) toast('This PDF does not allow changes.'); return; }
    const act = b.dataset.pdfAct;
    if (act === 'undo') pdf.undo();
    else if (act === 'redo') pdf.redo();
    else if (act === 'zoom-in') pdf.zoomIn();
    else if (act === 'zoom-out') pdf.zoomOut();
    else if (act === 'fit') pdf.fitWidth();
    else if (act === 'pages') openPdfPages();
    else if (act === 'sign') openSignDialog();
    else if (b === el.pdfSaveBtn) flushPdf({ commit: true, explicit: true });
  }

  function showBanner(text) {
    el.fileBanner.textContent = text;
    el.fileBanner.classList.remove('hidden');
  }

  async function openFiles(paths) {
    await flushSave();
    let res;
    try { res = paths ? await api.files.link(paths) : await api.files.openDialog(); }
    catch (err) { toast('Could not open: ' + (err.message || err)); return; }
    if (res.canceled) return;
    if (res.linked.length) {
      state.query = ''; el.searchInput.value = '';
      if (state.view === 'trash') { state.view = 'all'; el.navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === 'all')); }
      await refresh({ keepEditor: true });
      if (res.firstId === state.currentId) {
        // Opening the file that is already open: linking re-read it, so show it as it is now (unless the person
        // has unsaved typing in it). Selecting it again would do nothing, and the poll would then see no change.
        const fresh = await api.notes.get(res.firstId);
        if (fresh && state.currentId === fresh.id && !state.dirty && !state.inflight.has(fresh.id)
          && (fresh.body !== el.bodyInput.value || fresh.fileMtime !== state.current.fileMtime)) applyFreshFileBody(fresh);
      } else await selectNote(res.firstId);
    }
    const failed = res.failed.length ? ' Could not open: ' + res.failed.join(', ') : '';
    toast((res.linked.length ? 'Opened ' + res.linked.length + (res.linked.length === 1 ? ' file' : ' files') : 'Nothing opened') + failed);
  }

  // While a file-backed note is open and untouched, pick up changes made by other programs.
  async function pollCurrentFile() {
    const note = state.current;
    if (!note || !note.filePath || state.dirty || document.hidden || pdfBusy()) return; // PDF edits in progress: never reload under them
    let res;
    try { res = await api.files.refresh(note.id); } catch (_) { return; }
    if (pdfBusy()) return; // editing started during the check
    if (state.currentId !== note.id) return;
    if (res.missing) { showBanner('The file no longer exists at ' + note.filePath + '. Your last view is kept here as a plain note.'); return; }
    if (res.changed && !state.dirty) {
      const fresh = await api.notes.get(note.id);
      // Re-check after the second round trip: the user may have switched notes or started typing meanwhile.
      if (state.currentId !== note.id || state.dirty || state.inflight.has(note.id) || !fresh || pdfBusy()) return; // a save that landed in the gap must not be overwritten
      applyFreshFileBody(fresh);
      toast('Reloaded from disk: the file changed outside Notes.');
    }
  }

  // Puts a re-read file body into the editor and re-applies the strict rendered/source decision for files.
  function applyFreshFileBody(fresh) {
    state.current = fresh;
    // Replacing the editor text while clean means any stashed older patch is obsolete: it must never be
    // retried over the text we are now showing.
    if (!state.dirty) state.pending.delete(fresh.id);
    el.bodyInput.value = fresh.body;
    // A PDF or Word file is shown by its own viewer: show the new version of the file there.
    if (isViewerOnlyFile(fresh)) { renderFileRow(fresh); updateStatus(fresh); return; }
    if (state.rich && !isPlainTextFile(fresh)) {
      let lossless = state.rich.setMarkdown(fresh.body, { keepSelection: true }); // same note, new text: keep the caret
      if (fresh.filePath && lossless && !state.rich.lastRoundTripExact()) lossless = false;
      state.currentLossless = lossless;
      if (!lossless && !state.sourceMode && state.lossyOverride !== fresh.id) {
        applyEditorMode(true);
        toast('Switched to source: the file now contains formatting the rendered view would change.');
      }
    }
    autoGrow();
    updateStatus(fresh);
    if (find.open) runFind(true, true, true);
  }

  async function reloadCurrentFile() {
    if (!state.current || !state.current.filePath) return;
    if (pdf && pdfNote) await pdf.commit(); // a stroke or text box in progress counts as an edit here
    if ((state.dirty || pdfDirty()) && !window.confirm('Discard your unsaved edits and reload from disk?')) return;
    const id = state.currentId;
    state.dirty = false;
    pdfShownKey = null; // a PDF is drawn again from the file even if it did not change, dropping its edits
    const res = await api.files.refresh(id);
    const fresh = await api.notes.get(id);
    if (state.currentId !== id || !fresh) return;
    applyFreshFileBody(fresh);
    toast(res.missing ? 'File not found on disk.' : res.changed ? 'Reloaded from disk.' : 'Already up to date.');
  }

  async function addAgentFiles() {
    el.agentFilesStatus.textContent = 'Looking…';
    try {
      const res = await api.agentFiles.link();
      el.agentFilesStatus.textContent = 'Found ' + res.found + ', linked ' + res.linked.length + (res.failed.length ? ', failed ' + res.failed.length : '') + '.';
      el.settingsDialog.close();
      await setView('folder', res.folderId);
      toast('Agent files are in the "Agent files" folder. Edits write to the real files.');
    } catch (err) {
      el.agentFilesStatus.textContent = 'Failed: ' + (err.message || err);
    }
  }

  function scheduleSave() {
    state.lastTypedAt = Date.now();
    if (!state.currentId || (state.current && state.current.trashedAt)) return;
    state.dirty = true;
    // Edits that bypass the input event (Tab, list keys, Ctrl+B/I/K wrappers) still keep find's offsets honest.
    if (find.open && state.sourceMode) runFind(true, true, true);
    setSaved('Saving…');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flushSave, 350);
    if (state.current) updateStatus(state.current);
  }

  // Patches that failed to save are kept per note (state.pending: id -> patch) and retried until they land,
  // even after the user has switched notes, so a locked or full disk never discards an edit.
  state.pending = new Map();

  function currentPatch() {
    const patch = { title: el.titleInput.value, body: el.bodyInput.value, tags: el.tagsInput.value };
    // Read-only file kinds (PDF, Word, binary) still take title and tag edits; their body is not ours to write.
    if (isViewerOnlyFile(state.current)) delete patch.body;
    if (lockedNow()) delete patch.body; // the locked view has no body to offer
    return patch;
  }

  function scheduleRetry() {
    clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(async () => {
      if (state.pending.has(state.currentId)) { state.dirty = true; await flushSave(); }
      await retryPending();
    }, 3000);
  }

  function offerConflictChoice(id, patch) {
    if (state.conflictShown === id) return;
    state.conflictShown = id;
    toast('This file changed on disk while you were editing. Reload it (your edit is dropped) or keep yours.', {
      label: 'Keep mine',
      run: async () => {
        state.conflictShown = null;
        // Send what the person has NOW: the open fields if the note is still open, else the newest stash.
        const latest = state.currentId === id ? currentPatch() : (state.pending.get(id) || patch);
        try {
          const updated = await api.notes.update(id, Object.assign({}, latest, { force: true }));
          if (state.pending.get(id) === patch || state.pending.get(id) === latest) state.pending.delete(id);
          if (state.currentId === id && updated) {
            state.current = updated;
            // Typing during the save keeps dirty and saves again; otherwise the fields and the store agree.
            const same = JSON.stringify(currentPatch()) === JSON.stringify(latest);
            state.dirty = !same;
            if (same) setSaved('Saved'); else scheduleSave();
            refreshCard(updated);
          }
        } catch (err) { reportSaveFailure(err); scheduleRetry(); }
      },
    });
    setTimeout(() => { if (state.conflictShown === id) state.conflictShown = null; }, 12000);
  }

  function reportSaveFailure(err) {
    if (state.saveErrorShown) return;
    state.saveErrorShown = true;
    toast('Could not save: ' + (err && err.message ? err.message : err) + '. Retrying.');
    setTimeout(() => { state.saveErrorShown = false; }, 10000);
  }

  // Retry every pending patch except the open note's, whose latest text lives in the fields and goes through flushSave.
  async function retryPending() {
    let failed = false;
    for (const id of Array.from(state.pending.keys())) {
      if (id === state.currentId) continue;
      const patch = state.pending.get(id); // read at send time: the entry may have been replaced meanwhile
      if (!patch) continue;
      try {
        const updated = await api.notes.update(id, patch);
        if (state.pending.get(id) === patch) state.pending.delete(id); // only clear what was actually written
        if (updated) {
          const idx = state.notes.findIndex((n) => n.id === id);
          if (idx !== -1) { state.notes[idx] = updated; refreshCard(updated); }
          toast('Saved earlier changes to "' + H.truncate(H.deriveTitle(updated), 30) + '"');
        }
      } catch (err) {
        // A file that changed on disk is a decision, not a retry: offer it once and stop looping on it.
        if (/changed on disk/i.test(String(err && err.message))) { offerConflictChoice(id, patch); continue; }
        failed = true;
        reportSaveFailure(err);
      }
    }
    if (failed) scheduleRetry();
  }

  // Called before the editor moves away from a note: keep unsaved input alive as that note's pending patch.
  function stashIfDirty() {
    if (state.dirty && state.currentId) state.pending.set(state.currentId, currentPatch());
    if (state.pending.size) scheduleRetry();
  }

  // When a note with a pending patch is opened, show the unsaved text, not the stale disk copy.
  function applyPendingTo(note) {
    const p = state.pending.get(note.id);
    if (!p) return false;
    el.titleInput.value = p.title;
    el.tagsInput.value = p.tags;
    if (typeof p.body === 'string' && !(note.locked && !note.unlocked)) el.bodyInput.value = p.body; // never show a stale plaintext on a relocked note
    return true;
  }

  state.inflight = new Map(); // id -> promise of a write in progress, so a reselect can wait for it

  // Resolves true when the open note is saved (or had nothing to save), false when the write failed.
  // Saves the open note: a PDF's edits, then the text. opts.fromBlur: the window only lost focus (see flushPdf).
  // Resolves false if anything is still unsaved.
  async function flushSave(opts) {
    const pdfSaved = await flushPdf({ commit: !(opts && opts.fromBlur === true) });
    const textSaved = await flushTextSave();
    return pdfSaved && textSaved;
  }

  async function flushTextSave() {
    clearTimeout(state.saveTimer);
    if (!state.dirty || !state.currentId) return true;
    const id = state.currentId;
    const patch = currentPatch();
    state.dirty = false;
    let updated;
    const write = api.notes.update(id, patch);
    state.inflight.set(id, write.then(() => undefined, () => undefined));
    try {
      updated = await write;
      if (state.pending.get(id) !== patch) state.pending.delete(id);
    } catch (err) {
      state.pending.set(id, patch);
      if (state.currentId === id) { state.dirty = true; setSaved('Save failed'); }
      if (/changed on disk/i.test(String(err && err.message))) {
        // Someone else changed the file: no silent retry. Reload takes theirs; Keep mine writes yours over it.
        offerConflictChoice(id, patch);
        return false;
      }
      reportSaveFailure(err);
      scheduleRetry();
      return false;
    } finally {
      state.inflight.delete(id);
    }
    if (!updated) return true;
    if (state.currentId === id) {
      state.current = updated;
      updateStatus(updated);
      setSaved(state.dirty ? 'Saving…' : 'Saved'); // typing during the write means another save is coming
      renderRelatedSoon();
      if (book.id && patch.title !== undefined) { const t = el.bookTabs.querySelector('.book-tab[data-id="' + id + '"] .t'); if (t) t.textContent = H.truncate(H.deriveTitle(updated) || 'Untitled', 28); }
      // A vault note's title is its file name: the store may have settled it (illegal characters, a clash),
      // and the file row must show the renamed path.
      if (updated.filePath && el.filePath.textContent !== updated.filePath) { el.filePath.textContent = updated.filePath; el.filePath.title = updated.filePath; }
      if (el.titleInput.value === patch.title && updated.title !== patch.title && !state.dirty) el.titleInput.value = updated.title;
    }
    const idx = state.notes.findIndex((n) => n.id === id);
    if (idx !== -1) {
      const prevTags = (state.notes[idx].tags || []).join(',');
      state.notes[idx] = updated;
      refreshCard(updated);
      if (state.settings.sort === 'updated' && idx !== 0) await refresh({ keepEditor: true });
      else if (updated.tags.join(',') !== prevTags) await refresh({ keepEditor: true });
    }
    // Tags may have changed: cheap to refresh the tag list.
    api.notes.tags().then(renderTags);
    return true;
  }

  async function newNote() {
    await flushSave();
    if (state.view === 'trash') {
      state.view = 'all';
      el.navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === 'all'));
    }
    const data = {};
    if (state.view === 'tag' && state.tag) data.tags = [state.tag];
    if (state.view === 'pinned') data.pinned = true;
    if (state.view === 'folder' && state.folderId) data.folderId = state.folderId;
    let note;
    try { note = await api.notes.create(data); }
    catch (err) { toast('Could not create a note: ' + (err.message || err)); return; }
    state.query = '';
    el.searchInput.value = '';
    await refresh({ keepEditor: true });
    await selectNote(note.id);
    el.titleInput.focus();
  }

  async function togglePin() {
    if (!state.current || state.current.trashedAt) return;
    await flushSave();
    const updated = await api.notes.togglePin(state.currentId);
    state.current = updated;
    el.pinBtn.textContent = updated.pinned ? '★' : '☆';
    el.pinBtn.classList.toggle('is-on', updated.pinned);
    await refresh({ keepEditor: true });
    toast(updated.pinned ? 'Pinned' : 'Unpinned');
  }

  async function trashCurrent() {
    if (!state.current || state.current.trashedAt) return;
    const id = state.currentId;
    const title = H.deriveTitle(state.current);
    await flushSave();
    if (pdfDirty() && !window.confirm('Your changes to this PDF could not be saved. Move it to the trash anyway and lose them?')) return;
    await api.notes.trash(id);
    clearEditor();
    await refresh();
    toast('Moved "' + H.truncate(title, 30) + '" to trash', { label: 'Undo', run: async () => { await api.notes.restore(id); await refresh({ keepEditor: true }); await selectNote(id); } });
  }

  async function restoreCurrent() {
    if (!state.current || !state.current.trashedAt) return;
    const id = state.currentId;
    await api.notes.restore(id);
    clearEditor();
    await refresh();
    toast('Restored');
  }

  async function destroyCurrent() {
    if (!state.current) return;
    if (!window.confirm('Delete "' + H.deriveTitle(state.current) + '" forever? This cannot be undone.')) return;
    state.pending.delete(state.currentId);
    state.dirty = false;
    await api.notes.destroy(state.currentId);
    clearEditor();
    await refresh();
    toast('Deleted');
  }

  async function emptyTrash() {
    // Only what is listed: with a search active, "Empty trash" must not delete trashed notes the user cannot see.
    const listed = state.notes.slice();
    const n = listed.length;
    if (!n) return;
    const scope = state.query ? ' matching your search' : ' in the trash';
    if (!window.confirm('Permanently delete ' + n + (n === 1 ? ' note' : ' notes') + scope + '? This cannot be undone.')) return;
    if (state.query) { for (const note of listed) await api.notes.destroy(note.id); }
    else await api.notes.emptyTrash();
    clearEditor();
    await refresh();
    toast(state.query ? 'Deleted ' + n + (n === 1 ? ' note' : ' notes') : 'Trash emptied');
  }

  async function duplicateCurrent() {
    if (!state.current) return;
    await flushSave();
    let copy;
    try { copy = await api.notes.duplicate(state.currentId); }
    catch (err) { toast('Could not duplicate: ' + (err.message || err)); return; }
    await refresh({ keepEditor: true });
    await selectNote(copy.id);
    toast('Duplicated');
  }

  async function exportCurrent() {
    if (!state.current) return;
    await flushSave();
    try {
      const res = await api.app.exportNote(state.currentId);
      if (res.ok) toast('Exported to ' + res.filePath);
    } catch (err) {
      toast('Export failed: ' + (err.message || err));
    }
  }

  // ---- rendered editor vs. Markdown source --------------------------------

  // The textarea (#bodyInput) always mirrors the Markdown, whichever view is showing,
  // so saving, word counts, and the source view all read one place.
  function createRichEditor() {
    if (!window.NotesEditor) { toast('Rendered editor failed to load; showing Markdown source.'); applyEditorMode(true); return; }
    state.rich = window.NotesEditor.create(el.richEditor, {
      placeholder: 'Start writing… Type ## for a heading, - for a list, - [ ] for a checklist.',
      imageBase: () => H.imageBaseFor(state.current),
      onUpdate: (md) => {
        if (state.sourceMode || !state.currentId) return;
        if (md === el.bodyInput.value) return;
        el.bodyInput.value = md;
        scheduleSave();
        if (find.open) runFind(true, true, true);
      },
    });
    el.richEditor.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (a && (e.ctrlKey || e.metaKey)) { e.preventDefault(); followLink(a.getAttribute('href')); }
    });
  }

  function applyEditorMode(source) {
    state.sourceMode = !!source;
    if (find.open) { clearFindHighlights(); setTimeout(() => { if (find.open) runFind(true, true); }, 0); }
    el.sourceBtn.classList.toggle('is-on', state.sourceMode);
    el.sourceBtn.textContent = state.sourceMode ? 'Rendered' : 'Source';
    el.sourceBtn.title = state.sourceMode ? 'Back to the rendered view (Ctrl+E)' : 'Show Markdown source (Ctrl+E)';
    const viewerOnly = isViewerOnlyFile(state.current) || lockedNow();
    el.bodyInput.classList.toggle('hidden', !state.sourceMode || viewerOnly);
    el.richEditor.classList.toggle('hidden', state.sourceMode || viewerOnly);
    if (state.sourceMode) autoGrow();
    else if (state.rich && state.currentId && !isViewerOnlyFile(state.current)) state.currentLossless = state.rich.setMarkdown(el.bodyInput.value);
  }

  function toggleSource(force) {
    const next = typeof force === 'boolean' ? force : !state.sourceMode;
    if (isViewerOnlyFile(state.current)) { toast('This file is shown as it is; it has no Markdown view to switch to.'); return; }
    if (next === state.sourceMode) return;
    if (!next && isPlainTextFile(state.current)) { toast('This is a plain-text file, so it is edited as the text it is.'); return; }
    if (!next && !state.rich) { toast('The rendered editor is unavailable; staying in Markdown source.'); return; }
    if (!next && state.currentId) {
      // Re-check with the text as it is now: it may have become lossy (or clean) while editing in source.
      state.currentLossless = state.rich.setMarkdown(el.bodyInput.value);
      if (state.current && state.current.filePath && state.currentLossless && !state.rich.lastRoundTripExact()) state.currentLossless = false; // a real file gets the strict test
      if (state.currentLossless === false) {
        state.lossyOverride = state.currentId;
        toast('Heads up: editing this note in the rendered view will rewrite formatting it cannot show.');
      }
    }
    applyEditorMode(next);
    updateSettings({ editorMode: next ? 'source' : 'rendered' });
    focusBody();
  }

  function focusBody() {
    if (state.sourceMode || !state.rich) el.bodyInput.focus();
    else state.rich.focus();
  }

  function inTextField() {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable || el.richEditor.contains(a));
  }

  function bodyHasFocus() {
    const a = document.activeElement;
    return a === el.bodyInput || el.richEditor.contains(a);
  }

  function autoGrow() {
    const ta = el.bodyInput;
    if (ta.classList.contains('hidden')) return;
    ta.style.height = 'auto';
    ta.style.height = Math.max(320, ta.scrollHeight + 2) + 'px';
  }

  // Ctrl+click on a link: a note link opens that note, an attachment opens with its app, the web goes outside.
  async function followLink(href) {
    href = String(href || '');
    if (/^note:\/\//i.test(href)) {
      const id = href.replace(/^note:\/\//i, '').replace(/\/$/, '');
      const target = await api.notes.get(id);
      if (!target) { toast('That note no longer exists.'); return; }
      await scopeListToNote(target);
      await selectNoteNow(id);
      return;
    }
    if (/^attachment:\/\//i.test(href)) { const r = await api.attachments.open(href); if (r) toast(String(r)); return; }
    api.app.openExternal(href);
  }

  function openLinkDialog() {
    if (!state.rich || state.sourceMode) return;
    const existing = state.rich.activeLink();
    if (!existing && !state.rich.hasSelection()) { toast('Select the text to link first'); return; }
    state.linkRange = state.rich.selectionRange();
    // The note picker lists every other live note by title.
    el.linkNoteSelect.innerHTML = '<option value="">— pick a note —</option>';
    api.notes.list({ sort: 'title' }).then((notes) => {
      for (const n of notes) { if (n.id === state.currentId) continue; const o = document.createElement('option'); o.value = 'note://' + n.id; o.textContent = H.truncate(H.deriveTitle(n), 60); el.linkNoteSelect.append(o); }
      if (/^note:\/\//.test(existing)) el.linkNoteSelect.value = existing;
    });
    el.linkInput.value = existing || 'https://';
    el.linkRemoveBtn.classList.toggle('hidden', !existing);
    el.linkDialog.showModal();
    el.linkInput.focus();
    el.linkInput.select();
  }

  // ---- editor text helpers -------------------------------------------------

  function wrapSelection(before, after) {
    const ta = el.bodyInput;
    if (ta.readOnly) return;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const selected = value.slice(s, e);
    const already = value.slice(s - before.length, s) === before && value.slice(e, e + after.length) === after;
    if (already) {
      ta.setRangeText(selected, s - before.length, e + after.length, 'select');
    } else {
      ta.setRangeText(before + selected + after, s, e, 'select');
      ta.setSelectionRange(s + before.length, s + before.length + selected.length);
    }
    scheduleSave();
  }

  function handleEditorKeydown(e) {
    if (e.isComposing || e.keyCode === 229) return; // an IME is composing (CJK input): Enter and Tab belong to it
    // While the find bar is open, Enter in the text steps between matches instead of replacing the selected
    // match with a newline (focus lands here after Enter in the bar, so that would eat the match).
    if (find.open && e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); runFind(!e.shiftKey); return; }
    const ta = el.bodyInput;
    if (e.key === 'Tab' && e.shiftKey) {
      // Outdent the current line when it is indented; otherwise let focus move back to the tags field.
      const value = ta.value;
      const lineStart = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      const indent = /^( {1,2}|\t)/.exec(value.slice(lineStart));
      if (!indent || ta.readOnly) return;
      e.preventDefault();
      const caret = ta.selectionStart;
      ta.setRangeText('', lineStart, lineStart + indent[0].length, 'preserve');
      ta.setSelectionRange(Math.max(lineStart, caret - indent[0].length), Math.max(lineStart, caret - indent[0].length));
      scheduleSave();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (ta.readOnly) return;
      ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
      scheduleSave();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !ta.readOnly) {
      // Continue lists and checklists on the next line.
      const value = ta.value;
      const lineStart = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      const line = value.slice(lineStart, ta.selectionStart);
      const m = /^(\s*)([-*+]|\d+[.)])\s(\[[ xX]\]\s)?(.*)$/.exec(line);
      if (!m) return;
      e.preventDefault();
      if (!m[4].trim() && !m[3]) {
        // Empty bullet: end the list.
        ta.setRangeText('', lineStart, ta.selectionStart, 'end');
      } else if (!m[4].trim() && m[3]) {
        ta.setRangeText('', lineStart, ta.selectionStart, 'end');
      } else {
        const marker = /^\d+/.test(m[2]) ? (parseInt(m[2], 10) + 1) + m[2].slice(-1) : m[2];
        ta.setRangeText('\n' + m[1] + marker + ' ' + (m[3] ? '[ ] ' : ''), ta.selectionStart, ta.selectionEnd, 'end');
      }
      scheduleSave();
    }
  }

  // ---- settings dialog -----------------------------------------------------

  function openSettings() {
    const s = state.settings;
    el.hotkeyInput.value = H.displayAccelerator(s.hotkey).replace(/ /g, '');
    el.hotkeyError.textContent = '';
    el.themeSelect.value = s.theme;
    el.fontSizeInput.value = s.fontSize;
    el.fontSizeValue.textContent = s.fontSize + 'px';
    el.openAtLoginInput.checked = s.openAtLogin;
    el.alwaysOnTopInput.checked = s.alwaysOnTop;
    syncAlignSeg(s.editorAlign);
    el.editorFullWidthInput.checked = !s.editorWidth;
    el.editorWidthInput.disabled = !s.editorWidth;
    el.editorWidthInput.value = s.editorWidth || 760;
    el.editorWidthValue.textContent = (s.editorWidth || 760) + 'px';
    el.gitEnabledInput.checked = s.gitEnabled;
    el.gitRemoteInput.value = s.gitRemote;
    populateVoices();
    el.settingsDialog.showModal();
    renderVaultList();
    el.ttsRateInput.value = s.ttsRate;
    el.ttsRateValue.textContent = Number(s.ttsRate).toFixed(1) + '×';
    refreshGitStatus();
  }

  function syncAlignSeg(value) {
    el.alignSeg.querySelectorAll('button[data-align]').forEach((b) => {
      const on = b.dataset.align === value;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }

  async function refreshGitStatus() {
    renderGitStatus(await api.git.status());
  }

  function renderGitStatus(s) {
    if (!s) return;
    let text;
    if (!s.enabled) text = 'Off. Your notes file is still backed up to the backups folder.';
    else if (s.available === false) text = 'git was not found on this computer, so no history is being kept.';
    else if (!s.commits) text = s.pending ? 'First commit coming up…' : 'Repository ready; no commits yet.';
    else text = s.commits + (s.commits === 1 ? ' commit' : ' commits') + ', last ' + H.relativeTime(s.lastCommitAt) + (s.pending ? ', changes waiting' : '') + (s.remote ? (s.lastPushAt ? ', pushed ' + H.relativeTime(s.lastPushAt) : ', not pushed yet') : '');
    if (s.lastError) text += '  Error: ' + s.lastError;
    el.gitStatus.textContent = text;
    el.gitPushBtn.disabled = !s.enabled || !s.remote;
    el.gitCommitBtn.disabled = !s.enabled;
  }

  function acceleratorFromEvent(e) {
    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    const ignore = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'];
    if (ignore.includes(e.key)) return { partial: mods.join('+') + '+' };
    let key = e.key;
    const numpad = { NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec' };
    if (numpad[e.code]) key = numpad[e.code];
    else if (/^Numpad[0-9]$/.test(e.code)) key = 'num' + e.code.slice(-1);
    else if (key === '+') key = 'Plus';
    else if (key === ' ') key = 'Space';
    else if (key === 'Escape') key = 'Esc';
    else if (key === 'ArrowUp') key = 'Up';
    else if (key === 'ArrowDown') key = 'Down';
    else if (key === 'ArrowLeft') key = 'Left';
    else if (key === 'ArrowRight') key = 'Right';
    else if (key.length === 1) key = key.toUpperCase();
    return { partial: null, value: mods.concat(key).join('+') };
  }

  async function commitHotkey(value) {
    const parsed = H.parseAccelerator(value);
    if (!parsed.ok) { el.hotkeyError.textContent = parsed.reason; return; }
    const res = await updateSettings({ hotkey: parsed.value });
    el.hotkeyError.textContent = res.error || '';
    if (!res.error) {
      el.hotkeyInput.value = H.displayAccelerator(res.settings.hotkey).replace(/ /g, '');
      toast('Hotkey set to ' + res.info.hotkeyDisplay);
    }
  }

  // ---- global keyboard -----------------------------------------------------

  function onKeydown(e) {
    if (e.isComposing || e.keyCode === 229) return; // never hide the window or act on a key an IME is still composing
    const ctrl = e.ctrlKey || e.metaKey;
    const inDialog = el.settingsDialog.open || el.splitDialog.open || el.linkDialog.open || el.remindDialog.open || el.lockDialog.open || el.liveDialog.open || el.historyDialog.open || el.signDialog.open;
    if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's' && pdfNote) { e.preventDefault(); flushPdf({ commit: true, explicit: true }); return; }
    if (e.key === 'Escape') {
      if (inDialog) return; // dialog handles it
      if (el.pdfEditor.contains(document.activeElement)) return; // pdf.js ends the edit in progress; the window stays
      if (find.open) { e.preventDefault(); closeFind(); return; }
      if (!el.shareMenu.classList.contains('hidden')) { e.preventDefault(); closeShareMenu(); el.shareBtn.focus(); return; }
      if (!el.convertMenu.classList.contains('hidden')) { e.preventDefault(); closeConvertMenu(); el.fileConvertBtn.focus(); return; }
      if (!el.lockMenu.classList.contains('hidden')) { e.preventDefault(); el.lockMenu.classList.add('hidden'); el.lockBtn.focus(); return; }
      if (state.menuFolderId) { e.preventDefault(); closeFolderMenu(); return; }
      if (!el.pageMenu.classList.contains('hidden') || !el.bookMenu.classList.contains('hidden')) { e.preventDefault(); closeAllBookMenus(); return; }
      if (readerOpen()) { e.preventDefault(); closeReader(); return; }
      if (document.activeElement === el.searchInput && el.searchInput.value) {
        el.searchInput.value = '';
        clearTimeout(searchTimer);
        endSearchStep();
        return;
      }
      e.preventDefault();
      flushSave().then(() => api.app.hide());
      return;
    }
    if (inDialog) return;
    if (ctrl && !e.shiftKey && !e.altKey) {
      switch (e.key.toLowerCase()) {
        case 'n': e.preventDefault(); newNote(); return;
        case 'o': e.preventDefault(); openFiles(); return;
        case 'l': e.preventDefault(); onLockButton(); return;
        case 'h': e.preventDefault(); if (!find.open) openFind(); toggleReplace(true); return;
        case 'f': e.preventDefault(); showList().then(() => { el.searchInput.focus(); el.searchInput.select(); }); return;
        case 'e': e.preventDefault(); if (state.current) toggleSource(); return;
        case 'p': e.preventDefault(); togglePin(); return;
        case 's': e.preventDefault(); flushSave().then((ok) => toast(ok ? 'Saved' : 'Save failed, will retry')); return;
        case ',': e.preventDefault(); openSettings(); return;
        case '\\': e.preventDefault(); updateSettings({ sidebarCollapsed: !state.settings.sidebarCollapsed }); return;
        // Ctrl+Delete deletes the next word inside text fields; only trash when focus is elsewhere.
        case 'delete': if (!inTextField()) { e.preventDefault(); trashCurrent(); } return;
        // In the rendered view, Ctrl+B and Ctrl+I are handled by the editor itself.
        case 'b': if (document.activeElement === el.bodyInput) { e.preventDefault(); wrapSelection('**', '**'); } return;
        case 'i': if (document.activeElement === el.bodyInput) { e.preventDefault(); wrapSelection('_', '_'); } return;
        case 'k':
          if (document.activeElement === el.bodyInput) { e.preventDefault(); wrapSelection('[', '](url)'); }
          else if (bodyHasFocus()) { e.preventDefault(); openLinkDialog(); }
          return;
        default: break;
      }
    }
    if (ctrl && e.shiftKey && e.key === 'Delete') { e.preventDefault(); trashCurrent(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      updateSettings({ theme: effectiveTheme() === 'dark' ? 'light' : 'dark' });
      return;
    }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      startCreateFolder(state.view === 'folder' ? state.folderId : null);
      return;
    }
    if (ctrl && e.shiftKey && !e.altKey && e.code === 'Backslash') { e.preventDefault(); toggleList(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); toggleReadAloud(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); toggleBot(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); toggleSticky(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); attachFiles(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'g') { e.preventDefault(); toggleRecording(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); openHistory(); return; }
    if (ctrl && !e.shiftKey && (e.key === 'PageDown' || e.key === 'PageUp')) { if (stepPage(e.key === 'PageDown' ? 1 : -1)) e.preventDefault(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); openRemindDialog(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); openShareMenu(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); printNote(); return; }
    if (e.key === 'F3' && find.open) { e.preventDefault(); runFind(!e.shiftKey); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); startDictation(); return; }
    if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const idx = state.notes.findIndex((n) => n.id === state.currentId);
      const next = state.notes[idx + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) selectNote(next.id).then(() => focusBody());
    }
  }

  // ---- wiring --------------------------------------------------------------

  function bind() {
    el.newNoteBtn.addEventListener('click', newNote);
    el.openFileBtn.addEventListener('click', () => openFiles());
    el.fileRevealBtn.addEventListener('click', () => state.currentId && api.files.reveal(state.currentId));
    el.pdfEditor.querySelector('.pdf-toolbar').addEventListener('click', onPdfToolbarClick);
    el.signForm.addEventListener('submit', (e) => { e.preventDefault(); placeSignature(); });
    el.signClearBtn.addEventListener('click', () => { if (signPad) signPad.clear(); signSay(''); });
    el.signTypeBtn.addEventListener('click', () => {
      if (signPad && signPad.writeName(el.signName.value)) signSay('');
      else signSay('Type your name first.');
    });
    el.signName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.signTypeBtn.click(); } });
    el.signCancelBtn.addEventListener('click', () => el.signDialog.close());
    el.signForgetBtn.addEventListener('click', async () => {
      const r = await callOk(api.signature.forget());
      if (!r.ok) { signSay('Could not forget the signature: ' + r.error); return; }
      el.signForgetBtn.classList.add('hidden');
      el.signRemember.checked = false;
      if (signPad) signPad.clear();
      signSay('The saved signature is gone from this PC.');
    });
    el.fileConvertBtn.addEventListener('click', () => { if (el.convertMenu.classList.contains('hidden')) openConvertMenu(); else closeConvertMenu(); });
    el.convertMenu.addEventListener('click', (e) => { const b = e.target.closest('[data-to]'); if (b) convertCurrent(b.dataset.to); });
    el.fileOpenBtn.addEventListener('click', async () => { if (!state.currentId) return; const err = await api.files.openExternal(state.currentId); if (err) toast('Could not open: ' + err); });
    el.fileReloadBtn.addEventListener('click', reloadCurrentFile);
    el.agentFilesBtn.addEventListener('click', addAgentFiles);
    el.vaultAddFolderBtn.addEventListener('click', addVaultFolder);
    el.vaultCloneBtn.addEventListener('click', openCloneDialog);
    el.vaultDestBtn.addEventListener('click', async () => { const d = await api.vaults.pickFolder(); if (d) el.vaultDestInput.value = d; });
    el.vaultCancelBtn.addEventListener('click', () => el.vaultDialog.close());
    el.vaultForm.addEventListener('submit', (e) => { e.preventDefault(); submitClone(); });
    api.on.vaultStatus(({ id, status }) => {
      const before = state.vaultStatus[id] || {};
      state.vaultStatus[id] = status;
      if (status.lastError && status.lastError !== before.lastError) toast('Vault: ' + status.lastError);
      renderFolders();
      // Never rebuild the list under a field the user is typing in; just refresh that vault's status line.
      const typing = document.activeElement && el.vaultList.contains(document.activeElement);
      if (typing) {
        const item = el.vaultList.querySelector('.vault-item[data-id="' + id + '"] .vault-status');
        if (item) { item.textContent = describeVaultStatus({ status }); item.classList.toggle('is-error', !!(status.lastError || status.conflict)); }
      } else renderVaultList();
    });
    el.readAloudBtn.addEventListener('click', toggleReadAloud);
    el.dictateBtn.addEventListener('click', startDictation);
    el.stickyBtn.addEventListener('click', toggleSticky);
    el.printBtn.addEventListener('click', printNote);
    el.remindBtn.addEventListener('click', openRemindDialog);
    el.lockBtn.addEventListener('click', onLockButton);
    el.bookPrevBtn.addEventListener('click', () => stepPage(-1));
    el.bookNextBtn.addEventListener('click', () => stepPage(1));
    el.bookAddBtn.addEventListener('click', addPage);
    el.bookName.addEventListener('click', openBookMenu);
    el.newBookBtn.addEventListener('click', () => startCreateFolder(null, true));
    el.pageMenu.querySelectorAll('button[data-action]').forEach((b) => b.addEventListener('click', () => pageMenuAction(b.dataset.action)));
    el.bookMenu.querySelectorAll('button[data-action]').forEach((b) => b.addEventListener('click', () => bookMenuAction(b.dataset.action)));
    el.bookReaderCloseBtn.addEventListener('click', closeReader);
    el.bookReaderPdfBtn.addEventListener('click', () => exportBook('pdf'));
    el.bookReaderPrintBtn.addEventListener('click', () => exportBook('print'));
    el.bookReaderToc.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-page]');
      if (!a) return;
      const sec = document.getElementById('reader-page-' + a.dataset.page);
      if (sec) sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    el.bookReaderBody.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-edit]');
      if (btn) { const id = btn.dataset.edit; closeReader(); selectNote(id); return; }
      const link = e.target.closest('a[href]');
      if (link) { e.preventDefault(); followLink(link.getAttribute('href')); }
    });
    el.liveLinkBtn.addEventListener('click', async () => { const s = state.current && (await api.live.status(state.current.id)); if (s && s.url) openLiveDialog('link', s.url); });
    el.liveStopBtn.addEventListener('click', stopLive);
    el.liveForm.addEventListener('submit', (e) => { e.preventDefault(); submitLiveDialog(); });
    el.liveCancelBtn.addEventListener('click', () => el.liveDialog.close());
    el.liveCopyBtn.addEventListener('click', async () => { await api.app.copy({ text: el.liveLinkInput.value }); toast('Link copied'); });
    el.liveDialog.addEventListener('close', () => focusBody());
    api.on.liveStatus(({ id, status }) => {
      if (status && status.ended) { delete state.liveStatus[id]; if (state.current && state.current.id === id) { refreshCurrentMeta(); toast('The host ended the live share. Your copy of the note stays.'); } return; }
      if (status) state.liveStatus[id] = status; else delete state.liveStatus[id];
      if (state.current && state.current.id === id) { if (!status && state.current.live) refreshCurrentMeta(); else renderLiveRow(state.current); }
    });
    el.lockMenu.addEventListener('click', (e) => { const b = e.target.closest('[data-action]'); if (b) lockMenuAction(b.dataset.action); });
    el.lockForm.addEventListener('submit', (e) => { e.preventDefault(); submitLockDialog(); });
    el.lockCancelBtn.addEventListener('click', () => el.lockDialog.close());
    el.lockDialog.addEventListener('close', () => focusBody());
    el.lockScreen.addEventListener('submit', (e) => { e.preventDefault(); unlockFromScreen(); });
    api.on.relocked(async (ids) => {
      // Plaintext kept for a retry must go too: it can no longer be saved (ELOCKED) and must not linger.
      for (const id of ids) state.pending.delete(id);
      if (readerOpen()) closeReader(); // it may show pages that were unlocked a moment ago
      if (state.currentId && ids.includes(state.currentId)) { state.dirty = false; const fresh = await api.notes.get(state.currentId); if (fresh) applyLockedNote(fresh); }
      refresh({ keepEditor: true });
    });
    el.remindQuick.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) setReminder(quickPick(b.dataset.pick)); });
    el.remindForm.addEventListener('submit', (e) => { e.preventDefault(); const t = Date.parse(el.remindInput.value); if (!Number.isFinite(t)) { toast('Pick a date and time'); return; } setReminder(t); });
    el.remindClearBtn.addEventListener('click', () => setReminder(null));
    el.remindCancelBtn.addEventListener('click', () => el.remindDialog.close());
    el.remindDialog.addEventListener('close', () => focusBody());
    api.on.notice((text) => toast(String(text)));
    // Undo/Redo from the right-click menu: the rich editor has its own history; the textarea uses the native one.
    api.on.editCommand((cmd) => { if (state.rich && !state.sourceMode && el.richEditor.contains(document.activeElement)) state.rich.editor.chain().focus()[cmd === 'redo' ? 'redo' : 'undo']().run(); else document.execCommand(cmd === 'redo' ? 'redo' : 'undo'); });
    api.on.reminderFired(({ id, title }) => {
      toast('⏰ ' + (title || 'Reminder'), { label: 'Open', run: async () => { await setView('all'); await selectNoteNow(id); } });
      refresh({ keepEditor: true }).then(() => { if (state.currentId === id) refreshCurrentMeta(); });
    });
    el.shareBtn.addEventListener('click', () => { if (el.shareMenu.classList.contains('hidden')) openShareMenu(); else closeShareMenu(); });
    el.shareMenu.addEventListener('click', (e) => { const b = e.target.closest('[data-action]'); if (b) shareAction(b.dataset.action); });
    el.findNextBtn.addEventListener('click', () => runFind(true));
    el.findReplaceToggle.addEventListener('click', () => toggleReplace());
    el.replaceOneBtn.addEventListener('click', replaceCurrent);
    el.replaceAllBtn.addEventListener('click', replaceAll);
    el.replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (e.ctrlKey || e.metaKey || e.altKey) replaceAll(); else replaceCurrent(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
    });
    el.attachBtn.addEventListener('click', attachFiles);
    el.recordBtn.addEventListener('click', toggleRecording);
    el.historyBtn.addEventListener('click', openHistory);
    el.historyCloseBtn.addEventListener('click', () => el.historyDialog.close());
    el.historyRestoreBtn.addEventListener('click', restoreVersion);
    el.historyDialog.addEventListener('close', () => focusBody());
    el.linkNoteSelect.addEventListener('change', () => { if (el.linkNoteSelect.value) el.linkInput.value = el.linkNoteSelect.value; });
    el.findPrevBtn.addEventListener('click', () => runFind(false));
    el.findCloseBtn.addEventListener('click', closeFind);
    el.findInput.addEventListener('input', () => runFind(true, true));
    el.bodyInput.addEventListener('input', () => { if (find.open && state.sourceMode) runFind(true, true, true); });
    el.findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); runFind(!e.shiftKey); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
    });
    api.on.stickiesChanged(() => { refreshCurrentMeta(); });
    api.on.openNote(async (id) => { await setView('all'); await selectNoteNow(id); });
    el.botBtn.addEventListener('click', () => toggleBot());
    el.botCloseBtn.addEventListener('click', () => toggleBot(false));
    el.botRunBtn.addEventListener('click', runBot);
    el.botTerminalBtn.addEventListener('click', openBotTerminal);
    el.botPrompt.addEventListener('keydown', (e) => { e.stopPropagation(); if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runBot(); } if (e.key === 'Escape') { e.preventDefault(); toggleBot(false); } });
    api.on.botEvent(onBotEvent);
    if (window.speechSynthesis) { populateVoices(); window.speechSynthesis.addEventListener('voiceschanged', populateVoices); }
    el.ttsVoiceSelect.addEventListener('change', () => updateSettings({ ttsVoice: el.ttsVoiceSelect.value }));
    el.ttsRateInput.addEventListener('input', () => { el.ttsRateValue.textContent = Number(el.ttsRateInput.value).toFixed(1) + '×'; });
    el.ttsRateInput.addEventListener('change', () => updateSettings({ ttsRate: Number(el.ttsRateInput.value) }));
    setInterval(pollCurrentFile, 3000);
    // Drag files from Explorer onto the window to open them.
    let dragDepth = 0;
    document.addEventListener('dragenter', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) { dragDepth++; el.app.classList.add('is-dropping'); } });
    document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; el.app.classList.remove('is-dropping'); } });
    document.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      dragDepth = 0; el.app.classList.remove('is-dropping');
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      const paths = Array.from(e.dataTransfer.files).map((f) => api.files.pathFor(f)).filter(Boolean);
      if (paths.length) openFiles(paths);
    });
    el.navItems.forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    el.themeBtn.addEventListener('click', () => updateSettings({ theme: effectiveTheme() === 'dark' ? 'light' : 'dark' }));
    el.settingsBtn.addEventListener('click', openSettings);
    el.toggleSidebarBtn.addEventListener('click', () => updateSettings({ sidebarCollapsed: !state.settings.sidebarCollapsed }));
    el.toggleListBtn.addEventListener('click', toggleList);
    el.hideListBtn.addEventListener('click', toggleList);
    setupResizer(el.sidebarResizer, 'sidebarWidth');
    setupResizer(el.listResizer, 'listWidth');

    // Folders
    el.newFolderBtn.addEventListener('click', () => startCreateFolder(state.view === 'folder' ? state.folderId : null));
    el.folderSelect.addEventListener('change', () => { if (state.currentId) moveNoteToFolder(state.currentId, el.folderSelect.value || null); });
    el.folderMenu.querySelectorAll('button[data-action]').forEach((b) => b.addEventListener('click', () => folderMenuAction(b.dataset.action)));
    document.addEventListener('pointerdown', (e) => {
      if (state.menuFolderId && !el.folderMenu.contains(e.target)) closeFolderMenu();
      if ((!el.pageMenu.classList.contains('hidden') || !el.bookMenu.classList.contains('hidden')) && !el.pageMenu.contains(e.target) && !el.bookMenu.contains(e.target) && !el.bookName.contains(e.target)) closeAllBookMenus();
      if (!el.shareMenu.classList.contains('hidden') && !el.shareMenu.contains(e.target) && !el.shareBtn.contains(e.target)) closeShareMenu();
      if (!el.convertMenu.classList.contains('hidden') && !el.convertMenu.contains(e.target) && !el.fileConvertBtn.contains(e.target)) closeConvertMenu();
      if (!el.lockMenu.classList.contains('hidden') && !el.lockMenu.contains(e.target) && !el.lockBtn.contains(e.target)) el.lockMenu.classList.add('hidden');
    });
    wireDropTarget(el.navAll, null); // dropping on "All notes" moves a note or folder to the top level
    window.addEventListener('resize', () => { if (state.settings) applyPaneWidths(state.settings.sidebarWidth, state.settings.listWidth); });

    el.searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(endSearchStep, 120);
    });
    el.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && state.notes.length) { selectNote(state.notes[0].id).then(() => focusBody()); }
      if (e.key === 'ArrowDown' && state.notes.length) { e.preventDefault(); selectNote(state.notes[0].id).then(() => focusBody()); }
    });
    el.sortSelect.addEventListener('change', () => updateSettings({ sort: el.sortSelect.value }).then(() => refresh({ keepEditor: true })));
    el.emptyTrashBtn.addEventListener('click', emptyTrash);

    el.pinBtn.addEventListener('click', togglePin);
    el.sourceBtn.addEventListener('click', () => toggleSource());
    el.bodyInput.addEventListener('input', autoGrow);
    el.richEditor.addEventListener('mousedown', (e) => { if (e.target === el.richEditor && state.rich) { e.preventDefault(); state.rich.focus('end'); } });

    // Link dialog (rendered view)
    el.linkForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const href = el.linkInput.value.trim();
      el.linkDialog.close();
      if (state.rich) state.rich.setLink(href && href !== 'https://' ? href : '', state.linkRange);
    });
    el.linkRemoveBtn.addEventListener('click', () => { el.linkDialog.close(); if (state.rich) state.rich.setLink('', state.linkRange); });
    el.linkCancelBtn.addEventListener('click', () => el.linkDialog.close());
    el.linkDialog.addEventListener('close', () => focusBody());

    // Writing column layout
    el.alignSeg.querySelectorAll('button[data-align]').forEach((b) => b.addEventListener('click', () => { updateSettings({ editorAlign: b.dataset.align }); syncAlignSeg(b.dataset.align); }));
    el.editorWidthInput.addEventListener('input', () => {
      el.editorWidthValue.textContent = el.editorWidthInput.value + 'px';
      el.editorColumn.style.setProperty('--editor-col-width', el.editorWidthInput.value + 'px');
    });
    el.editorWidthInput.addEventListener('change', () => updateSettings({ editorWidth: Number(el.editorWidthInput.value) }));
    el.editorFullWidthInput.addEventListener('change', () => {
      const full = el.editorFullWidthInput.checked;
      el.editorWidthInput.disabled = full;
      updateSettings({ editorWidth: full ? 0 : Number(el.editorWidthInput.value) || 760 });
    });

    // Git history
    el.gitEnabledInput.addEventListener('change', () => updateSettings({ gitEnabled: el.gitEnabledInput.checked }).then(refreshGitStatus));
    const commitRemote = () => { const v = el.gitRemoteInput.value.trim(); if (v !== state.settings.gitRemote) updateSettings({ gitRemote: v }).then(refreshGitStatus); };
    el.gitRemoteInput.addEventListener('change', commitRemote);
    el.gitRemoteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitRemote(); } });
    el.gitCommitBtn.addEventListener('click', async () => { await flushSave(); const r = await api.git.commit(); toast(r.ok ? (r.nothingToCommit ? 'Nothing new to commit' : 'Committed') : 'Commit failed: ' + (r.error || r.skipped)); refreshGitStatus(); });
    el.gitPushBtn.addEventListener('click', async () => { const r = await api.git.push(); toast(r.ok ? 'Pushed' : 'Push failed: ' + (r.error || r.skipped)); refreshGitStatus(); });
    api.on.gitStatus((s) => renderGitStatus(s));
    el.exportBtn.addEventListener('click', exportCurrent);
    el.duplicateBtn.addEventListener('click', duplicateCurrent);
    el.splitBtn.addEventListener('click', openSplitDialog);
    el.splitForm.addEventListener('submit', (e) => { e.preventDefault(); applySplit(); });
    el.splitCancelBtn.addEventListener('click', () => { state.splitNoteId = null; el.splitDialog.close(); });
    el.restoreBtn.addEventListener('click', restoreCurrent);
    el.deleteBtn.addEventListener('click', trashCurrent);
    el.destroyBtn.addEventListener('click', destroyCurrent);

    el.titleInput.addEventListener('input', scheduleSave);
    el.tagsInput.addEventListener('input', scheduleSave);
    el.bodyInput.addEventListener('input', scheduleSave);
    el.titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); focusBody(); } });
    el.tagsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); focusBody(); } });
    el.tagsInput.addEventListener('blur', flushSave);
    el.bodyInput.addEventListener('keydown', handleEditorKeydown);

    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave({ fromBlur: true }); });
    window.addEventListener('blur', () => flushSave({ fromBlur: true }));
    window.addEventListener('beforeunload', flushSave);

    // Settings dialog
    el.hotkeyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') return;
      e.preventDefault();
      const r = acceleratorFromEvent(e);
      if (r.partial !== null) { el.hotkeyInput.value = r.partial; return; }
      el.hotkeyInput.value = r.value;
      commitHotkey(r.value);
    });
    el.hotkeyInput.addEventListener('blur', () => {
      const v = el.hotkeyInput.value.trim();
      if (v && !v.endsWith('+') && v !== H.displayAccelerator(state.settings.hotkey).replace(/ /g, '')) commitHotkey(v);
      else if (!v || v.endsWith('+')) el.hotkeyInput.value = H.displayAccelerator(state.settings.hotkey).replace(/ /g, '');
    });
    el.themeSelect.addEventListener('change', () => updateSettings({ theme: el.themeSelect.value }));
    el.fontSizeInput.addEventListener('input', () => {
      el.fontSizeValue.textContent = el.fontSizeInput.value + 'px';
      document.documentElement.style.setProperty('--editor-font-size', el.fontSizeInput.value + 'px');
    });
    el.fontSizeInput.addEventListener('change', () => updateSettings({ fontSize: Number(el.fontSizeInput.value) }));
    el.openAtLoginInput.addEventListener('change', () => updateSettings({ openAtLogin: el.openAtLoginInput.checked }));
    el.alwaysOnTopInput.addEventListener('change', () => updateSettings({ alwaysOnTop: el.alwaysOnTopInput.checked }));
    el.importBtn.addEventListener('click', async () => {
      let res;
      try { res = await api.app.importMarkdown(); }
      catch (err) { toast('Import failed: ' + (err.message || err)); return; }
      if (res.canceled) return;
      if (res.count) { el.settingsDialog.close(); await refresh({ keepEditor: true }); if (res.firstId) await selectNote(res.firstId); }
      const failed = res.failed && res.failed.length ? '. Could not read: ' + res.failed.join(', ') : '';
      toast((res.count ? 'Imported ' + res.count + (res.count === 1 ? ' note' : ' notes') : 'Nothing imported') + failed);
    });
    el.exportAllBtn.addEventListener('click', async () => {
      try { const res = await api.app.exportAll(); if (res.ok) toast('Exported to ' + res.filePath); }
      catch (err) { toast('Export failed: ' + (err.message || err)); }
    });
    el.dataFolderBtn.addEventListener('click', () => api.app.openDataFolder());
    el.settingsDialog.addEventListener('close', () => { if (state.current) focusBody(); });

    // Main-process events
    let shownBusy = false;
    api.on.shown(async () => {
      // 'shown' can arrive twice around startup (first paint plus the ready handshake); never overlap.
      if (shownBusy) return;
      shownBusy = true;
      try {
        await state.initDone; // the first show can arrive before the initial load has finished
        if (el.settingsDialog.open) return;
        if (state.current) {
          if (state.current.title || state.current.body) focusBody(); else el.titleInput.focus();
          return;
        }
        if (state.notes.length) {
          await selectNote(state.notes[0].id);
          focusBody();
          return;
        }
        // Only start a fresh note when there truly are none, not when the current view is just empty.
        const counts = await api.notes.counts();
        if (counts.all === 0) await newNote();
      } finally {
        shownBusy = false;
      }
    });
    api.on.newNote(newNote);
    api.on.flush(async () => { try { await flushSave(); await retryPending(); } finally { api.app.flushDone(); } });
    api.on.reloaded(async (info) => {
      const reason = info && info.reason;
      await refresh({ keepEditor: true });
      // The store may now hold a newer body for the open note (a pull, a rescan, the bot). Show it, unless
      // the user is mid-edit; in that case leave their text and tell them.
      if (state.currentId) {
        const wanted = state.currentId;
        const fresh = await api.notes.get(wanted);
        if (fresh && fresh.id !== state.currentId) return; // the person moved on while we were asking
        if (fresh && reason === 'live' && fresh.body === el.bodyInput.value && fresh.title !== el.titleInput.value && !state.dirty) { el.titleInput.value = fresh.title; state.current.title = fresh.title; refreshCard(fresh); }
        // A PDF or Word file is shown from the file, so a new version of it (same text or not) is shown too.
        if (fresh && isViewerOnlyFile(fresh) && fresh.fileMtime !== state.current.fileMtime) applyFreshFileBody(fresh);
        else if (fresh && fresh.body !== el.bodyInput.value) {
          if (reason === 'live') {
            // Someone else typed. Take their text unless this person is typing right now or a save of their
            // text is still in flight; their next save wins then.
            if ((!state.dirty && !state.inflight.has(state.currentId)) || Date.now() - state.lastTypedAt > 1500) { state.dirty = false; applyFreshFileBody(fresh); if (fresh.title !== el.titleInput.value) el.titleInput.value = fresh.title; }
          } else if (!state.dirty && !state.inflight.has(fresh.id)) { applyFreshFileBody(fresh); if (reason === 'vault') toast('This note was updated from the vault.'); }
          else toast('This note changed elsewhere while you were editing. Your text is kept; ' + (fresh.filePath ? 'use Reload to take the disk version.' : 'reopen the note to see the other version.'));
        }
      }
      if (reason === 'recovered') toast('Your notes file is readable again; saving resumed.');
    });
    api.on.settingsChanged((s) => applySettings(s));
    api.on.systemTheme((t) => { state.systemDark = t === 'dark'; document.documentElement.dataset.theme = effectiveTheme(); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (ev) => { state.systemDark = ev.matches; document.documentElement.dataset.theme = effectiveTheme(); });

    // Keep "x min ago" labels honest.
    setInterval(() => { if (!document.hidden) { renderList(); if (state.current) updateStatus(state.current); } }, 60000);
  }

  async function init() {
    const [settings, info] = await Promise.all([api.settings.get(), api.app.info()]);
    createRichEditor();
    applySettings(settings);
    applyInfo(info);
    bind();
    // Start in the folder the list showed last time, if it still exists (refresh falls back to all notes).
    if (settings.lastFolderId) { state.view = 'folder'; state.folderId = settings.lastFolderId; el.navItems.forEach((b) => b.classList.remove('is-active')); }
    await refresh();
    if (state.current) focusBody();
    // Tell main we can receive events now; it replays 'app:shown' if the window is already on screen.
    api.app.rendererReady().catch(() => {});
  }

  window.addEventListener('error', (e) => console.error('Uncaught: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('Unhandled rejection: ' + (e.reason && e.reason.message || e.reason)));

  let markInitDone;
  state.initDone = new Promise((resolve) => { markInitDone = resolve; });

  init().catch((err) => {
    console.error(err);
    toast('Something went wrong starting Notes: ' + err.message);
  }).finally(() => markInitDone());
})();
