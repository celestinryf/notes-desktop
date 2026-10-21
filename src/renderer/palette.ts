'use strict';
/* The command palette (Ctrl+P): one box that finds notes and runs every command the app has.
   It knows nothing about notes or commands itself: app.js hands it a source of items each time it opens.

   NotesPalette.create({ dialog, input, list, source }) returns { open(query), close(), isOpen() }.
   source(query) returns (or resolves to) items: { id, title, group, hint, keys, icon, run(opts) }.
   The list keeps the order source gives; run gets { newTab } (Ctrl+Enter or Ctrl+click). */
import * as H from '../shared/helpers.ts';
import NotesIcons from './icons.js';
import { escapeHtml } from './text.ts';

type PaletteItem = { id: string, title: string, group: string, hint?: string, keys?: string, icon?: string, run: (opts: { newTab?: boolean }) => void };

export const NotesPalette = (function () {
  const I = (name) => (name ? NotesIcons.svg(name) : '');
  const esc = (s) => escapeHtml(s == null ? '' : s);

  // Bold the characters of the label that the query matched, in order.
  function marked(text, query) {
    const q = String(query || '').toLowerCase().replace(/\s+/g, '');
    if (!q) return esc(text);
    const lower = text.toLowerCase();
    const whole = lower.indexOf(String(query).toLowerCase().trim());
    if (whole >= 0) { const n = String(query).trim().length; return esc(text.slice(0, whole)) + '<mark>' + esc(text.slice(whole, whole + n)) + '</mark>' + esc(text.slice(whole + n)); }
    let out = '', qi = 0;
    for (let i = 0; i < text.length; i++) {
      if (qi < q.length && lower[i] === q[qi]) { out += '<mark>' + esc(text[i]) + '</mark>'; qi++; } else out += esc(text[i]);
    }
    return out;
  }

  function create({ dialog, input, list, source }) {
    let items: PaletteItem[] = [];
    let active = 0;
    let ticket = 0;
    let returnFocus: HTMLElement | null = null;

    function render(query) {
      list.innerHTML = '';
      if (!items.length) {
        const li = document.createElement('li');
        li.className = 'palette-empty';
        li.textContent = query ? 'Nothing matches "' + query + '".' : 'Type to find a note or a command.';
        list.append(li);
        input.removeAttribute('aria-activedescendant');
        return;
      }
      let group: string | null = null;
      items.forEach((it, i) => {
        if (it.group !== group) {
          group = it.group;
          const h = document.createElement('li');
          h.className = 'palette-group';
          h.setAttribute('role', 'presentation');
          h.textContent = group;
          list.append(h);
        }
        const li = document.createElement('li');
        li.className = 'palette-item' + (i === active ? ' is-active' : '');
        li.id = 'palette-opt-' + i;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === active));
        li.innerHTML = I(it.icon || 'command') + '<span class="palette-title">' + marked(it.title, query.replace(/^>\s*/, '')) + '</span>'
          + (it.hint ? '<span class="palette-hint">' + esc(it.hint) + '</span>' : '')
          + (it.keys ? '<span class="keys">' + esc(it.keys) + '</span>' : '');
        li.addEventListener('mousemove', () => { if (active !== i) { active = i; paint(); } });
        li.addEventListener('click', (e) => choose(i, { newTab: e.ctrlKey || e.metaKey }));
        list.append(li);
      });
      paint();
    }

    function paint() {
      list.querySelectorAll('.palette-item').forEach((li, i) => {
        const on = i === active;
        li.classList.toggle('is-active', on);
        li.setAttribute('aria-selected', String(on));
        if (on) { li.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', li.id); }
      });
    }

    async function update() {
      const query = input.value;
      const mine = ++ticket;
      let got: PaletteItem[];
      try { got = await source(query); } catch (err) { got = []; console.error('palette: ' + (err && err.message || err)); }
      if (mine !== ticket) return; // a newer keystroke won
      // Keep each group together, in the order the groups first appear, so no heading shows twice.
      const order: string[] = [];
      for (const it of got || []) if (!order.includes(it.group)) order.push(it.group);
      items = order.flatMap((g) => (got || []).filter((it) => it.group === g));
      active = 0;
      render(query);
    }

    function move(delta) {
      if (!items.length) return;
      active = (active + delta + items.length) % items.length;
      paint();
    }

    function choose(i, opts) {
      const it = items[i];
      if (!it) return;
      close(false);
      // After the dialog has closed, so a command that opens its own dialog or moves focus keeps it.
      setTimeout(() => it.run(opts || {}), 0);
    }

    function open(query) {
      if (dialog.open) { input.select(); return; }
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      input.value = query || '';
      items = [];
      list.innerHTML = '';
      dialog.showModal();
      input.focus();
      input.select();
      update();
    }

    function close(restore?) {
      if (!dialog.open) return;
      dialog.close();
      if (restore !== false && returnFocus && returnFocus.isConnected) returnFocus.focus();
      returnFocus = null;
    }

    input.addEventListener('input', update);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // the app's own shortcuts must not fire while typing here
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'PageDown') { e.preventDefault(); move(Math.min(8, items.length - 1 - active) || 0); }
      else if (e.key === 'PageUp') { e.preventDefault(); move(-Math.min(8, active)); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(active, { newTab: e.ctrlKey || e.metaKey }); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') e.preventDefault(); // one field: Tab must not leave the dialog
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); close(); }
    });
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    // A click on the backdrop (the dialog element itself, outside its box) closes it.
    dialog.addEventListener('mousedown', (e) => { if (e.target === dialog) close(); });

    return { open, close, isOpen: () => dialog.open };
  }

  // Ranks commands and notes for a query: commands by label (and keywords), notes by title, then by body text.
  function rank(query, commands, notes) {
    const raw = String(query || '');
    const commandsOnly = /^\s*>/.test(raw);
    const q = raw.replace(/^\s*>\s*/, '').trim();
    const scored = (arr, text) => arr.map((x) => ({ x, s: H.fuzzyScore(q, text(x)) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s).map((r) => r.x);
    const cmds = scored(commands, (c) => c.title + (c.keywords ? ' ' + c.keywords : ''));
    if (commandsOnly || !notes) return cmds;
    if (!q) return notes.slice(0, 6).concat(cmds);
    const byTitle = scored(notes, (n) => n.title);
    const seen = new Set(byTitle.map((n) => n.id));
    const byBody = notes.filter((n) => !seen.has(n.id) && n.matches(q)).slice(0, 6);
    const noteHits = byTitle.slice(0, 8).concat(byBody);
    // A strong command match (prefix or word start) goes first; otherwise notes lead, since finding notes is the main job.
    const strong = cmds.length && H.fuzzyScore(q, cmds[0].title) >= 500;
    return strong ? cmds.slice(0, 10).concat(noteHits) : noteHits.concat(cmds.slice(0, 8));
  }

  return { create, rank };
})();
