'use strict';
/* WordCraft (the user's Rust word processor, github.com/celestinryf/wordcraft) edits Word documents inside Notes.
   Its web build (WebAssembly) runs in a frame, served from the build folder under a private wordcraft:// scheme.
   The frame and the page talk with postMessage (see apps/wordcraft-web/src/web/host.rs in WordCraft).

   This module only finds and serves the build. Without a build, Notes keeps its own simple Word editor.
   Build it with `trunk build --release` in WordCraft's apps/wordcraft-web; the output is <repo>\dist\web. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCHEME = 'wordcraft';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8',
};

// Where the build is: NOTES_APP_WORDCRAFT_DIR, else WordCraft's own output folder in the usual clone.
// NOTES_APP_NO_WORDCRAFT=1 means none.
function buildDir() {
  if (process.env.NOTES_APP_NO_WORDCRAFT === '1') return null; // the tests drive Notes' own Word editor
  const candidates = [process.env.NOTES_APP_WORDCRAFT_DIR, path.join(os.homedir(), 'wordcraft', 'dist', 'web')].filter(Boolean);
  return candidates.find((d) => { try { return fs.statSync(path.join(d, 'index.html')).isFile(); } catch (_) { return false; } }) || null;
}

// Must run before the app is ready.
function registerScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

// The file a wordcraft://app/<path> request names, inside the build folder; null for anything outside it.
function resolve(dir, url) {
  let rel;
  try { rel = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '') || 'index.html'; } catch (_) { return null; }
  const file = path.resolve(dir, rel);
  const inside = path.relative(dir, file);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return rel === 'index.html' ? path.join(dir, 'index.html') : null;
  return file;
}

// Serves the build. Returns whether there is one.
function serve(protocol) {
  const dir = buildDir();
  protocol.handle(SCHEME, async (req) => {
    if (!dir) return new Response('WordCraft is not built on this computer.', { status: 404 });
    const file = resolve(dir, req.url);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const buf = await fs.promises.readFile(file);
      return new Response(buf, { status: 200, headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } });
    } catch (_) {
      return new Response('Not found', { status: 404 });
    }
  });
  return !!dir;
}

module.exports = { SCHEME, buildDir, registerScheme, resolve, serve };
