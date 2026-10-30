import { GitHub, gitAuthEnv, isGitHubHttps } from './github.mts';
import type { DeviceCode, Repo, RepoResult, ReposResult } from './github.mts';
import { TokenStore } from './github-token.mts';
import type { SignIn } from './github-token.mts';

type DryMode = '' | 'code' | 'signed-in';
type Options = { store: TokenStore, github: GitHub, dry?: DryMode, onChange?: (s: GithubStatus) => void };
type Pending = { code: DeviceCode, cancelled: boolean, done: Promise<GithubSignInResult> };

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
  pending: Pending | null;

  constructor(opts: Options) {
    this.store = opts.store;
    this.github = opts.github;
    this.dry = opts.dry || '';
    this.onChange = opts.onChange || (() => {});
    this.signIn = this.dry === 'signed-in' ? { token: 'dry', login: 'you' } : this.dry ? null : this.store.read();
    this.pending = null;
  }

  status(): GithubStatus {
    return { signedIn: !!this.signIn, login: this.signIn ? this.signIn.login : null, canKeep: this.dry ? true : this.store.canKeep() };
  }

  token() {
    return this.signIn ? this.signIn.token : null;
  }

  authEnvFor(remoteUrl: string): Record<string, string> | undefined {
    return this.signIn && !this.dry && isGitHubHttps(remoteUrl) ? gitAuthEnv(this.signIn.token) : undefined;
  }

  async startSignIn(): Promise<GithubCodeResult> {
    if (!this.dry && !this.store.canKeep()) return { ok: false, error: 'Windows could not protect the sign-in on this PC, so Notes did not keep it.' };
    this.cancelSignIn();
    let code: DeviceCode;
    if (this.dry) code = dryCode();
    else {
      const r = await this.github.requestCode();
      if (!r.ok) return r;
      code = r.code;
    }
    const pending: Pending = { code, cancelled: false, done: Promise.resolve({ ok: false, error: 'The sign-in was cancelled.' }) };
    pending.done = this._finish(pending);
    this.pending = pending;
    return { ok: true, userCode: code.userCode, verificationUri: code.verificationUri, expiresAt: code.expiresAt };
  }

  async _finish(pending: Pending): Promise<GithubSignInResult> {
    const outcome = this.dry ? await new Promise<{ ok: false, error: string }>((resolve) => { const tick = () => { if (pending.cancelled) resolve({ ok: false, error: 'The sign-in was cancelled.' }); else setTimeout(tick, 200); }; tick(); }) : await this.github.waitForToken(pending.code, () => pending.cancelled);
    if (this.pending === pending) this.pending = null;
    if (!outcome.ok) return outcome;
    const signIn = { token: outcome.token, login: outcome.login };
    const kept = this.store.write(signIn);
    if (!kept.ok) return kept;
    this.signIn = signIn;
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
    if (!this.dry) this.store.clear();
    this.signIn = null;
    this.onChange(this.status());
  }

  async repos(): Promise<ReposResult> {
    if (!this.signIn) return { ok: false, error: 'Sign in with GitHub first.' };
    if (this.dry) return { ok: true, repos: DRY_REPOS.slice() };
    const r = await this.github.privateRepos(this.signIn.token);
    if (!r.ok && /no longer accepts/.test(r.error)) this.signOut();
    return r;
  }

  async createRepo(name: string): Promise<RepoResult> {
    if (!this.signIn) return { ok: false, error: 'Sign in with GitHub first.' };
    if (this.dry) return { ok: true, repo: { name, fullName: 'you/' + name, cloneUrl: 'https://github.com/you/' + name + '.git', fromNotes: true } };
    const r = await this.github.createPrivateRepo(this.signIn.token, name);
    if (!r.ok && /no longer accepts/.test(r.error)) this.signOut();
    return r;
  }
}

export type { DryMode, Options };
export { GitHubSession };
