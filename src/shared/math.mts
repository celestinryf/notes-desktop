import type MarkdownIt from 'markdown-it';
import type { StateBlock, StateInline, Token } from 'markdown-it';

export type MathSpan = { end: number, latex: string, display: boolean };
export type MathRenderers = {
  inline: (latex: string, display: boolean) => string,
  block: (latex: string) => string,
  dollar: () => string,
};

const DOLLAR = 0x24;
const BACKSLASH = 0x5c;
const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

function blankLineAfter(src: string, newline: number, max: number) {
  for (let i = newline + 1; i < max; i++) {
    const c = src[i];
    if (c === '\n') return true;
    if (c !== ' ' && c !== '\t' && c !== '\r') return false;
  }
  return true;
}

function inlineAt(src: string, pos: number, max: number): MathSpan | null {
  const start = pos + 1;
  if (start >= max || isSpace(src[start])) return null;
  for (let i = start; i < max; i++) {
    const c = src[i];
    if (c === '\n') return null;
    if (c === '\\') { if (src[i + 1] === '\n') return null; i++; continue; }
    if (c !== '$') continue;
    if (isSpace(src[i - 1]) || (i + 1 < max && isDigit(src[i + 1]))) return null;
    return { end: i + 1, latex: src.slice(start, i), display: false };
  }
  return null;
}

function displayAt(src: string, pos: number, max: number): MathSpan | null {
  const start = pos + 2;
  for (let i = start; i < max; i++) {
    const c = src[i];
    if (c === '\n') { if (blankLineAfter(src, i, max)) return null; continue; }
    if (c === '\\') { i++; continue; }
    if (c !== '$' || src[i + 1] !== '$' || i + 1 >= max) continue;
    if (i === start) return null;
    return { end: i + 2, latex: src.slice(start, i), display: true };
  }
  return null;
}

export function mathAt(src: string, pos: number, max?: number): MathSpan | null {
  const end = max === undefined ? src.length : Math.min(max, src.length);
  if (src.charCodeAt(pos) !== DOLLAR) return null;
  return src.charCodeAt(pos + 1) === DOLLAR ? displayAt(src, pos, end) : inlineAt(src, pos, end);
}

function closingDisplay(text: string) {
  for (let i = 0; i < text.length - 1; i++) {
    if (text.charCodeAt(i) === BACKSLASH) { i++; continue; }
    if (text.charCodeAt(i) === DOLLAR && text.charCodeAt(i + 1) === DOLLAR) return i;
  }
  return -1;
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  if (state.src.charCodeAt(pos) !== DOLLAR || state.src.charCodeAt(pos + 1) !== DOLLAR) return false;
  let body = state.src.slice(pos + 2, state.eMarks[startLine]);
  for (let line = startLine; line < endLine; line++) {
    if (line > startLine) {
      if (state.isEmpty(line) || state.sCount[line] < state.blkIndent) return false;
      body += '\n' + state.getLines(line, line + 1, state.blkIndent, false).replace(/\n$/, '');
    }
    const close = closingDisplay(body);
    if (close === -1) continue;
    if (close === 0 || body.slice(close + 2).trim() !== '') return false;
    if (silent) return true;
    const token = state.push('math_block', 'div', 0);
    token.content = body.slice(0, close);
    token.markup = '$$';
    token.block = true;
    token.map = [startLine, line + 1];
    state.line = line + 1;
    return true;
  }
  return false;
}

function mathInline(state: StateInline, silent: boolean) {
  const span = mathAt(state.src, state.pos, state.posMax);
  if (!span) return false;
  if (!silent) {
    const token = state.push('math_inline', 'span', 0);
    token.content = span.latex;
    token.markup = span.display ? '$$' : '$';
  }
  state.pos = span.end;
  return true;
}

function escapedDollar(state: StateInline, silent: boolean) {
  if (state.src.charCodeAt(state.pos) !== BACKSLASH || state.src.charCodeAt(state.pos + 1) !== DOLLAR) return false;
  if (!silent) {
    const token = state.push('math_dollar', '', 0);
    token.content = '$';
    token.markup = '\\$';
  }
  state.pos += 2;
  return true;
}

