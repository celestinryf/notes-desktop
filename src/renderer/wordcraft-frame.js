'use strict';
/* WordCraft in a frame: the full word processor (the user's own WordCraft, built to WebAssembly) editing a Word
   document in place of Notes' simple editor. The frame is loaded once and reused for every document.

   Messages (see WordCraft's apps/wordcraft-web/src/web/host.rs). Each document gets a token (doc) that WordCraft
   repeats on everything it says about it, so nothing about an earlier document is ever taken for the current one.
     to it:   { type: 'open', doc, name, bytes }   { type: 'command', doc, id: 'file.save' | 'edit.undo' | 'edit.redo' }
              { type: 'theme', value: 'light' | 'dark' }   { type: 'page', dark }
     from it: { type: 'ready' }   { type: 'opened', doc, ok, error }   { type: 'save', doc, name, bytes }   { type: 'dirty', doc, dirty }

   NotesWordCraft.create({ frame, origin, url, readyMs, theme, darkPage, onSave(name, bytes, context) -> Promise<boolean>,
                           onDirty(dirty), onOpened(), onOpenFailed(error), onUnavailable() })
   returns { open(name, bytes, context), requestSave(ms) -> Promise<boolean>, isDirty(), close() }
   theme and darkPage: WordCraft's look (its chrome, and a dark page), sent once it is ready. The dark page is a view
   setting in WordCraft, so the file is unchanged.
   context is the caller's own record of the document, handed back with each of its saves: a save WordCraft sent before
   the document was closed is still written with it, even if that happens after the close.
   onUnavailable: the frame never said it was ready (a build without hosted mode, or one that fails to load); nothing more
   is shown in it. */
(function () {
  function create({ frame, origin, url, readyMs, theme, darkPage, onSave, onDirty, onOpened, onOpenFailed, onUnavailable }) {
    let ready = false;
    let loaded = false;
    let gaveUp = false;    // the frame was not ready in time: it is not used again
    let readyTimer = null;
    let queued = null;     // the open waiting for the frame to be ready
    let current = null;    // { doc, name }: the document on show
    let dirty = false;     // WordCraft's own unsaved changes
    let unsaved = false;   // a save WordCraft made that did not reach the file: still unsaved for Notes
    let waiters = [];      // requestSave promises waiting for the next save of the current document
    let saving = Promise.resolve();

    function post(msg, transfer) {
      if (frame.contentWindow) frame.contentWindow.postMessage(msg, origin, transfer || []);
    }

    window.addEventListener('message', (e) => {
      if (!loaded || e.source !== frame.contentWindow || e.origin !== origin || !e.data || typeof e.data !== 'object') return;
      const m = e.data;
      if (gaveUp) return;
      if (m.type === 'ready') {
        clearTimeout(readyTimer);
        ready = true;
        if (theme) post({ type: 'theme', value: theme });
        if (typeof darkPage === 'boolean') post({ type: 'page', dark: darkPage });
        if (queued) { const q = queued; queued = null; open(q.name, q.bytes, q.context); }
        return;
      }
      // Everything else is about one document: only the one on show counts.
      if (!current || m.doc !== current.doc) return;
      if (m.type === 'opened') {
        if (m.ok) { if (onOpened) onOpened(); }
        else if (onOpenFailed) onOpenFailed(String(m.error || 'WordCraft could not open it'));
      } else if (m.type === 'dirty') {
        dirty = !!m.dirty;
        if (onDirty) onDirty(dirty || unsaved);
      } else if (m.type === 'save' && m.bytes instanceof Uint8Array && typeof m.name === 'string') {
        const ofThisDocument = m.name.toLowerCase() === current.name.toLowerCase(); // not a Save As or export
        // A copy under another name leaves the document's own file as it was: if there were edits, they are still
        // unsaved for Notes (WordCraft calls the document saved after any save).
        const editedBefore = dirty || unsaved;
        const doc = current.doc;
        const context = current.context;
        // One save at a time, in the order they were made, each to the document it was made in.
        // A save that throws counts as failed and never stops the ones after it.
        saving = saving.then(() => onSave(m.name, m.bytes, context)).catch(() => false).then((ok) => {
          if (!current || current.doc !== doc) return;
          if (ofThisDocument) {
            unsaved = ok === false;
            if (onDirty) onDirty(dirty || unsaved);
            const done = waiters; waiters = [];
            done.forEach((w) => w(ok !== false));
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
      frame.src = url;
      readyTimer = setTimeout(() => {
        if (ready) return;
        gaveUp = true;
        close();
        if (onUnavailable) onUnavailable();
      }, readyMs || 30000);
    }

    const token = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

    // Shows a document. A copy of the bytes goes in, so the caller's buffer stays usable.
    function open(name, bytes, context) {
      load();
      if (gaveUp) return;
      dirty = false;
      unsaved = false;
      waiters.forEach((w) => w(false));
      waiters = [];
      current = { doc: token(), name, context };
      if (!ready) { queued = { name, bytes, context }; return; }
      const copy = new Uint8Array(bytes);
      post({ type: 'open', doc: current.doc, name, bytes: copy }, [copy.buffer]);
    }

    // Asks WordCraft to save; resolves true once the save reached the file, false on failure or after ms.
    function requestSave(ms) {
      if (!ready || !current || !(dirty || unsaved)) return Promise.resolve(true);
      return new Promise((resolve) => {
        const timer = setTimeout(() => { waiters = waiters.filter((w) => w !== finish); resolve(false); }, ms || 15000);
        function finish(ok) { clearTimeout(timer); resolve(ok); }
        waiters.push(finish);
        post({ type: 'command', doc: current.doc, id: 'file.save' });
      });
    }

    // Nothing on show any more: whatever WordCraft says about the last document is ignored.
    function close() {
      waiters.forEach((w) => w(false));
      waiters = [];
      current = null;
      dirty = false;
      unsaved = false;
      queued = null;
    }

    return { open, requestSave, isDirty: () => !!current && ready && (dirty || unsaved), close };
  }

  window.NotesWordCraft = { create };
})();
