import type { Lecture } from '@/api/types';
import { LoadingRegion, Skeleton } from '@/components/Feedback';
import { LectureCard } from '@/features/lectures/components/LectureCard';
import styles from './Home.module.css';

export function LectureCards({
  lectures,
  drafts,
}: {
  lectures: readonly Lecture[];
  drafts: boolean;
}) {
  return (
    <ul className={styles.list}>
      {lectures.map((lecture) => (
        <li key={lecture.id}>
          <LectureCard lecture={lecture} showDrafts={drafts} headingLevel={3} />
        </li>
      ))}
    </ul>
  );
}

export function CardsSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className={styles.list}>
      {[0, 1].map((i) => (
        <Skeleton key={i} className={styles.skeletonCard} />
      ))}
    </LoadingRegion>
  );
}
