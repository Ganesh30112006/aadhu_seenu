import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/renderApp';

async function emailField(): Promise<HTMLElement> {
  return screen.findByLabelText('Email');
}

describe('LoginRoute', () => {
  it('validates both fields before calling the API', async () => {
    const { user } = renderApp('/login', { as: null });
    await emailField();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText('Enter an email address like name@college.edu.'),
    ).toBeInTheDocument();
  });

  it('shows a server error for a wrong password and keeps the user on the page', async () => {
    const { user, router } = renderApp('/login', { as: null });
    await user.type(await emailField(), 'priya.raghavan@college.example');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('signs in and returns to the page in ?next=', async () => {
    const { user, router } = renderApp('/login?next=%2Fsearch', { as: null });
    await user.type(await emailField(), 'arjun.kumar@college.example');
    await user.type(screen.getByLabelText('Password'), 'student-demo');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/search');
    });
  });

  it('ignores an off-site ?next= redirect', async () => {
    const { user, router } = renderApp('/login?next=https%3A%2F%2Fevil.example', { as: null });
    await user.type(await emailField(), 'arjun.kumar@college.example');
    await user.type(screen.getByLabelText('Password'), 'student-demo');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });
});
