import { useEffect, useRef } from 'react';

/**
 * Moves keyboard focus to a deep-linked transcript line (?seg= or the line at ?t=), once per link
 * and only after every page has loaded, so keyboard and screen-reader users land where the link
 * points, not just sighted users.
 */
export function useFocusLinkedRow(fullyLoaded: boolean, segmentId: string | null): void {
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!fullyLoaded || segmentId === null || focused.current === segmentId) return;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-segment-id="${CSS.escape(segmentId)}"] button`,
      );
      if (target !== null) {
        target.focus({ preventScroll: true });
        focused.current = segmentId;
      }
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [fullyLoaded, segmentId]);
}
