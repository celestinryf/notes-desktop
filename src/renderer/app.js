/* Renderer: vanilla JS, talks to the main process through window.notesApi (see preload.js). */
(function () {
  'use strict';

  const api = window.notesApi;
  const H = window.NotesHelpers;
  const $ = (sel) => document.querySelector(sel);

  const el = {
    app: $('#app'),
    sidebar: $('#sidebar'),
    newNoteBtn: $('#newNoteBtn'),
    navItems: Array.from(document.querySelectorAll('.nav-item[data-view]')),
    countAll: $('#countAll'), countPinned: $('#countPinned'), countTrash: $('#countTrash'),
    tagList: $('#tagList'),
    themeBtn: $('#themeBtn'), settingsBtn: $('#settingsBtn'),
    hotkeyHint: $('#hotkeyHint'), hotkeyHint2: $('#hotkeyHint2'),
    searchInput: $('#searchInput'), sortSelect: $('#sortSelect'),
    listTitle: $('#listTitle'), emptyTrashBtn: $('#emptyTrashBtn'),
    noteList: $('#noteList'), listEmpty: $('#listEmpty'),
    editorEmpty: $('#editorEmpty'), editor: $('#editor'),
    toggleSidebarBtn: $('#toggleSidebarBtn'), pinBtn: $('#pinBtn'), sourceBtn: $('#sourceBtn'),
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
    fileRevealBtn: $('#fileRevealBtn'), fileOpenBtn: $('#fileOpenBtn'), fileReloadBtn: $('#fileReloadBtn'),
    fileBanner: $('#fileBanner'), pdfFrame: $('#pdfFrame'), agentFilesBtn: $('#agentFilesBtn'), agentFilesStatus: $('#agentFilesStatus'),
    readAloudBtn: $('#readAloudBtn'), dictateBtn: $('#dictateBtn'), ttsVoiceSelect: $('#ttsVoiceSelect'), ttsRateInput: $('#ttsRateInput'), ttsRateValue: $('#ttsRateValue'),
    vaultList: $('#vaultList'), vaultAddFolderBtn: $('#vaultAddFolderBtn'), vaultCloneBtn: $('#vaultCloneBtn'),
    vaultDialog: $('#vaultDialog'), vaultForm: $('#vaultForm'), vaultUrlInput: $('#vaultUrlInput'), vaultDestInput: $('#vaultDestInput'), vaultDestBtn: $('#vaultDestBtn'),
    vaultNameInput: $('#vaultNameInput'), vaultError: $('#vaultError'), vaultCancelBtn: $('#vaultCancelBtn'), vaultCloneSubmitBtn: $('#vaultCloneSubmitBtn'),
    folderMenuSync: $('#folderMenuSync'), folderMenuOpen: $('#folderMenuOpen'),
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
    el.sortSelect.value = settings.sort;
    applyPaneWidths(settings.sidebarWidth, settings.listWidth);
    applyEditorLayout(settings);
    // A note flagged as lossy stays in source whatever the global preference, unless the user overrode it.
    const forcedSource = (state.currentLossless === false && state.lossyOverride !== state.currentId) || !state.rich;
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
      // The folder we were looking at is gone; fall back to all notes.
      state.view = 'all'; state.folderId = null;
      el.navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === 'all'));
      return refresh(opts);
    }
    renderCounts(counts);
    renderTags(tags);
    renderFolders();
    renderFolderSelect();
    renderList();
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
    const titles = { all: 'All notes', pinned: 'Pinned', trash: 'Trash', tag: '#' + state.tag };
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
    const frag = document.createDocumentFragment();
    state.notes.forEach((n, i) => {
      const li = document.createElement('li');
      li.className = 'note-card' + (n.id === state.currentId ? ' is-active' : '');
      li.dataset.id = n.id;
      li.setAttribute('role', 'option');
      li.style.animationDelay = Math.min(i, 12) * 20 + 'ms';
      const tags = n.tags.map((t) => '<span class="tag">#' + escapeHtml(t) + '</span>').join('');
      const fileMark = n.filePath ? '<span class="file-mark" title="' + escapeHtml(n.filePath) + '">' + escapeHtml((n.fileKind || 'file').toUpperCase()) + '</span>' : '';
      li.innerHTML =
        '<div class="note-card-title">' + (n.pinned ? '<span class="pin" title="Pinned">★</span>' : '') + highlight(H.deriveTitle(n), q) + fileMark + '</div>' +
        '<div class="note-card-snippet">' + highlight(H.snippet(n, 120), q) + '</div>' +
        '<div class="note-card-meta"><span>' + escapeHtml(H.relativeTime(n.trashedAt || n.updatedAt)) + '</span>' + tags + '</div>';
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

  function refreshCard(note) {
    const li = el.noteList.querySelector('.note-card[data-id="' + note.id + '"]');
    if (!li) return;
    const q = state.query;
    li.querySelector('.note-card-title').innerHTML = (note.pinned ? '<span class="pin" title="Pinned">★</span>' : '') + highlight(H.deriveTitle(note), q);
    li.querySelector('.note-card-snippet').innerHTML = highlight(H.snippet(note, 120), q);
    const meta = li.querySelector('.note-card-meta');
    meta.innerHTML = '<span>' + escapeHtml(H.relativeTime(note.updatedAt)) + '</span>' + note.tags.map((t) => '<span class="tag">#' + escapeHtml(t) + '</span>').join('');
  }

  // ---- views ---------------------------------------------------------------

  async function setView(view, arg) {
    await flushSave();
    state.view = view;
    state.tag = view === 'tag' ? arg : null;
    state.folderId = view === 'folder' ? arg : null;
    el.navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    await refresh();
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
      icon.textContent = '▰';
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
      icon.textContent = '▰';
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
    input.placeholder = 'Folder name';
    input.setAttribute('aria-label', 'Folder name');
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

  function startCreateFolder(parentId) {
    closeFolderMenu();
    state.editingFolder = { mode: 'create', parentId: parentId || null };
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
    catch (err) { toast(err.message && /vault/i.test(err.message) ? 'Vault notes stay inside their vault; move them between its folders instead.' : 'Could not move: ' + (err.message || err)); return; }
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
    el.folderMenuOpen.classList.toggle('hidden', !node.vaultId);
    menu.querySelector('[data-action="delete"]').textContent = node.isVaultRoot ? 'Remove vault (keeps files)' : 'Delete folder';
    menu.classList.remove('hidden');
    const rect = anchor.getBoundingClientRect();
    let x = ev ? ev.clientX : rect.right - 4;
    let y = ev ? ev.clientY : rect.bottom + 4;
    menu.style.left = '0px'; menu.style.top = '0px';
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
    if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.querySelector('button').focus();
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
      remote.addEventListener('change', async () => { await api.vaults.update(v.id, { remote: remote.value.trim() }); renderVaultList(); });
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
    state.currentId = null;
    state.current = null;
    state.dirty = false;
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
    el.titleInput.value = note.title;
    el.tagsInput.value = note.tags.join(', ');
    el.bodyInput.value = note.body;
    const hasPending = applyPendingTo(note);
    let lossless = true;
    if (state.rich) {
      lossless = state.rich.setMarkdown(el.bodyInput.value);
      // A real file on disk gets the strict test: the rendered view may only be used if it reproduces the
      // file exactly, otherwise the first keystroke would reformat someone's CLAUDE.md or README.
      if (note.filePath && lossless && !state.rich.lastRoundTripExact()) lossless = false;
    }
    state.currentLossless = lossless;
    state.lossyOverride = null;
    // A note the rendered view cannot show faithfully opens as source, so nothing is rewritten by just looking.
    const wantSource = state.settings.editorMode === 'source' || !lossless || !state.rich;
    if (wantSource !== state.sourceMode) applyEditorMode(wantSource);
    if (!lossless && state.lossyToastFor !== note.id) {
      state.lossyToastFor = note.id;
      toast(note.filePath
        ? 'Opened as source: the rendered view would reformat this file. Ctrl+E switches anyway.'
        : 'Opened as Markdown source: the rendered view would change some of this note’s formatting.');
    }
    autoGrow();
    const inTrash = !!note.trashedAt;
    const fileReadOnly = !!(note.filePath && note.fileKind !== 'text');
    [el.titleInput, el.tagsInput].forEach((i) => { i.readOnly = inTrash; });
    el.bodyInput.readOnly = inTrash || fileReadOnly;
    if (state.rich) state.rich.setEditable(!inTrash && !fileReadOnly);
    renderFileRow(note);
    el.pinBtn.classList.toggle('hidden', inTrash);
    el.deleteBtn.classList.toggle('hidden', inTrash);
    el.duplicateBtn.classList.toggle('hidden', inTrash);
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
    const body = H.plainTextFromMarkdown(el.bodyInput.value);
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
    if (!state.current || (state.current.filePath && state.current.fileKind !== 'text') || state.current.trashedAt) { toast('Open an editable note first.'); return; }
    focusBody();
    const res = await api.app.dictate();
    if (!res.ok) toast(res.error || 'Dictation could not start.');
    else toast('Windows dictation opened: speak now. Say "stop dictating" or press Win+H to finish.');
  }

  // ---- file-backed notes ---------------------------------------------------

  function renderFileRow(note) {
    const isFile = !!(note && note.filePath);
    el.fileRow.classList.toggle('hidden', !isFile);
    el.fileBanner.classList.add('hidden');
    el.pdfFrame.classList.add('hidden');
    el.pdfFrame.removeAttribute('src');
    if (!isFile) { el.richEditor.classList.toggle('hidden', state.sourceMode); el.bodyInput.classList.toggle('hidden', !state.sourceMode); return; }
    el.fileKind.textContent = (note.fileKind || 'file').toUpperCase();
    el.filePath.textContent = note.filePath;
    el.filePath.title = note.filePath;
    if (note.fileKind === 'pdf') {
      el.richEditor.classList.add('hidden');
      el.bodyInput.classList.add('hidden');
      el.pdfFrame.classList.remove('hidden');
      api.files.pdfUrl(note.id).then((url) => { if (url && state.currentId === note.id) el.pdfFrame.src = url; });
      showBanner('PDF shown read-only. Use "Open with…" for your PDF app.');
    } else if (note.fileKind === 'docx') {
      showBanner('Word document converted to Markdown for reading. It is read-only here; use "Open with…" to edit in Word.');
    } else if (note.fileKind === 'binary') {
      el.richEditor.classList.add('hidden');
      el.bodyInput.classList.add('hidden');
      showBanner('This file type cannot be shown here. Use "Open with…" to open it in its own app.');
    }
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
      await selectNote(res.firstId);
    }
    const failed = res.failed.length ? ' Could not open: ' + res.failed.join(', ') : '';
    toast((res.linked.length ? 'Opened ' + res.linked.length + (res.linked.length === 1 ? ' file' : ' files') : 'Nothing opened') + failed);
  }

  // While a file-backed note is open and untouched, pick up changes made by other programs.
  async function pollCurrentFile() {
    const note = state.current;
    if (!note || !note.filePath || state.dirty || document.hidden) return;
    let res;
    try { res = await api.files.refresh(note.id); } catch (_) { return; }
    if (state.currentId !== note.id) return;
    if (res.missing) { showBanner('The file no longer exists at ' + note.filePath + '. Your last view is kept here as a plain note.'); return; }
    if (res.changed && !state.dirty) {
      const fresh = await api.notes.get(note.id);
      // Re-check after the second round trip: the user may have switched notes or started typing meanwhile.
      if (state.currentId !== note.id || state.dirty || !fresh) return;
      applyFreshFileBody(fresh);
      toast('Reloaded from disk: the file changed outside Notes.');
    }
  }

  // Puts a re-read file body into the editor and re-applies the strict rendered/source decision for files.
  function applyFreshFileBody(fresh) {
    state.current = fresh;
    el.bodyInput.value = fresh.body;
    if (state.rich) {
      let lossless = state.rich.setMarkdown(fresh.body);
      if (fresh.filePath && lossless && !state.rich.lastRoundTripExact()) lossless = false;
      state.currentLossless = lossless;
      if (!lossless && !state.sourceMode && state.lossyOverride !== fresh.id) {
        applyEditorMode(true);
        toast('Switched to source: the file now contains formatting the rendered view would change.');
      }
    }
    autoGrow();
    updateStatus(fresh);
  }

  async function reloadCurrentFile() {
    if (!state.current || !state.current.filePath) return;
    if (state.dirty && !window.confirm('Discard your unsaved edits and reload from disk?')) return;
    const id = state.currentId;
    state.dirty = false;
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
    if (!state.currentId || (state.current && state.current.trashedAt)) return;
    state.dirty = true;
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
    if (state.current && state.current.filePath && state.current.fileKind !== 'text') delete patch.body;
    return patch;
  }

  function scheduleRetry() {
    clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(async () => {
      if (state.pending.has(state.currentId)) { state.dirty = true; await flushSave(); }
      await retryPending();
    }, 3000);
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
    el.bodyInput.value = p.body;
    return true;
  }

  state.inflight = new Map(); // id -> promise of a write in progress, so a reselect can wait for it

  // Resolves true when the open note is saved (or had nothing to save), false when the write failed.
  async function flushSave() {
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
      setSaved('Saved');
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
      onUpdate: (md) => {
        if (state.sourceMode || !state.currentId) return;
        if (md === el.bodyInput.value) return;
        el.bodyInput.value = md;
        scheduleSave();
      },
    });
    el.richEditor.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (a && (e.ctrlKey || e.metaKey)) { e.preventDefault(); api.app.openExternal(a.getAttribute('href')); }
    });
  }

  function applyEditorMode(source) {
    state.sourceMode = !!source;
    el.sourceBtn.classList.toggle('is-on', state.sourceMode);
    el.sourceBtn.textContent = state.sourceMode ? 'Rendered' : 'Source';
    el.sourceBtn.title = state.sourceMode ? 'Back to the rendered view (Ctrl+E)' : 'Show Markdown source (Ctrl+E)';
    const viewerOnly = !!(state.current && state.current.filePath && (state.current.fileKind === 'pdf' || state.current.fileKind === 'binary'));
    el.bodyInput.classList.toggle('hidden', !state.sourceMode || viewerOnly);
    el.richEditor.classList.toggle('hidden', state.sourceMode || viewerOnly);
    if (state.sourceMode) autoGrow();
    else if (state.rich && state.currentId) state.currentLossless = state.rich.setMarkdown(el.bodyInput.value);
  }

  function toggleSource(force) {
    const next = typeof force === 'boolean' ? force : !state.sourceMode;
    if (next === state.sourceMode) return;
    if (!next && !state.rich) { toast('The rendered editor is unavailable; staying in Markdown source.'); return; }
    if (!next && state.currentId) {
      // Re-check with the text as it is now: it may have become lossy (or clean) while editing in source.
      state.currentLossless = state.rich.setMarkdown(el.bodyInput.value);
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

  function openLinkDialog() {
    if (!state.rich || state.sourceMode) return;
    const existing = state.rich.activeLink();
    if (!existing && !state.rich.hasSelection()) { toast('Select the text to link first'); return; }
    state.linkRange = state.rich.selectionRange();
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
    const ctrl = e.ctrlKey || e.metaKey;
    const inDialog = el.settingsDialog.open || el.linkDialog.open;
    if (e.key === 'Escape') {
      if (inDialog) return; // dialog handles it
      if (state.menuFolderId) { e.preventDefault(); closeFolderMenu(); return; }
      if (document.activeElement === el.searchInput && el.searchInput.value) {
        el.searchInput.value = '';
        state.query = '';
        refresh();
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
        case 'f': e.preventDefault(); el.searchInput.focus(); el.searchInput.select(); return;
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
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); toggleReadAloud(); return; }
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
      renderVaultList();
    });
    el.readAloudBtn.addEventListener('click', toggleReadAloud);
    el.dictateBtn.addEventListener('click', startDictation);
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
    setupResizer(el.sidebarResizer, 'sidebarWidth');
    setupResizer(el.listResizer, 'listWidth');

    // Folders
    el.newFolderBtn.addEventListener('click', () => startCreateFolder(state.view === 'folder' ? state.folderId : null));
    el.folderSelect.addEventListener('change', () => { if (state.currentId) moveNoteToFolder(state.currentId, el.folderSelect.value || null); });
    el.folderMenu.querySelectorAll('button[data-action]').forEach((b) => b.addEventListener('click', () => folderMenuAction(b.dataset.action)));
    document.addEventListener('pointerdown', (e) => { if (state.menuFolderId && !el.folderMenu.contains(e.target)) closeFolderMenu(); });
    wireDropTarget(el.navAll, null); // dropping on "All notes" moves a note or folder to the top level
    window.addEventListener('resize', () => { if (state.settings) applyPaneWidths(state.settings.sidebarWidth, state.settings.listWidth); });

    let searchTimer = null;
    el.searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.query = el.searchInput.value.trim(); refresh({ keepEditor: true }); }, 120);
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
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
    window.addEventListener('blur', flushSave);
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
    api.on.reloaded(async () => { await refresh(); toast('Your notes file is readable again; saving resumed.'); });
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
