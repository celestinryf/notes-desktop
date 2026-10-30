import { isRecord } from './shared/helpers.mts';

const DEFAULT_CLIENT_ID = 'Ov23linEmloxI2IlHYcD';
const SCOPE = 'repo';
const MAX_INTERVAL_MS = 60000;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const MADE_BY_NOTES = 'Notes, synced by the Notes app';

type DeviceCode = { deviceCode: string, userCode: string, verificationUri: string, expiresAt: number, intervalMs: number };
type CodeResult = { ok: true, code: DeviceCode } | { ok: false, error: string };
type SignInOutcome = { ok: true, token: string, login: string } | { ok: false, error: string };
type LoginResult = { ok: true, login: string } | { ok: false, error: string };
type Repo = GithubRepo;
type RepoResult = GithubRepoResult;
type ReposResult = GithubReposResult;
type Response = { status: number, text: () => Promise<string> };
type FetchLike = (url: string, init: { method: string, headers: Record<string, string>, body?: string }) => Promise<Response>;
type Hooks = { fetch?: FetchLike, sleep?: (ms: number) => Promise<void>, now?: () => number, clientId?: string, webBase?: string, apiBase?: string };

const UNREACHABLE = 'Notes could not reach GitHub. Check the connection and try again.';
const EXPIRED = 'The code expired before it was entered. Try again for a new code.';
const DENIED = 'The sign-in was cancelled on github.com. Nothing changed.';
const REJECTED = 'GitHub no longer accepts this sign-in. Sign in again.';

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function str(r: Record<string, unknown>, key: string) {
  const v = r[key];
  return typeof v === 'string' ? v : '';
}

