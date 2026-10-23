const UNTITLED = 'Untitled';

type TitleSource = Partial<Pick<Note, 'title' | 'body'>> | null | undefined;
type FileSource = Partial<Pick<Note, 'filePath' | 'fileKind'>> | null | undefined;
type Sortable = Partial<Pick<Note, 'title' | 'body'>> & Pick<Note, 'pinned' | 'createdAt' | 'updatedAt'>;
type PaneName = 'sidebarWidth' | 'listWidth';

function firstLine(text?: string | null) {
  const s = String(text || '');
  for (let start = 0; start <= s.length;) {
    const nl = s.indexOf('\n', start);
    const end = nl === -1 ? s.length : nl;
    const t = s.slice(start, end).replace(/^#+\s*/, '').trim();
    if (t) return t;
    start = end + 1;
  }
  return '';
}

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
  const body = String((note && note.body) || '').slice(0, Math.max(600, max * 8));
  const title = String((note && note.title) || '').trim();
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const start = !title && lines.length && !/^```/.test(lines[0]) ? 1 : 0;
  const kept = lines.slice(start);
  const isItem = (l: string) => /^([-*+]|\d+[.)])\s/.test(l);
  const listed = kept.map((l, i) => (isItem(l) && isItem(kept[i + 1] || '') && !/[.,;:!?]$/.test(l) ? l + ',' : l));
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

function searchHay(note: Pick<Note, 'title' | 'body' | 'tags'>) {
  return (String(note.title || '') + '\n' + String(note.body || '') + '\n' + (note.tags || []).join(' ')).toLowerCase();
}

function matchesQuery(note: Pick<Note, 'title' | 'body' | 'tags'>, query?: string) {
  const tokens = tokenize(query);
  if (!tokens.length) return true;
  const hay = searchHay(note);
  return tokens.every((t) => hay.indexOf(t) !== -1);
}

type Keyed<T> = { n: T; title: string };
const titleOrder = new Intl.Collator(undefined, { sensitivity: 'base' });
const SORTS: Record<SortKey, (a: Keyed<Sortable>, b: Keyed<Sortable>) => number> = {
  updated: (a, b) => b.n.updatedAt - a.n.updatedAt,
  created: (a, b) => b.n.createdAt - a.n.createdAt,
  title: (a, b) => titleOrder.compare(a.title, b.title),
};

function sortNotes<T extends Sortable>(notes: T[], sort: SortKey) {
  const cmp = SORTS[sort] || SORTS.updated;
  const byTitle = cmp === SORTS.title;
  return notes.map((n): Keyed<T> => ({ n, title: byTitle ? deriveTitle(n) : '' })).sort((a, b) => {
    if (!!a.n.pinned !== !!b.n.pinned) return a.n.pinned ? -1 : 1;
    return cmp(a, b) || (b.n.updatedAt - a.n.updatedAt);
  }).map((k) => k.n);
}

type RowView = Pick<PublicNote, 'id' | 'title' | 'body' | 'folderId' | 'pinned' | 'sticky' | 'fileKind' | 'filePath' | 'remindAt' | 'live' | 'createdAt' | 'updatedAt'> & Partial<Pick<PublicNote, 'locked' | 'unlocked'>>;

function outlineRow(p: RowView): OutlineRow {
  return { id: p.id, title: deriveTitle(p), folderId: p.folderId || null, pinned: !!p.pinned, locked: !!p.locked, unlocked: !!p.unlocked, sticky: !!p.sticky,
    fileKind: p.fileKind || null, filePath: p.filePath || null, remindAt: p.remindAt || null, live: p.live || null, createdAt: p.createdAt, updatedAt: p.updatedAt };
}

function listRow(p: RowView & Pick<PublicNote, 'tags' | 'trashedAt'>, query?: string): ListRow {
  const row: ListRow = Object.assign(outlineRow(p), { tags: p.tags.slice(), trashedAt: p.trashedAt || null });
  if (query) row.excerpt = matchExcerpt(p, query);
  return row;
}

const EXCERPT_BEFORE = 30;
const EXCERPT_LENGTH = 80;
const collapseSpace = (s: string) => s.replace(/\s+/g, ' ');

function firstMatch(low: string, words: string[]) {
  let first = -1;
  for (const w of words) { const i = low.indexOf(w); if (i !== -1 && (first === -1 || i < first)) first = i; }
  return first;
}

function clipAround(text: string, at: number, longer: boolean) {
  const start = Math.max(0, at - EXCERPT_BEFORE);
  let out = text.slice(start, start + EXCERPT_LENGTH);
  if (start > 0) out = '…' + out.replace(/^\S*\s/, '');
  if (longer) out = out.replace(/\s\S*$/, '') + '…';
  return out;
}

function matchExcerpt(note: TitleSource & { tags?: string[] }, query: string) {
  const raw = String((note && note.body) || '');
  const words = tokenize(query);
  const noMatch = () => ((note && note.tags) || []).filter((t) => words.some((w) => t.toLowerCase().includes(w))).map((t) => '#' + t).join(' ') || snippet(note, EXCERPT_LENGTH);
  const rawLow = raw.toLowerCase();
  if (rawLow.length !== raw.length) {
    const body = collapseSpace(raw);
    const at = firstMatch(body.toLowerCase(), words);
    return at === -1 ? noMatch() : clipAround(body, at, Math.max(0, at - EXCERPT_BEFORE) + EXCERPT_LENGTH < body.length);
  }
  const first = firstMatch(rawLow, words);
  if (first === -1) return noMatch();
  const head = collapseSpace(raw.slice(0, first));
  const end = Math.max(0, head.length - EXCERPT_BEFORE) + EXCERPT_LENGTH;
  let tail = '';
  for (let grow = 2 * EXCERPT_LENGTH; ; grow *= 2) {
    const stop = Math.min(raw.length, first + grow);
    tail = collapseSpace(raw.slice(first, stop));
    if (head.length + tail.length > end || stop === raw.length) break;
  }
  return clipAround(head + tail, head.length, head.length + tail.length > end);
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

function mailtoFor(note: Pick<Note, 'title' | 'body'>, limit?: number) {
  limit = limit || 1900;
  const subject = truncate(deriveTitle(note) || 'Note', 120);
  const body = String(note.body || '');
  const notice = '\n\n[Truncated for email. Share the full note as a PDF or Markdown file.]';
  const head = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=';
  const full = head + encodeURIComponent(body);
  if (full.length <= limit) return { url: full, truncated: false };
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

function noteLinkIds(body: string) {
  const out: string[] = [];
  const re = /note:\/\/([0-9a-f][0-9a-f-]{7,})/gi;
  let m;
  while ((m = re.exec(String(body || ''))) !== null) { const id = m[1].toLowerCase(); if (!out.includes(id)) out.push(id); }
  return out;
}

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WIKI_ALIAS = /\\?\|/;
const WIKI_NOTE_EXT = /\.(md|markdown|mdx)$/i;

function wikiLinkTarget(inner: string) {
  return inner.split(WIKI_ALIAS)[0].split(/[#^]/)[0].trim();
}

function wikiLinkName(inner: string) {
  return wikiLinkTarget(inner).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '').toLowerCase();
}

function wikiLinkLabel(inner: string) {
  const parts = inner.split(WIKI_ALIAS);
  const alias = parts.slice(1).join('|').trim();
  if (alias) return alias;
  const [target, heading] = parts[0].split('#');
  const name = target.split('^')[0].trim().replace(WIKI_NOTE_EXT, '');
  const section = (heading || '').split('^')[0].trim();
  return section ? (name ? name + ' > ' + section : section) : name || inner.trim() || '[[' + inner + ']]';
}

function vaultLinks(body: string) {
  const text = String(body || '').replace(/(```|~~~)[\s\S]*?(?:\1|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const m of text.matchAll(/\[\[([^[\]\n]+?)\]\]/g)) {
    const name = wikiLinkName(m[1]);
    if (name) names.add(name);
  }
  for (const m of text.matchAll(/\]\(\s*(<[^>\n]+>|[^)\s]+)/g)) {
    const raw = m[1].replace(/^<|>$/g, '');
    if (URL_SCHEME.test(raw)) continue;
    let href = raw.split('#')[0].split('?')[0];
    try { href = decodeURIComponent(href); } catch (_) {  }
    if (href) paths.add(href.replace(/\\/g, '/'));
  }
  return { names: Array.from(names), paths: Array.from(paths) };
}

