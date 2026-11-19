import { ws } from 'msw';
import { z } from 'zod';
import { env } from '@/lib/env';
import { currentUser, getDb } from '../db';
import { dueEvents, ensureRun, isFinished, onDrop, syncLecture } from './simulator';

const ClientFrame = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    lecture_id: z.string(),
    last_seq: z.number().int().min(0),
  }),
  z.object({ type: z.literal('ping'), client_ts: z.number() }),
]);

const FLUSH_INTERVAL_MS = 200;

export const liveLink = ws.link(`${env.wsBaseUrl}/ws/lectures/:lectureId/live`);

/** Mock of wss://<host>/ws/lectures/{lecture_id}/live implementing the agreed protocol. */
export const liveHandler = liveLink.addEventListener('connection', ({ client, params }) => {
  const lectureId = String(params.lectureId);
  if (currentUser() === null) {
    client.close(4401, 'not authenticated');
    return;
  }
  const lecture = getDb().lectures.find((l) => l.id === lectureId);
  if (lecture === undefined) {
    client.close(4404, 'lecture not found');
    return;
  }

  let lastSent = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const flush = (): void => {
    syncLecture(lecture);
    const run = ensureRun(lecture);
    if (run === null) {
      // Lecture is already over: report its final state and close normally.
      client.send(
        JSON.stringify({
          type: 'lecture.status',
          seq: lastSent + 1,
          server_ts: Date.now(),
          status: lecture.status,
          duration_ms: lecture.duration_ms,
        }),
      );
      stop();
      client.close(1000, 'lecture ended');
      return;
    }
    for (const event of dueEvents(run, lastSent)) {
      client.send(JSON.stringify({ ...event.body, seq: event.seq, server_ts: Date.now() }));
      lastSent = event.seq;
    }
    if (isFinished(run)) {
      stop();
      client.close(1000, 'lecture ended');
    }
  };

  const unsubscribeDrop = onDrop((id) => {
    if (id !== lectureId) return;
    stop();
    client.close(4000, 'simulated server restart');
  });

  client.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    let json: unknown;
    try {
      json = JSON.parse(event.data);
    } catch {
      return;
    }
    const frame = ClientFrame.safeParse(json);
    if (!frame.success) return;
    if (frame.data.type === 'ping') {
      client.send(
        JSON.stringify({ type: 'pong', client_ts: frame.data.client_ts, server_ts: Date.now() }),
      );
      return;
    }
    lastSent = frame.data.last_seq;
    flush();
    stop();
    timer = setInterval(flush, FLUSH_INTERVAL_MS);
  });

  client.addEventListener('close', () => {
    stop();
    unsubscribeDrop();
  });
});
