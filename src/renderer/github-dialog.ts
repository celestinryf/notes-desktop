import { el, setLabel } from './dom.ts';
import { ipcErrorText } from './text.ts';

type Step = 'signed-out' | 'code' | 'repo';

interface GithubDialogDeps {
  api: NotesApi;
  updateSettings: (patch: SettingsPatch) => Promise<unknown>;
  afterRepoSet: () => Promise<unknown>;
}

const NEW_REPO = '';
const DEFAULT_NAME = 'notes';
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const INTRO = 'Notes keeps your notes in a private repository on your GitHub account. GitHub will ask you to approve Notes; it needs access to your private repositories to create and write one. Sign in once: Notes keeps the sign-in on this PC, protected by Windows.';
const CODE_HINT = 'Enter this code on github.com, then come back here. The code is copied for you when you open the page.';
const CANCELLED = 'The sign-in was cancelled.';

function minutesLeft(expiresAt: number) {
  return Math.max(1, Math.round((expiresAt - Date.now()) / 60000));
}

function settingsLabel(status: GithubStatus | null, remote: string) {
  if (!status || !status.signedIn) return 'Sign in with GitHub…';
  return remote ? 'Change repository…' : 'Choose a repository…';
}

export function createGithubDialog({ api, updateSettings, afterRepoSet }: GithubDialogDeps) {
  const gh: { status: GithubStatus | null, remote: string, step: Step, busy: boolean, code: { userCode: string, verificationUri: string } | null, opened: number } = { status: null, remote: '', step: 'signed-out', busy: false, code: null, opened: 0 };

  function show(step: Step) {
    gh.step = step;
    el.githubCode.classList.toggle('hidden', step !== 'code');
    el.githubWait.classList.toggle('hidden', step !== 'code');
    el.githubCopyBtn.classList.toggle('hidden', step !== 'code');
    el.githubRepoField.classList.toggle('hidden', step !== 'repo');
    el.githubSignOutBtn.classList.toggle('hidden', step !== 'repo');
    el.githubError.textContent = '';
    syncNameField();
  }

  function nameProblem() {
    const name = el.githubNameInput.value.trim();
    if (!name) return 'Give the repository a name.';
    if (!REPO_NAME.test(name) || name === '.' || name === '..') return 'A repository name uses letters, digits, dots, dashes and underscores.';
    return '';
  }

  function syncNameField() {
    const creating = gh.step === 'repo' && el.githubRepoSelect.value === NEW_REPO;
    el.githubNameField.classList.toggle('hidden', !creating);
    if (gh.step !== 'repo' || gh.busy) return;
    const problem = creating ? nameProblem() : '';
    el.githubError.textContent = problem;
    el.githubPrimaryBtn.disabled = !!problem;
    setLabel(el.githubPrimaryBtn, creating ? 'Create and sync' : 'Use this repository');
  }

  function setBusy(busy: boolean, label?: string) {
    gh.busy = busy;
    el.githubPrimaryBtn.disabled = busy;
    if (label) setLabel(el.githubPrimaryBtn, label);
  }

  function showSignedOut(error?: string) {
    show('signed-out');
    el.githubHint.textContent = INTRO;
    setLabel(el.githubPrimaryBtn, 'Sign in with GitHub');
    el.githubError.textContent = error || '';
  }

  function showCode(code: { userCode: string, verificationUri: string, expiresAt: number }) {
    gh.code = code;
    show('code');
    el.githubHint.textContent = CODE_HINT;
    el.githubCode.textContent = code.userCode;
    el.githubCode.setAttribute('aria-label', 'Code ' + code.userCode.split('').join(' '));
    el.githubWait.textContent = 'Waiting for github.com… the code expires in ' + minutesLeft(code.expiresAt) + ' min.';
    setLabel(el.githubPrimaryBtn, 'Open github.com');
  }

  async function showRepo() {
    show('repo');
    const login = gh.status && gh.status.login ? gh.status.login : 'GitHub';
    el.githubHint.textContent = 'Signed in as ' + login + '. Pick where the notes go.';
    el.githubRepoSelect.innerHTML = '';
    el.githubRepoSelect.append(new Option('New private repository', NEW_REPO));
    if (!el.githubNameInput.value.trim()) el.githubNameInput.value = DEFAULT_NAME;
    const loading = new Option('Loading your repositories…', '__loading');
    loading.disabled = true;
    el.githubRepoSelect.append(loading);
    syncNameField();
    const opened = gh.opened;
    let r: GithubReposResult;
    try { r = await api.github.repos(); } catch (err) { r = { ok: false, error: ipcErrorText(err) }; }
    if (opened !== gh.opened || gh.step !== 'repo') return;
    loading.remove();
    if (!r.ok) { el.githubError.textContent = r.error; if (!(await stillSignedIn())) showSignedOut(r.error); return; }
    for (const repo of r.repos) el.githubRepoSelect.append(new Option(repo.fullName, repo.cloneUrl));
    const made = r.repos.find((repo) => repo.fromNotes) || r.repos.find((repo) => repo.cloneUrl === gh.remote);
    if (made) el.githubRepoSelect.value = made.cloneUrl;
    if (r.repos.length) el.githubHint.textContent += ' Setting up another computer? Choose the repository you made before. Only private repositories are listed.';
    syncNameField();
  }

  async function stillSignedIn() {
    gh.status = await api.github.status();
    return gh.status.signedIn;
  }

  async function open() {
    gh.opened++;
    el.githubError.textContent = '';
    await stillSignedIn();
    if (!el.githubDialog.open) el.githubDialog.showModal();
    if (gh.status && gh.status.signedIn) await showRepo();
    else showSignedOut();
    el.githubPrimaryBtn.focus();
  }

  async function signIn() {
    setBusy(true, 'Signing in…');
    let r: GithubCodeResult;
    try { r = await api.github.signIn(); } catch (err) { r = { ok: false, error: ipcErrorText(err) }; }
    setBusy(false);
    if (!r.ok) { showSignedOut(r.error); return; }
    showCode(r);
    const opened = gh.opened;
    let done: GithubSignInResult;
    try { done = await api.github.waitSignIn(); } catch (err) { done = { ok: false, error: ipcErrorText(err) }; }
    if (opened !== gh.opened || !el.githubDialog.open) return;
    if (!done.ok) { showSignedOut(done.error === CANCELLED ? '' : done.error); return; }
    await stillSignedIn();
    await showRepo();
    el.githubRepoSelect.focus();
  }

  async function copyCode() {
    if (!gh.code) return;
    try { await navigator.clipboard.writeText(gh.code.userCode); } catch (_) {  }
  }

  async function openGithub() {
    if (!gh.code) return;
    await copyCode();
    api.app.openExternal(gh.code.verificationUri);
  }

  async function useRepo() {
    let url = el.githubRepoSelect.value;
    const creating = url === NEW_REPO;
    if (creating && nameProblem()) { syncNameField(); return; }
    setBusy(true, creating ? 'Creating…' : 'Connecting…');
    try {
      if (creating) {
        let r: GithubRepoResult;
        try { r = await api.github.createRepo(el.githubNameInput.value.trim()); } catch (err) { r = { ok: false, error: ipcErrorText(err) }; }
        if (!r.ok) { el.githubError.textContent = r.error; if (!(await stillSignedIn())) showSignedOut(r.error); return; }
        url = r.repo.cloneUrl;
      }
      await updateSettings({ gitEnabled: true, gitRemote: url });
    } catch (err) {
      el.githubError.textContent = 'Notes could not set the repository: ' + ipcErrorText(err);
      return;
    } finally {
      setBusy(false);
      if (gh.step === 'repo') syncNameField();
    }
    el.githubDialog.close();
    await afterRepoSet();
  }

  async function primary() {
    if (gh.busy) return;
    if (gh.step === 'signed-out') await signIn();
    else if (gh.step === 'code') await openGithub();
    else await useRepo();
  }

  async function signOut() {
    await api.github.signOut();
    await stillSignedIn();
    if (el.githubDialog.open) showSignedOut();
  }

  function renderSettings() {
    const s = gh.status;
    el.githubAccount.textContent = s && s.signedIn ? 'Signed in to GitHub as ' + s.login + '.' : 'Not signed in to GitHub.';
    setLabel(el.githubSettingsBtn, settingsLabel(s, gh.remote));
  }

  function renderStatus(s: GithubStatus) {
    gh.status = s;
    renderSettings();
    if (el.githubDialog.open && !s.signedIn && gh.step === 'repo') showSignedOut();
  }

  function remoteChanged(remote: string) {
    gh.remote = remote;
    renderSettings();
  }

  function close() {
    gh.opened++;
    if (gh.step === 'code') api.github.cancelSignIn();
    setBusy(false);
  }

  function bind() {
    el.githubForm.addEventListener('submit', (e) => { e.preventDefault(); primary(); });
    el.githubCloseBtn.addEventListener('click', () => el.githubDialog.close());
    el.githubCopyBtn.addEventListener('click', () => { copyCode(); });
    el.githubSignOutBtn.addEventListener('click', () => { signOut(); });
    el.githubRepoSelect.addEventListener('change', syncNameField);
    el.githubNameInput.addEventListener('input', syncNameField);
    el.githubDialog.addEventListener('close', close);
    el.githubSettingsBtn.addEventListener('click', () => { open(); });
  }

  return { bind, open, signOut, renderStatus, remoteChanged, statusNow: () => gh.status };
}