function linkLeaf(target: string) {
  const leaf = target.split('/').pop() || '';
  return leaf.toLowerCase();
}

function stemOf(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function safeFilename(name: string) {
  let s = Array.from(String(name || UNTITLED).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 80).join('').replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) s = 'note-' + s;
  return s || UNTITLED;
}

function isViewerOnlyFile(note: FileSource) {
  return !!(note && note.filePath && note.fileKind !== 'text');
}

function extOf(filePath: string | null | undefined) {
  const base = (String(filePath || '').split(/[\\/]/).pop() || '').toLowerCase();
  if (!base.includes('.')) return base;
  return base.slice(base.lastIndexOf('.') + 1);
}

function isPlainTextFile(note: FileSource) {
  return !!(note && note.filePath && note.fileKind === 'text' && !/\.(md|markdown|mdx)$/i.test(note.filePath));
}

function isNonMarkdownFile(note: FileSource) {
  return isPlainTextFile(note) || isViewerOnlyFile(note);
}

const WORD_EXT = new Set(['docx', 'docm', 'dotx', 'dotm', 'doc', 'dot', 'rtf', 'odt']);
const OOXML_EXT = new Set(['docx', 'docm', 'dotx', 'dotm']);
const WORD_TO_DOCX_EXT = new Set(['doc', 'dot', 'rtf', 'odt']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif']);
const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif' };
const SHEET_EXT = new Set(['xlsx', 'xlsm', 'xls', 'xlsb', 'ods']);
const SHEET_TO_XLSX_EXT = new Set(['xlsm', 'xls', 'xlsb', 'ods']);
const CRAFT_OF: Partial<Record<FileKind, 'wordcraft' | 'gridcraft'>> = { docx: 'wordcraft', sheet: 'gridcraft' };
const ZIP_DOC_EXT = new Set([...OOXML_EXT, 'odt', 'xlsx', 'xlsm', 'xlsb', 'ods', 'epub', 'zip']);

function isTableFile(note: FileSource) {
  return !!note && isPlainTextFile(note) && ['csv', 'tsv'].includes(extOf(note.filePath));
}

function isOoxmlWordFile(note: FileSource) {
  return !!(note && note.filePath && note.fileKind === 'docx' && OOXML_EXT.has(extOf(note.filePath)));
}

function headingTitle(md: string) {
  const escaped: string[] = [];
  let s = String(md || '').replace(/\\([!-/:-@[-`{-~])/g, (_, c) => { escaped.push(c); return '\u0000' + (escaped.length - 1) + '\u0001'; });
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.replace(/<[^>\n]+>/g, '');
  s = s.replace(/(\*\*|~~)(\S(?:.*?\S)?)\1/g, '$2').replace(/\*(\S(?:.*?\S)?)\*/g, '$1');
  s = s.replace(/(^|\W)(__?)(\S(?:.*?\S)?)\2(?!\w)/g, '$1$3');
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  s = s.replace(/\u0000(\d+)\u0001/g, (_, i) => escaped[Number(i)]);
  return s.replace(/\s+/g, ' ').trim();
}

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

function imageBaseFor(note: FileSource) {
  const p = note && note.filePath ? String(note.filePath).replace(/\\/g, '/') : '';
  if (!p || p.startsWith('//')) return null;
  const parts = p.split('/');
  parts.pop();
  return 'file:///' + parts.map((s, i) => (i === 0 && /^[a-z]:$/i.test(s) ? s : encodeURIComponent(s))).join('/').replace(/^\/+/, '') + '/';
}

function fileStamp(date?: number) {
  return new Date(date === undefined ? Date.now() : date).toISOString().replace(/[:.]/g, '-');
}

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

const tenths = (n: number) => Math.round(n * 10) / 10;
const traceClock = () => tenths(performance.timeOrigin + performance.now());
const msSince = (start: number) => tenths(performance.now() - start);

export {
  isObjectLike, isRecord, tenths, traceClock, msSince,
  fuzzyScore,
  splitAtHeadings, headingTitle, extOf, isViewerOnlyFile, isPlainTextFile, isNonMarkdownFile, isTableFile, isOoxmlWordFile, imageBaseFor, fileStamp,
  WORD_EXT, OOXML_EXT, WORD_TO_DOCX_EXT, IMAGE_EXT, IMAGE_MIME, SHEET_EXT, SHEET_TO_XLSX_EXT, CRAFT_OF, ZIP_DOC_EXT,
  UNTITLED, deriveTitle, firstLine, truncate, snippet, relativeTime, parseTags, toggleTaskAt,
  countWords, tokenize, searchHay, matchesQuery, sortNotes, outlineRow, listRow, matchExcerpt, parseAccelerator, displayAccelerator,
  noteToMarkdown, markdownToNote, safeFilename, PANE_LIMITS, EDITOR_MIN, clampPane,
  plainTextFromMarkdown, speechChunks, formatWhen, mailtoFor, noteLinkIds, vaultLinks, linkLeaf, stemOf, wikiLinkTarget, wikiLinkName, wikiLinkLabel,
};
