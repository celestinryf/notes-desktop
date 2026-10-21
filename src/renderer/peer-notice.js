// @ts-check
export function withPeerNotice(raw, onWrite) {
  // Writes that change notes, folders or files. After one, the other side reloads its list and its note.
  const WRITES = {
    notes: ['create', 'update', 'togglePin', 'duplicate', 'splitIntoBook', 'undoSplit', 'trash', 'restore', 'destroy', 'emptyTrash'],
    folders: ['create', 'rename', 'setBook', 'reorderPages', 'move', 'delete'],
    lock: ['set', 'unlock', 'relock', 'remove'],
    files: ['link', 'refresh', 'savePdf', 'pdfApplyPages', 'pdfRestore', 'saveDocx', 'saveCraft', 'convert', 'asMarkdown'],
    attachments: ['pick', 'addPaths', 'saveRecording'],
    stickies: ['open', 'close', 'create', 'setColor', 'setOnTop'],
    live: ['host', 'join', 'stop'],
    vaults: ['add', 'clone', 'update', 'remove', 'sync', 'scan', 'initRepo'],
    agentFiles: ['link'],
    bot: ['importWorkspace'],
    app: ['importMarkdown'],
  };
  if (!raw) return raw;
  const out = {};
  for (const ns of Object.keys(raw)) {
    const writes = WRITES[ns];
    if (!writes) { out[ns] = raw[ns]; continue; }
    out[ns] = Object.assign({}, raw[ns]);
    for (const name of writes) {
      const fn = raw[ns][name];
      if (typeof fn === 'function') out[ns][name] = (...args) => { const r = fn(...args); Promise.resolve(r).then(onWrite, () => {}); return r; };
    }
  }
  return out;
}
