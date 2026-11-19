import { CloseCode } from './messages';

/*
 * Pure connection state machine. LiveSocketManager feeds it events and executes the effects it
 * returns; keeping the transitions pure makes every edge unit-testable without sockets or timers.
 */

export type ConnectionStatus =
  'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline' | 'closed';
export type OfflineReason = 'network' | 'hidden';
export type ClosedReason = 'ended' | 'unauthorized' | 'not_found';

export type ConnectionState =
  | { status: 'idle'; attempt: 0 }
  | { status: 'connecting'; attempt: number }
  | { status: 'live'; attempt: number }
  | { status: 'reconnecting'; attempt: number }
  | { status: 'offline'; attempt: 0; reason: OfflineReason }
  | { status: 'closed'; attempt: 0; reason: ClosedReason };

export type ConnectionEvent =
  | { type: 'SUBSCRIBE'; online: boolean }
  | { type: 'SOCKET_OPEN' }
  | { type: 'MESSAGE_RECEIVED' }
  | { type: 'SOCKET_CLOSED'; code: number; lectureEnded: boolean }
  | { type: 'RETRY_TIMER' }
  | { type: 'HEARTBEAT_TIMEOUT' }
  | { type: 'NETWORK_OFFLINE' }
  | { type: 'NETWORK_ONLINE' }
  | { type: 'HIDDEN_TIMEOUT' }
  | { type: 'VISIBLE'; online: boolean }
  | { type: 'UNSUBSCRIBE' };

export type ConnectionEffect =
  | { type: 'OPEN_SOCKET' }
  | { type: 'SEND_SUBSCRIBE' }
  | { type: 'CLOSE_SOCKET' }
  | { type: 'SCHEDULE_RETRY'; attempt: number }
  | { type: 'CANCEL_RETRY' }
  | { type: 'START_HEARTBEAT' }
  | { type: 'STOP_HEARTBEAT' };

export interface Transition {
  state: ConnectionState;
  effects: ConnectionEffect[];
}

export const INITIAL_CONNECTION: ConnectionState = { status: 'idle', attempt: 0 };

const TEARDOWN: ConnectionEffect[] = [
  { type: 'CLOSE_SOCKET' },
  { type: 'CANCEL_RETRY' },
  { type: 'STOP_HEARTBEAT' },
];

const stay = (state: ConnectionState): Transition => ({ state, effects: [] });
const connect = (attempt: number): Transition => ({
  state: { status: 'connecting', attempt },
  effects: [{ type: 'OPEN_SOCKET' }],
});

function isActive(state: ConnectionState): boolean {
  return (
    state.status === 'connecting' || state.status === 'live' || state.status === 'reconnecting'
  );
}

function onSocketClosed(state: ConnectionState, code: number, lectureEnded: boolean): Transition {
  if (state.status !== 'connecting' && state.status !== 'live') return stay(state);
  const stopHeartbeat: ConnectionEffect = { type: 'STOP_HEARTBEAT' };
  if (code === CloseCode.unauthenticated || code === CloseCode.forbidden) {
    return {
      state: { status: 'closed', attempt: 0, reason: 'unauthorized' },
      effects: [stopHeartbeat],
    };
  }
  if (code === CloseCode.notFound) {
    return {
      state: { status: 'closed', attempt: 0, reason: 'not_found' },
      effects: [stopHeartbeat],
    };
  }
  if (code === CloseCode.normal && lectureEnded) {
    return { state: { status: 'closed', attempt: 0, reason: 'ended' }, effects: [stopHeartbeat] };
  }
  const attempt = state.attempt + 1;
  return {
    state: { status: 'reconnecting', attempt },
    effects: [stopHeartbeat, { type: 'SCHEDULE_RETRY', attempt: attempt - 1 }],
  };
}

export function transition(state: ConnectionState, event: ConnectionEvent): Transition {
  switch (event.type) {
    case 'SUBSCRIBE':
      if (!event.online) {
        return { state: { status: 'offline', attempt: 0, reason: 'network' }, effects: [] };
      }
      return connect(0);

    case 'UNSUBSCRIBE':
      return { state: INITIAL_CONNECTION, effects: TEARDOWN };

    case 'SOCKET_OPEN':
      if (state.status !== 'connecting') return stay(state);
      return {
        state: { status: 'live', attempt: state.attempt },
        effects: [{ type: 'SEND_SUBSCRIBE' }, { type: 'START_HEARTBEAT' }],
      };

    case 'MESSAGE_RECEIVED':
      // A valid message proves the connection works: only now reset the backoff.
      if (state.status === 'live' && state.attempt !== 0)
        return stay({ status: 'live', attempt: 0 });
      return stay(state);

    case 'SOCKET_CLOSED':
      return onSocketClosed(state, event.code, event.lectureEnded);

    case 'HEARTBEAT_TIMEOUT':
      if (state.status !== 'live') return stay(state);
      return {
        state: { status: 'reconnecting', attempt: state.attempt + 1 },
        effects: [
          { type: 'CLOSE_SOCKET' },
          { type: 'STOP_HEARTBEAT' },
          { type: 'SCHEDULE_RETRY', attempt: state.attempt },
        ],
      };

    case 'RETRY_TIMER':
      return state.status === 'reconnecting' ? connect(state.attempt) : stay(state);

    case 'NETWORK_OFFLINE':
      if (!isActive(state)) return stay(state);
      return { state: { status: 'offline', attempt: 0, reason: 'network' }, effects: TEARDOWN };

    case 'HIDDEN_TIMEOUT':
      if (!isActive(state)) return stay(state);
      return { state: { status: 'offline', attempt: 0, reason: 'hidden' }, effects: TEARDOWN };

    case 'NETWORK_ONLINE':
      return state.status === 'offline' && state.reason === 'network' ? connect(0) : stay(state);

    case 'VISIBLE':
      if (state.status !== 'offline' || state.reason !== 'hidden') return stay(state);
      return event.online ? connect(0) : stay({ status: 'offline', attempt: 0, reason: 'network' });
  }
}
