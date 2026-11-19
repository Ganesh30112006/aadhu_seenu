import { useInfiniteQuery } from '@tanstack/react-query';
import { LibraryBig, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button } from '@/components/Button';
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/Feedback';
import { PageHeader } from '@/components/Page';
import { VirtualList } from '@/components/VirtualList';
import { useCurrentUser } from '@/features/auth/api';
import { lecturesQuery, useSubjects } from '../api';
import { LectureCard } from '../components/LectureCard';
import { LibraryFilters } from './LibraryFilters';
import { useLibraryFilters } from './useLibraryFilters';
import styles from './Library.module.css';

const PREFETCH_DISTANCE = 6;

export function LibraryRoute() {
  const { t } = useTranslation('lectures');
  const { t: tc } = useTranslation();
  useDocumentTitle(t('library.title'));
  const user = useCurrentUser();
  const { filters, setFilter, clear, active } = useLibraryFilters();
  const subjects = useSubjects();
  const lectures = useInfiniteQuery(lecturesQuery(filters));
  const items = lectures.data?.pages.flatMap((page) => page.items) ?? [];
  const total = lectures.data?.pages[0]?.total ?? 0;

  const loadMoreNear = (lastIndex: number): void => {
    if (
      lastIndex >= items.length - PREFETCH_DISTANCE &&
      lectures.hasNextPage &&
      !lectures.isFetchingNextPage
    ) {
      void lectures.fetchNextPage();
    }
  };

  return (
    <>
      <PageHeader title={t('library.title')} description={t('library.description')} />
      <LibraryFilters
        filters={filters}
        subjects={subjects.data ?? []}
        onChange={setFilter}
        onClear={clear}
        active={active}
      />
      {lectures.isPending ? (
        <LoadingRegion label={tc('loading')} className={styles.list}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.skeletonCard}>
              <Skeleton className={styles.skeletonTitle} />
              <Skeleton className={styles.skeletonMeta} />
              <Skeleton className={styles.skeletonBadge} />
            </div>
          ))}
        </LoadingRegion>
      ) : lectures.isError && items.length === 0 ? (
        // Full-page error only when nothing loaded; a failed *next* page keeps the list visible.
        <ErrorState
          title={t('library.errorTitle')}
          onRetry={() => void lectures.refetch()}
          retrying={lectures.isRefetching}
        />
      ) : items.length === 0 ? (
        active ? (
          <EmptyState
            icon={SearchX}
            title={t('library.noMatchesTitle')}
            body={t('library.noMatchesBody')}
            action={<Button onClick={clear}>{tc('actions.clearFilters')}</Button>}
          />
        ) : (
          <EmptyState
            icon={LibraryBig}
            title={t('library.emptyTitle')}
            body={t('library.emptyBody')}
          />
        )
      ) : (
        <>
          <p className={styles.count} role="status">
            {t('library.count', { count: total })}
          </p>
          <VirtualList
            label={t('library.title')}
            items={items}
            getKey={(lecture) => lecture.id}
            estimateSize={() => 148}
            onRangeChange={loadMoreNear}
            renderItem={(lecture) => (
              <div className={styles.rowGap}>
                <LectureCard lecture={lecture} showDrafts={user?.role !== 'student'} />
              </div>
            )}
          />
          <p className={styles.footer} role="status">
            {lectures.isFetchingNextPage
              ? t('library.loadingMore')
              : lectures.hasNextPage
                ? ''
                : t('library.end')}
          </p>
          {lectures.isFetchNextPageError && (
            <ErrorState
              compact
              title={t('library.errorTitle')}
              onRetry={() => void lectures.fetchNextPage()}
            />
          )}
        </>
      )}
    </>
  );
}
