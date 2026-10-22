export function placePopover(menu: HTMLDivElement, anchor: HTMLButtonElement | HTMLDivElement, ev?: PointerEvent | null) {
  menu.classList.remove('hidden');
  const rect = anchor.getBoundingClientRect();
  menu.style.left = '0px'; menu.style.top = '0px';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let x = ev ? ev.clientX : (rect.left > window.innerWidth / 2 ? rect.right - mw : rect.left);
  let y = ev ? ev.clientY : rect.bottom + 4;
  if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight - 8) y = ev ? window.innerHeight - mh - 8 : rect.top - mh - 4;
  menu.style.left = Math.max(8, x) + 'px';
  menu.style.top = Math.max(8, y) + 'px';
  const first = menu.querySelector<HTMLButtonElement>('button:not(.hidden):not(:disabled)');
  if (first) first.focus();
}
