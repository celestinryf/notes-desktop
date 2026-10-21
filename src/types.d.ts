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

interface Lock { v: 1; kdf: 'scrypt'; N: number; salt: string; iv: string; tag: string; ct: string }
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
  lock: Lock | null;
  remindAt: number | null;
  remindedAt: number | null;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  trashedAt: number | null;
}
interface PublicNote extends Omit<Note, 'lock'> { locked: boolean; unlocked: boolean }

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
  fileKind: FileKind | null; filePath: string | null; remindAt: number | null; live: Live | null; updatedAt: number;
}
interface Counts { all: number; pinned: number; trash: number; reminders: number; overdue: number }
interface TagCount { tag: string; count: number }
interface NoteCreate { title?: string; body?: string; tags?: string[] | string; folderId?: string | null; pinned?: boolean; remindAt?: number | null }
interface NotePatch extends NoteCreate { remindedAt?: number | null }

interface AppInfo {
  version: string; dataDir: string; hotkey: string; hotkeyRegistered: boolean; hotkeyFallback: boolean; hotkeyDisplay: string;
  platform: NodeJS.Platform; crafts: Record<string, boolean>; loadError: string | null; documentsDir: string; saveBlocked: boolean;
  drySpeech: boolean; recoveredNotes: number | null;
}
interface SettingsResult { settings: Settings; info: AppInfo; error?: string | null }

type Ok<T = {}> = { ok: boolean; error?: string; canceled?: boolean } & Partial<T>;

interface IpcContract {
  'notes:list': (opts?: ListOpts) => PublicNote[];
  'notes:outline': (sort?: SortKey) => Record<string, OutlineRow[]>;
  'notes:get': (id: string) => PublicNote | null;
  'notes:create': (data?: NoteCreate) => PublicNote;
  'notes:update': (id: string, patch: NotePatch) => PublicNote | null;
  'notes:togglePin': (id: string) => PublicNote | null;
  'notes:duplicate': (id: string) => PublicNote;
  'notes:splitIntoBook': (id: string, opts?: { level?: number; name?: string }) => { folderId: string; pageIds: string[]; originalTrashed: boolean };
  'notes:undoSplit': (folderId: string, pageIds: string[], originalId: string | null) => { restored: boolean; removedIds: string[] };
  'notes:trash': (id: string) => PublicNote | null;
  'notes:restore': (id: string) => PublicNote | null;
  'notes:destroy': (id: string) => boolean;
  'notes:emptyTrash': () => number;
  'notes:tags': () => TagCount[];
  'notes:counts': () => Counts;
  'notes:related': (id: string) => unknown;
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
  'git:status': () => unknown;
  'git:commit': () => unknown;
  'git:push': () => unknown;
  'git:history': (limit?: number) => unknown;
  'app:info': () => AppInfo;
  'app:hide': () => void;
  'app:titleBar': (colors: { color: string; symbol: string }) => boolean;
  'app:print': () => unknown;
  'app:rendererReady': () => unknown;
  'app:dictate': () => { ok: boolean; method?: string; dryRun?: boolean; error?: string };
  'app:openDataFolder': () => string;
  'app:openExternal': (url: string) => void;
  'app:exportNote': (id: string) => unknown;
  'app:copy': (data: { text?: string; html?: string }) => unknown;
  'app:emailNote': (id: string) => unknown;
  'app:pdfPath': (id: string) => unknown;
  'app:writePdf': (filePath: string) => unknown;
  'app:exportHtml': (id: string, bodyHtml: string) => unknown;
  'app:exportAll': () => unknown;
  'app:importMarkdown': () => { canceled?: boolean; count: number; firstId?: string | null; failed?: string[] };
  'history:versions': (id: string, limit?: number) => unknown;
  'lock:set': (id: string, password: string) => unknown;
  'lock:unlock': (id: string, password: string) => unknown;
  'lock:relock': (id: string) => PublicNote | null;
  'lock:remove': (id: string, password: string) => unknown;
  'live:host': (id: string) => Ok<{ status: unknown }>;
  'live:join': (url: string, folderId?: string | null) => Ok<{ noteId: string; status: unknown }>;
  'live:stop': (id: string) => unknown;
  'live:status': (id: string) => unknown;
  'stickies:list': () => { id: string; title: string; sticky: Sticky | null; open: boolean }[];
  'stickies:open': (id: string) => boolean;
  'stickies:close': (id: string, opts?: { forget?: boolean }) => boolean;
  'stickies:create': () => PublicNote | null;
  'stickies:setColor': (id: string, color: string) => unknown;
  'stickies:setOnTop': (id: string, onTop: boolean) => unknown;
  'stickies:openInNotes': (id: string) => boolean;
  'files:openDialog': () => { ok: boolean; canceled?: boolean; linked: string[]; failed: string[]; firstId?: string | null };
  'files:link': (paths: string[], opts?: Record<string, unknown>) => { ok: boolean; linked: string[]; failed: string[]; firstId: string | null };
  'files:refresh': (id: string) => unknown;
  'files:reveal': (id: string) => void;
  'files:openExternal': (id: string) => string;
  'files:pdfBytes': (id: string) => Buffer;
  'files:savePdf': (id: string, bytes: Uint8Array, expectedMtime: number) => unknown;
  'files:pdfApplyPages': (id: string, bytes: Uint8Array | null, rotations: number[], expectedMtime: number) => Ok<{ mtime: number | null; backup: string }>;
  'files:pdfRestore': (id: string, name: string, expectedMtime: number) => Ok<{ mtime: number | null }>;
  'files:pdfComments': (id: string, ops: unknown[], expectedMtime: number) => Ok<{ mtime: number | null; backup: string }>;
  'files:pdfPickPages': () => Ok<{ name: string; bytes: Buffer }>;
  'files:saveDocx': (...args: unknown[]) => unknown;
  'files:saveCraft': (...args: unknown[]) => unknown;
  'files:documentBytes': (id: string) => unknown;
  'files:docxBytes': (id: string) => unknown;
  'files:imageBytes': (id: string) => unknown;
  'files:convertOptions': (id: string) => unknown;
  'files:convert': (id: string, to: string) => unknown;
  'files:asMarkdown': (id: string) => unknown;
  'signature:get': () => Buffer | null;
  'signature:set': (bytes: Uint8Array) => Ok;
  'signature:forget': () => Ok;
  'agentFiles:discover': () => unknown;
  'agentFiles:link': (...args: unknown[]) => unknown;
  'attachments:pick': () => unknown;
  'attachments:addPaths': (paths: string[]) => unknown[];
  'attachments:saveRecording': (bytes: Uint8Array, ext: string) => unknown;
  'attachments:open': (href: string) => unknown;
  'attachments:reveal': (href: string) => unknown;
  'bot:run': (opts?: Record<string, any>) => unknown;
  'bot:cancel': () => boolean;
  'bot:openTerminal': (noteId: string) => unknown;
  'bot:importWorkspace': () => unknown;
  'book:export': (format: string, data?: { name?: string; html?: string; markdown?: string; dialogTitle?: string }) => unknown;
  'vaults:list': () => unknown;
  'vaults:pickFolder': () => string | null;
  'vaults:add': (data: { path: string; name?: string; remote?: string }) => unknown;
  'vaults:clone': (url: string, dest: string, name?: string) => unknown;
  'vaults:update': (id: string, patch: Partial<Vault>) => unknown;
  'vaults:remove': (id: string) => unknown;
  'vaults:sync': (id: string) => unknown;
  'vaults:scan': (id: string) => unknown;
  'vaults:initRepo': (id: string, remote?: string) => unknown;
  'vaults:status': (id: string) => unknown;
  'vaults:openFolder': (id: string) => unknown;
}
type IpcChannel = keyof IpcContract;
type IpcArgs<K extends IpcChannel> = Parameters<IpcContract[K]>;
type IpcResult<K extends IpcChannel> = Awaited<ReturnType<IpcContract[K]>>;
type Invoker<K extends IpcChannel> = (...args: IpcArgs<K>) => Promise<IpcResult<K>>;

