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

function isInside(dir: string, file: string) {
  const inside = path.relative(dir, file);
  return !!inside && !inside.startsWith('..') && !path.isAbsolute(inside);
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
    return isInside(dir, file) ? { dir, file } : null;
  }

  async function respond(url: string) {
    const found = fileFor(url);
    if (!found) return new Response('Not found', { status: 404 });
    try {
      const [realDir, file] = await Promise.all([fs.promises.realpath(found.dir), fs.promises.realpath(found.file)]);
      if (!isInside(realDir, file)) return new Response('Not found', { status: 404 });
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

function ownerFrame<T extends FrameNode<T> & { url: string }>(frame: T, foreign: Set<number>) {
  let f: T | null = frame;
  while (f && (foreign.has(f.frameTreeNodeId) || !/^file:/i.test(f.url))) f = f.parent;
  return f;
}

const GESTURE_MS = 3000;
const EXTERNAL_GAP_MS = 1000;
const GESTURE_INPUTS = new Set(['mouseDown', 'mouseUp', 'keyDown', 'rawKeyDown', 'char', 'gestureTap', 'touchStart', 'touchEnd']);

function createExternalGate(now: () => number = Date.now) {
  let lastInput = -Infinity;
  let lastOpen = -Infinity;
  return {
    input(type: string) { if (GESTURE_INPUTS.has(type)) lastInput = now(); },
    allow() {
      const t = now();
      if (t - lastInput > GESTURE_MS || t - lastOpen < EXTERNAL_GAP_MS) return false;
      lastOpen = t;
      return true;
    },
  };
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const TLS_TROUBLE = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|TLS/;

function errorCode(err: unknown) {
  const cause = err instanceof Error ? err.cause : null;
  return cause instanceof Error && 'code' in cause ? String(cause.code) : '';
}

async function probeLocal(raw: string, fetcher: Fetcher, timeoutMs: number) {
  const target = loopbackUrl(raw);
  if (!target) return false;
  if (new URL(target).hostname.endsWith('.localhost')) return true;
  try {
    const res = await fetcher(target, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (res.body) await res.body.cancel().catch(() => {});
    return true;
  } catch (err) {
    return TLS_TROUBLE.test(errorCode(err));
  }
}

const PAGE_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

function permissionAllowed(permission: string, requestingUrl: string) {
  if (!/^(notespage|https?):/i.test(requestingUrl)) return true;
  return PAGE_PERMISSIONS.has(permission);
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

export { SCHEME, privilegedSchemes, createPageHost, frameNavigation, isForeignFrame, ownerFrame, pageShortcut, createExternalGate, permissionAllowed, probeLocal };
export type { FrameLike, FrameVerdict };
