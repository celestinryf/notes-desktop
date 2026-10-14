/* Pure helpers shared by the main process, the renderer, and the tests.
   UMD-style so the same file loads with require() and with a <script> tag. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NotesHelpers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const UNTITLED = 'Untitled';

  function firstLine(text) {
    const lines = String(text || '').split(/\r?\n/);
    for (const line of lines) {
      const t = line.replace(/^#+\s*/, '').trim();
      if (t) return t;
    }
    return '';
  }

  function truncate(text, max) {
    const s = String(text || '');
    if (s.length <= max) return s;
    return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
  }

  function deriveTitle(note) {
    if (!note) return UNTITLED;
    const explicit = String(note.title || '').trim();
    if (explicit) return explicit;
    const fromBody = firstLine(note.body);
    return fromBody ? truncate(fromBody, 60) : UNTITLED;
  }

  function snippet(note, max) {
    max = max || 100;
    const body = String((note && note.body) || '');
    const title = String((note && note.title) || '').trim();
    const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    // Skip the first line when it is what the title came from.
    const start = !title && lines.length ? 1 : 0;
    const text = lines.slice(start).join(' ').replace(/[#*_`>\-\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
    return truncate(text, max);
  }

  function relativeTime(ts, now) {
    now = now == null ? Date.now() : now;
    const diff = Math.max(0, now - ts);
    const s = Math.floor(diff / 1000);
    if (s < 45) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = Math.floor(h / 24);
    if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
    const date = new Date(ts);
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    const opts = sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString(undefined, opts);
  }

  function parseTags(input) {
    if (Array.isArray(input)) input = input.join(',');
    const seen = new Set();
    const out = [];
    for (const raw of String(input || '').split(/[,\s]+/)) {
      const t = raw.replace(/^#+/, '').trim().toLowerCase();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/;

  function toggleTaskAt(body, index) {
    const lines = String(body || '').split('\n');
    let seen = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = TASK_RE.exec(lines[i]);
      if (!m) continue;
      if (seen === index) {
        const checked = m[2].toLowerCase() === 'x';
        lines[i] = lines[i].replace(TASK_RE, m[1] + (checked ? '[ ]' : '[x]'));
        return lines.join('\n');
      }
      seen++;
    }
    return String(body || '');
  }

  function countWords(text) {
    const t = String(text || '').trim();
    if (!t) return 0;
    return t.split(/\s+/).length;
  }

  function tokenize(query) {
    return String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  }

  function matchesQuery(note, query) {
    const tokens = tokenize(query);
    if (!tokens.length) return true;
    const hay = (String(note.title || '') + '\n' + String(note.body || '') + '\n' + (note.tags || []).join(' ')).toLowerCase();
    return tokens.every((t) => hay.indexOf(t) !== -1);
  }

  const SORTS = {
    updated: (a, b) => b.updatedAt - a.updatedAt,
    created: (a, b) => b.createdAt - a.createdAt,
    title: (a, b) => deriveTitle(a).localeCompare(deriveTitle(b), undefined, { sensitivity: 'base' }),
  };

  function sortNotes(notes, sort) {
    const cmp = SORTS[sort] || SORTS.updated;
    return notes.slice().sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return cmp(a, b) || (b.updatedAt - a.updatedAt);
    });
  }

  const MODIFIERS = new Set(['commandorcontrol', 'cmdorctrl', 'control', 'ctrl', 'alt', 'option', 'shift', 'super', 'meta', 'command', 'cmd', 'altgr']);
  const NAMED_KEYS = new Set(['space', 'tab', 'backspace', 'delete', 'insert', 'return', 'enter', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'escape', 'esc', 'plus', 'numadd', 'numsub', 'nummult', 'numdiv', 'numdec']);
  const SINGLE_KEY_RE = /^[a-z0-9`~!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|]$/i;
  const FKEY_RE = /^f([1-9]|1[0-9]|2[0-4])$/i;
  const NUMPAD_RE = /^num[0-9]$/i;

  function isBindableKey(key) {
    return SINGLE_KEY_RE.test(key) || FKEY_RE.test(key) || NUMPAD_RE.test(key) || NAMED_KEYS.has(key.toLowerCase());
  }

  function parseAccelerator(str) {
    const parts = String(str || '').split('+').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return { ok: false, reason: 'A hotkey needs at least one modifier and a key, like Ctrl+Alt+N.' };
    const key = parts[parts.length - 1];
    const mods = parts.slice(0, -1);
    if (!mods.every((m) => MODIFIERS.has(m.toLowerCase()))) return { ok: false, reason: 'Unknown modifier in "' + str + '".' };
    if (!isBindableKey(key)) return { ok: false, reason: '"' + key + '" is not a key that can be bound.' };
    const normMods = mods.map((m) => {
      const l = m.toLowerCase();
      if (l === 'ctrl' || l === 'control') return 'Control';
      if (l === 'cmdorctrl' || l === 'commandorcontrol') return 'CommandOrControl';
      return m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
    });
    const normKey = key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
    return { ok: true, value: normMods.join('+') + '+' + normKey };
  }

  function displayAccelerator(str) {
    return String(str || '')
      .replace(/CommandOrControl|CmdOrCtrl/gi, 'Ctrl')
      .replace(/Control/gi, 'Ctrl')
      .replace(/\+/g, ' + ');
  }

  function noteToMarkdown(note) {
    const title = deriveTitle(note);
    const tags = (note.tags || []).length ? '\n\nTags: ' + note.tags.map((t) => '#' + t).join(' ') : '';
    return '# ' + title + '\n\n' + String(note.body || '').replace(/\s+$/, '') + tags + '\n';
  }

  function markdownToNote(filename, content) {
    const text = String(content || '').replace(/\r\n/g, '\n');
    let title = String(filename || '').replace(/\.(md|markdown|txt)$/i, '').trim();
    let body = text;
    const m = /^#\s+(.+)\n+/.exec(text);
    if (m) {
      title = m[1].trim();
      body = text.slice(m[0].length);
    }
    const tags = [];
    body = body.replace(/\n*Tags:\s*((?:#[\w-]+\s*)+)\s*$/i, (_, t) => {
      tags.push(...parseTags(t));
      return '';
    });
    return { title, body: body.replace(/\s+$/, ''), tags };
  }

  function safeFilename(name) {
    const s = String(name || UNTITLED).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
    return (s || UNTITLED).slice(0, 80);
  }

  return {
    UNTITLED, deriveTitle, firstLine, truncate, snippet, relativeTime, parseTags, toggleTaskAt,
    countWords, tokenize, matchesQuery, sortNotes, parseAccelerator, displayAccelerator,
    noteToMarkdown, markdownToNote, safeFilename,
  };
});
