import { el } from './dom.ts';
import { state } from './state.ts';
import { toast } from './toast.ts';

interface BotPanelDeps {
  api: NotesApi;
  flushSave: () => Promise<boolean>;
  refresh: (opts: { keepEditor: boolean }) => Promise<unknown>;
  applyFreshFileBody: (fresh: PublicNote) => void;
}

export function createBotPanel({ api, flushSave, refresh, applyFreshFileBody }: BotPanelDeps) {
  const bot = { open: false, running: false };

  function toggleBot(force?: boolean) {
    bot.open = typeof force === 'boolean' ? force : !bot.open;
    el.botPanel.classList.toggle('hidden', !bot.open);
    el.botBtn.classList.toggle('is-on', bot.open);
    if (bot.open) { describeBotScope(); el.botPrompt.focus(); }
  }

  function describeBotScope() {
    const n = state.current;
    let text = 'Scope: all plain notes (exported to a workspace folder for the run)';
    if (n && n.vaultId) text = 'Scope: this note’s vault folder';
    else if (n && n.filePath) text = 'Scope: the folder containing this file';
    el.botScope.textContent = text;
    el.botScope.title = text;
  }

  function botAppend(text: string, cls?: string) {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    el.botOutput.append(span);
    el.botOutput.scrollTop = el.botOutput.scrollHeight;
  }

  async function runBot() {
    if (bot.running) { await api.bot.cancel(); return; }
    const prompt = el.botPrompt.value.trim();
    await flushSave();
    el.botOutput.textContent = '';
    if (!prompt) {
      // Empty prompt: pull in whatever a terminal session changed in the workspace.
      const r = await api.bot.importWorkspace();
      botAppend(!('updated' in r) || r.error ? ('Import failed: ' + r.error + '\n') : ('Pulled in workspace edits. ' + importSummary(r) + '\n' + (r.details || []).map((d) => '  ' + d).join('\n') + (r.details && r.details.length ? '\n' : '')), r.error ? 'bot-err' : 'bot-meta');
      await refresh({ keepEditor: true });
      el.botPrompt.focus();
      return;
    }
    const res = await api.bot.run({ prompt, noteId: state.currentId, allowEdits: el.botAllowEdits.checked });
    if (!res.ok) { botAppend(res.error + '\n', 'bot-err'); return; }
  }

  function onBotEvent(ev: BotEvent) {
    if (ev.type === 'start') {
      bot.running = true;
      el.botPanel.classList.add('is-running');
      el.botRunBtn.textContent = 'Stop';
      botAppend('Claude Code, on your Claude ' + (ev.plan ? ev.plan.charAt(0).toUpperCase() + ev.plan.slice(1) + ' ' : '') + 'subscription (no API credits)\n', 'bot-meta');
      botAppend('Working in ' + ev.cwd + (ev.focus ? '  (looking at ' + ev.focus + ')' : '') + '\n', 'bot-meta');
      if (ev.imported && 'updated' in ev.imported && (ev.imported.updated || ev.imported.created || ev.imported.conflicts)) botAppend('Pulled in earlier workspace edits first. ' + importSummary(ev.imported) + '\n', 'bot-meta');
    } else if (ev.type === 'out') {
      botAppend(ev.text);
    } else if (ev.type === 'err') {
      botAppend(ev.text, 'bot-err');
    } else if (ev.type === 'end') {
      bot.running = false;
      el.botPanel.classList.remove('is-running');
      el.botRunBtn.textContent = 'Run';
      if (ev.error) botAppend('\n' + ev.error + '\n', 'bot-err');
      else {
        const imp = ev.imported;
        const summary = imp && 'updated' in imp && !imp.error ? ' ' + importSummary(imp) : '';
        botAppend('\nDone' + (ev.code === 0 ? '' : ' (exit code ' + ev.code + ')') + '.' + summary + '\n', 'bot-meta');
        if (imp && 'conflicts' in imp && imp.conflicts) botAppend((imp.details || []).filter((d) => d.startsWith('conflict')).map((d) => '  ' + d).join('\n') + '\n', 'bot-err');
      }
      refresh({ keepEditor: true }).then(async () => {
        // Reload the open note from the store in case the agent edited it.
        if (state.currentId && !state.dirty) { const wanted = state.currentId; const fresh = await api.notes.get(wanted); if (fresh && fresh.id === state.currentId && !state.dirty && !state.inflight.has(fresh.id) && fresh.body !== el.bodyInput.value) { applyFreshFileBody(fresh); toast('This note was updated by the bot.'); } }
      });
    } else if (ev.type === 'reloaded') {
      refresh({ keepEditor: true });
    }
  }

  function importSummary(imp: WorkspaceImport) {
    return 'Notes updated: ' + imp.updated + ', created: ' + imp.created + (imp.conflicts ? ', conflicts: ' + imp.conflicts : '') + (imp.missing ? ', files removed by the agent (notes kept): ' + imp.missing : '') + '.';
  }

  async function openBotTerminal() {
    await flushSave();
    const res = await api.bot.openTerminal(state.currentId);
    if (!res.ok) { toast('Could not open a terminal: ' + res.error); return; }
    toast('Claude Code opened in a terminal at ' + res.cwd + (res.kind === 'workspace' ? '. Its edits are pulled in on the next Run, or press Run with an empty prompt.' : ''));
  }

  return { bot, toggleBot, describeBotScope, runBot, onBotEvent, openBotTerminal };
}
