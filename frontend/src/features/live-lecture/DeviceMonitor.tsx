import { useTranslation } from 'react-i18next';
import type { DeviceStatus } from '@/api/ws/messages';
import { useDevice } from '@/features/devices/api';
import { BufferMeter, LastSeen, SignalStrength } from '@/features/devices/DeviceCard';
import deviceStyles from '@/features/devices/Devices.module.css';
import { cx } from '@/lib/cx';
import styles from './Live.module.css';

const LEVEL_MIN_DBFS = -90;

type MicKey = 'monitor.micOk' | 'monitor.micSilent' | 'monitor.micUnknown' | 'monitor.micPaused';

function micKey(status: DeviceStatus | null): MicKey {
  if (!status?.online) return 'monitor.micUnknown';
  if (status.paused) return 'monitor.micPaused';
  if (status.mic_ok === false) return 'monitor.micSilent';
  return status.mic_ok === true ? 'monitor.micOk' : 'monitor.micUnknown';
}

/**
 * Lecturer view of the classroom microphone during a lecture: link to the server, Wi-Fi, input
 * level, offline storage and upload progress. Updated about once a second from `device.status`.
 */
export function DeviceMonitor({
  deviceId,
  status,
}: {
  deviceId: string;
  status: DeviceStatus | null;
}) {
  const { t } = useTranslation('live');
  const { t: td } = useTranslation('devices');
  const device = useDevice(deviceId);
  const online = status?.online ?? device.data?.online ?? false;
  const level = status?.online === true ? status.level_dbfs : null;
  const pending = status?.pending_chunks ?? device.data?.pending_chunks ?? 0;
  const silent = status?.mic_ok === false && status.online && !status.paused;

  return (
    <details className={styles.monitor} open>
      <summary className={styles.monitorSummary}>
        {t('monitor.heading')}
        {device.data !== undefined && <span className={styles.muted}> · {device.data.name}</span>}
      </summary>
      <dl className={styles.monitorGrid}>
        <div>
          <dt>{t('monitor.server')}</dt>
          <dd>{online ? t('monitor.connected') : t('monitor.disconnected')}</dd>
        </div>
        <div>
          <dt>{t('monitor.wifi')}</dt>
          <dd>
            <SignalStrength
              rssi={online ? (status?.wifi_rssi ?? device.data?.wifi_rssi ?? null) : null}
            />
          </dd>
        </div>
        <div>
          <dt>{t('monitor.mic')}</dt>
          <dd className={cx(silent && styles.warning)}>{t(micKey(status))}</dd>
        </div>
        <div className={styles.monitorWide}>
          <dt>{t('monitor.level')}</dt>
          <dd className={deviceStyles.meterRow}>
            <meter
              className={deviceStyles.meter}
              min={LEVEL_MIN_DBFS}
              max={0}
              low={-60}
              high={-6}
              optimum={-20}
              value={level ?? LEVEL_MIN_DBFS}
              aria-label={t('monitor.level')}
            >
              {level === null ? '—' : `${Math.round(level)} dBFS`}
            </meter>
            <span className={deviceStyles.meterValue}>
              {level === null ? '—' : t('monitor.levelValue', { db: Math.round(level) })}
            </span>
          </dd>
        </div>
        <div className={styles.monitorWide}>
          <dt>{t('monitor.storage')}</dt>
          <dd>
            <BufferMeter label={td('fields.psram')} pct={status?.psram_buffer_pct ?? 0} />
            <BufferMeter label={td('fields.flash')} pct={status?.flash_buffer_pct ?? 0} />
          </dd>
        </div>
        <div>
          <dt>{t('monitor.sync')}</dt>
          <dd>
            {pending === 0
              ? t('monitor.synced')
              : t('monitor.pending', { count: pending, seconds: Math.round(pending / 2) })}
          </dd>
        </div>
        <div>
          <dt>{t('monitor.lastAudio')}</dt>
          <dd>
            <LastSeen iso={status?.last_audio_at ?? null} />
          </dd>
        </div>
        {device.data !== undefined && (
          <div>
            <dt>{t('monitor.firmware')}</dt>
            <dd>
              {device.data.firmware_version} · <code>{device.data.serial}</code>
            </dd>
          </div>
        )}
      </dl>
    </details>
  );
}
