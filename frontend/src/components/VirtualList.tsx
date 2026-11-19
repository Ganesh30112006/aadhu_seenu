import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useImperativeHandle, useState, type ReactNode, type Ref } from 'react';
import { cx } from '@/lib/cx';
import styles from './VirtualList.module.css';

export interface VirtualListHandle {
  scrollToIndex: (index: number, align?: 'start' | 'center' | 'end' | 'auto') => void;
}

interface VirtualListProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  estimateSize: (index: number) => number;
  renderItem: (item: T, index: number) => ReactNode;
  overscan?: number;
  /** Called with the last rendered index (infinite loading, "new lines" counters). */
  onRangeChange?: (lastIndex: number) => void;
  handleRef?: Ref<VirtualListHandle>;
  className?: string | undefined;
  label: string;
}

/** Distance from the top of the document to the list, kept current as content above changes. */
function useScrollMargin() {
  const [margin, setMargin] = useState(0);
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (node === null) return undefined;
    const measure = (): void => {
      setMargin(Math.round(node.getBoundingClientRect().top + window.scrollY));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, margin] as const;
}

/**
 * Window-scrolled virtual list with dynamic row heights (long transcript lines wrap differently
 * per script and screen width). Rows are list items with position info for screen readers.
 */
export function VirtualList<T>({
  items,
  getKey,
  estimateSize,
  renderItem,
  overscan = 8,
  onRangeChange,
  handleRef,
  className,
  label,
}: VirtualListProps<T>) {
  const [listRef, scrollMargin] = useScrollMargin();
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize,
    overscan,
    scrollMargin,
    getItemKey: (index) => {
      const item = items[index];
      return item === undefined ? index : getKey(item, index);
    },
    onChange: (instance) => {
      const last = instance.getVirtualItems().at(-1);
      if (last !== undefined) onRangeChange?.(last.index);
    },
  });

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToIndex: (index, align = 'center') => {
        virtualizer.scrollToIndex(index, { align });
      },
    }),
    [virtualizer],
  );

  return (
    <div
      ref={listRef}
      role="list"
      aria-label={label}
      className={cx(styles.list, className)}
      // Inline style exception: the virtualizer computes the list height at runtime.
      // eslint-disable-next-line no-restricted-syntax
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const item = items[row.index];
        if (item === undefined) return null;
        return (
          <div
            key={row.key}
            role="listitem"
            aria-setsize={items.length}
            aria-posinset={row.index + 1}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className={styles.row}
            // Inline style exception: runtime row offset computed by the virtualizer.
            // eslint-disable-next-line no-restricted-syntax
            style={{ transform: `translateY(${String(row.start - scrollMargin)}px)` }}
          >
            {renderItem(item, row.index)}
          </div>
        );
      })}
    </div>
  );
}
