import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, request } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { SubjectCreate, UserCreate, UserUpdate } from '@/api/types';

export function useUsers() {
  return useQuery({
    queryKey: queryKeys.users(),
    queryFn: ({ signal }) => request(api.GET('/users', { signal })),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UserCreate) => request(api.POST('/users', { body })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.users() }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserUpdate }) =>
      request(api.PATCH('/users/{user_id}', { params: { path: { user_id: id } }, body })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.users() }),
  });
}

export function useCreateSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SubjectCreate) => request(api.POST('/subjects', { body })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.subjects() }),
  });
}