interface MainEvents {
  'app:shown': [];
  'app:new-note': [];
  'settings:changed': [settings: Settings];
  'theme:system': [theme: Theme];
  'git:status': [status: unknown];
  'app:flush': [];
  'notes:reloaded': [payload: { reason: string; id?: string }];
  'vault:status': [payload: { id: string; status: unknown }];
  'bot:event': [event: unknown];
  'notes:changed': [payload: { id: string }];
  'sticky:changed': [payload: unknown];
  'stickies:changed': [payload: unknown];
  'app:open-note': [id: string];
  'reminder:fired': [payload: unknown];
  'app:notice': [message: string];
  'live:status': [payload: unknown];
  'lock:relocked': [ids: string[]];
  'app:editCommand': [command: string];
}
type Listener<K extends keyof MainEvents> = (handler: (...args: MainEvents[K]) => void) => () => void;

interface NotesApi {
  notes: {
    list: Invoker<'notes:list'>; outline: Invoker<'notes:outline'>; get: Invoker<'notes:get'>; create: Invoker<'notes:create'>;
    update: Invoker<'notes:update'>; togglePin: Invoker<'notes:togglePin'>; duplicate: Invoker<'notes:duplicate'>;
    splitIntoBook: Invoker<'notes:splitIntoBook'>; undoSplit: Invoker<'notes:undoSplit'>; trash: Invoker<'notes:trash'>;
    restore: Invoker<'notes:restore'>; destroy: Invoker<'notes:destroy'>; emptyTrash: Invoker<'notes:emptyTrash'>;
    tags: Invoker<'notes:tags'>; counts: Invoker<'notes:counts'>; related: Invoker<'notes:related'>;
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
    dictate: Invoker<'app:dictate'>; flushDone: () => void; openDataFolder: Invoker<'app:openDataFolder'>; openExternal: Invoker<'app:openExternal'>;
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
