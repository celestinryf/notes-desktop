/* Finds the Claude Code executable without going through a shell. npm installs `claude` on Windows as a
   .cmd shim that only cmd.exe can run; spawning through cmd.exe would mean quoting the prompt for cmd,
   which cannot be done safely (newlines, %VAR%, &, |). So the shim is read and the real target is launched. */
import fs from 'node:fs';
import path from 'node:path';

const NAMES = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];

function exists(p) {
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

// Reads an npm .cmd/.sh shim and returns the file it ultimately runs, or null.
function shimTarget(shimPath) {
  let text;
  try { text = fs.readFileSync(shimPath, 'utf8'); } catch (_) { return null; }
  const dir = path.dirname(shimPath);
  // The extension must end the token: `foo.json"` is not `foo.js`.
  const re = /"?((?:%~?dp0%?|\$basedir)[^"\r\n]*?\.(?:exe|js|cjs|mjs))(?=["\s)]|$)/gi;
  let m;
  while ((m = re.exec(text))) {
    const rel = m[1].replace(/^%~?dp0%?[\\/]?/i, '').replace(/^\$basedir[\\/]?/i, '');
    const full = path.resolve(dir, rel);
    // nvm-style shims mention a sibling node.exe before the script they run; node is the runner, not the target.
    if (/^node(\.exe)?$/i.test(path.basename(full))) continue;
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

// The first of names found on the search path, as a launch spec { file, isScript }, or null. opts.override names
// one file instead (a .js stand-in, an .exe, or a shim); opts.pathDirs the directories to search (default: PATH).
function resolveExecutable(names, opts?) {
  opts = opts || {};
  if (opts.override) return specFor(path.resolve(opts.override));
  const dirs = (opts.pathDirs || (process.env.PATH || '').split(path.delimiter)).filter(Boolean);
  for (const d of dirs) {
    for (const n of names) {
      const spec = specFor(path.join(d, n));
      if (spec) return spec;
    }
  }
  return null;
}

// opts.override: NOTES_APP_CLAUDE_BIN. opts.pathDirs: directories to search (defaults to PATH plus the native
// installer's ~/.local/bin). Returns { file, isScript } or null.
function resolveClaude(opts) {
  opts = opts || {};
  if (opts.override) return resolveExecutable(NAMES, { override: opts.override });
  const dirs = (opts.pathDirs || (process.env.PATH || '').split(path.delimiter)).filter(Boolean);
  const home = opts.home || process.env.USERPROFILE || process.env.HOME || '';
  if (home) dirs.push(path.join(home, '.local', 'bin'));
  return resolveExecutable(NAMES, { pathDirs: dirs });
}

// Finds a plain Node binary for running a .js target; null means use the host with ELECTRON_RUN_AS_NODE.
function resolveNode(pathDirs?) {
  const dirs = (pathDirs || (process.env.PATH || '').split(path.delimiter)).filter(Boolean);
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const d of dirs) { const p = path.join(d, name); if (exists(p)) return p; }
  return null;
}

// Builds the spawn call: [file, args, extraEnv] for child_process.spawn with shell: false.
function launchSpec(spec, args, opts?) {
  opts = opts || {};
  if (!spec.isScript) return { file: spec.file, args: args.slice(), env: {} };
  const node = opts.node === undefined ? resolveNode(opts.pathDirs) : opts.node;
  if (node) return { file: node, args: [spec.file].concat(args), env: {} };
  return { file: process.execPath, args: [spec.file].concat(args), env: { ELECTRON_RUN_AS_NODE: '1' } };
}

// Variables that make Claude Code bill an API account (pay per token) instead of the user's Claude
// subscription: an API key or bearer token for the Anthropic API, or routing to Bedrock, Vertex or Foundry.
// With none of them set, Claude Code uses the claude.ai login. CLAUDE_CODE_OAUTH_TOKEN is a subscription
// token and stays.
const API_BILLING_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];

function subscriptionEnv(env) {
  const out = Object.assign({}, env);
  for (const k of Object.keys(out)) if (API_BILLING_VARS.includes(k.toUpperCase())) delete out[k];
  return out;
}

// Reads the JSON printed by `claude auth status` and decides whether runs will use the Claude subscription.
// Returns { ok: true, plan } or { ok: false, reason }.
function checkSubscriptionAuth(text) {
  let s;
  try { s = JSON.parse(String(text || '').trim()); } catch (_) { return { ok: false, reason: 'Claude Code did not report how it is signed in. Update it (claude update) and try again.' }; }
  if (!s || typeof s !== 'object') return { ok: false, reason: 'Claude Code did not report how it is signed in.' };
  if (!s.loggedIn) return { ok: false, reason: 'Claude Code is not signed in. Open a terminal, run claude, and sign in with your Claude account.' };
  if (s.authMethod !== 'claude.ai') return { ok: false, reason: 'Claude Code is signed in with ' + (s.authMethod || 'an API key') + ', which bills API credits. Run claude, then /login with your Claude account.' };
  if (s.apiProvider && s.apiProvider !== 'firstParty') return { ok: false, reason: 'Claude Code is set to use ' + s.apiProvider + ', which bills that provider. Remove that setting to use your Claude subscription.' };
  return { ok: true, plan: typeof s.subscriptionType === 'string' && s.subscriptionType ? s.subscriptionType : null };
}

export { resolveExecutable, resolveClaude, resolveNode, launchSpec, shimTarget, subscriptionEnv, checkSubscriptionAuth, API_BILLING_VARS };
