const ZOOM_MIN = -3;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.5;

function zoomAction(input: Electron.Input) {
  if (!input || input.type !== 'keyDown') return null;
  if (!(input.control || input.meta) || input.alt) return null;
  const key = String(input.key || '');
  const code = String(input.code || '');
  if (key === '=' || key === '+' || code === 'Equal' || code === 'NumpadAdd') return 'in';
  if (key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract') return 'out';
  if ((key === '0' || code === 'Digit0' || code === 'Numpad0') && !input.shift) return 'reset';
  return null;
}

function nextZoom(level: number, action: string) {
  const cur = Number.isFinite(level) ? level : 0;
  if (action === 'reset') return 0;
  const next = action === 'in' ? cur + ZOOM_STEP : cur - ZOOM_STEP;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(next * 2) / 2));
}

function attachZoom(webContents: Electron.WebContents, opts?: { initial?: number, onChange?: (level: number) => void }) {
  opts = opts || {};
  if (Number.isFinite(opts.initial)) webContents.once('did-finish-load', () => { try { if (typeof opts.initial === 'number') webContents.setZoomLevel(opts.initial); } catch (_) {  } });
  webContents.on('before-input-event', (event, input) => {
    const action = zoomAction(input);
    if (!action) return;
    event.preventDefault();
    const level = nextZoom(webContents.getZoomLevel(), action);
    webContents.setZoomLevel(level);
    if (opts.onChange) opts.onChange(level);
  });
}

type MenuItemSpec = { label?: string, action?: string, arg?: string, enabled?: boolean, type?: 'separator', role?: Electron.MenuItemConstructorOptions['role'], accelerator?: string, click?: () => void };
function contextMenuTemplate(params: Electron.ContextMenuParams) {
  const p = params || {};
  const flags = p.editFlags || {};
  const items: MenuItemSpec[] = [];
  const word = String(p.misspelledWord || '');
  if (p.isEditable && word) {
    const suggestions = (p.dictionarySuggestions || []).slice(0, 6);
    for (const s of suggestions) items.push({ label: s, action: 'replaceMisspelling', arg: s });
    if (!suggestions.length) items.push({ label: 'No spelling suggestions', enabled: false });
    items.push({ label: 'Add "' + word + '" to dictionary', action: 'addToDictionary', arg: word });
    items.push({ type: 'separator' });
  }
  const link = String(p.linkURL || '');
  if (link) {
    if (/^https?:\/\//i.test(link)) items.push({ label: 'Open link in browser', action: 'openLink', arg: link });
    items.push({ label: 'Copy link address', action: 'copyText', arg: link });
    items.push({ type: 'separator' });
  }
  if (p.isEditable) {
    const nativeField = /^(text-area|input-)/.test(String(p.formControlType || ''));
    if (nativeField) {
      items.push({ role: 'undo', label: 'Undo', enabled: flags.canUndo !== false });
      items.push({ role: 'redo', label: 'Redo', enabled: flags.canRedo !== false });
    } else {
      items.push({ label: 'Undo', action: 'editUndo' });
      items.push({ label: 'Redo', action: 'editRedo' });
    }
    items.push({ type: 'separator' });
    items.push({ role: 'cut', label: 'Cut', enabled: !!flags.canCut });
    items.push({ role: 'copy', label: 'Copy', enabled: !!flags.canCopy });
    items.push({ role: 'paste', label: 'Paste', enabled: flags.canPaste !== false });
    items.push({ role: 'pasteAndMatchStyle', label: 'Paste as plain text', enabled: flags.canPaste !== false });
    items.push({ type: 'separator' });
    items.push({ role: 'selectAll', label: 'Select all', enabled: flags.canSelectAll !== false });
  } else if (String(p.selectionText || '').trim()) {
    items.push({ role: 'copy', label: 'Copy' });
    items.push({ role: 'selectAll', label: 'Select all' });
  }
  if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' });
  items.push({ label: 'Zoom in', accelerator: 'CommandOrControl+=', action: 'zoomIn' });
  items.push({ label: 'Zoom out', accelerator: 'CommandOrControl+-', action: 'zoomOut' });
  items.push({ label: 'Actual size', accelerator: 'CommandOrControl+0', action: 'zoomReset' });
  return items;
}

function attachContextMenu(webContents: Electron.WebContents, getWindow: () => Electron.BrowserWindow | null | undefined, deps: { Menu: typeof Electron.Menu, shell: Electron.Shell, clipboard: Electron.Clipboard, onZoom?: (level: number) => void }) {
  const { Menu, shell, clipboard } = deps;
  webContents.on('context-menu', (_event, params) => {
    const template = contextMenuTemplate(params).map((item) => {
      if (!item.action) return item;
      const out: MenuItemSpec = Object.assign({}, item);
      delete out.action; delete out.arg;
      out.click = () => {
        const arg = item.arg || '';
        switch (item.action) {
          case 'replaceMisspelling': webContents.replaceMisspelling(arg); break;
          case 'addToDictionary': webContents.session.addWordToSpellCheckerDictionary(arg); break;
          case 'openLink': if (/^https?:\/\//i.test(arg)) shell.openExternal(arg); break;
          case 'copyText': clipboard.writeText(arg); break;
          case 'editUndo': webContents.send('app:editCommand', 'undo'); break;
          case 'editRedo': webContents.send('app:editCommand', 'redo'); break;
          case 'zoomIn': case 'zoomOut': case 'zoomReset': {
            const level = nextZoom(webContents.getZoomLevel(), item.action === 'zoomIn' ? 'in' : item.action === 'zoomOut' ? 'out' : 'reset');
            webContents.setZoomLevel(level);
            if (deps.onZoom) deps.onZoom(level);
            break;
          }
          default: break;
        }
      };
      return out;
    });
    const win = getWindow();
    Menu.buildFromTemplate(template).popup(win && !win.isDestroyed() ? { window: win } : {});
  });
}

export { zoomAction, nextZoom, attachZoom, contextMenuTemplate, attachContextMenu, ZOOM_MIN, ZOOM_MAX };
