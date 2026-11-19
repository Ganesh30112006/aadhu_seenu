import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, request } from '@/api/client';
import { isApiError } from '@/api/errors';
import { mutationKeys, queryKeys } from '@/api/queryKeys';
import type { Notes, NotesUpdate } from '@/api/types';

const path = (lectureId: string) => ({ params: { path: { lecture_id: lectureId } } });

/** 404 "not ready / not published" answers are final states, not failures worth retrying. */
function retryUnlessNotFound(count: number, error: unknown): boolean {
  if (isApiError(error) && (error.isNotFound || !error.isRetryable)) return false;
  return count < 2;
}

export function notesQuery(lectureId: string) {
  return queryOptions({
    queryKey: queryKeys.lectures.notes(lectureId),
    queryFn: () => request(api.GET('/lectures/{lecture_id}/notes', path(lectureId))),
    retry: retryUnlessNotFound,
    refetchInterval: (query) => (query.state.data?.generation_status === 'pending' ? 4000 : false),
  });
}

export const useNotes = (lectureId: string) => useQuery(notesQuery(lectureId));

export const useSummary = (lectureId: string) =>
  useQuery({
    queryKey: queryKeys.lectures.summary(lectureId),
    queryFn: () => request(api.GET('/lectures/{lecture_id}/summary', path(lectureId))),
    retry: retryUnlessNotFound,
  });

export const useKeyTerms = (lectureId: string) =>
  useQuery({
    queryKey: queryKeys.lectures.keyTerms(lectureId),
    queryFn: () => request(api.GET('/lectures/{lecture_id}/key-terms', path(lectureId))),
    retry: retryUnlessNotFound,
  });

export const useQuestions = (lectureId: string) =>
  useQuery({
    queryKey: queryKeys.lectures.questions(lectureId),
    queryFn: () => request(api.GET('/lectures/{lecture_id}/questions', path(lectureId))),
    retry: retryUnlessNotFound,
  });

export const useFlashcards = (lectureId: string) =>
  useQuery({
    queryKey: queryKeys.lectures.flashcards(lectureId),
    queryFn: () => request(api.GET('/lectures/{lecture_id}/flashcards', path(lectureId))),
    retry: retryUnlessNotFound,
  });

export const useRevision = (lectureId: string) =>
  useQuery({
    queryKey: queryKeys.lectures.revision(lectureId),
    queryFn: () => request(api.GET('/lectures/{lecture_id}/revision', path(lectureId))),
    retry: retryUnlessNotFound,
  });

export function useNotesMutations(lectureId: string) {
  const queryClient = useQueryClient();
  const setNotes = (data: Notes): void => {
    queryClient.setQueryData(queryKeys.lectures.notes(lectureId), data);
    void queryClient.invalidateQueries({
      queryKey: queryKeys.lectures.detail(lectureId),
      exact: true,
    });
  };
  const save = useMutation({
    mutationFn: (body: NotesUpdate) =>
      request(api.PATCH('/lectures/{lecture_id}/notes', { ...path(lectureId), body })),
    onSuccess: (data) => {
      setNotes(data);
    },
  });
  const regenerate = useMutation({
    mutationFn: () => request(api.POST('/lectures/{lecture_id}/notes/regenerate', path(lectureId))),
    onSuccess: (data) => {
      setNotes(data);
    },
  });
  const publish = useMutation({
    mutationFn: () => request(api.POST('/lectures/{lecture_id}/publish', path(lectureId))),
    onSuccess: (data) => {
      setNotes(data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.lectures.detail(lectureId) });
    },
  });
  return { save, regenerate, publish };
}

export function useAsk(lectureId: string) {
  return useMutation({
    mutationKey: mutationKeys.ask(lectureId),
    mutationFn: (question: string) =>
      request(api.POST('/lectures/{lecture_id}/ask', { ...path(lectureId), body: { question } })),
  });
}

export type ArtifactProblem = 'not_ready' | 'not_published' | 'error';

/** Classifies a study-material error: not generated yet, not published yet, or a real failure. */
export function artifactProblem(error: unknown): ArtifactProblem {
  if (isApiError(error) && error.isNotFound) {
    if (error.code.endsWith('_not_published')) return 'not_published';
    if (error.code.endsWith('_not_ready')) return 'not_ready';
  }
  return 'error';
}
