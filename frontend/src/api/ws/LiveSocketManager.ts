import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Logger } from '@/lib/logger';
import { backoffDelay } from './backoff';
import {
  INITIAL_CONNECTION,
  transition,
  type ConnectionEffect,
  type ConnectionEvent,
  type ConnectionState,
} from './connectionMachine';
import { applyMessage, EMPTY_SESSION, type LiveSession } from './liveSession';
import { parseServerFrame, type ClientFrame } from './messages';

/** Minimal WebSocket surface the manager needs (the browser WebSocket satisfies it). */
export interface LiveSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export type TimerHandle = ReturnType<typeof setTimeout>;

export interface LiveSocketDeps {
  createSocket(url: string): LiveSocket;
  buildUrl(lectureId: string): string;
  now(): number;
  random(): number;
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  /** Coalesces store updates (one per animation frame in the browser). */
  scheduleFlush(callback: () => void): void;
  visibility: { isVisible(): boolean; subscribe(listener: (visible: boolean) => void): () => void };
  network: { isOnline(): boolean; subscribe(listener: (online: boolean) => void): () => void };
  logger: Logger;
}

export interface LiveStoreState {
  lectureId: string | null;
  connection: ConnectionState;
  /** Client time of the next reconnect attempt, for "retrying in 8 s". */
  retryAt: number | null;
  /** Smoothed server→client delivery latency; null until a frame with server_ts arrives. */
  latencyMs: number | null;
  lastSeq: number;
  session: LiveSession;
}

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_TIMEOUT_MS = 35_000;
export const HIDDEN_DISCONNECT_MS = 5 * 60_000;
const LATENCY_SMOOTHING = 0.3;
const CLOSE_NORMAL = 1000;

const initialStoreState = (): LiveStoreState => ({
  lectureId: null,
  connection: INITIAL_CONNECTION,
  retryAt: null,
  latencyMs: null,
  lastSeq: 0,
  session: EMPTY_SESSION,
});

/**
 * Owns the single live-lecture WebSocket. Lives outside React; components read `store` through
 * hooks. Guarantees: reconnect with jittered backoff, resume via last_seq without loss or
 * duplicates, segment ordering by start_ms, and no crash on invalid frames.
 */
export class LiveSocketManager {
  readonly store: StoreApi<LiveStoreState> = createStore<LiveStoreState>(initialStoreState);

  private state: ConnectionState = INITIAL_CONNECTION;
  private lectureId: string | null = null;
  private socket: LiveSocket | null = null;
  private lastSeq = 0;
  private session: LiveSession = EMPTY_SESSION;
  private latencyMs: number | null = null;
  private clockOffsetMs: number | null = null;
  private lastFrameAt = 0;
  private flushPending = false;
  private renderAcks: number[] = [];
  private retryTimer: TimerHandle | null = null;
  private heartbeatTimer: TimerHandle | null = null;
  private hiddenTimer: TimerHandle | null = null;
  private unlisten: (() => void)[] = [];

  constructor(private readonly deps: LiveSocketDeps) {}

  subscribe(lectureId: string): void {
    if (this.lectureId === lectureId && this.state.status !== 'idle') return;
    if (this.lectureId !== null) this.unsubscribe();
    this.lectureId = lectureId;
    this.lastSeq = 0;
    this.session = EMPTY_SESSION;
    this.latencyMs = null;
    this.store.setState({ ...initialStoreState(), lectureId });
    this.unlisten = [
      this.deps.visibility.subscribe((visible) => {
        this.onVisibilityChange(visible);
      }),
      this.deps.network.subscribe((online) => {
        this.dispatch({ type: online ? 'NETWORK_ONLINE' : 'NETWORK_OFFLINE' });
      }),
    ];
    if (!this.deps.visibility.isVisible()) this.startHiddenTimer();
    this.dispatch({ type: 'SUBSCRIBE', online: this.deps.network.isOnline() });
  }

