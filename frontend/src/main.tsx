import './styles/fonts';
import './styles/index.css';
import './app/i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { startPreferenceSync } from './features/settings/prefsStore';

// Apply theme/text size before the first paint so there is no flash of the wrong theme.
startPreferenceSync();

/*
 * Mock backend (MSW) for `--mode mock` only. `__MOCKS__` is a literal `false` in every other
 * build, so the bundler removes this branch and no mock code reaches production
 * (verified by `npm run size`, which fails if any MSW code is present in dist/).
 */
const startMocks = __MOCKS__
  ? async (): Promise<void> => {
      const { worker } = await import('./test/msw/browser');
      await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
    }
  : null;

async function bootstrap(): Promise<void> {
  if (startMocks !== null) await startMocks();
  const container = document.getElementById('root');
  if (container === null) throw new Error('#root element missing from index.html');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
