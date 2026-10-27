import { useLayoutEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode, RefCallback } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Gap, useVirtualRows } from './virtual-rows.tsx';
import type { Reveal } from './virtual-rows.tsx';
import { chooseActive } from './tree-items.ts';
import type { FolderItem, TreeItem } from './tree-items.ts';

declare module 'react' {
  interface CSSProperties { '--depth'?: number }
}

type TreeSize = 'row' | 'heading';
const TREE_SIZES: Record<TreeSize, number> = { row: 28, heading: 24 };

export type TreeOverride<N> = { note: N; title: string };

interface NoteTreeDeps<N> {
  html: (item: TreeItem, override: N | null) => string;
  title: (item: TreeItem) => string;
  activate: (item: TreeItem, e: MouseEvent) => void;
  openInTab: (id: string) => void;
  toggle: (item: FolderItem, open: boolean) => void;
  folderMenu: (id: string, row: HTMLDivElement, e: MouseEvent) => void;
  allowDrop: (e: DragEvent) => boolean;
  drop: (folderId: string, e: DragEvent) => void;
  dragStart: (id: string, e: DragEvent) => void;
  dragEnd: () => void;
}

type Layout = { items: readonly TreeItem[]; keys: readonly string[]; sizes: readonly TreeSize[] };
type Marks = { drag: (key: string | null) => void; drop: (key: string | null, leaving?: string) => void };

interface TreeProps<N> {
  layout: Layout;
  activeKey: string | null;
  tabKey: string | null;
  dragKey: string | null;
  dropKey: string | null;
  marks: Marks;
  overrides: ReadonlyMap<string, TreeOverride<N>>;
  scroller: HTMLDivElement;
  deps: NoteTreeDeps<N>;
  handle: Reveal;
  painted: () => void;
}

const layoutOf = (items: readonly TreeItem[]): Layout => ({
  items,
  keys: items.map((item) => item.key),
  sizes: items.map((item) => (item.kind === 'heading' ? 'heading' : 'row')),
});

function NoteTree<N>({ layout, activeKey, tabKey, dragKey, dropKey, marks, overrides, scroller, deps, handle, painted }: TreeProps<N>) {
  const { items: rows, before, after, total, measureElement } = useVirtualRows<HTMLDivElement, TreeSize>(layout, scroller, TREE_SIZES, handle);
  useLayoutEffect(() => painted());
  const refs = useRef(new Map<string, RefCallback<HTMLDivElement>>());
  const refFor = (key: string) => {
    let ref = refs.current.get(key);
    if (!ref) {
      ref = (el) => {
        if (!el) return;
        measureElement(el);
        return () => {
          if (el.contains(document.activeElement)) scroller.focus({ preventScroll: true });
          refs.current.delete(key);
          measureElement(null);
        };
      };
      refs.current.set(key, ref);
    }
    return ref;
  };
  const row = (item: TreeItem, index: number) => {
    const override = item.kind === 'note' ? overrides.get(item.note.id) || null : null;
    const shared = {
      ref: refFor(item.key),
      'data-index': index,
      'data-key': item.key,
      style: { '--depth': item.depth },
      role: 'treeitem',
      'aria-level': item.depth + 1,
      'aria-setsize': item.setSize,
      'aria-posinset': item.posInSet,
      tabIndex: item.key === tabKey ? 0 : -1,
      title: override ? override.title : deps.title(item),
      dangerouslySetInnerHTML: { __html: deps.html(item, override ? override.note : null) },
      onClick: (e: ReactMouseEvent<HTMLDivElement>) => deps.activate(item, e.nativeEvent),
    };
    if (item.kind === 'folder') {
      const id = item.node.id;
      return (
        <div
          key={item.key}
          {...shared}
          className={'tree-row tree-folder' + (item.here ? ' is-here' : '') + (item.key === dropKey ? ' is-drop-target' : '')}
          data-id={id}
          aria-expanded={item.kids ? item.open : undefined}
          onContextMenu={(e) => { e.preventDefault(); deps.folderMenu(id, e.currentTarget, e.nativeEvent); }}
          onDragOver={(e) => { if (deps.allowDrop(e.nativeEvent)) marks.drop(item.key); }}
          onDragLeave={() => marks.drop(null, item.key)}
          onDrop={(e) => { marks.drop(null); deps.drop(id, e.nativeEvent); }}
        />
      );
    }
    if (item.kind === 'heading') return <div key={item.key} {...shared} className="tree-row tree-heading" />;
    const id = item.note.id;
    const active = item.key === activeKey;
    return (
      <div
        key={item.key}
        {...shared}
        className={'tree-row tree-note note-row' + (active ? ' is-active' : '') + (item.key === dragKey ? ' is-dragging' : '')}
        data-id={id}
        data-depth={item.depth}
        aria-selected={active}
        draggable
        onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); deps.openInTab(id); } }}
        onDragStart={(e) => { marks.drag(item.key); deps.dragStart(id, e.nativeEvent); }}
        onDragEnd={() => { marks.drag(null); deps.dragEnd(); }}
      />
    );
  };
  const nest = (slice: readonly { item: TreeItem; index: number }[], level: number): ReactNode[] => {
    const out: ReactNode[] = [];
    for (let i = 0; i < slice.length;) {
      const group = slice[i].item.groups[level];
      if (!group) { out.push(row(slice[i].item, slice[i].index)); i++; continue; }
      let j = i + 1;
      while (j < slice.length && slice[j].item.groups[level]?.key === group.key) j++;
      out.push(
        <div key={group.key} className={'tree-children' + (group.here ? ' is-here' : '') + (group.outline ? ' tree-outline' : '')} role="group" style={{ '--depth': group.depth }}>
          {nest(slice.slice(i, j), level + 1)}
        </div>,
      );
      i = j;
    }
    return out;
  };
  return (
    <div style={{ minHeight: total }}>
      <Gap tag="div" height={before} />
      {nest(rows.map((r) => ({ item: layout.items[r.index], index: r.index })), 0)}
      <Gap tag="div" height={after} />
    </div>
  );
}

