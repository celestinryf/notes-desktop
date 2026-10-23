type Theme = 'system' | 'light' | 'dark';
type SortKey = 'updated' | 'created' | 'title';
type EditorAlign = 'left' | 'center' | 'right';
type FileKind = 'text' | 'pdf' | 'docx' | 'sheet' | 'image' | 'binary';
type Hex = string;

interface ColorSeed { background: Hex; text: Hex; accent: Hex }
interface CustomColors { light?: ColorSeed; dark?: ColorSeed }
interface WindowRect { x: number; y: number; width: number; height: number }
interface PaneSide { ids: string[]; current: string | null }
interface Panes { split: boolean; ratio: number; active: 'left' | 'right'; left: PaneSide; right: PaneSide }

interface Settings {
  hotkey: string;
  theme: Theme;
  colorScheme: string;
  customColors: CustomColors | null;
  fontSize: number;
  openAtLogin: boolean;
  alwaysOnTop: boolean;
  sort: SortKey;
  sidebarCollapsed: boolean;
  listCollapsed: boolean;
  listMode: 'tree' | 'list';
  listLayout: number;
  lastFolderId: string | null;
  sidebarWidth: number;
  listWidth: number;
  expandedFolders: string[];
  treeExpanded: string[];
  tagsCollapsed: boolean;
  editorMode: 'rendered' | 'source';
  editorAlign: EditorAlign;
  editorWidth: number;
  columnLayout: number;
  panes: Panes | null;
  gitEnabled: boolean;
  gitRemote: string;
  ttsVoice: string;
  ttsRate: number;
  zoomLevel: number;
  window: WindowRect | null;
}
type SettingsPatch = Partial<Settings>;

interface NoteLock { v: 1; kdf: 'scrypt'; N: number; salt: string; iv: string; tag: string; ct: string }
interface Sticky { x: number | null; y: number | null; w: number; h: number; color: string; onTop: boolean }
interface Live { role: 'host' | 'guest'; url: string; token?: string; port?: number; pending?: boolean }

interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  folderId: string | null;
  filePath: string | null;
  fileKind: FileKind | null;
  fileMtime: number | null;
  vaultId: string | null;
  trashedFrom: string | undefined;
  sticky: Sticky | null;
  live: Live | null;
  lock: NoteLock | null;
  remindAt: number | null;
  remindedAt: number | null;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  trashedAt: number | null;
}
interface PublicNote extends Omit<Note, 'lock'> { locked: boolean; unlocked: boolean }
type FileNote = Note & { filePath: string };

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  vaultId: string | null;
  dirPath: string | null;
  book: boolean;
  pageOrder: string[];
}
interface FolderNode {
  id: string; name: string; parentId: string | null; depth: number; count: number; total: number;
  children: FolderNode[]; vaultId: string | null; isVaultRoot: boolean; book: boolean;
}

interface Vault {
  id: string; name: string; path: string; remote: string; autoSync: boolean; syncMinutes: number; createdAt: number;
}

interface ListOpts {
  trashed?: boolean; pinned?: boolean; tag?: string; folderId?: string | null; recursive?: boolean;
  reminders?: boolean; query?: string; sort?: SortKey;
}
interface OutlineRow {
  id: string; title: string; folderId: string | null; pinned: boolean; locked: boolean; unlocked: boolean; sticky: boolean;
  fileKind: FileKind | null; filePath: string | null; remindAt: number | null; live: Live | null; createdAt: number; updatedAt: number;
}
type IndexNotePayload = { id: string; title: string; body: string; tags: string[] };
type IndexUpdate = { notes: readonly Note[]; dropped: readonly string[]; purge?: boolean } | null;
type IndexRequest =
  | { type: 'open'; file: string }
  | { type: 'sync-start'; seq: number }
  | { type: 'sync-part'; seq: number; notes: IndexNotePayload[] }
  | { type: 'sync-end'; seq: number }
  | { type: 'change'; seq: number; notes: IndexNotePayload[]; dropped: string[]; purge: boolean }
  | { type: 'candidates'; seq: number; query: string }
  | { type: 'incoming'; seq: number; id: string; names: string[] };
