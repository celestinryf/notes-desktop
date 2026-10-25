import { useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { useVirtualizer } from '@tanstack/react-virtual';

const ROW_PX = 28;
const TALL_ROW_PX = 48;
const OVERSCAN = 16;

type Row = { id: string };
type Handle = { reveal: (index: number) => void };

interface NoteListDeps<T extends Row> {
  html: (row: T, index: number) => string;
  title: (row: T) => string;
  tall: (row: T) => boolean;
  draggable: (row: T) => boolean;
  open: (id: string, newTab: boolean) => void;
  dragStart: (id: string, e: DragEvent) => void;
  dragEnd: () => void;
}

interface ListProps<T extends Row> {
  rows: readonly T[];
  activeId: string | null;
  scroller: HTMLElement;
  deps: NoteListDeps<T>;
  handle: Handle;
}

function NoteList<T extends Row>({ rows, activeId, scroller, deps, handle }: ListProps<T>) {
  const list = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: (i) => (deps.tall(rows[i]) ? TALL_ROW_PX : ROW_PX),
    getItemKey: (i) => rows[i].id,
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
            dangerouslySetInnerHTML={{ __html: deps.html(row, item.index) }}
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
  let rows: readonly T[] = [];
  let activeId: string | null = null;
  const overrides = new Map<string, T>();
  const shown = () => (overrides.size ? rows.map((r) => overrides.get(r.id) || r) : rows);
  const paint = () => flushSync(() => root.render(<NoteList rows={shown()} activeId={activeId} scroller={ul} deps={deps} handle={handle} />));
  const reveal = () => {
    const index = activeId ? rows.findIndex((r) => r.id === activeId) : -1;
    if (index >= 0) handle.reveal(index);
  };
  return {
    render(next: readonly T[], active: string | null) {
      const moved = active !== activeId;
      rows = next;
      activeId = active;
      overrides.clear();
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
      if (!rows.some((r) => r.id === row.id)) return;
      overrides.set(row.id, row);
      paint();
    },
  };
}