const parsersWithMath = new WeakSet<MarkdownIt>();

export function addMath(md: MarkdownIt, render: MathRenderers) {
  if (parsersWithMath.has(md)) return;
  parsersWithMath.add(md);
  md.block.ruler.after('fence', 'math_block', mathBlock, { alt: ['blockquote', 'list'] });
  md.inline.ruler.before('escape', 'math_dollar', escapedDollar);
  md.inline.ruler.before('escape', 'math_inline', mathInline);
  md.renderer.rules.math_inline = (tokens: Token[], idx: number) => render.inline(tokens[idx].content, tokens[idx].markup === '$$');
  md.renderer.rules.math_block = (tokens: Token[], idx: number) => render.block(tokens[idx].content);
  md.renderer.rules.math_dollar = () => render.dollar();
}

export function mathSource(latex: string, display: boolean) {
  return display ? '$$' + latex + '$$' : '$' + latex + '$';
}

function codeSpanEnd(s: string, at: number) {
  let run = 0;
  while (s[at + run] === '`') run++;
  for (let i = at + run; i < s.length; i++) {
    if (s[i] !== '`') continue;
    let close = 0;
    while (s[i + close] === '`') close++;
    if (close === run) return i + close;
    i += close - 1;
  }
  return at + run;
}

function eachMath(md: string, onText: (text: string) => void, onMath: (span: MathSpan) => void) {
  const s = String(md || '');
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '`') { i = codeSpanEnd(s, i) - 1; continue; }
    if (c === '\\') {
      if (s[i + 1] === '$') { onText(s.slice(from, i)); from = i + 1; }
      i++;
      continue;
    }
    const span = c === '$' ? mathAt(s, i) : null;
    if (!span) continue;
    onText(s.slice(from, i));
    onMath(span);
    from = span.end;
    i = span.end - 1;
  }
  onText(s.slice(from));
}

export function mathAsText(md: string, keep: boolean) {
  if (!String(md || '').includes('$')) return String(md || '');
  let out = '';
  eachMath(md, (text) => { out += text; }, (span) => { if (keep) out += span.latex.replace(/\s+/g, ' ').trim(); });
  return out;
}

export function hasMath(md: string) {
  if (!String(md || '').includes('$')) return false;
  let found = false;
  eachMath(md, () => {}, () => { found = true; });
  return found;
}

export function escapeMathOpeners(markdown: string) {
  if (!markdown.includes('$')) return markdown;
  let out = '';
  for (let i = 0; i < markdown.length; i++) {
    const c = markdown[i];
    if (c === '\\') { out += markdown.slice(i, i + 2); i++; continue; }
    out += c === '$' && mathAt(markdown, i) ? '\\$' : c;
  }
  return out;
}

function escapeDollars(latex: string, pair: boolean) {
  let out = '';
  for (let i = 0; i < latex.length; i++) {
    const c = latex[i];
    if (c === '\\') { out += latex.slice(i, i + 2); i++; continue; }
    out += c === '$' && (!pair || latex[i + 1] === '$') ? '\\$' : c;
  }
  return out;
}

export function inlineLatexForSaving(latex: string) {
  let s = escapeDollars(String(latex).replace(/\s*\n\s*/g, ' ').trim(), false);
  const trailing = /\\+$/.exec(s);
  if (trailing && trailing[0].length % 2 === 1) s = s.slice(0, -1).trimEnd();
  return s;
}

export function blockLatexForSaving(latex: string) {
  const s = escapeDollars(String(latex).replace(/\r/g, '').replace(/^[ \t]*\n+|\n+[ \t]*$/g, '').replace(/\n[ \t]*\n/g, '\n'), true);
  return s.trim() ? '\n' + s + '\n' : '\n';
}

export function formulaErrorText(message: string) {
  return String(message).replace(/^KaTeX parse error:\s*/, '').replace(/ at (?:position \d+|end of input):[\s\S]*$/, '').trim() || 'This formula has a mistake.';
}

export const KATEX_OPTIONS ={ throwOnError: false, errorColor: 'var(--danger)', strict: 'ignore', trust: false, maxSize: 50, maxExpand: 1000, output: 'htmlAndMathml' } as const;
