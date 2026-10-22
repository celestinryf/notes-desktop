/* Pure helpers shared by the main process, the renderer, and the tests.
   An ES module: main requires it, the renderer bundle imports it, the tests require it. */

const UNTITLED = 'Untitled';

type TitleSource = Partial<Pick<Note, 'title' | 'body'>> | null | undefined;
type FileSource = Partial<Pick<Note, 'filePath' | 'fileKind'>> | null | undefined;
type Sortable = Pick<Note, 'title' | 'body' | 'pinned' | 'createdAt' | 'updatedAt'>;
type PaneName = 'sidebarWidth' | 'listWidth';

function firstLine(text?: string | null) {
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.replace(/^#+\s*/, '').trim();
    if (t) return t;
  }
  return '';
}

// Cuts by code point, so an emoji at the boundary is dropped whole rather than split into a lone surrogate.
function truncate(text: string | null | undefined, max: number) {
  const s = String(text || '');
  if (s.length <= max) return s;
  const points = Array.from(s);
  if (points.length <= max) return s;
  return points.slice(0, Math.max(0, max - 1)).join('').trimEnd() + '…';
}

function deriveTitle(note: TitleSource) {
  if (!note) return UNTITLED;
  const explicit = String(note.title || '').trim();
  if (explicit) return explicit;
  const fromBody = firstLine(note.body);
  return fromBody ? truncate(fromBody, 60) : UNTITLED;
}

