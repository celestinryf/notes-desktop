/* The comments panel beside an open PDF, exposed as window.NotesPdfComments. It lists the PDF's sticky notes, and
   other marks that carry a comment, and adds, retypes and deletes sticky notes. Those are standard PDF "Text"
   annotations, which main writes into the file, so other PDF apps show them as comments too. */
export const NotesPdfComments = (function () {
  'use strict';
  const KIND_NAMES = { Text: 'Note', Highlight: 'Highlight', Underline: 'Underline', Squiggly: 'Squiggly underline', StrikeOut: 'Strikethrough',
    Ink: 'Drawing', Stamp: 'Stamp', Square: 'Rectangle', Circle: 'Oval', Line: 'Line', Polygon: 'Shape', PolyLine: 'Lines',
    Caret: 'Insertion', FileAttachment: 'Attachment', Sound: 'Sound' };
  const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  // panel: the .pdf-comments element. ctl: the NotesPdfEditor controller. hooks:
  //   change(ops) -> Promise<bool>   writes the change (ops as main's files:pdfComments takes them) and reloads the PDF
  //   say(text)
  function create(panel, ctl, hooks) {
    const listEl = panel.querySelector('.pdf-comments-list');
    const addBtn = panel.querySelector('[data-comments-act="add"]');
    const hint = panel.querySelector('.pdf-comments-hint');
    // list: the comments as last read. editing: the id being retyped, or 'new' for draft (a place { page, x, y }).
    let list = [], editing = null, draft = null, picking = false, working = false, readSeq = 0;

    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    }
    function button(act, text, title) {
      const b = el('button', 'tool-btn', text);
      b.type = 'button';
      b.dataset.cAct = act;
      if (title) b.title = title;
      return b;
    }

    // A text box for a new or retyped comment, with Save and Cancel. Ctrl+Enter saves; Escape cancels.
    function editorCard(value, label) {
      const card = el('div', 'pdf-comment is-editing');
      card.append(el('div', 'pdf-comment-meta', label));
      const box = el('textarea', 'pdf-comment-input');
      box.value = value;
      box.rows = 4;
      box.setAttribute('aria-label', 'Comment');
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); save(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
      });
      const acts = el('div', 'pdf-comment-acts');
      acts.append(button('cancel', 'Cancel'), button('save', 'Save', 'Save (Ctrl+Enter)'));
      card.append(box, acts);
      return card;
    }

    function commentCard(c, reply) {
      if (editing === c.id) return editorCard(c.text, 'Page ' + (c.page + 1));
      const card = el('div', 'pdf-comment' + (reply ? ' is-reply' : ''));
      card.dataset.id = c.id;
      const meta = [reply ? 'Reply' : 'Page ' + (c.page + 1)];
      if (c.kind !== 'Text') meta.push(KIND_NAMES[c.kind] || c.kind);
      if (c.author) meta.push(c.author);
      if (c.date) meta.push(DATE_FORMAT.format(c.date));
      card.append(el('div', 'pdf-comment-meta', meta.join(' · ')));
      card.append(el('div', 'pdf-comment-text', c.text || '(no text)'));
      const acts = el('div', 'pdf-comment-acts');
      if (c.ref) {
        acts.append(button('edit', 'Edit'));
        if (c.kind === 'Text') acts.append(button('delete', 'Delete'));
      } else acts.title = 'This comment is stored in a way Notes cannot change.';
      card.append(acts);
      return card;
    }

    function render() {
      addBtn.textContent = picking ? 'Cancel' : 'Add comment';
      addBtn.dataset.commentsAct = picking ? 'cancel-pick' : 'add';
      hint.textContent = picking ? 'Click on the page where the comment goes. Esc cancels.' : '';
      addBtn.disabled = working || (!picking && !!editing);
      const cards = [];
      if (editing === 'new') cards.push(editorCard('', 'New comment · page ' + (draft.page + 1)));
      const replies = new Map();
      for (const c of list) if (c.replyTo) { if (!replies.has(c.replyTo)) replies.set(c.replyTo, []); replies.get(c.replyTo).push(c); }
      const ids = new Set(list.map((c) => c.id));
      const shown = new Set();
      const withReplies = (c, reply) => {
        if (shown.has(c.id)) return; // a reply loop in a damaged PDF
        shown.add(c.id);
        cards.push(commentCard(c, reply));
        for (const r of replies.get(c.id) || []) withReplies(r, true);
      };
      for (const c of list) if (!(c.replyTo && ids.has(c.replyTo))) withReplies(c, false); // replies go under theirs
      if (!cards.length) cards.push(el('p', 'pdf-comments-empty', 'No comments yet. Press Add comment, then click where it goes on the page.'));
      listEl.replaceChildren(...cards);
      const box = listEl.querySelector('.pdf-comment-input');
      if (box) box.focus();
    }

    // Reads the comments from the PDF on show. Drops a comment being written for another PDF (or version of it).
    async function refresh() {
      const my = ++readSeq;
      editing = null;
      draft = null;
      listEl.replaceChildren(el('p', 'pdf-comments-empty', 'Reading comments…'));
      let read;
      try { read = await ctl.comments(); } catch (err) { read = null; if (my === readSeq) hooks.say('Could not read the comments: ' + (err.message || err)); }
      if (my !== readSeq || read === null) return;
      list = read;
      render();
    }

    async function startAdd() {
      picking = true;
      render();
      const at = await ctl.pickPoint();
      picking = false;
      if (at) { draft = at; editing = 'new'; }
      render();
    }

    function cancelEdit() {
      editing = null;
      draft = null;
      render();
    }

    async function run(ops) {
      working = true;
      panel.classList.add('is-working');
      try { return await hooks.change(ops); } finally {
        working = false;
        panel.classList.remove('is-working');
      }
    }

    async function save() {
      if (working) return;
      const box = listEl.querySelector('.pdf-comment-input');
      const text = box ? box.value.trim() : '';
      if (!text) { hooks.say('Write the comment first, or press Cancel.'); return; }
      let op;
      if (editing === 'new') op = { op: 'add', page: draft.page, x: draft.x, y: draft.y, text };
      else {
        const c = list.find((x) => x.id === editing);
        if (!c) { cancelEdit(); return; }
        if (text === c.text.trim()) { cancelEdit(); return; }
        op = { op: 'edit', page: c.page, ref: c.ref, text };
      }
      // On success the PDF is reloaded, and refresh() then shows the list from the file.
      await run([op]);
    }

    // The replies to c, and to those, as main deletes them with it.
    function repliesTo(c) {
      const found = new Set([c.id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const x of list) if (x.page === c.page && x.replyTo && found.has(x.replyTo) && !found.has(x.id)) { found.add(x.id); grew = true; }
      }
      return found.size - 1;
    }

    async function remove(c) {
      const answers = repliesTo(c);
      if (!window.confirm('Delete this comment' + (answers ? ' and its ' + answers + (answers === 1 ? ' reply' : ' replies') : '') + '?')) return;
      await run([{ op: 'delete', page: c.page, ref: c.ref }]);
    }

    listEl.addEventListener('click', (e) => {
      if (working) return;
      const b = e.target.closest('button[data-c-act]');
      const card = e.target.closest('.pdf-comment');
      const c = card && card.dataset.id ? list.find((x) => x.id === card.dataset.id) : null;
      if (!b) { if (c) ctl.goTo(c.page, c.rect); return; }
      const act = b.dataset.cAct;
      if (act === 'save') save();
      else if (act === 'cancel') cancelEdit();
      else if (act === 'edit' && c && !editing) { editing = c.id; render(); }
      else if (act === 'delete' && c && !editing) remove(c);
    });
    addBtn.addEventListener('click', () => {
      if (working) return;
      if (addBtn.dataset.commentsAct === 'cancel-pick') ctl.cancelPick();
      else if (!editing) startAdd();
    });

    return {
      refresh,
      // Stops picking a place (the panel is closing, or another PDF is shown).
      stop() { ctl.cancelPick(); editing = null; draft = null; },
      // A comment is being written: the PDF must not be reloaded under it.
      busy: () => !!editing || working,
    };
  }

  return { create };
})();
