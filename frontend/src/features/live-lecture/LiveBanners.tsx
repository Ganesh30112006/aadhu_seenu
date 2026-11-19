import { HardDrive, LogIn, MicOff, RefreshCw, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConnectionState } from '@/api/ws/connectionMachine';
import type { DeviceStatus } from '@/api/ws/messages';
import { paths } from '@/app/paths';
import { Button, ButtonLink } from '@/components/Button';
import { Banner } from '@/components/Feedback';

const BUFFER_WARN_PCT = 80;

/** Device problems, worded for the audience: actions for the lecturer, reassurance for students. */
export function DeviceAlertBanner({
  device,
  recording,
  isLecturer,
}: {
  device: DeviceStatus | null;
  recording: boolean;
  isLecturer: boolean;
}) {
  const { t } = useTranslation('live');
  if (device === null) return null;
  if (!device.online) {
    return (
      <Banner tone="warning" icon={WifiOff}>
        {isLecturer ? t('device.offlineLecturer') : t('device.offlineStudent')}
      </Banner>
    );
  }
  const buffer = Math.max(device.psram_buffer_pct, device.flash_buffer_pct);
  if (isLecturer && buffer > BUFFER_WARN_PCT) {
    return (
      <Banner tone="warning" icon={HardDrive}>
        {t('device.bufferLecturer', { pct: Math.round(buffer) })}
      </Banner>
    );
  }
  if (isLecturer && recording && !device.recording) {
    return (
      <Banner tone="warning" icon={MicOff}>
        {t('device.notRecordingLecturer')}
      </Banner>
    );
  }
  return null;
}

/** Our own connection to the server (not the device's). */
export function ConnectionBanner({
  connection,
  onResume,
  lectureId,
}: {
  connection: ConnectionState;
  onResume: () => void;
  lectureId: string;
}) {
  const { t } = useTranslation('live');
  switch (connection.status) {
    case 'reconnecting':
      return (
        <Banner tone="warning" icon={RefreshCw}>
          {t('connectionBanner.reconnecting')}
        </Banner>
      );
    case 'offline':
      return (
        <Banner
          tone="warning"
          icon={WifiOff}
          action={
            connection.reason === 'hidden' ? (
              <Button onClick={onResume}>{t('connectionBanner.resume')}</Button>
            ) : undefined
          }
        >
          {connection.reason === 'hidden'
            ? t('connectionBanner.offlineHidden')
            : t('connectionBanner.offlineNetwork')}
        </Banner>
      );
    case 'closed':
      if (connection.reason === 'unauthorized') {
        return (
          <Banner
            tone="danger"
            role="alert"
            icon={LogIn}
            action={
              <ButtonLink to={paths.login(paths.live(lectureId))}>
                {t('connectionBanner.signIn')}
              </ButtonLink>
            }
          >
            {t('connectionBanner.unauthorized')}
          </Banner>
        );
      }
      return connection.reason === 'not_found' ? (
        <Banner tone="danger" role="alert">
          {t('connectionBanner.notFound')}
        </Banner>
      ) : null;
    default:
      return null;
  }
}
