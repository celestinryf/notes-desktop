import { GitHub, gitAuthEnv } from './github.mts';
import type { DeviceCode, Repo, RepoResult, ReposResult } from './github.mts';
import { TokenStore, CANNOT_KEEP } from './github-token.mts';
import type { SignIn } from './github-token.mts';
import { GITHUB_CANCELLED, isGitHubHttps } from './shared/helpers.mts';

type DryMode = '' | 'code' | 'signed-in';
type Options = { store: TokenStore, github: GitHub, dry?: DryMode, onChange?: (s: GithubStatus) => void };
type Pending = { code: DeviceCode, cancelled: boolean, done: Promise<GithubSignInResult> };

const CANCELLED: GithubSignInResult = { ok: false, error: GITHUB_CANCELLED };
const dryCode = (): DeviceCode => ({ deviceCode: 'dry', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresAt: Date.now() + 15 * 60000, intervalMs: 5000 });
const DRY_REPOS: Repo[] = [
  { name: 'notes', fullName: 'you/notes', cloneUrl: 'https://github.com/you/notes.git', fromNotes: true },
  { name: 'journal', fullName: 'you/journal', cloneUrl: 'https://github.com/you/journal.git', fromNotes: false },
];

class GitHubSession {
  store: TokenStore;
  github: GitHub;
  dry: DryMode;
  onChange: (s: GithubStatus) => void;
  signIn: SignIn | null;
  loaded: boolean;
  pending: Pending | null;
  generation: number;

  constructor(opts: Options) {
    this.store = opts.store;
    this.github = opts.github;
    this.dry = opts.dry || '';
    this.onChange = opts.onChange || (() => {});
    this.signIn = this.dry === 'signed-in' ? { token: 'dry', login: 'you' } : null;
    this.loaded = !!this.dry;
    this.pending = null;
    this.generation = 0;
  }

  _current(): SignIn | null {
    if (!this.loaded) { this.signIn = this.store.read(); this.loaded = true; }
    return this.signIn;
  }

  status(): GithubStatus {
    const signIn = this._current();
    return { signedIn: !!signIn, login: signIn ? signIn.login : null, canKeep: this.dry ? true : this.store.canKeep() };
  }

  token() {
    const signIn = this._current();
    return signIn ? signIn.token : null;
  }

  authEnvFor(remoteUrl: string): Record<string, string> | undefined {
    const signIn = this._current();
    return signIn && !this.dry && isGitHubHttps(remoteUrl) ? gitAuthEnv(signIn.token) : undefined;
  }

  async startSignIn(): Promise<GithubCodeResult> {
    if (!this.dry && !this.store.canKeep()) return { ok: false, error: CANNOT_KEEP };
    this.cancelSignIn();
    const generation = ++this.generation;
    let code: DeviceCode;
    if (this.dry) code = dryCode();
    else {
      const r = await this.github.requestCode();
      if (!r.ok) return r;
      code = r.code;
    }
    if (generation !== this.generation) return { ok: false, error: GITHUB_CANCELLED };
    const pending: Pending = { code, cancelled: false, done: Promise.resolve(CANCELLED) };
    pending.done = this._finish(pending);
    this.pending = pending;
    return { ok: true, userCode: code.userCode, verificationUri: code.verificationUri, expiresAt: code.expiresAt };
  }

  _waitDry(pending: Pending): Promise<{ ok: false, error: string }> {
    return new Promise((resolve) => { const tick = () => { if (pending.cancelled) resolve({ ok: false, error: GITHUB_CANCELLED }); else setTimeout(tick, 200); }; tick(); });
  }

  async _finish(pending: Pending): Promise<GithubSignInResult> {
    const outcome = this.dry ? await this._waitDry(pending) : await this.github.waitForToken(pending.code, () => pending.cancelled);
    if (this.pending === pending) this.pending = null;
    if (pending.cancelled) return CANCELLED;
    if (!outcome.ok) return outcome;
    const signIn = { token: outcome.token, login: outcome.login };
    const kept = this.store.write(signIn);
    if (!kept.ok) return kept;
    this.signIn = signIn;
    this.loaded = true;
    this.onChange(this.status());
    return { ok: true, login: signIn.login };
  }

  waitSignIn(): Promise<GithubSignInResult> {
    return this.pending ? this.pending.done : Promise.resolve({ ok: false, error: 'No sign-in is waiting.' });
  }

  cancelSignIn() {
    if (this.pending) { this.pending.cancelled = true; this.pending = null; }
  }

  signOut() {
    this.cancelSignIn();
    this.generation++;
    if (!this.dry) this.store.clear();
    this.signIn = null;
    this.loaded = true;
    this.onChange(this.status());
  }

  async repos(): Promise<ReposResult> {
    const signIn = this._current();
    if (!signIn) return { ok: false, error: 'Sign in with GitHub first.' };
    if (this.dry) return { ok: true, repos: DRY_REPOS.slice() };
    const r = await this.github.privateRepos(signIn.token);
    if (!r.ok && r.rejected) this.signOut();
    return r;
  }

  async createRepo(name: string): Promise<RepoResult> {
    const signIn = this._current();
    if (!signIn) return { ok: false, error: 'Sign in with GitHub first.' };
    if (this.dry) return { ok: true, repo: { name, fullName: 'you/' + name, cloneUrl: 'https://github.com/you/' + name + '.git', fromNotes: true } };
    const r = await this.github.createPrivateRepo(signIn.token, name);
    if (!r.ok && r.rejected) this.signOut();
    return r;
  }
}

export type { DryMode, Options };
export { GitHubSession };
