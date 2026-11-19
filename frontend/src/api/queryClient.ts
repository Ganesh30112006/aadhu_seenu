import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiError } from './errors';
import { queryKeys } from './queryKeys';

const MAX_RETRIES = 2;

export function createQueryClient(): QueryClient {
  // Any 401 means the session is gone: clear `me`, and the protected shell redirects to /login.
  const onError = (error: unknown): void => {
    if (isApiError(error) && error.isUnauthorized) {
      client.setQueryData(queryKeys.me(), null);
    }
  };

  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) =>
          failureCount < MAX_RETRIES && (!isApiError(error) || error.isRetryable),
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        retry: false,
      },
    },
  });
  return client;
}

/** App-wide instance (tests create their own with createQueryClient). */
export const queryClient = createQueryClient();
