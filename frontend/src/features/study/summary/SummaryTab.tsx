import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/time';
import { useSummary } from '../api';
import { AiNote, StudyError, StudySkeleton } from '../StudyCommon';
import styles from '../Study.module.css';

export function SummaryTab() {
  const { lectureId = '' } = useParams();
  const { t } = useTranslation('study');
  const summary = useSummary(lectureId);
  if (summary.isPending) return <StudySkeleton />;
  if (summary.isError) {
    return (
      <StudyError
        error={summary.error}
        notReady={{ title: t('summary.notReadyTitle'), body: t('summary.notReadyBody') }}
        notPublished={{ title: t('notes.notPublishedTitle'), body: t('notes.notPublishedBody') }}
        errorTitle={t('summary.errorTitle')}
        onRetry={() => void summary.refetch()}
      />
    );
  }
  return (
    <article className="prose">
      <AiNote />
      <h2>{t('summary.overview')}</h2>
      <p>{summary.data.overview}</p>
      <h2>{t('summary.keyPoints')}</h2>
      <ul>
        {summary.data.key_points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <p className={styles.muted}>
        {t('summary.generated', { date: formatDateTime(summary.data.generated_at) })}
      </p>
    </article>
  );
}
