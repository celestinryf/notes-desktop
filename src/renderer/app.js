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
    toggleSidebarBtn: $('#toggleSidebarBtn'), pinBtn: $('#pinBtn'), previewBtn: $('#previewBtn'),
    exportBtn: $('#exportBtn'), duplicateBtn: $('#duplicateBtn'), restoreBtn: $('#restoreBtn'),
    deleteBtn: $('#deleteBtn'), destroyBtn: $('#destroyBtn'),
    titleInput: $('#titleInput'), tagsInput: $('#tagsInput'), bodyInput: $('#bodyInput'), preview: $('#preview'),
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
    preview: false,
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

  function highlight(text, query) {
    const safe = escapeHtml(text);
    const tokens = H.tokenize(query);
    if (!tokens.length) return safe;
    const re = new RegExp('(' + tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
    return safe.replace(re, '<span class="mark">$1</span>');
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
    if (info.loadError) toast('Notes file was unreadable; restored from the newest backup.');
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
      li.innerHTML =
        '<div class="note-card-title">' + (n.pinned ? '<span class="pin" title="Pinned">★</span>' : '') + highlight(H.deriveTitle(n), q) + '</div>' +
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
    if (edit.mode === 'create') {
      if (!name) { renderFolders(); return; }
      const folder = await api.folders.create({ name, parentId: edit.parentId });
      await setView('folder', folder.id);
      toast('Folder "' + H.truncate(folder.name, 30) + '" created');
    } else {
      if (name) await api.folders.rename(edit.id, name);
      await refresh({ keepEditor: true });
    }
  }

  async function deleteFolder(id) {
    closeFolderMenu();
    const node = flattenTree(state.tree).find((n) => n.id === id);
    if (!node) return;
    const what = [];
    if (node.count) what.push(node.count + (node.count === 1 ? ' note' : ' notes'));
    if (node.children.length) what.push(node.children.length + (node.children.length === 1 ? ' subfolder' : ' subfolders'));
    const detail = what.length ? ' Its ' + what.join(' and ') + ' move up one level; nothing is deleted.' : '';
    if (!window.confirm('Delete folder "' + node.name + '"?' + detail)) return;
    await flushSave();
    const res = await api.folders.delete(id);
    if (state.view === 'folder' && (state.folderId === id || !flattenTree(state.tree).some((n) => n.id === state.folderId))) {
      if (res && res.parentId) await setView('folder', res.parentId); else await setView('all');
    } else await refresh({ keepEditor: true });
    toast('Folder deleted');
  }

  async function moveNoteToFolder(noteId, folderId) {
    await flushSave();
    const updated = await api.notes.update(noteId, { folderId: folderId || null });
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
    if (action === 'new-note') { await setView('folder', id); await newNote(); }
    else if (action === 'new-subfolder') startCreateFolder(id);
    else if (action === 'rename') startRename(id);
    else if (action === 'delete') deleteFolder(id);
  }

  // ---- editor --------------------------------------------------------------

  function clearEditor() {
    state.currentId = null;
    state.current = null;
    state.dirty = false;
    el.editor.classList.add('hidden');
    el.editorEmpty.classList.remove('hidden');
    el.noteList.querySelectorAll('.note-card.is-active').forEach((c) => c.classList.remove('is-active'));
  }

  async function selectNote(id) {
    if (state.currentId === id && state.current) return;
    await flushSave();
    const note = await api.notes.get(id);
    if (!note) return;
    state.currentId = note.id;
    state.current = note;
    state.dirty = false;
    el.titleInput.value = note.title;
    el.tagsInput.value = note.tags.join(', ');
    el.bodyInput.value = note.body;
    const inTrash = !!note.trashedAt;
    [el.titleInput, el.tagsInput, el.bodyInput].forEach((i) => { i.readOnly = inTrash; });
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
    setSaved('Saved');
    if (state.preview) renderPreview();
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

  function scheduleSave() {
    if (!state.currentId || (state.current && state.current.trashedAt)) return;
    state.dirty = true;
    setSaved('Saving…');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flushSave, 350);
    if (state.current) updateStatus(state.current);
  }

  async function flushSave() {
    clearTimeout(state.saveTimer);
    if (!state.dirty || !state.currentId) return;
    const id = state.currentId;
    const patch = { title: el.titleInput.value, body: el.bodyInput.value, tags: el.tagsInput.value };
    state.dirty = false;
    const updated = await api.notes.update(id, patch);
    if (!updated) return;
    if (state.currentId === id) {
      state.current = updated;
      updateStatus(updated);
      setSaved('Saved');
    }
    const idx = state.notes.findIndex((n) => n.id === id);
    if (idx !== -1) {
      state.notes[idx] = updated;
      refreshCard(updated);
      if (state.settings.sort === 'updated' && idx !== 0 && !updated.pinned) await refresh({ keepEditor: true });
      else if (updated.tags.join(',') !== (state.notes[idx].tags || []).join(',')) await refresh({ keepEditor: true });
    }
    // Tags may have changed: cheap to refresh the tag list.
    api.notes.tags().then(renderTags);
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
    const note = await api.notes.create(data);
    state.query = '';
    el.searchInput.value = '';
    await refresh({ keepEditor: true });
    await selectNote(note.id);
    if (state.preview) togglePreview(false);
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
    await api.notes.destroy(state.currentId);
    clearEditor();
    await refresh();
    toast('Deleted');
  }

  async function emptyTrash() {
    const n = state.notes.length;
    if (!n || !window.confirm('Permanently delete ' + n + (n === 1 ? ' note' : ' notes') + ' in the trash?')) return;
    await api.notes.emptyTrash();
    clearEditor();
    await refresh();
    toast('Trash emptied');
  }

  async function duplicateCurrent() {
    if (!state.current) return;
    await flushSave();
    const copy = await api.notes.duplicate(state.currentId);
    await refresh({ keepEditor: true });
    await selectNote(copy.id);
    toast('Duplicated');
  }

  async function exportCurrent() {
    if (!state.current) return;
    await flushSave();
    const res = await api.app.exportNote(state.currentId);
    if (res.ok) toast('Exported to ' + res.filePath);
  }

  // ---- preview -------------------------------------------------------------

  function togglePreview(force) {
    state.preview = typeof force === 'boolean' ? force : !state.preview;
    el.previewBtn.classList.toggle('is-on', state.preview);
    el.bodyInput.classList.toggle('hidden', state.preview);
    el.preview.classList.toggle('hidden', !state.preview);
    if (state.preview) renderPreview();
    else el.bodyInput.focus();
  }

  function renderPreview() {
    const raw = window.marked.parse(el.bodyInput.value || '', { gfm: true, breaks: true });
    el.preview.innerHTML = window.DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });
    if (!el.preview.textContent.trim() && !el.preview.querySelector('img')) {
      el.preview.innerHTML = '<p style="color:var(--fg-muted)">Nothing to preview yet.</p>';
    }
    let index = 0;
    el.preview.querySelectorAll('li > input[type="checkbox"], li > p > input[type="checkbox"]').forEach((box) => {
      const li = box.closest('li');
      const i = index++;
      box.disabled = state.current && state.current.trashedAt;
      li.classList.add('task-item');
      li.classList.toggle('is-done', box.checked);
      if (li.parentElement) li.parentElement.classList.add('task-list');
      box.addEventListener('change', () => {
        el.bodyInput.value = H.toggleTaskAt(el.bodyInput.value, i);
        scheduleSave();
        renderPreview();
      });
    });
    el.preview.querySelectorAll('a[href]').forEach((a) => {
      a.addEventListener('click', (e) => { e.preventDefault(); api.app.openExternal(a.getAttribute('href')); });
    });
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
    el.settingsDialog.showModal();
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
    if (key === ' ') key = 'Space';
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
    const inDialog = el.settingsDialog.open;
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
        case 'f': e.preventDefault(); el.searchInput.focus(); el.searchInput.select(); return;
        case 'e': e.preventDefault(); if (state.current) togglePreview(); return;
        case 'p': e.preventDefault(); togglePin(); return;
        case 's': e.preventDefault(); flushSave().then(() => toast('Saved')); return;
        case ',': e.preventDefault(); openSettings(); return;
        case '\\': e.preventDefault(); updateSettings({ sidebarCollapsed: !state.settings.sidebarCollapsed }); return;
        case 'delete': e.preventDefault(); trashCurrent(); return;
        case 'b': if (document.activeElement === el.bodyInput) { e.preventDefault(); wrapSelection('**', '**'); } return;
        case 'i': if (document.activeElement === el.bodyInput) { e.preventDefault(); wrapSelection('_', '_'); } return;
        case 'k': if (document.activeElement === el.bodyInput) { e.preventDefault(); wrapSelection('[', '](url)'); } return;
        default: break;
      }
      if (e.key === 'Backspace') { e.preventDefault(); trashCurrent(); return; }
    }
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
    if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const idx = state.notes.findIndex((n) => n.id === state.currentId);
      const next = state.notes[idx + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) selectNote(next.id).then(() => el.bodyInput.focus());
    }
  }

  // ---- wiring --------------------------------------------------------------

  function bind() {
    el.newNoteBtn.addEventListener('click', newNote);
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
      if (e.key === 'Enter' && state.notes.length) { selectNote(state.notes[0].id).then(() => el.bodyInput.focus()); }
      if (e.key === 'ArrowDown' && state.notes.length) { e.preventDefault(); selectNote(state.notes[0].id).then(() => el.bodyInput.focus()); }
    });
    el.sortSelect.addEventListener('change', () => updateSettings({ sort: el.sortSelect.value }).then(() => refresh({ keepEditor: true })));
    el.emptyTrashBtn.addEventListener('click', emptyTrash);

    el.pinBtn.addEventListener('click', togglePin);
    el.previewBtn.addEventListener('click', () => togglePreview());
    el.exportBtn.addEventListener('click', exportCurrent);
    el.duplicateBtn.addEventListener('click', duplicateCurrent);
    el.restoreBtn.addEventListener('click', restoreCurrent);
    el.deleteBtn.addEventListener('click', trashCurrent);
    el.destroyBtn.addEventListener('click', destroyCurrent);

    el.titleInput.addEventListener('input', scheduleSave);
    el.tagsInput.addEventListener('input', scheduleSave);
    el.bodyInput.addEventListener('input', scheduleSave);
    el.titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.bodyInput.focus(); } });
    el.tagsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.bodyInput.focus(); } });
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
      const res = await api.app.importMarkdown();
      if (res.ok) { el.settingsDialog.close(); await refresh({ keepEditor: true }); if (res.firstId) await selectNote(res.firstId); toast('Imported ' + res.count + (res.count === 1 ? ' note' : ' notes')); }
    });
    el.exportAllBtn.addEventListener('click', async () => { const res = await api.app.exportAll(); if (res.ok) toast('Exported to ' + res.filePath); });
    el.dataFolderBtn.addEventListener('click', () => api.app.openDataFolder());
    el.settingsDialog.addEventListener('close', () => { if (state.current) el.bodyInput.focus(); });

    // Main-process events
    api.on.shown(async () => {
      if (el.settingsDialog.open) return;
      if (state.current) {
        (state.current.title || state.current.body ? el.bodyInput : el.titleInput).focus();
      } else if (state.notes.length) {
        await selectNote(state.notes[0].id);
        el.bodyInput.focus();
      } else {
        await newNote();
      }
    });
    api.on.newNote(newNote);
    api.on.settingsChanged((s) => applySettings(s));
    api.on.systemTheme((t) => { state.systemDark = t === 'dark'; document.documentElement.dataset.theme = effectiveTheme(); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (ev) => { state.systemDark = ev.matches; document.documentElement.dataset.theme = effectiveTheme(); });

    // Keep "x min ago" labels honest.
    setInterval(() => { if (!document.hidden) { renderList(); if (state.current) updateStatus(state.current); } }, 60000);
  }

  async function init() {
    const [settings, info] = await Promise.all([api.settings.get(), api.app.info()]);
    applySettings(settings);
    applyInfo(info);
    bind();
    await refresh();
    if (state.current) el.bodyInput.focus();
  }

  window.addEventListener('error', (e) => console.error('Uncaught: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('Unhandled rejection: ' + (e.reason && e.reason.message || e.reason)));

  init().catch((err) => {
    console.error(err);
    toast('Something went wrong starting Notes: ' + err.message);
  });
})();
