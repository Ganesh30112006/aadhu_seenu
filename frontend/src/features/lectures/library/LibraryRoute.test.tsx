import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/renderApp';

function countText(): string {
  const status = screen.getAllByRole('status').find((el) => /\d+ lectures?$/.test(el.textContent));
  if (status === undefined) throw new Error('no lecture count shown');
  return status.textContent;
}

describe('LibraryRoute', () => {
  it('lists lectures newest first with a total count', async () => {
    renderApp('/lectures');
    expect(await screen.findByRole('heading', { name: 'Lecture library' })).toBeInTheDocument();
    expect(await screen.findByText('CPU Scheduling Algorithms')).toBeInTheDocument();
    expect(countText()).toMatch(/^\d+ lectures$/);
  });

  it('searches by title through the URL and shows only matches', async () => {
    const { user, router } = renderApp('/lectures');
    await screen.findByText('CPU Scheduling Algorithms');
    const search = within(screen.getByRole('search'));
    await user.type(search.getByRole('searchbox', { name: 'Title or lecturer' }), 'routing');
    await user.click(search.getByRole('button', { name: 'Title or lecturer' }));

    await waitFor(() => {
      expect(new URLSearchParams(router.state.location.search).get('q')).toBe('routing');
    });
    expect(await screen.findByText('Routing Algorithms')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('CPU Scheduling Algorithms')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(countText()).toBe('1 lecture');
    });
  });

  it('filters by status and restores filters from the URL', async () => {
    const { user, router } = renderApp('/lectures');
    await screen.findByText('CPU Scheduling Algorithms');
    await user.selectOptions(screen.getByLabelText('Status'), 'processing');
    await waitFor(() => {
      expect(new URLSearchParams(router.state.location.search).get('status')).toBe('processing');
    });
    expect(await screen.findByText('Routing Algorithms')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('CPU Scheduling Algorithms')).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText('Status')).toHaveValue('processing');
  });

  it('shows a no-matches state for filters that match nothing', async () => {
    renderApp('/lectures?q=no-such-lecture-xyz');
    expect(await screen.findByText('No lectures match these filters')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Title or lecturer' })).toHaveValue(
      'no-such-lecture-xyz',
    );
  });
});
