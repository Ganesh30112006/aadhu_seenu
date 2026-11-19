import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LECTURE_IDS } from '@/test/fixtures/lectures';
import { renderApp } from '@/test/renderApp';
import { shuffled } from './FlashcardsTab';

describe('FlashcardsTab', () => {
  it('hides the answer until asked, then moves to the next card', async () => {
    const { user } = renderApp(`/lectures/${LECTURE_IDS.scheduling}/flashcards`, { as: 'arjun' });

    expect(
      await screen.findByText('Which scheduling algorithm minimises average waiting time?'),
    ).toBeInTheDocument();
    expect(screen.getByText('Card 1 of 4')).toBeInTheDocument();
    expect(screen.queryByText(/provably optimal/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Show answer' }));
    expect(screen.getByText(/provably optimal/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Explained at \d+:\d{2}/ })).toHaveAttribute(
      'href',
      expect.stringMatching(new RegExp(`^/lectures/${LECTURE_IDS.scheduling}/transcript\\?t=`)),
    );

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Card 2 of 4')).toBeInTheDocument();
    expect(screen.getByText('What is the convoy effect?')).toBeInTheDocument();
    expect(screen.queryByText(/provably optimal/)).not.toBeInTheDocument();
  });

  it('explains when flashcards have not been generated yet', async () => {
    renderApp(`/lectures/${LECTURE_IDS.semaphores}/flashcards`, { as: 'priya' });
    expect(await screen.findByText("Flashcards aren't ready yet")).toBeInTheDocument();
  });

  it('shuffles without losing or duplicating cards', () => {
    const items = [1, 2, 3, 4, 5];
    const out = shuffled(items, () => 0);
    expect(out).not.toEqual(items);
    expect([...out].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('RevisionTab', () => {
  it('lists the points to remember and the takeaways', async () => {
    renderApp(`/lectures/${LECTURE_IDS.scheduling}/revision`, { as: 'arjun' });
    expect(await screen.findByRole('heading', { name: 'Points to remember' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Key takeaways' })).toBeInTheDocument();
    expect(screen.getByText(/Priority scheduling can starve/)).toBeInTheDocument();
  });
});
