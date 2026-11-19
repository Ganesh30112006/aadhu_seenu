import { createContext, useContext, useEffect } from 'react';
import { useStore } from 'zustand';
import { liveSocketManager } from '@/api/ws/browserDeps';
import type { LiveSocketManager, LiveStoreState } from '@/api/ws/LiveSocketManager';

/** The live connection manager lives outside React; tests provide a fake through this context. */
export const LiveSocketContext = createContext<LiveSocketManager>(liveSocketManager);

export function useLiveManager(): LiveSocketManager {
  return useContext(LiveSocketContext);
}

/** Subscribes to the lecture's live stream for as long as the component is mounted. */
export function useLiveSession(lectureId: string): void {
  const manager = useLiveManager();
  useEffect(() => {
    manager.subscribe(lectureId);
    return () => {
      manager.unsubscribe(lectureId);
    };
  }, [manager, lectureId]);
}

export function useLive<T>(selector: (state: LiveStoreState) => T): T {
  return useStore(useLiveManager().store, selector);
}
