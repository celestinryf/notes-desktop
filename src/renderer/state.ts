export const lockedNow = () => !!(state.current && state.current.locked && !state.current.unlocked);

export function settingsNow() {
  if (!state.settings) throw new Error('settings are read before they were loaded');
  return state.settings;
}

export const state: RendererState = {
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
  sourceMode: false,
  rich: null,
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
