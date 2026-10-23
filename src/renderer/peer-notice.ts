type Writes<T> = readonly (keyof T)[];

function wrapWrites<T extends object>(ns: T, writes: Writes<T>, onWrite: () => void): T {
  const out = Object.assign({}, ns);
  for (const name of writes) {
    const fn = ns[name];
    if (typeof fn !== 'function') continue;
    const wrapped = (...args: unknown[]) => { const r = fn(...args); Promise.resolve(r).then(onWrite, () => {}); return r; };
    Object.defineProperty(out, name, { value: wrapped, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

export function withPeerNotice(raw: NotesApi, onWrite: () => void): NotesApi {
  if (!raw) return raw;
  const out = Object.assign({}, raw);
  const wrap = <K extends keyof NotesApi>(ns: K, writes: Writes<NotesApi[K]>) => {
    if (raw[ns]) out[ns] = wrapWrites(raw[ns], writes, onWrite);
  };
  wrap('notes', ['create', 'update', 'togglePin', 'duplicate', 'splitIntoBook', 'undoSplit', 'trash', 'restore', 'destroy', 'emptyTrash']);
  wrap('folders', ['create', 'rename', 'setBook', 'reorderPages', 'move', 'delete']);
  wrap('lock', ['set', 'unlock', 'relock', 'remove']);
  wrap('files', ['link', 'refresh', 'savePdf', 'pdfApplyPages', 'pdfRestore', 'saveDocx', 'saveCraft', 'convert', 'asMarkdown']);
  wrap('attachments', ['pick', 'addPaths', 'saveRecording']);
  wrap('stickies', ['open', 'close', 'create', 'setColor', 'setOnTop']);
  wrap('live', ['host', 'join', 'stop']);
  wrap('vaults', ['add', 'clone', 'update', 'remove', 'sync', 'scan', 'initRepo']);
  wrap('agentFiles', ['link']);
  wrap('app', ['importMarkdown']);
  return out;
}
