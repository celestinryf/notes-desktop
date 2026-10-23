'use strict';
import { tenths } from '../shared/helpers.mts';
export const NotesCraftFrame = (function () {
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

  function create<Context>({ frame, origin, url, readyMs, theme, darkPage, onSave, onDirty, onOpened, onOpenFailed, onUnavailable, onDrawn, trace }: { frame: HTMLIFrameElement, origin: string, url: string, readyMs?: number, theme?: string, darkPage?: boolean,
    onSave: (name: string, bytes: Uint8Array, context: Context) => Promise<{ ok: boolean, own: boolean }>, onDirty?: (dirty: boolean) => void,
    onOpened?: () => void, onOpenFailed?: (error: string) => void, onUnavailable?: () => void, onDrawn?: () => void, trace?: (event: string, fields?: TraceFields) => void }) {
    const mark = trace || (() => {});
    const numbers = (m: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.flatMap((k) => { const v = m[k]; return typeof v === 'number' ? [[k, tenths(v)]] : []; }));
    let ready = false;
    let loaded = false;
    let gaveUp = false;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    let queued: { name: string, bytes: Uint8Array, context: Context } | null = null;
    let current: { doc: string, name: string, context: Context } | null = null;
    let parked: { doc: string, name: string, context: Context } | null = null;
    let confirmed = false;
    let parkedDirty = false;
    let dirty = false;
    let unsaved = false;
    let waiters: ((ok: boolean) => void)[] = [];
    let saving: Promise<unknown> = Promise.resolve();

    function post(msg: unknown, transfer?: Transferable[]) {
      if (frame.contentWindow) frame.contentWindow.postMessage(msg, origin, transfer || []);
    }

    window.addEventListener('message', (e) => {
      const data: unknown = e.data;
      if (!loaded || e.source !== frame.contentWindow || e.origin !== origin || !isRecord(data)) return;
      const m = data;
      if (gaveUp) return;
      if (m.type === 'ready') {
        clearTimeout(readyTimer);
        ready = true;
        mark('ready');
        if (theme) post({ type: 'theme', value: theme });
        if (typeof darkPage === 'boolean') post({ type: 'page', dark: darkPage });
        if (queued) { const q = queued; queued = null; open(q.name, q.bytes, q.context); }
        return;
      }
      if (parked && m.doc === parked.doc && m.type === 'dirty' && m.dirty) parkedDirty = true;
      if (!current || m.doc !== current.doc) return;
      if (m.type === 'opened') {
        mark('opened', Object.assign({ ok: !!m.ok }, numbers(m, ['ms'])));
        confirmed = !!m.ok;
        if (m.ok) { if (onOpened) onOpened(); }
        else if (onOpenFailed) onOpenFailed(String(m.error || 'the app could not open it'));
      } else if (m.type === 'drawn') {
        mark('drawn', numbers(m, ['ms', 'frames', 'frameMs', 'renderMs', 'layoutMs']));
        if (onDrawn) onDrawn();
      } else if (m.type === 'dirty') {
        dirty = !!m.dirty;
        if (onDirty) onDirty(dirty || unsaved);
      } else if (m.type === 'save' && m.bytes instanceof Uint8Array && typeof m.name === 'string') {
        mark('save-message', { bytes: m.bytes.byteLength });
        const editedBefore = dirty || unsaved;
        const { name, bytes } = m;
        const doc = current.doc;
        const context = current.context;
        saving = saving.then(() => onSave(name, bytes, context)).catch(() => ({ ok: false, own: true })).then((res) => {
          mark('save-done', { ok: res.ok, own: res.own });
          if (!current || current.doc !== doc) return;
          if (res.own) {
            unsaved = !res.ok;
            if (onDirty) onDirty(dirty || unsaved);
            const done = waiters; waiters = [];
            done.forEach((w) => w(res.ok));
          } else if (editedBefore) {
            unsaved = true;
            if (onDirty) onDirty(true);
          }
        });
      }
    });

    function load() {
      if (loaded) return;
      loaded = true;
      mark('frame-load');
      frame.src = url;
      readyTimer = setTimeout(() => {
        if (ready) return;
        gaveUp = true;
        close();
        if (onUnavailable) onUnavailable();
      }, readyMs || 30000);
    }

    const token = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

    function open(name: string, bytes: Uint8Array, context: Context) {
      load();
      if (gaveUp) return;
      dirty = false;
      unsaved = false;
      waiters.forEach((w) => w(false));
      waiters = [];
      parked = null;
      confirmed = false;
      current = { doc: token(), name, context };
      if (!ready) { mark('post', { queued: true, bytes: bytes.byteLength }); queued = { name, bytes, context }; return; }
      mark('post', { queued: false, bytes: bytes.byteLength });
      const copy = new Uint8Array(bytes);
      post({ type: 'open', doc: current.doc, name, bytes: copy }, [copy.buffer]);
    }

    function requestSave(ms?: number): Promise<boolean> {
      const doc = current && current.doc;
      if (!ready || !doc || !(dirty || unsaved)) return Promise.resolve(true);
      return new Promise((resolve) => {
        const timer = setTimeout(() => { waiters = waiters.filter((w) => w !== finish); resolve(false); }, ms || 15000);
        function finish(ok: boolean) { clearTimeout(timer); resolve(ok); }
        waiters.push(finish);
        mark('save-request');
        post({ type: 'command', doc, id: 'file.save' });
      });
    }

    function park() {
      if (!current || !ready || !confirmed || dirty || unsaved) { close(); return false; }
      parked = current;
      parkedDirty = false;
      current = null;
      queued = null;
      return true;
    }

    function resume(context: Context) {
      if (!parked || parkedDirty || gaveUp || !ready) return false;
      current = { doc: parked.doc, name: parked.name, context };
      parked = null;
      confirmed = true;
      dirty = false;
      unsaved = false;
      return true;
    }

    function close() {
      waiters.forEach((w) => w(false));
      waiters = [];
      current = null;
      parked = null;
      confirmed = false;
      dirty = false;
      unsaved = false;
      queued = null;
    }

    return { open, park, resume, isConfirmed: () => confirmed, requestSave, isDirty: () => !!current && ready && (dirty || unsaved), close };
  }

  return { create };
})();