function snippet(note: TitleSource, max?: number) {
  max = max || 100;
  // The opening of the note is all a snippet shows: never strip a whole long note for it.
  const body = String((note && note.body) || '').slice(0, Math.max(600, max * 8));
  const title = String((note && note.title) || '').trim();
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Skip the first line when it is what the title came from.
  // (Not a code fence: skipping its opening line would leave the closing one as text.)
  const start = !title && lines.length && !/^```/.test(lines[0]) ? 1 : 0;
  // A run of list items reads as a list ("Oat milk, Lemons, Rice"), not as one run-on phrase.
  const kept = lines.slice(start);
  const isItem = (l: string) => /^([-*+]|\d+[.)])\s/.test(l);
  const listed = kept.map((l, i) => (isItem(l) && isItem(kept[i + 1] || '') && !/[.,;:!?]$/.test(l) ? l + ',' : l));
  // The same Markdown stripping as read-aloud, so "## Goals" + "Ship it" reads "Goals. Ship it", not "Goals Ship it".
  const text = plainTextFromMarkdown(listed.join('\n')).replace(/\bcode block omitted\.\s*/g, '').replace(/\s+/g, ' ').trim();
  return truncate(text, max);
}

function relativeTime(ts: number, now?: number) {
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
  const opts: Intl.DateTimeFormatOptions = sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' };
  return date.toLocaleDateString(undefined, opts);
}

function parseTags(input: unknown) {
  if (Array.isArray(input)) input = input.join(',');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(input || '').split(/[,\s]+/)) {
    const t = raw.replace(/^#+/, '').trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/;

function toggleTaskAt(body: string | null | undefined, index: number) {
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

function countWords(text?: string | null) {
  const t = String(text || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

function tokenize(query?: string) {
  return String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesQuery(note: Pick<Note, 'title' | 'body' | 'tags'>, query?: string) {
  const tokens = tokenize(query);
  if (!tokens.length) return true;
  const hay = (String(note.title || '') + '\n' + String(note.body || '') + '\n' + (note.tags || []).join(' ')).toLowerCase();
  return tokens.every((t) => hay.indexOf(t) !== -1);
}

const SORTS: Record<SortKey, (a: Sortable, b: Sortable) => number> = {
  updated: (a, b) => b.updatedAt - a.updatedAt,
  created: (a, b) => b.createdAt - a.createdAt,
  title: (a, b) => deriveTitle(a).localeCompare(deriveTitle(b), undefined, { sensitivity: 'base' }),
};

function sortNotes<T extends Sortable>(notes: T[], sort: SortKey) {
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

function isBindableKey(key: string) {
  return SINGLE_KEY_RE.test(key) || FKEY_RE.test(key) || NUMPAD_RE.test(key) || NAMED_KEYS.has(key.toLowerCase());
}

function parseAccelerator(str: string): { ok: true, value: string } | { ok: false, reason: string } {
  const parts = String(str || '').split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { ok: false, reason: 'A hotkey needs at least one modifier and a key, like Ctrl+Alt+N.' };
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!mods.every((m) => MODIFIERS.has(m.toLowerCase()))) return { ok: false, reason: 'Unknown modifier in "' + str + '".' };
  // Shift alone would make an ordinary capital letter or symbol unusable in every application.
  if (!mods.some((m) => m.toLowerCase() !== 'shift')) return { ok: false, reason: 'Use Ctrl, Alt, or Win together with the key (Shift alone would block normal typing).' };
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

function displayAccelerator(str?: string) {
  return String(str || '')
    .replace(/CommandOrControl|CmdOrCtrl/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/\+/g, ' + ');
}

function noteToMarkdown(note: Pick<Note, 'title' | 'body' | 'tags'>) {
  const title = deriveTitle(note);
  const tags = (note.tags || []).length ? '\n\nTags: ' + note.tags.map((t) => '#' + t).join(' ') : '';
  return '# ' + title + '\n\n' + String(note.body || '').replace(/\s+$/, '') + tags + '\n';
}

function markdownToNote(filename: string, content: string) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  let title = String(filename || '').replace(/\.(md|markdown|txt)$/i, '').trim();
  let body = text;
  const m = /^#\s+(.+)\n+/.exec(text);
  if (m) {
    title = m[1].trim();
    body = text.slice(m[0].length);
  }
  const tags: string[] = [];
  body = body.replace(/\n*Tags:\s*((?:#[\p{L}\p{N}_-]+\s*)+)\s*$/iu, (_, t) => {
    tags.push(...parseTags(t));
    return '';
  });
  return { title, body: body.replace(/\s+$/, ''), tags };
}

// Draggable pane widths, in CSS px. The editor always keeps at least EDITOR_MIN.
const PANE_LIMITS: Record<PaneName, { min: number, max: number, def: number }> = {
  sidebarWidth: { min: 160, max: 420, def: 232 },
  listWidth: { min: 220, max: 560, def: 300 },
};
const EDITOR_MIN = 320;

function clampPane(name: PaneName, value: number) {
  const lim = PANE_LIMITS[name];
  const v = Number(value);
  if (!lim) return value;
  if (!Number.isFinite(v)) return lim.def;
  return Math.min(lim.max, Math.max(lim.min, Math.round(v)));
}

// Plain prose from Markdown for reading aloud: drops markup, keeps the words and sentence breaks.
// "today 18:30", "tomorrow 09:00", "yesterday 09:00", "Tue, Oct 20 09:00", "Jan 2, 2027 09:00".
function formatWhen(ts: number, now?: number) {
  now = now == null ? Date.now() : now;
  const d = new Date(ts), n = new Date(now);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dayOf = (x: Date) => x.toDateString();
  const shift = (days: number) => { const c = new Date(n); c.setDate(n.getDate() + days); return dayOf(c); };
  if (dayOf(d) === dayOf(n)) return 'today ' + time;
  if (dayOf(d) === shift(1)) return 'tomorrow ' + time;
  if (dayOf(d) === shift(-1)) return 'yesterday ' + time;
  const sameYear = d.getFullYear() === n.getFullYear();
  return d.toLocaleDateString([], sameYear ? { weekday: 'short', month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + time;
}

// A mailto: URL for a note. Mail clients reject very long URLs, so the body is cut with a notice.
// limit caps the ENCODED URL (Windows shell handlers reject roughly 2 KB), never splitting a surrogate pair.
function mailtoFor(note: Pick<Note, 'title' | 'body'>, limit?: number) {
  limit = limit || 1900;
  // Subjects are bounded too, so the head can never eat the whole budget.
  const subject = truncate(deriveTitle(note) || 'Note', 120);
  const body = String(note.body || '');
  const notice = '\n\n[Truncated for email. Share the full note as a PDF or Markdown file.]';
  const head = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=';
  const full = head + encodeURIComponent(body);
  if (full.length <= limit) return { url: full, truncated: false };
  // Find the longest prefix (in code points) whose encoded form fits with the notice.
  const points = Array.from(body);
  let lo = 0, hi = points.length;
  const budget = Math.max(0, limit - head.length - encodeURIComponent(notice).length);
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (encodeURIComponent(points.slice(0, mid).join('')).length <= budget) lo = mid; else hi = mid - 1;
  }
  return { url: head + encodeURIComponent(points.slice(0, lo).join('') + notice), truncated: true };
}

function plainTextFromMarkdown(md: string) {
  let s = String(md || '').replace(/\r\n/g, '\n');
  s = s.replace(/```[\s\S]*?```/g, ' code block omitted. ');
  s = s.replace(/`([^`\n]+)`/g, '$1');
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => alt ? alt + '. ' : '');
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t]*$/gm, (_, h) => (/[.!?:;]$/.test(h) ? h : h + '.'));
  s = s.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '');
  s = s.replace(/^\s*[-*+]\s+/gm, '');
  s = s.replace(/^\s*\d+[.)]\s+/gm, '');
  s = s.replace(/^\s*>\s?/gm, '');
  s = s.replace(/^\s*([-*_])\s*(\1\s*){2,}$/gm, '');
  s = s.replace(/\|/g, ' ');
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2').replace(/(\*|_)(.*?)\1/g, '$2').replace(/~~(.*?)~~/g, '$1');
  s = s.replace(/<[^>\n]+>/g, '');
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

