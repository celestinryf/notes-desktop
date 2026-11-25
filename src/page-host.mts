import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MIME } from './craft-host.mts';
import { loopbackUrl } from './shared/helpers.mts';

const SCHEME = 'notespage';

type FrameLike = { frameTreeNodeId: number, url: string, parent: FrameLike | null };
type FrameVerdict = 'allow' | 'block' | 'external';

function privilegedSchemes(): Electron.CustomScheme[] {
  return [{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }];
}

function folderKey(dir: string) {
  const resolved = path.resolve(dir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function createPageHost() {
  const folders = new Map<string, string>();

  function pageUrl(filePath: string) {
    const dir = path.dirname(path.resolve(filePath));
    const token = crypto.createHash('sha256').update(folderKey(dir)).digest('hex').slice(0, 32);
    folders.set(token, dir);
    return SCHEME + '://' + token + '/' + encodeURIComponent(path.basename(filePath));
  }

  function fileFor(url: string) {
    let parsed: URL;
    try { parsed = new URL(url); } catch (_) { return null; }
    if (parsed.protocol !== SCHEME + ':') return null;
    const dir = folders.get(parsed.hostname);
    if (!dir) return null;
    let rel: string;
    try { rel = decodeURIComponent(parsed.pathname).replace(/^[/\\]+/, ''); } catch (_) { return null; }
    if (!rel || rel.includes('\0')) return null;
    const file = path.resolve(dir, rel);
    const inside = path.relative(dir, file);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return null;
    return file;
  }

  async function respond(url: string) {
    const file = fileFor(url);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) return new Response('Not found', { status: 404 });
      const buf = await fs.promises.readFile(file);
      return new Response(buf, { status: 200, headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } });
    } catch (_) {
      return new Response('Not found', { status: 404 });
    }
  }

  function serve(protocol: Electron.Protocol) {
    protocol.handle(SCHEME, (req) => respond(req.url));
  }

  return { pageUrl, fileFor, respond, serve };
}

function frameNavigation(target: string, frame: FrameLike | null, foreign: Set<number>): FrameVerdict {
  if (!frame) return 'block';
  const chain: FrameLike[] = [];
  for (let f: FrameLike | null = frame; f; f = f.parent) chain.push(f);
  if (/^file:/i.test(target)) return chain.some((f) => foreign.has(f.frameTreeNodeId)) ? 'block' : 'allow';
  if (/^about:/i.test(target)) return 'allow';
  foreign.add(frame.frameTreeNodeId);
  const ownPageFrame = !!frame.parent && /^file:/i.test(frame.parent.url);
  if (ownPageFrame && /^https?:/i.test(target) && !loopbackUrl(target)) return 'external';
  return 'allow';
}

type FrameNode<T> = { frameTreeNodeId: number, parent: T | null };

function isForeignFrame<T extends FrameNode<T>>(frame: T, foreign: Set<number>) {
  for (let f: T | null = frame; f; f = f.parent) if (foreign.has(f.frameTreeNodeId)) return true;
  return false;
}

function ownerFrame<T extends FrameNode<T>>(frame: T, foreign: Set<number>) {
  let f: T | null = frame;
  while (f && foreign.has(f.frameTreeNodeId)) f = f.parent;
  return f;
}

const FORWARDED_CTRL = new Set(['e', 'p', 'n', 'o', 't', 'w', ',', 'tab', '\\']);
const FORWARDED_CTRL_SHIFT = new Set(['b', 'n', 'tab', '\\', '|']);

function pageShortcut(input: Pick<Electron.Input, 'type' | 'key' | 'code' | 'control' | 'meta' | 'shift' | 'alt'>): PageKey | null {
  if (!input || input.type !== 'keyDown') return null;
  const key = String(input.key || '');
  const ctrl = !!(input.control || input.meta);
  const plain = { key, code: String(input.code || ''), ctrl, shift: !!input.shift, alt: !!input.alt, reload: false };
  if (key === 'F5' && !ctrl && !input.alt) return Object.assign(plain, { reload: true });
  if (!ctrl || input.alt) return null;
  const k = key.toLowerCase();
  if (k === 'r' && !input.shift) return Object.assign(plain, { reload: true });
  return (input.shift ? FORWARDED_CTRL_SHIFT : FORWARDED_CTRL).has(k) ? plain : null;
}

export { SCHEME, privilegedSchemes, createPageHost, frameNavigation, isForeignFrame, ownerFrame, pageShortcut };
export type { FrameLike, FrameVerdict };
