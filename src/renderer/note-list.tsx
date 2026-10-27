import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Gap, useVirtualRows } from './virtual-rows.tsx';
import type { Reveal } from './virtual-rows.tsx';

type ListSize = 'short' | 'tall';
const LIST_SIZES: Record<ListSize, number> = { short: 28, tall: 42 };

type Row = { id: string };
type Layout<T extends Row> = { rows: readonly T[]; query: string; sizes: readonly ListSize[]; keys: readonly string[] };

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
  handle: Reveal;
}

const rowKey = (row: Row, size: ListSize) => row.id + (size === 'tall' ? ':tall' : '');

function NoteList<T extends Row>({ layout, activeId, scroller, deps, handle }: ListProps<T>) {
  const { rows } = layout;
  const { items, before, after, measureElement } = useVirtualRows<HTMLLIElement, ListSize>(layout, scroller, LIST_SIZES, handle);
  return (
    <>
      <Gap tag="li" height={before} />
      {items.map((item) => {
        const row = rows[item.index];
        const drag = deps.draggable(row);
        return (
          <li
            key={row.id}
            ref={measureElement}
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
      <Gap tag="li" height={after} />
    </>
  );
}

export function createNoteList<T extends Row>(ul: HTMLUListElement, deps: NoteListDeps<T>) {
  const root = createRoot(ul);
  const handle: Reveal = { reveal: () => {} };
  const sizeOf = (row: T, query: string): ListSize => (deps.tall(row, query) ? 'tall' : 'short');
  const layoutOf = (rows: readonly T[], query: string): Layout<T> => {
    const sizes = rows.map((r) => sizeOf(r, query));
    return { rows, query, sizes, keys: rows.map((r, i) => rowKey(r, sizes[i])) };
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
      const size = sizeOf(row, layout.query);
      const at = <V,>(list: readonly V[], value: V) => { const copy = list.slice(); copy[i] = value; return copy; };
      const sized = size === layout.sizes[i] ? layout : { ...layout, sizes: at(layout.sizes, size), keys: at(layout.keys, rowKey(row, size)) };
      layout = { ...sized, rows: at(layout.rows, row) };
      paint();
    },
  };
}
