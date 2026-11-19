import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { USER_IDS } from '@/test/fixtures/people';
import { getDb } from '@/test/msw/db';
import { renderApp } from '@/test/renderApp';

describe('SettingsRoute', () => {
  it('saves the profile name', async () => {
    const { user } = renderApp('/settings', { as: 'arjun' });
    const name = await screen.findByLabelText('Full name');
    expect(name).toHaveValue('Arjun Kumar');
    await user.clear(name);
    await user.type(name, 'Arjun K.');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect(getDb().users.find((u) => u.id === USER_IDS.arjun)?.full_name).toBe('Arjun K.');
  });

  it('checks the confirmation and reports a wrong current password', async () => {
    const { user } = renderApp('/settings', { as: 'arjun' });
    await user.type(await screen.findByLabelText('Current password'), 'not-my-password');
    await user.type(screen.getByLabelText('New password'), 'brand-new-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'different-pass');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText("The passwords don't match.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'brand-new-pass');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The current password is incorrect.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Current password'));
    await user.type(screen.getByLabelText('Current password'), 'student-demo');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Password changed.')).toBeInTheDocument();
    expect(getDb().users.find((u) => u.id === USER_IDS.arjun)?.password).toBe('brand-new-pass');
  });

  it('shows the server configuration to administrators only', async () => {
    renderApp('/settings', { as: 'meena' });
    expect(await screen.findByRole('heading', { name: 'Server' })).toBeInTheDocument();
    expect(await screen.findByText('Delete audio after 90 days')).toBeInTheDocument();
  });

  it('hides the server configuration from other users', async () => {
    renderApp('/settings', { as: 'priya' });
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Server' })).not.toBeInTheDocument();
  });
});
