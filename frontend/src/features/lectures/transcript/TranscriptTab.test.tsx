import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LECTURE_IDS } from '@/test/fixtures/lectures';
import { buildTranscript } from '@/test/fixtures/transcript';
import { scrollToIndex } from '@/test/plainVirtualList';
import { renderApp } from '@/test/renderApp';

vi.mock('@/components/VirtualList', () => import('@/test/plainVirtualList'));

const LECTURE = LECTURE_IDS.scheduling;
const segments = buildTranscript().segments;
const SLOW = { timeout: 20_000 };

beforeEach(() => {
  scrollToIndex.mockClear();
});

async function waitForFullTranscript(): Promise<void> {
  await waitFor(
    () => {
      expect(document.querySelectorAll('[data-segment-id]')).toHaveLength(segments.length);
    },
    { timeout: 15_000 },
  );
}

function segmentRow(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-segment-id="${id}"]`);
  if (row === null) throw new Error(`row ${id} not rendered`);
  return row;
}

function rowIndexOf(id: string): number {
  return within(screen.getByRole('list', { name: 'Transcript' }))
    .getAllByRole('listitem')
    .findIndex((item) => item.querySelector(`[data-segment-id="${id}"]`) !== null);
}

describe('TranscriptTab', () => {
  it('highlights the deep-linked segment and scrolls it into view', SLOW, async () => {
    const target = segments[Math.floor(segments.length / 2)];
    if (target === undefined) throw new Error('fixture too short');
    renderApp(`/lectures/${LECTURE}/transcript?t=${target.start_ms}&seg=${target.segment_id}`, {
      as: 'arjun',
    });
    await waitForFullTranscript();

    const row = segmentRow(target.segment_id);
    expect(within(row).getByText('Linked moment')).toBeInTheDocument();
    expect(within(row).getByText(target.text)).toBeInTheDocument();
    expect(screen.getAllByText('Linked moment')).toHaveLength(1);
    await waitFor(() => {
      expect(scrollToIndex).toHaveBeenLastCalledWith(rowIndexOf(target.segment_id), 'center');
    });
  });

  it('finds the row that contains ?t= when no segment id is given', SLOW, async () => {
    const target = segments[10];
    if (target === undefined) throw new Error('fixture too short');
    renderApp(`/lectures/${LECTURE}/transcript?t=${target.start_ms + 500}`, { as: 'arjun' });
    await waitForFullTranscript();
    expect(within(segmentRow(target.segment_id)).getByText('Linked moment')).toBeInTheDocument();
    expect(screen.getAllByText('Linked moment')).toHaveLength(1);
  });

  it('finds matches as you type, steps through them and mirrors ?q=', SLOW, async () => {
    const query = 'quantum';
    const expected = segments.reduce(
      (n, s) => n + (s.text.match(new RegExp(query, 'gi'))?.length ?? 0),
      0,
    );
    expect(expected).toBeGreaterThan(2);

    const { user, router } = renderApp(`/lectures/${LECTURE}/transcript`, { as: 'arjun' });
    await waitForFullTranscript();
    const input = screen.getByRole('searchbox', { name: 'Find in transcript' });
    await user.type(input, query);
    expect(input).toHaveValue(query); // no dropped keystrokes

    const count = document.getElementById('transcript-search-count');
    expect(count).toHaveTextContent(`1 of ${expected}`);
    await waitFor(() => {
      expect(new URLSearchParams(router.state.location.search).get('q')).toBe(query);
    });
    expect(document.querySelectorAll('mark')).toHaveLength(expected);

    await user.click(screen.getByRole('button', { name: 'Next match' }));
    expect(count).toHaveTextContent(`2 of ${expected}`);
    await user.click(screen.getByRole('button', { name: 'Previous match' }));
    await user.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(count).toHaveTextContent(`${expected} of ${expected}`);
    expect(scrollToIndex).toHaveBeenCalled();

    await user.type(input, '{Escape}');
    expect(input).toHaveValue('');
    await waitFor(() => {
      expect(new URLSearchParams(router.state.location.search).get('q')).toBeNull();
    });
  });

  it('restores the search from ?q= on load', SLOW, async () => {
    renderApp(`/lectures/${LECTURE}/transcript?q=quantum`, { as: 'arjun' });
    await waitForFullTranscript();
    expect(screen.getByRole('searchbox', { name: 'Find in transcript' })).toHaveValue('quantum');
    expect(document.getElementById('transcript-search-count')).toHaveTextContent(/^1 of \d+$/);
  });

  it('reports no matches for an unknown word', SLOW, async () => {
    const { user } = renderApp(`/lectures/${LECTURE}/transcript`, { as: 'arjun' });
    await waitForFullTranscript();
    await user.type(screen.getByRole('searchbox', { name: 'Find in transcript' }), 'zzzxqy');
    expect(document.getElementById('transcript-search-count')).toHaveTextContent('No matches');
  });
});
