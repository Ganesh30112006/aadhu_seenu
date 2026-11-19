import { useSyncExternalStore } from 'react';

/*
 * One shared 1 Hz clock for "elapsed" and "last seen" labels. Rendering stays pure (no
 * Date.now() during render) and every subscriber ticks together, with a single timer.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let now = Date.now();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const snapshot = (): number => now;

export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
