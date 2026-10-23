type RichEditor = ReturnType<typeof import('../editor/index.ts').create>;
type CodeEditor = ReturnType<typeof import('../code/index.ts').create>;

interface WindowControlsOverlay extends EventTarget {
  visible: boolean;
  getTitlebarAreaRect(): DOMRect;
  addEventListener(type: 'geometrychange', listener: () => void): void;
}
interface Navigator { windowControlsOverlay?: WindowControlsOverlay }

interface Window {
  notesApi: NotesApi;
  NotesEditor?: typeof import('../editor/index.ts');
  NotesCode?: typeof import('../code/index.ts');
  DocxView: typeof import('../docx-view/index.ts');
  PdfView: typeof import('../pdf-view/index.ts');
  NotesIcons?: { svg(name: string, size?: number): string; hydrate(root?: ParentNode | null): void; names: string[] };
}

type FolderEdit = { mode: 'create'; parentId: string | null; book: boolean } | { mode: 'rename'; id: string };
interface FieldsPatch { title: string; body?: string; tags: string }

interface RendererState {
  view: 'all' | 'pinned' | 'trash' | 'tag' | 'folder' | 'reminders';
  tag: string | null;
  folderId: string | null;
  tree: FolderNode[];
  folderPath: { id: string; name: string }[];
  menuFolderId: string | null;
  editingFolder: FolderEdit | null;
  query: string;
  notes: ListRow[];
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
  pending: Map<string, FieldsPatch>;
  inflight: Map<string, Promise<unknown>>;
  selecting: Promise<unknown>;
  outline?: Record<string, OutlineRow[]> | null;
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