  /** Stops the live session. Pass the id to ignore a stale unsubscribe for another lecture. */
  unsubscribe(lectureId?: string): void {
    if (lectureId !== undefined && lectureId !== this.lectureId) return;
    this.dispatch({ type: 'UNSUBSCRIBE' });
    for (const stop of this.unlisten) stop();
    this.unlisten = [];
    this.clearHiddenTimer();
    this.lectureId = null;
    this.session = EMPTY_SESSION;
    this.store.setState(initialStoreState());
  }

  /** User asked to resume after the tab was in the background too long. */
  resume(): void {
    this.clearHiddenTimer();
    this.dispatch({ type: 'VISIBLE', online: this.deps.network.isOnline() });
  }

  private dispatch(event: ConnectionEvent): void {
    const { state, effects } = transition(this.state, event);
    const changed = state !== this.state;
    this.state = state;
    for (const effect of effects) this.run(effect);
    if (changed) {
      this.store.setState({
        connection: state,
        retryAt: state.status === 'reconnecting' ? this.store.getState().retryAt : null,
      });
    }
  }

  private run(effect: ConnectionEffect): void {
    switch (effect.type) {
      case 'OPEN_SOCKET':
        this.openSocket();
        break;
      case 'SEND_SUBSCRIBE':
        if (this.lectureId !== null) {
          this.send({ type: 'subscribe', lecture_id: this.lectureId, last_seq: this.lastSeq });
        }
        break;
      case 'CLOSE_SOCKET':
        this.closeSocket();
        break;
      case 'SCHEDULE_RETRY': {
        this.cancelRetry();
        const delay = backoffDelay(effect.attempt, () => this.deps.random());
        this.store.setState({ retryAt: this.deps.now() + delay });
        this.retryTimer = this.deps.setTimeout(() => {
          this.retryTimer = null;
          this.dispatch({ type: 'RETRY_TIMER' });
        }, delay);
        break;
      }
      case 'CANCEL_RETRY':
        this.cancelRetry();
        break;
      case 'START_HEARTBEAT':
        this.lastFrameAt = this.deps.now();
        this.scheduleHeartbeat();
        break;
      case 'STOP_HEARTBEAT':
        if (this.heartbeatTimer !== null) this.deps.clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = null;
        break;
    }
  }

  private openSocket(): void {
    this.closeSocket();
    if (this.lectureId === null) return;
    const socket = this.deps.createSocket(this.deps.buildUrl(this.lectureId));
    this.socket = socket;
    // Every handler checks identity, so events from a replaced socket are ignored.
    socket.onopen = () => {
      if (this.socket === socket) this.dispatch({ type: 'SOCKET_OPEN' });
    };
    socket.onmessage = (event) => {
      if (this.socket === socket) this.onFrame(event.data);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      const status = this.session.lectureStatus;
      this.dispatch({
        type: 'SOCKET_CLOSED',
        code: event.code,
        lectureEnded: status === 'completed' || status === 'failed',
      });
    };
    socket.onerror = () => {
      // A close event always follows; reconnection is handled there.
    };
  }

