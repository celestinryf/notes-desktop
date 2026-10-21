// @ts-check
import { el } from './dom.js';

let toastTimer = null;
let toastMs = 0;
// Hovering a toast holds it, so a slow reader (or an Undo just out of reach) does not lose it.
el.toast.addEventListener('mouseenter', () => clearTimeout(toastTimer));
el.toast.addEventListener('mouseleave', () => { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, Math.min(toastMs, 3000)); });
export function toast(message, action) {
  clearTimeout(toastTimer);
  el.toast.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = message;
  el.toast.append(text);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { hideToast(); action.run(); });
    el.toast.append(b);
  }
  el.toast.classList.remove('hidden');
  // Long enough to read: about a quarter second a word, 3 to 8 seconds; an undo offer gets the full 8.
  const words = String(message).split(/\s+/).length;
  toastMs = action ? 8000 : Math.min(8000, Math.max(3000, words * 250));
  toastTimer = setTimeout(hideToast, toastMs);
}
export function hideToast() { el.toast.classList.add('hidden'); }
