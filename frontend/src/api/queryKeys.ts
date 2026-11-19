/**
 * Every TanStack Query key in one place. Keys are hierarchical so that invalidating
 * `queryKeys.lectures.detail(id)` also invalidates that lecture's transcript, notes, etc.
 */
export interface LectureListFilters {
  subjectId?: string;
  q?: string;
  from?: string;
  to?: string;
  status?: string;
}

export const queryKeys = {
  me: () => ['auth', 'me'] as const,
  subjects: () => ['subjects'] as const,
  lectures: {
    all: () => ['lectures'] as const,
    list: (filters: LectureListFilters) => ['lectures', 'list', filters] as const,
    inProgress: () => ['lectures', 'list', { status: 'recording' }] as const,
    detail: (id: string) => ['lectures', 'detail', id] as const,
    transcript: (id: string) => ['lectures', 'detail', id, 'transcript'] as const,
    notes: (id: string) => ['lectures', 'detail', id, 'notes'] as const,
    summary: (id: string) => ['lectures', 'detail', id, 'summary'] as const,
    keyTerms: (id: string) => ['lectures', 'detail', id, 'key-terms'] as const,
    questions: (id: string) => ['lectures', 'detail', id, 'questions'] as const,
    flashcards: (id: string) => ['lectures', 'detail', id, 'flashcards'] as const,
    revision: (id: string) => ['lectures', 'detail', id, 'revision'] as const,
  },
  search: (q: string, subjectId: string | undefined) => ['search', q, subjectId ?? null] as const,
  devices: {
    all: () => ['devices'] as const,
    detail: (id: string) => ['devices', id] as const,
  },
  users: () => ['users'] as const,
  system: () => ['system'] as const,
} as const;

export const mutationKeys = {
  ask: (lectureId: string) => ['ask', lectureId] as const,
  export: (lectureId: string) => ['export', lectureId] as const,
} as const;
