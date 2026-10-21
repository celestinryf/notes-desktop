import NotesIcons from './icons.js';

// Folder rows carry no leading icon (the chevron already says "folder"); a book is told apart by this trailing mark.
export function bookMark() { return '<span class="row-mark book-mark" title="Book: its notes are pages">' + NotesIcons.svg('book') + '</span>'; }

// The children of a row at parentDepth; its guide line runs under the parent's chevron.
export function treeGroup(parentDepth, isHere) {
  const group = document.createElement('div');
  group.className = 'tree-children' + (isHere ? ' is-here' : '');
  group.setAttribute('role', 'group');
  group.style.setProperty('--depth', parentDepth);
  return group;
}

export function visibleRows(root) { return Array.from(root.querySelectorAll('.tree-row')).filter((r) => r.offsetParent); }
export function focusRow(root, row) {
  for (const r of root.querySelectorAll('.tree-row[tabindex="0"]')) r.tabIndex = -1;
  row.tabIndex = 0;
  row.focus();
}
// A rebuild must not lose the keyboard: remember which row had focus, and focus it again afterwards.
export function treeFocusKey(root) {
  const a = document.activeElement;
  return a && root.contains(a) && a.classList.contains('tree-row') ? a.dataset.key : null;
}
export function restoreTreeFocus(root, key) {
  const rows = visibleRows(root);
  const target = (key && rows.find((r) => r.dataset.key === key)) || null;
  if (target) { focusRow(root, target); return; }
  const all = Array.from(root.querySelectorAll('.tree-row'));
  const first = all.find((r) => r.classList.contains('is-active')) || all[0];
  if (first) first.tabIndex = 0; // one row in the tab order, so Tab reaches the tree (even if the pane is hidden now)
}
// Arrow keys as in any tree: up and down move, right opens (then steps in), left closes (then steps out),
// Home and End jump, Enter or Space activates.
export function bindTreeKeys(root) {
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea') || e.altKey || e.ctrlKey || e.metaKey) return;
    const row = e.target.closest('.tree-row');
    if (!row || !root.contains(row) || e.target !== row) return;
    const rows = visibleRows(root);
    const i = rows.indexOf(row);
    const go = (j) => { if (rows[j]) { e.preventDefault(); focusRow(root, rows[j]); } };
    const expanded = row.getAttribute('aria-expanded');
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (expanded === 'false' && row._toggle) row._toggle(true);
      else if (expanded === 'true') go(i + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (expanded === 'true' && row._toggle) row._toggle(false);
      else {
        const group = row.parentElement && row.parentElement.closest('.tree-children');
        const parent = group && group.previousElementSibling;
        if (parent && parent.classList.contains('tree-row')) focusRow(root, parent);
      }
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
  });
  root.addEventListener('focusin', (e) => { const r = e.target.closest('.tree-row'); if (r) { for (const x of root.querySelectorAll('.tree-row[tabindex="0"]')) if (x !== r) x.tabIndex = -1; r.tabIndex = 0; } });
}
