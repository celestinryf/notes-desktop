import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Gap, useVirtualRows } from './virtual-rows.tsx';
import type { Reveal } from './virtual-rows.tsx';

type ListSize = 'short' | 'tall';
const LIST_SIZES: Record<ListSize, number> = { short: 28, tall: 42 };
const PREFETCH = 60;

type Row = { id: string };
type Layout = { ids: readonly string[]; query: string; guess: ListSize; sizes: readonly ListSize[]; keys: readonly string[] };

interface NoteListDeps<T extends Row> {
  row: (id: string) => T | undefined;
  need: (ids: string[]) => void;
  html: (row: T, index: number, query: string) => string;
  title: (row: T) => string;
  tall: (row: T, query: string) => boolean;
  draggable: (row: T) => boolean;
  open: (id: string, newTab: boolean) => void;
  dragStart: (id: string, e: DragEvent) => void;
  dragEnd: () => void;
}

interface ListProps<T extends Row> {
  layout: Layout;
  activeId: string | null;
  scroller: HTMLElement;
  deps: NoteListDeps<T>;
  handle: Reveal;
  shown: (from: number, to: number) => void;
}

const rowKey = (id: string, size: ListSize) => id + (size === 'tall' ? ':tall' : '');

function NoteList<T extends Row>({ layout, activeId, scroller, deps, handle, shown }: ListProps<T>) {
  const { ids } = layout;
  const { items, before, after, measureElement } = useVirtualRows<HTMLLIElement, ListSize>(layout, scroller, LIST_SIZES, handle);
  useEffect(() => {
    if (!items.length) { shown(0, 0); return; }
    shown(items[0].index, items[items.length - 1].index + 1);
    const from = Math.max(0, items[0].index - PREFETCH);
    const to = Math.min(ids.length, items[items.length - 1].index + 1 + PREFETCH);
    const missing: string[] = [];
    for (let i = from; i < to; i++) if (!deps.row(ids[i])) missing.push(ids[i]);
    if (missing.length) deps.need(missing);
  });
  return (
    <>
      <Gap tag="li" height={before} />
      {items.map((item) => {
        const id = ids[item.index];
        const row = deps.row(id);
        const placed = { ref: measureElement, 'data-index': item.index, 'data-id': id, role: 'option', 'aria-setsize': ids.length, 'aria-posinset': item.index + 1 };
        if (!row) return <li {...placed} key={id} className="note-row" data-placeholder="" aria-busy="true" style={{ height: item.size }} />;
        const drag = deps.draggable(row);
        return (
          <li
            {...placed}
            key={id}
            className={'note-row' + (id === activeId ? ' is-active' : '')}
            title={deps.title(row)}
            draggable={drag || undefined}
            onClick={(e) => deps.open(id, e.ctrlKey || e.metaKey)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); deps.open(id, true); } }}
            onDragStart={drag ? (e) => { e.currentTarget.classList.add('is-dragging'); deps.dragStart(id, e.nativeEvent); } : undefined}
            onDragEnd={drag ? (e) => { e.currentTarget.classList.remove('is-dragging'); deps.dragEnd(); } : undefined}
            dangerouslySetInnerHTML={{ __html: deps.html(row, item.index, layout.query) }}
          />
        );
      })}
      <Gap tag="li" height={after} />
    </>
  );
}

export function createNoteList<T extends Row>(ul: HTMLUListElement, deps: NoteListDeps<T>) {
  const root = createRoot(ul);
  const handle: Reveal = { reveal: () => {} };
  const known = (id: string, query: string): ListSize | null => {
    const row = deps.row(id);
    return row ? (deps.tall(row, query) ? 'tall' : 'short') : null;
  };
  const layoutOf = (ids: readonly string[], query: string): Layout => {
    const sure = ids.map((id) => known(id, query));
    const tall = sure.filter((s) => s === 'tall').length;
    const short = sure.filter((s) => s === 'short').length;
    const guess: ListSize = tall + short ? (tall > short ? 'tall' : 'short') : query ? 'tall' : 'short';
    const sizes = sure.map((s) => s || guess);
    return { ids, query, guess, sizes, keys: ids.map((id, i) => rowKey(id, sizes[i])) };
  };
  const sizeOf = (id: string) => known(id, layout.query) || layout.guess;
  let layout = layoutOf([], '');
  let range: [number, number] = [0, 0];
  const shown = (from: number, to: number) => { range = [from, to]; };
  let indexOf = new Map<string, number>();
  let activeId: string | null = null;
  const paint = () => flushSync(() => root.render(<NoteList layout={layout} activeId={activeId} scroller={ul} deps={deps} handle={handle} shown={shown} />));
  const reveal = () => {
    const index = activeId === null ? undefined : indexOf.get(activeId);
    if (index !== undefined) handle.reveal(index);
  };
  const resize = (ids: readonly string[]) => {
    let sizes: ListSize[] | null = null;
    let keys: string[] | null = null;
    for (const id of ids) {
      const i = indexOf.get(id);
      if (i === undefined) continue;
      const size = sizeOf(id);
      if (size === layout.sizes[i]) continue;
      sizes = sizes || layout.sizes.slice();
      keys = keys || layout.keys.slice();
      sizes[i] = size;
      keys[i] = rowKey(id, size);
    }
    if (sizes && keys) layout = { ...layout, sizes, keys };
  };
  return {
    render(ids: readonly string[], active: string | null, query: string) {
      const moved = active !== activeId;
      layout = layoutOf(ids, query);
      indexOf = new Map(ids.map((id, i) => [id, i]));
      activeId = active;
      paint();
      if (moved) reveal();
    },
    setActive(id: string | null) {
      if (id === activeId) return;
      activeId = id;
      paint();
      reveal();
    },
    shownIds: () => layout.ids.slice(range[0], range[1]),
    changed(ids: readonly string[]) {
      const listed = ids.filter((id) => indexOf.has(id));
      if (!listed.length) return;
      resize(listed);
      paint();
    },
  };
}
