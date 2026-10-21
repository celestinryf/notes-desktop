// What the renderer pages find on window: the preload bridge, and the vendor bundles that esbuild exposes as
// globals (their types come from their own sources). The bundles are optional because a page checks for them.
type RichEditor = ReturnType<typeof import('../editor/index.js').create>;
type CodeEditor = ReturnType<typeof import('../code/index.js').create>;

interface Window {
  notesApi: NotesApi;
  NotesEditor?: typeof import('../editor/index.js');
  NotesCode?: typeof import('../code/index.js');
  // index.html loads these two before the page bundle, so they are always there.
  DocxView: typeof import('../docx-view/index.js');
  PdfView: typeof import('../pdf-view/index.js');
  NotesIcons?: { svg(name: string, size?: number): string; hydrate(root?: ParentNode | null): void; names: string[] };
}

// A live share as the page shows it (live.js reports it on every change).
interface LiveStatus {
  role: 'host' | 'guest'; url: string; peers: number; connected: boolean; version?: number;
  error?: string | null; localOnly?: boolean; pending?: boolean; ended?: boolean;
}

interface VaultStatus {
  isRepo: boolean; branch?: string; remote?: string; ahead?: number; behind?: number; dirty?: boolean;
  syncing?: boolean; lastSyncAt?: number | null; conflict?: boolean; lastError?: string | null;
}

interface FolderEdit { mode: 'create' | 'rename'; id?: string; parentId?: string | null; book?: boolean }

// The main page's state (state.js). Everything the page remembers between events lives here.
interface RendererState {
  view: 'all' | 'pinned' | 'trash' | 'tag' | 'folder' | 'reminders';
  tag: string | null;
  folderId: string | null;
  tree: FolderNode[];
  folderPath: { id: string; name: string }[];
  menuFolderId: string | null;
  editingFolder: FolderEdit | null;
  query: string;
  notes: OutlineRow[];
  currentId: string | null;
  current: PublicNote | null;
  sourceMode: boolean;
  rich: RichEditor | null;
  settings: Settings | null;
  info: AppInfo | null;
  systemDark: boolean;
  dirty: boolean;
  saveTimer: ReturnType<typeof setTimeout> | null;
  savingFor: string | null;
  lastTypedAt: number;
  liveStatus: Record<string, LiveStatus>;
  vaultStatus: Record<string, VaultStatus>;
  pending: Map<string, NotePatch>;
  inflight: Map<string, Promise<unknown>>;
  // Set while the page runs, not at start.
  outline?: OutlineRow[];
  selecting?: Promise<unknown>;
  currentLossless?: boolean | null;
  lossyOverride?: string | null;
  lossyToastFor?: string | null;
  conflictShown?: string | null;
  saveErrorShown?: boolean;
  retryTimer?: ReturnType<typeof setTimeout> | null;
  revealInTree?: string | null;
  linkRange?: { from: number; to: number } | null;
  splitNoteId?: string | null;
  menuPageId?: string | null;
  menuBookId?: string | null;
  initDone?: Promise<void>;
}
