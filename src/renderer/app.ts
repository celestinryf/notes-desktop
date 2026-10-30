import * as H from '../shared/helpers.mts';
import * as FM from '../shared/front-matter.mts';
import * as NotesThemes from '../shared/themes.mts';
import NotesIcons from './icons.js';
import { NotesPalette } from './palette.ts';
import { I, el, setIcon, setLabel, setPressed } from './dom.ts';
import { state, lockedNow, settingsNow } from './state.ts';
import { find } from './find-state.ts';
import { escapeHtml, highlight, ipcErrorText, trashedMessage, trashLabel } from './text.ts';
import { toast } from './toast.ts';
import { bookMark, treeGroup, treeFocusKey, restoreTreeFocus, bindTreeKeys, setRowToggle } from './tree.ts';
import { placePopover } from './popover.ts';
import { openMoreMenu, closeMoreMenu, bindMenuKeys } from './more-menu.ts';
import { createBooks } from './books.ts';
import { createRelated } from './related.ts';
import { createReminders } from './reminders.ts';
import { quickPick } from './remind-times.ts';
import { withPeerNotice } from './peer-notice.ts';
import { createLiveShare } from './live-share.ts';
import { createSharing } from './sharing.ts';
import { createNoteList } from './note-list.tsx';
import { createRowCache } from './row-cache.ts';
import { createNoteTree } from './note-tree.tsx';
import { treeItems } from './tree-items.ts';
import type { TreeItem } from './tree-items.ts';
import { createStickyButton } from './sticky-button.ts';
import { createBotPanel } from './bot-panel.ts';
import { createCodeEditor, src } from './code-editor.ts';
import { createEditorView, tableShown, focusBody, inTextField, bodyHasFocus, autoGrow } from './editor-view.ts';
import { createVaultsPanel } from './vaults-panel.ts';
import { createLocking } from './locking.ts';
import { createAttachments } from './attachments.ts';
import { createHistoryDialog } from './history-dialog.ts';
import { createSpeech } from './speech.ts';
import { createFindBar, canFindInNote } from './find-bar.ts';
import { createPdfNote } from './pdf-note.ts';
import { createCraftNotes } from './craft-notes.ts';
import { createWordNote } from './word-note.ts';
import { createImages } from './images.ts';
import { createConvertMenu } from './convert-menu.ts';
import { createEditorText } from './editor-text.ts';
import { craftTrace } from './craft-trace.ts';

type OpenFocus = 'title' | 'body';
type OpenOpts = { newTab?: boolean; focus?: OpenFocus | null };
type RefreshOpts = { keepEditor?: boolean };
type RowSource = Pick<OutlineRow, 'id' | 'title' | 'folderId' | 'pinned' | 'locked' | 'unlocked' | 'fileKind' | 'filePath' | 'remindAt' | 'live' | 'home'>
  & { sticky: Sticky | boolean | null; trashedAt?: number | null; body?: string; tags?: string[]; excerpt?: string };
type SettingValue = Settings[keyof Settings];
type PeerMessage =
  | { type: 'hello' | 'changed' | 'focus' | 'close' }
  | { type: 'tabs'; ids: string[]; current: string | null }
  | { type: 'open'; id: string; newTab?: boolean; focus?: OpenFocus | null }
  | { type: 'settings'; settings: Settings }
  | { type: 'caption'; w: number }
  | { type: 'active'; on: boolean }
  | { type: 'event'; name: MainEventName; args: MainEventArgs<MainEventName> }
  | { type: 'flush'; seq: number; leave: boolean }
  | { type: 'release'; seq: number; id: string }
  | { type: 'reply'; seq: number; ok: boolean }
  | { type: 'command'; name: string; title?: string }
  | { type: 'drag'; id: string | null };
type MainEventName = keyof NotesApi['on'];
type MainEventArgsMap = { [N in MainEventName]: Parameters<Parameters<NotesApi['on'][N]>[0]> };
type MainEventArgs<N extends MainEventName> = MainEventArgsMap[N];
const isListView = (v: string | undefined): v is RendererState['view'] => v === 'all' || v === 'pinned' || v === 'trash' || v === 'tag' || v === 'folder' || v === 'reminders';
type Command = { id: string; group: string; title: string; icon?: string; keys: string; run: () => unknown; ok: boolean; keywords?: string };

