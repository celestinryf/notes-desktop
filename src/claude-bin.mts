import fs from 'node:fs';
import path from 'node:path';

const NAMES = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];

function exists(p: string) {
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

function shimTarget(shimPath: string) {
  let text;
  try { text = fs.readFileSync(shimPath, 'utf8'); } catch (_) { return null; }
  const dir = path.dirname(shimPath);
  const re = /"?((?:%~?dp0%?|\$basedir)[^"\r\n]*?\.(?:exe|js|cjs|mjs))(?=["\s)]|$)/gi;
  let m;
  while ((m = re.exec(text))) {
    const rel = m[1].replace(/^%~?dp0%?[\\/]?/i, '').replace(/^\$basedir[\\/]?/i, '');
    const full = path.resolve(dir, rel);
    if (/^node(\.exe)?$/i.test(path.basename(full))) continue;
    if (exists(full)) return full;
  }
  return null;
}

function specFor(p: string | null) {
  if (!p || !exists(p)) return null;
  if (/\.(js|cjs|mjs)$/i.test(p)) return { file: p, isScript: true };
  if (/\.exe$/i.test(p) || process.platform !== 'win32' && !/\.(cmd|bat)$/i.test(p)) {
    if (process.platform !== 'win32') { const t = shimTarget(p); if (t) return specFor(t); }
    return { file: p, isScript: false };
  }
  if (/\.(cmd|bat)$/i.test(p)) return specFor(shimTarget(p));
  return null;
}

function resolveExecutable(names: string[], opts?: { override?: string, pathDirs?: string[] }) {
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

function resolveClaude(opts?: { override?: string | null, pathDirs?: string[], home?: string }) {
  opts = opts || {};
  if (opts.override) return resolveExecutable(NAMES, { override: opts.override });
  const dirs = (opts.pathDirs || (process.env.PATH || '').split(path.delimiter)).filter(Boolean);
  const home = opts.home || process.env.USERPROFILE || process.env.HOME || '';
  if (home) dirs.push(path.join(home, '.local', 'bin'));
  return resolveExecutable(NAMES, { pathDirs: dirs });
}

function resolveNode(pathDirs?: string[]) {
  const dirs = (pathDirs || (process.env.PATH || '').split(path.delimiter)).filter(Boolean);
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const d of dirs) { const p = path.join(d, name); if (exists(p)) return p; }
  return null;
}

function launchSpec(spec: { file: string, isScript: boolean }, args: string[], opts?: { node?: string | null, pathDirs?: string[] }) {
  opts = opts || {};
  if (!spec.isScript) return { file: spec.file, args: args.slice(), env: {} };
  const node = opts.node === undefined ? resolveNode(opts.pathDirs) : opts.node;
  if (node) return { file: node, args: [spec.file].concat(args), env: {} };
  return { file: process.execPath, args: [spec.file].concat(args), env: { ELECTRON_RUN_AS_NODE: '1' } };
}

const API_BILLING_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];

function subscriptionEnv(env: NodeJS.ProcessEnv) {
  const out = Object.assign({}, env);
  for (const k of Object.keys(out)) if (API_BILLING_VARS.includes(k.toUpperCase())) delete out[k];
  return out;
}

function checkSubscriptionAuth(text: unknown) {
  let s;
  try { s = JSON.parse(String(text || '').trim()); } catch (_) { return { ok: false, reason: 'Claude Code did not report how it is signed in. Update it (claude update) and try again.' }; }
  if (!s || typeof s !== 'object') return { ok: false, reason: 'Claude Code did not report how it is signed in.' };
  if (!s.loggedIn) return { ok: false, reason: 'Claude Code is not signed in. Open a terminal, run claude, and sign in with your Claude account.' };
  if (s.authMethod !== 'claude.ai') return { ok: false, reason: 'Claude Code is signed in with ' + (s.authMethod || 'an API key') + ', which bills API credits. Run claude, then /login with your Claude account.' };
  if (s.apiProvider && s.apiProvider !== 'firstParty') return { ok: false, reason: 'Claude Code is set to use ' + s.apiProvider + ', which bills that provider. Remove that setting to use your Claude subscription.' };
  return { ok: true, plan: typeof s.subscriptionType === 'string' && s.subscriptionType ? s.subscriptionType : null };
}

export { resolveExecutable, resolveClaude, resolveNode, launchSpec, shimTarget, subscriptionEnv, checkSubscriptionAuth, API_BILLING_VARS };
