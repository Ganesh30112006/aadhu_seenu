import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LiveSocketManager } from '@/api/ws/LiveSocketManager';
import { createFakeEnvironment, type FakeEnvironment } from '@/test/fakeSocket';
import { LECTURE_IDS } from '@/test/fixtures/lectures';
import { frames } from '@/test/liveFrames';
import { renderApp, type SignedInAs } from '@/test/renderApp';

vi.mock('@/components/VirtualList', () => import('@/test/plainVirtualList'));

const LIVE = LECTURE_IDS.schedulingLive;

async function openLive(as: SignedInAs = 'arjun') {
  const env: FakeEnvironment = createFakeEnvironment();
  const manager = new LiveSocketManager(env.deps);
  const view = renderApp(`/lectures/${LIVE}/live`, { as, live: manager });
  await screen.findByRole('heading', { name: 'CPU Scheduling Algorithms (Section B)' });
  await waitFor(() => {
    expect(env.sockets.length).toBeGreaterThan(0);
  });
  act(() => {
    env.latest().serverOpen();
  });
  /** Sends server frames on the current socket, inside act() so React renders them. */
  const send = (...list: unknown[]): void => {
    act(() => {
      for (const frame of list) env.latest().serverSend(frame);
    });
  };
  return { ...view, env, manager, send };
}

describe('LiveLectureRoute', () => {
  it('subscribes and shows streamed lines, replacing partials with finals', async () => {
    const { env, send } = await openLive();
    expect(env.latest().sent[0]).toEqual({ type: 'subscribe', lecture_id: LIVE, last_seq: 0 });
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);

    send(frames.partial(1, 's1', 0, 'Today we cover CPU sched'));
    expect(screen.getByText('Today we cover CPU sched')).toBeInTheDocument();
    send(frames.final(2, 's1', 0, 'Today we cover CPU scheduling.'));
    expect(screen.getByText('Today we cover CPU scheduling.')).toBeInTheDocument();
    expect(screen.queryByText('Today we cover CPU sched')).not.toBeInTheDocument();
  });

  it('shows a syncing gap and fills it in place when the audio arrives', async () => {
    const { send } = await openLive();
    send(
      frames.final(1, 's1', 0, 'Before the outage.'),
      frames.gap(2, 'gap-1', 632_000, null),
      frames.final(3, 's3', 812_000, 'After the outage.'),
    );
    expect(screen.getByText('Audio from 10:32 syncing…')).toBeInTheDocument();

    send(
      frames.backfill(4, 'gap-1', { start_ms: 632_000, end_ms: 812_000 }, [
        { id: 's2', startMs: 640_000, text: 'Said while offline.' },
      ]),
    );
    expect(screen.queryByText(/syncing…$/)).not.toBeInTheDocument();
    const lines = screen.getAllByText(/outage\.|offline\./).map((el) => el.textContent);
    expect(lines).toEqual(['Before the outage.', 'Said while offline.', 'After the outage.']);
  });

  it('warns while reconnecting and resumes from the last seq', async () => {
    const { env, send } = await openLive();
    send(frames.final(1, 's1', 0, 'First line.'), frames.final(2, 's2', 4000, 'Second line.'));
    act(() => {
      env.latest().serverClose(1006);
    });
    expect(
      screen.getByText(/Connection lost\. Reconnecting/, { exact: false }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(env.sockets).toHaveLength(2);
    });
    act(() => {
      env.latest().serverOpen();
    });
    expect(env.latest().sent[0]).toEqual({ type: 'subscribe', lecture_id: LIVE, last_seq: 2 });
    expect(screen.queryByText(/Connection lost/)).not.toBeInTheDocument();
    expect(screen.getByText('Second line.')).toBeInTheDocument();
  });

  it('tells a student when the classroom microphone drops off Wi-Fi', async () => {
    const { send } = await openLive('arjun');
    send(frames.device(1, { online: false }));
    expect(
      screen.getByText(/Live captions are paused — the classroom microphone is reconnecting/),
    ).toBeInTheDocument();
  });

  it('shows the ended state with a link to the lecture when recording stops', async () => {
    const { send } = await openLive();
    send(frames.final(1, 's1', 0, 'Last words.'), frames.status(2, 'processing', 60_000));
    expect(screen.getByText('This lecture has ended')).toBeInTheDocument();
    expect(screen.getByText('Notes and the full transcript are being prepared.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open lecture' })).toHaveAttribute(
      'href',
      `/lectures/${LIVE}/transcript`,
    );
  });
});
