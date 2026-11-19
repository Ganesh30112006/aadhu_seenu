import { ArrowLeft, Cpu, FileQuestion } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import { paths } from '@/app/paths';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { ButtonLink } from '@/components/Button';
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/Feedback';
import { PageHeader } from '@/components/Page';
import { DeviceStatusBadge } from '@/components/StatusBadge';
import { useCurrentUser } from '@/features/auth/api';
import { useDevice, useDevices } from './api';
import { BufferMeter, DeviceCard, LastSeen, SignalStrength } from './DeviceCard';
import { DeviceLecturersForm, DeviceSettingsForm } from './DeviceSettings';
import { RegisterDeviceDialog } from './RegisterDeviceDialog';
import styles from './Devices.module.css';

function GridSkeleton() {
  const { t } = useTranslation();
  return (
    <LoadingRegion label={t('loading')} className={styles.grid}>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className={styles.card} />
      ))}
    </LoadingRegion>
  );
}

export function DevicesRoute() {
  const { t } = useTranslation('devices');
  useDocumentTitle(t('title'));
  const user = useCurrentUser();
  const devices = useDevices();
  const admin = user?.role === 'admin';
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={admin ? <RegisterDeviceDialog /> : undefined}
      />
      {devices.isPending ? (
        <GridSkeleton />
      ) : devices.isError ? (
        <ErrorState title={t('errorTitle')} onRetry={() => void devices.refetch()} />
      ) : devices.data.length === 0 ? (
        <EmptyState
          icon={Cpu}
          title={t('emptyTitle')}
          body={admin ? t('emptyAdmin') : t('emptyLecturer')}
        />
      ) : (
        <div className={styles.grid}>
          {devices.data.map((device) => (
            <DeviceCard key={device.id} device={device} headingLevel={2} />
          ))}
        </div>
      )}
    </>
  );
}

export function DeviceDetailRoute() {
  const { deviceId = '' } = useParams();
  const { t } = useTranslation('devices');
  const user = useCurrentUser();
  const device = useDevice(deviceId);
  useDocumentTitle(device.data?.name ?? t('title'));
  const back = (
    <ButtonLink to={paths.devices()} icon={ArrowLeft}>
      {t('back')}
    </ButtonLink>
  );
  if (device.isPending) return <GridSkeleton />;
  if (device.isError) {
    return isApiError(device.error) && device.error.isNotFound ? (
      <EmptyState icon={FileQuestion} title={t('notFoundTitle')} action={back} />
    ) : (
      <ErrorState title={t('errorTitle')} onRetry={() => void device.refetch()} />
    );
  }
  const d = device.data;
  return (
    <>
      <PageHeader
        title={d.name}
        description={d.room}
        actions={back}
        eyebrow={<DeviceStatusBadge online={d.online} recording={d.recording} />}
      />
      <div className={styles.detailGrid}>
        <dl className={styles.facts}>
          <dt>{t('fields.wifi')}</dt>
          <dd>
            <SignalStrength rssi={d.wifi_rssi} />
          </dd>
          <dt>{t('fields.lastSeen')}</dt>
          <dd>
            <LastSeen iso={d.last_seen_at} />
          </dd>
          <dt>{t('fields.firmware')}</dt>
          <dd>{d.firmware_version}</dd>
          <dt>{t('fields.serial')}</dt>
          <dd>
            <code>{d.serial}</code>
          </dd>
          <dt>{t('fields.recording')}</dt>
          <dd>
            {d.recording
              ? d.paused
                ? t('recording.paused')
                : t('recording.yes')
              : t('recording.no')}
          </dd>
          <dt>{t('fields.micLevel')}</dt>
          <dd>
            {d.level_dbfs === null
              ? t('mic.noReading')
              : t('mic.level', { value: Math.round(d.level_dbfs) })}
          </dd>
          <dt>{t('fields.micStatus')}</dt>
          <dd>{d.mic_ok === null ? t('mic.unknown') : d.mic_ok ? t('mic.ok') : t('mic.silent')}</dd>
          <dt>{t('fields.pending')}</dt>
          <dd>{d.pending_chunks}</dd>
          <dt>{t('fields.gain')}</dt>
          <dd>{t('mic.gain', { value: d.gain })}</dd>
          <dt>{t('fields.vad')}</dt>
          <dd>{d.vad_enabled ? t('recording.yes') : t('recording.no')}</dd>
          {d.current_lecture_id !== null && (
            <>
              <dt>{t('fields.currentLecture')}</dt>
              <dd>
                <Link to={paths.live(d.current_lecture_id)}>{t('openLecture')}</Link>
              </dd>
            </>
          )}
        </dl>
        <BufferMeter label={t('fields.psram')} pct={d.psram_buffer_pct} />
        <BufferMeter label={t('fields.flash')} pct={d.flash_buffer_pct} />
        {user?.role === 'admin' && (
          <>
            <DeviceSettingsForm device={d} />
            <DeviceLecturersForm device={d} />
          </>
        )}
      </div>
    </>
  );
}
