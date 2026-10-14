'use strict';
const { contextBridge, ipcRenderer } = require('electron');

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
  },
});
