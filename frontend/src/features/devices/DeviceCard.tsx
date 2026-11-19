import { formatDistanceStrict, parseISO } from 'date-fns';
import { Signal, SignalHigh, SignalLow, SignalMedium, SignalZero } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Device } from '@/api/types';
import { paths } from '@/app/paths';
import { DeviceStatusBadge } from '@/components/StatusBadge';
import { cx } from '@/lib/cx';
import { useNow } from '@/lib/useNow';
import { signalLevel } from './api';
import styles from './Devices.module.css';

const SIGNAL_ICON = {
  excellent: Signal,
  good: SignalHigh,
  fair: SignalMedium,
  weak: SignalLow,
  none: SignalZero,
} as const;

export function BufferMeter({ label, pct }: { label: string; pct: number }) {
  const { t } = useTranslation('devices');
  const high = pct >= 80;
  return (
    <div className={styles.meterRow}>
      <span>{label}</span>
      <meter
        className={cx(styles.meter, high && styles.meterHigh)}
        min={0}
        max={100}
        low={60}
        high={80}
        optimum={0}
        value={pct}
      >
        {pct}%
      </meter>
      <span className={styles.meterValue}>
        {t('buffer.value', { pct: Math.round(pct) })}
        {high && ` · ${t('buffer.high')}`}
      </span>
    </div>
  );
}

export function SignalStrength({ rssi }: { rssi: number | null }) {
  const { t } = useTranslation('devices');
  const level = signalLevel(rssi);
  const Icon = SIGNAL_ICON[level];
  return (
    <span className={styles.signal}>
      <Icon aria-hidden="true" />
      {t(`signal.${level}`)}
      {rssi !== null && <span className={styles.muted}> ({t('signal.dbm', { value: rssi })})</span>}
    </span>
  );
}

export function LastSeen({ iso }: { iso: string | null }) {
  const { t } = useTranslation('devices');
  const now = useNow();
  if (iso === null) return <>{t('lastSeen.never')}</>;
  const date = parseISO(iso);
  const seconds = (now - date.getTime()) / 1000;
  return (
    <time dateTime={iso}>
      {seconds < 30
        ? t('lastSeen.now')
        : t('lastSeen.ago', { time: formatDistanceStrict(date, now) })}
    </time>
  );
}

/** Health of one classroom microphone, worded for lecturers (not engineers). */
export function DeviceCard({ device, headingLevel = 3 }: { device: Device; headingLevel?: 2 | 3 }) {
  const { t } = useTranslation('devices');
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <Heading className={styles.cardTitle}>
          <Link to={paths.device(device.id)} className={styles.cardLink}>
            {device.name}
          </Link>
        </Heading>
        <DeviceStatusBadge online={device.online} recording={device.recording} />
      </div>
      <p className={styles.muted}>{device.room}</p>
      <dl className={styles.facts}>
        <dt>{t('fields.wifi')}</dt>
        <dd>
          <SignalStrength rssi={device.wifi_rssi} />
        </dd>
        <dt>{t('fields.lastSeen')}</dt>
        <dd>
          <LastSeen iso={device.last_seen_at} />
        </dd>
      </dl>
      <BufferMeter label={t('fields.psram')} pct={device.psram_buffer_pct} />
      <BufferMeter label={t('fields.flash')} pct={device.flash_buffer_pct} />
    </article>
  );
}
