import { lazy, Suspense, useState } from 'react';
import { CircleCheck, FilePen, FileText, Pencil, RefreshCw, Send } from 'lucide-react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/Dialog';
import { Banner, EmptyState } from '@/components/Feedback';
import { StatusBadge } from '@/components/StatusBadge';
import { toast } from '@/components/Toast';
import { useCurrentUser } from '@/features/auth/api';
import { useLecture } from '@/features/lectures/api';
import { formatDateTime } from '@/lib/time';
import { useNotes, useNotesMutations } from '../api';
import { AiNote, StudyError, StudySkeleton } from '../StudyCommon';
import styles from '../Study.module.css';
import { NotesToc, NotesView } from './NotesView';

// The editor (and its form code) loads only when a lecturer opens it.
const NotesEditor = lazy(async () => ({ default: (await import('./NotesEditor')).NotesEditor }));

export function NotesTab() {
  const { lectureId = '' } = useParams();
  const { t } = useTranslation('study');
  const user = useCurrentUser();
  const lecture = useLecture(lectureId);
  const notes = useNotes(lectureId);
  const { regenerate, publish } = useNotesMutations(lectureId);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'publish' | 'regenerate' | null>(null);
  const canEdit =
    user !== null &&
    (user.role === 'admin' || (user.role === 'lecturer' && lecture.data?.lecturer_id === user.id));

  if (notes.isPending) return <StudySkeleton />;
  if (notes.isError) {
    return (
      <StudyError
        error={notes.error}
        notReady={{ title: t('notes.notReadyTitle'), body: t('notes.notReadyBody') }}
        notPublished={{ title: t('notes.notPublishedTitle'), body: t('notes.notPublishedBody') }}
        errorTitle={t('notes.errorTitle')}
        onRetry={() => void notes.refetch()}
      />
    );
  }
  const data = notes.data;
  if (editing) {
    return (
      <Suspense fallback={<StudySkeleton />}>
        <NotesEditor
          lectureId={lectureId}
          notes={data}
          onDone={() => {
            setEditing(false);
          }}
        />
      </Suspense>
    );
  }
  const pending = data.generation_status === 'pending';
  return (
    <>
      {canEdit && (
        <div className={styles.toolbar}>
          {data.published ? (
            <StatusBadge kind="connected" icon={CircleCheck} label={t('notes.publishedBadge')} />
          ) : (
            <StatusBadge kind="idle" icon={FilePen} label={t('notes.draftBadge')} />
          )}
          <span className={styles.muted}>
            {t('notes.updated', { date: formatDateTime(data.updated_at) })}
          </span>
          <span className={styles.toolbarSpacer} />
          <Button
            icon={Pencil}
            disabled={pending}
            onClick={() => {
              setEditing(true);
            }}
          >
            {t('notes.edit')}
          </Button>
          <Button
            icon={RefreshCw}
            disabled={pending}
            onClick={() => {
              setConfirm('regenerate');
            }}
          >
            {t('notes.regenerate')}
          </Button>
          {!data.published && (
            <Button
              variant="primary"
              icon={Send}
              disabled={pending}
              onClick={() => {
                setConfirm('publish');
              }}
            >
              {t('notes.publish')}
            </Button>
          )}
        </div>
      )}
      {pending && (
        <Banner tone="info" icon={RefreshCw}>
          {t('notes.pendingBanner')}
        </Banner>
      )}
      {data.generation_status === 'failed' && (
        <Banner tone="danger">{t('notes.failedBanner')}</Banner>
      )}
      {canEdit && !data.published && !pending && (
        <Banner tone="warning">{t('notes.draftBanner')}</Banner>
      )}
      <AiNote />
      {data.sections.length === 0 ? (
        <EmptyState icon={FileText} title={t('notes.emptySections')} />
      ) : (
        <div className={styles.notesLayout}>
          <NotesToc sections={data.sections} />
          <NotesView lectureId={lectureId} sections={data.sections} />
        </div>
      )}
      <ConfirmDialog
        open={confirm === 'publish'}
        onOpenChange={(open) => {
          setConfirm(open ? 'publish' : null);
        }}
        title={t('notes.publishConfirmTitle')}
        description={t('notes.publishConfirmBody')}
        confirmLabel={t('notes.publish')}
        loading={publish.isPending}
        onConfirm={() => {
          publish.mutate(undefined, {
            onSuccess: () => {
              toast.success(t('notes.published'));
              setConfirm(null);
            },
          });
        }}
      />
      <ConfirmDialog
        open={confirm === 'regenerate'}
        onOpenChange={(open) => {
          setConfirm(open ? 'regenerate' : null);
        }}
        title={t('notes.regenerateConfirmTitle')}
        description={t('notes.regenerateConfirmBody')}
        confirmLabel={t('notes.regenerateConfirm')}
        confirmVariant="danger"
        loading={regenerate.isPending}
        onConfirm={() => {
          regenerate.mutate(undefined, {
            onSuccess: () => {
              toast.info(t('notes.regenerateStarted'));
              setConfirm(null);
            },
          });
        }}
      />
    </>
  );
}
