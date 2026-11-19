import { useImperativeHandle, type ReactNode, type Ref } from 'react';
import { vi } from 'vitest';
import type { VirtualListHandle } from '@/components/VirtualList';

/*
 * Stand-in for '@/components/VirtualList' in component tests:
 *
 *   vi.mock('@/components/VirtualList', () => import('@/test/plainVirtualList'));
 *
 * jsdom has no layout, so a virtualised list can't be windowed or scrolled realistically. This
 * renders every row and records scrollToIndex calls; real scrolling is covered by Playwright.
 */
export const scrollToIndex = vi.fn<(index: number, align?: string) => void>();

export function VirtualList<T>(props: {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  handleRef?: Ref<VirtualListHandle>;
  label: string;
}) {
  useImperativeHandle(props.handleRef, () => ({ scrollToIndex }), []);
  return (
    <div role="list" aria-label={props.label}>
      {props.items.map((item, index) => (
        <div role="listitem" key={props.getKey(item, index)}>
          {props.renderItem(item, index)}
        </div>
      ))}
    </div>
  );
}
