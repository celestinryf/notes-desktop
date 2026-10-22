// @ts-check
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * @template {IpcChannel} K
 * @param {K} channel
 * @returns {Invoker<K>}
 */
const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
/**
 * @template {keyof MainEvents} K
 * @param {K} channel
 * @returns {Listener<K>}
 */
const on = (channel) => (handler) => {
  /**
 * @param {unknown} _event
 * @param {unknown[]} args
 */
  const wrapped = (_event, ...args) => handler(.../** @type {MainEvents[K]} */ (args));
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

const isOurPage = window.top === window || (location.protocol === 'file:' && /\/renderer\/index\.html$/.test(location.pathname) &&
  new URLSearchParams(location.search).get('pane') === 'right');

/** @type {NotesApi} */
const notesApi = {
  notes: {
    list: invoke('notes:list'),
    outline: invoke('notes:outline'),
    get: invoke('notes:get'),
    create: invoke('notes:create'),
    update: invoke('notes:update'),
    togglePin: invoke('notes:togglePin'),
    duplicate: invoke('notes:duplicate'),
    splitIntoBook: invoke('notes:splitIntoBook'),
    undoSplit: invoke('notes:undoSplit'),
    trash: invoke('notes:trash'),
    restore: invoke('notes:restore'),
    destroy: invoke('notes:destroy'),
    emptyTrash: invoke('notes:emptyTrash'),
    tags: invoke('notes:tags'),
    counts: invoke('notes:counts'),
    related: invoke('notes:related'),
  },
  signature: {
    get: invoke('signature:get'),
    set: invoke('signature:set'),
    forget: invoke('signature:forget'),
  },
  files: {
    openDialog: invoke('files:openDialog'),
    link: invoke('files:link'),
    refresh: invoke('files:refresh'),
    reveal: invoke('files:reveal'),
    openExternal: invoke('files:openExternal'),
    pdfBytes: invoke('files:pdfBytes'),
    savePdf: invoke('files:savePdf'),
    pdfApplyPages: invoke('files:pdfApplyPages'),
    pdfRestore: invoke('files:pdfRestore'),
    pdfComments: invoke('files:pdfComments'),
    saveDocx: invoke('files:saveDocx'),
    saveCraft: invoke('files:saveCraft'),
    documentBytes: invoke('files:documentBytes'),
    pdfPickPages: invoke('files:pdfPickPages'),
    docxBytes: invoke('files:docxBytes'),
    imageBytes: invoke('files:imageBytes'),
    convertOptions: invoke('files:convertOptions'),
    convert: invoke('files:convert'),
    asMarkdown: invoke('files:asMarkdown'),
    pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return null; } },
  },
  agentFiles: {
    discover: invoke('agentFiles:discover'),
    link: invoke('agentFiles:link'),
  },
  live: {
    host: invoke('live:host'),
    join: invoke('live:join'),
    stop: invoke('live:stop'),
    status: invoke('live:status'),
  },
  attachments: {
    pick: invoke('attachments:pick'),
    addPaths: invoke('attachments:addPaths'),
    saveRecording: invoke('attachments:saveRecording'),
    open: invoke('attachments:open'),
    reveal: invoke('attachments:reveal'),
  },
  lock: {
    set: invoke('lock:set'),
    unlock: invoke('lock:unlock'),
    relock: invoke('lock:relock'),
    remove: invoke('lock:remove'),
  },
  stickies: {
    list: invoke('stickies:list'),
    open: invoke('stickies:open'),
    close: invoke('stickies:close'),
    create: invoke('stickies:create'),
    setColor: invoke('stickies:setColor'),
    setOnTop: invoke('stickies:setOnTop'),
    openInNotes: invoke('stickies:openInNotes'),
  },
  bot: {
    run: invoke('bot:run'),
    cancel: invoke('bot:cancel'),
    openTerminal: invoke('bot:openTerminal'),
    importWorkspace: invoke('bot:importWorkspace'),
  },
  book: {
    export: invoke('book:export'),
  },
  vaults: {
    list: invoke('vaults:list'),
    pickFolder: invoke('vaults:pickFolder'),
    add: invoke('vaults:add'),
    clone: invoke('vaults:clone'),
    update: invoke('vaults:update'),
    remove: invoke('vaults:remove'),
    sync: invoke('vaults:sync'),
    scan: invoke('vaults:scan'),
    initRepo: invoke('vaults:initRepo'),
    status: invoke('vaults:status'),
    openFolder: invoke('vaults:openFolder'),
  },
  folders: {
    tree: invoke('folders:tree'),
    path: invoke('folders:path'),
    create: invoke('folders:create'),
    rename: invoke('folders:rename'),
    setBook: invoke('folders:setBook'),
    reorderPages: invoke('folders:reorderPages'),
    move: invoke('folders:move'),
    delete: invoke('folders:delete'),
  },
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
  },
  git: {
    status: invoke('git:status'),
    commit: invoke('git:commit'),
    push: invoke('git:push'),
    history: invoke('git:history'),
  },
  app: {
    info: invoke('app:info'),
    hide: invoke('app:hide'),
    print: invoke('app:print'),
    copy: invoke('app:copy'),
    emailNote: invoke('app:emailNote'),
    pdfPath: invoke('app:pdfPath'),
    writePdf: invoke('app:writePdf'),
    exportHtml: invoke('app:exportHtml'),
    rendererReady: invoke('app:rendererReady'),
    dictate: invoke('app:dictate'),
    flushDone: () => ipcRenderer.send('app:flush-done'),
    trace: (event, fields) => ipcRenderer.send('app:trace', event, fields),
    openDataFolder: invoke('app:openDataFolder'),
    openExternal: invoke('app:openExternal'),
    exportNote: invoke('app:exportNote'),
    exportAll: invoke('app:exportAll'),
    importMarkdown: invoke('app:importMarkdown'),
    historyVersions: invoke('history:versions'),
    titleBar: invoke('app:titleBar'),
  },
  on: {
    shown: on('app:shown'),
    newNote: on('app:new-note'),
    settingsChanged: on('settings:changed'),
    systemTheme: on('theme:system'),
    gitStatus: on('git:status'),
    flush: on('app:flush'),
    reloaded: on('notes:reloaded'),
    vaultStatus: on('vault:status'),
    botEvent: on('bot:event'),
    noteChanged: on('notes:changed'),
    stickyChanged: on('sticky:changed'),
    stickiesChanged: on('stickies:changed'),
    openNote: on('app:open-note'),
    reminderFired: on('reminder:fired'),
    notice: on('app:notice'),
    liveStatus: on('live:status'),
    relocked: on('lock:relocked'),
    editCommand: on('app:editCommand'),
  },
};
if (isOurPage) contextBridge.exposeInMainWorld('notesApi', notesApi);
