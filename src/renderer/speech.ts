import { el, setLabel } from './dom.ts';
import { state } from './state.ts';
import { src } from './code-editor.ts';
import * as H from '../shared/helpers.mts';
import { toast } from './toast.ts';
import { setActivity } from './activity.ts';
import { focusBody } from './editor-view.ts';

const { isViewerOnlyFile, isNonMarkdownFile } = H;

interface SpeechDeps { api: NotesApi }

export function createSpeech({ api }: SpeechDeps) {
  const tts: { active: boolean, queue: string[], index: number } = { active: false, queue: [], index: 0 };

  function selectedTextForSpeech() {
    if (state.sourceMode) {
      const ta = src;
      if (ta.selectionStart !== ta.selectionEnd) return ta.value.slice(ta.selectionStart, ta.selectionEnd);
      return '';
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && el.richEditor.contains(sel.anchorNode)) return sel.toString();
    return '';
  }

  function textForSpeech() {
    const selected = selectedTextForSpeech().trim();
    if (selected) return selected;
    const title = el.titleInput.value.trim();
    const note = state.current;
    const body = isNonMarkdownFile(note) ? el.bodyInput.value : H.plainTextFromMarkdown(el.bodyInput.value);
    return (title ? title + '.\n' : '') + body;
  }

  function pickVoice() {
    const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    const wanted = state.settings && state.settings.ttsVoice;
    return voices.find((v) => v.name === wanted) || null;
  }

  function setReadAloudState(active: boolean) {
    tts.active = active;
    setLabel(el.readAloudBtn, active ? 'Stop reading' : 'Read aloud');
    el.readAloudBtn.classList.toggle('is-on', active);
    setActivity('read', active ? { text: 'Reading aloud', icon: 'volume-2', stop: stopReadAloud, stopLabel: 'Stop reading (Ctrl+Shift+R)' } : null);
  }

  function stopReadAloud() {
    tts.queue = [];
    tts.index = 0;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setReadAloudState(false);
  }

  function speakNext() {
    if (!tts.active || tts.index >= tts.queue.length) { setReadAloudState(false); return; }
    const u = new SpeechSynthesisUtterance(tts.queue[tts.index++]);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = (state.settings && state.settings.ttsRate) || 1;
    u.onend = () => speakNext();
    u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') toast('Read aloud stopped: ' + e.error); setReadAloudState(false); };
    if (state.info && state.info.drySpeech) return;
    window.speechSynthesis.speak(u);
  }

  function toggleReadAloud() {
    if (!window.speechSynthesis) { toast('Speech is not available on this system.'); return; }
    if (tts.active) { stopReadAloud(); return; }
    if (!state.current) return;
    const text = textForSpeech();
    if (!text.trim()) { toast('Nothing to read yet.'); return; }
    tts.queue = H.speechChunks(text);
    tts.index = 0;
    setReadAloudState(true);
    window.speechSynthesis.cancel();
    speakNext();
  }

  function populateVoices() {
    if (!window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices().slice().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
    const current = state.settings ? state.settings.ttsVoice : '';
    el.ttsVoiceSelect.innerHTML = '<option value="">System default</option>';
    for (const v of voices) {
      const o = document.createElement('option');
      o.value = v.name;
      o.textContent = v.name + ' (' + v.lang + ')' + (v.default ? ' • default' : '');
      el.ttsVoiceSelect.append(o);
    }
    el.ttsVoiceSelect.value = voices.some((v) => v.name === current) ? current : '';
  }

  async function startDictation() {
    if (!state.current || isViewerOnlyFile(state.current) || state.current.trashedAt) { toast('Open an editable note first.'); return; }
    focusBody();
    const res = await api.app.dictate();
    if (!res.ok) toast(res.error || 'Dictation could not start.');
    else toast('Windows dictation opened: speak now. Say "stop dictating" or press Win+H to finish.');
  }

  return { tts, stopReadAloud, toggleReadAloud, populateVoices, startDictation };
}
