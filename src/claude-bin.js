'use strict';
/* Finds the Claude Code executable without going through a shell. npm installs `claude` on Windows as a
   .cmd shim that only cmd.exe can run; spawning through cmd.exe would mean quoting the prompt for cmd,
   which cannot be done safely (newlines, %VAR%, &, |). So the shim is read and the real target is launched. */
const fs = require('fs');
const path = require('path');

const NAMES = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];

function exists(p) {
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

// Reads an npm .cmd/.sh shim and returns the file it ultimately runs, or null.
function shimTarget(shimPath) {
  let text;
  try { text = fs.readFileSync(shimPath, 'utf8'); } catch (_) { return null; }
  const dir = path.dirname(shimPath);
  const re = /"?((?:%~?dp0%?|\$basedir)[^"\r\n]*?\.(?:exe|js|cjs|mjs))"?/gi;
  let m;
  while ((m = re.exec(text))) {
    const rel = m[1].replace(/^%~?dp0%?[\\/]?/i, '').replace(/^\$basedir[\\/]?/i, '');
    const full = path.resolve(dir, rel);
    if (exists(full)) return full;
  }
  return null;
}

// Turns a candidate path into a launch spec: { file, isScript } or null when it cannot be run directly.
function specFor(p) {
  if (!p || !exists(p)) return null;
  if (/\.(js|cjs|mjs)$/i.test(p)) return { file: p, isScript: true };
  if (/\.exe$/i.test(p) || process.platform !== 'win32' && !/\.(cmd|bat)$/i.test(p)) {
    // A bare file on POSIX may itself be a shell shim pointing at a .js; prefer the script then.
    if (process.platform !== 'win32') { const t = shimTarget(p); if (t) return specFor(t); }
    return { file: p, isScript: false };
  }
  if (/\.(cmd|bat)$/i.test(p)) return specFor(shimTarget(p));
  return null;
}

// opts.override: NOTES_APP_CLAUDE_BIN (a .js stand-in, an .exe, or a shim). opts.pathDirs: directories to
// search (defaults to PATH plus the native installer's ~/.local/bin). Returns { file, isScript } or null.
function resolveClaude(opts) {
  opts = opts || {};
  if (opts.override) return specFor(path.resolve(opts.override));
  const dirs = (opts.pathDirs || (process.env.PATH || '').split(path.delimiter)).filter(Boolean);
  const home = opts.home || process.env.USERPROFILE || process.env.HOME || '';
  if (home) dirs.push(path.join(home, '.local', 'bin'));
  for (const d of dirs) {
    for (const n of NAMES) {
      const spec = specFor(path.join(d, n));
      if (spec) return spec;
    }
  }
  return null;
}

// Finds a plain Node binary for running a .js target; null means use the host with ELECTRON_RUN_AS_NODE.
function resolveNode(pathDirs) {
  const dirs = (pathDirs || (process.env.PATH || '').split(path.delimiter)).filter(Boolean);
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const d of dirs) { const p = path.join(d, name); if (exists(p)) return p; }
  return null;
}

// Builds the spawn call: [file, args, extraEnv] for child_process.spawn with shell: false.
function launchSpec(spec, args, opts) {
  opts = opts || {};
  if (!spec.isScript) return { file: spec.file, args: args.slice(), env: {} };
  const node = opts.node === undefined ? resolveNode(opts.pathDirs) : opts.node;
  if (node) return { file: node, args: [spec.file].concat(args), env: {} };
  return { file: process.execPath, args: [spec.file].concat(args), env: { ELECTRON_RUN_AS_NODE: '1' } };
}

module.exports = { resolveClaude, resolveNode, launchSpec, shimTarget };
