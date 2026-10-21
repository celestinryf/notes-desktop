import { el } from './dom.js';
import { state } from './state.js';
import { ipcErrorText } from './text.js';

export function createImages({ api, showBanner }) {
  // An image file, fitted to the pane; a click (or Enter) shows it at its actual size, and again fits it. The picture
  // comes from the main process as bytes and is shown from a blob: URL, so the page never reads files itself.
  let imageUrl = null, imageSeq = 0;
  async function showImage(note) {
    const seq = ++imageSeq;
    el.imageView.removeAttribute('src'); // the last picture never shows under this note's name
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
  // The picture is a toggle button (fit, or actual size): it says which, and so does the status line.
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
