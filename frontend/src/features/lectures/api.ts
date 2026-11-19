import {
  type InfiniteData,
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { api, request } from '@/api/client';
import { queryKeys, type LectureListFilters } from '@/api/queryKeys';
import type {
  ControlAction,
  LectureCreate,
  LectureStatus,
  LectureUpdate,
  TranscriptPage,
  TranscriptSegment,
} from '@/api/types';
import { buildTimeline, type Timeline } from '@/lib/transcript/timeline';

const PAGE_SIZE = 30;
const TRANSCRIPT_PAGE = 200;

export const subjectsQuery = queryOptions({
  queryKey: queryKeys.subjects(),
  queryFn: () => request(api.GET('/subjects')),
  staleTime: 10 * 60_000,
});

export function lectureQuery(lectureId: string) {
  return queryOptions({
    queryKey: queryKeys.lectures.detail(lectureId),
    queryFn: () =>
      request(api.GET('/lectures/{lecture_id}', { params: { path: { lecture_id: lectureId } } })),
  });
}

export interface LibraryFilters extends LectureListFilters {
  status?: LectureStatus;
}

export function lecturesQuery(filters: LibraryFilters, pageSize = PAGE_SIZE) {
  return infiniteQueryOptions({
    queryKey: [...queryKeys.lectures.list(filters), pageSize],
    queryFn: ({ pageParam, signal }) =>
      request(
        api.GET('/lectures', {
          signal,
          params: {
            query: {
              page: pageParam,
              page_size: pageSize,
              ...(filters.subjectId !== undefined && { subject_id: filters.subjectId }),
              ...(filters.q !== undefined && { q: filters.q }),
              ...(filters.from !== undefined && { from: filters.from }),
              ...(filters.to !== undefined && { to: filters.to }),
              ...(filters.status !== undefined && { status: filters.status }),
            },
          },
        }),
      ),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.page_size < last.total ? last.page + 1 : undefined,
  });
}

/** The first transcript page has no cursor. */
function firstCursor(): string | null {
  return null;
}

function transcriptQuery(lectureId: string) {
  return infiniteQueryOptions({
    queryKey: queryKeys.lectures.transcript(lectureId),
    queryFn: ({ pageParam, signal }) =>
      request(
        api.GET('/lectures/{lecture_id}/transcript', {
          signal,
          params: {
            path: { lecture_id: lectureId },
            query: { limit: TRANSCRIPT_PAGE, ...(pageParam !== null && { cursor: pageParam }) },
          },
        }),
      ),
    initialPageParam: firstCursor(),
    getNextPageParam: (last) => last.next_cursor,
  });
}

export interface FullTranscript {
  timeline: Timeline;
  segments: readonly TranscriptSegment[];
  /** True until every page has arrived (search and ?t= need the whole transcript). */
  loadingMore: boolean;
}

/**
 * Loads every transcript page (a 50-minute lecture is ~600 segments, ~150 KB), then builds the
 * ordered, de-duplicated timeline. In-lecture search and deep links work on the full set.
 */
export function useFullTranscript(lectureId: string) {
  const query = useInfiniteQuery(transcriptQuery(lectureId));
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isError } = query;
  // The page count is a dependency on purpose: a fast response can flip isFetchingNextPage
  // true→false within one batched render, which would otherwise leave the deps unchanged and
  // stop loading after the second page.
  const pageCount = query.data?.pages.length ?? 0;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage, pageCount]);

  const pages = query.data?.pages;
  const data = useMemo((): FullTranscript | undefined => {
    if (pages === undefined) return undefined;
    const segments = pages.flatMap((page) => page.items);
    const gaps = pages[0]?.gaps ?? [];
    return { timeline: buildTimeline(segments, gaps), segments, loadingMore: hasNextPage };
  }, [pages, hasNextPage]);

  return { ...query, transcript: data };
}

export function usePrepareLecture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LectureCreate) => request(api.POST('/lectures', { body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lectures.all() });
    },
  });
}

export function useUpdateLecture(lectureId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LectureUpdate) =>
      request(
        api.PATCH('/lectures/{lecture_id}', { params: { path: { lecture_id: lectureId } }, body }),
      ),
    onSuccess: (lecture) => {
      queryClient.setQueryData(queryKeys.lectures.detail(lectureId), lecture);
      void queryClient.invalidateQueries({ queryKey: ['lectures', 'list'] });
    },
  });
}

export function useDeleteLecture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lectureId: string) =>
      request(
        api.DELETE('/lectures/{lecture_id}', { params: { path: { lecture_id: lectureId } } }),
      ),
    onSuccess: (_data, lectureId) => {
      queryClient.removeQueries({ queryKey: queryKeys.lectures.detail(lectureId) });
      void queryClient.invalidateQueries({ queryKey: ['lectures', 'list'] });
    },
  });
}

export function useSubjects() {
  return useQuery(subjectsQuery);
}

export function useLecture(lectureId: string) {
  return useQuery(lectureQuery(lectureId));
}

/** Lecturer correction of one transcript line; patches the cached transcript in place. */
export function useEditSegment(lectureId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ segmentId, text }: { segmentId: string; text: string }) =>
      request(
        api.PATCH('/lectures/{lecture_id}/segments/{segment_id}', {
          params: { path: { lecture_id: lectureId, segment_id: segmentId } },
          body: { text },
        }),
      ),
    onSuccess: (segment) => {
      queryClient.setQueryData<InfiniteData<TranscriptPage>>(
        queryKeys.lectures.transcript(lectureId),
        (data) =>
          data === undefined
            ? data
            : {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  items: page.items.map((item) =>
                    item.segment_id === segment.segment_id ? segment : item,
                  ),
                })),
              },
      );
    },
  });
}

/** Start/Pause/Resume/Stop from the web; the device reports the result on the live socket. */
export function useRecordingControl(lectureId: string) {
  return useMutation({
    mutationFn: (action: ControlAction) =>
      request(
        api.POST('/lectures/{lecture_id}/control', {
          params: { path: { lecture_id: lectureId } },
          body: { action },
        }),
      ),
  });
}
