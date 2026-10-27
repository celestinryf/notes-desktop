import { useCallback, useLayoutEffect, useRef } from 'react';
import { measureElement, useVirtualizer } from '@tanstack/react-virtual';
import type { Virtualizer } from '@tanstack/react-virtual';

const OVERSCAN = 16;

export type Reveal = { reveal: (index: number) => void };
export type RowSizes<K extends string> = { keys: readonly string[]; sizes: readonly K[] };

type LearnedSize = { size: number; seen: Map<number, number> };

function learn(learned: LearnedSize, size: number) {
  const times = (learned.seen.get(size) || 0) + 1;
  learned.seen.set(size, times);
  if (times > (learned.seen.get(learned.size) || 0)) learned.size = size;
}

export function Gap({ tag, height }: { tag: 'li' | 'div'; height: number }) {
  if (height <= 0) return null;
  const Tag = tag;
  return <Tag className="virtual-gap" role="presentation" aria-hidden="true" style={{ height }} />;
}

export function useVirtualRows<E extends HTMLElement, K extends string>(rows: RowSizes<K>, scroller: HTMLElement, guesses: Readonly<Record<K, number>>, handle: Reveal) {
  const { keys, sizes } = rows;
  const learned = useRef(new Map<K, LearnedSize>());
  const sizeOf = (kind: K) => {
    let size = learned.current.get(kind);
    if (!size) { size = { size: guesses[kind], seen: new Map() }; learned.current.set(kind, size); }
    return size;
  };
  const getItemKey = useCallback((i: number) => keys[i], [keys]);
  const estimateSize = useCallback((i: number) => sizeOf(sizes[i]).size, [sizes]);
  const measure = useCallback((el: E, entry: ResizeObserverEntry | undefined, instance: Virtualizer<HTMLElement, E>) => {
    const size = measureElement(el, entry, instance);
    const index = instance.indexFromElement(el);
    if (entry && size > 0 && index >= 0 && index < sizes.length) learn(sizeOf(sizes[index]), size);
    return size;
  }, [sizes]);
  const list = useVirtualizer<HTMLElement, E>({
    count: keys.length,
    getScrollElement: () => scroller,
    estimateSize,
    getItemKey,
    measureElement: measure,
    overscan: OVERSCAN,
  });
  useLayoutEffect(() => { handle.reveal = (index) => list.scrollToIndex(index, { align: 'auto' }); });
  const items = list.getVirtualItems();
  return {
    items,
    before: items.length ? items[0].start : 0,
    after: items.length ? list.getTotalSize() - items[items.length - 1].end : 0,
    total: list.getTotalSize(),
    measureElement: list.measureElement,
  };
}