  private closeSocket(): void {
    const socket = this.socket;
    if (socket === null) return;
    this.socket = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close(CLOSE_NORMAL, 'client closing');
    } catch (error) {
      this.deps.logger.warn('closing socket failed', error);
    }
  }

  private send(frame: ClientFrame): void {
    try {
      this.socket?.send(JSON.stringify(frame));
    } catch (error) {
      this.deps.logger.warn('send failed', error);
    }
  }

  private onFrame(raw: unknown): void {
    const now = this.deps.now();
    this.lastFrameAt = now;
    const parsed = parseServerFrame(raw);
    if (!parsed.ok) {
      this.deps.logger.warn(`dropped invalid live frame: ${parsed.reason}`);
      return;
    }
    const message = parsed.message;
    if (message.type === 'pong') {
      const rtt = Math.max(0, now - message.client_ts);
      const offset = message.server_ts - (message.client_ts + rtt / 2);
      this.clockOffsetMs = this.clockOffsetMs === null ? offset : (this.clockOffsetMs + offset) / 2;
      return;
    }
    if (message.seq <= this.lastSeq) return; // duplicate after resume
    if (message.seq > this.lastSeq + 1) {
      this.deps.logger.warn(`live seq gap: expected ${this.lastSeq + 1}, got ${message.seq}`);
    }
    if (message.type === 'error' && message.code === 'resync_required') {
      // Server can no longer replay from our last_seq: start over from the beginning.
      this.lastSeq = 0;
      this.session = EMPTY_SESSION;
      if (this.lectureId !== null) {
        this.send({ type: 'subscribe', lecture_id: this.lectureId, last_seq: 0 });
      }
      this.markDirty();
      return;
    }
    this.session = applyMessage(this.session, message, now);
    this.lastSeq = message.seq;
    // Every transcript event the user can see is acknowledged once it is on screen (stage 6).
    if (
      message.type === 'transcript.partial' ||
      message.type === 'transcript.final' ||
      message.type === 'transcript.backfill'
    ) {
      this.renderAcks.push(message.seq);
    }
    if (message.server_ts !== undefined) this.recordLatency(now, message.server_ts);
    this.dispatch({ type: 'MESSAGE_RECEIVED' });
    this.markDirty();
  }

  private recordLatency(receivedAt: number, serverTs: number): void {
    const sample = Math.max(0, receivedAt + (this.clockOffsetMs ?? 0) - serverTs);
    this.latencyMs =
      this.latencyMs === null
        ? sample
        : this.latencyMs + LATENCY_SMOOTHING * (sample - this.latencyMs);
  }

  private markDirty(): void {
    if (this.flushPending) return;
    this.flushPending = true;
    this.deps.scheduleFlush(() => {
      this.flushPending = false;
      if (this.lectureId === null) return;
      this.store.setState({
        session: this.session,
        lastSeq: this.lastSeq,
        latencyMs: this.latencyMs === null ? null : Math.round(this.latencyMs),
      });
      const rendered = this.renderAcks.splice(0);
      if (rendered.length > 0) {
        // One frame after the store update, the new lines are on screen: report it (stage 6).
        this.deps.scheduleFlush(() => {
          for (const seq of rendered)
            this.send({ type: 'render.ack', seq, rendered_unix_ms: this.deps.now() });
        });
      }
    });
  }

  private scheduleHeartbeat(): void {
    if (this.heartbeatTimer !== null) this.deps.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = this.deps.setTimeout(() => {
      this.heartbeatTimer = null;
      if (this.state.status !== 'live') return;
      if (this.deps.now() - this.lastFrameAt > HEARTBEAT_TIMEOUT_MS) {
        this.deps.logger.warn('live heartbeat missed; reconnecting');
        this.dispatch({ type: 'HEARTBEAT_TIMEOUT' });
        return;
      }
      this.send({ type: 'ping', client_ts: this.deps.now() });
      this.scheduleHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private onVisibilityChange(visible: boolean): void {
    if (!visible) {
      this.startHiddenTimer();
      return;
    }
    this.clearHiddenTimer();
    this.dispatch({ type: 'VISIBLE', online: this.deps.network.isOnline() });
    // Phones often kill sockets silently in the background: probe immediately on return.
    if (this.state.status === 'live') this.send({ type: 'ping', client_ts: this.deps.now() });
  }

  private startHiddenTimer(): void {
    if (this.hiddenTimer !== null) return;
    this.hiddenTimer = this.deps.setTimeout(() => {
      this.hiddenTimer = null;
      this.dispatch({ type: 'HIDDEN_TIMEOUT' });
    }, HIDDEN_DISCONNECT_MS);
  }

  private clearHiddenTimer(): void {
    if (this.hiddenTimer !== null) this.deps.clearTimeout(this.hiddenTimer);
    this.hiddenTimer = null;
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) this.deps.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
