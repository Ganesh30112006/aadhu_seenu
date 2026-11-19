import { Mic, Pause, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import type { ControlAction, LectureStatus } from '@/api/types';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { toast } from '@/components/Toast';
import { useRecordingControl } from '@/features/lectures/api';
import styles from './Live.module.css';

interface LiveControlsProps {
  lectureId: string;
  status: LectureStatus;
  paused: boolean;
  /** null while the device's state is unknown (no device.status yet). */
  deviceOnline: boolean | null;
}

type ErrorKey =
  | 'controls.errors.deviceOffline'
  | 'controls.errors.deviceBusy'
  | 'controls.errors.invalidState'
  | 'controls.errors.generic';

function errorKey(error: unknown): ErrorKey {
  if (!isApiError(error)) return 'controls.errors.generic';
  if (error.code === 'device_offline' || error.code === 'no_device')
    return 'controls.errors.deviceOffline';
  if (error.code === 'device_busy') return 'controls.errors.deviceBusy';
  if (error.code === 'invalid_state') return 'controls.errors.invalidState';
  return 'controls.errors.generic';
}

/**
 * Start / Pause / Resume / Stop for the lecturer. The command goes to the microphone, which acts
 * as if its own button was pressed; the new state arrives on the live socket, so the buttons wait
 * for it instead of guessing.
 */
export function LiveControls({ lectureId, status, paused, deviceOnline }: LiveControlsProps) {
  const { t } = useTranslation('live');
  const control = useRecordingControl(lectureId);
  const [confirmStop, setConfirmStop] = useState(false);
  // The state at the moment a command was accepted: we wait until the device reports a change.
  const [sent, setSent] = useState<{ status: LectureStatus; paused: boolean } | null>(null);
  const waiting = sent !== null && sent.status === status && sent.paused === paused;
  const active = status === 'recording';
  if (status !== 'scheduled' && !active) return null;

  const send = (action: ControlAction): void => {
    control.mutate(action, {
      onSuccess: () => {
        setSent({ status, paused });
      },
      onError: (error) => {
        toast.error(t(errorKey(error)));
      },
    });
  };
  const busy = control.isPending || waiting;
  const offline = deviceOnline === false;

  return (
    <div className={styles.controls} role="group" aria-label={t('controls.label')}>
      {status === 'scheduled' && (
        <Button
          variant="primary"
          icon={Mic}
          loading={busy}
          disabled={offline}
          onClick={() => {
            send('start');
          }}
        >
          {t('controls.start')}
        </Button>
      )}
      {active && (
        <>
          <Button
            icon={paused ? Play : Pause}
            loading={busy}
            disabled={offline}
            onClick={() => {
              send(paused ? 'resume' : 'pause');
            }}
          >
            {paused ? t('controls.resume') : t('controls.pause')}
          </Button>
          <Button
            variant="danger"
            icon={Square}
            disabled={offline || busy}
            onClick={() => {
              setConfirmStop(true);
            }}
          >
            {t('controls.stop')}
          </Button>
        </>
      )}
      <span className={styles.controlsHint} role="status">
        {offline ? t('controls.offlineHint') : waiting ? t('controls.waiting') : ''}
      </span>
      <Dialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title={t('controls.stopTitle')}
        description={t('controls.stopBody')}
      >
        <div className={styles.dialogActions}>
          <Button
            onClick={() => {
              setConfirmStop(false);
            }}
          >
            {t('controls.cancel')}
          </Button>
          <Button
            variant="danger"
            icon={Square}
            onClick={() => {
              setConfirmStop(false);
              send('stop');
            }}
          >
            {t('controls.stopConfirm')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
