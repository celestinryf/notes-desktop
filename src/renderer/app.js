/* Renderer: vanilla JS, talks to the main process through window.notesApi (see preload.js). */
import H from '../shared/helpers.js';
import NotesThemes from '../shared/themes.js';
import NotesIcons from './icons.js';
import { NotesPalette } from './palette.js';
import { NotesPdfEditor } from './pdf-editor.js';
import { NotesPdfPages } from './pdf-pages.js';
import { NotesPdfComments } from './pdf-comments.js';
import { NotesDocxEditor } from './docx-editor.js';
import { NotesCraftFrame } from './craft-frame.js';
import { NotesCsv } from './csv-view.js';
import { NotesSignPad } from './sign-pad.js';
import { I, el, setLabel, setIcon, setPressed } from './dom.js';
import { state, lockedNow } from './state.js';
import { find } from './find-state.js';
import { escapeHtml, highlight, ipcErrorText } from './text.js';
import { toast } from './toast.js';
import { setActivity } from './activity.js';
import { bookMark, treeGroup, treeFocusKey, restoreTreeFocus, bindTreeKeys } from './tree.js';
import { placePopover } from './popover.js';
import { openMoreMenu, closeMoreMenu, bindMenuKeys } from './more-menu.js';
import { createBooks } from './books.js';
import { createRelated } from './related.js';
import { createReminders } from './reminders.js';
import { quickPick } from './remind-times.js';
import { withPeerNotice } from './peer-notice.js';
import { createLiveShare } from './live-share.js';
import { createSharing } from './sharing.js';
import { createStickyButton } from './sticky-button.js';
import { createBotPanel } from './bot-panel.js';
import { createCodeEditor, src, renderCodePosition } from './code-editor.js';
import { createEditorView, tableShown, focusBody, inTextField, bodyHasFocus, autoGrow } from './editor-view.js';
import { createVaultsPanel } from './vaults-panel.js';
import { createLocking } from './locking.js';
import { createAttachments } from './attachments.js';
import { createHistoryDialog } from './history-dialog.js';
import { createSpeech } from './speech.js';
import { currentHtml } from './note-html.js';
import { createFindBar } from './find-bar.js';
import { oneAtATime } from './one-at-a-time.js';
import { createPdfNote } from './pdf-note.js';
import { createCraftNotes } from './craft-notes.js';
import { createWordNote } from './word-note.js';
import { createImages } from './images.js';
import { createConvertMenu } from './convert-menu.js';
import { createEditorText } from './editor-text.js';

