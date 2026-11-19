import { Activity, Megaphone, Radio, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ConnectionState } from '@/api/ws/connectionMachine';
import type { LectureStatus } from '@/api/types';
import { Button } from '@/components/Button';
import { LanguageTag } from '@/components/Page';
import { LectureStatusBadge, StatusBadge } from '@/components/StatusBadge';
import type { LanguageCode } from '@/lib/lang';
import { formatOffset, toIsoDuration } from '@/lib/time';
import styles from './Live.module.css';

const CONNECTION_LABEL = {
  idle: 'connection.idle',
  connecting: 'connection.connecting',
  live: 'connection.live',
  reconnecting: 'connection.reconnecting',
} as const;

type ConnectionKey =
  | (typeof CONNECTION_LABEL)[keyof typeof CONNECTION_LABEL]
  | 'connection.offlineHidden'
  | 'connection.offlineNetwork'
  | 'connection.closedEnded'
  | 'connection.closedUnauthorized'
  | 'connection.closedNotFound';

function connectionLabel(state: ConnectionState): ConnectionKey {
  if (state.status === 'offline')
    return state.reason === 'hidden' ? 'connection.offlineHidden' : 'connection.offlineNetwork';
  if (state.status === 'closed') {
    return state.reason === 'ended'
      ? 'connection.closedEnded'
      : state.reason === 'unauthorized'
        ? 'connection.closedUnauthorized'
        : 'connection.closedNotFound';
  }
  return CONNECTION_LABEL[state.status];
}

interface LiveHeaderProps {
  status: LectureStatus;
  paused: boolean;
  elapsedMs: number;
  language: LanguageCode | null;
  connection: ConnectionState;
  latencyMs: number | null;
  announce: boolean;
  onToggleAnnounce: () => void;
}

/** Recording status, elapsed time, detected language, connection state and measured delay. */
export function LiveHeader({
  status,
  paused,
  elapsedMs,
  language,
  connection,
  latencyMs,
  announce,
  onToggleAnnounce,
}: LiveHeaderProps) {
  const { t } = useTranslation('live');
  const { t: tc } = useTranslation();
  const label = t(connectionLabel(connection));
  const live = connection.status === 'live';
  return (
    <div className={styles.header}>
      <LectureStatusBadge status={status} paused={paused} />
      <span className={styles.stat}>
        <span className="visually-hidden">{t('elapsed')}: </span>
        <time dateTime={toIsoDuration(elapsedMs)} className={styles.elapsed}>
          {formatOffset(elapsedMs)}
        </time>
      </span>
      {language !== null && (
        <span className={styles.stat}>
          <span className="visually-hidden">{t('detectedLanguage')}: </span>
          <LanguageTag code={language} name={tc(`language.${language}`)} />
        </span>
      )}
      <StatusBadge
        kind={live ? 'connected' : connection.status === 'closed' ? 'idle' : 'disconnected'}
        icon={live ? Radio : WifiOff}
        label={label}
      />
      <span className={styles.stat} title={t('latencyHint')}>
        <Activity aria-hidden="true" />
        {latencyMs === null ? t('latencyUnknown') : t('latency', { ms: latencyMs })}
      </span>
      <Button
        variant={announce ? 'primary' : 'ghost'}
        icon={Megaphone}
        aria-pressed={announce}
        onClick={onToggleAnnounce}
        className={styles.announce}
      >
        {t('announce.toggle')}
      </Button>
    </div>
  );
}
