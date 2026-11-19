import {
  CalendarClock,
  Circle,
  CircleCheck,
  LoaderCircle,
  Pause,
  TriangleAlert,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LectureStatus } from '@/api/types';
import { cx } from '@/lib/cx';
import styles from './StatusBadge.module.css';

/** Colours mirror the device LED: red recording, blue processing, green connected/completed,
 *  yellow disconnected, grey idle. Never colour alone: always icon + text. */
export type StatusKind = 'recording' | 'processing' | 'connected' | 'disconnected' | 'idle';

interface StatusBadgeProps {
  kind: StatusKind;
  label: string;
  icon: LucideIcon;
  motion?: 'pulse' | 'spin' | 'none';
  alert?: boolean;
  className?: string | undefined;
}

export function StatusBadge({
  kind,
  label,
  icon: Icon,
  motion = 'none',
  alert = false,
  className,
}: StatusBadgeProps) {
  return (
    <span
      className={cx(
        styles.badge,
        styles[kind],
        motion === 'pulse' && styles.pulse,
        motion === 'spin' && styles.spin,
        alert && styles.alertIcon,
        className,
      )}
    >
      <Icon aria-hidden="true" />
      {label}
    </span>
  );
}

const LECTURE_STATUS: Record<
  LectureStatus,
  { kind: StatusKind; icon: LucideIcon; motion?: 'pulse' | 'spin'; alert?: boolean }
> = {
  recording: { kind: 'recording', icon: Circle, motion: 'pulse' },
  processing: { kind: 'processing', icon: LoaderCircle, motion: 'spin' },
  completed: { kind: 'connected', icon: CircleCheck },
  scheduled: { kind: 'idle', icon: CalendarClock },
  failed: { kind: 'idle', icon: TriangleAlert, alert: true },
};

export function LectureStatusBadge({
  status,
  paused = false,
  className,
}: {
  status: LectureStatus;
  /** Recording but capture paused on the device: grey "Paused" instead of red "Recording". */
  paused?: boolean;
  className?: string | undefined;
}) {
  const { t } = useTranslation();
  if (paused && status === 'recording') {
    return (
      <StatusBadge
        kind="idle"
        icon={Pause}
        label={t('status.paused')}
        {...(className !== undefined && { className })}
      />
    );
  }
  const config = LECTURE_STATUS[status];
  return (
    <StatusBadge
      kind={config.kind}
      icon={config.icon}
      motion={config.motion ?? 'none'}
      alert={config.alert ?? false}
      label={t(`status.${status}`)}
      {...(className !== undefined && { className })}
    />
  );
}

/** Device: recording (red) > disconnected (yellow) > connected (green). */
export function DeviceStatusBadge({ online, recording }: { online: boolean; recording: boolean }) {
  const { t } = useTranslation();
  if (!online)
    return <StatusBadge kind="disconnected" icon={WifiOff} label={t('status.disconnected')} />;
  if (recording)
    return (
      <StatusBadge kind="recording" icon={Circle} motion="pulse" label={t('status.recording')} />
    );
  return <StatusBadge kind="connected" icon={Wifi} label={t('status.connected')} />;
}