(function () {
  'use strict';

  const api = withPeerNotice(window.notesApi, peerChanged);
  const { isViewerOnlyFile, isPlainTextFile, isNonMarkdownFile } = H;

  // ---- theme & settings ----------------------------------------------------

  function effectiveTheme(settings) {
    const s = settings || state.settings;
    const t = s ? s.theme : 'system';
    if (t === 'light' || t === 'dark') return t;
    return state.systemDark ? 'dark' : 'light';
  }

  // Shows a theme and colour scheme on the page: the saved settings, or the Settings dialog's unsaved draft.
  function applyTheme(settings) {
    const theme = effectiveTheme(settings);
    document.documentElement.dataset.theme = theme;
    applyColorScheme(theme, settings || state.settings);
    syncTitleBar();
  }

  // A colour scheme other than the built-in one (styles.css) sets its tokens on the page (src/shared/themes.js); the
  // built-in one clears them, so the stylesheet's own colours show.
  function applyColorScheme(mode, settings) {
    const tokens = NotesThemes.resolve(settings, mode);
    const style = document.documentElement.style;
    for (const name of NotesThemes.TOKENS) {
      if (tokens) style.setProperty('--' + name, tokens[name]);
      else style.removeProperty('--' + name);
    }
  }

  function applySettings(settings, opts) {
    state.settings = settings;
    applyTheme();
    document.documentElement.style.setProperty('--editor-font-size', settings.fontSize + 'px');
    applySidebar();
    el.tagList.classList.toggle('hidden', !!settings.tagsCollapsed);
    el.tagsFold.setAttribute('aria-expanded', String(!settings.tagsCollapsed));
    el.tagsFold.classList.toggle('is-folded', !!settings.tagsCollapsed);
    syncListCollapsed();
    el.sortSelect.value = settings.sort;
    applyPaneWidths(settings.sidebarWidth, settings.listWidth);
    applyEditorLayout(settings);
    if (el.settingsDialog.open && settingsDirty()) previewSettings(); // the dialog's draft stays on top of what was saved
    if (opts && opts.fromPeer) return; // the other side's Ctrl+E is for the note it shows
    // A note flagged as lossy stays in source whatever the global preference, unless the user overrode it; a
    // plain-text file always does.
    if (H.isTableFile(state.current)) return; // a CSV keeps its own view (table or text) whatever the Markdown setting
    const forcedSource = (state.currentLossless === false && state.lossyOverride !== state.currentId) || !state.rich || isPlainTextFile(state.current);
    const wantSource = settings.editorMode === 'source' || forcedSource;
    if (wantSource !== state.sourceMode) applyEditorMode(wantSource);
  }

  // The window draws its own caption buttons (minimise, maximise, close) over the top-right corner. Paint them in
  // the colour of what is under them, and tell the CSS how wide they are so nothing hides beneath them.
  function syncTitleBar() {
    if (GUEST) return;
    const css = getComputedStyle(document.documentElement);
    const color = css.getPropertyValue('--base').trim(); // the top bar (and the reader's bar) are --base
    const symbol = css.getPropertyValue('--fg').trim();
    const wco = navigator.windowControlsOverlay;
    const rect = wco && wco.visible ? wco.getTitlebarAreaRect() : null;
    const w = rect ? Math.max(0, Math.round(window.innerWidth - rect.x - rect.width)) : 0;
    const key = color + symbol + w + hasPeer();
    if (key === titleBarKey) return;
    titleBarKey = key;
    if (api.app.titleBar) api.app.titleBar({ color, symbol }).catch(() => {});
    document.documentElement.style.setProperty('--caption-w', w + 'px');
    if (hasPeer()) toPeer({ type: 'caption', w });
  }
  let titleBarKey = '';

  function applyEditorLayout(settings) {
    el.editorColumn.classList.remove('align-left', 'align-center', 'align-right');
    el.editorColumn.classList.add('align-' + settings.editorAlign);
    el.editorColumn.classList.toggle('full-width', !settings.editorWidth);
    el.editorColumn.style.setProperty('--editor-col-width', (settings.editorWidth || 760) + 'px');
  }

  // ---- resizable panes -----------------------------------------------------

  // The sidebar is docked (it takes its column) or hidden, as Zen's compact mode does it: out of the way until the
  // pointer reaches the window's left edge, then floating over the page with a small margin. The toggle (Ctrl+\)
  // hides and docks it. A window too narrow to dock it hides it the same way (layout, not a setting: widening the
  // window docks it again).
  // The pane toggles live in the sidebar's header while it is docked, and move to the start of the top bar when it
  // hides, so they can always be reached (as Obsidian does).
  const NARROW_W = 1000;
  const PEEK_EDGE_PX = 24; // how close to the left edge the pointer must come for the hidden sidebar to float in
  let sidebarPeek = null; // hidden but shown: 'hover' (leaves with the pointer) or 'sticky' (until Esc or a click outside)
  let peekTimer = null;
  const isNarrow = () => window.innerWidth < NARROW_W;
  function sidebarLayout() {
    if (state.settings && state.settings.sidebarCollapsed) return 'float';
    return isNarrow() ? 'float' : 'docked';
  }
  // Hidden from the grid: the sidebar takes no column.
  function sidebarHidden() { return sidebarLayout() !== 'docked'; }
  function applySidebar() {
    const layout = sidebarLayout();
    if (layout !== 'float') sidebarPeek = null;
    el.app.classList.toggle('sidebar-collapsed', layout !== 'docked');
    el.app.classList.toggle('sidebar-float', layout === 'float');
    el.app.classList.toggle('sidebar-peek', layout === 'float' && !!sidebarPeek);
    el.toggleSidebarBtn.classList.toggle('is-on', layout === 'docked');
    el.toggleSidebarBtn.title = layout === 'docked' ? 'Hide the sidebar (Ctrl+\\). Point at the window\u2019s left edge to bring it back.' : 'Show the sidebar (Ctrl+\\)';
    const home = layout === 'docked' ? el.sidebarTop : el.tabBar;
    if (el.barToggles.parentElement !== home) home.prepend(el.barToggles);
  }
  function peekSidebar(how) {
    if (GUEST || sidebarLayout() !== 'float') return;
    clearTimeout(peekTimer);
    if (sidebarPeek === 'sticky' && how === 'hover') return;
    const fromKeyboard = how === 'sticky' && !el.sidebar.contains(document.activeElement);
    sidebarPeek = how;
    applySidebar();
    if (fromKeyboard) {
      peekReturn = document.activeElement;
      const target = el.sidebar.querySelector('.nav-item.is-active, .folder-row.is-active') || el.newNoteBtn;
      // Not over a name field the same call just opened (Ctrl+Shift+N): moving focus would cancel it.
      setTimeout(() => { if (!state.editingFolder && !el.sidebar.contains(document.activeElement)) target.focus(); }, 0);
    }
  }
  let peekReturn = null;
  function unpeekSidebar() {
    clearTimeout(peekTimer);
    if (!sidebarPeek) return;
    sidebarPeek = null;
    applySidebar();
    const back = peekReturn;
    peekReturn = null;
    if (el.sidebar.contains(document.activeElement)) {
      if (back && back.isConnected && !el.sidebar.contains(back)) back.focus();
      else if (state.current) focusBody();
    }
  }
  // Something needs the sidebar on screen (a new folder's name field lives there): float it in.
  function showSidebar() {
    if (sidebarLayout() === 'float') peekSidebar('sticky');
  }
  // The toggle and Ctrl+\: dock or hide. In a window too narrow to dock it, it floats in and out instead.
  function toggleSidebar() {
    if (GUEST) { toPeer({ type: 'command', name: 'toggleSidebar' }); return; }
    // Too narrow to dock: the toggle floats it in and out, and the saved choice stays as it is.
    if (isNarrow()) { if (sidebarPeek) unpeekSidebar(); else peekSidebar('sticky'); return; }
    const collapsed = !!state.settings.sidebarCollapsed;
    sidebarPeek = null;
    updateSettings({ sidebarCollapsed: !collapsed });
  }
  function bindSidebarFloat() {
    if (GUEST) return;
    // Stay while something in it is still being used: a name being typed, or its folder menu.
    const busy = () => state.editingFolder || state.menuFolderId || document.body.classList.contains('is-resizing')
      || (el.sidebar.contains(document.activeElement) && document.activeElement.matches('input, textarea, select'));
    // The hover zone is measured from the pointer, not from an element, so nothing under it goes dead: the edge strip
    // stays narrow and only catches a drag. Nearness is the x position alone (a sidebar sliding in or out under the
    // pointer is the target of moves meanwhile); near the edge or over the sidebar, it stays, whatever order the events come in.
    let nearEdge = false;
    const leaveSoon = () => {
      clearTimeout(peekTimer);
      peekTimer = setTimeout(function check() {
        if (sidebarPeek !== 'hover' || nearEdge || el.sidebar.matches(':hover')) return;
        if (busy()) { peekTimer = setTimeout(check, 500); return; }
        unpeekSidebar();
      }, 350);
    };
    document.addEventListener('mousemove', (e) => {
      const overSidebar = el.sidebar.contains(e.target);
      const near = e.clientX <= PEEK_EDGE_PX;
      // While near and still hidden, every move re-arms the short wait: a sidebar that could not float in a moment
      // ago (the layout was still changing) floats in on the next move, not only after leaving and coming back.
      if (near && !sidebarPeek) { clearTimeout(peekTimer); peekTimer = setTimeout(() => peekSidebar('hover'), 90); }
      if (near === nearEdge) return;
      nearEdge = near;
      if (near || overSidebar) return;
      if (sidebarPeek === 'hover') leaveSoon();
      else if (!sidebarPeek) clearTimeout(peekTimer);
    });
    el.sidebarEdge.addEventListener('dragenter', () => peekSidebar('hover'));
    el.sidebar.addEventListener('mouseenter', () => { if (sidebarPeek === 'hover') clearTimeout(peekTimer); });
    el.sidebar.addEventListener('mouseleave', () => { if (sidebarPeek === 'hover') leaveSoon(); });
    document.addEventListener('pointerdown', (e) => {
      if (!sidebarPeek || el.sidebar.contains(e.target) || el.sidebarEdge.contains(e.target) || el.barToggles.contains(e.target) || el.folderMenu.contains(e.target)) return;
      unpeekSidebar();
    }, true);
  }

  function paneBudget() {
    // Space the two left panes may share while the editor keeps its minimum width.
    return Math.max(0, window.innerWidth - H.EDITOR_MIN);
  }

  function fitPaneWidths(sidebar, list) {
    sidebar = H.clampPane('sidebarWidth', sidebar);
    list = H.clampPane('listWidth', list);
    const sidebarShown = sidebarHidden() ? 0 : sidebar;
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
    toPeer({ type: 'settings', settings: res.settings });
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
    const wantTree = state.settings.listMode === 'tree' && !state.query && (state.view === 'all' || state.view === 'folder');
    const [notes, counts, tags, tree, folderPath, outline] = await Promise.all([
      api.notes.list(listOpts), api.notes.counts(), api.notes.tags(), api.folders.tree(),
      state.view === 'folder' ? api.folders.path(state.folderId) : Promise.resolve([]),
      wantTree ? api.notes.outline(state.settings.sort) : Promise.resolve(null),
    ]);
    state.notes = notes;
    state.outline = outline;
    state.tree = tree;
    state.folderPath = folderPath;
    if (state.view === 'folder' && !folderPath.length) {
      // The folder we were looking at is gone; fall back to all notes, and stop starting in it.
      state.view = 'all'; state.folderId = null;
      if (state.settings.lastFolderId && !GUEST) updateSettings({ lastFolderId: null }).catch(() => {});
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
    const inList = treeModeActive() ? inTreeScope(state.currentId) : notes.some((n) => n.id === state.currentId);
    if (!inList && !opts.keepEditor) {
      const tabId = tabs.ids[tabs.at];
      if (!state.currentId && tabId) await selectNote(tabId); // this side's tab, at start or after its note closed
      else if (GUEST) { /* the right side has no list: it shows only the notes it is asked to */ }
      else if (tabs.split && tabs.active === 'right') {
        // The list leads the active side: a new view opens its first note there, unless that side shows one of its notes.
        if (notes.length && !notes.some((n) => n.id === tabs.peerCurrent)) openNote(notes[0].id);
      } else if (notes.length) await selectNote(notes[0].id);
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
    for (const b of [el.countPinned, el.countTrash, el.countReminders]) b.classList.toggle('is-zero', b.textContent === '0');
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
    const tree = treeModeActive();
    el.noteList.innerHTML = '';
    const empty = tree ? !treeHasContent() : !state.notes.length;
    el.noteList.classList.toggle('hidden', tree || empty); // an empty list would still take the pane and push the empty state down
    el.noteTree.classList.toggle('hidden', !tree || empty);
    el.listModeSeg.classList.toggle('hidden', !treeModePossible());
    syncListModeSeg();
    el.listEmpty.classList.toggle('hidden', !empty);
    if (empty) renderListEmpty();
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
    if (tree) { renderNoteTree(); return; }
    const viewingBook = state.view === 'folder' && !!(flattenTree(state.tree).find((x) => x.id === state.folderId) || {}).book;
    const frag = document.createDocumentFragment();
    state.notes.forEach((n, i) => {
      const li = document.createElement('li');
      li.className = 'note-row' + (n.id === state.currentId ? ' is-active' : '');
      li.dataset.id = n.id;
      li.setAttribute('role', 'option');
      li.title = H.deriveTitle(n);
      li.innerHTML = rowInner(n, q);
      if (viewingBook && !q) { const no = document.createElement('span'); no.className = 'page-no'; no.textContent = 'p. ' + (i + 1); li.prepend(no); }
      // Ctrl+click or middle-click opens the note in a new tab.
      li.addEventListener('click', (e) => openNote(n.id, { newTab: e.ctrlKey || e.metaKey }));
      li.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); openNote(n.id, { newTab: true }); } });
      if (!n.trashedAt) {
        li.draggable = true;
        li.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/x-note-id', n.id);
          e.dataTransfer.effectAllowed = 'move';
          li.classList.add('is-dragging');
          toPeer({ type: 'drag', id: n.id }); // it can be dropped on the right side's tabs
        });
        li.addEventListener('dragend', () => { li.classList.remove('is-dragging'); toPeer({ type: 'drag', id: null }); });
      }
      frag.append(li);
    });
    el.noteList.append(frag);
  }

  function treeHasContent() {
    const out = state.outline || {};
    if (state.view !== 'folder') return state.tree.length > 0 || (out[''] || []).length > 0;
    const node = flattenTree(state.tree).find((f) => f.id === state.folderId);
    return !!node && (node.children.length > 0 || (out[node.id] || []).length > 0);
  }

  function renderListEmpty() {
    const [title, sub] = state.query ? ['No matches', 'Nothing in this list has "' + state.query + '". Ctrl+P searches everything.']
      : state.view === 'trash' ? ['Trash is empty', 'Notes you delete wait here until you empty the trash.']
      : state.view === 'pinned' ? ['Nothing pinned', 'Pin a note (Ctrl+D) to keep it at the top.']
      : state.view === 'reminders' ? ['No reminders', 'Set one from a note\u2019s More menu, or press Ctrl+Shift+M.']
      : state.view === 'tag' ? ['No notes with this tag', '']
      : state.view === 'folder' ? ['This folder is empty', 'Press Ctrl+N to write a note here.']
      : ['No notes yet', 'Press Ctrl+N to write your first note.'];
    el.listEmpty.querySelector('.empty-title').textContent = title;
    el.listEmpty.querySelector('.empty-sub').textContent = sub;
  }

  function reminderMark(n) {
    if (!n.remindAt || n.trashedAt) return '';
    const overdue = n.remindAt <= Date.now();
    return '<span class="row-meta remind-mark' + (overdue ? ' is-overdue' : '') + '" title="' + (overdue ? 'Reminder went off' : 'Reminder') + '">' + I('bell') + escapeHtml(H.formatWhen(n.remindAt)) + '</span>';
  }

  // One renderer for a note row's contents, shared by the list, the folder view and single-row refreshes, so the
  // pin, sticky, lock, live, file and reminder marks never disappear after a save. The row is the title; everything
  // else trails it as a small mark (the user: "just the titles", 2026-10-19). Takes a note or an outline entry.
  function rowInner(n, q) {
    const title = n.body === undefined ? n.title : H.deriveTitle(n); // outline entries carry a derived title already
    const fileMark = n.filePath ? '<span class="file-mark" title="' + escapeHtml(n.filePath) + '">' + escapeHtml(fileBadge(n)) + '</span>' : '';
    const marks = (n.pinned ? '<span class="row-mark pin" title="Pinned">' + I('star') + '</span>' : '')
      + (n.sticky ? '<span class="row-mark sticky-mark" title="On the desktop as a sticky">' + I('sticky-note') + '</span>' : '')
      + (n.locked ? '<span class="row-mark lock-mark" title="' + (n.unlocked ? 'Locked (unlocked for now)' : 'Locked') + '">' + I(n.unlocked ? 'lock-open' : 'lock') + '</span>' : '')
      + (n.live ? '<span class="row-mark live-mark" title="Live share' + (n.live.role ? ' (' + n.live.role + ')' : '') + '">' + I('radio') + '</span>' : '');
    // In search results a note whose title does not carry the match shows the matching text, dimmed, so the row says why it is there.
    const inTitle = !q || H.tokenize(q).some((t) => title.toLowerCase().includes(t));
    const why = inTitle || (n.locked && !n.unlocked) ? '' : '<span class="row-meta match">' + highlight(matchExcerpt(n, q), q) + '</span>';
    return '<span class="row-name">' + highlight(title, q) + '</span>' + why + marks + fileMark + reminderMark(n) + whereMark(n);
  }

  // The text around the first word of the query in the note's body (or its tags), on one line, about 80 characters.
  function matchExcerpt(n, q) {
    const body = String(n.body || '').replace(/\s+/g, ' ');
    const low = body.toLowerCase();
    const at = H.tokenize(q).map((t) => low.indexOf(t)).filter((i) => i !== -1).sort((a, b) => a - b)[0];
    if (at === undefined) return (n.tags || []).filter((t) => H.tokenize(q).some((w) => t.toLowerCase().includes(w))).map((t) => '#' + t).join(' ') || H.snippet(n, 80);
    const start = Math.max(0, at - 30);
    let text = body.slice(start, start + 80);
    if (start > 0) text = '…' + text.replace(/^\S*\s/, '');
    if (start + 80 < body.length) text = text.replace(/\s\S*$/, '') + '…';
    return text;
  }

  // The folder a note is in, dimmed at the row's end, only where the folder is not already on screen.
  function whereMark(n) {
    if (!n.folderId || treeModeActive() || (state.view === 'folder' && !state.query)) return '';
    const f = flattenTree(state.tree).find((x) => x.id === n.folderId);
    return f ? '<span class="row-meta where">' + I(f.book ? 'book-open' : 'folder') + escapeHtml(f.name) + '</span>' : '';
  }

  function refreshRow(note) {
    if (tabs.ids.includes(note.id)) { tabs.titles.set(note.id, H.deriveTitle(note)); renderActiveTabTitle(); }
    if (state.outline) {
      const title = H.deriveTitle(note);
      for (const list of Object.values(state.outline)) { const e = list.find((x) => x.id === note.id); if (e) { e.title = title; e.pinned = !!note.pinned; } }
      const row = el.noteTree.querySelector('.tree-note[data-id="' + note.id + '"]');
      if (row) { row.innerHTML = '<span class="tree-spacer" aria-hidden="true"></span>' + rowInner(note, ''); row.title = title; }
    }
    const li = el.noteList.querySelector('.note-row[data-id="' + note.id + '"]');
    if (!li) return;
    const pageNo = li.querySelector('.page-no');
    li.innerHTML = rowInner(note, state.query);
    li.title = H.deriveTitle(note);
    if (pageNo) li.prepend(pageNo);
  }

  // ---- views ---------------------------------------------------------------

  async function setView(view, arg, refreshOpts) {
    await flushSave();
    state.view = view;
    state.tag = view === 'tag' ? arg : null;
    state.folderId = view === 'folder' ? arg : null;
    el.navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    // Remember the folder so the app starts in it next time.
    if (!GUEST && (state.settings.lastFolderId || null) !== state.folderId) updateSettings({ lastFolderId: state.folderId }).catch(() => {});
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

  function folderParents() {
    const m = new Map();
    for (const f of flattenTree(state.tree)) m.set(f.id, f.parentId || null);
    return m;
  }
  // A folder and its ancestors, outermost first.
  function pathTo(id) {
    const parents = folderParents();
    const out = [];
    for (let x = id; x && parents.has(x) && out.length < 200; x = parents.get(x)) out.unshift(x);
    return out;
  }
  // The sidebar opens one folder path at a time (the user's rule): the newest folder opened and the folders around it.
  // Older settings could hold several open branches; only the newest one counts, and only as far down as it is open.
  function expandedSet() {
    const list = (state.settings && state.settings.expandedFolders) || [];
    if (!list.length) return new Set();
    const open = new Set();
    for (const id of pathTo(list[list.length - 1])) { if (!list.includes(id)) break; open.add(id); }
    return open;
  }

  async function setExpanded(id, open) {
    let next;
    if (open) next = pathTo(id);
    else {
      const cur = Array.from(expandedSet());
      const i = cur.indexOf(id);
      next = i >= 0 ? cur.slice(0, i) : cur; // closing a folder closes what is open inside it
    }
    await updateSettings({ expandedFolders: next });
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
    const refocus = treeFocusKey(el.folderTree);
    el.folderTree.innerHTML = '';
    if (!state.tree.length && !(editing && editing.mode === 'create' && !editing.parentId)) {
      const d = document.createElement('div');
      d.className = 'folders-empty';
      d.textContent = 'No folders yet. Press + to make one.';
      el.folderTree.append(d);
      return;
    }
    // The branch holding the folder on show draws its guide lines darker, so you can see where you are.
    const here = new Set(state.view === 'folder' ? pathTo(state.folderId) : []);
    const holding = state.current && state.current.folderId ? state.current.folderId : null;
    for (const id of holding ? pathTo(holding) : []) here.add(id);
    const addRow = (node, into) => {
      const kids = node.children.length > 0;
      const isOpen = kids && open.has(node.id);
      const row = document.createElement('div');
      row.className = 'folder-row tree-row' + (state.view === 'folder' && state.folderId === node.id ? ' is-active' : '') + (node.id === holding ? ' holds-note' : '');
      row.dataset.id = node.id;
      row.dataset.key = 'f:' + node.id;
      row.style.setProperty('--depth', node.depth);
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(node.depth + 1));
      if (kids) row.setAttribute('aria-expanded', String(isOpen));
      row.setAttribute('aria-selected', String(row.classList.contains('is-active')));
      row.tabIndex = -1;
      row.draggable = !(editing && editing.mode === 'rename' && editing.id === node.id);
      row._toggle = kids ? (on) => setExpanded(node.id, on) : null;

      const chevron = document.createElement('button');
      chevron.className = 'folder-chevron' + (kids ? (isOpen ? ' is-open' : '') : ' is-leaf');
      chevron.tabIndex = -1;
      chevron.innerHTML = I('chevron-right');
      chevron.title = isOpen ? 'Collapse' : 'Expand';
      chevron.setAttribute('aria-label', chevron.title);
      chevron.addEventListener('click', (e) => { e.stopPropagation(); setExpanded(node.id, !isOpen); });
      row.append(chevron);

      if (editing && editing.mode === 'rename' && editing.id === node.id) {
        row.append(folderInput(node.name, (value) => commitFolderEdit(value)));
      } else {
        const name = document.createElement('span');
        name.className = 'row-name';
        name.textContent = node.name;
        name.title = node.name;
        row.append(name);
        if (node.book) row.insertAdjacentHTML('beforeend', bookMark());
        if (node.isVaultRoot) {
          const st = state.vaultStatus[node.vaultId] || {};
          const badge = document.createElement('span');
          badge.className = 'vault-badge' + (st.syncing ? ' is-syncing' : '') + (st.lastError || st.conflict ? ' is-error' : '');
          badge.innerHTML = I(st.isRepo ? 'refresh-cw' : 'folder-open');
          badge.title = st.isRepo ? ('git' + (st.remote ? ' · ' + st.remote : ' · no remote') + (st.lastError ? '\n' + st.lastError : '')) : 'Folder vault (no git)';
          row.append(badge);
        }
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = node.count;
        row.append(count);
        const menu = document.createElement('button');
        menu.className = 'folder-menu-btn';
        menu.tabIndex = -1;
        menu.innerHTML = I('ellipsis');
        menu.title = 'Folder actions';
        menu.setAttribute('aria-label', 'Folder actions for ' + node.name);
        menu.addEventListener('click', (e) => { e.stopPropagation(); openFolderMenu(node.id, menu); });
        row.append(menu);
      }

      // Showing a folder also opens it (and so closes any other open branch): one path at a time.
      row.addEventListener('click', () => {
        if (editing && editing.id === node.id) return;
        if (kids && !isOpen) setExpanded(node.id, true);
        setView('folder', node.id);
      });
      row.addEventListener('dblclick', (e) => { if (!e.target.closest('.folder-input')) { e.preventDefault(); startRename(node.id); } });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); openFolderMenu(node.id, row, e); });
      wireDropTarget(row, node.id);
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-folder-id', node.id);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('is-dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      into.append(row);

      const creatingHere = editing && editing.mode === 'create' && editing.parentId === node.id;
      if (isOpen || creatingHere) {
        const group = treeGroup(node.depth, here.has(node.id));
        if (creatingHere) group.append(createRow(node.depth + 1));
        if (isOpen) node.children.forEach((c) => addRow(c, group));
        into.append(group);
      }
    };
    const createRow = (depth) => {
      const row = document.createElement('div');
      row.className = 'folder-row is-active';
      row.style.setProperty('--depth', depth);
      row.append(document.createElement('span'));
      row.firstChild.className = 'folder-chevron is-leaf';
      row.append(folderInput('', (value) => commitFolderEdit(value)));
      if (editing.book) row.insertAdjacentHTML('beforeend', bookMark());
      return row;
    };
    const frag = document.createDocumentFragment();
    if (editing && editing.mode === 'create' && !editing.parentId) frag.append(createRow(0));
    state.tree.forEach((n) => addRow(n, frag));
    el.folderTree.append(frag);
    const input = el.folderTree.querySelector('.folder-input');
    if (input) { input.focus(); input.select(); }
    else restoreTreeFocus(el.folderTree, refocus);
  }

  // ---- the middle pane as folders with their notes ("Note list: Folders" in Settings) ----
  // Only where a tree means something: all notes, or one folder. Pinned, reminders, trash, tags and searches stay lists.

  function treeModePossible() {
    return !state.query && (state.view === 'all' || state.view === 'folder');
  }
  function treeModeActive() {
    return !!state.settings && state.settings.listMode === 'tree' && treeModePossible();
  }
  // Is the note somewhere in what the tree shows? (In a folder view the tree also shows its subfolders' notes.)
  function inTreeScope(noteId) {
    const out = state.outline || {};
    const scope = state.view === 'folder' ? state.folderId : null;
    const ids = scope ? new Set([scope, ...flattenTree((flattenTree(state.tree).find((f) => f.id === scope) || { children: [] }).children).map((f) => f.id)]) : null;
    for (const [folder, notes] of Object.entries(out)) {
      if (ids && !ids.has(folder)) continue;
      if (notes.some((n) => n.id === noteId)) return true;
    }
    return false;
  }

  // The open note's headings, for its outline in the tree. Skips code fences; the text loses its Markdown marks.
  function headingsOf(md) {
    const out = [];
    let fence = false;
    for (const line of String(md || '').split(/\r?\n/)) {
      if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
      if (fence) continue;
      const m = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
      if (m) out.push({ level: m[1].length, text: m[2].replace(/\*\*|__(?=\S)|(?<=\S)__|[*`]|~~|\[([^\]]*)\]\([^)]*\)/g, (x, t) => t || '').trim() });
    }
    return out;
  }

  function currentHeadings() {
    const n = state.current;
    if (!n || n.locked || isNonMarkdownFile(n)) return [];
    if (!state.sourceMode && state.rich) {
      return Array.from(el.richEditor.querySelectorAll('.rich-editor-content :is(h1, h2, h3, h4, h5, h6)')).slice(0, 60)
        .map((h) => ({ level: Number(h.tagName.slice(1)), text: h.textContent.trim() })).filter((h) => h.text);
    }
    const md = state.currentId === n.id ? el.bodyInput.value : n.body;
    return headingsOf(md).slice(0, 60);
  }

  // Jumps to the i-th heading of the open note, in whichever view is showing.
  function jumpToHeading(i) {
    if (state.sourceMode) {
      const lines = el.bodyInput.value.split('\n');
      let fence = false, count = -1, at = 0;
      for (const line of lines) {
        if (/^\s*(```|~~~)/.test(line)) fence = !fence;
        else if (!fence && /^\s{0,3}#{1,6}\s+\S/.test(line) && ++count === i) break;
        at += line.length + 1;
      }
      src.focus();
      src.setSelectionRange(at, at);
      src.reveal(at);
      return;
    }
    const h = el.richEditor.querySelectorAll('.rich-editor-content :is(h1, h2, h3, h4, h5, h6)')[i];
    if (h) h.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function renderNoteTree() {
    const root = el.noteTree;
    const refocus = treeFocusKey(root);
    root.innerHTML = '';
    const out = state.outline || {};
    const open = new Set(state.settings.treeExpanded || []);
    const scopeId = state.view === 'folder' ? state.folderId : null;
    const scopeNode = scopeId ? flattenTree(state.tree).find((f) => f.id === scopeId) : null;
    const here = new Set(state.current && state.current.folderId ? pathTo(state.current.folderId) : []);
    const heads = currentHeadings();
    const minLevel = heads.length ? Math.min(...heads.map((h) => h.level)) : 1;
    const setOpen = (id, on) => {
      const next = new Set(state.settings.treeExpanded || []);
      if (on) next.add(id); else next.delete(id);
      updateSettings({ treeExpanded: Array.from(next) }).then(renderNoteTree);
    };

    const noteRow = (n, depth, into) => {
      const row = document.createElement('div');
      const active = n.id === state.currentId;
      row.className = 'tree-row tree-note note-row' + (active ? ' is-active' : '');
      row.dataset.id = n.id;
      row.dataset.key = 'n:' + n.id;
      row.style.setProperty('--depth', depth);
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(depth + 1));
      row.setAttribute('aria-selected', String(active));
      row.tabIndex = -1;
      row.innerHTML = '<span class="tree-spacer" aria-hidden="true"></span>' + rowInner(n, '');
      row.title = n.title;
      row.addEventListener('click', (e) => openNote(n.id, { newTab: e.ctrlKey || e.metaKey }));
      row.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); openNote(n.id, { newTab: true }); } });
      row.draggable = true;
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-note-id', n.id); e.dataTransfer.effectAllowed = 'move'; row.classList.add('is-dragging'); toPeer({ type: 'drag', id: n.id }); });
      row.addEventListener('dragend', () => { row.classList.remove('is-dragging'); toPeer({ type: 'drag', id: null }); });
      into.append(row);
      // The open note's outline, as Google Docs shows it: its headings, indented by level; a click goes there.
      if (active && heads.length > 1) {
        const group = treeGroup(depth, true);
        group.classList.add('tree-outline');
        heads.forEach((h, i) => {
          const hr = document.createElement('div');
          hr.className = 'tree-row tree-heading';
          hr.dataset.key = 'h:' + n.id + ':' + i;
          hr.style.setProperty('--depth', depth + 1 + (h.level - minLevel));
          hr.setAttribute('role', 'treeitem');
          hr.setAttribute('aria-level', String(depth + 2 + (h.level - minLevel)));
          hr.tabIndex = -1;
          hr.innerHTML = '<span class="tree-spacer" aria-hidden="true"></span><span class="row-name"></span>';
          hr.querySelector('.row-name').textContent = h.text;
          hr.title = h.text;
          hr.addEventListener('click', () => jumpToHeading(i));
          group.append(hr);
        });
        into.append(group);
      }
    };

    const folderRow = (node, depth, into) => {
      const notes = out[node.id] || [];
      const kids = node.children.length + notes.length > 0;
      const isOpen = kids && (open.has(node.id) || here.has(node.id) && state.revealInTree === state.currentId);
      const row = document.createElement('div');
      row.className = 'tree-row tree-folder' + (here.has(node.id) ? ' is-here' : '');
      row.dataset.id = node.id;
      row.dataset.key = 'f:' + node.id;
      row.style.setProperty('--depth', depth);
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(depth + 1));
      if (kids) row.setAttribute('aria-expanded', String(isOpen));
      row.tabIndex = -1;
      row._toggle = kids ? (on) => setOpen(node.id, on) : null;
      row.innerHTML = '<span class="tree-chevron' + (isOpen ? ' is-open' : '') + (kids ? '' : ' is-leaf') + '" aria-hidden="true">' + I('chevron-right') + '</span>'
        + '<span class="row-name"></span>' + (node.book ? bookMark() : '') + '<span class="count"></span>';
      row.querySelector('.row-name').textContent = node.name;
      row.querySelector('.count').textContent = node.count || '';
      row.title = node.name;
      row.addEventListener('click', () => { if (kids) setOpen(node.id, !isOpen); });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); openFolderMenu(node.id, row, e); });
      wireDropTarget(row, node.id);
      into.append(row);
      if (isOpen) {
        const group = treeGroup(depth, here.has(node.id));
        node.children.forEach((c) => folderRow(c, depth + 1, group));
        notes.forEach((n) => noteRow(n, depth + 1, group));
        into.append(group);
      }
    };

    const frag = document.createDocumentFragment();
    if (scopeNode) {
      scopeNode.children.forEach((c) => folderRow(c, 0, frag));
      (out[scopeNode.id] || []).forEach((n) => noteRow(n, 0, frag));
    } else {
      state.tree.forEach((c) => folderRow(c, 0, frag));
      (out[''] || []).forEach((n) => noteRow(n, 0, frag));
    }
    root.append(frag);
    restoreTreeFocus(root, refocus);
    const active = root.querySelector('.tree-note.is-active');
    if (active && state.revealInTree === state.currentId) { active.scrollIntoView({ block: 'nearest' }); state.revealInTree = null; }
  }

  // When a note opens, the sidebar opens the path to its folder (one path at a time) and marks the folder.
  function revealInSidebar(note) {
    if (GUEST) return;
    const parents = note && note.folderId ? pathTo(note.folderId).slice(0, -1) : [];
    const open = expandedSet();
    if (parents.every((id) => open.has(id))) { renderFolders(); return; }
    setExpanded(parents[parents.length - 1], true);
  }

  // When a note opens, the folder view opens the folders around it, once (they can be closed again).
  function revealInTree(note) {
    if (GUEST || !treeModeActive() || !note || !note.folderId) return;
    const path = pathTo(note.folderId);
    const have = new Set(state.settings.treeExpanded || []);
    const missing = path.filter((id) => !have.has(id));
    state.revealInTree = note.id;
    if (missing.length) updateSettings({ treeExpanded: Array.from(have).concat(missing) }).then(renderNoteTree);
    else renderNoteTree();
  }

  // The outline follows typing, at most twice a second, and only redraws when the headings changed.
  let outlineTimer = null, outlineSig = '';
  function scheduleOutline() {
    if (!treeModeActive()) return;
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(() => {
      const sig = state.currentId + '|' + currentHeadings().map((h) => h.level + h.text).join('|');
      if (sig !== outlineSig) { outlineSig = sig; renderNoteTree(); }
    }, 500);
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
    showSidebar(); // the name field lives there
    state.editingFolder = { mode: 'create', parentId: parentId || null, book: !!asBook };
    if (parentId && !expandedSet().has(parentId)) { setExpanded(parentId, true); return; }
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
    if (parentId && !expandedSet().has(parentId)) await setExpanded(parentId, true);
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
    // Each folder by its full path ("Work / Project Atlas"), so the closed box reads as a breadcrumb.
    const path = [];
    for (const node of flattenTree(state.tree)) {
      path.length = node.depth;
      path.push(node.name);
      const opt = document.createElement('option');
      opt.value = node.id;
      opt.textContent = path.join(' / ');
      sel.append(opt);
    }
    sel.value = current;
    if (sel.value !== current) sel.value = '';
    const f = current ? flattenTree(state.tree).find((x) => x.id === current) : null;
    setIcon(sel.parentElement, f && f.book ? 'book' : 'folder');
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

  // Shows a popover menu at the pointer (right-click) or under its anchor, kept inside the window. Under an anchor
  // it lines up with the anchor's right edge when the anchor sits in the right half, and opens upward if it must.

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

  // ---- vaults: see vaults-panel.js ----

  const { syncVault, removeVault, addVaultFolder, openCloneDialog, submitClone, renderVaultList, describeVaultStatus } = createVaultsPanel({ api, refresh, flushSave, setView, leaveSettings, setExpanded });

  // ---- tabs and split view ---------------------------------------------------
  // Each side of the editor pane has its own row of tabs, and selectNote shows a note in the side's current tab.
  // The right side of a split is this page again in an iframe (?pane=right) that shows only the editor, so it has
  // every editor feature. The two copies talk with postMessage. A note is open on one side only, so two editors
  // never write the same note: asking for it on one side shows it where it already is.

  const GUEST = new URLSearchParams(location.search).get('pane') === 'right';
  const SIDE = GUEST ? 'right' : 'left';
  const tabs = {
    ids: [],            // note ids in tab order; null is an empty tab
    at: 0,              // the tab on screen
    titles: new Map(),  // id -> title shown on a tab that is not on screen
    split: false,       // left side: the right side is open
    active: 'left',     // left side: the side the list opens notes in (the one last clicked or typed in)
    activeHere: false,  // right side: this side is the active one
    ratio: 0.5,         // left side: its share of the width
    frame: null,        // left side: the right side's iframe
    peerReady: false,
    queue: [],          // left side: messages for the right side sent before it was ready
    peerIds: [],        // the other side's open notes
    peerCurrent: null,
    dragIndex: null,    // a tab of this side being dragged
    peerDrag: null,     // a tab or note card being dragged on the other side
  };

  function peerWindow() { return GUEST ? window.parent : (tabs.frame && tabs.frame.contentWindow); }
  function toPeer(msg) {
    if (!GUEST && !tabs.split) return;
    // Queue before touching the iframe's window: reading contentWindow while the iframe is still about:blank
    // makes Electron run the preload there, and not again for the page, which then has no API.
    if (!GUEST && !tabs.peerReady) { tabs.queue.push(msg); return; }
    const w = peerWindow();
    if (!w || w === window) return;
    w.postMessage(Object.assign({ notesPane: true }, msg), '*');
  }
  function hasPeer() { return GUEST || tabs.split; }
  function peerHas(id) { return !!id && hasPeer() && tabs.peerIds.includes(id); }
  let peerChangedTimer = null;
  function peerChanged() {
    if (!hasPeer()) return;
    clearTimeout(peerChangedTimer);
    peerChangedTimer = setTimeout(() => toPeer({ type: 'changed' }), 250);
  }

  // Events from the main process reach the left side only; it hands them on to the right side.
  const mainEvents = {};
  function fromMain(name, handler) {
    mainEvents[name] = handler;
    api.on[name]((arg) => { handler(arg); if (tabs.split) toPeer({ type: 'event', name, arg }); });
  }

  function panesOf(settings) {
    return (settings && settings.panes) || { split: false, ratio: 0.5, active: 'left', left: { ids: [], current: null }, right: { ids: [], current: null } };
  }

  function restoreTabs(settings) {
    const panes = panesOf(settings);
    const mine = panes[SIDE];
    tabs.ids = mine.ids.slice();
    tabs.at = Math.max(0, tabs.ids.indexOf(mine.current));
    if (GUEST) { renderTabs(); return; }
    tabs.ratio = panes.ratio;
    tabs.active = panes.split ? panes.active : 'left';
    // Until the right side has loaded and reported, its saved tabs stand for it (so a save meanwhile keeps them).
    tabs.peerIds = panes.split ? panes.right.ids.slice() : [];
    tabs.peerCurrent = panes.split ? panes.right.current : null;
    renderTabs();
  }

  function openIds() { return tabs.ids.filter(Boolean); }

  function tabTitle(id) {
    if (!id) return 'New tab';
    if (id === state.currentId && state.current) return H.deriveTitle({ title: el.titleInput.value, body: el.bodyInput.value });
    return tabs.titles.get(id) || '…';
  }

  function renderTabs() {
    const frag = document.createDocumentFragment();
    tabs.ids.forEach((id, i) => {
      const t = document.createElement('div');
      const on = i === tabs.at;
      t.className = 'tab' + (on ? ' is-active' : '');
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(on));
      t.dataset.index = String(i);
      t.draggable = true;
      const title = tabTitle(id);
      t.title = title + (id ? '\nCtrl+click a note in the list to open it in a new tab. Middle-click closes.' : '');
      const label = document.createElement('span');
      label.className = 'tab-title';
      label.textContent = title;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'tab-close';
      x.innerHTML = I('x');
      x.title = 'Close tab (Ctrl+W)';
      x.setAttribute('aria-label', 'Close ' + title);
      t.append(label, x);
      frag.append(t);
    });
    el.tabList.replaceChildren(frag);
    const active = el.tabList.querySelector('.tab.is-active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // One tab showing a note, and no split: no tabs (the user's rule, PR 71). The bar itself stays, for the note's
    // actions and the window's buttons. A blank editor keeps its + (the way to a tab then), and a split keeps both
    // sides' tabs, for Close side and the active side's mark.
    el.tabBar.classList.toggle('is-solo', !GUEST && !tabs.split && tabs.ids.length === 1 && !!tabs.ids[0]);
    syncTitleBar();
    el.splitViewBtn.classList.toggle('hidden', GUEST || tabs.split);
    el.paneCloseBtn.classList.toggle('hidden', !GUEST);
    const missing = openIds().filter((id) => id !== state.currentId && !tabs.titles.has(id));
    if (missing.length) loadTabTitles(missing);
  }

  // Live title of the tab on screen while the title is typed.
  function renderActiveTabTitle() {
    const label = el.tabList.querySelector('.tab.is-active .tab-title');
    if (label && state.current) label.textContent = tabTitle(state.currentId);
  }

  let titlesLoading = false;
  async function loadTabTitles(ids) {
    if (titlesLoading) return;
    titlesLoading = true;
    let gone = [];
    try {
      const notes = await Promise.all(ids.map((id) => api.notes.get(id).catch(() => undefined))); // undefined: could not ask
      notes.forEach((n, i) => { if (n) tabs.titles.set(ids[i], H.deriveTitle(n)); else if (n === null) gone.push(ids[i]); });
    } finally { titlesLoading = false; }
    // A note deleted while its tab was in the background: the tab goes.
    gone = gone.filter((id) => id !== state.currentId);
    for (const id of gone) { const i = tabs.ids.indexOf(id); if (i >= 0) removeTabAt(i); }
    if (gone.length) tabsChanged(); else renderTabs();
  }

  function removeTabAt(i) {
    tabs.ids.splice(i, 1);
    if (i < tabs.at || tabs.at >= tabs.ids.length) tabs.at = Math.max(0, tabs.at - 1);
  }

  // Puts the note just shown into a tab: its own tab if it has one, a new tab if asked, or the current tab.
  function placeInTab(id, newTab) {
    const i = tabs.ids.indexOf(id);
    if (i >= 0) tabs.at = i;
    else if (!tabs.ids.length) { tabs.ids = [id]; tabs.at = 0; }
    else if (newTab && tabs.ids[tabs.at] !== null) { tabs.ids.splice(tabs.at + 1, 0, id); tabs.at += 1; }
    else tabs.ids[tabs.at] = id;
    tabsChanged();
  }

  function tabsChanged() {
    renderTabs();
    toPeer({ type: 'tabs', ids: openIds(), current: state.currentId });
    if (!GUEST) saveLayoutSoon();
  }

  let layoutTimer = null;
  function saveLayoutSoon() {
    if (GUEST) return;
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      const panes = {
        split: tabs.split, ratio: tabs.ratio, active: tabs.active,
        left: { ids: openIds(), current: state.currentId },
        right: { ids: tabs.split ? tabs.peerIds.slice() : [], current: tabs.split ? tabs.peerCurrent : null },
      };
      if (JSON.stringify(panes) === JSON.stringify(state.settings.panes)) return;
      updateSettings({ panes }).catch(() => {}); // only the layout; losing one write costs nothing
    }, 1500);
  }

  // Runs tab work in the same queue as note switches, so a close and a switch never interleave their saves.
  function inTurn(fn) {
    const run = state.selecting.then(fn).catch((err) => console.error('tab change failed', err));
    state.selecting = run;
    return run;
  }

  // Writes what is open (or asks to leave it) before the tab changes. False when the person chose to stay.
  async function leaveNote() {
    if (tts.active) stopReadAloud();
    // A PDF's or Word document's edits are not the note's text, so state.dirty does not cover them. If they cannot
    // be written, stay on the document: switching would close it and lose them.
    if (!(await flushDocuments({ commit: true })) && !window.confirm('Your changes to this document could not be saved (is it open in another app?). Leave it anyway and lose them?')) return false;
    // Flush again if keystrokes landed while the flush was in flight, so nothing typed during the switch is dropped.
    let guard = 0;
    while (state.dirty && guard++ < 3) await flushSave();
    stashIfDirty(); // still dirty means the disk is refusing writes; the patch lives on and is retried
    return true;
  }

  function showTab(i) {
    return inTurn(async () => {
      if (i < 0 || i >= tabs.ids.length) return;
      const id = tabs.ids[i];
      if (id) { await selectNoteNow(id); return; }
      if (i === tabs.at && !state.currentId) return;
      if (!(await leaveNote())) return;
      blankEditor();
      tabs.at = i;
      tabsChanged();
    });
  }

  function newEmptyTab() {
    return inTurn(async () => {
      if (tabs.ids[tabs.at] === null && !state.currentId) return; // already on an empty tab
      if (!(await leaveNote())) return;
      blankEditor();
      const at = tabs.ids.length ? tabs.at + 1 : 0;
      tabs.ids.splice(at, 0, null);
      tabs.at = at;
      tabsChanged();
    });
  }

  function closeTab(i) {
    return inTurn(async () => {
      if (i < 0 || i >= tabs.ids.length) return;
      if (i !== tabs.at) { removeTabAt(i); tabsChanged(); return; }
      if (tabs.ids.length > 1) {
        const j = i + 1 < tabs.ids.length ? i + 1 : i - 1;
        const nextId = tabs.ids[j];
        if (nextId) {
          await selectNoteNow(nextId);
          if (state.currentId !== nextId) return; // the switch was refused; the tab stays
        } else {
          if (!(await leaveNote())) return;
          blankEditor();
        }
        tabs.at = j;
        removeTabAt(i);
        tabsChanged();
        return;
      }
      if (!(await leaveNote())) return;
      blankEditor();
      tabs.ids = [];
      tabs.at = 0;
      tabsChanged();
      if (GUEST) toPeer({ type: 'close' }); // the right side's last tab closes the split
    });
  }

  function cycleTab(step) {
    if (tabs.ids.length < 2) return;
    showTab((tabs.at + step + tabs.ids.length) % tabs.ids.length);
  }

  // Opens a note from outside the editor (the list, a new note, a reminder, a sticky): in the active side.
  function openNote(id, opts) {
    opts = opts || {};
    if (!GUEST && tabs.split && !tabs.ids.includes(id) && (peerHas(id) || tabs.active === 'right')) {
      toPeer({ type: 'open', id, newTab: !!opts.newTab, focus: opts.focus || null });
      if (opts.focus) tabs.frame.focus();
      return Promise.resolve();
    }
    return selectNote(id, opts);
  }

  // ---- the split ----

  function setActiveSide(side) {
    if (GUEST || tabs.active === side) return;
    tabs.active = side;
    el.paneMain.classList.toggle('is-active-side', tabs.split && side === 'left');
    toPeer({ type: 'active', on: side === 'right' });
    saveLayoutSoon();
  }

  function applyRatio() {
    el.editorPane.style.setProperty('--peer-w', Math.round((1 - tabs.ratio) * 1000) / 10 + '%');
  }

  function openSplit(restoring) {
    if (GUEST || tabs.split) return;
    tabs.split = true;
    tabs.peerReady = false;
    tabs.queue = [];
    if (!restoring) { tabs.peerIds = []; tabs.peerCurrent = null; }
    const f = document.createElement('iframe');
    f.className = 'pane-peer';
    f.id = 'panePeer';
    f.title = 'Right side';
    f.src = 'index.html?pane=right';
    tabs.frame = f;
    let loads = 0;
    f.addEventListener('load', () => { if (++loads > 1 && tabs.frame === f) { dropFrame(); toast('The right side left its page, so it was closed.'); } });
    applyRatio();
    el.editorPane.classList.add('is-split');
    el.splitDivider.classList.remove('hidden');
    el.editorPane.append(f);
    if (!restoring) tabs.active = 'right'; // a new split is where the next note from the list goes
    el.paneMain.classList.toggle('is-active-side', tabs.active === 'left');
    renderTabs();
    if (!restoring) saveLayoutSoon();
  }

  async function closeSplit() {
    if (GUEST || !tabs.split) return;
    if (!(await flushPeer({ leave: true }))) return; // the right side kept an unsaved document open
    if (!tabs.split) return;
    dropFrame();
  }

  function dropFrame() {
    tabs.frame.remove();
    tabs.frame = null;
    tabs.split = false;
    tabs.peerReady = false;
    tabs.queue = [];
    tabs.peerIds = [];
    tabs.peerCurrent = null;
    tabs.peerDrag = null;
    el.editorPane.classList.remove('is-split');
    el.splitDivider.classList.add('hidden');
    tabs.active = 'left';
    el.paneMain.classList.remove('is-active-side');
    renderTabs();
    saveLayoutSoon();
  }

  // Asks the right side to write what it has. leave: also its documents, asking the person if they cannot be.
  let flushSeq = 0;
  const peerWaits = new Map();
  function askPeer(msg, ms) {
    const seq = ++flushSeq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { peerWaits.delete(seq); resolve(null); }, ms);
      peerWaits.set(seq, (reply) => { clearTimeout(timer); peerWaits.delete(seq); resolve(reply); });
      toPeer(Object.assign({ seq }, msg));
    });
  }
  async function flushPeer(opts) {
    if (GUEST || !tabs.split || !tabs.peerReady) return true;
    const leave = !!(opts && opts.leave);
    // Leaving may wait for the person to answer a question about an unsaved document.
    const reply = await askPeer({ type: 'flush', leave }, leave ? 10 * 60 * 1000 : 5000);
    // Leaving needs a yes: no answer means the right side's work is not known to be written. A plain flush (hide,
    // quit) must never hold the window, so it gives up after the time main allows anyway.
    if (leave) return !!(reply && reply.ok);
    return true;
  }

  // Moves a note that is open on the other side to this one: that side closes its tab (writing it) first.
  async function takeFromPeer(id) {
    if (!peerHas(id)) return true;
    const reply = await askPeer({ type: 'release', id }, 10 * 60 * 1000);
    return !!(reply && reply.ok);
  }

  async function onPeerMessage(m) {
    switch (m.type) {
      case 'hello': {
        tabs.peerReady = true;
        const queued = tabs.queue;
        tabs.queue = [];
        toPeer({ type: 'active', on: tabs.active === 'right' });
        toPeer({ type: 'tabs', ids: openIds(), current: state.currentId });
        queued.forEach(toPeer);
        return;
      }
      case 'tabs':
        tabs.peerIds = Array.isArray(m.ids) ? m.ids : [];
        tabs.peerCurrent = m.current || null;
        saveLayoutSoon();
        return;
      case 'open':
        if (!GUEST && m.focus) { setActiveSide('left'); window.focus(); }
        await selectNote(m.id, { newTab: !!m.newTab, focus: m.focus || null });
        return;
      case 'changed':
        await onPeerWrite();
        return;
      case 'settings':
        applySettings(m.settings, { fromPeer: true });
        return;
      case 'caption':
        if (GUEST) document.documentElement.style.setProperty('--caption-w', (Number(m.w) || 0) + 'px');
        return;
      case 'focus': setActiveSide('right'); return;
      case 'active':
        tabs.activeHere = !!m.on;
        el.paneMain.classList.toggle('is-active-side', tabs.activeHere);
        return;
      case 'event':
        if (m.name === 'editCommand') runEditCommand(m.arg);
        else if (mainEvents[m.name]) await mainEvents[m.name](m.arg);
        return;
      case 'flush': {
        let ok = false;
        try {
          if (m.leave) ok = (await inTurn(leaveNote)) === true && !state.pending.size;
          else { await flushSave(); await retryPending(); ok = true; }
        } finally { toPeer({ type: 'reply', seq: m.seq, ok }); }
        if (m.leave && !ok && state.pending.size) toast('Some text here could not be saved yet, so this side stays open. It is retried; try again in a moment.');
        return;
      }
      case 'release': {
        const i = tabs.ids.indexOf(m.id);
        if (i >= 0) await closeTab(i);
        // Text of that note kept for a retry lives here: the other side must not open the note over it.
        const ok = !tabs.ids.includes(m.id) && !state.pending.has(m.id);
        if (!ok && state.pending.has(m.id)) toast('That note has text that could not be saved yet; it stays here until it is.');
        toPeer({ type: 'reply', seq: m.seq, ok });
        return;
      }
      case 'reply': { const wait = peerWaits.get(m.seq); if (wait) wait(m); return; }
      case 'command': runSideCommand(m.name, m); return;
      case 'close': await closeSplit(); return;
      case 'drag': tabs.peerDrag = m.id || null; return;
      default: return;
    }
  }

  async function onPeerWrite() {
    if (!GUEST) await refresh({ keepEditor: true }); // the right side has no list to keep current
    tabs.titles.clear();
    renderTabs();
    const id = state.currentId;
    if (id && !state.dirty && !(await api.notes.get(id)) && state.currentId === id) { clearEditor(); if (!GUEST) await refresh(); }
  }

  // Shortcuts pressed on the right side that belong to the list or the whole window.
  function runSideCommand(name, m) {
    if (GUEST) return;
    if (name === 'newNote') newNote({ title: m && typeof m.title === 'string' ? m.title : '' });
    else if (name === 'search') showList().then(() => { el.searchInput.focus(); el.searchInput.select(); });
    else if (name === 'openFiles') openFiles();
    else if (name === 'settings') openSettings();
    else if (name === 'newFolder') startCreateFolder(state.view === 'folder' ? state.folderId : null);
    else if (name === 'toggleSidebar') toggleSidebar();
  }

  function runEditCommand(cmd) {
    if (!GUEST && tabs.frame && document.activeElement === tabs.frame) { toPeer({ type: 'event', name: 'editCommand', arg: cmd }); return; }
    if (state.rich && !state.sourceMode && el.richEditor.contains(document.activeElement)) state.rich.editor.chain().focus()[cmd === 'redo' ? 'redo' : 'undo']().run();
    else if (!src.undoRedo(cmd)) document.execCommand(cmd === 'redo' ? 'redo' : 'undo');
  }

  // Dropping a tab or a note card on a tab bar: reorder this side's tabs, or open the note here.
  function dropIndex(e) {
    const t = e.target.closest('.tab');
    return t ? Number(t.dataset.index) : tabs.ids.length;
  }
  function onTabDrop(e) {
    el.tabBar.classList.remove('is-drop-target');
    const at = dropIndex(e);
    if (tabs.dragIndex !== null) {
      e.preventDefault();
      const from = tabs.dragIndex;
      tabs.dragIndex = null;
      if (at === from || at === from + 1) return;
      const moving = tabs.ids[from];
      const shown = tabs.ids[tabs.at];
      const wasShown = from === tabs.at;
      tabs.ids.splice(from, 1);
      const to = at > from ? at - 1 : at;
      tabs.ids.splice(to, 0, moving);
      tabs.at = wasShown ? to : tabs.ids.indexOf(shown);
      tabsChanged();
      return;
    }
    const id = e.dataTransfer.getData('text/x-note-id') || tabs.peerDrag;
    tabs.peerDrag = null;
    if (!id) return;
    e.preventDefault();
    (async () => {
      if (!(await takeFromPeer(id))) return;
      if (!GUEST) setActiveSide('left'); else toPeer({ type: 'focus' });
      await selectNote(id, { newTab: true, focus: 'body' });
    })();
  }

  function bindTabs() {
    el.tabList.addEventListener('click', (e) => {
      const t = e.target.closest('.tab');
      if (!t) return;
      const i = Number(t.dataset.index);
      if (e.target.closest('.tab-close')) closeTab(i); else showTab(i);
    });
    el.tabList.addEventListener('auxclick', (e) => { const t = e.target.closest('.tab'); if (t && e.button === 1) { e.preventDefault(); closeTab(Number(t.dataset.index)); } });
    el.tabList.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // no autoscroll on middle-click
    el.tabList.addEventListener('dragstart', (e) => {
      const t = e.target.closest('.tab');
      if (!t) return;
      tabs.dragIndex = Number(t.dataset.index);
      e.dataTransfer.setData('text/x-notes-tab', t.dataset.index);
      e.dataTransfer.effectAllowed = 'move';
      toPeer({ type: 'drag', id: tabs.ids[tabs.dragIndex] || null });
    });
    el.tabList.addEventListener('dragend', () => { tabs.dragIndex = null; toPeer({ type: 'drag', id: null }); });
    el.tabBar.addEventListener('dragover', (e) => {
      if (tabs.dragIndex === null && !tabs.peerDrag && !e.dataTransfer.types.includes('text/x-note-id')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.tabBar.classList.add('is-drop-target');
    });
    el.tabBar.addEventListener('dragleave', (e) => { if (!el.tabBar.contains(e.relatedTarget)) el.tabBar.classList.remove('is-drop-target'); });
    el.tabBar.addEventListener('drop', onTabDrop);
    el.tabAddBtn.addEventListener('click', newEmptyTab);
    el.splitViewBtn.addEventListener('click', () => openSplit(false));
    el.paneCloseBtn.addEventListener('click', () => toPeer({ type: 'close' }));
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (!m || m.notesPane !== true || !e.source || e.source !== peerWindow()) return;
      onPeerMessage(m).catch((err) => console.error('split view message failed', err));
    });
    if (GUEST) {
      const claim = () => { if (!tabs.activeHere) toPeer({ type: 'focus' }); };
      document.addEventListener('focusin', claim);
      document.addEventListener('pointerdown', claim, true);
      return;
    }
    el.paneMain.addEventListener('focusin', () => setActiveSide('left'));
    el.paneMain.addEventListener('pointerdown', () => setActiveSide('left'), true);
    // Drag the divider to share the width; double-click shares it equally.
    el.splitDivider.addEventListener('pointerdown', (e) => {
      if (!tabs.split) return;
      e.preventDefault();
      el.splitDivider.setPointerCapture(e.pointerId);
      el.splitDivider.classList.add('is-dragging');
      el.editorPane.classList.add('is-resizing');
      const move = (ev) => {
        const r = el.editorPane.getBoundingClientRect();
        tabs.ratio = Math.min(0.8, Math.max(0.2, (ev.clientX - r.left) / r.width));
        applyRatio();
      };
      const up = () => {
        el.splitDivider.removeEventListener('pointermove', move);
        el.splitDivider.removeEventListener('pointerup', up);
        el.splitDivider.removeEventListener('pointercancel', up);
        el.splitDivider.classList.remove('is-dragging');
        el.editorPane.classList.remove('is-resizing');
        saveLayoutSoon();
      };
      el.splitDivider.addEventListener('pointermove', move);
      el.splitDivider.addEventListener('pointerup', up);
      el.splitDivider.addEventListener('pointercancel', up);
    });
    el.splitDivider.addEventListener('dblclick', () => { tabs.ratio = 0.5; applyRatio(); saveLayoutSoon(); });
  }

  // ---- editor --------------------------------------------------------------

  // The note in the current tab is gone (trashed, deleted, split into a book): the tab is left empty.
  function clearEditor() {
    blankEditor();
    if (tabs.ids.length) { tabs.ids[tabs.at] = null; tabsChanged(); }
  }

  function blankEditor() {
    stashIfDirty();
    clearPdf();
    state.currentId = null;
    state.current = null;
    state.dirty = false;
    syncListCollapsed();
    el.editor.classList.add('hidden');
    el.editorEmpty.classList.remove('hidden');
    markActiveRow(null);
  }

  // Selections run one at a time: two quick switches must not interleave their loads and flushes.
  state.selecting = Promise.resolve();
  // opts: { newTab, focus: 'title' | 'body' }. Shows the note in this side's current tab (see placeInTab).
  function selectNote(id, opts) {
    const run = state.selecting.then(() => selectNoteNow(id, opts)).catch((err) => console.error('selectNote failed', err));
    state.selecting = run;
    return run;
  }

  async function selectNoteNow(id, opts) {
    opts = opts || {};
    // Open on the other side of the split: show it there, never in two editors at once.
    if (peerHas(id)) { toPeer({ type: 'open', id, focus: opts.focus || 'body' }); return; }
    if (state.currentId === id && state.current) { focusAfterOpen(opts.focus); return; }
    if (!(await leaveNote())) return;
    if (state.inflight.has(id)) await state.inflight.get(id); // a write for the incoming note is still landing
    // Read the incoming note only now, after every write that could change it has settled.
    const note = await api.notes.get(id);
    if (!note) {
      const gone = tabs.ids.indexOf(id);
      if (gone >= 0 && id !== state.currentId) { removeTabAt(gone); tabsChanged(); }
      return;
    }
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
    // A CSV opens as its table; other plain files as their text; Markdown by the setting (or as source when lossy).
    const wantSource = H.isTableFile(note) ? false : (plainFile || state.settings.editorMode === 'source' || !lossless || !state.rich);
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
    el.sourceBtn.classList.toggle('hidden', (plainFile && !H.isTableFile(note)) || fileReadOnly); // nothing to switch between
    syncSourceButton();
    [el.titleInput, el.tagsInput].forEach((i) => { i.readOnly = inTrash; });
    el.bodyInput.readOnly = inTrash || fileReadOnly;
    showCode(note, inTrash || fileReadOnly);
    renderLockState(note);
    if (state.rich) state.rich.setEditable(!inTrash && !fileReadOnly && !plainFile);
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
    renderPinButton(note.pinned);
    el.folderSelect.disabled = inTrash;
    renderFolderSelect();
    el.editorEmpty.classList.add('hidden');
    el.editor.classList.remove('hidden');
    markActiveRow(id);
    revealInTree(note);
    revealInSidebar(note);
    updateStatus(note);
    if (hasPending) { state.dirty = true; setSaved('Save failed'); scheduleRetry(); }
    else setSaved('Saved');
    placeInTab(note.id, opts.newTab);
    focusAfterOpen(opts.focus);
  }

  // The open note's row, in whichever of the list and the folder view is showing (null clears both).
  function markActiveRow(id) {
    for (const root of [el.noteList, el.noteTree]) {
      root.querySelectorAll('.note-row').forEach((r) => {
        const on = !!id && r.dataset.id === id;
        r.classList.toggle('is-active', on);
        if (r.hasAttribute('aria-selected')) r.setAttribute('aria-selected', String(on));
      });
    }
  }

  function focusAfterOpen(where) {
    if (where === 'title') el.titleInput.focus();
    else if (where === 'body') focusBody();
  }

  function updateStatus(note) {
    const body = el.bodyInput.value;
    const stats = tableStatsNow();
    if (stats && tableShown()) {
      // A table is counted in rows and columns, not words.
      el.statusWords.textContent = stats.rows.toLocaleString() + (stats.rows === 1 ? ' row' : ' rows');
      el.statusChars.textContent = stats.cols + (stats.cols === 1 ? ' column' : ' columns');
    } else {
      const words = H.countWords(body);
      el.statusWords.textContent = words + (words === 1 ? ' word' : ' words');
      el.statusChars.textContent = body.length + (body.length === 1 ? ' character' : ' characters');
    }
    el.statusUpdated.textContent = note.trashedAt ? 'Trashed ' + H.relativeTime(note.trashedAt) : 'Edited ' + H.relativeTime(note.updatedAt);
  }

  function setSaved(label) {
    el.statusSaved.textContent = label;
    el.statusSaved.classList.toggle('is-saving', label === 'Saving…');
    el.statusSaved.classList.toggle('is-saved', label === 'Saved');
  }

  // ---- books, and the reading view: see books.js ----

  const { book, bookOf, renderBookStrip, stepPage, addPage, toggleBook, openSplitDialog, applySplit, openBookMenu, closeAllBookMenus, pageMenuAction, bookMenuAction, exportBook, reader, openReader, closeReader, readerOpen } = createBooks({ api, flattenTree, selectNote, selectNoteNow, refresh, flushSave, clearEditor, setView, trashCurrent, syncTitleBar });

  // ---- live share: see live-share.js ----

  const { renderLiveRow, startLiveHost, stopLive, openLiveDialog, submitLiveDialog } = createLiveShare({ api, flushSave, refreshCurrentMeta, setView, selectNoteNow });

  // ---- find in note, print: see find-bar.js ----

  const { openFind, closeFind, runFind, toggleReplace, replaceCurrent, replaceAll, clearFindHighlights, scrollTextareaToSelection, printNote, exportOfCurrent } = createFindBar({ api, flushSave, GUEST });

  // ---- the editor view: see editor-view.js ----

  const { createRichEditor, inline, showInlineMenu, inlineMenuKey, syncTextViews, tableStatsNow, syncSourceButton, applyEditorMode, toggleSource, followLink, openLinkDialog } = createEditorView({ api, refresh, updateStatus, updateSettings, scopeListToNote, selectNoteNow, scheduleSave, runFind, clearFindHighlights });

  // ---- related notes: see related.js ----

  const { renderRelated, renderRelatedSoon } = createRelated({ api, followLink });

  // ---- desktop stickies: see sticky-button.js ----

  const { renderStickyButton, toggleSticky } = createStickyButton({ api, flushSave, refreshCurrentMeta });

  // ---- locking: see locking.js ----

  const { renderLockState, onLockButton, submitLockDialog, unlockFromScreen, applyLockedNote, lockMenuAction } = createLocking({ api, renderFileRow, flushSave, applyEditorMode, runFind, scheduleSave, renderStickyButton, updateStatus, refreshRow });

  // ---- reminders: see reminders.js ----

  const { renderRemindButton, openRemindDialog, setReminder } = createReminders({ api, flushSave, refreshCurrentMeta });

  // ---- sharing: see sharing.js ----

  const { syncShareMenu, openShareMenu, closeShareMenu, shareAction } = createSharing({ api, flushSave, closeFind, GUEST, exportOfCurrent, exportCurrent, startLiveHost, openLiveDialog, stopLive });

  // ---- attachments and voice memos: see attachments.js ----

  const { attachFiles, toggleRecording } = createAttachments({ api, flushSave, refresh });

  // ---- earlier versions: see history-dialog.js ----

  const { openHistory, restoreVersion } = createHistoryDialog({ api, flushSave, applyEditorMode, runFind, scheduleSave });

  // ---- the open note's meta row --------------------------------------------

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

  // ---- bot: Claude Code over the notes: see bot-panel.js ----

  const { bot, toggleBot, describeBotScope, runBot, onBotEvent, openBotTerminal } = createBotPanel({ api, flushSave, refresh, applyFreshFileBody });

  // ---- speech: read aloud and dictate: see speech.js ----

  const { tts, stopReadAloud, toggleReadAloud, populateVoices, startDictation } = createSpeech({ api });

  // ---- file-backed notes ---------------------------------------------------

  // ---- the PDF on show: see pdf-note.js ----

  const { clearPdf, showPdf, pdfDirty, pdfBusy, flushPdf, reportFileSaved, closePdfPages, commitPdf, pdfOpen, forgetShownPdf, bindPdfEvents } = createPdfNote({ api, externalLinkClick, showBanner, openFiles });

  // ---- Documents in the Craft apps: see craft-notes.js ----

  const { crafts, useWordCraft, craftFor, craftDirty, flushCrafts, showCraftOnly } = createCraftNotes({ api, GUEST, setSaved, showBanner, openFiles, reportFileSaved, refresh, renderFileRow });

  // ---- the Word document on show: see word-note.js ----

  const { clearDocx, showDocx, docxDirty, flushDocx, docxOpen, forgetShownDocx, bindDocxEvents } = createWordNote({ api, flushSave, showBanner, reportFileSaved, externalLinkClick, crafts, useWordCraft });

  // A link inside a shown document (Word, PDF): a web link opens only on Ctrl+click, anything else never.
  function externalLinkClick(e, href) {
    if (!/^https?:\/\//i.test(href)) return;
    if (e.ctrlKey || e.metaKey) api.app.openExternal(href);
    else toast('This link goes to ' + href + '. Ctrl+click to open it.');
  }

  // ---- images: see images.js ----

  const { showImage, clearImage, toggleImageSize, syncImageToggle } = createImages({ api, showBanner });

  // A file's badge, in the list and over the note: a text file's language as it is written (LaTeX, Python,
  // Markdown, Plain text), or the kind of any other file as the acronym it is (PDF, DOCX).
  function fileBadge(note) {
    if (['docx', 'sheet', 'image'].includes(note.fileKind)) return H.extOf(note.filePath).toUpperCase();
    if (note.fileKind !== 'text') return (note.fileKind || 'file').toUpperCase();
    if (!isPlainTextFile(note)) return 'Markdown';
    if (H.isTableFile(note)) return H.extOf(note.filePath).toUpperCase();
    return window.NotesCode ? window.NotesCode.languageFor(H.extOf(note.filePath)).name : 'Plain text';
  }

  function renderFileRow(note) {
    const isFile = !!(note && note.filePath);
    el.fileRow.classList.toggle('hidden', !isFile);
    el.fileBanner.classList.add('hidden');
    if (!(isFile && note.fileKind === 'docx')) clearDocx();
    for (const [kind, key] of Object.entries(H.CRAFT_OF)) if (!(isFile && note.fileKind === kind)) crafts[key].clear();
    if (!(isFile && note.fileKind === 'pdf')) clearPdf();
    if (!(isFile && note.fileKind === 'image')) clearImage();
    closeConvertMenu();
    el.editorColumn.classList.toggle('shows-document', isFile && (note.fileKind === 'pdf' || !!H.CRAFT_OF[note.fileKind]));
    el.editor.classList.toggle('shows-image', isFile && note.fileKind === 'image');
    // A Craft app is a whole office app: it gets the note's area, and shows its own title, counts and status.
    const inCraft = isFile && !!craftFor(note) && craftFor(note).usable();
    el.editorColumn.classList.toggle('shows-craft', inCraft);
    el.editor.classList.toggle('shows-craft', inCraft);
    syncTextViews(note);
    if (!isFile) return;
    el.fileKind.textContent = fileBadge(note);
    el.fileConvertBtn.classList.add('hidden');
    api.files.convertOptions(note.id).then((opts) => { if (state.currentId === note.id) el.fileConvertBtn.classList.toggle('hidden', !opts.length); }).catch(() => {});
    el.filePath.textContent = note.filePath;
    el.filePath.title = note.filePath;
    if (note.fileKind === 'pdf') {
      el.pdfEditor.classList.remove('hidden');
      showBanner('Highlight, add text, draw or add a picture with the tools above; with a tool on, click a mark to move or delete it. Save writes your changes into this PDF, and the original is backed up first.');
      showPdf(note);
    } else if (note.fileKind === 'docx') {
      // WordCraft (when it is built) is the full editor, with its own ribbon; the simple editor is the fallback.
      el.docxEditor.classList.toggle('hidden', useWordCraft());
      showBanner(useWordCraft() ? '' : 'Opening the Word document…');
      showDocx(note);
    } else if (note.fileKind === 'sheet') {
      showCraftOnly(note);
    } else if (note.fileKind === 'image') {
      showBanner('');
      showImage(note);
    } else if (note.fileKind === 'binary') {
      showBanner('This file type cannot be shown here. Use "Open with…" to open it in its own app.');
    }
  }

  // ---- Convert to: see convert-menu.js ----

  const { openConvertMenu, closeConvertMenu, convertCurrent } = createConvertMenu({ api, flushSave, openFiles });

  // ---- opened documents as one ----

  // Opened documents (PDF, Word, the Craft apps') as one: unsaved edits, edits in progress, and saving them.
  const documentDirty = () => pdfDirty() || docxDirty() || craftDirty();
  const documentBusy = () => pdfBusy() || docxDirty() || craftDirty();
  async function flushDocuments(opts) {
    const pdfSaved = await flushPdf(opts);
    const docxSaved = await flushDocx(opts);
    const craftSaved = await flushCrafts();
    return pdfSaved && docxSaved && craftSaved;
  }

  // ---- files, saving, and the note's lifecycle ----
  // An empty text hides the banner.
  function showBanner(text) {
    el.fileBanner.textContent = text;
    el.fileBanner.classList.toggle('hidden', !text);
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
      } else await openNote(res.firstId);
    }
    const failed = res.failed.length ? ' Could not open: ' + res.failed.join(', ') : '';
    toast((res.linked.length ? 'Opened ' + res.linked.length + (res.linked.length === 1 ? ' file' : ' files') : 'Nothing opened') + failed);
  }

  // While a file-backed note is open and untouched, pick up changes made by other programs.
  async function pollCurrentFile() {
    const note = state.current;
    if (!note || !note.filePath || state.dirty || document.hidden || documentBusy()) return; // document edits in progress: never reload under them
    let res;
    try { res = await api.files.refresh(note.id); } catch (_) { return; }
    if (documentBusy()) return; // editing started during the check
    if (state.currentId !== note.id) return;
    if (res.missing) { showBanner('The file no longer exists at ' + note.filePath + '. Your last view is kept here as a plain note.'); return; }
    if (res.changed && !state.dirty) {
      const fresh = await api.notes.get(note.id);
      // Re-check after the second round trip: the user may have switched notes or started typing meanwhile.
      if (state.currentId !== note.id || state.dirty || state.inflight.has(note.id) || !fresh || documentBusy()) return; // a save that landed in the gap must not be overwritten
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
    src.reload(fresh.body);
    // A PDF, Word file or image is shown by its own viewer: show the new version there (a note that just became one, an
    // old .rtf or image, leaves the code editor too).
    if (isViewerOnlyFile(fresh)) { showCode(fresh, true); renderFileRow(fresh); updateStatus(fresh); return; }
    if (H.isTableFile(fresh) && tableShown()) renderTable(fresh);
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
    await commitPdf(); // a stroke or text box in progress counts as an edit here
    if ((state.dirty || documentDirty()) && !window.confirm('Discard your unsaved edits and reload from disk?')) return;
    const id = state.currentId;
    state.dirty = false;
    forgetShownPdf(); // a PDF or Word document is shown again from the file even if it did not change, dropping its edits
    forgetShownDocx();
    for (const c of Object.values(crafts)) c.forget();
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
    scheduleOutline();
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
            refreshRow(updated);
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
          if (idx !== -1) { state.notes[idx] = updated; refreshRow(updated); }
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
  // Saves the open note: a PDF's or Word document's edits, then the text. opts.fromBlur: the window only lost focus (see flushPdf).
  // Resolves false if anything is still unsaved.
  async function flushSave(opts) {
    const docsSaved = await flushDocuments({ commit: !(opts && opts.fromBlur === true) });
    const textSaved = await flushTextSave();
    return docsSaved && textSaved;
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
      refreshRow(updated);
      if (state.settings.sort === 'updated' && idx !== 0) await refresh({ keepEditor: true });
      else if (updated.tags.join(',') !== prevTags) await refresh({ keepEditor: true });
    }
    // Tags may have changed: cheap to refresh the tag list.
    api.notes.tags().then(renderTags);
    return true;
  }

  // opts.title starts the note with that title (the palette's "New note ..."). A click handler passes an event: ignored.
  async function newNote(opts) {
    const title = opts && typeof opts.title === 'string' ? opts.title.trim() : '';
    await flushSave();
    if (state.view === 'trash') {
      state.view = 'all';
      el.navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === 'all'));
    }
    const data = {};
    if (state.view === 'tag' && state.tag) data.tags = [state.tag];
    if (state.view === 'pinned') data.pinned = true;
    if (state.view === 'folder' && state.folderId) data.folderId = state.folderId;
    if (title) data.title = title;
    let note;
    try { note = await api.notes.create(data); }
    catch (err) { toast('Could not create a note: ' + (err.message || err)); return; }
    state.query = '';
    el.searchInput.value = '';
    await refresh({ keepEditor: true });
    await openNote(note.id, { newTab: true, focus: title ? 'body' : 'title' });
  }

  function renderPinButton(on) {
    setPressed(el.pinBtn, on);
    el.pinBtn.title = on ? 'Unpin (Ctrl+D)' : 'Pin to the top (Ctrl+D)';
    el.pinBtn.setAttribute('aria-label', on ? 'Unpin note' : 'Pin note');
  }

  async function togglePin() {
    if (!state.current || state.current.trashedAt) return;
    await flushSave();
    const updated = await api.notes.togglePin(state.currentId);
    state.current = updated;
    renderPinButton(updated.pinned);
    await refresh({ keepEditor: true });
    toast(updated.pinned ? 'Pinned' : 'Unpinned');
  }

  async function trashCurrent() {
    if (!state.current || state.current.trashedAt) return;
    const id = state.currentId;
    const title = H.deriveTitle(state.current);
    await flushSave();
    if (documentDirty() && !window.confirm('Your changes to this document could not be saved. Move it to the trash anyway and lose them?')) return;
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

  // ---- the code editor: see code-editor.js ----

  const { showCode } = createCodeEditor({ runFind, autoGrow, scrollTextareaToSelection });

  // ---- editor text helpers: see editor-text.js ----

  const { wrapSelection, handleEditorKeydown } = createEditorText({ runFind, scheduleSave });

  // ---- settings dialog -----------------------------------------------------

  function openSettings() {
    const s = state.settings;
    draft = {};
    el.hotkeyInput.value = H.displayAccelerator(s.hotkey).replace(/ /g, '');
    el.hotkeyError.textContent = '';
    el.themeSelect.value = s.theme;
    renderSchemeGrid();
    syncSettingsDirty();
    el.fontSizeInput.value = s.fontSize;
    el.fontSizeValue.textContent = s.fontSize + 'px';
    el.openAtLoginInput.checked = s.openAtLogin;
    el.alwaysOnTopInput.checked = s.alwaysOnTop;
    syncAlignSeg(s.editorAlign);
    el.sidebarFloatInput.checked = !!s.sidebarCollapsed;
    el.editorFullWidthInput.checked = !s.editorWidth;
    el.editorWidthInput.disabled = !s.editorWidth;
    el.editorWidthInput.value = s.editorWidth || 760;
    el.editorWidthValue.textContent = (s.editorWidth || 760) + 'px';
    el.gitEnabledInput.checked = s.gitEnabled;
    el.gitRemoteInput.value = s.gitRemote;
    populateVoices();
    el.settingsSearch.value = '';
    filterSettings();
    el.settingsDialog.showModal();
    renderVaultList();
    el.ttsRateInput.value = s.ttsRate;
    el.ttsRateValue.textContent = Number(s.ttsRate).toFixed(1) + '×';
    refreshGitStatus();
    el.settingsScroll.scrollTop = 0;
    markSettingsSection();
    el.settingsSearch.focus(); // Ctrl+, then type: the fastest way to a setting
  }

  // ---- the settings draft ---------------------------------------------------
  // Settings changed in the dialog are held here, shown on the page as a preview, and written only by Save changes.
  // Closing the dialog with changes (Esc, Cancel, a click outside) asks first. Actions in the dialog (Commit now,
  // Add a folder, Import) are not settings and run at once.
  let draft = {};
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  const draftSettings = () => Object.assign({}, state.settings, draft);
  function settingsDirty() { return Object.keys(draft).some((k) => !same(draft[k], state.settings[k])); }
  function setDraft(patch) {
    for (const k of Object.keys(patch)) { if (same(patch[k], state.settings[k])) delete draft[k]; else draft[k] = patch[k]; }
    previewSettings();
    syncSettingsDirty();
  }
  // What can be seen changes on the page as it is picked: theme and colours, text size, the writing column.
  function previewSettings() {
    const s = draftSettings();
    applyTheme(s);
    document.documentElement.style.setProperty('--editor-font-size', s.fontSize + 'px');
    applyEditorLayout(s);
    renderSchemeGrid();
  }
  function syncSettingsDirty() {
    const dirty = settingsDirty();
    el.saveSettingsBtn.disabled = !dirty;
    el.settingsDirtyNote.textContent = dirty ? 'Unsaved changes' : '';
    el.cancelSettingsBtn.textContent = dirty ? 'Cancel' : 'Close';
    // History's buttons act on the saved settings: while those fields are unsaved they wait for Save changes.
    const gitPending = 'gitEnabled' in draft || 'gitRemote' in draft;
    el.gitCommitBtn.disabled = gitPending || el.gitCommitBtn.dataset.off === '1';
    el.gitPushBtn.disabled = gitPending || el.gitPushBtn.dataset.off === '1';
  }
  async function saveSettings() {
    if (!settingsDirty()) { closeSettings(); return true; }
    const patch = Object.assign({}, draft);
    const res = await updateSettings(patch);
    draft = {};
    if (res.error) {
      // The hotkey could not be bound: everything else was saved; the dialog stays open on the problem.
      el.hotkeyError.textContent = res.error;
      el.hotkeyInput.value = H.displayAccelerator(res.settings.hotkey).replace(/ /g, '');
      syncSettingsDirty();
      el.hotkeyInput.focus();
      return false;
    }
    if ('gitEnabled' in patch || 'gitRemote' in patch) refreshGitStatus();
    closeSettings();
    toast(patch.hotkey ? 'Settings saved. Hotkey is now ' + res.info.hotkeyDisplay : 'Settings saved');
    return true;
  }
  function discardSettings() {
    draft = {};
    applySettings(state.settings); // the preview goes; the page shows what is saved
    closeSettings();
  }
  function closeSettings() {
    draft = {};
    el.settingsDialog.close();
  }
  // Esc, Cancel or a click outside: straight out when nothing changed, otherwise the question.
  function requestCloseSettings() {
    if (!settingsDirty()) { closeSettings(); return; }
    const names = Object.keys(draft).filter((k) => !same(draft[k], state.settings[k])).map((k) => SETTING_NAMES[k] || k);
    el.settingsSaveList.textContent = 'Not saved yet: ' + names.join(', ') + '.';
    el.settingsSaveDialog.showModal();
  }
  // An action in the dialog that goes on to close it (a vault added, notes imported) keeps unsaved changes by
  // saving them: nothing the person set should be lost on the way out.
  async function leaveSettings() {
    if (settingsDirty()) await saveSettings(); else closeSettings();
  }

  // What each setting is called in the "Save your changes?" question.
  const SETTING_NAMES = {
    hotkey: 'Global hotkey', theme: 'Theme', colorScheme: 'Colour scheme', customColors: 'Custom colours', sidebarCollapsed: 'Hide the sidebar',
    openAtLogin: 'Start at sign-in', alwaysOnTop: 'Keep above other windows', fontSize: 'Text size', editorWidth: 'Column width', editorAlign: 'Column position',
    ttsVoice: 'Read-aloud voice', ttsRate: 'Read-aloud speed', gitEnabled: 'Git history', gitRemote: 'Git remote',
  };

  // ---- Appearance: scheme swatches and custom colours --------------------------
  const T = () => NotesThemes;
  function renderSchemeGrid() {
    const s = draftSettings();
    const mode = effectiveTheme(s);
    const ids = Object.keys(T().SCHEMES).concat(T().CUSTOM);
    if (el.schemeGrid.children.length !== ids.length) {
      el.schemeGrid.innerHTML = '';
      for (const id of ids) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'scheme-swatch'; b.dataset.scheme = id; b.setAttribute('role', 'radio');
        const sample = document.createElement('span'); sample.className = 'swatch-sample'; sample.setAttribute('aria-hidden', 'true');
        const aa = document.createElement('span'); aa.textContent = 'Aa';
        const dot = document.createElement('span'); dot.className = 'swatch-accent';
        sample.append(aa, dot);
        sample.insertAdjacentHTML('beforeend', I('check'));
        sample.lastElementChild.classList.add('swatch-check');
        const name = document.createElement('span'); name.className = 'swatch-name'; name.textContent = id === T().CUSTOM ? 'Custom' : T().SCHEMES[id].name;
        b.append(sample, name);
        el.schemeGrid.append(b);
      }
    }
    for (const b of el.schemeGrid.children) {
      const id = b.dataset.scheme;
      const picked = s.customColors && s.customColors[mode];
      const sw = id === T().CUSTOM && !picked ? T().swatch(s.colorScheme, s.customColors, mode) : T().swatch(id, s.customColors, mode);
      const sample = b.firstChild;
      sample.style.background = sw.paper; sample.style.color = sw.text; sample.querySelector('.swatch-accent').style.background = sw.accent;
      const on = id === s.colorScheme;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    // The pickers show the colours of the mode on screen: the custom ones, or the chosen scheme's as a start.
    const seed = T().seedsOf(s.colorScheme, s.customColors, mode);
    el.customBgInput.value = seed.background; el.customTextInput.value = seed.text; el.customAccentInput.value = seed.accent;
    el.customModeNote.textContent = '(' + mode + ')';
    el.schemeResetBtn.disabled = s.colorScheme === T().BUILT_IN;
  }
  function chooseScheme(id) { setDraft({ colorScheme: id }); }
  // A picked colour makes the scheme custom, for the mode on screen, starting from the chosen scheme's colours.
  function pickCustomColor() {
    const s = draftSettings();
    const mode = effectiveTheme(s);
    const custom = Object.assign({}, s.customColors || {});
    custom[mode] = { background: el.customBgInput.value, text: el.customTextInput.value, accent: el.customAccentInput.value };
    setDraft({ colorScheme: T().CUSTOM, customColors: custom });
  }
  function bindAppearance() {
    el.schemeGrid.addEventListener('click', (e) => { const b = e.target.closest('.scheme-swatch'); if (b) chooseScheme(b.dataset.scheme); });
    el.schemeGrid.addEventListener('keydown', (e) => {
      const cols = getComputedStyle(el.schemeGrid).gridTemplateColumns.split(' ').length;
      const step = { ArrowRight: 1, ArrowDown: cols, ArrowLeft: -1, ArrowUp: -cols }[e.key];
      if (!step) return;
      e.preventDefault();
      const all = [...el.schemeGrid.children];
      const i = all.findIndex((b) => b.getAttribute('aria-checked') === 'true');
      const next = all[Math.max(0, Math.min(all.length - 1, i + step))];
      if (next === all[i]) return;
      chooseScheme(next.dataset.scheme);
      next.focus();
    });
    for (const input of [el.customBgInput, el.customTextInput, el.customAccentInput]) input.addEventListener('input', pickCustomColor);
    el.schemeResetBtn.addEventListener('click', () => setDraft({ colorScheme: T().BUILT_IN, customColors: null }));
  }

  // The settings nav: a link jumps to its section, and the section in view is the one marked.
  function markSettingsSection() {
    const top = el.settingsScroll.getBoundingClientRect().top;
    const sections = [...el.settingsScroll.querySelectorAll('.settings-section')].filter((s) => s.offsetParent);
    let current = sections[0];
    for (const sec of sections) if (sec.getBoundingClientRect().top - top < 80) current = sec;
    // At the bottom, the last section is the one being read even if it is short.
    if (el.settingsScroll.scrollTop + el.settingsScroll.clientHeight >= el.settingsScroll.scrollHeight - 4) current = sections[sections.length - 1];
    el.settingsNav.querySelectorAll('a').forEach((a) => a.classList.toggle('is-active', !!current && a.getAttribute('href') === '#' + current.id));
  }

  function bindSettingsNav() {
    el.settingsNav.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      e.preventDefault();
      // A section the search had hidden comes back whole when its link is clicked.
      if (a.classList.contains('is-dim')) { el.settingsSearch.value = ''; filterSettings(); }
      const sec = el.settingsScroll.querySelector(a.getAttribute('href'));
      if (sec) sec.scrollIntoView({ block: 'start' });
    });
    el.settingsScroll.addEventListener('scroll', markSettingsSection, { passive: true });
    el.settingsSearch.addEventListener('input', filterSettings);
    el.settingsSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault(); // the form would submit and close the dialog
      else if (e.key === 'Escape' && el.settingsSearch.value) { e.preventDefault(); e.stopPropagation(); el.settingsSearch.value = ''; filterSettings(); }
    });
    el.settingsDialog.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); el.settingsSearch.focus(); el.settingsSearch.select(); }
    });
  }

  // Search in Settings: every word typed must appear in a setting's label, help, options or buttons. Settings that
  // do not match hide, so do sections left empty (their nav links dim; a click on one clears the search). Matches
  // are marked with the CSS Custom Highlight API, which leaves the fields' DOM alone.
  function filterSettings() {
    const tokens = H.tokenize(el.settingsSearch.value);
    const ranges = [];
    let any = false;
    for (const sec of el.settingsScroll.querySelectorAll('.settings-section')) {
      let hits = 0;
      for (const unit of sec.children) {
        if (unit.tagName === 'H3') continue;
        const text = unit.textContent.toLowerCase();
        const ok = tokens.every((t) => text.includes(t));
        unit.classList.toggle('is-filtered', !ok);
        if (!ok) continue;
        hits++;
        if (tokens.length) collectMatches(unit, tokens, ranges);
      }
      sec.classList.toggle('is-filtered', tokens.length > 0 && !hits);
      const link = el.settingsNav.querySelector('a[href="#' + sec.id + '"]');
      if (link) link.classList.toggle('is-dim', tokens.length > 0 && !hits);
      if (hits) any = true;
    }
    el.settingsEmpty.classList.toggle('hidden', any);
    if (window.CSS && CSS.highlights) {
      if (ranges.length) CSS.highlights.set('settings-match', new Highlight(...ranges));
      else CSS.highlights.delete('settings-match');
    }
    markSettingsSection();
  }

  function collectMatches(root, tokens, out) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      const text = node.textContent.toLowerCase();
      for (const t of tokens) {
        for (let i = text.indexOf(t); i !== -1; i = text.indexOf(t, i + t.length)) {
          const r = new Range();
          r.setStart(node, i);
          r.setEnd(node, i + t.length);
          out.push(r);
        }
      }
    }
  }

  function syncListModeSeg() {
    const mode = state.settings.listMode;
    el.listModeSeg.querySelectorAll('button').forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
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
    el.gitPushBtn.dataset.off = !s.enabled || !s.remote ? '1' : '0';
    el.gitCommitBtn.dataset.off = !s.enabled ? '1' : '0';
    syncSettingsDirty();
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

  function commitHotkey(value) {
    const parsed = H.parseAccelerator(value);
    if (!parsed.ok) { el.hotkeyError.textContent = parsed.reason; return; }
    el.hotkeyError.textContent = '';
    el.hotkeyInput.value = H.displayAccelerator(parsed.value).replace(/ /g, '');
    setDraft({ hotkey: parsed.value });
  }

  // ---- the command palette (Ctrl+P) -----------------------------------------------------------
  // Every command in the app, plus every note. Items backed by a button use the button itself, so a command is
  // offered exactly when its button would be usable, under the same name, and does exactly what the button does.

  let palette = null;
  function openPalette(query) {
    if (!palette) palette = NotesPalette.create({ dialog: el.palette, input: el.paletteInput, list: el.paletteList, source: paletteItems });
    closeMoreMenu(); closeShareMenu();
    palette.open(query);
  }

  const buttonWords = (b) => ((b.querySelector('.lbl') || {}).textContent || b.getAttribute('aria-label') || b.textContent || '').trim();
  const shortcutIn = (b) => ((b.querySelector('.keys') || {}).textContent || (/\((Ctrl[^)]*|F\d+|Esc)\)/.exec(b.title || '') || [])[1] || '').trim();
  // Usable: not hidden by the app, not disabled, not removed by the page's own CSS (the right side hides some).
  const usable = (b) => !!b && !b.disabled && !b.classList.contains('hidden') && getComputedStyle(b).display !== 'none';

  function commandList() {
    const noteOpen = !!state.current && !el.editor.classList.contains('hidden');
    const fromButton = (b, group, extra) => Object.assign({ id: b.id, group, title: buttonWords(b), icon: b.dataset.icon, keys: shortcutIn(b), ok: usable(b) && (group !== 'This note' || noteOpen), run: () => b.click() }, extra);
    const cmd = (id, group, title, icon, keys, run, ok, keywords) => ({ id, group, title, icon, keys, run, ok: ok === undefined ? true : ok, keywords });
    // On the right side of a split, these run on the left side (which has the sidebar and list), as their keys do.
    const side = (name, fn) => (GUEST ? () => toPeer({ type: 'command', name }) : fn);
    if (noteOpen) syncShareMenu();
    const list = [
      cmd('new-note', 'Create', 'New note', 'square-pen', 'Ctrl+N', side('newNote', newNote)),
      cmd('open-file', 'Create', 'Open a file as a note…', 'folder-open', 'Ctrl+O', side('openFiles', () => openFiles()), true, 'markdown pdf word docx txt'),
      cmd('new-folder', 'Create', 'New folder', 'folder-plus', 'Ctrl+Shift+N', () => startCreateFolder(state.view === 'folder' ? state.folderId : null), !GUEST),
      cmd('new-book', 'Create', 'New book', 'book-plus', '', () => startCreateFolder(null, true), !GUEST),
      fromButton(el.pinBtn, 'This note', { title: state.current && state.current.pinned ? 'Unpin' : 'Pin to the top', keys: 'Ctrl+D' }),
      fromButton(el.sourceBtn, 'This note', { title: state.sourceMode ? 'Show the rendered view' : 'Show Markdown source', keys: 'Ctrl+E' }),
      cmd('find', 'This note', 'Find in this note', 'search', 'Ctrl+Shift+F', () => openFind(), noteOpen),
      cmd('image-size', 'This note', 'Image: actual size, or fitted to the pane', 'zoom-in', 'Enter on the picture', () => toggleImageSize(), !!(state.current && state.current.fileKind === 'image'), 'zoom 100% fit picture'),
      cmd('replace', 'This note', 'Find and replace', 'replace', 'Ctrl+H', () => { if (!find.open) openFind(); toggleReplace(true); }, noteOpen),
      ...[...el.moreMenu.querySelectorAll('.menu-item')].map((b) => fromButton(b, 'This note')),
      fromButton(el.restoreBtn, 'This note'),
      fromButton(el.destroyBtn, 'This note'),
      ...[...el.shareMenu.querySelectorAll('button[data-action]')].map((b) => ({ id: 'share-' + b.dataset.action, group: 'Share', title: b.textContent.trim(), icon: 'share-2', keys: '', ok: noteOpen && !state.current.trashedAt && !b.classList.contains('hidden'), run: () => shareAction(b.dataset.action) })),
      cmd('sidebar', 'View', sidebarLayout() === 'docked' ? 'Hide the sidebar' : 'Show the sidebar', 'panel-left', 'Ctrl+\\', toggleSidebar, !GUEST, 'auto hide float compact zen'),
      cmd('list', 'View', el.app.classList.contains('list-collapsed') ? 'Show the note list' : 'Hide the note list', 'list', 'Ctrl+Shift+\\', toggleList, !GUEST),
      cmd('list-mode', 'View', state.settings && state.settings.listMode === 'tree' ? 'Note list: show as a list' : 'Note list: show folders with their notes', state.settings && state.settings.listMode === 'tree' ? 'list' : 'folder-open', '', () => updateSettings({ listMode: state.settings.listMode === 'tree' ? 'list' : 'tree' }).then(() => refresh({ keepEditor: true })), !GUEST, 'tree outline view'),
      cmd('focus', 'View', 'Focus: hide the sidebar and the list', 'eye', '', () => updateSettings({ sidebarCollapsed: true, listCollapsed: true }), !GUEST && !(state.settings && state.settings.sidebarCollapsed && state.settings.listCollapsed), 'zen distraction free writing'),
      cmd('width', 'View', state.settings && state.settings.editorWidth ? 'Writing column: full width' : 'Writing column: readable width', 'columns-2', '', () => updateSettings({ editorWidth: state.settings.editorWidth ? 0 : 760 }), !!state.settings, 'measure line length narrow wide'),
      fromButton(el.splitViewBtn, 'View', { title: 'Split view: open a second side', ok: usable(el.splitViewBtn) }),
      cmd('new-tab', 'View', 'New tab', 'plus', 'Ctrl+T', newEmptyTab),
      cmd('close-tab', 'View', 'Close this tab', 'x', 'Ctrl+W', () => closeTab(tabs.at), tabs.ids.length > 0),
      cmd('theme', 'View', effectiveTheme() === 'dark' ? 'Switch to light' : 'Switch to dark', 'sun-moon', 'Ctrl+Shift+L', () => updateSettings({ theme: effectiveTheme() === 'dark' ? 'light' : 'dark' }), true, 'theme dark light mode'),
      ...['all', 'pinned', 'reminders', 'trash'].map((v) => cmd('go-' + v, 'Go to', { all: 'All notes', pinned: 'Pinned', reminders: 'Reminders', trash: 'Trash' }[v], { all: 'notebook-text', pinned: 'star', reminders: 'bell', trash: 'trash-2' }[v], '', () => setView(v), !GUEST)),
      ...flattenTree(state.tree).map((f) => cmd('folder-' + f.id, 'Go to', (f.book ? 'Book: ' : 'Folder: ') + f.name, f.book ? 'book-open' : 'folder', '', () => setView('folder', f.id), !GUEST)),
      ...[...el.tagList.querySelectorAll('.nav-item')].map((b) => cmd('tag-' + b.firstChild.textContent, 'Go to', 'Tag: #' + b.firstChild.textContent, 'hash', '', () => b.click(), !GUEST)),
      cmd('settings', 'App', 'Settings', 'settings', 'Ctrl+,', side('settings', openSettings), true, 'preferences options hotkey font search'),
      ...Object.keys(NotesThemes.SCHEMES).map((id) => cmd('scheme-' + id, 'View', 'Colour scheme: ' + NotesThemes.SCHEMES[id].name, 'palette', '', () => updateSettings({ colorScheme: id }), !GUEST && (state.settings && state.settings.colorScheme) !== id, 'theme colors appearance')),
      cmd('scheme-custom', 'View', 'Colour scheme: custom colours…', 'palette', '', side('settings', () => { openSettings(); document.getElementById('set-appearance').scrollIntoView({ block: 'start' }); }), true, 'theme colors appearance pick'),
      cmd('import', 'App', 'Import Markdown files…', 'download', '', () => el.importBtn.click(), !GUEST),
      cmd('export-all', 'App', 'Export all notes…', 'download', '', () => el.exportAllBtn.click(), !GUEST, 'backup json'),
      cmd('data-folder', 'App', 'Open the data folder', 'folder-open', '', () => el.dataFolderBtn.click(), !GUEST),
      cmd('hide', 'App', 'Hide Notes', 'x', 'Esc', () => flushSave().then(() => api.app.hide())),
    ];
    return list.filter((c) => c.ok && c.title);
  }

  async function paletteItems(query) {
    const commands = commandList();
    const commandsOnly = /^\s*>/.test(query);
    let notes = null;
    if (!commandsOnly) {
      const all = await api.notes.list({ sort: 'updated' });
      const folders = new Map(flattenTree(state.tree).map((f) => [f.id, f.name]));
      notes = all.filter((n) => n.id !== state.currentId).map((n) => ({
        id: 'note-' + n.id, group: 'Notes', title: H.deriveTitle(n), icon: n.filePath ? 'file-text' : n.locked ? 'lock' : n.pinned ? 'star' : 'notebook-text',
        hint: (n.folderId && folders.get(n.folderId)) || H.relativeTime(n.updatedAt),
        matches: (q) => !n.locked && H.matchesQuery(n, q),
        run: (opts) => (opts.newTab ? openNote(n.id, { newTab: true }) : scopeListToNote(n).then(() => openNote(n.id))).then(() => focusBody()),
      }));
    }
    const out = NotesPalette.rank(query, commands, notes);
    const title = query.replace(/^\s*>\s*/, '').trim();
    if (title && !commandsOnly) out.push({ id: 'create', group: 'Create', title: 'New note "' + H.truncate(title, 60) + '"', icon: 'square-pen', keys: '', run: () => (GUEST ? toPeer({ type: 'command', name: 'newNote', title }) : newNote({ title })) });
    return out;
  }

  // ---- global keyboard -----------------------------------------------------

  function onKeydown(e) {
    if (e.isComposing || e.keyCode === 229) return; // never hide the window or act on a key an IME is still composing
    const ctrl = e.ctrlKey || e.metaKey;
    const inDialog = el.palette.open || el.settingsDialog.open || el.splitDialog.open || el.linkDialog.open || el.remindDialog.open || el.lockDialog.open || el.liveDialog.open || el.historyDialog.open || el.signDialog.open;
    if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's' && (pdfOpen() || docxOpen())) {
      e.preventDefault();
      if (pdfOpen()) flushPdf({ commit: true, explicit: true });
      if (docxOpen()) flushDocx({ explicit: true });
      return;
    }
    if (e.key === 'Escape') {
      if (inDialog) return; // dialog handles it
      if (el.pdfEditor.contains(document.activeElement)) return; // pdf.js ends the edit in progress; the window stays
      if (find.open) { e.preventDefault(); closeFind(); return; }
      if (!el.moreMenu.classList.contains('hidden')) { e.preventDefault(); closeMoreMenu(); el.moreBtn.focus(); return; }
      if (!el.shareMenu.classList.contains('hidden')) { e.preventDefault(); closeShareMenu(); el.shareBtn.focus(); return; }
      if (!el.convertMenu.classList.contains('hidden')) { e.preventDefault(); closeConvertMenu(); el.fileConvertBtn.focus(); return; }
      if (!el.lockMenu.classList.contains('hidden')) { e.preventDefault(); el.lockMenu.classList.add('hidden'); el.lockBtn.focus(); return; }
      if (state.menuFolderId) { e.preventDefault(); closeFolderMenu(); return; }
      if (!el.pageMenu.classList.contains('hidden') || !el.bookMenu.classList.contains('hidden')) { e.preventDefault(); closeAllBookMenus(); return; }
      if (sidebarPeek) { e.preventDefault(); unpeekSidebar(); return; }
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
    if (GUEST && ctrl && !e.altKey) {
      const k = e.key.toLowerCase();
      const cmd = e.shiftKey ? (k === 'n' ? 'newFolder' : null) : ({ n: 'newNote', f: 'search', o: 'openFiles', ',': 'settings' })[k];
      if (cmd) { e.preventDefault(); toPeer({ type: 'command', name: cmd }); return; }
    }
    if (ctrl && !e.altKey && e.key === 'Tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); return; }
    if (ctrl && !e.shiftKey && !e.altKey) {
      switch (e.key.toLowerCase()) {
        case 't': e.preventDefault(); newEmptyTab(); return;
        case 'w': e.preventDefault(); closeTab(tabs.at); return;
        case 'n': e.preventDefault(); newNote(); return;
        case 'o': e.preventDefault(); openFiles(); return;
        case 'l': e.preventDefault(); onLockButton(); return;
        case 'h': e.preventDefault(); if (!find.open) openFind(); toggleReplace(true); return;
        case 'f': e.preventDefault(); showList().then(() => { el.searchInput.focus(); el.searchInput.select(); }); return;
        case 'e': e.preventDefault(); if (state.current) toggleSource(); return;
        case 'p': e.preventDefault(); openPalette(); return;
        case 'd': e.preventDefault(); togglePin(); return;
        case 's': e.preventDefault(); flushSave().then((ok) => toast(ok ? 'Saved' : 'Save failed, will retry')); return;
        case ',': e.preventDefault(); openSettings(); return;
        case '\\': e.preventDefault(); toggleSidebar(); return;
        // Ctrl+Delete deletes the next word inside text fields; only trash when focus is elsewhere.
        case 'delete': if (!inTextField()) { e.preventDefault(); trashCurrent(); } return;
        // In the rendered view, Ctrl+B and Ctrl+I are handled by the editor itself.
        case 'b': if (document.activeElement === el.bodyInput && !isPlainTextFile(state.current)) { e.preventDefault(); wrapSelection('**', '**'); } return;
        case 'i': if (document.activeElement === el.bodyInput && !isPlainTextFile(state.current)) { e.preventDefault(); wrapSelection('_', '_'); } return;
        case 'k':
          if (document.activeElement === el.bodyInput) { if (!isPlainTextFile(state.current)) { e.preventDefault(); wrapSelection('[', '](url)'); } }
          else if (bodyHasFocus() && !src.codeOn) { e.preventDefault(); openLinkDialog(); }
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
    el.emptyNewNoteBtn.addEventListener('click', newNote);
    el.paletteBtn.addEventListener('click', () => openPalette());
    el.moreBtn.addEventListener('click', () => { if (el.moreMenu.classList.contains('hidden')) openMoreMenu(); else closeMoreMenu(); });
    // Every item does its job and closes the menu; the item's own click handler runs first.
    el.moreMenu.addEventListener('click', (e) => { if (e.target.closest('.menu-item')) closeMoreMenu(); });
    bindMenuKeys();
    bindSettingsNav();
    bindSidebarFloat();
    el.tagsFold.addEventListener('click', () => updateSettings({ tagsCollapsed: !state.settings.tagsCollapsed }));
    bindTreeKeys(el.folderTree);
    bindTreeKeys(el.noteTree);
    el.listModeSeg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (b) updateSettings({ listMode: b.dataset.mode }).then(() => { syncListModeSeg(); refresh({ keepEditor: true }); });
    });
    el.sidebarFloatInput.addEventListener('change', () => { sidebarPeek = null; setDraft({ sidebarCollapsed: el.sidebarFloatInput.checked }); });
    el.openFileBtn.addEventListener('click', () => openFiles());
    el.fileRevealBtn.addEventListener('click', () => state.currentId && api.files.reveal(state.currentId));
    bindDocxEvents();
    bindPdfEvents();
    el.fileConvertBtn.addEventListener('click', () => { if (el.convertMenu.classList.contains('hidden')) openConvertMenu(); else closeConvertMenu(); });
    el.convertMenu.addEventListener('click', (e) => { const b = e.target.closest('[data-to]'); if (b) convertCurrent(b.dataset.to); });
    el.fileOpenBtn.addEventListener('click', async () => { if (!state.currentId) return; const err = await api.files.openExternal(state.currentId); if (err) toast('Could not open: ' + err); });
    el.fileReloadBtn.addEventListener('click', reloadCurrentFile);
    // Images: a click or Enter toggles fitted and actual size; the status line gives the picture's size.
    el.imageView.addEventListener('click', toggleImageSize);
    el.imageView.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleImageSize(); } });
    el.imageView.addEventListener('load', syncImageToggle);
    el.imageView.addEventListener('error', () => {
      if (!el.imageView.getAttribute('src')) return; // cleared on purpose
      showBanner('This image could not be shown: the file may be damaged, or in a format Notes cannot show. Use "Open with…" to open it.');
    });
    el.agentFilesBtn.addEventListener('click', addAgentFiles);
    el.vaultAddFolderBtn.addEventListener('click', addVaultFolder);
    el.vaultCloneBtn.addEventListener('click', openCloneDialog);
    el.vaultDestBtn.addEventListener('click', async () => { const d = await api.vaults.pickFolder(); if (d) el.vaultDestInput.value = d; });
    el.vaultCancelBtn.addEventListener('click', () => el.vaultDialog.close());
    el.vaultForm.addEventListener('submit', (e) => { e.preventDefault(); submitClone(); });
    fromMain('vaultStatus', ({ id, status }) => {
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
    fromMain('liveStatus', ({ id, status }) => {
      if (status && status.ended) { delete state.liveStatus[id]; if (state.current && state.current.id === id) { refreshCurrentMeta(); toast('The host ended the live share. Your copy of the note stays.'); } return; }
      if (status) state.liveStatus[id] = status; else delete state.liveStatus[id];
      if (state.current && state.current.id === id) { if (!status && state.current.live) refreshCurrentMeta(); else renderLiveRow(state.current); }
    });
    el.lockMenu.addEventListener('click', (e) => { const b = e.target.closest('[data-action]'); if (b) lockMenuAction(b.dataset.action); });
    el.lockForm.addEventListener('submit', (e) => { e.preventDefault(); submitLockDialog(); });
    el.lockCancelBtn.addEventListener('click', () => el.lockDialog.close());
    el.lockDialog.addEventListener('close', () => focusBody());
    el.lockScreen.addEventListener('submit', (e) => { e.preventDefault(); unlockFromScreen(); });
    fromMain('relocked', async (ids) => {
      // Plaintext kept for a retry must go too: it can no longer be saved (ELOCKED) and must not linger.
      for (const id of ids) state.pending.delete(id);
      for (const id of ids) tabs.titles.delete(id); // a tab title can be the first line of the unlocked text
      renderTabs();
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
    api.on.editCommand(runEditCommand);
    api.on.reminderFired(({ id, title }) => {
      toast('⏰ ' + (title || 'Reminder'), { label: 'Open', run: async () => { await setView('all'); await openNote(id, { focus: 'body' }); } });
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
    fromMain('stickiesChanged', () => { refreshCurrentMeta(); });
    api.on.openNote(async (id) => { await setView('all'); await openNote(id, { focus: 'body' }); });
    el.botBtn.addEventListener('click', () => toggleBot());
    el.botCloseBtn.addEventListener('click', () => toggleBot(false));
    el.botRunBtn.addEventListener('click', runBot);
    el.botTerminalBtn.addEventListener('click', openBotTerminal);
    el.botPrompt.addEventListener('keydown', (e) => { e.stopPropagation(); if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runBot(); } if (e.key === 'Escape') { e.preventDefault(); toggleBot(false); } });
    api.on.botEvent(onBotEvent);
    if (window.speechSynthesis) { populateVoices(); window.speechSynthesis.addEventListener('voiceschanged', populateVoices); }
    el.ttsVoiceSelect.addEventListener('change', () => setDraft({ ttsVoice: el.ttsVoiceSelect.value }));
    el.ttsRateInput.addEventListener('input', () => { el.ttsRateValue.textContent = Number(el.ttsRateInput.value).toFixed(1) + '×'; });
    el.ttsRateInput.addEventListener('change', () => setDraft({ ttsRate: Number(el.ttsRateInput.value) }));
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
    el.toggleSidebarBtn.addEventListener('click', toggleSidebar);
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
      if (!el.moreMenu.classList.contains('hidden') && !el.moreMenu.contains(e.target) && !el.moreBtn.contains(e.target)) closeMoreMenu();
      if (!el.convertMenu.classList.contains('hidden') && !el.convertMenu.contains(e.target) && !el.fileConvertBtn.contains(e.target)) closeConvertMenu();
      if (!el.lockMenu.classList.contains('hidden') && !el.lockMenu.contains(e.target) && !el.lockBtn.contains(e.target)) el.lockMenu.classList.add('hidden');
    });
    wireDropTarget(el.navAll, null); // dropping on "All notes" moves a note or folder to the top level
    window.addEventListener('resize', () => {
      if (!state.settings) return;
      applySidebar();
      applyPaneWidths(state.settings.sidebarWidth, state.settings.listWidth);
    });

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
    el.alignSeg.querySelectorAll('button[data-align]').forEach((b) => b.addEventListener('click', () => { setDraft({ editorAlign: b.dataset.align }); syncAlignSeg(b.dataset.align); }));
    el.editorWidthInput.addEventListener('input', () => {
      el.editorWidthValue.textContent = el.editorWidthInput.value + 'px';
      el.editorColumn.style.setProperty('--editor-col-width', el.editorWidthInput.value + 'px');
    });
    el.editorWidthInput.addEventListener('change', () => setDraft({ editorWidth: Number(el.editorWidthInput.value) }));
    el.editorFullWidthInput.addEventListener('change', () => {
      const full = el.editorFullWidthInput.checked;
      el.editorWidthInput.disabled = full;
      setDraft({ editorWidth: full ? 0 : Number(el.editorWidthInput.value) || 760 });
    });

    // Git history
    el.gitEnabledInput.addEventListener('change', () => setDraft({ gitEnabled: el.gitEnabledInput.checked }));
    const commitRemote = () => setDraft({ gitRemote: el.gitRemoteInput.value.trim() });
    el.gitRemoteInput.addEventListener('change', commitRemote);
    el.gitRemoteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitRemote(); } });
    el.gitCommitBtn.addEventListener('click', async () => { await flushSave(); const r = await api.git.commit(); toast(r.ok ? (r.nothingToCommit ? 'Nothing new to commit' : 'Committed') : 'Commit failed: ' + (r.error || r.skipped)); refreshGitStatus(); });
    el.gitPushBtn.addEventListener('click', async () => { const r = await api.git.push(); toast(r.ok ? 'Pushed' : 'Push failed: ' + (r.error || r.skipped)); refreshGitStatus(); });
    fromMain('gitStatus', (s) => renderGitStatus(s));
    el.exportBtn.addEventListener('click', exportCurrent);
    el.duplicateBtn.addEventListener('click', duplicateCurrent);
    el.splitBtn.addEventListener('click', openSplitDialog);
    el.splitForm.addEventListener('submit', (e) => { e.preventDefault(); applySplit(); });
    el.splitCancelBtn.addEventListener('click', () => { state.splitNoteId = null; el.splitDialog.close(); });
    el.restoreBtn.addEventListener('click', restoreCurrent);
    el.deleteBtn.addEventListener('click', trashCurrent);
    el.destroyBtn.addEventListener('click', destroyCurrent);

    el.titleInput.addEventListener('input', scheduleSave);
    el.titleInput.addEventListener('input', renderActiveTabTitle);
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
      if (v && !v.endsWith('+') && v !== H.displayAccelerator(draftSettings().hotkey).replace(/ /g, '')) commitHotkey(v);
      else if (!v || v.endsWith('+')) el.hotkeyInput.value = H.displayAccelerator(draftSettings().hotkey).replace(/ /g, '');
    });
    el.themeSelect.addEventListener('change', () => setDraft({ theme: el.themeSelect.value }));
    el.fontSizeInput.addEventListener('input', () => {
      el.fontSizeValue.textContent = el.fontSizeInput.value + 'px';
      document.documentElement.style.setProperty('--editor-font-size', el.fontSizeInput.value + 'px');
    });
    el.fontSizeInput.addEventListener('change', () => setDraft({ fontSize: Number(el.fontSizeInput.value) }));
    el.openAtLoginInput.addEventListener('change', () => setDraft({ openAtLogin: el.openAtLoginInput.checked }));
    el.alwaysOnTopInput.addEventListener('change', () => setDraft({ alwaysOnTop: el.alwaysOnTopInput.checked }));
    el.importBtn.addEventListener('click', async () => {
      let res;
      try { res = await api.app.importMarkdown(); }
      catch (err) { toast('Import failed: ' + (err.message || err)); return; }
      if (res.canceled) return;
      if (res.count) { await leaveSettings(); await refresh({ keepEditor: true }); if (res.firstId) await selectNote(res.firstId); }
      const failed = res.failed && res.failed.length ? '. Could not read: ' + res.failed.join(', ') : '';
      toast((res.count ? 'Imported ' + res.count + (res.count === 1 ? ' note' : ' notes') : 'Nothing imported') + failed);
    });
    el.exportAllBtn.addEventListener('click', async () => {
      try { const res = await api.app.exportAll(); if (res.ok) toast('Exported to ' + res.filePath); }
      catch (err) { toast('Export failed: ' + (err.message || err)); }
    });
    el.dataFolderBtn.addEventListener('click', () => api.app.openDataFolder());
    el.settingsDialog.addEventListener('close', () => { if (state.current) focusBody(); });
    el.settingsForm.addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });
    el.settingsDialog.addEventListener('cancel', (e) => { e.preventDefault(); requestCloseSettings(); }); // Esc
    el.cancelSettingsBtn.addEventListener('click', requestCloseSettings);
    el.settingsDialog.addEventListener('mousedown', (e) => { if (e.target === el.settingsDialog) requestCloseSettings(); }); // the backdrop
    el.settingsSaveDialog.addEventListener('cancel', (e) => { e.preventDefault(); el.settingsSaveDialog.close(); });
    el.settingsSaveKeepBtn.addEventListener('click', () => el.settingsSaveDialog.close());
    el.settingsSaveDiscardBtn.addEventListener('click', () => { el.settingsSaveDialog.close(); discardSettings(); });
    el.settingsSaveDialog.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); el.settingsSaveDialog.close(); saveSettings(); });
    bindAppearance();

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
    // Both sides write at once; main stops waiting after its own limit (longer on quit, for PDF and Word saves).
    api.on.flush(async () => { try { await Promise.all([flushSave().then(retryPending), flushPeer()]); } finally { api.app.flushDone(); } });
    fromMain('reloaded', async (info) => {
      const reason = info && info.reason;
      await refresh({ keepEditor: true });
      tabs.titles.clear(); // titles of notes in other tabs may have changed too
      renderTabs();
      // The store may now hold a newer body for the open note (a pull, a rescan, the bot). Show it, unless
      // the user is mid-edit; in that case leave their text and tell them.
      if (state.currentId) {
        const wanted = state.currentId;
        const fresh = await api.notes.get(wanted);
        if (fresh && fresh.id !== state.currentId) return; // the person moved on while we were asking
        if (!fresh && wanted === state.currentId && !state.dirty) { clearEditor(); if (!GUEST) await refresh(); return; }
        if (fresh && reason === 'live' && fresh.body === el.bodyInput.value && fresh.title !== el.titleInput.value && !state.dirty) { el.titleInput.value = fresh.title; state.current.title = fresh.title; refreshRow(fresh); }
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
    fromMain('settingsChanged', (s) => applySettings(s));
    fromMain('systemTheme', (t) => { state.systemDark = t === 'dark'; applyTheme(); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (ev) => { state.systemDark = ev.matches; applyTheme(); });

    // Keep "x min ago" labels honest.
    setInterval(() => { if (!document.hidden) { renderList(); if (state.current) updateStatus(state.current); } }, 60000);
  }

  async function init() {
    NotesIcons.hydrate(document);
    if (navigator.windowControlsOverlay) navigator.windowControlsOverlay.addEventListener('geometrychange', syncTitleBar);
    const [settings, info] = await Promise.all([api.settings.get(), api.app.info()]);
    if (GUEST) document.body.classList.add('pane-guest');
    createRichEditor();
    applySettings(settings);
    applyInfo(info);
    restoreTabs(settings);
    bind();
    bindTabs();
    // Start in the folder the list showed last time, if it still exists (refresh falls back to all notes).
    if (settings.lastFolderId) { state.view = 'folder'; state.folderId = settings.lastFolderId; el.navItems.forEach((b) => b.classList.remove('is-active')); }
    await refresh();
    if (GUEST) { toPeer({ type: 'hello' }); return; }
    if (!state.currentId && state.notes.length) await selectNote(state.notes[0].id); // a saved tab's note is gone
    if (panesOf(settings).split) openSplit(true);
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
