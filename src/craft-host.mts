/* The Craft apps edit office files inside Notes: WordCraft (Word documents) and GridCraft (spreadsheets), the user's
   forks of ArtCraft's Rust office apps (github.com/celestinryf/<name>), each built to WebAssembly and shown in a
   frame of its own. A build is served from its folder under a private scheme named after the app (wordcraft://app,
   gridcraft://app); the frame and the page talk with postMessage (see apps/<name>-web/src/host.rs in each fork, and
   renderer/craft-frame.js).

   This module only finds and serves the builds. Without one, Notes shows what it can on its own: its simple Word
   editor; for spreadsheets, a banner and "Open with…".
   Build one with `trunk build --release` in the fork's apps/<name>-web; the output is <repo>\dist\web. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// NOTES_APP_<NAME>_DIR names a build folder; NOTES_APP_NO_<NAME>=1 (or NOTES_APP_NO_CRAFTS=1 for all of them) means
// none, which the tests use to drive Notes' own editors whatever is built on this computer.
const APPS: Record<string, { label: string, env: string }> = {
  wordcraft: { label: 'WordCraft', env: 'WORDCRAFT' },
  gridcraft: { label: 'GridCraft', env: 'GRIDCRAFT' },
};
const KEYS = Object.keys(APPS);
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8',
};

// Where an app's build is: its NOTES_APP_<NAME>_DIR, else the fork's own output folder in the usual clone; null for none.
function buildDir(key: string) {
  const app = APPS[key];
  if (!app || process.env.NOTES_APP_NO_CRAFTS === '1' || process.env['NOTES_APP_NO_' + app.env] === '1') return null;
  const candidates = [process.env['NOTES_APP_' + app.env + '_DIR'], path.join(os.homedir(), key, 'dist', 'web')].flatMap((d) => (d ? [d] : []));
  return candidates.find((d) => { try { return fs.statSync(path.join(d, 'index.html')).isFile(); } catch (_) { return false; } }) || null;
}

// Must run before the app is ready.
function registerSchemes(protocol: Electron.Protocol) {
  protocol.registerSchemesAsPrivileged(KEYS.map((scheme) => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } })));
}

// The file a <app>://app/<path> request names, inside the build folder; null for anything outside it.
function resolve(dir: string, url: string) {
  let rel;
  try { rel = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '') || 'index.html'; } catch (_) { return null; }
  const file = path.resolve(dir, rel);
  const inside = path.relative(dir, file);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return rel === 'index.html' ? path.join(dir, 'index.html') : null;
  return file;
}

// Serves every app's build. Returns which are there: { wordcraft, gridcraft }.
function serve(protocol: Electron.Protocol) {
  const ready: Record<string, boolean> = {};
  for (const key of KEYS) {
    const dir = buildDir(key);
    ready[key] = !!dir;
    protocol.handle(key, async (req) => {
      if (!dir) return new Response(APPS[key].label + ' is not built on this computer.', { status: 404 });
      const file = resolve(dir, req.url);
      if (!file) return new Response('Not found', { status: 404 });
      try {
        const buf = await fs.promises.readFile(file);
        return new Response(buf, { status: 200, headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } });
      } catch (_) {
        return new Response('Not found', { status: 404 });
      }
    });
  }
  return ready;
}

export { APPS, KEYS, buildDir, registerSchemes, resolve, serve };
