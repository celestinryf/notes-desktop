// The open note is locked and not unlocked for now: its text is hidden and nothing may write it.
export const lockedNow = () => !!(state.current && state.current.locked && !state.current.unlocked);

export const state = {
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
  lastTypedAt: 0,
  liveStatus: {},
  vaultStatus: {},
};
