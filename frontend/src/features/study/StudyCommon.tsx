import { Clock, EyeOff, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/Feedback';
import { artifactProblem } from './api';
import styles from './Study.module.css';

/** D9: study material is AI-generated (Amazon Bedrock); say so plainly. */
export function AiNote() {
  const { t } = useTranslation();
  return (
    <p className={styles.aiNote}>
      <Sparkles aria-hidden="true" />
      {t('aiGenerated')}
    </p>
  );
}

export function StudySkeleton() {
  const { t } = useTranslation();
  return (
    <LoadingRegion label={t('loading')} className={styles.skeleton}>
      <Skeleton className={styles.skeletonHeading} />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className={styles.skeletonLine} />
      ))}
    </LoadingRegion>
  );
}

interface StudyErrorProps {
  error: unknown;
  notReady: { title: string; body: string };
  notPublished?: { title: string; body: string };
  errorTitle: string;
  onRetry: () => void;
  extra?: ReactNode;
}

/** Not generated yet / not published yet / failed: three different messages, never a blank tab. */
export function StudyError({
  error,
  notReady,
  notPublished,
  errorTitle,
  onRetry,
  extra,
}: StudyErrorProps) {
  const problem = artifactProblem(error);
  if (problem === 'not_published' && notPublished !== undefined) {
    return (
      <EmptyState
        icon={EyeOff}
        title={notPublished.title}
        body={notPublished.body}
        action={extra}
      />
    );
  }
  if (problem === 'not_ready' || problem === 'not_published') {
    return <EmptyState icon={Clock} title={notReady.title} body={notReady.body} action={extra} />;
  }
  return <ErrorState title={errorTitle} onRetry={onRetry} />;
}
