import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/time';
import { useRevision } from '../api';
import { AiNote, StudyError, StudySkeleton } from '../StudyCommon';
import styles from '../Study.module.css';

/** Short exam-revision notes: the points to remember and the main takeaways. */
export function RevisionTab() {
  const { lectureId = '' } = useParams();
  const { t } = useTranslation('study');
  const revision = useRevision(lectureId);
  if (revision.isPending) return <StudySkeleton />;
  if (revision.isError) {
    return (
      <StudyError
        error={revision.error}
        notReady={{ title: t('revision.notReadyTitle'), body: t('revision.notReadyBody') }}
        notPublished={{ title: t('notes.notPublishedTitle'), body: t('notes.notPublishedBody') }}
        errorTitle={t('revision.errorTitle')}
        onRetry={() => void revision.refetch()}
      />
    );
  }
  const { points, takeaways, generated_at } = revision.data;
  return (
    <article className="prose">
      <AiNote />
      <h2>{t('revision.points')}</h2>
      {points.length === 0 ? (
        <p>{t('revision.empty')}</p>
      ) : (
        <ol>
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ol>
      )}
      <h2>{t('revision.takeaways')}</h2>
      {takeaways.length === 0 ? (
        <p>{t('revision.empty')}</p>
      ) : (
        <ul>
          {takeaways.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      <p className={styles.muted}>
        {t('revision.generated', { date: formatDateTime(generated_at) })}
      </p>
    </article>
  );
}
