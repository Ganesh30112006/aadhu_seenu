import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeEnvironment, type FakeEnvironment } from '@/test/fakeSocket';
import { frames } from '@/test/liveFrames';
import { elapsedMs } from './liveSession';
import {
  HEARTBEAT_INTERVAL_MS,
  HIDDEN_DISCONNECT_MS,
  LiveSocketManager,
} from './LiveSocketManager';

let env: FakeEnvironment;
let manager: LiveSocketManager;

const state = () => manager.store.getState();
const segmentIds = (): string[] => state().session.timeline.items.map((item) => item.key);

function connect(): void {
  manager.subscribe('lec-1');
  env.latest().serverOpen();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-19T10:00:00Z'));
  env = createFakeEnvironment(0.5);
  manager = new LiveSocketManager(env.deps);
});

afterEach(() => {
  manager.unsubscribe();
  vi.useRealTimers();
});

describe('LiveSocketManager', () => {
  it('connects, subscribes with last_seq 0 and becomes live', () => {
    manager.subscribe('lec-1');
    expect(state().connection.status).toBe('connecting');
    expect(env.latest().url).toBe('ws://test/ws/lectures/lec-1/live');
    env.latest().serverOpen();
    expect(state().connection.status).toBe('live');
    expect(env.latest().sent).toEqual([{ type: 'subscribe', lecture_id: 'lec-1', last_seq: 0 }]);
  });

  it('applies messages, replaces partials with finals and orders by start_ms', () => {
    connect();
    const socket = env.latest();
    socket.serverSend(frames.partial(1, 's2', 4000, 'Round rob'));
    socket.serverSend(frames.final(2, 's1', 0, 'Today we cover CPU scheduling.'));
    socket.serverSend(frames.final(3, 's2', 4000, 'Round robin uses a time quantum.'));
    expect(segmentIds()).toEqual(['seg:s1', 'seg:s2']);
    expect(state().session.timeline.segments.get('s2')).toMatchObject({ state: 'final' });
    expect(state().lastSeq).toBe(3);
  });

  it('drops invalid frames without crashing and logs them', () => {
    connect();
    const socket = env.latest();
    socket.serverSend('{not json');
    socket.serverSend({ type: 'transcript.final', seq: 1 });
    socket.serverSend({ type: 'mystery', seq: 1 });
    socket.serverSend(frames.final(1, 's1', 0, 'valid'));
    expect(segmentIds()).toEqual(['seg:s1']);
    expect(env.warn).toHaveBeenCalledTimes(3);
  });

  it('acks every rendered transcript event with render.ack, and nothing else', () => {
    connect();
    const socket = env.latest();
    socket.serverSend(frames.partial(1, 's1', 0, 'Round rob'));
    socket.serverSend(frames.final(2, 's1', 0, 'Round robin uses a time quantum.'));
    socket.serverSend(frames.keyTerms(3, [{ id: 't1', term: 'quantum', definition: 'slice' }]));
    socket.serverSend(
      frames.backfill(4, 'gap-1', { start_ms: 4000, end_ms: 8000 }, [
        { id: 's2', startMs: 4000, text: 'Recovered.' },
      ]),
    );
    const acks = socket.sent.filter(
      (frame): frame is { type: string; seq: number; rendered_unix_ms: number } =>
        typeof frame === 'object' &&
        frame !== null &&
        'type' in frame &&
        frame.type === 'render.ack',
    );
    expect(acks.map((a) => a.seq)).toEqual([1, 2, 4]);
    expect(acks.every((a) => a.rendered_unix_ms === Date.now())).toBe(true);
  });

  it('reconnects with backoff and resumes from last_seq without duplicates', () => {
    connect();
    env.latest().serverSend(frames.final(1, 's1', 0, 'one'));
    env.latest().serverSend(frames.final(2, 's2', 4000, 'two'));
    env.latest().serverClose(1006);
    expect(state().connection).toEqual({ status: 'reconnecting', attempt: 1 });

    // attempt 0 with random 0.5 → 250 ms
    vi.advanceTimersByTime(249);
    expect(env.sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(env.sockets).toHaveLength(2);

    const second = env.latest();
    second.serverOpen();
    expect(second.sent).toEqual([{ type: 'subscribe', lecture_id: 'lec-1', last_seq: 2 }]);
    // Server replays seq 2 (already applied) then continues.
    second.serverSend(frames.final(2, 's2', 4000, 'two'));
    second.serverSend(frames.final(3, 's3', 8000, 'three'));
    expect(segmentIds()).toEqual(['seg:s1', 'seg:s2', 'seg:s3']);
    expect(state().connection).toEqual({ status: 'live', attempt: 0 });
  });

  it('fills an offline gap in place when backfill arrives after reconnecting', () => {
    connect();
    const socket = env.latest();
    socket.serverSend(frames.final(1, 's1', 0, 'before'));
    socket.serverSend(frames.gap(2, 'g1', 4000, null));
    socket.serverSend(frames.final(3, 's9', 40_000, 'after reconnect'));
    expect(segmentIds()).toEqual(['seg:s1', 'gap:g1', 'seg:s9']);
    socket.serverSend(frames.gap(4, 'g1', 4000, 40_000));
    socket.serverSend(
      frames.backfill(5, 'g1', { start_ms: 4000, end_ms: 40_000 }, [
        { id: 's2', startMs: 4000, text: 'late one' },
        { id: 's3', startMs: 20_000, text: 'late two' },
      ]),
    );
    expect(segmentIds()).toEqual(['seg:s1', 'seg:s2', 'seg:s3', 'seg:s9']);
    expect(state().session.timeline.segments.get('s2')?.source).toBe('backfill');
  });

  it('caps backoff growth at 30 s', () => {
    env = createFakeEnvironment(0.999_999);
    manager = new LiveSocketManager(env.deps);
    connect();
    for (let i = 0; i < 10; i += 1) {
      env.latest().serverClose(1006);
      vi.advanceTimersByTime(30_000);
    }
    expect(env.sockets).toHaveLength(11);
    env.latest().serverClose(1006);
    vi.advanceTimersByTime(29_998);
    expect(env.sockets).toHaveLength(11);
    vi.advanceTimersByTime(1);
    expect(env.sockets).toHaveLength(12);
    expect(state().connection.status).toBe('connecting');
  });

  it('closes for good on auth failure or after the lecture ends', () => {
    connect();
    env.latest().serverClose(4401);
    expect(state().connection).toEqual({ status: 'closed', attempt: 0, reason: 'unauthorized' });
    vi.advanceTimersByTime(60_000);
    expect(env.sockets).toHaveLength(1);

    manager.unsubscribe();
    connect();
    env.latest().serverSend(frames.status(1, 'completed', 3_000_000));
    env.latest().serverClose(1000);
    expect(state().connection).toEqual({ status: 'closed', attempt: 0, reason: 'ended' });
  });

  it('goes offline with the browser and reconnects immediately when back online', () => {
    connect();
    env.setOnline(false);
    expect(state().connection).toEqual({ status: 'offline', attempt: 0, reason: 'network' });
    expect(env.latest().closed).toBe(true);
    env.setOnline(true);
    expect(state().connection.status).toBe('connecting');
    expect(env.sockets).toHaveLength(2);
  });

  it('disconnects after the tab is hidden for 5 minutes, not before', () => {
    connect();
    env.setVisible(false);
    // The server keeps answering heartbeats, so only the hidden timer can disconnect.
    for (let elapsed = 0; elapsed < HIDDEN_DISCONNECT_MS - 10_000; elapsed += 10_000) {
      vi.advanceTimersByTime(10_000);
      env.latest().serverSend({ type: 'pong', client_ts: Date.now(), server_ts: Date.now() });
    }
    expect(state().connection.status).toBe('live');
    vi.advanceTimersByTime(10_000);
    expect(state().connection).toEqual({ status: 'offline', attempt: 0, reason: 'hidden' });
    env.setVisible(true);
    expect(state().connection.status).toBe('connecting');
  });

  it('pings on an interval and reconnects when the server goes silent', () => {
    connect();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(env.latest().sent).toContainEqual({ type: 'ping', client_ts: Date.now() });
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(state().connection.status).toBe('reconnecting');
  });

  it('measures latency from server_ts using the pong clock offset', () => {
    connect();
    const socket = env.latest();
    const now = Date.now();
    // Server clock is 1000 ms ahead; RTT 0 → offset +1000.
    socket.serverSend({ type: 'pong', client_ts: now, server_ts: now + 1000 });
    socket.serverSend({ ...frames.final(1, 's1', 0, 'x'), server_ts: now + 1000 - 300 });
    expect(state().latencyMs).toBe(300);
  });

  it('starts over when the server asks for a resync', () => {
    connect();
    const socket = env.latest();
    socket.serverSend(frames.final(1, 's1', 0, 'one'));
    socket.serverSend(frames.error(2, 'resync_required'));
    expect(state().session.timeline.items).toHaveLength(0);
    expect(socket.sent.at(-1)).toEqual({ type: 'subscribe', lecture_id: 'lec-1', last_seq: 0 });
  });

  it('tracks status, device, key terms and elapsed time', () => {
    connect();
    const socket = env.latest();
    socket.serverSend(frames.status(1, 'recording', 60_000));
    socket.serverSend(frames.device(2, { psram_buffer_pct: 85 }));
    socket.serverSend(
      frames.keyTerms(3, [{ id: 'k1', term: 'Quantum', definition: 'Time slice' }]),
    );
    const session = state().session;
    expect(session.lectureStatus).toBe('recording');
    expect(session.device?.psram_buffer_pct).toBe(85);
    expect(session.keyTerms.get('k1')?.term).toBe('Quantum');
    expect(elapsedMs(session, Date.now() + 5000)).toBe(65_000);
  });

  it('ignores events from a replaced socket and resets on unsubscribe', () => {
    connect();
    const first = env.latest();
    first.serverClose(1006);
    vi.advanceTimersByTime(1000);
    first.serverSend(frames.final(1, 'ghost', 0, 'stale'));
    expect(segmentIds()).toEqual([]);
    manager.unsubscribe();
    expect(state().lectureId).toBeNull();
    expect(state().connection.status).toBe('idle');
  });
});
