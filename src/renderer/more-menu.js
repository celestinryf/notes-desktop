// @ts-check
import { el } from './dom.js';
import { state } from './state.js';
import { placePopover } from './popover.js';

export function openMoreMenu() {
  if (!state.current) return;
  placePopover(el.moreMenu, el.moreBtn);
  el.moreBtn.setAttribute('aria-expanded', 'true');
}

export function closeMoreMenu() {
  el.moreMenu.classList.add('hidden');
  el.moreBtn.setAttribute('aria-expanded', 'false');
}

// Arrow keys, Home and End move through any open menu; Tab leaves it.
export function bindMenuKeys() {
  document.addEventListener('keydown', (e) => {
    const menu = e.target instanceof Element ? e.target.closest('.popover[role="menu"]') : null;
    if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...menu.querySelectorAll('button')].filter((b) => b.offsetParent && !b.disabled);
    if (!items.length) return;
    e.preventDefault();
    const i = items.findIndex((b) => b === document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  }, true);
}
