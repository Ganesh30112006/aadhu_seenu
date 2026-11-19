import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LiveSocketManager } from '@/api/ws/LiveSocketManager';
import { createFakeEnvironment } from '@/test/fakeSocket';
import { DEVICE_IDS, SUBJECT_IDS } from '@/test/fixtures/people';
import { renderApp } from '@/test/renderApp';

const fakeLive = () => new LiveSocketManager(createFakeEnvironment().deps);

describe('PrepareLectureForm', () => {
  it('shows every validation error and does not submit', async () => {
    const { user, router } = renderApp('/', { live: fakeLive() });
    await user.click(await screen.findByRole('button', { name: 'Prepare lecture' }));

    expect(await screen.findByText('Choose a subject.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 3 characters.')).toBeInTheDocument();
    expect(screen.getByText('Choose a microphone.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Confirm that students know the lecture is recorded.',
    );
    expect(router.state.location.pathname).toBe('/');
  });

  it('prepares a lecture and opens its live page', async () => {
    const { user, router } = renderApp('/', { live: fakeLive() });
    await user.selectOptions(await screen.findByLabelText('Subject'), SUBJECT_IDS.os);
    await user.type(screen.getByLabelText('Lecture title'), 'Deadlocks: Banker’s algorithm');
    await user.selectOptions(screen.getByLabelText('Microphone'), DEVICE_IDS.room204);
    await user.click(
      screen.getByLabelText('Students have been told this lecture is recorded and transcribed', {
        exact: false,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Prepare lecture' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/lectures\/[^/]+\/live$/);
    });
    expect(
      await screen.findByText('Lecture prepared. Press record on the microphone.'),
    ).toBeVisible();
  });

  it('pre-selects the only free microphone and disables one that is recording', async () => {
    renderApp('/', { as: 'anitha', live: fakeLive() });
    const select = await screen.findByLabelText('Microphone');
    expect(select).toHaveValue(DEVICE_IDS.seminar);
    expect(screen.getByRole('option', { name: /\(recording\)$/ })).toBeDisabled();
  });
});