// Splits prose into utterance-sized chunks; Chromium can go silent on very long single utterances.
function speechChunks(text: string | null | undefined, max?: number) {
  max = max || 220;
  const out: string[] = [];
  for (const para of String(text || '').split(/\n+/)) {
    const sentences = para.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [];
    let cur = '';
    for (const sRaw of sentences) {
      const s = sRaw.trim();
      if (!s) continue;
      if (s.length > max) {
        // One over-long sentence: flush what we have, then slice it on its own.
        if (cur) { out.push(cur); cur = ''; }
        for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
        continue;
      }
      if ((cur + ' ' + s).trim().length > max && cur) { out.push(cur); cur = s; }
      else cur = (cur + ' ' + s).trim();
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

// Ids of the notes a body links to with note://<id> links, in order, without repeats.
function noteLinkIds(body: string) {
  const out: string[] = [];
  const re = /note:\/\/([0-9a-f][0-9a-f-]{7,})/gi;
  let m;
  while ((m = re.exec(String(body || ''))) !== null) { const id = m[1].toLowerCase(); if (!out.includes(id)) out.push(id); }
  return out;
}

function safeFilename(name: string) {
  // Cut by code point: a UTF-16 slice through an emoji would leave a lone surrogate, which the file system
  // turns into U+FFFD, so the stored name and the name on disk would never match again.
  let s = Array.from(String(name || UNTITLED).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 80).join('').replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) s = 'note-' + s; // Windows device names
  return s || UNTITLED;
}

// An opened file the app shows but does not edit as text: PDF, Word, anything binary.
function isViewerOnlyFile(note: FileSource) {
  return !!(note && note.filePath && note.fileKind !== 'text');
}

// A file's extension in lower case, or its whole name when it has none (Makefile, Dockerfile).
function extOf(filePath: string | null | undefined) {
  const base = (String(filePath || '').split(/[\\/]/).pop() || '').toLowerCase();
  if (!base.includes('.')) return base;
  return base.slice(base.lastIndexOf('.') + 1);
}

// An opened text file that is not Markdown (.txt, code, config) is edited as the plain text it is, never rendered.
function isPlainTextFile(note: FileSource) {
  return !!(note && note.filePath && note.fileKind === 'text' && !/\.(md|markdown|mdx)$/i.test(note.filePath));
}

// An opened file whose text is not Markdown: plain text, Word, PDF, a sheet, a picture.
function isNonMarkdownFile(note: FileSource) {
  return isPlainTextFile(note) || isViewerOnlyFile(note);
}

// Word documents (fileKind 'docx'): everything WordCraft opens. Word's own zip formats are saved where they are; the
// others (RTF, ODT, the old binary .doc) WordCraft saves as a .docx beside them, and the note moves to it.
const WORD_EXT = new Set(['docx', 'docm', 'dotx', 'dotm', 'doc', 'dot', 'rtf', 'odt']);
const OOXML_EXT = new Set(['docx', 'docm', 'dotx', 'dotm']); // Word's zip formats: the simple editor and mammoth read these
const WORD_TO_DOCX_EXT = new Set(['doc', 'dot', 'rtf', 'odt']);
// Images (fileKind 'image'), shown by the image viewer.
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']);
const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif' };
// Spreadsheets (fileKind 'sheet') open in GridCraft, the user's fork of ArtCraft's Rust spreadsheet, as Word
// documents open in WordCraft. An .xlsx is saved where it is; the others GridCraft saves as an .xlsx beside them (as
// WordCraft does with .odt), and the note moves to it. (.csv and .tsv stay text files: Notes shows them as a table
// itself. Presentations are out of Notes' scope, the user's call on 2026-10-19.)
const SHEET_EXT = new Set(['xlsx', 'xlsm', 'xls', 'xlsb', 'ods']);
// (.xlsm too: a macro workbook saved as .xlsx beside the original keeps the original's macros where they are.)
const SHEET_TO_XLSX_EXT = new Set(['xlsm', 'xls', 'xlsb', 'ods']);
// The Craft app that shows each kind of file.
const CRAFT_OF: Partial<Record<FileKind, 'wordcraft' | 'gridcraft'>> = { docx: 'wordcraft', sheet: 'gridcraft' };
// Documents that are zips (the Office and OpenDocument formats, e-books, zips themselves): the zip guard runs on them
// before anything unpacks them, and a save under such a name must be a zip.
const ZIP_DOC_EXT = new Set([...OOXML_EXT, 'odt', 'xlsx', 'xlsm', 'xlsb', 'ods', 'epub', 'zip']);

// A comma- or tab-separated file: shown as a table, edited as text (Ctrl+E).
function isTableFile(note: FileSource) {
  return !!note && isPlainTextFile(note) && ['csv', 'tsv'].includes(extOf(note.filePath));
}

// A Word file the simple editor can show (Word's zip formats); the rest need WordCraft.
function isOoxmlWordFile(note: FileSource) {
  return !!(note && note.filePath && note.fileKind === 'docx' && OOXML_EXT.has(extOf(note.filePath)));
}

// The text a reader sees in an ATX heading, for use as a title. Unlike plainTextFromMarkdown (made for speech)
// it keeps list-like prefixes ("1. Setup"), underscores inside words (my_file.py) and backslash-escaped
// characters, and drops only the formatting.
function headingTitle(md: string) {
  const escaped: string[] = [];
  let s = String(md || '').replace(/\\([!-/:-@[-`{-~])/g, (_, c) => { escaped.push(c); return '\u0000' + (escaped.length - 1) + '\u0001'; });
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/<[^>\n]+>/g, '');
  s = s.replace(/(\*\*|~~)(\S(?:.*?\S)?)\1/g, '$2').replace(/\*(\S(?:.*?\S)?)\*/g, '$1');
  // Underscores mark emphasis only at the edges of words; inside a word they are text.
  s = s.replace(/(^|\W)(__?)(\S(?:.*?\S)?)\2(?!\w)/g, '$1$3');
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  s = s.replace(/\u0000(\d+)\u0001/g, (_, i) => escaped[Number(i)]);
  return s.replace(/\s+/g, ' ').trim();
}

// Plans splitting a note into book pages at its headings. Returns { name, level, pages: [{ title, body }] };
// fewer than two pages means the note cannot be split. Page titles come from headingTitle. Rules:
// - Headings inside fenced code blocks do not count.
// - The pages start at the highest heading level used. If that level appears once, as the note's first line,
//   it is the book's title and the pages start at the next level down.
// - Text before the first page heading becomes an "Introduction" page; deeper headings stay inside their page.
function splitAtHeadings(markdown: string, fallbackName: string) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const heads: { i: number, level: number, text: string }[] = [];
  let fence: { ch: string, len: number } | null = null;
  lines.forEach((line, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (f) {
      const ch = f[1][0], len = f[1].length;
      if (!fence) { fence = { ch, len }; return; }
      if (ch === fence.ch && len >= fence.len && !f[2].trim()) { fence = null; return; }
    }
    if (fence) return;
    const h = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (!h) return;
    const text = headingTitle(String(h[2] || '').replace(/[ \t]+#+$/, '').replace(/^#+$/, ''));
    heads.push({ i, level: h[1].length, text });
  });
  let name = String(fallbackName || '').trim();
  let usable = heads;
  if (heads.length) {
    const top = Math.min(...heads.map((h) => h.level));
    const atTop = heads.filter((h) => h.level === top);
    const firstText = lines.findIndex((l) => l.trim());
    if (atTop.length === 1 && atTop[0].i === firstText) {
      if (atTop[0].text) name = atTop[0].text;
      usable = heads.filter((h) => h !== atTop[0]);
    }
  }
  const titleHead = usable === heads ? null : heads.find((h) => !usable.includes(h));
  const titleLine = titleHead ? titleHead.i : -1;
  if (!usable.length) return { name: name || 'Book', level: 0, pages: [] };
  const level = Math.min(...usable.map((h) => h.level));
  const cuts = usable.filter((h) => h.level === level);
  const trimBlank = (arr: string[]) => { let a = 0, b = arr.length; while (a < b && !arr[a].trim()) a++; while (b > a && !arr[b - 1].trim()) b--; return arr.slice(a, b).join('\n'); };
  const pages: { title: string, body: string }[] = [];
  const intro = trimBlank(lines.slice(0, cuts[0].i).filter((_, i) => i !== titleLine));
  if (intro) pages.push({ title: 'Introduction', body: intro });
  cuts.forEach((c, k) => {
    const end = k + 1 < cuts.length ? cuts[k + 1].i : lines.length;
    pages.push({ title: c.text || 'Untitled', body: trimBlank(lines.slice(c.i + 1, end)) });
  });
  return { name: name || 'Book', level, pages };
}

// The file:/// URL of the folder an opened file is in (ending in "/", every segment encoded), which its relative
// pictures are read from. null for a note with no file, or a file on a network share (never loaded, see the editor).
function imageBaseFor(note: FileSource) {
  const p = note && note.filePath ? String(note.filePath).replace(/\\/g, '/') : '';
  if (!p || p.startsWith('//')) return null;
  const parts = p.split('/');
  parts.pop();
  return 'file:///' + parts.map((s, i) => (i === 0 && /^[a-z]:$/i.test(s) ? s : encodeURIComponent(s))).join('/').replace(/^\/+/, '') + '/';
}

// A timestamp that is safe in a file name and sorts by time: 2026-10-16T21-04-05-123Z.
function fileStamp(date?: number) {
  return new Date(date === undefined ? Date.now() : date).toISOString().replace(/[:.]/g, '-');
}

// How well a typed query matches a label, for the command palette: 0 is no match, higher is better.
// An exact prefix beats everything, then the query whole at a word start ("trash" in "Move to trash"), then the
// query spread over the label, where each character must continue the previous match or start a word: "nn" and
// "new n" find "New note", "sv" finds "Split view", but "plan" does not find "Open a file as a note".
function fuzzyScore(query: string | null | undefined, text: string | null | undefined) {
  const q = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const t = String(text || '').toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 1000 - t.length;
  const wordStart = (i: number) => i === 0 || /[\s\-_/.(#:"'“]/.test(t[i - 1]);
  for (let at = t.indexOf(q); at > 0; at = t.indexOf(q, at + 1)) {
    if (wordStart(at)) return 700 - at - t.length / 10;
  }
  let score = 0, ti = 0, run = 0;
  for (const ch of q) {
    if (ch === ' ') { run = 0; continue; }
    let found = -1;
    for (let i = t.indexOf(ch, ti); i >= 0; i = t.indexOf(ch, i + 1)) {
      if ((i === ti && ti > 0 && run > 0) || wordStart(i)) { found = i; break; }
    }
    if (found < 0) return 0;
    run = found === ti && run > 0 ? run + 1 : 1;
    score += 10 + (wordStart(found) ? 25 : 0) + run * 8;
    ti = found + 1;
  }
  return Math.max(1, score - t.length / 20);
}

const isObjectLike = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const isRecord = (v: unknown): v is Record<string, unknown> => isObjectLike(v) && !Array.isArray(v);

export {
  isObjectLike, isRecord,
  fuzzyScore,
  splitAtHeadings, headingTitle, extOf, isViewerOnlyFile, isPlainTextFile, isNonMarkdownFile, isTableFile, isOoxmlWordFile, imageBaseFor, fileStamp,
  WORD_EXT, OOXML_EXT, WORD_TO_DOCX_EXT, IMAGE_EXT, IMAGE_MIME, SHEET_EXT, SHEET_TO_XLSX_EXT, CRAFT_OF, ZIP_DOC_EXT,
  UNTITLED, deriveTitle, firstLine, truncate, snippet, relativeTime, parseTags, toggleTaskAt,
  countWords, tokenize, matchesQuery, sortNotes, parseAccelerator, displayAccelerator,
  noteToMarkdown, markdownToNote, safeFilename, PANE_LIMITS, EDITOR_MIN, clampPane,
  plainTextFromMarkdown, speechChunks, formatWhen, mailtoFor, noteLinkIds,
};