type IndexReply =
  | { type: 'synced'; seq: number; changed: number; removed: number; size: number }
  | { type: 'answer'; seq: number; ids: string[] | null }
  | { type: 'purged'; seq: number }
  | { type: 'failed'; seq: number; error: string };
interface ListRow extends OutlineRow { tags: string[]; trashedAt: number | null; excerpt?: string }
interface Counts { all: number; pinned: number; trash: number; reminders: number; overdue: number }
interface TagCount { tag: string; count: number }
interface NoteCreate { title?: string; body?: string; tags?: string[] | string; folderId?: string | null; pinned?: boolean; remindAt?: number | null }
interface NotePatch extends NoteCreate { remindedAt?: number | null }

interface AppInfo {
  version: string; dataDir: string; hotkey: string; hotkeyRegistered: boolean; hotkeyFallback: boolean; hotkeyDisplay: string;
  platform: NodeJS.Platform; crafts: Record<string, boolean>; loadError: string | null; documentsDir: string; saveBlocked: boolean;
  drySpeech: boolean; recoveredNotes: number | null; craftTrace: boolean;
}
type TraceFields = Record<string, string | number | boolean | null>;
interface SettingsResult { settings: Settings; info: AppInfo; error?: string | null }
interface RelatedItem { id: string; title: string; trashed?: boolean; locked?: boolean; missing?: boolean; sharedTags?: string[] }
interface RelatedNotes { outgoing: RelatedItem[]; incoming: RelatedItem[]; byTags: RelatedItem[] }
interface GitState {
  available: boolean | null; enabled: boolean; initialized: boolean; repoDir: string; remote: string; commits: number;
  lastCommitAt: number | null; lastPushAt: number | null; lastError: string | null; pending: boolean;
}
type GitResult = { ok: true; nothingToCommit?: boolean } | { ok: false; error?: string | null; skipped?: string };
interface GitCommit { hash: string; at: number; subject: string }
type FileResult = { ok: true; filePath: string } | { ok: false; error?: string; canceled?: boolean };
type PrintResult = { ok: boolean; error?: string | null; dry?: boolean };
type EmailResult = { ok: true; truncated: boolean } | { ok: false; error: string };
interface LiveStatus {
  role: 'host' | 'guest'; url: string; peers: number; connected: boolean; version?: number;
  error?: string | null; localOnly?: boolean; pending?: boolean; ended?: boolean;
}

interface VaultStatus {
  isRepo: boolean; branch?: string; remote?: string; ahead?: number; behind?: number; dirty?: boolean;
  syncing?: boolean; lastSyncAt?: number | null; conflict?: boolean; lastError?: string | null;
}
interface VaultView extends Vault { status: VaultStatus; rootFolderId: string | null }
type VaultResult = { ok: true; reason?: string } | { ok: false; error?: string; skipped?: string };
interface VaultScan { added: number; updated: number; removed: number; notes?: number; folders?: number; unavailable?: boolean }
interface Attachment { name: string; href: string; size: number }
type AttachmentResult = Attachment | { error: string; name: string };
interface AgentFile { filePath: string; label: string }
interface LinkResult { ok: boolean; linked: string[]; failed: string[]; firstId: string | null }
interface DocxPatch { start: number; end: number; old: string; xml: string }
type SavedFile = { mtime: number | null; backup: boolean; savedAs?: undefined } | { savedAs: string; newCopy: boolean; mtime?: undefined };
type CraftSave = SavedFile | { exported: string; own?: boolean } | { relinked: string; mtime: number | null };
interface ConvertOption { to: string; label: string; note: string }
type ConvertResult = { ok: true; filePath: string; warning: string } | { ok: false; error: string };
type MarkdownResult = { ok: true; markdown: string } | { ok: false; error: string };
type BotRun = { ok: true; cwd: string; kind: string; script?: string } | { ok: false; error: string };
interface WorkspaceImport { updated: number; created: number; missing: number; conflicts: number; details: string[]; updatedIds?: string[]; error?: string }
type BookExport = { ok: true; filePath?: string; dry?: boolean } | { ok: false; error?: string; canceled?: boolean };

interface HistoryVersion { hash: string; at: number; title: string; body: string; chars: number }
type HistoryVersions = { ok: true; versions: HistoryVersion[]; current: string } | { ok: false; error: string };