(function () {
  'use strict';

  const api = withPeerNotice(window.notesApi, peerChanged);
  const { isViewerOnlyFile, isPlainTextFile, isNonMarkdownFile } = H;
  const closestTo = (e: Event, selector: string) => e.target instanceof Element ? e.target.closest<HTMLElement>(selector) : null;

  function effectiveTheme(settings?: Settings & Partial<Settings>) {
    const s = settings || state.settings;
    const t = s ? s.theme : 'system';
    if (t === 'light' || t === 'dark') return t;
    return state.systemDark ? 'dark' : 'light';
  }

  function applyTheme(settings?: Settings & Partial<Settings>) {
    const theme = effectiveTheme(settings);
    document.documentElement.dataset.theme = theme;
    applyColorScheme(theme, settings || state.settings);
    syncTitleBar();
  }

  function applyColorScheme(mode: Exclude<Theme, 'system'>, settings: Settings | null) {
    const tokens = NotesThemes.resolve(settings, mode);
    const style = document.documentElement.style;
    for (const name of NotesThemes.TOKENS) {
      if (tokens) style.setProperty('--' + name, tokens[name]);
      else style.removeProperty('--' + name);
    }
  }

  function applySettings(settings: Settings, opts?: { fromPeer?: boolean }) {
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
    if (el.settingsDialog.open && settingsDirty()) previewSettings();
    if (opts && opts.fromPeer) return;
    if (H.isTableFile(state.current)) return;
    const forcedSource = (state.currentLossless === false && state.lossyOverride !== state.currentId) || !state.rich || isPlainTextFile(state.current);
    const wantSource = settings.editorMode === 'source' || forcedSource;
    if (wantSource !== state.sourceMode) applyEditorMode(wantSource);
  }

  function syncTitleBar() {
    if (GUEST) return;
    const css = getComputedStyle(document.documentElement);
    const color = css.getPropertyValue('--base').trim();
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

  function applyEditorLayout(settings: Settings) {
    el.editorColumn.classList.remove('align-left', 'align-center', 'align-right');
    el.editorColumn.classList.add('align-' + settings.editorAlign);
    el.editorColumn.classList.toggle('full-width', !settings.editorWidth);
    el.editorColumn.style.setProperty('--editor-col-width', (settings.editorWidth || 760) + 'px');
  }

  const NARROW_W = 1000;
  const PEEK_EDGE_PX = 24;
  let treeActiveKey: string | null = null;
  let sidebarPeek: 'hover' | 'sticky' | null = null;
  let peekTimer: ReturnType<typeof setTimeout> | undefined;
  const isNarrow = () => window.innerWidth < NARROW_W;
  function sidebarLayout() {
    if (settingsNow().sidebarCollapsed) return 'float';
    return isNarrow() ? 'float' : 'docked';
  }
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
  function peekSidebar(how: 'hover' | 'sticky') {
    if (GUEST || sidebarLayout() !== 'float') return;
    clearTimeout(peekTimer);
    if (sidebarPeek === 'sticky' && how === 'hover') return;
    const fromKeyboard = how === 'sticky' && !el.sidebar.contains(document.activeElement);
    sidebarPeek = how;
    applySidebar();
    if (fromKeyboard) {
      peekReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const target = el.sidebar.querySelector<HTMLElement>('.nav-item.is-active, .folder-row.is-active') || el.newNoteBtn;
      setTimeout(() => { if (!state.editingFolder && !el.sidebar.contains(document.activeElement)) target.focus(); }, 0);
    }
  }
  let peekReturn: HTMLElement | null = null;
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
  function showSidebar() {
    if (sidebarLayout() === 'float') peekSidebar('sticky');
  }
  function toggleSidebar() {
    if (GUEST) { toPeer({ type: 'command', name: 'toggleSidebar' }); return; }
    if (isNarrow()) { if (sidebarPeek) unpeekSidebar(); else peekSidebar('sticky'); return; }
    const collapsed = !!settingsNow().sidebarCollapsed;
    sidebarPeek = null;
    updateSettings({ sidebarCollapsed: !collapsed });
  }
  function bindSidebarFloat() {
    if (GUEST) return;
    const busy = () => state.editingFolder || state.menuFolderId || document.body.classList.contains('is-resizing')
      || (!!document.activeElement && el.sidebar.contains(document.activeElement) && document.activeElement.matches('input, textarea, select'));
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
      const overSidebar = el.sidebar.contains(e.target instanceof Node ? e.target : null);
      const near = e.clientX <= PEEK_EDGE_PX;
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
      const target = e.target instanceof Node ? e.target : null;
      if (!sidebarPeek || el.sidebar.contains(target) || el.sidebarEdge.contains(target) || el.barToggles.contains(target) || el.folderMenu.contains(target)) return;
      unpeekSidebar();
    }, true);
  }

  function paneBudget() {
    return Math.max(0, window.innerWidth - H.EDITOR_MIN);
  }

  function fitPaneWidths(sidebar: number, list: number) {
    sidebar = H.clampPane('sidebarWidth', sidebar);
    list = H.clampPane('listWidth', list);
    const sidebarShown = sidebarHidden() ? 0 : sidebar;
    const over = sidebarShown + list - paneBudget();
    if (over > 0) {
      const listGive = Math.min(over, list - H.PANE_LIMITS.listWidth.min);
      list -= listGive;
      const rest = over - listGive;
      if (rest > 0 && sidebarShown) sidebar = Math.max(H.PANE_LIMITS.sidebarWidth.min, sidebar - rest);
    }
    return { sidebar, list };
  }

  function applyPaneWidths(sidebar: number, list: number) {
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

  function setupResizer(handle: HTMLDivElement, key: 'sidebarWidth' | 'listWidth') {
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
      const onMove = (ev: PointerEvent) => {
        const widths = { sidebar: start.sidebar, list: start.list };
        widths[mine] = start[mine] + (ev.clientX - startX);
        const fit = applyPaneWidths(widths.sidebar, widths.list);
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
      const patch: SettingsPatch = {};
      patch[key] = H.PANE_LIMITS[key].def;
      updateSettings(patch);
    });
  }

  function applyInfo(info: AppInfo) {
    state.info = info;
    const text = info.hotkeyRegistered ? info.hotkeyDisplay : 'hotkey unavailable';
    el.hotkeyHint.textContent = text;
    el.hotkeyHint2.textContent = text;
    el.settingsInfo.textContent = (info.notesDir ? 'Notes: ' + info.notesDir + ' · ' : info.filesError ? 'Your notes could not be moved into a folder: ' + info.filesError + ' · ' : '') + 'Data: ' + info.dataDir + (info.hotkeyFallback ? '   (preferred hotkey was taken; using ' + info.hotkeyDisplay + ')' : '');
    if (info.saveBlocked) toast('Your notes file could not be read (it may be locked by another program). Saving is paused so nothing is overwritten; restart Notes once it is free.');
    else if (info.loadError && info.recoveredNotes) toast('Notes file was damaged; restored ' + info.recoveredNotes + (info.recoveredNotes === 1 ? ' note' : ' notes') + ' from the newest backup. The damaged file was kept beside it.');
    else if (info.loadError) toast('Notes file was damaged and no backup was found. The damaged file was kept beside notes.json.');
  }

  let filesNoticeShown = false;
  function noticeFilesMove() {
    const info = state.info;
    if (GUEST || filesNoticeShown || !info) return;
    if (info.filesError) {
      filesNoticeShown = true;
      toast('Your notes could not be moved into a folder: ' + info.filesError + '. Your notes are unchanged. Notes will try again the next time it starts.');
      return;
    }
    const moved = info.movedToFiles;
    if (!moved) return;
    filesNoticeShown = true;
    const one = moved.renamed.length === 1 ? moved.renamed[0] : null;
    const renamed = one ? ' The ' + one.kind + ' "' + one.from + '" is now "' + one.to + '", a name Windows allows.'
      : moved.renamed.length ? ' ' + moved.renamed.length + ' names changed to ones Windows allows.' : '';
    toast('Your notes are now Markdown files that other apps and AI tools can open, in ' + moved.notesDir + '.' + renamed, { label: 'Show folder', run: showNotesFolder });
  }

  function showNotesFolder() {
    const id = state.info && state.info.homeVaultId;
    if (id) api.vaults.openFolder(id);
  }

  async function updateSettings(patch: SettingsPatch) {
    const res = await api.settings.set(patch);
    applySettings(res.settings);
    applyInfo(res.info);
    toPeer({ type: 'settings', settings: res.settings });
    return res;
  }

  let paletteRows: Promise<ListRow[]> | null = null;

  async function refresh(opts?: RefreshOpts) {
    opts = opts || {};
    paletteRows = null;
    const listOpts: ListOpts = { query: state.query, sort: settingsNow().sort };
    if (state.view === 'trash') listOpts.trashed = true;
    else if (state.query) {  }
    else if (state.view === 'pinned') listOpts.pinned = true;
    else if (state.view === 'reminders') listOpts.reminders = true;
    else if (state.view === 'tag') listOpts.tag = state.tag || undefined;
    else if (state.view === 'folder') listOpts.folderId = state.folderId;
    const wantTree = settingsNow().listMode === 'tree' && !state.query && (state.view === 'all' || state.view === 'folder');
    const [page, counts, tags, tree, folderPath, outline] = await Promise.all([
      api.notes.page(listOpts, (state.currentId ? [state.currentId] : []).concat(noteList.shownIds())), api.notes.counts(), api.notes.tags(), api.folders.tree(),
      state.view === 'folder' && state.folderId ? api.folders.path(state.folderId) : Promise.resolve([]),
      wantTree ? api.notes.outline(settingsNow().sort, treeFolders()) : Promise.resolve(null),
    ]);
    if ((listOpts.query || '') !== state.query) return refresh(opts);
    state.noteIds = page.ids;
    noteIndex = new Map(page.ids.map((id, i) => [id, i]));
    state.notesQuery = listOpts.query || '';
    rowCache.reset(page.rows, state.notesQuery);
    state.outline = outline;
    state.tree = tree;
    state.folderPath = folderPath;
    if (state.view === 'folder' && !folderPath.length) {
      state.view = 'all'; state.folderId = null;
      if (settingsNow().lastFolderId && !GUEST) updateSettings({ lastFolderId: null }).catch(() => {});
      el.navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === 'all'));
      return refresh(opts);
    }
    renderCounts(counts);
    renderTags(tags);
    renderFolders();
    renderFolderSelect();
    renderList();
    if (state.current && (book.id || bookOf(state.current))) renderBookStrip(state.current);
    const ids = page.ids;
    const inList = treeModeActive() ? inTreeScope(state.currentId) : state.currentId !== null && ids.includes(state.currentId);
    if (!inList && !opts.keepEditor) {
      const tabId = tabs.ids[tabs.at];
      if (!state.currentId && tabId) await selectNote(tabId);
      else if (GUEST) {  }
      else if (tabs.split && tabs.active === 'right') {
        if (ids.length && !(tabs.peerCurrent !== null && ids.includes(tabs.peerCurrent))) openNote(ids[0]);
      } else if (ids.length) await selectNote(ids[0]);
      else clearEditor();
    } else if (inList) {
      const fresh = state.currentId === null ? undefined : rowCache.get(state.currentId);
      if (fresh && !state.dirty) updateStatus(fresh);
    }
  }

  function renderCounts(c: Counts) {
    el.countAll.textContent = String(c.all);
    el.countPinned.textContent = String(c.pinned);
    el.countTrash.textContent = String(c.trash);
    el.countReminders.textContent = String(c.reminders);
    for (const b of [el.countPinned, el.countTrash, el.countReminders]) b.classList.toggle('is-zero', b.textContent === '0');
    el.countReminders.classList.toggle('is-overdue', !!c.overdue);
  }

  function renderTags(tags: TagCount[]) {
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
      const name = document.createElement('span');
      name.textContent = tag;
      const n = document.createElement('span');
      n.className = 'count';
      n.textContent = String(count);
      b.append(name, n);
      b.addEventListener('click', () => setView('tag', tag));
      el.tagList.append(b);
    }
  }

  function renderList() {
    const q = state.notesQuery;
    const tree = treeModeActive();
    const empty = tree ? !treeHasContent() : !state.noteIds.length;
    el.noteList.classList.toggle('hidden', tree || empty);
    el.noteTree.classList.toggle('hidden', !tree || empty);
    el.listModeSeg.classList.toggle('hidden', !treeModePossible());
    syncListModeSeg();
    el.listEmpty.classList.toggle('hidden', !empty);
    if (empty) renderListEmpty();
    el.emptyTrashBtn.classList.toggle('hidden', !(state.view === 'trash' && state.noteIds.length));
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
    if (tree || empty) noteList.render([], null, '');
    if (tree) { renderNoteTree(); return; }
    noteTree.render([], -1);
    if (empty) return;
    listPageNumbers = state.view === 'folder' && !q && !!(flattenTree(state.tree).find((x) => x.id === state.folderId) || {}).book;
    noteList.render(state.noteIds, state.currentId, q);
  }

  function treeHasContent() {
    if (state.view !== 'folder') return state.tree.length > 0 || ((state.outline && state.outline.notes['']) || []).length > 0;
    const node = flattenTree(state.tree).find((f) => f.id === state.folderId);
    return !!node && (node.children.length > 0 || node.count > 0);
  }

  function treeFolders() {
    const want = new Set<string>(['', ...(settingsNow().treeExpanded || [])]);
    if (state.view === 'folder' && state.folderId) want.add(state.folderId);
    const here = state.current && state.current.folderId;
    if (here) { want.add(here); for (const id of pathTo(here)) want.add(id); }
    return Array.from(want);
  }

  function missingTreeFolders() {
    const have = state.outline;
    return have ? treeFolders().filter((id) => !Object.hasOwn(have.notes, id)) : [];
  }

  async function loadTreeFolders() {
    for (let tries = 0; tries < 3; tries++) {
      const have = state.outline;
      const missing = missingTreeFolders();
      if (!have || !missing.length) return;
      const more = await api.notes.outline(settingsNow().sort, missing);
      if (state.outline === have) { Object.assign(have.notes, more.notes); return; }
    }
  }

  let treeLoading: Promise<void> | null = null;
  let treeJustLoaded = false;
  function loadThenRenderTree() {
    if (treeLoading) return treeLoading;
    treeLoading = loadTreeFolders().catch(() => {}).then(() => {
      treeLoading = null;
      treeJustLoaded = true;
      try { renderNoteTree(); } finally { treeJustLoaded = false; }
    });
    return treeLoading;
  }

  function renderListEmpty() {
    const [title, sub] = state.query ? ['No matches', 'Nothing in this list has "' + state.query + '". Ctrl+P searches everything.']
      : state.view === 'trash' ? ['Trash is empty', 'Notes you delete wait here until you empty the trash.']
      : state.view === 'pinned' ? ['Nothing pinned', 'Pin a note (Ctrl+D) to keep it at the top.']
      : state.view === 'reminders' ? ['No reminders', 'Set one from a note\u2019s More menu, or press Ctrl+Shift+M.']
      : state.view === 'tag' ? ['No notes with this tag', '']
      : state.view === 'folder' ? ['This folder is empty', 'Press Ctrl+N to write a note here.']
      : ['No notes yet', 'Press Ctrl+N to write your first note.'];
    const emptyTitle = el.listEmpty.querySelector('.empty-title');
    const emptySub = el.listEmpty.querySelector('.empty-sub');
    if (emptyTitle) emptyTitle.textContent = title;
    if (emptySub) emptySub.textContent = sub;
  }

  function reminderMark(n: RowSource) {
    if (!n.remindAt || n.trashedAt) return '';
    const overdue = n.remindAt <= Date.now();
    return '<span class="row-meta remind-mark' + (overdue ? ' is-overdue' : '') + '" title="' + (overdue ? 'Reminder went off' : 'Reminder') + '">' + I('bell') + escapeHtml(H.formatWhen(n.remindAt)) + '</span>';
  }

  function rowInner(n: RowSource, q: string, where = whereMark(n, q)) {
    const title = n.body === undefined ? n.title : H.deriveTitle(n);
    const fileMark = n.filePath && !n.home ? '<span class="file-mark" title="' + escapeHtml(n.filePath) + '">' + escapeHtml(fileBadge(n)) + '</span>' : '';
    const pin = n.pinned ? '<span class="row-mark pin" title="Pinned">' + I('star') + '</span>' : '';
    const marks = (n.sticky ? '<span class="row-mark sticky-mark" title="On the desktop as a sticky">' + I('sticky-note') + '</span>' : '')
      + (n.locked ? '<span class="row-mark lock-mark" title="' + (n.unlocked ? 'Locked (unlocked for now)' : 'Locked') + '">' + I(n.unlocked ? 'lock-open' : 'lock') + '</span>' : '')
      + (n.live ? '<span class="row-mark live-mark" title="Live share' + (n.live.role ? ' (' + n.live.role + ')' : '') + '">' + I('radio') + '</span>' : '');
    const why = rowHasExcerpt(n, q) ? '<span class="row-meta match">' + highlight(n.excerpt ?? H.matchExcerpt(n, q), q) + '</span>' : '';
    return '<span class="row-name">' + highlight(title, q) + '</span>' + why + where + marks + fileMark + reminderMark(n) + pin;
  }

  function rowHasExcerpt(n: RowSource, q: string) {
    if (!q || (n.locked && !n.unlocked)) return false;
    const title = (n.body === undefined ? n.title : H.deriveTitle(n)).toLowerCase();
    return !H.tokenize(q).some((t) => title.includes(t));
  }

  function whereMark(n: RowSource, q: string) {
    if (treeModeActive() || (state.view === 'folder' && !q)) return '';
    return folderMark(n);
  }

  function folderMark(n: RowSource) {
    if (!n.folderId) return '';
    const byId = new Map(flattenTree(state.tree).map((x) => [x.id, x]));
    const f = byId.get(n.folderId);
    if (!f) return '';
    const names: string[] = [];
    for (let x: FolderNode | undefined = f; x && names.length < 200; x = x.parentId ? byId.get(x.parentId) : undefined) names.unshift(x.name);
    return '<span class="row-meta where" title="' + escapeHtml(names.join(' / ')) + '">' + I(f.book ? 'book-open' : 'folder') + escapeHtml(f.name) + '</span>';
  }

  function treeNoteInner(n: RowSource, awayFromFolder: boolean) {
    return '<span class="tree-spacer" aria-hidden="true"></span>' + rowInner(n, '', awayFromFolder ? folderMark(n) : '');
  }

  function refreshRow(note: PublicNote) {
    if (tabs.ids.includes(note.id)) { tabs.titles.set(note.id, H.deriveTitle(note)); renderActiveTabTitle(); }
    if (state.outline) {
      const title = H.deriveTitle(note);
      for (const list of [...Object.values(state.outline.notes), state.outline.pinned]) { const e = list.find((x) => x.id === note.id); if (e) { e.title = title; e.pinned = !!note.pinned; } }
      const pinned = state.outline.pinned.filter((x) => x.pinned);
      if (note.pinned && !note.trashedAt && !pinned.some((x) => x.id === note.id)) pinned.push(H.outlineRow(note));
      state.outline.pinned = H.sortNotes(pinned, settingsNow().sort);
      noteTree.replace(note.id, note, title);
    }
    if (noteIndex.has(note.id)) {
      rowCache.set(H.listRow(note, state.notesQuery));
      noteList.changed([note.id]);
    }
  }

  async function setView(view: RendererState['view'], arg: string | null = null, refreshOpts?: RefreshOpts) {
    await flushSave();
    state.view = view;
    state.tag = view === 'tag' ? arg : null;
    state.folderId = view === 'folder' ? arg : null;
    el.navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    if (!GUEST && (settingsNow().lastFolderId || null) !== state.folderId) updateSettings({ lastFolderId: state.folderId }).catch(() => {});
    await refresh(refreshOpts);
  }

  async function scopeListToNote(note: Pick<PublicNote, 'trashedAt' | 'folderId'> | null) {
    if (!note || state.query) return;
    if (note.trashedAt) { if (state.view !== 'trash') await setView('trash', null, { keepEditor: true }); return; }
    if (note.folderId) { if (!(state.view === 'folder' && state.folderId === note.folderId)) await setView('folder', note.folderId, { keepEditor: true }); return; }
    if (state.view === 'folder' || state.view === 'trash') await setView('all', null, { keepEditor: true });
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  async function endSearchStep() {
    const had = !!state.query;
    state.query = el.searchInput.value.trim();
    await refresh({ keepEditor: true });
    if (had && !state.query) await scopeListToNote(state.current);
  }

  function syncListCollapsed() {
    const collapsed = !!(settingsNow().listCollapsed && state.current);
    el.app.classList.toggle('list-collapsed', collapsed);
    if (el.toggleListBtn) el.toggleListBtn.classList.toggle('is-on', !collapsed);
  }

  function toggleList() {
    updateSettings({ listCollapsed: !settingsNow().listCollapsed });
  }

  async function showList() {
    if (settingsNow().listCollapsed) await updateSettings({ listCollapsed: false });
  }

  function searchList() {
    if (GUEST) { toPeer({ type: 'command', name: 'search' }); return; }
    showList().then(() => { el.searchInput.focus(); el.searchInput.select(); });
  }

  function folderParents() {
    const m = new Map<string, string | null>();
    for (const f of flattenTree(state.tree)) m.set(f.id, f.parentId || null);
    return m;
  }
  function pathTo(id: string | null) {
    const parents = folderParents();
    const out: string[] = [];
    for (let x: string | null | undefined = id; x && parents.has(x) && out.length < 200; x = parents.get(x)) out.unshift(x);
    return out;
  }
  function expandedSet() {
    const list = (settingsNow().expandedFolders) || [];
    if (!list.length) return new Set<string>();
    const open = new Set<string>();
    for (const id of pathTo(list[list.length - 1])) { if (!list.includes(id)) break; open.add(id); }
    return open;
  }

  async function setExpanded(id: string | null, open: boolean) {
    let next: string[];
    if (open) next = pathTo(id);
    else {
      const cur = Array.from(expandedSet());
      const i = id === null ? -1 : cur.indexOf(id);
      next = i >= 0 ? cur.slice(0, i) : cur;
    }
    await updateSettings({ expandedFolders: next });
    renderFolders();
  }

  function flattenTree(nodes: FolderNode[], out?: FolderNode[]): FolderNode[] {
    out = out || [];
    for (const n of nodes) { out.push(n); flattenTree(n.children, out); }
    return out;
  }

  function editKey(edit: FolderEdit | null) {
    return edit ? edit.mode + ':' + (edit.mode === 'rename' ? edit.id : edit.parentId || 'root') : '';
  }

  function renderFolders() {
    const open = expandedSet();
    const editing = state.editingFolder;
    const liveInput = el.folderTree.querySelector<HTMLInputElement>('.folder-input');
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
    const here = new Set(state.view === 'folder' ? pathTo(state.folderId) : []);
    const holding = state.current && state.current.folderId ? state.current.folderId : null;
    for (const id of holding ? pathTo(holding) : []) here.add(id);
    const addRow = (node: FolderNode, into: HTMLDivElement | DocumentFragment) => {
      const kids = node.children.length > 0;
      const isOpen = kids && open.has(node.id);
      const row = document.createElement('div');
      row.className = 'folder-row tree-row' + (state.view === 'folder' && state.folderId === node.id ? ' is-active' : '') + (node.id === holding ? ' holds-note' : '');
      row.dataset.id = node.id;
      row.dataset.key = 'f:' + node.id;
      row.style.setProperty('--depth', String(node.depth));
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(node.depth + 1));
      if (kids) row.setAttribute('aria-expanded', String(isOpen));
      row.setAttribute('aria-selected', String(row.classList.contains('is-active')));
      row.tabIndex = -1;
      row.draggable = !(editing && editing.mode === 'rename' && editing.id === node.id);
      setRowToggle(row, kids ? (on) => setExpanded(node.id, on) : null);

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
          const st: Partial<VaultStatus> = (node.vaultId && state.vaultStatus[node.vaultId]) || {};
          const badge = document.createElement('span');
          badge.className = 'vault-badge' + (st.syncing ? ' is-syncing' : '') + (st.lastError || st.conflict ? ' is-error' : '');
          badge.innerHTML = I(st.isRepo ? 'refresh-cw' : 'folder-open');
          badge.title = st.isRepo ? ('git' + (st.remote ? ' · ' + st.remote : ' · no remote') + (st.lastError ? '\n' + st.lastError : '')) : 'Folder vault (no git)';
          row.append(badge);
        }
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = String(node.count);
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

      row.addEventListener('click', () => {
        if (editing && editing.mode === 'rename' && editing.id === node.id) return;
        if (kids && !isOpen) setExpanded(node.id, true);
        setView('folder', node.id);
      });
      row.addEventListener('dblclick', (e) => { if (!(e.target instanceof Element && e.target.closest('.folder-input'))) { e.preventDefault(); startRename(node.id); } });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); openFolderMenu(node.id, row, e); });
      wireDropTarget(row, node.id);
      row.addEventListener('dragstart', (e) => {
        if (e.dataTransfer) { e.dataTransfer.setData('text/x-folder-id', node.id); e.dataTransfer.effectAllowed = 'move'; }
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
    const createRow = (depth: number) => {
      const row = document.createElement('div');
      row.className = 'folder-row is-active';
      row.style.setProperty('--depth', String(depth));
      const chevron = document.createElement('span');
      chevron.className = 'folder-chevron is-leaf';
      row.append(chevron);
      row.append(folderInput('', (value) => commitFolderEdit(value)));
      if (editing && editing.mode === 'create' && editing.book) row.insertAdjacentHTML('beforeend', bookMark());
      return row;
    };
    const frag = document.createDocumentFragment();
    if (editing && editing.mode === 'create' && !editing.parentId) frag.append(createRow(0));
    state.tree.forEach((n) => addRow(n, frag));
    el.folderTree.append(frag);
    const input = el.folderTree.querySelector<HTMLInputElement>('.folder-input');
    if (input) { input.focus(); input.select(); }
    else restoreTreeFocus(el.folderTree, refocus);
  }

  function treeModePossible() {
    return !state.query && (state.view === 'all' || state.view === 'folder');
  }
  function treeModeActive() {
    return !!state.settings && state.settings.listMode === 'tree' && treeModePossible();
  }
  function inTreeScope(noteId: string | null) {
    const out = state.outline ? state.outline.notes : {};
    const scope = state.view === 'folder' ? state.folderId : null;
    const ids = scope ? new Set([scope, ...flattenTree((flattenTree(state.tree).find((f) => f.id === scope) || { children: [] }).children).map((f) => f.id)]) : null;
    const row = noteId === null ? undefined : rowCache.get(noteId);
    if (row) return !row.trashedAt && (!ids || (row.folderId !== null && ids.has(row.folderId)));
    for (const [folder, notes] of Object.entries(out)) {
      if (ids && !ids.has(folder)) continue;
      if (notes.some((n) => n.id === noteId)) return true;
    }
    return false;
  }

  function headingsOf(md: string) {
    const out: ({ level: number; text: string; })[] = [];
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
      return Array.from<HTMLElement>(el.richEditor.querySelectorAll('.rich-editor-content :is(h1, h2, h3, h4, h5, h6)')).slice(0, 60)
        .map((h) => ({ level: Number(h.tagName.slice(1)), text: (h.textContent || '').trim() })).filter((h) => h.text);
    }
    const md = state.currentId === n.id ? el.bodyInput.value : n.body;
    return headingsOf(md).slice(0, 60);
  }

  function jumpToHeading(i: number) {
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

  function setTreeOpen(id: string, on: boolean) {
    const next = new Set(settingsNow().treeExpanded || []);
    if (on) next.add(id); else next.delete(id);
    updateSettings({ treeExpanded: Array.from(next) }).then(loadThenRenderTree);
  }

  function renderNoteTree() {
    if (!treeJustLoaded && missingTreeFolders().length) loadThenRenderTree();
    const scopeId = state.view === 'folder' ? state.folderId : null;
    const { items, active } = treeItems({
      outline: state.outline || { notes: {}, pinned: [] },
      tree: state.tree,
      scope: scopeId ? flattenTree(state.tree).find((f) => f.id === scopeId) || null : null,
      open: new Set(settingsNow().treeExpanded || []),
      here: new Set(state.current && state.current.folderId ? pathTo(state.current.folderId) : []),
      revealing: state.revealInTree === state.currentId,
      currentId: state.currentId,
      activeKey: treeActiveKey,
      headings: currentHeadings(),
    });
    noteTree.render(items, active);
    if (active >= 0 && state.revealInTree === state.currentId) { noteTree.revealActive(); state.revealInTree = null; }
  }

  function treeRowHtml(item: TreeItem, override: RowSource | null) {
    if (item.kind === 'note') return treeNoteInner(override || item.note, item.away);
    if (item.kind === 'heading') return '<span class="tree-spacer" aria-hidden="true"></span><span class="row-name">' + escapeHtml(item.text) + '</span>';
    return '<span class="tree-chevron' + (item.open ? ' is-open' : '') + (item.kids ? '' : ' is-leaf') + '" aria-hidden="true">' + I('chevron-right') + '</span>'
      + '<span class="row-name">' + escapeHtml(item.node.name) + '</span>' + (item.node.book ? bookMark() : '')
      + '<span class="count">' + (item.node.count ? String(item.node.count) : '') + '</span>';
  }

  function treeRowTitle(item: TreeItem) {
    return item.kind === 'note' ? item.note.title : item.kind === 'folder' ? item.node.name : item.text;
  }

  function activateTreeRow(item: TreeItem, e: MouseEvent) {
    if (item.kind === 'folder') { if (item.kids) setTreeOpen(item.node.id, !item.open); return; }
    if (item.kind === 'heading') { jumpToHeading(item.index); return; }
    const newTab = e.ctrlKey || e.metaKey;
    if (!newTab && treeActiveKey !== item.key) {
      treeActiveKey = item.key;
      if (item.note.id === state.currentId) renderNoteTree();
    }
    openNote(item.note.id, { newTab });
  }

  function revealInSidebar(note: PublicNote | null) {
    if (GUEST) return;
    const parents = note && note.folderId ? pathTo(note.folderId).slice(0, -1) : [];
    const open = expandedSet();
    if (parents.every((id) => open.has(id))) { renderFolders(); return; }
    setExpanded(parents[parents.length - 1], true);
  }

  function revealInTree(note: PublicNote | null) {
    if (GUEST || !treeModeActive() || !note) return;
    if (!note.folderId || (state.view === 'all' && note.pinned)) {
      renderNoteTree();
      noteTree.revealActive();
      return;
    }
    const path = pathTo(note.folderId);
    const have = new Set(settingsNow().treeExpanded || []);
    const missing = path.filter((id) => !have.has(id));
    state.revealInTree = note.id;
    if (missing.length) updateSettings({ treeExpanded: Array.from(have).concat(missing) }).then(loadThenRenderTree);
    else loadThenRenderTree();
  }

  let outlineTimer: ReturnType<typeof setTimeout> | undefined, outlineSig = '';
  function scheduleOutline() {
    if (!treeModeActive()) return;
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(() => {
      const sig = state.currentId + '|' + currentHeadings().map((h) => h.level + h.text).join('|');
      if (sig !== outlineSig) { outlineSig = sig; renderNoteTree(); }
    }, 500);
  }

  function folderInput(value: string, commit: (value: string) => void) {
    const input = document.createElement('input');
    input.className = 'folder-input';
    input.dataset.editKey = editKey(state.editingFolder);
    input.value = value;
    const what = state.editingFolder && state.editingFolder.mode === 'create' && state.editingFolder.book ? 'Book name' : 'Folder name';
    input.placeholder = what;
    input.setAttribute('aria-label', what);
    input.spellcheck = false;
    let done = false;
    const finish = (save: boolean) => {
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

  function startCreateFolder(parentId: string | null, asBook?: boolean) {
    closeFolderMenu();
    showSidebar();
    state.editingFolder = { mode: 'create', parentId: parentId || null, book: !!asBook };
    if (parentId && !expandedSet().has(parentId)) { setExpanded(parentId, true); return; }
    renderFolders();
  }

  function startRename(id: string) {
    closeFolderMenu();
    state.editingFolder = { mode: 'rename', id };
    renderFolders();
  }

  function cancelFolderEdit() {
    state.editingFolder = null;
    renderFolders();
  }

  async function commitFolderEdit(value: string) {
    const edit = state.editingFolder;
    state.editingFolder = null;
    if (!edit) return;
    const name = String(value || '').trim();
    try {
      if (edit.mode === 'create') {
        if (!name) { renderFolders(); return; }
        const folder = await api.folders.create({ name, parentId: edit.parentId });
        if (edit.book) {
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
      renderFolders();
      toast('Could not save the folder: ' + (err.message || err));
    }
  }

  async function deleteFolder(id: string) {
    closeFolderMenu();
    const node = flattenTree(state.tree).find((n) => n.id === id);
    if (!node) return;
    const what: (string)[] = [];
    if (node.count) what.push(node.count + (node.count === 1 ? ' note' : ' notes'));
    if (node.children.length) what.push(node.children.length + (node.children.length === 1 ? ' subfolder (with its contents)' : ' subfolders (with their contents)'));
    const detail = what.length ? ' Its ' + what.join(' and ') + ' move up one level; nothing is deleted.' : '';
    if (!window.confirm('Delete folder "' + node.name + '"?' + detail)) return;
    await flushSave();
    const res = await api.folders.delete(id);
    if (state.current && state.current.folderId === id) state.current.folderId = res && 'parentId' in res ? res.parentId : null;
    if (state.view === 'folder' && (state.folderId === id || !flattenTree(state.tree).some((n) => n.id === state.folderId))) {
      if (res && 'parentId' in res && res.parentId) await setView('folder', res.parentId); else await setView('all');
    } else await refresh({ keepEditor: true });
    toast('Folder deleted');
  }

  async function moveNoteToFolder(noteId: string, folderId: string | null) {
    const existing = rowCache.get(noteId) || (state.currentId === noteId ? state.current : null);
    if (existing && (existing.folderId || null) === (folderId || null)) return;
    await flushSave();
    let updated;
    try { updated = await api.notes.update(noteId, { folderId: folderId || null }); }
    catch (err) { const msg = ipcErrorText(err); toast(/locked/i.test(msg) ? msg : (/vault/i.test(msg) ? 'Vault notes stay inside their vault; move them between its folders instead.' : 'Could not move: ' + msg)); renderFolderSelect(); return; }
    if (state.currentId === noteId && updated) state.current = updated;
    await refresh({ keepEditor: true });
    const name = folderId ? (flattenTree(state.tree).find((n) => n.id === folderId) || {}).name : null;
    toast(name ? 'Moved to ' + H.truncate(name, 30) : 'Moved out of folders');
  }

  async function moveFolderTo(folderId: string, parentId: string | null) {
    const res = await api.folders.move(folderId, parentId || null);
    if (res && 'error' in res) { toast(res.error); return; }
    if (parentId && !expandedSet().has(parentId)) await setExpanded(parentId, true);
    await refresh({ keepEditor: true });
  }

  function allowNoteDrop(e: DragEvent) {
    if (!e.dataTransfer || !(e.dataTransfer.types.includes('text/x-note-id') || e.dataTransfer.types.includes('text/x-folder-id'))) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return true;
  }

  function dropInto(folderId: string | null, e: DragEvent) {
    if (!e.dataTransfer) return;
    const noteId = e.dataTransfer.getData('text/x-note-id');
    const movingFolder = e.dataTransfer.getData('text/x-folder-id');
    if (!noteId && !movingFolder) return;
    e.preventDefault();
    e.stopPropagation();
    if (noteId) moveNoteToFolder(noteId, folderId);
    else if (movingFolder && movingFolder !== folderId) moveFolderTo(movingFolder, folderId);
  }

  function wireDropTarget(target: HTMLElement, folderId: string | null) {
    target.addEventListener('dragover', (e) => { if (allowNoteDrop(e)) target.classList.add('is-drop-target'); });
    target.addEventListener('dragleave', () => target.classList.remove('is-drop-target'));
    target.addEventListener('drop', (e) => { target.classList.remove('is-drop-target'); dropInto(folderId, e); });
  }

  function startNoteDrag(id: string, e: DragEvent) {
    if (e.dataTransfer) { e.dataTransfer.setData('text/x-note-id', id); e.dataTransfer.effectAllowed = 'move'; }
    toPeer({ type: 'drag', id });
    document.addEventListener('pointermove', endNoteDrag, { once: true });
  }

  function endNoteDrag() {
    toPeer({ type: 'drag', id: null });
  }

  function renderFolderSelect() {
    const sel = el.folderSelect;
    const current = state.current ? (state.current.folderId || '') : '';
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'No folder';
    sel.append(none);
    const path: string[] = [];
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

  function openFolderMenu(id: string, anchor: HTMLButtonElement | HTMLDivElement, ev?: MouseEvent) {
    state.menuFolderId = id;
    const menu = el.folderMenu;
    const node: Partial<FolderNode> = flattenTree(state.tree).find((n) => n.id === id) || {};
    el.folderMenuSync.classList.toggle('hidden', !node.isVaultRoot);
    el.folderMenuBook.textContent = node.book ? 'Turn back into a folder' : 'Turn into a book';
    el.folderMenuOpen.classList.toggle('hidden', !node.vaultId);
    const deleteItem = menu.querySelector('[data-action="delete"]');
    if (deleteItem) deleteItem.textContent = node.isVaultRoot ? 'Remove vault (keeps files)' : 'Delete folder';
    placePopover(menu, anchor, ev);
  }

  function closeFolderMenu() {
    state.menuFolderId = null;
    el.folderMenu.classList.add('hidden');
  }

  async function folderMenuAction(action: string | undefined) {
    const id = state.menuFolderId;
    closeFolderMenu();
    if (!id) return;
    const node: Partial<FolderNode> = flattenTree(state.tree).find((n) => n.id === id) || {};
    if (action === 'new-note') { await setView('folder', id); await newNote(); }
    else if (action === 'new-subfolder') startCreateFolder(id);
    else if (action === 'rename') startRename(id);
    else if (action === 'toggle-book') toggleBook(id, !node.book);
    else if (action === 'sync' && node.vaultId) syncVault(node.vaultId);
    else if (action === 'open-folder' && node.vaultId) api.vaults.openFolder(node.vaultId);
    else if (action === 'delete' && node.isVaultRoot && node.vaultId) removeVault(node.vaultId);
    else if (action === 'delete') deleteFolder(id);
  }

  const { syncVault, removeVault, addVaultFolder, openCloneDialog, submitClone, renderVaultList, describeVaultStatus } = createVaultsPanel({ api, refresh, flushSave, setView, leaveSettings, setExpanded });

  const GUEST = new URLSearchParams(location.search).get('pane') === 'right';
  const SIDE = GUEST ? 'right' : 'left';
  const tabs: { ids: (string | null)[], at: number, titles: Map<string, string>, split: boolean, active: 'left' | 'right', activeHere: boolean, ratio: number,
    frame: HTMLIFrameElement | null, peerReady: boolean, queue: PeerMessage[], peerIds: string[], peerCurrent: string | null, dragIndex: number | null, peerDrag: string | null } = {
    ids: [],
    at: 0,
    titles: new Map(),
    split: false,
    active: 'left',
    activeHere: false,
    ratio: 0.5,
    frame: null,
    peerReady: false,
    queue: [],
    peerIds: [],
    peerCurrent: null,
    dragIndex: null,
    peerDrag: null,
  };

  function peerWindow() { return GUEST ? window.parent : (tabs.frame && tabs.frame.contentWindow); }
  function toPeer(msg: PeerMessage) {
    if (!GUEST && !tabs.split) return;
    if (!GUEST && !tabs.peerReady) { tabs.queue.push(msg); return; }
    const w = peerWindow();
    if (!w || w === window) return;
    w.postMessage(Object.assign({ notesPane: true }, msg), '*');
  }
  function hasPeer() { return GUEST || tabs.split; }
  function peerHas(id: string | null | undefined) { return !!id && hasPeer() && tabs.peerIds.includes(id); }
  let peerChangedTimer: ReturnType<typeof setTimeout> | undefined;
  function peerChanged() {
    if (!hasPeer()) return;
    clearTimeout(peerChangedTimer);
    peerChangedTimer = setTimeout(() => toPeer({ type: 'changed' }), 250);
  }

  const mainEvents: { [N in MainEventName]?: (...args: MainEventArgsMap[N]) => unknown } = {};
  function fromMain<N extends MainEventName>(name: N, subscribe: (handler: (...args: MainEventArgs<N>) => void) => unknown, handler: (...args: MainEventArgs<N>) => unknown) {
    const slots: { [P in N]?: (...args: MainEventArgsMap[P]) => unknown } = mainEvents;
    slots[name] = handler;
    subscribe((...args) => { handler(...args); if (tabs.split) toPeer({ type: 'event', name, args }); });
  }
  function replayMainEvent<N extends MainEventName>(name: N, args: MainEventArgs<N>) {
    const handler = mainEvents[name];
    return handler ? handler(...args) : undefined;
  }

  function panesOf(settings: Settings | null): Panes {
    return (settings && settings.panes) || { split: false, ratio: 0.5, active: 'left', left: { ids: [], current: null }, right: { ids: [], current: null } };
  }

  function restoreTabs(settings: Settings | null) {
    const panes = panesOf(settings);
    const mine = panes[SIDE];
    tabs.ids = mine.ids.slice();
    tabs.at = Math.max(0, tabs.ids.indexOf(mine.current));
    if (GUEST) { renderTabs(); return; }
    tabs.ratio = panes.ratio;
    tabs.active = panes.split ? panes.active : 'left';
    tabs.peerIds = panes.split ? panes.right.ids.slice() : [];
    tabs.peerCurrent = panes.split ? panes.right.current : null;
    renderTabs();
  }

  function openIds() { return tabs.ids.flatMap((id) => (id ? [id] : [])); }

  function tabTitle(id: string | null) {
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
    el.tabBar.classList.toggle('is-solo', !GUEST && !tabs.split && tabs.ids.length === 1 && !!tabs.ids[0]);
    syncTitleBar();
    el.splitViewBtn.classList.toggle('hidden', GUEST || tabs.split);
    el.paneCloseBtn.classList.toggle('hidden', !GUEST);
    const missing = openIds().filter((id) => id !== state.currentId && !tabs.titles.has(id));
    if (missing.length) loadTabTitles(missing);
  }

  function renderActiveTabTitle() {
    const label = el.tabList.querySelector('.tab.is-active .tab-title');
    if (label && state.current) label.textContent = tabTitle(state.currentId);
  }

  let titlesLoading = false;
  async function loadTabTitles(ids: string[]) {
    if (titlesLoading) return;
    titlesLoading = true;
    let gone: string[] = [];
    try {
      const notes = await Promise.all(ids.map((id) => api.notes.get(id).catch(() => undefined)));
      notes.forEach((n, i) => { if (n) tabs.titles.set(ids[i], H.deriveTitle(n)); else if (n === null) gone.push(ids[i]); });
    } finally { titlesLoading = false; }
    gone = gone.filter((id) => id !== state.currentId);
    for (const id of gone) { const i = tabs.ids.indexOf(id); if (i >= 0) removeTabAt(i); }
    if (gone.length) tabsChanged(); else renderTabs();
  }

  function removeTabAt(i: number) {
    tabs.ids.splice(i, 1);
    if (i < tabs.at || tabs.at >= tabs.ids.length) tabs.at = Math.max(0, tabs.at - 1);
  }

  function placeInTab(id: string, newTab?: boolean) {
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

  let layoutTimer: ReturnType<typeof setTimeout> | undefined;
  function saveLayoutSoon() {
    if (GUEST) return;
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      const panes = {
        split: tabs.split, ratio: tabs.ratio, active: tabs.active,
        left: { ids: openIds(), current: state.currentId },
        right: { ids: tabs.split ? tabs.peerIds.slice() : [], current: tabs.split ? tabs.peerCurrent : null },
      };
      if (JSON.stringify(panes) === JSON.stringify(settingsNow().panes)) return;
      updateSettings({ panes }).catch(() => {});
    }, 1500);
  }

  function inTurn(fn: () => Promise<unknown>) {
    const run = state.selecting.then(fn).catch((err) => console.error('tab change failed', err));
    state.selecting = run;
    return run;
  }

  async function leaveNote() {
    if (tts.active) stopReadAloud();
    if (!(await flushDocuments({ commit: true })) && !window.confirm('Your changes to this document could not be saved (is it open in another app?). Leave it anyway and lose them?')) return false;
    let guard = 0;
    while (state.dirty && guard++ < 3) await flushSave();
    stashIfDirty();
    return true;
  }

  function showTab(i: number) {
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
      if (tabs.ids[tabs.at] === null && !state.currentId) return;
      if (!(await leaveNote())) return;
      blankEditor();
      const at = tabs.ids.length ? tabs.at + 1 : 0;
      tabs.ids.splice(at, 0, null);
      tabs.at = at;
      tabsChanged();
    });
  }

  function closeTab(i: number) {
    return inTurn(async () => {
      if (i < 0 || i >= tabs.ids.length) return;
      if (i !== tabs.at) { removeTabAt(i); tabsChanged(); return; }
      if (tabs.ids.length > 1) {
        const j = i + 1 < tabs.ids.length ? i + 1 : i - 1;
        const nextId = tabs.ids[j];
        if (nextId) {
          await selectNoteNow(nextId);
          if (state.currentId !== nextId) return;
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
      if (GUEST) toPeer({ type: 'close' });
    });
  }

  function cycleTab(step: number) {
    if (tabs.ids.length < 2) return;
    showTab((tabs.at + step + tabs.ids.length) % tabs.ids.length);
  }

  function openNote(id: string, opts?: OpenOpts) {
    opts = opts || {};
    if (!GUEST && tabs.split && !tabs.ids.includes(id) && (peerHas(id) || tabs.active === 'right')) {
      toPeer({ type: 'open', id, newTab: !!opts.newTab, focus: opts.focus || null });
      if (opts.focus && tabs.frame) tabs.frame.focus();
      return Promise.resolve();
    }
    return selectNote(id, opts);
  }

  function setActiveSide(side: 'left' | 'right') {
    if (GUEST || tabs.active === side) return;
    tabs.active = side;
    el.paneMain.classList.toggle('is-active-side', tabs.split && side === 'left');
    toPeer({ type: 'active', on: side === 'right' });
    saveLayoutSoon();
  }

  function applyRatio() {
    el.editorPane.style.setProperty('--peer-w', Math.round((1 - tabs.ratio) * 1000) / 10 + '%');
  }

  function openSplit(restoring: boolean) {
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
    if (!restoring) tabs.active = 'right';
    el.paneMain.classList.toggle('is-active-side', tabs.active === 'left');
    renderTabs();
    if (!restoring) saveLayoutSoon();
  }

  async function closeSplit() {
    if (GUEST || !tabs.split) return;
    if (!(await flushPeer({ leave: true }))) return;
    if (!tabs.split) return;
    dropFrame();
  }

  function dropFrame() {
    if (tabs.frame) tabs.frame.remove();
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

  let flushSeq = 0;
  const peerWaits = new Map<number, (reply: { ok?: boolean } | null) => void>();
  function askPeer(msg: { type: 'flush'; leave: boolean } | { type: 'release'; id: string }, ms: number): Promise<{ ok?: boolean } | null> {
    const seq = ++flushSeq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { peerWaits.delete(seq); resolve(null); }, ms);
      peerWaits.set(seq, (reply) => { clearTimeout(timer); peerWaits.delete(seq); resolve(reply); });
      toPeer(Object.assign({ seq }, msg));
    });
  }
  async function flushPeer(opts?: { leave?: boolean }) {
    if (GUEST || !tabs.split || !tabs.peerReady) return true;
    const leave = !!(opts && opts.leave);
    const reply = await askPeer({ type: 'flush', leave }, leave ? 10 * 60 * 1000 : 5000);
    if (leave) return !!(reply && reply.ok);
    return true;
  }

  async function takeFromPeer(id: string) {
    if (!peerHas(id)) return true;
    const reply = await askPeer({ type: 'release', id }, 10 * 60 * 1000);
    return !!(reply && reply.ok);
  }

  async function onPeerMessage(m: PeerMessage) {
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
        if (m.name === 'editCommand' && (m.args[0] === 'undo' || m.args[0] === 'redo')) runEditCommand(m.args[0]);
        else await replayMainEvent(m.name, m.args);
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
    if (!GUEST) await refresh({ keepEditor: true });
    tabs.titles.clear();
    renderTabs();
    const id = state.currentId;
    if (id && !state.dirty && !(await api.notes.get(id)) && state.currentId === id) { clearEditor(); if (!GUEST) await refresh(); }
  }

  function runSideCommand(name: string, m?: { title?: string }) {
    if (GUEST) return;
    if (name === 'newNote') newNote({ title: m && typeof m.title === 'string' ? m.title : '' });
    else if (name === 'search') searchList();
    else if (name === 'openFiles') openFiles();
    else if (name === 'settings') openSettings();
    else if (name === 'newFolder') startCreateFolder(state.view === 'folder' ? state.folderId : null);
    else if (name === 'toggleSidebar') toggleSidebar();
  }

  function runEditCommand(cmd: 'undo' | 'redo') {
    if (!GUEST && tabs.frame && document.activeElement === tabs.frame) { toPeer({ type: 'event', name: 'editCommand', args: [cmd] }); return; }
    if (state.rich && !state.sourceMode && el.richEditor.contains(document.activeElement)) state.rich.editor.chain().focus()[cmd === 'redo' ? 'redo' : 'undo']().run();
    else if (!src.undoRedo(cmd)) document.execCommand(cmd === 'redo' ? 'redo' : 'undo');
  }

  function dropIndex(e: DragEvent) {
    const t = closestTo(e, '.tab');
    return t ? Number(t.dataset.index) : tabs.ids.length;
  }
  function onTabDrop(e: DragEvent) {
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
    const id = (e.dataTransfer ? e.dataTransfer.getData('text/x-note-id') : '') || tabs.peerDrag;
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
      const t = closestTo(e, '.tab');
      if (!t) return;
      const i = Number(t.dataset.index);
      if (closestTo(e, '.tab-close')) closeTab(i); else showTab(i);
    });
    el.tabList.addEventListener('auxclick', (e) => { const t = closestTo(e, '.tab'); if (t && e.button === 1) { e.preventDefault(); closeTab(Number(t.dataset.index)); } });
    el.tabList.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    el.tabList.addEventListener('dragstart', (e) => {
      const t = closestTo(e, '.tab');
      if (!t) return;
      tabs.dragIndex = Number(t.dataset.index);
      if (e.dataTransfer) { e.dataTransfer.setData('text/x-notes-tab', String(tabs.dragIndex)); e.dataTransfer.effectAllowed = 'move'; }
      toPeer({ type: 'drag', id: tabs.ids[tabs.dragIndex] || null });
    });
    el.tabList.addEventListener('dragend', () => { tabs.dragIndex = null; toPeer({ type: 'drag', id: null }); });
    el.tabBar.addEventListener('dragover', (e) => {
      if (tabs.dragIndex === null && !tabs.peerDrag && !(e.dataTransfer && e.dataTransfer.types.includes('text/x-note-id'))) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      el.tabBar.classList.add('is-drop-target');
    });
    el.tabBar.addEventListener('dragleave', (e) => { if (!el.tabBar.contains(e.relatedTarget instanceof Node ? e.relatedTarget : null)) el.tabBar.classList.remove('is-drop-target'); });
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
    el.splitDivider.addEventListener('pointerdown', (e) => {
      if (!tabs.split) return;
      e.preventDefault();
      el.splitDivider.setPointerCapture(e.pointerId);
      el.splitDivider.classList.add('is-dragging');
      el.editorPane.classList.add('is-resizing');
      const move = (ev: PointerEvent) => {
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

  state.selecting = Promise.resolve();
  function selectNote(id: string, opts?: OpenOpts) {
    const run = state.selecting.then(() => selectNoteNow(id, opts)).catch((err) => console.error('selectNote failed', err));
    state.selecting = run;
    return run;
  }

  async function selectNoteNow(id: string, opts?: OpenOpts) {
    opts = opts || {};
    if (peerHas(id)) { toPeer({ type: 'open', id, focus: opts.focus || 'body' }); return; }
    if (state.currentId === id && state.current) { focusAfterOpen(opts.focus); return; }
    const started = performance.now();
    const from = state.current;
    if (!(await leaveNote())) return;
    const left = performance.now();
    if (state.inflight.has(id)) await state.inflight.get(id);
    const note = await api.notes.get(id);
    if (!note) {
      const gone = tabs.ids.indexOf(id);
      if (gone >= 0 && id !== state.currentId) { removeTabAt(gone); tabsChanged(); }
      return;
    }
    if (state.dirty) { await flushSave(); stashIfDirty(); }
    state.currentId = note.id;
    state.current = note;
    state.dirty = false;
    syncListCollapsed();
    closeAllBookMenus();
    if (readerOpen() && (bookOf(note) || {}).id !== reader.bookId) closeReader();
    el.titleInput.value = note.title;
    el.tagsInput.value = note.tags.join(', ');
    state.tagsEdited = false;
    el.bodyInput.value = note.body;
    const hasPending = applyPendingTo(note);
    if (hasPending && FM.fileKeepsTags(note)) el.tagsInput.value = FM.noteTags(el.bodyInput.value).join(', ');
    const plainFile = isPlainTextFile(note);
    const markdown = !plainFile && !isViewerOnlyFile(note);
    let lossless = true;
    if (state.rich) {
      lossless = state.rich.setMarkdown(markdown ? el.bodyInput.value : '');
      if (markdown && note.filePath && !note.home && lossless && !state.rich.lastRoundTripExact()) lossless = false;
    }
    state.currentLossless = lossless;
    state.lossyOverride = null;
    el.bodyInput.placeholder = plainFile ? 'Plain text.' : 'Markdown source. Ctrl+E switches back to the rendered view.';
    const wantSource = H.isTableFile(note) ? false : (plainFile || settingsNow().editorMode === 'source' || !lossless || !state.rich);
    if (wantSource !== state.sourceMode) applyEditorMode(wantSource);
    if (markdown && !lossless && state.lossyToastFor !== note.id) {
      state.lossyToastFor = note.id;
      toast(note.filePath && !note.home
        ? 'Opened as source: the rendered view would reformat this file. Ctrl+E switches anyway.'
        : 'Opened as Markdown source: the rendered view would change some of this note’s formatting.');
    }
    autoGrow();
    const inTrash = !!note.trashedAt;
    const fileReadOnly = isViewerOnlyFile(note);
    el.sourceBtn.classList.toggle('hidden', (plainFile && !H.isTableFile(note)) || fileReadOnly);
    syncSourceButton();
    [el.titleInput, el.tagsInput].forEach((i) => { i.readOnly = inTrash; });
    el.bodyInput.readOnly = inTrash || fileReadOnly;
    showCode(note, inTrash || fileReadOnly);
    renderLockState(note);
    if (state.rich) state.rich.setEditable(!inTrash && !fileReadOnly && !plainFile);
    renderFileRow(note);
    renderStickyButton(note);
    renderRemindButton(note);
    renderKeepOut(note);
    renderLiveRow(note);
    renderBookStrip(note);
    renderRelated(note);
    el.shareBtn.classList.toggle('hidden', !!note.trashedAt);
    if (find.open) closeFind();
    if (bot.open) describeBotScope();
    el.pinBtn.classList.toggle('hidden', inTrash);
    el.deleteBtn.classList.toggle('hidden', inTrash);
    setLabel(el.deleteBtn, trashLabel(note));
    el.lockBtn.classList.toggle('hidden', inTrash || ((!!note.filePath || !!note.vaultId) && !note.home));
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
    traceSwitch(from, note, started, left);
  }

  function traceSwitch(from: PublicNote | null, to: PublicNote, started: number, left: number) {
    const kindOf = (n: PublicNote | null) => (n && n.fileKind) || 'note';
    if (![from, to].some((n) => n && n.fileKind && H.CRAFT_OF[n.fileKind])) return;
    craftTrace('switch', { from: from ? from.id : null, fromKind: kindOf(from), to: to.id, toKind: kindOf(to), leaveMs: H.tenths(left - started), ms: H.msSince(started) });
  }

  function markActiveRow(id: string | null) {
    noteList.setActive(id);
    noteTree.setActive(id, treeActiveKey);
  }

  function focusAfterOpen(where?: OpenFocus | null) {
    if (where === 'title') el.titleInput.focus();
    else if (where === 'body') focusBody();
  }

  function updateStatus(note: Pick<PublicNote, 'trashedAt' | 'updatedAt'>) {
    const body = el.bodyInput.value;
    const stats = tableStatsNow();
    if (stats && tableShown()) {
      el.statusWords.textContent = stats.rows.toLocaleString() + (stats.rows === 1 ? ' row' : ' rows');
      el.statusChars.textContent = stats.cols + (stats.cols === 1 ? ' column' : ' columns');
    } else {
      const words = H.countWords(body);
      el.statusWords.textContent = words + (words === 1 ? ' word' : ' words');
      el.statusChars.textContent = body.length + (body.length === 1 ? ' character' : ' characters');
    }
    el.statusUpdated.textContent = note.trashedAt ? 'Trashed ' + H.relativeTime(note.trashedAt) : 'Edited ' + H.relativeTime(note.updatedAt);
  }

  function setSaved(label: string) {
    el.statusSaved.textContent = label;
    el.statusSaved.classList.toggle('is-saving', label === 'Saving…');
    el.statusSaved.classList.toggle('is-saved', label === 'Saved');
  }

  const { book, bookOf, renderBookStrip, stepPage, addPage, toggleBook, openSplitDialog, applySplit, openBookMenu, closeAllBookMenus, pageMenuAction, bookMenuAction, exportBook, reader, closeReader, readerOpen } = createBooks({ api, flattenTree, selectNote, selectNoteNow, refresh, flushSave, clearEditor, setView, trashCurrent, syncTitleBar });

  const { renderLiveRow, startLiveHost, stopLive, openLiveDialog, submitLiveDialog } = createLiveShare({ api, flushSave, refreshCurrentMeta, setView, selectNoteNow });

  const { openFind, closeFind, runFind, toggleReplace, replaceCurrent, replaceAll, clearFindHighlights, scrollTextareaToSelection, printNote, exportOfCurrent } = createFindBar({ api, flushSave, GUEST });

  const { createRichEditor, syncTextViews, renderTable, tableStatsNow, syncSourceButton, applyEditorMode, toggleSource, followLink, openLinkDialog, openLinkAtCaret } = createEditorView({ api, refresh, updateStatus, updateSettings, scopeListToNote, selectNoteNow, scheduleSave, runFind, clearFindHighlights });

  const { renderRelated, renderRelatedSoon } = createRelated({ api, followLink });

  const { renderStickyButton, toggleSticky } = createStickyButton({ api, flushSave, refreshCurrentMeta });
  let listPageNumbers = false;
  const rowCache = createRowCache((ids, query) => api.notes.rowsFor(ids, query));
  let noteIndex = new Map<string, number>();
  const noteList = createNoteList<RowSource>(el.noteList, {
    row: (id) => rowCache.get(id),
    need: (ids) => { rowCache.fetch(ids).then((got) => noteList.changed(got)).catch(() => {}); },
    html: (n, i, q) => (listPageNumbers ? '<span class="page-no">p. ' + (i + 1) + '</span>' : '') + rowInner(n, q),
    title: (n) => H.deriveTitle(n),
    tall: (n, q) => rowHasExcerpt(n, q),
    draggable: (n) => !n.trashedAt,
    open: (id, newTab) => { openNote(id, { newTab }); },
    dragStart: startNoteDrag,
    dragEnd: endNoteDrag,
  });

  const noteTree = createNoteTree<RowSource>(el.noteTree, {
    html: treeRowHtml,
    title: treeRowTitle,
    activate: activateTreeRow,
    openInTab: (id) => { openNote(id, { newTab: true }); },
    toggle: (item, on) => setTreeOpen(item.node.id, on),
    folderMenu: (id, row, e) => openFolderMenu(id, row, e),
    allowDrop: allowNoteDrop,
    drop: dropInto,
    dragStart: startNoteDrag,
    dragEnd: endNoteDrag,
  });

  const { renderLockState, onLockButton, submitLockDialog, unlockFromScreen, applyLockedNote, lockMenuAction } = createLocking({ api, renderFileRow, flushSave, applyEditorMode, runFind, scheduleSave, renderStickyButton, updateStatus, refreshRow });

  const { renderRemindButton, openRemindDialog, setReminder } = createReminders({ api, flushSave, refreshCurrentMeta });

  const { syncShareMenu, openShareMenu, closeShareMenu, shareAction } = createSharing({ api, flushSave, closeFind, GUEST, exportOfCurrent, exportCurrent, startLiveHost, openLiveDialog, stopLive });

  const { attachFiles, toggleRecording } = createAttachments({ api, flushSave, refresh });

  const { openHistory, restoreVersion, renderKeepOut, toggleKeepOut, recordAgain } = createHistoryDialog({ api, flushSave, applyEditorMode, runFind, scheduleSave });

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

  const { bot, toggleBot, describeBotScope, runBot, onBotEvent, openBotTerminal } = createBotPanel({ api, flushSave, refresh, applyFreshFileBody });

  const { tts, stopReadAloud, toggleReadAloud, populateVoices, startDictation } = createSpeech({ api });

  const { clearPdf, showPdf, pdfDirty, pdfBusy, flushPdf, reportFileSaved, commitPdf, pdfOpen, forgetShownPdf, bindPdfEvents } = createPdfNote({ api, externalLinkClick, showBanner, openFiles });

  const { crafts, useWordCraft, craftFor, craftDirty, flushCrafts, showCraftOnly } = createCraftNotes({ api, GUEST, setSaved, showBanner, openFiles, reportFileSaved, refresh, renderFileRow, checkCurrentFile: pollCurrentFile });

  const { clearDocx, showDocx, docxDirty, flushDocx, docxOpen, forgetShownDocx, bindDocxEvents } = createWordNote({ api, flushSave, showBanner, reportFileSaved, externalLinkClick, crafts, useWordCraft });

  function externalLinkClick(e: MouseEvent, href: string) {
    if (!/^https?:\/\//i.test(href)) return;
    if (e.ctrlKey || e.metaKey) api.app.openExternal(href);
    else toast('This link goes to ' + href + '. Ctrl+click to open it.');
  }

  const { showImage, clearImage, toggleImageSize, syncImageToggle } = createImages({ api, showBanner });

  function fileBadge(note: RowSource) {
    const documentKinds: (FileKind | null)[] = ['docx', 'sheet', 'image'];
    if (documentKinds.includes(note.fileKind)) return H.extOf(note.filePath).toUpperCase();
    if (note.fileKind !== 'text') return (note.fileKind || 'file').toUpperCase();
    if (!isPlainTextFile(note)) return 'Markdown';
    if (H.isTableFile(note)) return H.extOf(note.filePath).toUpperCase();
    return window.NotesCode ? window.NotesCode.languageFor(H.extOf(note.filePath)).name : 'Plain text';
  }

  function renderFileRow(note: PublicNote | null) {
    const isFile = !!(note && note.filePath && !note.home);
    el.fileRow.classList.toggle('hidden', !isFile);
    el.fileBanner.classList.add('hidden');
    if (!(isFile && note.fileKind === 'docx')) clearDocx();
    for (const [kind, key] of Object.entries(H.CRAFT_OF)) if (!(isFile && note.fileKind === kind)) crafts[key].clear();
    if (!(isFile && note.fileKind === 'pdf')) clearPdf();
    if (!(isFile && note.fileKind === 'image')) clearImage();
    closeConvertMenu();
    el.editorColumn.classList.toggle('shows-document', isFile && (note.fileKind === 'pdf' || !!(note.fileKind && H.CRAFT_OF[note.fileKind])));
    el.editor.classList.toggle('shows-image', isFile && note.fileKind === 'image');
    const craft = isFile ? craftFor(note) : null;
    const inCraft = !!craft && craft.usable();
    el.editorColumn.classList.toggle('shows-craft', inCraft);
    el.editor.classList.toggle('shows-craft', inCraft);
    syncTextViews(note);
    if (!isFile) return;
    el.fileKind.textContent = fileBadge(note);
    el.fileConvertBtn.classList.add('hidden');
    api.files.convertOptions(note.id).then((opts) => { if (state.currentId === note.id) el.fileConvertBtn.classList.toggle('hidden', !opts.length); }).catch(() => {});
    const shownPath = note.trashedAt && note.trashedFrom ? note.trashedFrom : note.filePath;
    el.filePath.textContent = shownPath;
    el.filePath.title = shownPath || '';
    if (note.fileKind === 'pdf') {
      el.pdfEditor.classList.remove('hidden');
      showBanner('Highlight, add text, draw or add a picture with the tools above; with a tool on, click a mark to move or delete it. Save writes your changes into this PDF, and the original is backed up first.');
      showPdf(note);
    } else if (note.fileKind === 'docx') {
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

  const { openConvertMenu, closeConvertMenu, convertCurrent } = createConvertMenu({ api, flushSave, openFiles });

  const WARM_DELAY_MS = 1500;
  const WARM_IDLE_MS = 5000;
  let warmUpStarted = false;
  function warmWordCraftSoon() {
    if (warmUpStarted || !useWordCraft()) return;
    warmUpStarted = true;
    setTimeout(() => requestIdleCallback(() => {
      likelyWordNote().then((n) => { if (n) crafts.wordcraft.warm(n); }).catch(() => {});
    }, { timeout: WARM_IDLE_MS }), WARM_DELAY_MS);
  }

  async function likelyWordNote() {
    for (const id of [state.currentId, ...tabs.ids]) {
      if (!id) continue;
      const n = await api.notes.get(id).catch(() => null);
      if (n && n.filePath && n.fileKind === 'docx' && !n.trashedAt) return n;
    }
    return api.notes.latestFile('docx');
  }

  const documentDirty = () => pdfDirty() || docxDirty() || craftDirty();
  const documentBusy = () => pdfBusy() || docxDirty() || craftDirty();
  async function flushDocuments(opts: { commit?: boolean }) {
    const pdfSaved = await flushPdf(opts);
    const docxSaved = await flushDocx(opts);
    const craftSaved = await flushCrafts();
    return pdfSaved && docxSaved && craftSaved;
  }

  function showBanner(text: string) {
    el.fileBanner.textContent = text;
    el.fileBanner.classList.toggle('hidden', !text);
  }

  async function openFiles(paths?: string[]) {
    await flushSave();
    let res;
    try { res = paths ? await api.files.link(paths) : await api.files.openDialog(); }
    catch (err) { toast('Could not open: ' + (err.message || err)); return; }
    if ('canceled' in res && res.canceled) return;
    if (res.linked.length) {
      state.query = ''; el.searchInput.value = '';
      if (state.view === 'trash') { state.view = 'all'; el.navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === 'all')); }
      await refresh({ keepEditor: true });
      if (res.firstId && res.firstId === state.currentId) {
        const fresh = await api.notes.get(res.firstId);
        if (fresh && state.current && state.currentId === fresh.id && !state.dirty && !state.inflight.has(fresh.id)
          && (fresh.body !== el.bodyInput.value || fresh.fileMtime !== state.current.fileMtime)) applyFreshFileBody(fresh);
      } else if (res.firstId) await openNote(res.firstId);
    }
    const failed = res.failed.length ? ' Could not open: ' + res.failed.join(', ') : '';
    toast((res.linked.length ? 'Opened ' + res.linked.length + (res.linked.length === 1 ? ' file' : ' files') : 'Nothing opened') + failed);
  }

  async function pollCurrentFile() {
    const note = state.current;
    if (!note || !note.filePath || state.dirty || document.hidden || documentBusy()) return;
    let res;
    try { res = await api.files.refresh(note.id); } catch (_) { return; }
    if (documentBusy()) return;
    if (state.currentId !== note.id) return;
    if (res.missing) { showBanner('The file no longer exists at ' + note.filePath + '. Your last view is kept here as a plain note.'); return; }
    if (res.changed && !state.dirty) {
      const fresh = await api.notes.get(note.id);
      if (state.currentId !== note.id || state.dirty || state.inflight.has(note.id) || !fresh || documentBusy()) return;
      applyFreshFileBody(fresh);
      toast('Reloaded from disk: the file changed outside Notes.');
    }
  }

  function tagsIntoBody() {
    if (!state.current || !FM.fileKeepsTags(state.current)) return false;
    const next = FM.setNoteTags(src.value, H.parseTags(el.tagsInput.value));
    if (next === src.value) return true;
    src.value = next;
    if (state.rich) state.rich.setFrontMatter(FM.splitFrontMatter(next).front);
    return true;
  }

  function showSavedTags(patch: FieldsPatch, updated: PublicNote) {
    if (patch.tags !== undefined && el.tagsInput.value === patch.tags) state.tagsEdited = false;
    if (state.tagsEdited || document.activeElement === el.tagsInput) return;
    if (H.parseTags(el.tagsInput.value).join(',') !== updated.tags.join(',')) el.tagsInput.value = updated.tags.join(', ');
  }

  function applyFreshFileBody(fresh: PublicNote) {
    state.current = fresh;
    showSavedTags({ title: fresh.title }, fresh);
    if (!state.dirty) state.pending.delete(fresh.id);
    src.reload(fresh.body);
    if (isViewerOnlyFile(fresh)) { showCode(fresh, true); renderFileRow(fresh); updateStatus(fresh); return; }
    if (H.isTableFile(fresh) && tableShown()) renderTable(fresh);
    if (state.rich && !isPlainTextFile(fresh)) {
      let lossless = state.rich.setMarkdown(fresh.body, { keepSelection: true });
      if (fresh.filePath && !fresh.home && lossless && !state.rich.lastRoundTripExact()) lossless = false;
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
    await commitPdf();
    if ((state.dirty || documentDirty()) && !window.confirm('Discard your unsaved edits and reload from disk?')) return;
    const id = state.currentId;
    if (!id) return;
    state.dirty = false;
    forgetShownPdf();
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
    if (find.open && state.sourceMode) runFind(true, true, true);
    setSaved('Saving…');
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flushSave, 350);
    if (state.current) updateStatus(state.current);
  }

  function currentPatch() {
    const patch: FieldsPatch = { title: el.titleInput.value, body: el.bodyInput.value, tags: state.tagsEdited ? el.tagsInput.value : undefined };
    if (isViewerOnlyFile(state.current)) delete patch.body;
    if (lockedNow()) delete patch.body;
    return patch;
  }

  function scheduleRetry() {
    if (state.retryTimer) clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(async () => {
      if (state.currentId && state.pending.has(state.currentId)) { state.dirty = true; await flushSave(); }
      await retryPending();
    }, 3000);
  }

  function offerConflictChoice(id: string, patch: NotePatch) {
    if (state.conflictShown === id) return;
    state.conflictShown = id;
    toast('This file changed on disk while you were editing. Reload it (your edit is dropped) or keep yours.', {
      label: 'Keep mine',
      run: async () => {
        state.conflictShown = null;
        const latest = state.currentId === id ? currentPatch() : (state.pending.get(id) || patch);
        try {
          const updated = await api.notes.update(id, Object.assign({}, latest, { force: true }));
          if (state.pending.get(id) === patch || state.pending.get(id) === latest) state.pending.delete(id);
          if (state.currentId === id && updated) {
            state.current = updated;
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

  function reportSaveFailure(err: Error | undefined) {
    if (state.saveErrorShown) return;
    state.saveErrorShown = true;
    toast('Could not save: ' + (err && err.message ? err.message : err) + '. Retrying.');
    setTimeout(() => { state.saveErrorShown = false; }, 10000);
  }

  async function retryPending() {
    let failed = false;
    for (const id of Array.from(state.pending.keys())) {
      if (id === state.currentId) continue;
      const patch = state.pending.get(id);
      if (!patch) continue;
      try {
        const updated = await api.notes.update(id, patch);
        if (state.pending.get(id) === patch) state.pending.delete(id);
        if (updated) {
          refreshRow(updated);
          toast('Saved earlier changes to "' + H.truncate(H.deriveTitle(updated), 30) + '"');
        }
      } catch (err) {
        if (/changed on disk/i.test(String(err && err.message))) { offerConflictChoice(id, patch); continue; }
        failed = true;
        reportSaveFailure(err);
      }
    }
    if (failed) scheduleRetry();
  }

  function stashIfDirty() {
    if (state.dirty && state.currentId) state.pending.set(state.currentId, currentPatch());
    if (state.pending.size) scheduleRetry();
  }

  function applyPendingTo(note: PublicNote) {
    const p = state.pending.get(note.id);
    if (!p) return false;
    el.titleInput.value = p.title;
    if (p.tags !== undefined) { el.tagsInput.value = p.tags; state.tagsEdited = true; }
    if (typeof p.body === 'string' && !(note.locked && !note.unlocked)) el.bodyInput.value = p.body;
    return true;
  }


  async function flushSave(opts?: { fromBlur?: boolean }) {
    const docsSaved = await flushDocuments({ commit: !(opts && opts.fromBlur === true) });
    const textSaved = await flushTextSave();
    return docsSaved && textSaved;
  }

  async function flushTextSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
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
      setSaved(state.dirty ? 'Saving…' : 'Saved');
      renderRelatedSoon();
      if (book.id && patch.title !== undefined) { const t = el.bookTabs.querySelector('.book-tab[data-id="' + id + '"] .t'); if (t) t.textContent = H.truncate(H.deriveTitle(updated) || 'Untitled', 28); }
      if (updated.filePath && el.filePath.textContent !== updated.filePath) { el.filePath.textContent = updated.filePath; el.filePath.title = updated.filePath; }
      if (el.titleInput.value === patch.title && updated.title !== patch.title && !state.dirty) el.titleInput.value = updated.title;
      showSavedTags(patch, updated);
    }
    const idx = noteIndex.get(id) ?? -1;
    if (idx !== -1) {
      const before = rowCache.get(id);
      refreshRow(updated);
      if (settingsNow().sort === 'updated' && idx !== 0) await refresh({ keepEditor: true });
      else if (before ? updated.tags.join(',') !== before.tags.join(',') : patch.tags !== undefined) await refresh({ keepEditor: true });
    }
    api.notes.tags().then(renderTags);
    return true;
  }

  async function newNote(opts?: { title?: string }) {
    const title = opts && typeof opts.title === 'string' ? opts.title.trim() : '';
    await flushSave();
    if (state.view === 'trash') {
      state.view = 'all';
      el.navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === 'all'));
    }
    const data: NoteCreate = {};
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

  function renderPinButton(on: boolean) {
    setPressed(el.pinBtn, on);
    el.pinBtn.title = on ? 'Unpin (Ctrl+D)' : 'Pin to the top (Ctrl+D)';
    el.pinBtn.setAttribute('aria-label', on ? 'Unpin note' : 'Pin note');
  }

  async function togglePin() {
    if (!state.current || state.current.trashedAt) return;
    await flushSave();
    const pinId = state.currentId;
    if (!pinId) return;
    const updated = await api.notes.togglePin(pinId);
    state.current = updated;
    if (!updated) return;
    renderPinButton(updated.pinned);
    await refresh({ keepEditor: true });
    toast(updated.pinned ? 'Pinned' : 'Unpinned');
  }

  async function trashCurrent() {
    if (!state.current || state.current.trashedAt) return;
    const id = state.currentId;
    if (!id) return;
    const before = state.current;
    const title = H.deriveTitle(before);
    await flushSave();
    if (documentDirty() && !window.confirm('Your changes to this document could not be saved. Move it to the trash anyway and lose them?')) return;
    const after = await api.notes.trash(id);
    clearEditor();
    await refresh();
    toast(trashedMessage(before, after, title), after ? { label: 'Undo', run: async () => { await api.notes.restore(id); await refresh({ keepEditor: true }); await selectNote(id); } } : undefined);
  }

  async function restoreCurrent() {
    if (!state.current || !state.current.trashedAt) return;
    const id = state.currentId;
    if (!id) return;
    await api.notes.restore(id);
    clearEditor();
    await refresh();
    toast('Restored');
  }

  async function destroyCurrent() {
    const id = state.currentId;
    if (!state.current || !id) return;
    if (!window.confirm('Delete "' + H.deriveTitle(state.current) + '" forever? This cannot be undone.')) return;
    state.pending.delete(id);
    state.dirty = false;
    await api.notes.destroy(id);
    clearEditor();
    await refresh();
    toast('Deleted');
  }

  async function emptyTrash() {
    const listed = state.noteIds.slice();
    const n = listed.length;
    if (!n) return;
    const scope = state.query ? ' matching your search' : ' in the trash';
    if (!window.confirm('Permanently delete ' + n + (n === 1 ? ' note' : ' notes') + scope + '? This cannot be undone.')) return;
    if (state.query) { for (const id of listed) await api.notes.destroy(id); }
    else await api.notes.emptyTrash();
    clearEditor();
    await refresh();
    toast(state.query ? 'Deleted ' + n + (n === 1 ? ' note' : ' notes') : 'Trash emptied');
  }

  async function duplicateCurrent() {
    if (!state.current) return;
    await flushSave();
    const id = state.currentId;
    if (!id) return;
    let copy;
    try { copy = await api.notes.duplicate(id); }
    catch (err) { toast('Could not duplicate: ' + (err.message || err)); return; }
    await refresh({ keepEditor: true });
    await selectNote(copy.id);
    toast('Duplicated');
  }

  async function exportCurrent() {
    if (!state.current) return;
    await flushSave();
    try {
      const id = state.currentId;
      if (!id) return;
      const res = await api.app.exportNote(id);
      if (res.ok) toast('Exported to ' + res.filePath);
    } catch (err) {
      toast('Export failed: ' + (err.message || err));
    }
  }

  const { showCode } = createCodeEditor({ runFind, autoGrow, scrollTextareaToSelection });

  const { wrapSelection, handleEditorKeydown } = createEditorText({ runFind, scheduleSave });

  function openSettings() {
    const s = settingsNow();
    draft = {};
    el.hotkeyInput.value = H.displayAccelerator(s.hotkey).replace(/ /g, '');
    el.hotkeyError.textContent = '';
    el.themeSelect.value = s.theme;
    renderSchemeGrid();
    syncSettingsDirty();
    el.fontSizeInput.value = String(s.fontSize);
    el.fontSizeValue.textContent = s.fontSize + 'px';
    el.openAtLoginInput.checked = s.openAtLogin;
    el.alwaysOnTopInput.checked = s.alwaysOnTop;
    syncAlignSeg(s.editorAlign);
    el.sidebarFloatInput.checked = !!s.sidebarCollapsed;
    el.editorFullWidthInput.checked = !s.editorWidth;
    el.editorWidthInput.disabled = !s.editorWidth;
    el.editorWidthInput.value = String(s.editorWidth || 760);
    el.editorWidthValue.textContent = (s.editorWidth || 760) + 'px';
    el.gitEnabledInput.checked = s.gitEnabled;
    el.gitRemoteInput.value = s.gitRemote;
    populateVoices();
    el.settingsSearch.value = '';
    filterSettings();
    el.settingsDialog.showModal();
    renderVaultList();
    el.ttsRateInput.value = String(s.ttsRate);
    el.ttsRateValue.textContent = Number(s.ttsRate).toFixed(1) + '×';
    refreshGitStatus();
    el.settingsScroll.scrollTop = 0;
    markSettingsSection();
    el.settingsSearch.focus();
  }

  let draft: SettingsPatch = {};
  const settingKeys = (o: SettingsPatch) => Object.keys(o).filter((k): k is keyof Settings => k in settingsNow());
  const same = (a: SettingValue | undefined, b: SettingValue | undefined) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  const draftSettings = () => Object.assign({}, state.settings, draft);
  function settingsDirty() { return settingKeys(draft).some((k) => !same(draft[k], settingsNow()[k])); }
  function setDraft(patch: SettingsPatch) {
    for (const k of settingKeys(patch)) { if (same(patch[k], settingsNow()[k])) delete draft[k]; else Object.assign(draft, { [k]: patch[k] }); }
    previewSettings();
    syncSettingsDirty();
  }
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
    if (state.settings) applySettings(state.settings);
    closeSettings();
  }
  function closeSettings() {
    draft = {};
    el.settingsDialog.close();
  }
  function requestCloseSettings() {
    if (!settingsDirty()) { closeSettings(); return; }
    const names = settingKeys(draft).filter((k) => !same(draft[k], settingsNow()[k])).map((k) => SETTING_NAMES[k] || k);
    el.settingsSaveList.textContent = 'Not saved yet: ' + names.join(', ') + '.';
    el.settingsSaveDialog.showModal();
  }
  async function leaveSettings() {
    if (settingsDirty()) await saveSettings(); else closeSettings();
  }

  const SETTING_NAMES: Partial<Record<keyof Settings, string>> = {
    hotkey: 'Global hotkey', theme: 'Theme', colorScheme: 'Colour scheme', customColors: 'Custom colours', sidebarCollapsed: 'Hide the sidebar',
    openAtLogin: 'Start at sign-in', alwaysOnTop: 'Keep above other windows', fontSize: 'Text size', editorWidth: 'Column width', editorAlign: 'Column position',
    ttsVoice: 'Read-aloud voice', ttsRate: 'Read-aloud speed', gitEnabled: 'Git history', gitRemote: 'Git remote',
  };

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
        if (sample.lastElementChild) sample.lastElementChild.classList.add('swatch-check');
        const name = document.createElement('span'); name.className = 'swatch-name'; name.textContent = id === T().CUSTOM ? 'Custom' : T().SCHEMES[id].name;
        b.append(sample, name);
        el.schemeGrid.append(b);
      }
    }
    for (const b of el.schemeGrid.querySelectorAll<HTMLElement>(':scope > *')) {
      const id = b.dataset.scheme;
      const picked = s.customColors && s.customColors[mode];
      const sw = id === T().CUSTOM && !picked ? T().swatch(s.colorScheme, s.customColors, mode) : T().swatch(id ?? '', s.customColors, mode);
      const sample = b.firstChild;
      if (!(sample instanceof HTMLElement)) continue;
      const accent = sample.querySelector<HTMLElement>('.swatch-accent');
      sample.style.background = sw.paper; sample.style.color = sw.text; if (accent) accent.style.background = sw.accent;
      const on = id === s.colorScheme;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    const seed = T().seedsOf(s.colorScheme, s.customColors, mode);
    el.customBgInput.value = seed.background; el.customTextInput.value = seed.text; el.customAccentInput.value = seed.accent;
    el.customModeNote.textContent = '(' + mode + ')';
    el.schemeResetBtn.disabled = s.colorScheme === T().BUILT_IN;
  }
  function chooseScheme(id: string | undefined) { setDraft({ colorScheme: id }); }
  function pickCustomColor() {
    const s = draftSettings();
    const mode = effectiveTheme(s);
    const custom = Object.assign({}, s.customColors || {});
    custom[mode] = { background: el.customBgInput.value, text: el.customTextInput.value, accent: el.customAccentInput.value };
    setDraft({ colorScheme: T().CUSTOM, customColors: custom });
  }
  function bindAppearance() {
    el.schemeGrid.addEventListener('click', (e) => { const b = closestTo(e, '.scheme-swatch'); if (b) chooseScheme(b.dataset.scheme); });
    el.schemeGrid.addEventListener('keydown', (e) => {
      const cols = getComputedStyle(el.schemeGrid).gridTemplateColumns.split(' ').length;
      const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: cols, ArrowLeft: -1, ArrowUp: -cols };
      const step = steps[e.key];
      if (!step) return;
      e.preventDefault();
      const all = [...el.schemeGrid.querySelectorAll<HTMLElement>(':scope > *')];
      const i = all.findIndex((b) => b.getAttribute('aria-checked') === 'true');
      const next = all[Math.max(0, Math.min(all.length - 1, i + step))];
      if (next === all[i]) return;
      chooseScheme(next.dataset.scheme);
      next.focus();
    });
    for (const input of [el.customBgInput, el.customTextInput, el.customAccentInput]) input.addEventListener('input', pickCustomColor);
    el.schemeResetBtn.addEventListener('click', () => setDraft({ colorScheme: T().BUILT_IN, customColors: null }));
  }

  function markSettingsSection() {
    const top = el.settingsScroll.getBoundingClientRect().top;
    const sections = [...el.settingsScroll.querySelectorAll<HTMLElement>('.settings-section')].filter((s) => s.offsetParent);
    let current = sections[0];
    for (const sec of sections) if (sec.getBoundingClientRect().top - top < 80) current = sec;
    if (el.settingsScroll.scrollTop + el.settingsScroll.clientHeight >= el.settingsScroll.scrollHeight - 4) current = sections[sections.length - 1];
    el.settingsNav.querySelectorAll('a').forEach((a) => a.classList.toggle('is-active', !!current && a.getAttribute('href') === '#' + current.id));
  }

  function bindSettingsNav() {
    el.settingsNav.addEventListener('click', (e) => {
      const a = closestTo(e, 'a[href^="#"]');
      if (!a) return;
      e.preventDefault();
      if (a.classList.contains('is-dim')) { el.settingsSearch.value = ''; filterSettings(); }
      const href = a.getAttribute('href');
      const sec = href ? el.settingsScroll.querySelector(href) : null;
      if (sec) sec.scrollIntoView({ block: 'start' });
    });
    el.settingsScroll.addEventListener('scroll', markSettingsSection, { passive: true });
    el.settingsSearch.addEventListener('input', filterSettings);
    el.settingsSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
      else if (e.key === 'Escape' && el.settingsSearch.value) { e.preventDefault(); e.stopPropagation(); el.settingsSearch.value = ''; filterSettings(); }
    });
    el.settingsDialog.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); el.settingsSearch.focus(); el.settingsSearch.select(); }
    });
  }

  function filterSettings() {
    const tokens = H.tokenize(el.settingsSearch.value);
    const ranges: Range[] = [];
    let any = false;
    for (const sec of el.settingsScroll.querySelectorAll('.settings-section')) {
      let hits = 0;
      for (const unit of sec.children) {
        if (unit.tagName === 'H3') continue;
        const text = (unit.textContent || '').toLowerCase();
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

  function collectMatches(root: Element, tokens: string[], out: Range[]) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      const text = (node.textContent || '').toLowerCase();
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
    const mode = settingsNow().listMode;
    el.listModeSeg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
  }

  function syncAlignSeg(value: string | undefined) {
    el.alignSeg.querySelectorAll<HTMLButtonElement>('button[data-align]').forEach((b) => {
      const on = b.dataset.align === value;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }

  async function refreshGitStatus() {
    renderGitStatus(await api.git.status());
  }

  function renderGitStatus(s: GitState | null) {
    if (!s) return;
    let text;
    if (!s.enabled) text = 'Off. Your notes file is still backed up to the backups folder.';
    else if (s.available === false) text = 'git was not found on this computer, so no history is being kept.';
    else if (!s.commits) text = s.pending ? 'First commit coming up…' : 'Repository ready; no commits yet.';
    else text = s.commits + (s.commits === 1 ? ' commit' : ' commits') + ', last ' + H.relativeTime(s.lastCommitAt ?? 0) + (s.pending ? ', changes waiting' : '') + (s.remote ? (s.lastPushAt ? ', pushed ' + H.relativeTime(s.lastPushAt) : ', not pushed yet') : '');
    if (s.lastError) text += '  Error: ' + s.lastError;
    el.gitStatus.textContent = text;
    el.gitPushBtn.dataset.off = !s.enabled || !s.remote ? '1' : '0';
    el.gitCommitBtn.dataset.off = !s.enabled ? '1' : '0';
    syncSettingsDirty();
  }

  function acceleratorFromEvent(e: KeyboardEvent) {
    const mods: string[] = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    const ignore = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'];
    if (ignore.includes(e.key)) return { partial: mods.join('+') + '+' };
    let key = e.key;
    const numpad: Record<string, string> = { NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec' };
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

  function commitHotkey(value: string) {
    const parsed = H.parseAccelerator(value);
    if (!parsed.ok) { el.hotkeyError.textContent = parsed.reason; return; }
    el.hotkeyError.textContent = '';
    el.hotkeyInput.value = H.displayAccelerator(parsed.value).replace(/ /g, '');
    setDraft({ hotkey: parsed.value });
  }

  let palette: ReturnType<typeof NotesPalette.create> | null = null;
  function openPalette(query?: string) {
    if (!palette) palette = NotesPalette.create({ dialog: el.palette, input: el.paletteInput, list: el.paletteList, source: paletteItems });
    paletteRows = null;
    closeMoreMenu(); closeShareMenu();
    palette.open(query);
  }

  const buttonWords = (b: HTMLButtonElement) => ((b.querySelector('.lbl') || {}).textContent || b.getAttribute('aria-label') || b.textContent || '').trim();
  const shortcutIn = (b: HTMLButtonElement) => ((b.querySelector('.keys') || {}).textContent || (/\((Ctrl[^)]*|F\d+|Esc)\)/.exec(b.title || '') || [])[1] || '').trim();
  const usable = (b: HTMLButtonElement) => !!b && !b.disabled && !b.classList.contains('hidden') && getComputedStyle(b).display !== 'none';

  function commandList() {
    const noteOpen = !!state.current && !el.editor.classList.contains('hidden');
    const fromButton = (b: HTMLButtonElement, group: string, extra?: Partial<Command>): Command => Object.assign({ id: b.id, group, title: buttonWords(b), icon: b.dataset.icon, keys: shortcutIn(b), ok: usable(b) && (group !== 'This note' || noteOpen), run: () => b.click() }, extra);
    const cmd = (id: string, group: string, title: string, icon: string, keys: string, run: () => unknown, ok?: boolean, keywords?: string): Command => ({ id, group, title, icon, keys, run, ok: ok === undefined ? true : ok, keywords });
    const side = (name: string, fn: () => unknown) => (GUEST ? () => toPeer({ type: 'command', name }) : fn);
    if (noteOpen) syncShareMenu();
    const list = [
      cmd('new-note', 'Create', 'New note', 'square-pen', 'Ctrl+N', side('newNote', newNote)),
      cmd('open-file', 'Create', 'Open a file as a note…', 'folder-open', 'Ctrl+O', side('openFiles', () => openFiles()), true, 'markdown pdf word docx txt'),
      cmd('new-folder', 'Create', 'New folder', 'folder-plus', 'Ctrl+Shift+N', () => startCreateFolder(state.view === 'folder' ? state.folderId : null), !GUEST),
      cmd('new-book', 'Create', 'New book', 'book-plus', '', () => startCreateFolder(null, true), !GUEST),
      cmd('filter-list', 'Go to', 'Filter the note list', 'search', 'Ctrl+Shift+F', searchList, true, 'search notes title text tags'),
      cmd('notes-folder', 'Go to', 'Show the notes folder', 'folder-open', '', showNotesFolder, !!(state.info && state.info.homeVaultId), 'folder files explorer location markdown disk'),
      fromButton(el.pinBtn, 'This note', { title: state.current && state.current.pinned ? 'Unpin' : 'Pin to the top', keys: 'Ctrl+D' }),
      fromButton(el.sourceBtn, 'This note', { title: state.sourceMode ? 'Show the rendered view' : 'Show Markdown source', keys: 'Ctrl+E' }),
      cmd('open-link', 'This note', 'Open link at caret', 'external-link', 'Alt+Enter', openLinkAtCaret, noteOpen && !!state.rich && !state.sourceMode, 'follow wikilink'),
      cmd('find', 'This note', 'Find in this note', 'search', 'Ctrl+F', () => openFind(), canFindInNote()),
      cmd('image-size', 'This note', 'Image: actual size, or fitted to the pane', 'zoom-in', 'Enter on the picture', () => toggleImageSize(), !!(state.current && state.current.fileKind === 'image'), 'zoom 100% fit picture'),
      cmd('replace', 'This note', 'Find and replace', 'replace', 'Ctrl+H', () => { if (!find.open) openFind(); toggleReplace(true); }, canFindInNote()),
      ...[...el.moreMenu.querySelectorAll<HTMLButtonElement>('.menu-item')].map((b) => fromButton(b, 'This note')),
      fromButton(el.restoreBtn, 'This note'),
      fromButton(el.destroyBtn, 'This note'),
      ...[...el.shareMenu.querySelectorAll<HTMLButtonElement>('button[data-action]')].map((b) => ({ id: 'share-' + b.dataset.action, group: 'Share', title: (b.textContent || '').trim(), icon: 'share-2', keys: '', ok: noteOpen && !!state.current && !state.current.trashedAt && !b.classList.contains('hidden'), run: () => shareAction(b.dataset.action ?? '') })),
      cmd('sidebar', 'View', sidebarLayout() === 'docked' ? 'Hide the sidebar' : 'Show the sidebar', 'panel-left', 'Ctrl+\\', toggleSidebar, !GUEST, 'auto hide float compact zen'),
      cmd('list', 'View', el.app.classList.contains('list-collapsed') ? 'Show the note list' : 'Hide the note list', 'list', 'Ctrl+Shift+\\', toggleList, !GUEST),
      cmd('list-mode', 'View', settingsNow().listMode === 'tree' ? 'Note list: show as a list' : 'Note list: show folders with their notes', settingsNow().listMode === 'tree' ? 'list' : 'folder-open', '', () => updateSettings({ listMode: settingsNow().listMode === 'tree' ? 'list' : 'tree' }).then(() => refresh({ keepEditor: true })), !GUEST, 'tree outline view'),
      cmd('focus', 'View', 'Focus: hide the sidebar and the list', 'eye', '', () => updateSettings({ sidebarCollapsed: true, listCollapsed: true }), !GUEST && !(settingsNow().sidebarCollapsed && settingsNow().listCollapsed), 'zen distraction free writing'),
      cmd('width', 'View', settingsNow().editorWidth ? 'Writing column: full width' : 'Writing column: readable width', 'columns-2', '', () => updateSettings({ editorWidth: settingsNow().editorWidth ? 0 : 760 }), !!state.settings, 'measure line length narrow wide'),
      fromButton(el.splitViewBtn, 'View', { title: 'Split view: open a second side', ok: usable(el.splitViewBtn) }),
      cmd('new-tab', 'View', 'New tab', 'plus', 'Ctrl+T', newEmptyTab),
      cmd('close-tab', 'View', 'Close this tab', 'x', 'Ctrl+W', () => closeTab(tabs.at), tabs.ids.length > 0),
      cmd('theme', 'View', effectiveTheme() === 'dark' ? 'Switch to light' : 'Switch to dark', 'sun-moon', 'Ctrl+Shift+L', () => updateSettings({ theme: effectiveTheme() === 'dark' ? 'light' : 'dark' }), true, 'theme dark light mode'),
      ...(['all', 'pinned', 'reminders', 'trash'] as const).map((v) => cmd('go-' + v, 'Go to', { all: 'All notes', pinned: 'Pinned', reminders: 'Reminders', trash: 'Trash' }[v], { all: 'notebook-text', pinned: 'star', reminders: 'bell', trash: 'trash-2' }[v], '', () => setView(v), !GUEST)),
      ...flattenTree(state.tree).map((f) => cmd('folder-' + f.id, 'Go to', (f.book ? 'Book: ' : 'Folder: ') + f.name, f.book ? 'book-open' : 'folder', '', () => setView('folder', f.id), !GUEST)),
      ...[...el.tagList.querySelectorAll<HTMLButtonElement>('.nav-item')].map((b) => cmd('tag-' + b.firstChild?.textContent, 'Go to', 'Tag: #' + b.firstChild?.textContent, 'hash', '', () => b.click(), !GUEST)),
      cmd('settings', 'App', 'Settings', 'settings', 'Ctrl+,', side('settings', openSettings), true, 'preferences options hotkey font search'),
      ...Object.keys(NotesThemes.SCHEMES).map((id) => cmd('scheme-' + id, 'View', 'Colour scheme: ' + NotesThemes.SCHEMES[id].name, 'palette', '', () => updateSettings({ colorScheme: id }), !GUEST && (settingsNow().colorScheme) !== id, 'theme colors appearance')),
      cmd('scheme-custom', 'View', 'Colour scheme: custom colours…', 'palette', '', side('settings', () => { openSettings(); document.getElementById('set-appearance')?.scrollIntoView({ block: 'start' }); }), true, 'theme colors appearance pick'),
      cmd('import', 'App', 'Import Markdown files…', 'download', '', () => el.importBtn.click(), !GUEST),
      cmd('export-all', 'App', 'Export all notes…', 'download', '', () => el.exportAllBtn.click(), !GUEST, 'backup json'),
      cmd('data-folder', 'App', 'Open the data folder', 'folder-open', '', () => el.dataFolderBtn.click(), !GUEST),
      cmd('hide', 'App', 'Hide Notes', 'x', 'Esc', () => flushSave().then(() => api.app.hide())),
    ];
    return list.filter((c) => c.ok && c.title);
  }

  async function paletteItems(query: string) {
    const commands = commandList();
    const commandsOnly = /^\s*>/.test(query);
    let notes = null;
    if (!commandsOnly) {
      if (!paletteRows) paletteRows = api.notes.rows({ sort: 'updated' }).catch((err) => { paletteRows = null; throw err; });
      const q = NotesPalette.queryOf(query);
      const [all, hitIds] = await Promise.all([paletteRows, q ? api.notes.searchIds(q) : Promise.resolve([])]);
      const hits = new Set(hitIds);
      const folders = new Map(flattenTree(state.tree).map((f) => [f.id, f.name]));
      notes = all.filter((n) => n.id !== state.currentId).map((n) => ({
        id: 'note-' + n.id, group: 'Notes', title: H.deriveTitle(n), icon: n.filePath && !n.home ? 'file-text' : n.locked ? 'lock' : n.pinned ? 'star' : 'notebook-text',
        hint: (n.folderId && folders.get(n.folderId)) || H.relativeTime(n.updatedAt),
        matches: () => !n.locked && hits.has(n.id),
        run: (opts: { newTab?: boolean }) => (opts.newTab ? openNote(n.id, { newTab: true }) : scopeListToNote(n).then(() => openNote(n.id))).then(() => focusBody()),
      }));
    }
    const out = NotesPalette.rank(query, commands, notes);
    const title = query.replace(/^\s*>\s*/, '').trim();
    if (title && !commandsOnly) out.push({ id: 'create', group: 'Create', title: 'New note "' + H.truncate(title, 60) + '"', icon: 'square-pen', keys: '', run: () => (GUEST ? toPeer({ type: 'command', name: 'newNote', title }) : newNote({ title })) });
    return out;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const inDialog = el.palette.open || el.settingsDialog.open || el.splitDialog.open || el.linkDialog.open || el.remindDialog.open || el.lockDialog.open || el.liveDialog.open || el.historyDialog.open || el.signDialog.open;
    if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's' && (pdfOpen() || docxOpen())) {
      e.preventDefault();
      if (pdfOpen()) flushPdf({ commit: true, explicit: true });
      if (docxOpen()) flushDocx({ explicit: true });
      return;
    }
    if (e.key === 'Escape') {
      if (inDialog) return;
      if (el.pdfEditor.contains(document.activeElement)) return;
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
      const guestCommands: Record<string, string> = { n: 'newNote', o: 'openFiles', ',': 'settings' };
      const cmd = e.shiftKey ? (k === 'n' ? 'newFolder' : null) : guestCommands[k];
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
        case 'h': e.preventDefault(); if (canFindInNote()) { if (!find.open) openFind(); toggleReplace(true); } return;
        case 'f': e.preventDefault(); if (canFindInNote()) openFind(); else searchList(); return;
        case 'e': e.preventDefault(); if (state.current) toggleSource(); return;
        case 'p': e.preventDefault(); openPalette(); return;
        case 'd': e.preventDefault(); togglePin(); return;
        case 's': e.preventDefault(); flushSave().then((ok) => toast(ok ? 'Saved' : 'Save failed, will retry')); return;
        case ',': e.preventDefault(); openSettings(); return;
        case '\\': e.preventDefault(); toggleSidebar(); return;
        case 'delete': if (!inTextField()) { e.preventDefault(); trashCurrent(); } return;
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
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); searchList(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); attachFiles(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'g') { e.preventDefault(); toggleRecording(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); openHistory(); return; }
    if (ctrl && !e.shiftKey && (e.key === 'PageDown' || e.key === 'PageUp')) { if (stepPage(e.key === 'PageDown' ? 1 : -1)) e.preventDefault(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); openRemindDialog(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); openShareMenu(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); printNote(); return; }
    if (e.key === 'F3' && find.open) { e.preventDefault(); runFind(!e.shiftKey); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); startDictation(); return; }
    if (e.altKey && !ctrl && !e.shiftKey && e.key === 'Enter' && !state.sourceMode && el.richEditor.contains(document.activeElement)) {
      e.preventDefault();
      openLinkAtCaret();
      return;
    }
    if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const idx = state.currentId === null ? -1 : state.noteIds.indexOf(state.currentId);
      const next = state.noteIds[idx + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) selectNote(next).then(() => focusBody());
    }
  }

  function bind() {
    el.newNoteBtn.addEventListener('click', () => newNote());
    el.emptyNewNoteBtn.addEventListener('click', () => newNote());
    el.paletteBtn.addEventListener('click', () => openPalette());
    el.moreBtn.addEventListener('click', () => { if (el.moreMenu.classList.contains('hidden')) openMoreMenu(); else closeMoreMenu(); });
    el.moreMenu.addEventListener('click', (e) => { if (closestTo(e, '.menu-item')) closeMoreMenu(); });
    bindMenuKeys();
    bindSettingsNav();
    bindSidebarFloat();
    el.tagsFold.addEventListener('click', () => updateSettings({ tagsCollapsed: !settingsNow().tagsCollapsed }));
    bindTreeKeys(el.folderTree);
    el.listModeSeg.addEventListener('click', (e) => {
      const b = closestTo(e, '[data-mode]');
      const mode = b && b.dataset.mode;
      if (mode === 'list' || mode === 'tree') updateSettings({ listMode: mode }).then(() => { syncListModeSeg(); refresh({ keepEditor: true }); });
    });
    el.sidebarFloatInput.addEventListener('change', () => { sidebarPeek = null; setDraft({ sidebarCollapsed: el.sidebarFloatInput.checked }); });
    el.openFileBtn.addEventListener('click', () => openFiles());
    el.fileRevealBtn.addEventListener('click', () => state.currentId && api.files.reveal(state.currentId));
    bindDocxEvents();
    bindPdfEvents();
    el.fileConvertBtn.addEventListener('click', () => { if (el.convertMenu.classList.contains('hidden')) openConvertMenu(); else closeConvertMenu(); });
    el.convertMenu.addEventListener('click', (e) => { const b = closestTo(e, '[data-to]'); if (b) convertCurrent(b.dataset.to ?? ''); });
    el.fileOpenBtn.addEventListener('click', async () => { if (!state.currentId) return; const err = await api.files.openExternal(state.currentId); if (err) toast('Could not open: ' + err); });
    el.fileReloadBtn.addEventListener('click', reloadCurrentFile);
    el.imageView.addEventListener('click', toggleImageSize);
    el.imageView.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleImageSize(); } });
    el.imageView.addEventListener('load', syncImageToggle);
    el.imageView.addEventListener('error', () => {
      if (!el.imageView.getAttribute('src')) return;
      showBanner('This image could not be shown: the file may be damaged, or in a format Notes cannot show. Use "Open with…" to open it.');
    });
    el.agentFilesBtn.addEventListener('click', addAgentFiles);
    el.vaultAddFolderBtn.addEventListener('click', addVaultFolder);
    el.vaultCloneBtn.addEventListener('click', openCloneDialog);
    el.vaultDestBtn.addEventListener('click', async () => { const d = await api.vaults.pickFolder(); if (d) el.vaultDestInput.value = d; });
    el.vaultCancelBtn.addEventListener('click', () => el.vaultDialog.close());
    el.vaultForm.addEventListener('submit', (e) => { e.preventDefault(); submitClone(); });
    fromMain('vaultStatus', api.on.vaultStatus, ({ id, status }) => {
      const before = state.vaultStatus[id] || {};
      state.vaultStatus[id] = status;
      if (status.lastError && status.lastError !== before.lastError) toast('Vault: ' + status.lastError);
      renderFolders();
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
    el.pageMenu.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((b) => b.addEventListener('click', () => pageMenuAction(b.dataset.action ?? '')));
    el.bookMenu.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((b) => b.addEventListener('click', () => bookMenuAction(b.dataset.action ?? '')));
    el.bookReaderCloseBtn.addEventListener('click', closeReader);
    el.bookReaderPdfBtn.addEventListener('click', () => exportBook('pdf'));
    el.bookReaderPrintBtn.addEventListener('click', () => exportBook('print'));
    el.bookReaderToc.addEventListener('click', (e) => {
      const a = closestTo(e, 'a[data-page]');
      if (!a) return;
      const sec = document.getElementById('reader-page-' + a.dataset.page);
      if (sec) sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    el.bookReaderBody.addEventListener('click', (e) => {
      const btn = closestTo(e, 'button[data-edit]');
      if (btn) { const id = btn.dataset.edit ?? ''; closeReader(); selectNote(id); return; }
      const link = closestTo(e, 'a[href]');
      if (link) { e.preventDefault(); followLink(link.getAttribute('href')); }
    });
    el.liveLinkBtn.addEventListener('click', async () => { const s = state.current && (await api.live.status(state.current.id)); if (s && s.url) openLiveDialog('link', s.url); });
    el.liveStopBtn.addEventListener('click', stopLive);
    el.liveForm.addEventListener('submit', (e) => { e.preventDefault(); submitLiveDialog(); });
    el.liveCancelBtn.addEventListener('click', () => el.liveDialog.close());
    el.liveCopyBtn.addEventListener('click', async () => { await api.app.copy({ text: el.liveLinkInput.value }); toast('Link copied'); });
    el.liveDialog.addEventListener('close', () => focusBody());
    fromMain('liveStatus', api.on.liveStatus, ({ id, status }) => {
      if (status && status.ended) { delete state.liveStatus[id]; if (state.current && state.current.id === id) { refreshCurrentMeta(); toast('The host ended the live share. Your copy of the note stays.'); } return; }
      if (status) state.liveStatus[id] = status; else delete state.liveStatus[id];
      if (state.current && state.current.id === id) { if (!status && state.current.live) refreshCurrentMeta(); else renderLiveRow(state.current); }
    });
    el.lockMenu.addEventListener('click', (e) => { const b = closestTo(e, '[data-action]'); if (b) lockMenuAction(b.dataset.action ?? ''); });
    el.lockForm.addEventListener('submit', (e) => { e.preventDefault(); submitLockDialog(); });
    el.lockCancelBtn.addEventListener('click', () => el.lockDialog.close());
    el.lockDialog.addEventListener('close', () => focusBody());
    el.lockScreen.addEventListener('submit', (e) => { e.preventDefault(); unlockFromScreen(); });
    fromMain('relocked', api.on.relocked, async (ids) => {
      for (const id of ids) state.pending.delete(id);
      for (const id of ids) tabs.titles.delete(id);
      renderTabs();
      if (readerOpen()) closeReader();
      if (state.currentId && ids.includes(state.currentId)) { state.dirty = false; const fresh = await api.notes.get(state.currentId); if (fresh) applyLockedNote(fresh); }
      refresh({ keepEditor: true });
    });
    el.remindQuick.addEventListener('click', (e) => { const b = closestTo(e, '[data-pick]'); if (b) setReminder(quickPick(b.dataset.pick ?? '')); });
    el.remindForm.addEventListener('submit', (e) => { e.preventDefault(); const t = Date.parse(el.remindInput.value); if (!Number.isFinite(t)) { toast('Pick a date and time'); return; } setReminder(t); });
    el.remindClearBtn.addEventListener('click', () => setReminder(null));
    el.remindCancelBtn.addEventListener('click', () => el.remindDialog.close());
    el.remindDialog.addEventListener('close', () => focusBody());
    api.on.notice((text) => toast(String(text)));
    api.on.editCommand(runEditCommand);
    api.on.reminderFired(({ id, title }) => {
      toast('⏰ ' + (title || 'Reminder'), { label: 'Open', run: async () => { await setView('all'); await openNote(id, { focus: 'body' }); } });
      refresh({ keepEditor: true }).then(() => { if (state.currentId === id) refreshCurrentMeta(); });
    });
    el.shareBtn.addEventListener('click', () => { if (el.shareMenu.classList.contains('hidden')) openShareMenu(); else closeShareMenu(); });
    el.shareMenu.addEventListener('click', (e) => { const b = closestTo(e, '[data-action]'); if (b) shareAction(b.dataset.action ?? ''); });
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
    el.historyKeepBtn.addEventListener('click', toggleKeepOut);
    el.historyRecordBtn.addEventListener('click', recordAgain);
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
    fromMain('stickiesChanged', api.on.stickiesChanged, () => { refreshCurrentMeta(); });
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
    let dragDepth = 0;
    document.addEventListener('dragenter', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) { dragDepth++; el.app.classList.add('is-dropping'); } });
    document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; el.app.classList.remove('is-dropping'); } });
    document.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      dragDepth = 0; el.app.classList.remove('is-dropping');
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      const paths = Array.from(e.dataTransfer.files).map((f) => api.files.pathFor(f)).filter((p): p is string => !!p);
      if (paths.length) openFiles(paths);
    });
    el.navItems.forEach((b) => b.addEventListener('click', () => { const view = b.dataset.view; if (isListView(view)) setView(view); }));
    el.themeBtn.addEventListener('click', () => updateSettings({ theme: effectiveTheme() === 'dark' ? 'light' : 'dark' }));
    el.settingsBtn.addEventListener('click', openSettings);
    el.toggleSidebarBtn.addEventListener('click', toggleSidebar);
    el.toggleListBtn.addEventListener('click', toggleList);
    el.hideListBtn.addEventListener('click', toggleList);
    setupResizer(el.sidebarResizer, 'sidebarWidth');
    setupResizer(el.listResizer, 'listWidth');

    el.newFolderBtn.addEventListener('click', () => startCreateFolder(state.view === 'folder' ? state.folderId : null));
    el.folderSelect.addEventListener('change', () => { if (state.currentId) moveNoteToFolder(state.currentId, el.folderSelect.value || null); });
    el.folderMenu.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach((b) => b.addEventListener('click', () => folderMenuAction(b.dataset.action)));
    document.addEventListener('pointerdown', (e) => {
      const target = e.target instanceof Node ? e.target : null;
      if (state.menuFolderId && !el.folderMenu.contains(target)) closeFolderMenu();
      if ((!el.pageMenu.classList.contains('hidden') || !el.bookMenu.classList.contains('hidden')) && !el.pageMenu.contains(target) && !el.bookMenu.contains(target) && !el.bookName.contains(target)) closeAllBookMenus();
      if (!el.shareMenu.classList.contains('hidden') && !el.shareMenu.contains(target) && !el.shareBtn.contains(target)) closeShareMenu();
      if (!el.moreMenu.classList.contains('hidden') && !el.moreMenu.contains(target) && !el.moreBtn.contains(target)) closeMoreMenu();
      if (!el.convertMenu.classList.contains('hidden') && !el.convertMenu.contains(target) && !el.fileConvertBtn.contains(target)) closeConvertMenu();
      if (!el.lockMenu.classList.contains('hidden') && !el.lockMenu.contains(target) && !el.lockBtn.contains(target)) el.lockMenu.classList.add('hidden');
    });
    wireDropTarget(el.navAll, null);
    window.addEventListener('resize', () => {
      if (!state.settings) return;
      applySidebar();
      applyPaneWidths(settingsNow().sidebarWidth, settingsNow().listWidth);
    });

    el.searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(endSearchStep, 120);
    });
    el.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && state.noteIds.length) { selectNote(state.noteIds[0]).then(() => focusBody()); }
      if (e.key === 'ArrowDown' && state.noteIds.length) { e.preventDefault(); selectNote(state.noteIds[0]).then(() => focusBody()); }
    });
    el.sortSelect.addEventListener('change', () => { const sort = el.sortSelect.value; if (sort === 'updated' || sort === 'created' || sort === 'title') updateSettings({ sort }).then(() => refresh({ keepEditor: true })); });
    el.emptyTrashBtn.addEventListener('click', emptyTrash);

    el.pinBtn.addEventListener('click', togglePin);
    el.sourceBtn.addEventListener('click', () => toggleSource());
    el.bodyInput.addEventListener('input', autoGrow);
    el.richEditor.addEventListener('mousedown', (e) => { if (e.target === el.richEditor && state.rich) { e.preventDefault(); state.rich.focus('end'); } });

    el.linkForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const href = el.linkInput.value.trim();
      el.linkDialog.close();
      if (state.rich) state.rich.setLink(href && href !== 'https://' ? href : '', state.linkRange);
    });
    el.linkRemoveBtn.addEventListener('click', () => { el.linkDialog.close(); if (state.rich) state.rich.setLink('', state.linkRange); });
    el.linkCancelBtn.addEventListener('click', () => el.linkDialog.close());
    el.linkDialog.addEventListener('close', () => focusBody());

    el.alignSeg.querySelectorAll<HTMLButtonElement>('button[data-align]').forEach((b) => b.addEventListener('click', () => { const align = b.dataset.align; if (align === 'left' || align === 'center' || align === 'right') { setDraft({ editorAlign: align }); syncAlignSeg(align); } }));
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

    el.gitEnabledInput.addEventListener('change', () => setDraft({ gitEnabled: el.gitEnabledInput.checked }));
    const commitRemote = () => setDraft({ gitRemote: el.gitRemoteInput.value.trim() });
    el.gitRemoteInput.addEventListener('change', commitRemote);
    el.gitRemoteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitRemote(); } });
    el.gitCommitBtn.addEventListener('click', async () => { await flushSave(); const r = await api.git.commit(); toast(r.ok ? (r.nothingToCommit ? 'Nothing new to commit' : 'Committed') : 'Commit failed: ' + (r.error || r.skipped)); refreshGitStatus(); });
    el.gitPushBtn.addEventListener('click', async () => { const r = await api.git.push(); toast(r.ok ? 'Pushed' : 'Push failed: ' + (r.error || r.skipped)); refreshGitStatus(); });
    fromMain('gitStatus', api.on.gitStatus, (s) => renderGitStatus(s));
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
    el.tagsInput.addEventListener('input', () => { if (!tagsIntoBody()) state.tagsEdited = true; });
    el.tagsInput.addEventListener('input', scheduleSave);
    el.bodyInput.addEventListener('input', scheduleSave);
    el.titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); focusBody(); } });
    el.tagsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); focusBody(); } });
    el.tagsInput.addEventListener('blur', () => flushSave());
    el.bodyInput.addEventListener('keydown', handleEditorKeydown);

    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave({ fromBlur: true }); });
    window.addEventListener('blur', () => flushSave({ fromBlur: true }));
    window.addEventListener('beforeunload', () => flushSave());

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
    el.themeSelect.addEventListener('change', () => { const theme = el.themeSelect.value; if (theme === 'system' || theme === 'light' || theme === 'dark') setDraft({ theme }); });
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
    el.settingsDialog.addEventListener('cancel', (e) => { e.preventDefault(); requestCloseSettings(); });
    el.cancelSettingsBtn.addEventListener('click', requestCloseSettings);
    el.settingsDialog.addEventListener('mousedown', (e) => { if (e.target === el.settingsDialog) requestCloseSettings(); });
    el.settingsSaveDialog.addEventListener('cancel', (e) => { e.preventDefault(); el.settingsSaveDialog.close(); });
    el.settingsSaveKeepBtn.addEventListener('click', () => el.settingsSaveDialog.close());
    el.settingsSaveDiscardBtn.addEventListener('click', () => { el.settingsSaveDialog.close(); discardSettings(); });
    const saveForm = el.settingsSaveDialog.querySelector('form');
    if (saveForm) saveForm.addEventListener('submit', (e) => { e.preventDefault(); el.settingsSaveDialog.close(); saveSettings(); });
    bindAppearance();

    let shownBusy = false;
    api.on.shown(async () => {
      if (shownBusy) return;
      shownBusy = true;
      try {
        await state.initDone;
        warmWordCraftSoon();
        noticeFilesMove();
        if (el.settingsDialog.open) return;
        if (state.current) {
          if (state.current.title || state.current.body) focusBody(); else el.titleInput.focus();
          return;
        }
        if (state.noteIds.length) {
          await selectNote(state.noteIds[0]);
          focusBody();
          return;
        }
        const counts = await api.notes.counts();
        if (counts.all === 0) await newNote();
      } finally {
        shownBusy = false;
      }
    });
    api.on.newNote(newNote);
    api.on.flush(async () => { try { await Promise.all([flushSave().then(retryPending), flushPeer()]); } finally { api.app.flushDone(); } });
    fromMain('reloaded', api.on.reloaded, async (info) => {
      const reason = info && info.reason;
      await refresh({ keepEditor: true });
      tabs.titles.clear();
      renderTabs();
      if (state.currentId) {
        const wanted = state.currentId;
        const fresh = await api.notes.get(wanted);
        if (fresh && fresh.id !== state.currentId) return;
        if (!fresh && wanted === state.currentId && !state.dirty) { clearEditor(); if (!GUEST) await refresh(); return; }
        if (fresh && state.current && reason === 'live' && fresh.body === el.bodyInput.value && fresh.title !== el.titleInput.value && !state.dirty) { el.titleInput.value = fresh.title; state.current.title = fresh.title; refreshRow(fresh); }
        if (fresh && state.current && isViewerOnlyFile(fresh) && fresh.fileMtime !== state.current.fileMtime) applyFreshFileBody(fresh);
        else if (fresh && fresh.body !== el.bodyInput.value) {
          if (reason === 'live') {
            if ((!state.dirty && !state.inflight.has(state.currentId)) || Date.now() - state.lastTypedAt > 1500) { state.dirty = false; applyFreshFileBody(fresh); if (fresh.title !== el.titleInput.value) el.titleInput.value = fresh.title; }
          } else if (!state.dirty && !state.inflight.has(fresh.id)) { applyFreshFileBody(fresh); if (reason === 'vault') toast('This note was updated from the vault.'); }
          else toast('This note changed elsewhere while you were editing. Your text is kept; ' + (fresh.filePath && !fresh.home ? 'use Reload to take the disk version.' : 'reopen the note to see the other version.'));
        }
      }
      if (reason === 'recovered') toast('Your notes file is readable again; saving resumed.');
    });
    fromMain('settingsChanged', api.on.settingsChanged, (s) => applySettings(s));
    fromMain('systemTheme', api.on.systemTheme, (t) => { state.systemDark = t === 'dark'; applyTheme(); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (ev) => { state.systemDark = ev.matches; applyTheme(); });

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
    if (settings.lastFolderId) { state.view = 'folder'; state.folderId = settings.lastFolderId; el.navItems.forEach((b) => b.classList.remove('is-active')); }
    await refresh();
    if (GUEST) { toPeer({ type: 'hello' }); return; }
    if (!state.currentId && state.noteIds.length) await selectNote(state.noteIds[0]);
    if (panesOf(settings).split) openSplit(true);
    if (state.current) focusBody();
    api.app.rendererReady().catch(() => {});
  }

  window.addEventListener('error', (e) => console.error('Uncaught: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('Unhandled rejection: ' + (e.reason && e.reason.message || e.reason)));

  let markInitDone: () => void;
  state.initDone = new Promise((resolve) => { markInitDone = resolve; });

  init().catch((err) => {
    console.error(err);
    toast('Something went wrong starting Notes: ' + err.message);
  }).finally(() => markInitDone());
})();
