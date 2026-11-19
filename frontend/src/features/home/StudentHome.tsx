import { useInfiniteQuery } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Lecture } from '@/api/types';
import { paths } from '@/app/paths';
import { ButtonLink } from '@/components/Button';
import { EmptyState, ErrorState } from '@/components/Feedback';
import { Section } from '@/components/Page';
import { lecturesQuery } from '@/features/lectures/api';
import { CardsSkeleton, LectureCards } from './HomeCards';
import styles from './Home.module.css';

export function StudentHome() {
  const { t } = useTranslation('home');
  const { t: tc } = useTranslation();
  const live = useInfiniteQuery({
    ...lecturesQuery({ status: 'recording' }, 10),
    refetchInterval: 30_000,
  });
  const recent = useInfiniteQuery(lecturesQuery({ status: 'completed' }, 20));
  const bySubject = new Map<string, Lecture[]>();
  for (const lecture of recent.data?.pages[0]?.items ?? []) {
    const key = lecture.subject === null ? '' : `${lecture.subject.code} · ${lecture.subject.name}`;
    bySubject.set(key, [...(bySubject.get(key) ?? []), lecture]);
  }
  return (
    <>
      <Section title={t('student.liveHeading')} headingId="live">
        {live.isPending ? (
          <CardsSkeleton label={tc('loading')} />
        ) : live.isError ? (
          <ErrorState
            compact
            headingLevel={3}
            title={t('recentErrorTitle')}
            onRetry={() => void live.refetch()}
          />
        ) : (live.data.pages[0]?.items.length ?? 0) === 0 ? (
          <EmptyState compact headingLevel={3} icon={Radio} title={t('student.liveEmpty')} />
        ) : (
          <LectureCards lectures={live.data.pages[0]?.items ?? []} drafts={false} />
        )}
      </Section>
      <Section
        title={t('student.recentHeading')}
        headingId="recent"
        actions={<ButtonLink to={paths.library()}>{t('student.seeAll')}</ButtonLink>}
      >
        {recent.isPending ? (
          <CardsSkeleton label={tc('loading')} />
        ) : recent.isError ? (
          <ErrorState
            compact
            headingLevel={3}
            title={t('recentErrorTitle')}
            onRetry={() => void recent.refetch()}
          />
        ) : bySubject.size === 0 ? (
          <p className={styles.lead}>{t('student.recentEmpty')}</p>
        ) : (
          [...bySubject].map(([subject, lectures]) => (
            <div key={subject} className={styles.subjectGroup}>
              <h3 className={styles.subjectTitle}>{subject}</h3>
              <LectureCards lectures={lectures} drafts={false} />
            </div>
          ))
        )}
      </Section>
    </>
  );
}
