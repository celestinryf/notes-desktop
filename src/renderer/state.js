// @ts-check
// The open note is locked and not unlocked for now: its text is hidden and nothing may write it.
export const lockedNow = () => !!(state.current && state.current.locked && !state.current.unlocked);

// The settings, which init loads before anything that reads them runs. Asking earlier is a bug, and says so.
export function settingsNow() {
  if (!state.settings) throw new Error('settings are read before they were loaded');
  return state.settings;
}

/** @type {RendererState} */
export const state = {
  view: 'all',
  tag: null,
  folderId: null,
  tree: [],
  folderPath: [],
  menuFolderId: null,
  editingFolder: null,
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
  lastTypedAt: 0,
  liveStatus: {},
  vaultStatus: {},
  pending: new Map(),
  inflight: new Map(),
  selecting: Promise.resolve(),
};
