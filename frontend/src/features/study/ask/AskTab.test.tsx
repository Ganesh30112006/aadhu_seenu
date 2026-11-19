import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { env } from '@/lib/env';
import { LECTURE_IDS } from '@/test/fixtures/lectures';
import { server } from '@/test/msw/node';
import { renderApp } from '@/test/renderApp';

const ASK_PATH = `/lectures/${LECTURE_IDS.scheduling}/ask`;

async function ask(user: ReturnType<typeof renderApp>['user'], question: string): Promise<void> {
  await user.type(await screen.findByLabelText('Your question'), question);
  await user.click(screen.getByRole('button', { name: 'Ask' }));
}

describe('AskTab', () => {
  it('warns when an answer cites no part of the transcript', async () => {
    server.use(
      http.post(`${env.apiBaseUrl}/lectures/:id/ask`, () =>
        HttpResponse.json({ answer: 'Probably about scheduling.', cited_segment_ids: [] }),
      ),
    );
    const { user } = renderApp(ASK_PATH, { as: 'arjun' });
    await ask(user, 'What was the main topic?');

    expect(await screen.findByText('Probably about scheduling.')).toBeInTheDocument();
    expect(
      screen.getByText(/isn't linked to any part of the transcript/, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryByText('From the lecture')).not.toBeInTheDocument();
  });

  it('links cited segments to their moment in the transcript', async () => {
    const { user } = renderApp(ASK_PATH, { as: 'arjun' });
    await ask(user, 'Why does a very small time quantum hurt performance?');

    const sources = await screen.findByText('From the lecture');
    const citations = sources.nextElementSibling;
    if (!(citations instanceof HTMLElement)) throw new Error('no citation list');
    const list = within(citations);
    const links = await list.findAllByRole('link', { name: /^Jump to \d+:\d{2}/ });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(
        new RegExp(`^/lectures/${LECTURE_IDS.scheduling}/transcript\\?`),
      );
    }
  });

  it('validates the question length before asking', async () => {
    const { user } = renderApp(ASK_PATH, { as: 'arjun' });
    await ask(user, 'ab');
    expect(
      await screen.findByText('Ask a slightly longer question (at least 3 characters).'),
    ).toBeInTheDocument();
    expect(screen.queryByText('You asked')).not.toBeInTheDocument();
  });
});
