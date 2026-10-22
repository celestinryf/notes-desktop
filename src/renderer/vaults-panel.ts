import { el } from './dom.ts';
import { state } from './state.ts';
import * as H from '../shared/helpers.mts';
import { toast } from './toast.ts';

interface VaultsPanelDeps {
  api: NotesApi;
  refresh: (opts: { keepEditor: boolean }) => Promise<unknown>;
  flushSave: () => Promise<boolean>;
  setView: (view: RendererState['view'], arg?: string | null) => Promise<unknown>;
  leaveSettings: () => Promise<unknown>;
  setExpanded: (id: string | null, open: boolean) => Promise<unknown>;
}

export function createVaultsPanel({ api, refresh, flushSave, setView, leaveSettings, setExpanded }: VaultsPanelDeps) {
  async function syncVault(id: string) {
    toast('Syncing vault…');
    const r = await api.vaults.sync(id);
    if (r.ok) toast('Vault synced.');
    else if (r.skipped) toast('This vault is a plain folder (' + r.skipped + '). Add a remote in Settings to sync it.');
    else toast('Vault sync failed: ' + r.error);
    await refresh({ keepEditor: true });
    renderVaultList();
  }

  async function removeVault(id: string) {
    if (!window.confirm('Remove this vault from Notes? The folder and its files stay on disk untouched.')) return;
    await flushSave();
    await api.vaults.remove(id);
    if (state.view === 'folder') await setView('all'); else await refresh({ keepEditor: true });
    renderVaultList();
    toast('Vault removed. Files kept.');
  }

  async function addVaultFolder() {
    const dir = await api.vaults.pickFolder();
    if (!dir) return;
    try {
      const v = await api.vaults.add({ path: dir });
      await leaveSettings();
      await setView('folder', v.rootFolderId);
      await setExpanded(v.rootFolderId, true);
      toast('Vault "' + v.name + '" added' + (v.status.isRepo ? ' (git repository' + (v.status.remote ? ', syncing with ' + v.status.remote : ', no remote') + ')' : ''));
    } catch (err) {
      toast('Could not add vault: ' + (err.message || err));
    }
  }

  function openCloneDialog() {
    el.vaultUrlInput.value = '';
    el.vaultNameInput.value = '';
    el.vaultError.textContent = '';
    if (!el.vaultDestInput.value && state.info && state.info.documentsDir) el.vaultDestInput.value = state.info.documentsDir;
    el.vaultDialog.showModal();
    el.vaultUrlInput.focus();
  }

  async function submitClone() {
    const url = el.vaultUrlInput.value.trim();
    const dest = el.vaultDestInput.value.trim();
    if (!url) { el.vaultError.textContent = 'Enter a repository URL.'; return; }
    if (!dest) { el.vaultError.textContent = 'Choose where to clone.'; return; }
    el.vaultCloneSubmitBtn.disabled = true;
    el.vaultError.textContent = 'Cloning…';
    try {
      const r = await api.vaults.clone(url, dest, el.vaultNameInput.value.trim());
      if (!r.ok) { el.vaultError.textContent = r.error; return; }
      el.vaultDialog.close();
      await leaveSettings();
      await setView('folder', r.vault.rootFolderId);
      await setExpanded(r.vault.rootFolderId, true);
      toast('Cloned "' + r.vault.name + '". Changes will sync automatically.');
    } catch (err) {
      el.vaultError.textContent = String(err.message || err);
    } finally {
      el.vaultCloneSubmitBtn.disabled = false;
    }
  }

  async function renderVaultList() {
    if (!el.settingsDialog.open) return;
    let list;
    try { list = await api.vaults.list(); } catch (_) { return; }
    el.vaultList.innerHTML = '';
    if (!list.length) {
      const d = document.createElement('div');
      d.className = 'vault-empty';
      d.textContent = 'No vaults yet. Add a folder of Markdown files, or clone a repository.';
      el.vaultList.append(d);
      return;
    }
    for (const v of list) {
      state.vaultStatus[v.id] = v.status;
      const item = document.createElement('div');
      item.className = 'vault-item';
      item.dataset.id = v.id;
      const head = document.createElement('div');
      head.className = 'vault-head';
      const name = document.createElement('span');
      name.textContent = v.name;
      const where = document.createElement('span');
      where.className = 'vault-path';
      where.textContent = v.path;
      where.title = v.path;
      head.append(name, where);
      item.append(head);
      const st = document.createElement('div');
      st.className = 'vault-status' + (v.status.lastError || v.status.conflict ? ' is-error' : '');
      st.textContent = describeVaultStatus(v);
      item.append(st);
      const actions = document.createElement('div');
      actions.className = 'vault-actions';
      const remote = document.createElement('input');
      remote.className = 'input';
      remote.placeholder = v.status.isRepo ? 'Remote URL (origin)' : 'Add a remote URL to turn this folder into a synced repo';
      remote.value = v.remote || v.status.remote || '';
      remote.addEventListener('change', async () => { const r = await api.vaults.update(v.id, { remote: remote.value.trim() }); if (r && 'ok' in r && r.ok === false) toast(r.error); renderVaultList(); });
      actions.append(remote);
      const mk = (label: string, fn: () => unknown, cls?: string) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-small' + (cls ? ' ' + cls : ''); b.textContent = label; b.addEventListener('click', fn); actions.append(b); };
      mk('Sync now', () => syncVault(v.id));
      mk('Rescan', async () => { const r = await api.vaults.scan(v.id); if (!r) return; toast('Rescanned: +' + r.added + ' changed ' + r.updated + ' removed ' + r.removed); await refresh({ keepEditor: true }); });
      mk('Open folder', () => api.vaults.openFolder(v.id));
      const auto = document.createElement('label');
      auto.className = 'field-check';
      const autoBox = document.createElement('input');
      autoBox.type = 'checkbox';
      autoBox.checked = v.autoSync;
      autoBox.addEventListener('change', async () => { await api.vaults.update(v.id, { autoSync: autoBox.checked }); renderVaultList(); });
      const autoLabel = document.createElement('span');
      autoLabel.textContent = 'Auto-sync';
      auto.append(autoBox, autoLabel);
      actions.append(auto);
      mk('Remove', () => removeVault(v.id), 'btn-danger');
      item.append(actions);
      el.vaultList.append(item);
    }
  }

  function describeVaultStatus(v: { status: VaultStatus }) {
    const s = v.status || {};
    if (!s.isRepo) return 'Plain folder: notes mirror the files, no git. Add a remote URL to start syncing.';
    const parts = ['git on ' + (s.branch || '?')];
    if (s.remote) parts.push(s.ahead || s.behind ? (s.ahead + ' ahead, ' + s.behind + ' behind') : 'in sync with remote');
    else parts.push('no remote (local history only)');
    if (s.dirty) parts.push('uncommitted changes');
    if (s.syncing) parts.push('syncing…');
    if (s.lastSyncAt) parts.push('last sync ' + H.relativeTime(s.lastSyncAt));
    if (s.conflict) parts.push('CONFLICT: resolve in the folder');
    if (s.lastError) parts.push('error: ' + s.lastError);
    return parts.join(' · ');
  }

  return { syncVault, removeVault, addVaultFolder, openCloneDialog, submitClone, renderVaultList, describeVaultStatus };
}
