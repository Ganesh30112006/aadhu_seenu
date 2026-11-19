/** Typed URL builders. URL state (filters, tab, timestamp) is part of the path or query. */
export type LectureTab =
  | 'transcript'
  | 'notes'
  | 'summary'
  | 'revision'
  | 'key-terms'
  | 'flashcards'
  | 'questions'
  | 'ask';

export const LECTURE_TABS: readonly LectureTab[] = [
  'transcript',
  'notes',
  'summary',
  'revision',
  'key-terms',
  'flashcards',
  'questions',
  'ask',
];

export function isLectureTab(value: string | undefined): value is LectureTab {
  return LECTURE_TABS.some((tab) => tab === value);
}

const enc = encodeURIComponent;

export const paths = {
  home: () => '/',
  login: (next?: string) => (next === undefined ? '/login' : `/login?next=${enc(next)}`),
  library: () => '/lectures',
  live: (lectureId: string) => `/lectures/${enc(lectureId)}/live`,
  lecture: (lectureId: string, tab: LectureTab = 'transcript') =>
    `/lectures/${enc(lectureId)}/${tab}`,
  /** Deep link into the transcript at a moment, optionally highlighting one segment. */
  transcriptAt: (lectureId: string, ms: number, segmentId?: string) =>
    `/lectures/${enc(lectureId)}/transcript?t=${String(Math.max(0, Math.round(ms)))}${
      segmentId === undefined ? '' : `&seg=${enc(segmentId)}`
    }`,
  search: (q?: string) => (q === undefined || q === '' ? '/search' : `/search?q=${enc(q)}`),
  devices: () => '/devices',
  device: (deviceId: string) => `/devices/${enc(deviceId)}`,
  settings: () => '/settings',
  adminSubjects: () => '/admin/subjects',
  adminUsers: () => '/admin/users',
} as const;

/**
 * Pages whose URL changes without being a new page (detail tabs) share a focus key, so
 * switching tabs doesn't yank keyboard focus to <main>.
 */
export function pageKey(pathname: string): string {
  return pathname.replace(
    /^(\/lectures\/[^/]+)\/(transcript|notes|summary|revision|key-terms|flashcards|questions|ask)$/,
    '$1',
  );
}
