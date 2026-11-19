import { useTranslation } from 'react-i18next';
import { LoadingRegion, Skeleton } from '@/components/Feedback';
import styles from './AppLoading.module.css';

/** First paint while the session check runs: mirrors the shell layout to avoid a layout jump. */
export function AppLoading() {
  const { t } = useTranslation();
  return (
    <LoadingRegion label={t('loading')} className={styles.page}>
      <div className={styles.header}>
        <Skeleton className={styles.brand} />
      </div>
      <div className={styles.main}>
        <Skeleton className={styles.title} />
        <Skeleton className={styles.line} />
        <Skeleton className={styles.block} />
      </div>
    </LoadingRegion>
  );
}