type Ok<T = {}> = ({ ok: true } & T) | { ok: false; error?: string; canceled?: boolean };

interface IpcContract {
  'notes:list': (opts?: ListOpts) => PublicNote[];
  'notes:rows': (opts?: ListOpts) => ListRow[];
  'notes:searchIds': (query: string) => string[];
  'notes:outline': (sort?: SortKey) => Record<string, OutlineRow[]>;
  'notes:get': (id: string) => PublicNote | null;
  'notes:latestFile': (kind: FileKind) => PublicNote | null;
  'notes:create': (data?: NoteCreate) => PublicNote;
  'notes:update': (id: string, patch: NotePatch) => PublicNote | null;
  'notes:togglePin': (id: string) => PublicNote | null;
  'notes:duplicate': (id: string) => PublicNote;
  'notes:splitIntoBook': (id: string, opts?: { name?: string; keepOriginal?: boolean }) => { folder: Folder; pageIds: string[]; originalTrashed: boolean };
  'notes:undoSplit': (folderId: string, pageIds: string[], originalId: string | null) => { restored: boolean; removedIds: string[] };
  'notes:trash': (id: string) => PublicNote | null;
  'notes:restore': (id: string) => PublicNote | null;
  'notes:destroy': (id: string) => boolean;
  'notes:emptyTrash': () => number;
  'notes:tags': () => TagCount[];
  'notes:counts': () => Counts;
  'notes:related': (id: string) => RelatedNotes | null;
  'notes:resolveLinks': (id: string, names: string[]) => (string | null)[];
  'notes:wikiLinkFor': (sourceId: string, targetId: string) => string | null;
  'folders:tree': () => FolderNode[];
  'folders:path': (id: string) => { id: string; name: string }[];
  'folders:create': (data: { name?: string; parentId?: string | null }) => Folder;
  'folders:rename': (id: string, name: string) => Folder | null;
  'folders:move': (id: string, parentId: string | null) => { error: string } | { folder: Folder };
  'folders:delete': (id: string) => null | { error: string } | { movedNotes: number; movedFolders: number; parentId: string | null };
  'folders:setBook': (id: string, on: boolean) => Folder | null;
  'folders:reorderPages': (id: string, ids: string[]) => Folder | null;
  'settings:get': () => Settings;
  'settings:set': (patch: SettingsPatch) => SettingsResult;
  'git:status': () => GitState;
  'git:commit': () => GitResult;
  'git:push': () => GitResult;
  'git:history': (limit?: number) => GitCommit[];
  'app:info': () => AppInfo;
  'app:hide': () => void;
  'app:titleBar': (colors: { color: string; symbol: string }) => boolean;
  'app:print': () => PrintResult;
  'app:rendererReady': () => { visible: boolean };
  'app:dictate': () => { ok: boolean; method?: string; dryRun?: boolean; error?: string };
  'app:openDataFolder': () => string;
  'app:openExternal': (url: string) => void;
  'app:exportNote': (id: string) => FileResult;
  'app:copy': (data: { text?: string; html?: string }) => boolean;
  'app:emailNote': (id: string) => EmailResult;
  'app:pdfPath': (id: string) => FileResult;
  'app:writePdf': (filePath: string) => FileResult;
  'app:exportHtml': (id: string, bodyHtml: string) => FileResult;
  'app:exportAll': () => FileResult;
  'app:importMarkdown': () => { canceled?: boolean; count: number; firstId?: string | null; failed?: string[] };
  'history:versions': (id: string, limit?: number) => HistoryVersions;
  'lock:set': (id: string, password: string) => PublicNote | null;
  'lock:unlock': (id: string, password: string) => PublicNote | null;
  'lock:relock': (id: string) => PublicNote | null;
  'lock:remove': (id: string, password: string) => PublicNote | null;
  'live:host': (id: string) => Ok<{ status: LiveStatus | null }>;
  'live:join': (url: string, folderId?: string | null) => Ok<{ noteId: string; status: LiveStatus | null }>;
  'live:stop': (id: string) => boolean;
  'live:status': (id: string) => LiveStatus | null;
  'stickies:list': () => { id: string; title: string; sticky: Sticky | null; open: boolean }[];
  'stickies:open': (id: string) => boolean;
  'stickies:close': (id: string, opts?: { forget?: boolean }) => boolean;
  'stickies:create': () => PublicNote | null;
  'stickies:setColor': (id: string, color: string) => Sticky | null | undefined;
  'stickies:setOnTop': (id: string, onTop: boolean) => Sticky | null | undefined;
  'stickies:openInNotes': (id: string) => boolean;
  'files:openDialog': () => { ok: boolean; canceled?: boolean; linked: string[]; failed: string[]; firstId?: string | null };
  'files:link': (paths: string[], opts?: Record<string, unknown>) => { ok: boolean; linked: string[]; failed: string[]; firstId: string | null };
  'files:refresh': (id: string) => { changed: boolean; missing: boolean };
  'files:reveal': (id: string) => void;
  'files:openExternal': (id: string) => string;
  'files:pdfBytes': (id: string) => Buffer;
  'files:savePdf': (id: string, bytes: Uint8Array, expectedMtime: number | null) => SavedFile;
  'files:pdfApplyPages': (id: string, bytes: Uint8Array | null, rotations: number[], expectedMtime: number | null) => Ok<{ mtime: number | null; backup: string }>;
  'files:pdfRestore': (id: string, name: string, expectedMtime: number | null) => Ok<{ mtime: number | null }>;
  'files:pdfComments': (id: string, ops: unknown[], expectedMtime: number | null) => Ok<{ mtime: number | null; backup: string }>;
  'files:pdfPickPages': () => Ok<{ name: string; bytes: Uint8Array<ArrayBuffer> }>;
  'files:saveDocx': (id: string, patches: DocxPatch[], expectedMtime: number | null) => SavedFile;
  'files:saveCraft': (id: string, bytes: Uint8Array, name: string, expectedMtime: number | null) => CraftSave;
  'files:documentBytes': (id: string) => Uint8Array;
  'files:docxBytes': (id: string) => Uint8Array;
  'files:imageBytes': (id: string) => { bytes: Uint8Array<ArrayBuffer>; mime: string };
  'files:convertOptions': (id: string) => ConvertOption[];
  'files:convert': (id: string, to: string) => ConvertResult;
  'files:asMarkdown': (id: string) => MarkdownResult;
  'signature:get': () => Uint8Array<ArrayBuffer> | null;
  'signature:set': (bytes: Uint8Array) => Ok;
  'signature:forget': () => Ok;
  'agentFiles:discover': () => AgentFile[];
  'agentFiles:link': () => LinkResult & { folderId: string; found: number };
  'attachments:pick': () => AttachmentResult[];
  'attachments:addPaths': (paths: string[]) => AttachmentResult[];
  'attachments:saveRecording': (bytes: Uint8Array, ext: string) => Attachment;
  'attachments:open': (href: string) => string;
  'attachments:reveal': (href: string) => boolean;
  'bot:run': (opts?: { prompt?: string; noteId?: string | null; allowEdits?: boolean }) => BotRun;
  'bot:cancel': () => boolean;
  'bot:openTerminal': (noteId: string | null) => BotRun;
  'bot:importWorkspace': () => WorkspaceImport | { error: string };
  'book:export': (format: string, data?: { name?: string; html?: string; markdown?: string; dialogTitle?: string }) => BookExport;
  'vaults:list': () => VaultView[];
  'vaults:pickFolder': () => string | null;
  'vaults:add': (data: { path: string; name?: string; remote?: string }) => VaultView;
  'vaults:clone': (url: string, dest: string, name?: string) => { ok: true; vault: VaultView } | { ok: false; error: string };
  'vaults:update': (id: string, patch: Partial<Vault>) => VaultView | null | { ok: false; error: string };
  'vaults:remove': (id: string) => boolean;
  'vaults:sync': (id: string) => VaultResult;
  'vaults:scan': (id: string) => VaultScan | null;
  'vaults:initRepo': (id: string, remote?: string) => VaultResult;
  'vaults:status': (id: string) => VaultStatus | null;
  'vaults:openFolder': (id: string) => string;
}
type IpcChannel = keyof IpcContract;
type IpcArgs<K extends IpcChannel> = Parameters<IpcContract[K]>;
type IpcResult<K extends IpcChannel> = Awaited<ReturnType<IpcContract[K]>>;
type Invoker<K extends IpcChannel> = (...args: IpcArgs<K>) => Promise<IpcResult<K>>;

