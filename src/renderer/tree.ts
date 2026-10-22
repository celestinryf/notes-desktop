import NotesIcons from './icons.js';

// What a row's chevron does, by row: set when the row is built, read by the arrow keys.
const toggles: WeakMap<HTMLElement, (open: boolean) => void> = new WeakMap();
export function setRowToggle(row: HTMLElement, fn: ((open: boolean) => void) | null) {
  if (fn) toggles.set(row, fn); else toggles.delete(row);
}

// Folder rows carry no leading icon (the chevron already says "folder"); a book is told apart by this trailing mark.
export function bookMark() { return '<span class="row-mark book-mark" title="Book: its notes are pages">' + NotesIcons.svg('book') + '</span>'; }

// The children of a row at parentDepth; its guide line runs under the parent's chevron.
export function treeGroup(parentDepth: number, isHere: boolean) {
  const group = document.createElement('div');
  group.className = 'tree-children' + (isHere ? ' is-here' : '');
  group.setAttribute('role', 'group');
  group.style.setProperty('--depth', String(parentDepth));
  return group;
}

export function visibleRows(root: HTMLElement) { return Array.from<HTMLElement>(root.querySelectorAll('.tree-row')).filter((r) => r.offsetParent); }
export function focusRow(root: HTMLElement, row: HTMLElement) {
  for (const r of Array.from<HTMLElement>(root.querySelectorAll('.tree-row[tabindex="0"]'))) r.tabIndex = -1;
  row.tabIndex = 0;
  row.focus();
}
// A rebuild must not lose the keyboard: remember which row had focus, and focus it again afterwards.
export function treeFocusKey(root: HTMLElement) {
  const a = document.activeElement;
  return a instanceof HTMLElement && root.contains(a) && a.classList.contains('tree-row') ? a.dataset.key : null;
}
export function restoreTreeFocus(root: HTMLElement, key?: string | null) {
  const rows = visibleRows(root);
  const target = (key && rows.find((r) => r.dataset.key === key)) || null;
  if (target) { focusRow(root, target); return; }
  const all = Array.from<HTMLElement>(root.querySelectorAll('.tree-row'));
  const first = all.find((r) => r.classList.contains('is-active')) || all[0];
  if (first) first.tabIndex = 0; // one row in the tab order, so Tab reaches the tree (even if the pane is hidden now)
}
// Arrow keys as in any tree: up and down move, right opens (then steps in), left closes (then steps out),
// Home and End jump, Enter or Space activates.
export function bindTreeKeys(root: HTMLElement) {
  root.addEventListener('keydown', (e) => {
    if (!(e.target instanceof Element) || e.target.closest('input, select, textarea') || e.altKey || e.ctrlKey || e.metaKey) return;
    const row = e.target.closest<HTMLElement>('.tree-row');
    if (!row || !root.contains(row) || e.target !== row) return;
    const rows = visibleRows(root);
    const i = rows.indexOf(row);
    const go = (j: number) => { if (rows[j]) { e.preventDefault(); focusRow(root, rows[j]); } };
    const expanded = row.getAttribute('aria-expanded');
    const toggle = toggles.get(row);
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (expanded === 'false' && toggle) toggle(true);
      else if (expanded === 'true') go(i + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (expanded === 'true' && toggle) toggle(false);
      else {
        const group = row.parentElement && row.parentElement.closest('.tree-children');
        const parent = group && group.previousElementSibling;
        if (parent instanceof HTMLElement && parent.classList.contains('tree-row')) focusRow(root, parent);
      }
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
  });
  root.addEventListener('focusin', (e) => { const r = e.target instanceof Element ? e.target.closest<HTMLElement>('.tree-row') : null; if (r) { for (const x of root.querySelectorAll<HTMLElement>('.tree-row[tabindex="0"]')) if (x !== r) x.tabIndex = -1; r.tabIndex = 0; } });
}
