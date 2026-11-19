import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, request } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { PasswordChange } from '@/api/types';

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fullName: string) =>
      request(api.PATCH('/auth/me', { body: { full_name: fullName } })),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me(), user);
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: PasswordChange) => request(api.POST('/auth/password', { body })),
  });
}

/** Admin only: the backend configuration (models, retention, device defaults). */
export function useSystemInfo() {
  return useQuery({
    queryKey: queryKeys.system(),
    queryFn: ({ signal }) => request(api.GET('/system', { signal })),
    staleTime: 5 * 60_000,
  });
}
