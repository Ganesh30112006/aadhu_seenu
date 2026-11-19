import type { QueryClient } from '@tanstack/react-query';
import { createBrowserRouter, redirect, type RouteObject } from 'react-router';
import { AppLoading } from './AppLoading';
import { NotFound, RouteErrorBoundary } from './errors/RouteErrorBoundary';
import { redirectIfAuthenticated, requireAuth, requireRole } from './guards';
import { AppShell } from './shell/AppShell';

/** Every screen is a lazily loaded chunk with its own error boundary. */
export function createRoutes(queryClient: QueryClient): RouteObject[] {
  const lecturerOrAdmin = requireRole(queryClient, ['lecturer', 'admin']);
  const adminOnly = requireRole(queryClient, ['admin']);
  const errorElement = <RouteErrorBoundary />;

  return [
    {
      path: '/login',
      loader: redirectIfAuthenticated(queryClient),
      lazy: async () => ({ Component: (await import('@/features/auth/LoginRoute')).LoginRoute }),
      errorElement,
      HydrateFallback: AppLoading,
    },
    {
      path: '/',
      loader: requireAuth(queryClient),
      Component: AppShell,
      errorElement,
      HydrateFallback: AppLoading,
      children: [
        {
          errorElement,
          children: [
            {
              index: true,
              lazy: async () => ({
                Component: (await import('@/features/home/HomeRoute')).HomeRoute,
              }),
            },
            {
              path: 'lectures',
              lazy: async () => ({
                Component: (await import('@/features/lectures/library/LibraryRoute')).LibraryRoute,
              }),
            },
            {
              path: 'lectures/:lectureId/live',
              lazy: async () => ({
                Component: (await import('@/features/live-lecture/LiveLectureRoute'))
                  .LiveLectureRoute,
              }),
            },
            {
              path: 'lectures/:lectureId',
              lazy: async () => ({
                Component: (await import('@/features/lectures/detail/LectureDetailLayout'))
                  .LectureDetailLayout,
              }),
              children: [
                {
                  index: true,
                  loader: ({ params, request }) =>
                    redirect(
                      `/lectures/${params.lectureId ?? ''}/transcript${new URL(request.url).search}`,
                    ),
                },
                {
                  path: 'transcript',
                  errorElement,
                  lazy: async () => ({
                    Component: (await import('@/features/lectures/transcript/TranscriptTab'))
                      .TranscriptTab,
                  }),
                },
                {
                  path: 'notes',
                  errorElement,
                  lazy: async () => ({
                    Component: (await import('@/features/study/notes/NotesTab')).NotesTab,
                  }),
                },
                {
                  path: 'summary',
                  errorElement,
                  lazy: async () => ({
                    Component: (await import('@/features/study/summary/SummaryTab')).SummaryTab,
                  }),
                },
                {
                  path: 'revision',
                  errorElement,
                  lazy: async () => ({
                    Component: (await import('@/features/study/revision/RevisionTab')).RevisionTab,
                  }),
                },
                {
                  path: 'flashcards',
                  errorElement,
                  lazy: async () => ({
                    Component: (await import('@/features/study/flashcards/FlashcardsTab'))
                      .FlashcardsTab,
                  }),
                },
                {
                  path: 'key-terms',
                  errorElement,
                  lazy: async () => ({
                    Component: (await import('@/features/study/key-terms/KeyTermsTab')).KeyTermsTab,
                  }),
                },
                {
                  path: 'questions',
                  errorElement,
                  lazy: async () => ({
                    Component: (await import('@/features/study/questions/QuestionsTab'))
                      .QuestionsTab,
                  }),
                },
                {
                  path: 'ask',
                  errorElement,
                  lazy: async () => ({
                    Component: (await import('@/features/study/ask/AskTab')).AskTab,
                  }),
                },
                { path: '*', Component: NotFound },
              ],
            },
            {
              path: 'search',
              lazy: async () => ({
                Component: (await import('@/features/search/SearchRoute')).SearchRoute,
              }),
            },
            {
              path: 'devices',
              loader: lecturerOrAdmin,
              lazy: async () => ({
                Component: (await import('@/features/devices/DevicesRoute')).DevicesRoute,
              }),
            },
            {
              path: 'devices/:deviceId',
              loader: lecturerOrAdmin,
              lazy: async () => ({
                Component: (await import('@/features/devices/DeviceDetailRoute')).DeviceDetailRoute,
              }),
            },
            {
              path: 'settings',
              lazy: async () => ({
                Component: (await import('@/features/settings/SettingsRoute')).SettingsRoute,
              }),
            },
            {
              path: 'admin/subjects',
              loader: adminOnly,
              lazy: async () => ({
                Component: (await import('@/features/admin/SubjectsRoute')).SubjectsRoute,
              }),
            },
            {
              path: 'admin/users',
              loader: adminOnly,
              lazy: async () => ({
                Component: (await import('@/features/admin/UsersRoute')).UsersRoute,
              }),
            },
            { path: '*', Component: NotFound },
          ],
        },
      ],
    },
  ];
}

export function createAppRouter(queryClient: QueryClient) {
  return createBrowserRouter(createRoutes(queryClient));
}
