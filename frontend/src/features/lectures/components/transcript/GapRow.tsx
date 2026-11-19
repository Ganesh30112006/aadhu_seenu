import { CloudOff, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DisplayGap } from '@/lib/transcript/timeline';
import { cx } from '@/lib/cx';
import { formatOffset } from '@/lib/time';
import styles from './Transcript.module.css';

/** Inline marker for audio recorded offline: "syncing" until backfill replaces it in place. */
export function GapRow({ gap }: { gap: DisplayGap }) {
  const { t } = useTranslation('live');
  const start = formatOffset(gap.start_ms);
  const syncing = gap.state === 'syncing';
  const label = syncing
    ? gap.end_ms === null
      ? t('gap.syncingOpen', { start })
      : t('gap.syncing', { start, end: formatOffset(gap.end_ms) })
    : t('gap.missing', { start, end: formatOffset(gap.end_ms ?? gap.start_ms) });
  const Icon = syncing ? LoaderCircle : CloudOff;
  return (
    <div className={cx(styles.gap, syncing ? styles.gapSyncing : styles.gapMissing)} role="note">
      <Icon aria-hidden="true" className={cx(syncing && styles.spin)} />
      <div>
        <p className={styles.gapTitle}>{label}</p>
        {syncing && <p className={styles.gapHint}>{t('gap.syncingHint')}</p>}
      </div>
    </div>
  );
}
