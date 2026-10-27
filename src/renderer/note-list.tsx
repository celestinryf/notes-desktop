import { useCallback, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { measureElement, useVirtualizer } from '@tanstack/react-virtual';
import type { Virtualizer } from '@tanstack/react-virtual';

const ROW_PX = 28;
const TALL_ROW_PX = 42;
const OVERSCAN = 16;

type Row = { id: string };
type Handle = { reveal: (index: number) => void };
type Layout<T extends Row> = { rows: readonly T[]; query: string; tall: readonly boolean[]; keys: readonly string[] };

interface NoteListDeps<T extends Row> {
  html: (row: T, index: number, query: string) => string;
  title: (row: T) => string;
  tall: (row: T, query: string) => boolean;
  draggable: (row: T) => boolean;
  open: (id: string, newTab: boolean) => void;
  dragStart: (id: string, e: DragEvent) => void;
  dragEnd: () => void;
}

interface ListProps<T extends Row> {
  layout: Layout<T>;
  activeId: string | null;
  scroller: HTMLElement;
  deps: NoteListDeps<T>;
  handle: Handle;
}

const rowKey = (row: Row, tall: boolean) => row.id + (tall ? ':tall' : '');

type LearnedSize = { size: number; seen: Map<number, number> };
const learnedSize = (size: number): LearnedSize => ({ size, seen: new Map() });
function learn(learned: LearnedSize, size: number) {
  const times = (learned.seen.get(size) || 0) + 1;
  learned.seen.set(size, times);
  if (times > (learned.seen.get(learned.size) || 0)) learned.size = size;
}

function NoteList<T extends Row>({ layout, activeId, scroller, deps, handle }: ListProps<T>) {
  const { rows } = layout;
  const { keys, tall } = layout;
  const getItemKey = useCallback((i: number) => keys[i], [keys]);
  const sizes = useRef({ short: learnedSize(ROW_PX), tall: learnedSize(TALL_ROW_PX) });
  const estimateSize = useCallback((i: number) => (tall[i] ? sizes.current.tall : sizes.current.short).size, [tall]);
  const measure = useCallback((el: HTMLLIElement, entry: ResizeObserverEntry | undefined, instance: Virtualizer<HTMLElement, HTMLLIElement>) => {
    const size = measureElement(el, entry, instance);
    const index = instance.indexFromElement(el);
    if (entry && size > 0 && index >= 0 && index < tall.length) learn(tall[index] ? sizes.current.tall : sizes.current.short, size);
    return size;
  }, [tall]);
  const list = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize,
    getItemKey,
    measureElement: measure,
    overscan: OVERSCAN,
  });
  useLayoutEffect(() => { handle.reveal = (index) => list.scrollToIndex(index, { align: 'auto' }); });
  const items = list.getVirtualItems();
  const before = items.length ? items[0].start : 0;
  const after = items.length ? list.getTotalSize() - items[items.length - 1].end : 0;
  return (
    <>
      {before > 0 && <li className="note-list-gap" role="presentation" aria-hidden="true" style={{ height: before }} />}
      {items.map((item) => {
        const row = rows[item.index];
        const drag = deps.draggable(row);
        return (
          <li
            key={row.id}
            ref={list.measureElement}
            data-index={item.index}
            data-id={row.id}
            className={'note-row' + (row.id === activeId ? ' is-active' : '')}
            role="option"
            aria-setsize={rows.length}
            aria-posinset={item.index + 1}
            title={deps.title(row)}
            draggable={drag || undefined}
            onClick={(e) => deps.open(row.id, e.ctrlKey || e.metaKey)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); deps.open(row.id, true); } }}
            onDragStart={drag ? (e) => { e.currentTarget.classList.add('is-dragging'); deps.dragStart(row.id, e.nativeEvent); } : undefined}
            onDragEnd={drag ? (e) => { e.currentTarget.classList.remove('is-dragging'); deps.dragEnd(); } : undefined}
            dangerouslySetInnerHTML={{ __html: deps.html(row, item.index, layout.query) }}
          />
        );
      })}
      {after > 0 && <li className="note-list-gap" role="presentation" aria-hidden="true" style={{ height: after }} />}
    </>
  );
}

export function createNoteList<T extends Row>(ul: HTMLUListElement, deps: NoteListDeps<T>) {
  const root = createRoot(ul);
  const handle: Handle = { reveal: () => {} };
  const layoutOf = (rows: readonly T[], query: string): Layout<T> => {
    const tall = rows.map((r) => deps.tall(r, query));
    return { rows, query, tall, keys: rows.map((r, i) => rowKey(r, tall[i])) };
  };
  let layout = layoutOf([], '');
  let activeId: string | null = null;
  const paint = () => flushSync(() => root.render(<NoteList layout={layout} activeId={activeId} scroller={ul} deps={deps} handle={handle} />));
  const reveal = () => {
    const index = activeId ? layout.rows.findIndex((r) => r.id === activeId) : -1;
    if (index >= 0) handle.reveal(index);
  };
  return {
    render(next: readonly T[], active: string | null, query: string) {
      const moved = active !== activeId;
      layout = layoutOf(next, query);
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
    replace(row: T) {
      const i = layout.rows.findIndex((r) => r.id === row.id);
      if (i < 0) return;
      const tall = deps.tall(row, layout.query);
      const at = <V,>(list: readonly V[], value: V) => { const copy = list.slice(); copy[i] = value; return copy; };
      const sized = tall === layout.tall[i] ? layout : { ...layout, tall: at(layout.tall, tall), keys: at(layout.keys, rowKey(row, tall)) };
      layout = { ...sized, rows: at(layout.rows, row) };
      paint();
    },
  };
}