function num(r: Record<string, unknown>, key: string) {
  const v = r[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function parseJson(text: string): Record<string, unknown> | null {
  try { const v: unknown = JSON.parse(text); return isRecord(v) ? v : null; } catch (_) { return null; }
}

function parseRepo(v: unknown): Repo | null {
  if (!isRecord(v)) return null;
  const name = str(v, 'name'), fullName = str(v, 'full_name'), cloneUrl = str(v, 'clone_url');
  return name && fullName && cloneUrl ? { name, fullName, cloneUrl, fromNotes: str(v, 'description') === MADE_BY_NOTES } : null;
}

function apiMessage(body: Record<string, unknown> | null, fallback: string) {
  const message = body ? str(body, 'message') : '';
  return message ? 'GitHub said: ' + message : fallback;
}

function isGitHubHttps(url: string) {
  return /^https:\/\/github\.com\//i.test(url.trim());
}

function gitAuthEnv(token: string): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: 'Authorization: Basic ' + Buffer.from('x-access-token:' + token, 'utf8').toString('base64'),
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function validRepoName(name: string) {
  return REPO_NAME.test(name) && name !== '.' && name !== '..';
}

class GitHub {
  fetch: FetchLike;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  clientId: string;
  webBase: string;
  apiBase: string;

  constructor(hooks?: Hooks) {
    hooks = hooks || {};
    this.fetch = hooks.fetch || ((url, init) => fetch(url, init));
    this.sleep = hooks.sleep || pause;
    this.now = hooks.now || Date.now;
    this.clientId = hooks.clientId || process.env.NOTES_APP_GITHUB_CLIENT_ID || DEFAULT_CLIENT_ID;
    this.webBase = (hooks.webBase || process.env.NOTES_APP_GITHUB_WEB || 'https://github.com').replace(/\/+$/, '');
    this.apiBase = (hooks.apiBase || process.env.NOTES_APP_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
  }

  async _post(url: string, form: Record<string, string>): Promise<{ status: number, body: Record<string, unknown> | null } | null> {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
    try {
      const r = await this.fetch(url, { method: 'POST', headers, body: new URLSearchParams(form).toString() });
      return { status: r.status, body: parseJson(await r.text()) };
    } catch (_) { return null; }
  }

  async _api(token: string, method: string, path: string, body?: unknown): Promise<{ status: number, text: string } | null> {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'notes-desktop' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const r = await this.fetch(this.apiBase + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, text: await r.text() };
    } catch (_) { return null; }
  }

  async requestCode(): Promise<CodeResult> {
    const r = await this._post(this.webBase + '/login/device/code', { client_id: this.clientId, scope: SCOPE });
    if (!r) return { ok: false, error: UNREACHABLE };
    const b = r.body;
    if (r.status !== 200 || !b) return { ok: false, error: apiMessage(b, 'GitHub did not give a sign-in code (' + r.status + ').') };
    const deviceCode = str(b, 'device_code'), userCode = str(b, 'user_code'), verificationUri = str(b, 'verification_uri');
    const expiresIn = num(b, 'expires_in'), interval = num(b, 'interval');
    if (!deviceCode || !userCode || !verificationUri || expiresIn <= 0) return { ok: false, error: 'GitHub gave an incomplete sign-in code.' };
    return { ok: true, code: { deviceCode, userCode, verificationUri, expiresAt: this.now() + expiresIn * 1000, intervalMs: Math.max(1, interval || 5) * 1000 } };
  }

  async waitForToken(code: DeviceCode, cancelled: () => boolean): Promise<SignInOutcome> {
    let intervalMs = code.intervalMs;
    while (!cancelled()) {
      if (this.now() >= code.expiresAt) return { ok: false, error: EXPIRED };
      await this.sleep(intervalMs);
      if (cancelled()) break;
      const r = await this._post(this.webBase + '/login/oauth/access_token', { client_id: this.clientId, device_code: code.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
      if (!r) return { ok: false, error: UNREACHABLE };
      const b = r.body;
      if (!b) return { ok: false, error: 'GitHub gave an unreadable answer (' + r.status + ').' };
      const token = str(b, 'access_token');
      if (token) {
        const who = await this.whoAmI(token);
        return who.ok ? { ok: true, token, login: who.login } : who;
      }
      const error = str(b, 'error');
      if (error === 'authorization_pending') continue;
      if (error === 'slow_down') { intervalMs = Math.min(MAX_INTERVAL_MS, intervalMs + 5000); continue; }
      if (error === 'expired_token') return { ok: false, error: EXPIRED };
      if (error === 'access_denied') return { ok: false, error: DENIED };
      return { ok: false, error: apiMessage(b, 'GitHub refused the sign-in (' + (error || r.status) + ').') };
    }
    return { ok: false, error: 'The sign-in was cancelled.' };
  }

  async whoAmI(token: string): Promise<LoginResult> {
    const r = await this._api(token, 'GET', '/user');
    if (!r) return { ok: false, error: UNREACHABLE };
    const b = parseJson(r.text);
    if (r.status === 401) return { ok: false, error: REJECTED };
    const login = b ? str(b, 'login') : '';
    if (r.status !== 200 || !login) return { ok: false, error: apiMessage(b, 'GitHub did not say who signed in (' + r.status + ').') };
    return { ok: true, login };
  }

  async privateRepos(token: string): Promise<ReposResult> {
    const repos: Repo[] = [];
    for (let page = 1; page <= 5; page++) {
      const r = await this._api(token, 'GET', '/user/repos?affiliation=owner&visibility=private&sort=pushed&per_page=100&page=' + page);
      if (!r) return { ok: false, error: UNREACHABLE };
      if (r.status === 401) return { ok: false, error: REJECTED };
      let list: unknown;
      try { list = JSON.parse(r.text); } catch (_) { list = null; }
      if (r.status !== 200 || !Array.isArray(list)) return { ok: false, error: apiMessage(parseJson(r.text), 'GitHub did not list the repositories (' + r.status + ').') };
      for (const item of list) { const repo = parseRepo(item); if (repo) repos.push(repo); }
      if (list.length < 100) break;
    }
    return { ok: true, repos };
  }

  async createPrivateRepo(token: string, name: string): Promise<RepoResult> {
    if (!validRepoName(name)) return { ok: false, error: 'A repository name uses letters, digits, dots, dashes and underscores.' };
    const r = await this._api(token, 'POST', '/user/repos', { name, private: true, auto_init: false, description: MADE_BY_NOTES });
    if (!r) return { ok: false, error: UNREACHABLE };
    if (r.status === 401) return { ok: false, error: REJECTED };
    const body = parseJson(r.text);
    if (r.status === 422 && /already exists/i.test(r.text)) return { ok: false, error: 'You already have a repository called ' + name + '. Pick it from the list or choose another name.' };
    const repo = r.status === 201 ? parseRepo(body) : null;
    if (!repo) return { ok: false, error: apiMessage(body, 'GitHub did not create the repository (' + r.status + ').') };
    return { ok: true, repo };
  }
}

export type { DeviceCode, CodeResult, SignInOutcome, LoginResult, Repo, RepoResult, ReposResult, FetchLike, Hooks };
export { GitHub, gitAuthEnv, isGitHubHttps, validRepoName, DEFAULT_CLIENT_ID };
