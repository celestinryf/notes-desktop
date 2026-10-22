import { el } from './dom.ts';
import { state } from './state.ts';
import { ipcErrorText } from './text.ts';

type ImagesDeps = { api: NotesApi, showBanner: (text: string) => void };

export function createImages({ api, showBanner }: ImagesDeps) {
  let imageUrl: string | null = null, imageSeq = 0;
  async function showImage(note: PublicNote) {
    const seq = ++imageSeq;
    el.imageView.removeAttribute('src');
    el.imageViewer.classList.remove('hidden', 'is-actual');
    syncImageToggle();
    try {
      const { bytes, mime } = await api.files.imageBytes(note.id);
      if (seq !== imageSeq || !state.current || state.current.id !== note.id) return;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      el.imageView.alt = note.title;
      el.imageView.src = imageUrl;
    } catch (err) {
      if (seq !== imageSeq) return;
      clearImage();
      showBanner('Could not show this image: ' + ipcErrorText(err) + ' Use "Open with…" to open it.');
    }
  }
  function clearImage() {
    imageSeq++;
    el.imageViewer.classList.add('hidden');
    el.imageView.removeAttribute('src');
    if (imageUrl) { URL.revokeObjectURL(imageUrl); imageUrl = null; }
  }
  function toggleImageSize() {
    el.imageViewer.classList.toggle('is-actual');
    syncImageToggle();
  }
  function syncImageToggle() {
    const actual = el.imageViewer.classList.contains('is-actual');
    el.imageView.setAttribute('aria-pressed', String(actual));
    el.imageView.title = actual ? 'Actual size. Click or press Enter to fit it to the pane.' : 'Fitted to the pane. Click or press Enter for its actual size.';
    const w = el.imageView.naturalWidth, h = el.imageView.naturalHeight;
    if (!w || el.imageViewer.classList.contains('hidden')) return;
    el.statusCode.textContent = w + ' × ' + h + ' px, ' + (actual ? 'actual size' : 'fitted');
    el.statusCode.classList.remove('hidden');
    el.imageView.setAttribute('aria-label', (state.current ? state.current.title + ', ' : '') + w + ' by ' + h + ' pixels, ' + (actual ? 'actual size' : 'fitted to the pane'));
  }

  return { showImage, clearImage, toggleImageSize, syncImageToggle };
}