type BotEvent =
  | { type: 'start'; cwd: string; kind: string; focus?: string; imported?: WorkspaceImport | { error: string } | null; plan?: string }
  | { type: 'out' | 'err'; text: string }
  | { type: 'end'; ok: boolean; error?: string; code?: number | null; imported?: WorkspaceImport | { error: string } | null }
  | ({ type: 'reloaded' } & VaultScan);

interface MainEvents {
  'app:shown': [];
  'app:new-note': [];
  'settings:changed': [settings: Settings];
  'theme:system': [theme: Theme];
  'git:status': [status: GitState];
  'app:flush': [];
  'notes:reloaded': [payload: { reason: string; id?: string }];
  'vault:status': [payload: { id: string; status: VaultStatus }];
  'bot:event': [event: BotEvent];
  'notes:changed': [payload: { id: string }];
  'sticky:changed': [sticky: Sticky | null];
  'stickies:changed': [];
  'app:open-note': [id: string];
  'reminder:fired': [payload: { id: string; title: string }];
  'app:notice': [message: string];
  'live:status': [payload: { id: string; status: LiveStatus | null }];
  'lock:relocked': [ids: string[]];
  'app:editCommand': [command: 'undo' | 'redo'];
}
type Listener<K extends keyof MainEvents> = (handler: (...args: MainEvents[K]) => void) => () => void;

