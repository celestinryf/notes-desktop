'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (handler) => {
  const wrapped = (_event, ...args) => handler(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld('notesApi', {
  notes: {
    list: invoke('notes:list'),
    get: invoke('notes:get'),
    create: invoke('notes:create'),
    update: invoke('notes:update'),
    togglePin: invoke('notes:togglePin'),
    duplicate: invoke('notes:duplicate'),
    trash: invoke('notes:trash'),
    restore: invoke('notes:restore'),
    destroy: invoke('notes:destroy'),
    emptyTrash: invoke('notes:emptyTrash'),
    tags: invoke('notes:tags'),
    counts: invoke('notes:counts'),
  },
  files: {
    openDialog: invoke('files:openDialog'),
    link: invoke('files:link'),
    refresh: invoke('files:refresh'),
    reveal: invoke('files:reveal'),
    openExternal: invoke('files:openExternal'),
    pdfUrl: invoke('files:pdfUrl'),
    // Drag-and-drop gives File objects; this turns them into real paths without exposing Node to the page.
    pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return null; } },
  },
  agentFiles: {
    discover: invoke('agentFiles:discover'),
    link: invoke('agentFiles:link'),
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
    rendererReady: invoke('app:rendererReady'),
    dictate: invoke('app:dictate'),
    flushDone: () => ipcRenderer.send('app:flush-done'),
    openDataFolder: invoke('app:openDataFolder'),
    openExternal: invoke('app:openExternal'),
    exportNote: invoke('app:exportNote'),
    exportAll: invoke('app:exportAll'),
    importMarkdown: invoke('app:importMarkdown'),
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
  },
});
