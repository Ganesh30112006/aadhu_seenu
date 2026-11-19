import { FileQuestion, Radio, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import type { Lecture } from '@/api/types';
import { isLectureTab, LECTURE_TABS, paths, type LectureTab } from '@/app/paths';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button, ButtonLink } from '@/components/Button';
import { ConfirmDialog } from '@/components/Dialog';
import { Banner, EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/Feedback';
import { LanguageTag, PageHeader } from '@/components/Page';
import { LectureStatusBadge } from '@/components/StatusBadge';
import { Tabs } from '@/components/Tabs';
import { toast } from '@/components/Toast';
import { useCurrentUser } from '@/features/auth/api';
import { formatDateTime, toIsoDuration } from '@/lib/time';
import { useDeleteLecture, useLecture, useUpdateLecture } from '../api';
import { useFormatDuration } from '../components/useFormatDuration';
import { ExportMenu } from './ExportMenu';
import styles from './Detail.module.css';

function LifecycleBanner({ lecture, canEdit }: { lecture: Lecture; canEdit: boolean }) {
  const { t } = useTranslation('lectures');
  const update = useUpdateLecture(lecture.id);
  if (!lecture.consent_confirmed && canEdit) {
    return (
      <Banner
        tone="warning"
        action={
          <Button
            icon={ShieldCheck}
            loading={update.isPending}
            onClick={() => {
              update.mutate(
                { consent_confirmed: true },
                {
                  onSuccess: () => {
                    toast.success(t('detail.consentConfirmed'));
                  },
                },
              );
            }}
          >
            {t('detail.confirmConsent')}
          </Button>
        }
      >
        {t('detail.consentPending')}
      </Banner>
    );
  }
  if (lecture.status === 'recording') {
    return (
      <Banner
        tone="info"
        icon={Radio}
        action={
          <ButtonLink variant="primary" to={paths.live(lecture.id)}>
            {t('detail.openLive')}
          </ButtonLink>
        }
      >
        {t('detail.liveNow')}
      </Banner>
    );
  }
  if (lecture.status === 'processing') return <Banner tone="info">{t('detail.processing')}</Banner>;
  if (lecture.status === 'failed') return <Banner tone="danger">{t('detail.failed')}</Banner>;
  if (lecture.status === 'scheduled') return <Banner tone="info">{t('detail.scheduled')}</Banner>;
  return null;
}

function DetailHeader({ lecture, canEdit }: { lecture: Lecture; canEdit: boolean }) {
  const { t } = useTranslation('lectures');
  const { t: tc } = useTranslation();
  const formatDuration = useFormatDuration();
  const navigate = useNavigate();
  const remove = useDeleteLecture();
  const [confirming, setConfirming] = useState(false);
  const when = lecture.started_at ?? lecture.created_at;
  return (
    <>
      <PageHeader
        title={lecture.title}
        eyebrow={
          <>
            {lecture.subject !== null && (
              <span>{`${lecture.subject.code} · ${lecture.subject.name}`}</span>
            )}
            <LectureStatusBadge status={lecture.status} />
          </>
        }
        description={
          <span className={styles.meta}>
            {lecture.lecturer_name !== null && (
              <span>{t('detail.by', { name: lecture.lecturer_name })}</span>
            )}
            <time dateTime={when}>{formatDateTime(when)}</time>
            {lecture.duration_ms > 0 && (
              <time dateTime={toIsoDuration(lecture.duration_ms)}>
                {formatDuration(lecture.duration_ms)}
              </time>
            )}
            {lecture.languages_detected.map((code) => (
              <LanguageTag key={code} code={code} name={tc(`language.${code}`)} />
            ))}
          </span>
        }
        actions={
          <>
            <ExportMenu lectureId={lecture.id} />
            {canEdit && (
              <Button
                variant="danger"
                icon={Trash2}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                {t('detail.delete')}
              </Button>
            )}
          </>
        }
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('detail.deleteConfirmTitle')}
        description={t('detail.deleteConfirmBody')}
        confirmLabel={t('detail.delete')}
        confirmVariant="danger"
        loading={remove.isPending}
        onConfirm={() => {
          remove.mutate(lecture.id, {
            onSuccess: () => {
              toast.success(t('detail.deleted'));
              void navigate(paths.library(), { replace: true });
            },
          });
        }}
      />
    </>
  );
}

export function LectureDetailLayout() {
  const { lectureId = '' } = useParams();
  const { t } = useTranslation('lectures');
  const { t: tc } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const lecture = useLecture(lectureId);
  useDocumentTitle(lecture.data?.title ?? null);
  const segment = pathname.split('/').at(-1);
  const tab: LectureTab = isLectureTab(segment) ? segment : 'transcript';

  if (lecture.isPending) {
    return (
      <LoadingRegion label={tc('loading')} className={styles.loading}>
        <Skeleton className={styles.skeletonTitle} />
        <Skeleton className={styles.skeletonMeta} />
        <Skeleton className={styles.skeletonTabs} />
      </LoadingRegion>
    );
  }
  if (lecture.isError) {
    return isApiError(lecture.error) && lecture.error.isNotFound ? (
      <EmptyState
        icon={FileQuestion}
        title={t('detail.notFoundTitle')}
        body={t('detail.notFoundBody')}
      />
    ) : (
      <ErrorState
        title={t('detail.errorTitle')}
        onRetry={() => void lecture.refetch()}
        retrying={lecture.isRefetching}
      />
    );
  }
  const canEdit =
    user !== null &&
    (user.role === 'admin' || (user.role === 'lecturer' && lecture.data.lecturer_id === user.id));
  return (
    <>
      <DetailHeader lecture={lecture.data} canEdit={canEdit} />
      <div className={styles.banner}>
        <LifecycleBanner lecture={lecture.data} canEdit={canEdit} />
      </div>
      <Tabs
        value={tab}
        label={t('detail.tabs.label')}
        tabs={LECTURE_TABS.map((value) => ({ value, label: t(`detail.tabs.${value}`) }))}
        onValueChange={(next) => void navigate(paths.lecture(lectureId, next))}
      >
        <Outlet />
      </Tabs>
    </>
  );
}
