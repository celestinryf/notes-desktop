import { el } from './dom.ts';

const FRAME_ROUNDING_PX = 1;

const foldOrder = () => [el.splitViewBtn, el.shareBtn, el.sourceBtn, el.versionsBtn, el.pinBtn, el.tabAddBtn];

const foldedItems = (): [HTMLButtonElement, HTMLButtonElement][] => [
  [el.moreSourceBtn, el.sourceBtn],
  [el.morePinBtn, el.pinBtn],
  [el.moreSplitViewBtn, el.splitViewBtn],
  [el.moreShareBtn, el.shareBtn],
];

function overflowing(bar: HTMLElement) {
  const limit = bar.getBoundingClientRect().right - parseFloat(getComputedStyle(bar).paddingRight);
  return [...bar.children].some((child) => child instanceof HTMLElement && child.offsetParent !== null && child.getBoundingClientRect().right > limit + 0.5);
}

function foldToFit(bar: HTMLElement) {
  const buttons = foldOrder();
  bar.classList.remove('is-cramped');
  for (const b of buttons) b.classList.remove('is-folded');
  for (const b of buttons) {
    if (!overflowing(bar)) return;
    if (!b.classList.contains('hidden')) b.classList.add('is-folded');
  }
  if (overflowing(bar)) bar.classList.add('is-cramped');
}

export function markTabScroll() {
  const strip = el.tabList;
  const end = strip.scrollWidth - strip.clientWidth;
  strip.classList.toggle('fade-start', strip.scrollLeft > 1);
  strip.classList.toggle('fade-end', strip.scrollLeft < end - 1);
  const box = strip.getBoundingClientRect();
  for (const tab of strip.children) {
    const r = tab.getBoundingClientRect();
    tab.classList.toggle('is-clipped', r.left < box.left - 0.5 || r.right > box.right + 0.5);
  }
}

export function fitBand() {
  foldToFit(el.tabBar);
  syncFoldedMenu();
  markTabScroll();
}

export function captionSize() {
  const r = el.captionProbe.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

export const cellWidth = () => el.cellProbe.getBoundingClientRect().width;

export function watchBand(onCaption: () => void) {
  const observer = new ResizeObserver(() => { fitBand(); onCaption(); });
  observer.observe(el.captionProbe);
  observer.observe(el.tabBar);
  el.tabList.addEventListener('scroll', markTabScroll, { passive: true });
}

export function applyPeerCaption(w: number, h: number) {
  const root = document.documentElement.style;
  root.setProperty('--caption-w', (w > 0 ? Math.ceil(w) + FRAME_ROUNDING_PX : 0) + 'px');
  if (h > 0) root.setProperty('--bar-h', h + 'px');
}

export const isShown = (b: HTMLElement) => b.offsetParent !== null;

export function syncFoldedMenu() {
  for (const [item, tool] of foldedItems()) {
    const folded = tool.classList.contains('is-folded') && !tool.classList.contains('hidden');
    item.classList.toggle('hidden', !folded);
    item.classList.toggle('is-on', tool.getAttribute('aria-pressed') === 'true');
    const label = item.querySelector('.lbl');
    const name = tool.getAttribute('aria-label');
    if (label && name && tool !== el.shareBtn) label.textContent = name;
  }
}
