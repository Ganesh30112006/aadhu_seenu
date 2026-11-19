import { describe, expect, it } from 'vitest';
import { backoffDelay, BACKOFF_CAP_MS } from './backoff';
import { INITIAL_CONNECTION, transition, type ConnectionState } from './connectionMachine';

const live: ConnectionState = { status: 'live', attempt: 0 };

describe('connection state machine', () => {
  it('subscribe → connecting → live, sending subscribe and starting the heartbeat', () => {
    const a = transition(INITIAL_CONNECTION, { type: 'SUBSCRIBE', online: true });
    expect(a.state.status).toBe('connecting');
    expect(a.effects).toEqual([{ type: 'OPEN_SOCKET' }]);
    const b = transition(a.state, { type: 'SOCKET_OPEN' });
    expect(b.state.status).toBe('live');
    expect(b.effects).toEqual([{ type: 'SEND_SUBSCRIBE' }, { type: 'START_HEARTBEAT' }]);
  });

  it('starts offline when the browser is offline', () => {
    const t = transition(INITIAL_CONNECTION, { type: 'SUBSCRIBE', online: false });
    expect(t.state).toEqual({ status: 'offline', attempt: 0, reason: 'network' });
    expect(t.effects).toEqual([]);
  });

  it('retryable close → reconnecting with increasing attempts', () => {
    const a = transition(live, { type: 'SOCKET_CLOSED', code: 1006, lectureEnded: false });
    expect(a.state).toEqual({ status: 'reconnecting', attempt: 1 });
    expect(a.effects).toContainEqual({ type: 'SCHEDULE_RETRY', attempt: 0 });
    const b = transition(a.state, { type: 'RETRY_TIMER' });
    expect(b.state).toEqual({ status: 'connecting', attempt: 1 });
    const c = transition(b.state, { type: 'SOCKET_CLOSED', code: 1006, lectureEnded: false });
    expect(c.state).toEqual({ status: 'reconnecting', attempt: 2 });
    expect(c.effects).toContainEqual({ type: 'SCHEDULE_RETRY', attempt: 1 });
  });

  it('resets the attempt counter only after a valid message, not on open', () => {
    const opened = transition({ status: 'connecting', attempt: 3 }, { type: 'SOCKET_OPEN' });
    expect(opened.state).toEqual({ status: 'live', attempt: 3 });
    const message = transition(opened.state, { type: 'MESSAGE_RECEIVED' });
    expect(message.state).toEqual({ status: 'live', attempt: 0 });
  });

  it.each([
    [4401, 'unauthorized'],
    [4403, 'unauthorized'],
    [4404, 'not_found'],
  ] as const)('close code %d → closed (%s), no retry', (code, reason) => {
    const t = transition(live, { type: 'SOCKET_CLOSED', code, lectureEnded: false });
    expect(t.state).toEqual({ status: 'closed', attempt: 0, reason });
    expect(t.effects.some((e) => e.type === 'SCHEDULE_RETRY')).toBe(false);
  });

  it('normal close after the lecture ended → closed (ended); otherwise retry', () => {
    expect(
      transition(live, { type: 'SOCKET_CLOSED', code: 1000, lectureEnded: true }).state,
    ).toEqual({
      status: 'closed',
      attempt: 0,
      reason: 'ended',
    });
    expect(
      transition(live, { type: 'SOCKET_CLOSED', code: 1000, lectureEnded: false }).state.status,
    ).toBe('reconnecting');
  });

  it('goes offline on network loss from any active state and back on reconnect', () => {
    for (const state of [
      live,
      { status: 'connecting', attempt: 2 },
      { status: 'reconnecting', attempt: 2 },
    ] as const) {
      const t = transition(state, { type: 'NETWORK_OFFLINE' });
      expect(t.state).toEqual({ status: 'offline', attempt: 0, reason: 'network' });
      expect(t.effects).toEqual([
        { type: 'CLOSE_SOCKET' },
        { type: 'CANCEL_RETRY' },
        { type: 'STOP_HEARTBEAT' },
      ]);
    }
    const back = transition(
      { status: 'offline', attempt: 0, reason: 'network' },
      { type: 'NETWORK_ONLINE' },
    );
    expect(back.state).toEqual({ status: 'connecting', attempt: 0 });
  });

  it('pauses after the tab is hidden too long and resumes when visible', () => {
    const hidden = transition(live, { type: 'HIDDEN_TIMEOUT' });
    expect(hidden.state).toEqual({ status: 'offline', attempt: 0, reason: 'hidden' });
    expect(transition(hidden.state, { type: 'NETWORK_ONLINE' }).state).toBe(hidden.state);
    expect(transition(hidden.state, { type: 'VISIBLE', online: true }).state.status).toBe(
      'connecting',
    );
    expect(transition(hidden.state, { type: 'VISIBLE', online: false }).state).toEqual({
      status: 'offline',
      attempt: 0,
      reason: 'network',
    });
  });

  it('heartbeat timeout forces a reconnect', () => {
    const t = transition(live, { type: 'HEARTBEAT_TIMEOUT' });
    expect(t.state.status).toBe('reconnecting');
    expect(t.effects).toContainEqual({ type: 'CLOSE_SOCKET' });
  });

  it('closed is terminal until unsubscribe', () => {
    const closed: ConnectionState = { status: 'closed', attempt: 0, reason: 'ended' };
    for (const type of [
      'NETWORK_ONLINE',
      'RETRY_TIMER',
      'HEARTBEAT_TIMEOUT',
      'HIDDEN_TIMEOUT',
    ] as const) {
      expect(transition(closed, { type }).state).toBe(closed);
    }
    expect(transition(closed, { type: 'UNSUBSCRIBE' }).state).toEqual(INITIAL_CONNECTION);
  });

  it('ignores socket events in states that do not expect them', () => {
    const reconnecting: ConnectionState = { status: 'reconnecting', attempt: 1 };
    expect(transition(reconnecting, { type: 'SOCKET_OPEN' }).state).toBe(reconnecting);
    expect(
      transition(reconnecting, { type: 'SOCKET_CLOSED', code: 1006, lectureEnded: false }).state,
    ).toBe(reconnecting);
  });
});

describe('backoffDelay', () => {
  it('grows exponentially with full jitter and caps at 30 s', () => {
    const max = (): number => 0.999_999;
    expect(backoffDelay(0, max)).toBe(499);
    expect(backoffDelay(1, max)).toBe(999);
    expect(backoffDelay(5, max)).toBe(15_999);
    expect(backoffDelay(6, max)).toBe(BACKOFF_CAP_MS - 1);
    expect(backoffDelay(50, max)).toBe(BACKOFF_CAP_MS - 1);
    expect(backoffDelay(3, () => 0)).toBe(0);
    expect(backoffDelay(3, () => 0.5)).toBe(2000);
  });
});
