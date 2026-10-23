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
    let text = 'Scope: your notes folder';
    if (n && n.vaultId && !n.home) text = 'Scope: this note’s vault folder';
    else if (n && n.filePath && !n.home) text = 'Scope: the folder containing this file';
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
    if (!prompt) { el.botPrompt.focus(); return; }
    await flushSave();
    el.botOutput.textContent = '';
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
    } else if (ev.type === 'out') {
      botAppend(ev.text);
    } else if (ev.type === 'err') {
      botAppend(ev.text, 'bot-err');
    } else if (ev.type === 'end') {
      bot.running = false;
      el.botPanel.classList.remove('is-running');
      el.botRunBtn.textContent = 'Run';
      if (ev.error) botAppend('\n' + ev.error + '\n', 'bot-err');
      else botAppend('\nDone' + (ev.code === 0 ? '' : ' (exit code ' + ev.code + ')') + '.\n', 'bot-meta');
      refresh({ keepEditor: true }).then(async () => {
        if (state.currentId && !state.dirty) { const wanted = state.currentId; const fresh = await api.notes.get(wanted); if (fresh && fresh.id === state.currentId && !state.dirty && !state.inflight.has(fresh.id) && fresh.body !== el.bodyInput.value) { applyFreshFileBody(fresh); toast('This note was updated by the bot.'); } }
      });
    } else if (ev.type === 'reloaded') {
      refresh({ keepEditor: true });
    }
  }

  async function openBotTerminal() {
    await flushSave();
    const res = await api.bot.openTerminal(state.currentId);
    if (!res.ok) { toast('Could not open a terminal: ' + res.error); return; }
    toast('Claude Code opened in a terminal at ' + res.cwd);
  }

  return { bot, toggleBot, describeBotScope, runBot, onBotEvent, openBotTerminal };
}
