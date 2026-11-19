import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEVICE_IDS, USER_IDS } from '@/test/fixtures/people';
import { getDb } from '@/test/msw/db';
import { renderApp } from '@/test/renderApp';

const device = () => getDb().devices.find((d) => d.id === DEVICE_IDS.room204);

describe('Device settings (admin)', () => {
  it('saves gain and voice detection', async () => {
    const { user } = renderApp(`/devices/${DEVICE_IDS.room204}`, { as: 'meena' });
    const gain = await screen.findByLabelText('Microphone gain');
    await user.clear(gain);
    await user.type(gain, '20');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Enter a gain between 0.5 and 16.')).toBeInTheDocument();

    await user.clear(gain);
    await user.type(gain, '6');
    await user.click(screen.getByLabelText(/^Voice detection/));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Device settings saved.')).toBeInTheDocument();
    expect(device()?.gain).toBe(6);
    expect(device()?.vad_enabled).toBe(false);
  });

  it('assigns lecturers to the device', async () => {
    const { user } = renderApp(`/devices/${DEVICE_IDS.room204}`, { as: 'meena' });
    await user.click(await screen.findByLabelText(/^Prof\. Venkat Reddy/));
    await user.click(screen.getByRole('button', { name: 'Save lecturers' }));
    expect(await screen.findByText('Lecturers updated.')).toBeInTheDocument();
    expect(device()?.lecturer_ids).toEqual([USER_IDS.priya, USER_IDS.venkat]);
  });

  it('is not offered to lecturers', async () => {
    renderApp(`/devices/${DEVICE_IDS.room204}`, { as: 'priya' });
    expect(await screen.findByText('Microphone level')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Device settings' })).not.toBeInTheDocument();
  });
});
