import { parseTags } from './helpers.mts';

type Split = { front: string; body: string };
type Block = { open: string; inner: string[]; close: string; trailing: string; nl: string; length: number };
type KeyRange = { start: number; end: number; inline: string };

const OPEN_LINE = /^---[ \t]*$/;
const CLOSE_LINE = /^---[ \t]*$/;
const KEY_LINE = /^([^\s#:-][^:]*?|-[^\s:][^:]*?)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/;
const TAG_KEYS = ['tags', 'tag'];
const RESERVED = /^(true|false|yes|no|on|off|null|~|y|n)$/i;
const MARKDOWN_PATH = /\.(md|markdown|mdx)$/i;
const INLINE_TAG = /(^|\s)#([\p{L}\p{N}_\-/]+)/gu;

function isMarkdownPath(filePath: string | null | undefined) {
  return MARKDOWN_PATH.test(String(filePath || ''));
}

function fileKeepsTags(n: Pick<Note, 'vaultId' | 'fileKind' | 'filePath'>) {
  return !!n.vaultId && n.fileKind === 'text' && isMarkdownPath(n.filePath);
}

function linesWithEnds(text: string) {
  const out: { line: string; end: string }[] = [];
  let at = 0;
  while (at < text.length) {
    const nl = text.indexOf('\n', at);
    if (nl === -1) { out.push({ line: text.slice(at), end: '' }); break; }
    const cr = nl > at && text[nl - 1] === '\r';
    out.push({ line: text.slice(at, cr ? nl - 1 : nl), end: cr ? '\r\n' : '\n' });
    at = nl + 1;
  }
  return out;
}

function looksLikeYaml(lines: readonly string[]) {
  return lines.every((l) => !l.trim() || /^\s/.test(l) || /^#/.test(l) || /^-(\s|$)/.test(l) || KEY_LINE.test(l));
}

function readBlock(text: string): Block | null {
  const lines = linesWithEnds(String(text || ''));
  if (!lines.length || !OPEN_LINE.test(lines[0].line) || !lines[0].end) return null;
  let close = -1;
  for (let i = 1; i < lines.length; i++) if (CLOSE_LINE.test(lines[i].line)) { close = i; break; }
  if (close === -1) return null;
  const inner = lines.slice(1, close).map((l) => l.line);
  if (!looksLikeYaml(inner)) return null;
  let after = close + 1;
  while (after < lines.length && !lines[after].line.trim() && lines[after].end) after++;
  const whole = (l: { line: string; end: string }) => l.line + l.end;
  return {
    open: whole(lines[0]),
    inner,
    close: whole(lines[close]),
    trailing: lines.slice(close + 1, after).map(whole).join(''),
    nl: lines[0].end,
    length: lines.slice(0, after).reduce((n, l) => n + l.line.length + l.end.length, 0),
  };
}

function blockText(b: Block) {
  return b.open + b.inner.map((l) => l + b.nl).join('') + b.close + b.trailing;
}

function splitFrontMatter(text: string): Split {
  const s = String(text || '');
  const b = readBlock(s);
  return b ? { front: s.slice(0, b.length), body: s.slice(b.length) } : { front: '', body: s };
}

function stripComment(value: string) {
  let quote = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i);
  }
  return value;
}

function unquote(raw: string) {
  const s = raw.trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') { try { const v: unknown = JSON.parse(s); return typeof v === 'string' ? v : s.slice(1, -1); } catch (_) { return s.slice(1, -1); } }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function splitFlow(inside: string) {
  const out: string[] = [];
  let quote = '', cur = '';
  for (const c of inside) {
    if (quote) { cur += c; if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === ',') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(unquote).filter(Boolean);
}

function keyRange(inner: readonly string[], names: readonly string[]): KeyRange | null {
  for (let i = 0; i < inner.length; i++) {
    const m = KEY_LINE.exec(inner[i]);
    if (!m || !names.includes(unquote(m[1]).toLowerCase())) continue;
    let end = i + 1;
    for (let j = i + 1; j < inner.length; j++) {
      const l = inner[j];
      if (!l.trim()) continue;
      if (/^\s/.test(l) || /^-(\s|$)/.test(l)) { end = j + 1; continue; }
      break;
    }
    return { start: i, end, inline: m[2] || '' };
  }
  return null;
}

function rangeValues(inner: readonly string[], r: KeyRange) {
  const inline = stripComment(r.inline).trim();
  const rest = inner.slice(r.start + 1, r.end);
  if (inline.startsWith('[')) {
    const joined = [inline].concat(rest.map((l) => stripComment(l).trim())).join(' ');
    const close = joined.lastIndexOf(']');
    return splitFlow(joined.slice(1, close === -1 ? joined.length : close));
  }
  if (inline) return unquote(inline).split(/[,\s]+/).filter(Boolean);
  return rest.map((l) => /^\s*-\s*(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => unquote(stripComment(m[1]))).filter(Boolean);
}

function frontMatterTags(text: string) {
  const b = readBlock(String(text || ''));
  if (!b) return [];
  const r = keyRange(b.inner, TAG_KEYS);
  return r ? parseTags(rangeValues(b.inner, r)) : [];
}

function inlineTags(text: string) {
  const body = splitFrontMatter(text).body.replace(/(```|~~~)[\s\S]*?(?:\1|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const out: string[] = [];
  for (const m of body.matchAll(INLINE_TAG)) {
    const tag = m[2].replace(/[/-]+$/, '');
    if (tag && !/^[\d/_-]+$/.test(tag)) out.push(tag);
  }
  return parseTags(out);
}

function noteTags(text: string) {
  return parseTags(frontMatterTags(text).concat(inlineTags(text)));
}

function yamlScalar(tag: string) {
  return /^[\p{L}\p{N}_][\p{L}\p{N}_\-/.]*$/u.test(tag) && !RESERVED.test(tag) && !/^[\d.]+$/.test(tag) ? tag : JSON.stringify(tag);
}

function setNoteTags(text: string, wanted: readonly string[]) {
  const s = String(text || '');
  const inline = new Set(inlineTags(s));
  const b = readBlock(s);
  const range = b ? keyRange(b.inner, TAG_KEYS) : null;
  const spelled = new Map<string, string>();
  if (b && range) for (const v of rangeValues(b.inner, range)) { const t = parseTags(v)[0]; if (t && !spelled.has(t)) spelled.set(t, v.replace(/^#+/, '')); }
  const keep = parseTags(wanted).filter((t) => !inline.has(t)).map((t) => spelled.get(t) || t);
  const current = b && range ? parseTags(rangeValues(b.inner, range)) : [];
  if (parseTags(keep).join(',') === current.join(',')) return s;
  const nl = b ? b.nl : (s.includes('\r\n') ? '\r\n' : '\n');
  const flow = !!range && stripComment(range.inline).trim().startsWith('[');
  const name = b && range ? (KEY_LINE.exec(b.inner[range.start]) || [])[1] || 'tags' : 'tags';
  const lines = !keep.length ? [] : flow ? [name + ': [' + keep.map(yamlScalar).join(', ') + ']'] : [name + ':'].concat(keep.map((t) => '  - ' + yamlScalar(t)));
  if (!b) return '---' + nl + lines.join(nl) + nl + '---' + nl + s;
  const inner = b.inner.slice();
  if (range) inner.splice(range.start, range.end - range.start, ...lines);
  else inner.push(...lines);
  const body = s.slice(b.length);
  if (!inner.some((l) => l.trim())) return body;
  return blockText(Object.assign({}, b, { inner })) + body;
}

export { isMarkdownPath, fileKeepsTags, splitFrontMatter, frontMatterTags, inlineTags, noteTags, setNoteTags };
