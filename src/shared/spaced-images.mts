import type MarkdownIt from 'markdown-it';
import type { StateInline, Token } from 'markdown-it';
import { IMAGE_EXT, extOf, isRecord } from './helpers.mts';

const SPACED_IMAGE = /^!\[([^[\]\n]*)\]\(([^()<>\n]+)\)/;

function isSpacedImagePath(dest: string) {
  return dest.includes(' ') && dest.trim() === dest && IMAGE_EXT.has(extOf(dest));
}

function writtenImagePath(token: Token) {
  return isRecord(token.meta) && typeof token.meta.writtenSrc === 'string' ? token.meta.writtenSrc : null;
}

function spacedImage(state: StateInline, silent: boolean) {
  if (state.src.charCodeAt(state.pos) !== 0x21) return false;
  const m = SPACED_IMAGE.exec(state.src.slice(state.pos));
  if (!m || !isSpacedImagePath(m[2])) return false;
  const src = state.md.normalizeLink(m[2]);
  if (!state.md.validateLink(src)) return false;
  if (!silent) {
    const children: Token[] = [];
    state.md.inline.parse(m[1], state.md, state.env, children);
    const token = state.push('image', 'img', 0);
    token.attrs = [['src', src], ['alt', '']];
    token.children = children;
    token.content = m[1];
    token.meta = { writtenSrc: m[2] };
  }
  state.pos += m[0].length;
  return true;
}

function addSpacedImages(md: MarkdownIt) {
  md.inline.ruler.before('image', 'spaced_image', spacedImage);
}

export { addSpacedImages, isSpacedImagePath, writtenImagePath };