interface NotesApi {
  notes: {
    list: Invoker<'notes:list'>; rows: Invoker<'notes:rows'>; searchIds: Invoker<'notes:searchIds'>; outline: Invoker<'notes:outline'>; get: Invoker<'notes:get'>; latestFile: Invoker<'notes:latestFile'>; create: Invoker<'notes:create'>;
    update: Invoker<'notes:update'>; togglePin: Invoker<'notes:togglePin'>; duplicate: Invoker<'notes:duplicate'>;
    splitIntoBook: Invoker<'notes:splitIntoBook'>; undoSplit: Invoker<'notes:undoSplit'>; trash: Invoker<'notes:trash'>;
    restore: Invoker<'notes:restore'>; destroy: Invoker<'notes:destroy'>; emptyTrash: Invoker<'notes:emptyTrash'>;
    tags: Invoker<'notes:tags'>; counts: Invoker<'notes:counts'>; related: Invoker<'notes:related'>;
    resolveLinks: Invoker<'notes:resolveLinks'>; wikiLinkFor: Invoker<'notes:wikiLinkFor'>;
  };
  signature: { get: Invoker<'signature:get'>; set: Invoker<'signature:set'>; forget: Invoker<'signature:forget'> };
  files: {
    openDialog: Invoker<'files:openDialog'>; link: Invoker<'files:link'>; refresh: Invoker<'files:refresh'>; reveal: Invoker<'files:reveal'>;
    openExternal: Invoker<'files:openExternal'>; pdfBytes: Invoker<'files:pdfBytes'>; savePdf: Invoker<'files:savePdf'>;
    pdfApplyPages: Invoker<'files:pdfApplyPages'>; pdfRestore: Invoker<'files:pdfRestore'>; pdfComments: Invoker<'files:pdfComments'>;
    saveDocx: Invoker<'files:saveDocx'>; saveCraft: Invoker<'files:saveCraft'>; documentBytes: Invoker<'files:documentBytes'>;
    pdfPickPages: Invoker<'files:pdfPickPages'>; docxBytes: Invoker<'files:docxBytes'>; imageBytes: Invoker<'files:imageBytes'>;
    convertOptions: Invoker<'files:convertOptions'>; convert: Invoker<'files:convert'>; asMarkdown: Invoker<'files:asMarkdown'>;
    pathFor: (file: File) => string | null;
  };
  agentFiles: { discover: Invoker<'agentFiles:discover'>; link: Invoker<'agentFiles:link'> };
  live: { host: Invoker<'live:host'>; join: Invoker<'live:join'>; stop: Invoker<'live:stop'>; status: Invoker<'live:status'> };
  attachments: {
    pick: Invoker<'attachments:pick'>; addPaths: Invoker<'attachments:addPaths'>; saveRecording: Invoker<'attachments:saveRecording'>;
    open: Invoker<'attachments:open'>; reveal: Invoker<'attachments:reveal'>;
  };
  lock: { set: Invoker<'lock:set'>; unlock: Invoker<'lock:unlock'>; relock: Invoker<'lock:relock'>; remove: Invoker<'lock:remove'> };
  stickies: {
    list: Invoker<'stickies:list'>; open: Invoker<'stickies:open'>; close: Invoker<'stickies:close'>; create: Invoker<'stickies:create'>;
    setColor: Invoker<'stickies:setColor'>; setOnTop: Invoker<'stickies:setOnTop'>; openInNotes: Invoker<'stickies:openInNotes'>;
  };
  bot: { run: Invoker<'bot:run'>; cancel: Invoker<'bot:cancel'>; openTerminal: Invoker<'bot:openTerminal'>; importWorkspace: Invoker<'bot:importWorkspace'> };
  book: { export: Invoker<'book:export'> };
  vaults: {
    list: Invoker<'vaults:list'>; pickFolder: Invoker<'vaults:pickFolder'>; add: Invoker<'vaults:add'>; clone: Invoker<'vaults:clone'>;
    update: Invoker<'vaults:update'>; remove: Invoker<'vaults:remove'>; sync: Invoker<'vaults:sync'>; scan: Invoker<'vaults:scan'>;
    initRepo: Invoker<'vaults:initRepo'>; status: Invoker<'vaults:status'>; openFolder: Invoker<'vaults:openFolder'>;
  };
  folders: {
    tree: Invoker<'folders:tree'>; path: Invoker<'folders:path'>; create: Invoker<'folders:create'>; rename: Invoker<'folders:rename'>;
    setBook: Invoker<'folders:setBook'>; reorderPages: Invoker<'folders:reorderPages'>; move: Invoker<'folders:move'>; delete: Invoker<'folders:delete'>;
  };
  settings: { get: Invoker<'settings:get'>; set: Invoker<'settings:set'> };
  git: { status: Invoker<'git:status'>; commit: Invoker<'git:commit'>; push: Invoker<'git:push'>; history: Invoker<'git:history'> };
  app: {
    info: Invoker<'app:info'>; hide: Invoker<'app:hide'>; print: Invoker<'app:print'>; copy: Invoker<'app:copy'>; emailNote: Invoker<'app:emailNote'>;
    pdfPath: Invoker<'app:pdfPath'>; writePdf: Invoker<'app:writePdf'>; exportHtml: Invoker<'app:exportHtml'>; rendererReady: Invoker<'app:rendererReady'>;
    dictate: Invoker<'app:dictate'>; flushDone: () => void; trace: (event: string, fields?: TraceFields) => void; openDataFolder: Invoker<'app:openDataFolder'>; openExternal: Invoker<'app:openExternal'>;
    exportNote: Invoker<'app:exportNote'>; exportAll: Invoker<'app:exportAll'>; importMarkdown: Invoker<'app:importMarkdown'>;
    historyVersions: Invoker<'history:versions'>; titleBar: Invoker<'app:titleBar'>;
  };
  on: {
    shown: Listener<'app:shown'>; newNote: Listener<'app:new-note'>; settingsChanged: Listener<'settings:changed'>; systemTheme: Listener<'theme:system'>;
    gitStatus: Listener<'git:status'>; flush: Listener<'app:flush'>; reloaded: Listener<'notes:reloaded'>; vaultStatus: Listener<'vault:status'>;
    botEvent: Listener<'bot:event'>; noteChanged: Listener<'notes:changed'>; stickyChanged: Listener<'sticky:changed'>; stickiesChanged: Listener<'stickies:changed'>;
    openNote: Listener<'app:open-note'>; reminderFired: Listener<'reminder:fired'>; notice: Listener<'app:notice'>; liveStatus: Listener<'live:status'>;
    relocked: Listener<'lock:relocked'>; editCommand: Listener<'app:editCommand'>;
  };
}

interface Window { notesApi: NotesApi }
