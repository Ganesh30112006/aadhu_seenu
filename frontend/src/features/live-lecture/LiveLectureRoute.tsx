import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, FileQuestion, Mic } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { elapsedMs } from '@/api/ws/liveSession';
import { paths } from '@/app/paths';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { WidgetErrorBoundary } from '@/app/errors/WidgetErrorBoundary';
import { ButtonLink } from '@/components/Button';
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/Feedback';
import { PageHeader } from '@/components/Page';
import { useCurrentUser } from '@/features/auth/api';
import { useLecture } from '@/features/lectures/api';
import { canEditLecture } from '@/features/lectures/permissions';
import { usePrefs } from '@/features/settings/prefsStore';
import { useNow } from '@/lib/useNow';
import { toast } from '@/components/Toast';
import { DeviceMonitor } from './DeviceMonitor';
import { ConnectionBanner, DeviceAlertBanner } from './LiveBanners';
import { LiveControls } from './LiveControls';
import { LiveHeader } from './LiveHeader';
import { LiveKeyTermsPanel } from './LiveKeyTermsPanel';
import { LiveTranscriptPanel } from './LiveTranscriptPanel';
import { useLive, useLiveManager, useLiveSession } from './live';
import styles from './Live.module.css';

function LiveScreen({ lectureId }: { lectureId: string }) {
  const { t } = useTranslation('live');
  const { t: tc } = useTranslation();
  const user = useCurrentUser();
  const lecture = useLecture(lectureId);
  const queryClient = useQueryClient();
  const manager = useLiveManager();
  useLiveSession(lectureId);
  const connection = useLive((s) => s.connection);
  const latency = useLive((s) => s.latencyMs);
  const session = useLive((s) => s.session);
  const now = useNow();
  const announce = usePrefs((s) => s.announce);
  const setPref = usePrefs((s) => s.set);
  const notifyConnection = usePrefs((s) => s.notifyConnection);
  const notifyLectureEnded = usePrefs((s) => s.notifyLectureEnded);
  const notifyNotesReady = usePrefs((s) => s.notifyNotesReady);
  useDocumentTitle(lecture.data ? t('pageTitle', { title: lecture.data.title }) : null);

  // Server data that the live stream just changed: refresh it (side effect, not derived state).
  useEffect(() => {
    if (session.lectureStatus === 'completed' || session.notesReady.length > 0) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.lectures.detail(lectureId) });
    }
  }, [session.lectureStatus, session.notesReady.length, lectureId, queryClient]);

  // Notifications (opt-out in Settings): toasts are side effects of state changes, not state.
  const previous = useRef({
    connection: connection.status,
    wasLive: false,
    status: session.lectureStatus,
    notes: 0,
  });
  useEffect(() => {
    const before = previous.current;
    if (
      connection.status === 'live' &&
      before.wasLive &&
      before.connection !== 'live' &&
      notifyConnection
    )
      toast.info(t('toasts.reconnected'));
    const ended = (s: string | null): boolean => s === 'processing' || s === 'completed';
    if (ended(session.lectureStatus) && before.status === 'recording' && notifyLectureEnded)
      toast.info(t('toasts.ended'));
    if (session.notesReady.length > 0 && before.notes === 0 && notifyNotesReady)
      toast.success(t('toasts.notesReady'));
    previous.current = {
      connection: connection.status,
      wasLive: before.wasLive || connection.status === 'live',
      status: session.lectureStatus,
      notes: session.notesReady.length,
    };
  }, [
    connection.status,
    session.lectureStatus,
    session.notesReady.length,
    notifyConnection,
    notifyLectureEnded,
    notifyNotesReady,
    t,
  ]);

  if (lecture.isPending) {
    return (
      <LoadingRegion label={tc('loading')} className={styles.loading}>
        <Skeleton className={styles.skeletonTitle} />
        <Skeleton className={styles.skeletonBar} />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className={styles.skeletonLine} />
        ))}
      </LoadingRegion>
    );
  }
  if (lecture.isError) {
    return isApiError(lecture.error) && lecture.error.isNotFound ? (
      <EmptyState icon={FileQuestion} title={t('connectionBanner.notFound')} />
    ) : (
      <ErrorState title={tc('loading')} onRetry={() => void lecture.refetch()} />
    );
  }

  const status = session.lectureStatus ?? lecture.data.status;
  const paused = session.lectureStatus === null ? lecture.data.paused : session.paused;
  const isLecturer = user !== null && user.role !== 'student';
  const canControl = canEditLecture(user, lecture.data);
  const ended = status === 'completed' || status === 'processing' || status === 'failed';

  return (
    <>
      <PageHeader
        title={lecture.data.title}
        eyebrow={
          lecture.data.subject
            ? `${lecture.data.subject.code} · ${lecture.data.subject.name}`
            : undefined
        }
      />
      <div className={styles.sticky}>
        <LiveHeader
          status={status}
          paused={paused}
          elapsedMs={elapsedMs(session, now)}
          language={session.latestLanguage}
          connection={connection}
          latencyMs={latency}
          announce={announce}
          onToggleAnnounce={() => {
            setPref('announce', !announce);
          }}
        />
      </div>
      {canControl && (
        <LiveControls
          lectureId={lectureId}
          status={status}
          paused={paused}
          deviceOnline={session.device?.online ?? null}
        />
      )}
      <div className={styles.banners}>
        <ConnectionBanner
          connection={connection}
          lectureId={lectureId}
          onResume={() => {
            manager.resume();
          }}
        />
        <WidgetErrorBoundary>
          <DeviceAlertBanner
            device={session.device}
            recording={status === 'recording'}
            isLecturer={isLecturer}
          />
        </WidgetErrorBoundary>
      </div>
      {status === 'scheduled' && (
        <EmptyState
          icon={Mic}
          title={isLecturer ? t('waiting.lecturerTitle') : t('waiting.studentTitle')}
          body={isLecturer ? t('waiting.lecturerBody') : t('waiting.studentBody')}
        />
      )}
      {ended && (
        <EmptyState
          icon={CircleCheck}
          title={t('ended.title')}
          body={session.notesReady.length > 0 ? t('ended.notesReady') : t('ended.body')}
          action={
            <ButtonLink variant="primary" to={paths.lecture(lectureId)}>
              {t('ended.open')}
            </ButtonLink>
          }
        />
      )}
      {canControl && lecture.data.device_id !== null && (
        <WidgetErrorBoundary>
          <DeviceMonitor deviceId={lecture.data.device_id} status={session.device} />
        </WidgetErrorBoundary>
      )}
      <div className={styles.layout}>
        <WidgetErrorBoundary>
          <LiveTranscriptPanel lectureId={lectureId} canEdit={canControl} />
        </WidgetErrorBoundary>
        <WidgetErrorBoundary>
          <LiveKeyTermsPanel />
        </WidgetErrorBoundary>
      </div>
    </>
  );
}

export function LiveLectureRoute() {
  const { lectureId } = useParams();
  if (lectureId === undefined) return null;
  // Keyed so switching lectures resets every live view state.
  return <LiveScreen key={lectureId} lectureId={lectureId} />;
}
