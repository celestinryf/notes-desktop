import { el } from './dom.ts';
import * as H from '../shared/helpers.mts';

type PageNote = Pick<PublicNote, 'id' | 'filePath' | 'fileKind'>;
type PageTarget =
  { kind: 'frame', url: string } |
  { kind: 'notice', text: string, action: string, run: () => void };

type PageViewDeps = {
  api: NotesApi,
  editSource: () => void,
};

const hostOf = (url: string) => { try { return new URL(url).host; } catch (_) { return url; } };

export function createPageView({ api, editSource }: PageViewDeps) {
  let ticket = 0;
  let shown: { id: string, key: string } | null = null;
  let last: { note: PageNote, body: string } | null = null;
  let noticeAction: (() => void) | null = null;

  el.pageNoticeBtn.addEventListener('click', () => { if (noticeAction) noticeAction(); });

  async function targetFor(note: PageNote, body: string): Promise<PageTarget> {
    if (H.isHtmlPageFile(note)) {
      const url = await api.pages.frameUrl(note.id);
      return url ? { kind: 'frame', url } : { kind: 'notice', text: 'Notes could not open this page.', action: 'Try again', run: reload };
    }
    const raw = H.webLinkTarget(body);
    if (!raw) return { kind: 'notice', text: 'This shortcut has no web address. Add a line such as URL=http://localhost:5173 under [InternetShortcut].', action: 'Edit the shortcut', run: editSource };
    const local = H.loopbackUrl(raw);
    if (!local) {
      if (H.isOpenableLink(raw)) return { kind: 'notice', text: 'This shortcut opens ' + (hostOf(raw) || H.truncate(raw, 80)) + ', which is not on this computer. Notes shows pages from this computer only.', action: 'Open in browser', run: () => { api.app.openExternal(raw); } };
      return { kind: 'notice', text: 'Notes cannot open "' + H.truncate(raw, 80) + '". It shows web pages from this computer, such as http://localhost:5173.', action: 'Edit the shortcut', run: editSource };
    }
    if (!(await api.pages.probe(local))) return { kind: 'notice', text: 'Nothing answered at ' + hostOf(local) + '. Start the server, then try again.', action: 'Try again', run: reload };
    return { kind: 'frame', url: local };
  }

  function unload() {
    if (el.pageView.getAttribute('src') !== 'about:blank') el.pageView.src = 'about:blank';
  }

  function showNotice(text: string, action: string, run: () => void) {
    unload();
    el.pageView.classList.add('hidden');
    el.pageNoticeText.textContent = text;
    el.pageNoticeBtn.textContent = action;
    noticeAction = run;
    el.pageNotice.classList.remove('hidden');
  }

  function blank() {
    noticeAction = null;
    el.pageNotice.classList.add('hidden');
    el.pageView.classList.remove('hidden');
    unload();
  }

  function showFrame(url: string) {
    blank();
    el.pageView.src = url;
  }

  async function show(note: PageNote, body: string, opts?: { reload?: boolean }) {
    last = { note, body };
    const key = note.id + '\n' + (H.isWebLinkFile(note) ? H.webLinkTarget(body) || '' : note.filePath || '');
    if (!(opts && opts.reload) && shown && shown.key === key) return;
    const mine = ++ticket;
    if (!shown || shown.key !== key) blank();
    shown = { id: note.id, key };
    const target = await targetFor(note, body);
    if (mine !== ticket) return;
    if (target.kind === 'frame') showFrame(target.url);
    else showNotice(target.text, target.action, target.run);
  }

  function reload() {
    if (last) show(last.note, last.body, { reload: true });
  }

  function hide() {
    ticket++;
    shown = null;
    last = null;
    noticeAction = null;
    unload();
  }

  const showing = () => !el.pageHost.classList.contains('hidden') && shown !== null;

  return { show, reload, hide, showing };
}

export type PageView = ReturnType<typeof createPageView>;
