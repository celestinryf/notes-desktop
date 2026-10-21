import { el, I } from './dom.ts';
import { state } from './state.ts';
import { escapeHtml } from './text.ts';

export function createRelated({ api, followLink }) {
  let relatedTimer: ReturnType<typeof setTimeout> | undefined;
  function renderRelatedSoon() { clearTimeout(relatedTimer); relatedTimer = setTimeout(() => { if (state.current) renderRelated(state.current); }, 400); }

  async function renderRelated(note) {
    if (!note || note.trashedAt) { el.relatedPanel.classList.add('hidden'); return; }
    const forNote = note.id;
    let r;
    try { r = await api.notes.related(note.id); } catch (_) { r = null; }
    if (state.currentId !== forNote) return;
    if (!r) { el.relatedPanel.classList.add('hidden'); return; }
    const fill = (group, items) => {
      const ul = group.querySelector('ul');
      ul.innerHTML = '';
      for (const it of items) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = (it.locked ? I('lock') : '') + escapeHtml(it.title);
        if (it.sharedTags && it.sharedTags.length) { const t = document.createElement('span'); t.className = 'tags'; t.textContent = it.sharedTags.map((x) => '#' + x).join(' '); b.append(t); }
        if (it.missing) { b.classList.add('is-missing'); b.disabled = true; b.title = 'This link points at a note that no longer exists.'; }
        else { b.title = it.trashed ? 'In the trash' : 'Open'; b.addEventListener('click', () => followLink('note://' + it.id)); }
        li.append(b);
        ul.append(li);
      }
      group.classList.toggle('hidden', !items.length);
    };
    fill(el.relatedOut, r.outgoing);
    fill(el.relatedIn, r.incoming);
    fill(el.relatedTags, r.byTags);
    el.relatedPanel.classList.toggle('hidden', !(r.outgoing.length || r.incoming.length || r.byTags.length));
  }

  return { renderRelated, renderRelatedSoon };
}
