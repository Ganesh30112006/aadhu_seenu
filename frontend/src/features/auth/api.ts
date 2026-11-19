import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, request } from '@/api/client';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import type { User } from '@/api/types';

/** The signed-in user, or null when there is no session (401 is an expected answer here). */
export const meQueryOptions = queryOptions({
  queryKey: queryKeys.me(),
  queryFn: async (): Promise<User | null> => {
    try {
      return await request(api.GET('/auth/me'));
    } catch (error) {
      if (isApiError(error) && error.isUnauthorized) return null;
      throw error;
    }
  },
  staleTime: 5 * 60_000,
});

export function useMe() {
  return useQuery(meQueryOptions);
}

/** Current user inside the protected shell (the route loader guarantees a session). */
export function useCurrentUser(): User | null {
  return useMe().data ?? null;
}

export interface Credentials {
  email: string;
  password: string;
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: Credentials) =>
      request(api.POST('/auth/login', { body: credentials })),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me(), user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request(api.POST('/auth/logout')),
    // Even if the request fails, forget everything locally: the user asked to leave.
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(queryKeys.me(), null);
    },
  });
}
