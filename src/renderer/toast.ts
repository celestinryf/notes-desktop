import { el } from './dom.ts';

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastMs = 0;
el.toast.addEventListener('mouseenter', () => clearTimeout(toastTimer));
el.toast.addEventListener('mouseleave', () => { clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, Math.min(toastMs, 3000)); });
export function toast(message: string, action?: { label: string; run: () => void }) {
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
  const words = String(message).split(/\s+/).length;
  toastMs = action ? 8000 : Math.min(8000, Math.max(3000, words * 250));
  toastTimer = setTimeout(hideToast, toastMs);
}
export function hideToast() { el.toast.classList.add('hidden'); }
