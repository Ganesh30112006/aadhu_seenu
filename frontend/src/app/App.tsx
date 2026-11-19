import { RouterProvider } from 'react-router/dom';
import { queryClient } from '@/api/queryClient';
import { AppProviders } from './AppProviders';
import { createAppRouter } from './router';

/*
 * The router is created on first render, not at import time: a data router starts its first
 * loaders as soon as it is created, and main.tsx must be able to finish setup (the mock worker
 * in `--mode mock`) before any request is made. One instance for the app's lifetime.
 */
let router: ReturnType<typeof createAppRouter> | undefined;
function getRouter(): ReturnType<typeof createAppRouter> {
  router ??= createAppRouter(queryClient);
  return router;
}

export function App() {
  return (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={getRouter()} />
    </AppProviders>
  );
}
