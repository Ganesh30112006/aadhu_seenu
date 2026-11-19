import { setupServer } from 'msw/node';
import { setMockLatency } from './db';
import { handlers } from './handlers';

setMockLatency(false);

/** MSW server for Vitest (jsdom). */
export const server = setupServer(...handlers);
