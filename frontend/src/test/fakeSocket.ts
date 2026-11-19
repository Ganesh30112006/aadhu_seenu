import { vi } from 'vitest';
import type { LiveSocket, LiveSocketDeps } from '@/api/ws/LiveSocketManager';

/** In-memory WebSocket double: records sent frames and lets tests drive server events. */
export class FakeSocket implements LiveSocket {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: unknown[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
  }

  serverOpen(): void {
    this.onopen?.(new Event('open'));
  }

  serverSend(frame: unknown): void {
    const data = typeof frame === 'string' ? frame : JSON.stringify(frame);
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  serverClose(code = 1006): void {
    this.closed = true;
    this.onclose?.(new CloseEvent('close', { code }));
  }
}

export interface FakeEnvironment {
  deps: LiveSocketDeps;
  /** The logger's warn spy (exposed separately so tests don't reference an unbound method). */
  warn: ReturnType<typeof vi.fn>;
  sockets: FakeSocket[];
  latest(): FakeSocket;
  setVisible(visible: boolean): void;
  setOnline(online: boolean): void;
}

/**
 * Deterministic dependencies for LiveSocketManager. Use with vi.useFakeTimers():
 * time is Date.now() (faked), jitter is fixed by `random`, flushes are synchronous.
 */
export function createFakeEnvironment(random = 0.5): FakeEnvironment {
  const sockets: FakeSocket[] = [];
  let visible = true;
  let online = true;
  const visibilityListeners = new Set<(v: boolean) => void>();
  const networkListeners = new Set<(o: boolean) => void>();
  const warn = vi.fn();

  const deps: LiveSocketDeps = {
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    buildUrl: (id) => `ws://test/ws/lectures/${id}/live`,
    now: () => Date.now(),
    random: () => random,
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => {
      clearTimeout(handle);
    },
    scheduleFlush: (callback) => {
      callback();
    },
    visibility: {
      isVisible: () => visible,
      subscribe: (listener) => {
        visibilityListeners.add(listener);
        return () => visibilityListeners.delete(listener);
      },
    },
    network: {
      isOnline: () => online,
      subscribe: (listener) => {
        networkListeners.add(listener);
        return () => networkListeners.delete(listener);
      },
    },
    logger: { warn, error: vi.fn() },
  };

  return {
    deps,
    warn,
    sockets,
    latest: () => {
      const socket = sockets.at(-1);
      if (socket === undefined) throw new Error('no socket was created');
      return socket;
    },
    setVisible: (value) => {
      visible = value;
      for (const listener of visibilityListeners) listener(value);
    },
    setOnline: (value) => {
      online = value;
      for (const listener of networkListeners) listener(value);
    },
  };
}