export function createNoteTree<N>(root: HTMLDivElement, deps: NoteTreeDeps<N>) {
  const reactRoot = createRoot(root);
  const handle: Reveal = { reveal: () => {} };
  let layout = layoutOf([]);
  let indexOf = new Map<string, number>();
  let activeKey: string | null = null;
  let tabKey: string | null = null;
  let focusKey: string | null = null;
  let dragKey: string | null = null;
  let dropKey: string | null = null;
  const overrides = new Map<string, TreeOverride<N>>();
  root.tabIndex = -1;
  const rowElement = (key: string) => Array.from(root.querySelectorAll<HTMLElement>('.tree-row')).find((r) => r.dataset.key === key) || null;
  const rovingKey = () => (tabKey !== null && indexOf.has(tabKey) ? tabKey : activeKey !== null && indexOf.has(activeKey) ? activeKey : layout.keys[0] ?? null);
  const painted = () => {
    const roving = rovingKey();
    const tabbable = roving !== null && !rowElement(roving) ? 0 : -1;
    if (root.tabIndex !== tabbable) root.tabIndex = tabbable;
    if (focusKey !== null) {
      const el = rowElement(focusKey);
      if (el) { focusKey = null; el.focus(); }
    }
  };
  const marks: Marks = {
    drag(key) {
      if (key === dragKey) return;
      dragKey = key;
      if (key !== null) document.addEventListener('pointermove', () => marks.drag(null), { once: true });
      paint();
    },
    drop(key, leaving) {
      if ((leaving !== undefined && dropKey !== leaving) || key === dropKey) return;
      dropKey = key;
      paint();
    },
  };
  const paint = () => flushSync(() => reactRoot.render(<NoteTree layout={layout} activeKey={activeKey} tabKey={rovingKey()} dragKey={dragKey} dropKey={dropKey} marks={marks} overrides={overrides} scroller={root} deps={deps} handle={handle} painted={painted} />));
  const focusIndex = (index: number) => {
    tabKey = layout.keys[index];
    focusKey = tabKey;
    if (!rowElement(tabKey)) handle.reveal(index);
    paint();
  };

  root.addEventListener('keydown', (e) => {
    if (!(e.target instanceof Element) || e.target.closest('input, select, textarea') || e.altKey || e.ctrlKey || e.metaKey) return;
    const onRoot = e.target === root;
    const rowEl = onRoot ? null : e.target.closest<HTMLElement>('.tree-row');
    if (!onRoot && (!rowEl || e.target !== rowEl || !root.contains(rowEl))) return;
    const key = rowEl ? rowEl.dataset.key : rovingKey();
    const i = key === undefined || key === null ? -1 : indexOf.get(key) ?? -1;
    if (i < 0) return;
    const item = layout.items[i];
    const go = (j: number) => { if (j >= 0 && j < layout.items.length) { e.preventDefault(); focusIndex(j); } };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(layout.items.length - 1);
    else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (item.kind === 'folder' && item.kids && !item.open) deps.toggle(item, true);
      else if (item.kind === 'folder' && item.open) go(i + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (item.kind === 'folder' && item.open) deps.toggle(item, false);
      else {
        const group = item.groups[item.groups.length - 1];
        const parent = group ? indexOf.get(group.owner) : undefined;
        if (parent !== undefined) focusIndex(parent);
      }
    } else if (rowEl && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); rowEl.click(); }
  });
  root.addEventListener('focusin', (e) => {
    if (e.target === root) {
      const roving = rovingKey();
      const index = roving === null ? undefined : indexOf.get(roving);
      if (index !== undefined && e.relatedTarget instanceof Node && !root.contains(e.relatedTarget) && root.matches(':focus-visible')) focusIndex(index);
      return;
    }
    const r = e.target instanceof Element ? e.target.closest<HTMLElement>('.tree-row') : null;
    const key = r && r.dataset.key;
    if (!key) return;
    if (focusKey !== null && focusKey !== key) focusKey = null;
    if (key !== tabKey) { tabKey = key; queueMicrotask(paint); }
  });
  root.addEventListener('focusout', (e) => {
    if (e.relatedTarget instanceof Node && !root.contains(e.relatedTarget)) focusKey = null;
  });

  return {
    render(items: readonly TreeItem[], active: number) {
      layout = layoutOf(items);
      indexOf = new Map(layout.keys.map((k, i) => [k, i]));
      activeKey = active >= 0 ? layout.keys[active] : null;
      if (focusKey !== null && !indexOf.has(focusKey)) focusKey = null;
      overrides.clear();
      paint();
    },
    setActive(id: string | null, preferKey: string | null) {
      const index = chooseActive(layout.items, id, preferKey);
      const next = index >= 0 ? layout.keys[index] : null;
      if (next === activeKey) return;
      activeKey = next;
      paint();
    },
    revealActive() {
      const index = activeKey === null ? -1 : indexOf.get(activeKey) ?? -1;
      if (index >= 0) handle.reveal(index);
    },
    replace(id: string, note: N, title: string) {
      if (!layout.items.some((item) => item.kind === 'note' && item.note.id === id)) return;
      overrides.set(id, { note, title });
      paint();
    },
  };
}
