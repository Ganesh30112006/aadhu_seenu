import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Banner } from '@/components/Feedback';
import { Field, TextArea } from '@/components/Field';
import { toast } from '@/components/Toast';
import { useEditSegment } from '@/features/lectures/api';
import type { DisplaySegment } from '@/lib/transcript/timeline';
import { formatOffset } from '@/lib/time';

const MAX_LENGTH = 2000;

interface EditSegmentDialogProps {
  lectureId: string;
  /** The line being corrected; null closes the dialog. */
  segment: DisplaySegment | null;
  onClose: () => void;
}

/** Lecturer correction of one transcript line (fixes recognition mistakes, keeps the timing). */
export function EditSegmentDialog({ lectureId, segment, onClose }: EditSegmentDialogProps) {
  const { t } = useTranslation('lectures');
  const save = useEditSegment(lectureId);
  const [draft, setDraft] = useState({ id: '', text: '' });
  // Start from the line's current text each time a different line is opened.
  const text =
    segment !== null && draft.id === segment.segment_id ? draft.text : (segment?.text ?? '');
  const trimmed = text.trim();
  const close = (): void => {
    save.reset();
    onClose();
  };

  return (
    <Dialog
      open={segment !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={t('transcript.editTitle')}
      description={
        segment === null
          ? ''
          : t('transcript.editDescription', { time: formatOffset(segment.start_ms) })
      }
    >
      {segment !== null && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed === '' || trimmed === segment.text) return;
            save.mutate(
              { segmentId: segment.segment_id, text: trimmed },
              {
                onSuccess: () => {
                  toast.success(t('transcript.editSaved'));
                  close();
                },
              },
            );
          }}
        >
          {save.isError && (
            <Banner tone="danger" role="alert">
              {t('transcript.editFailed')}
            </Banner>
          )}
          <Field
            label={t('transcript.editLabel')}
            error={trimmed === '' ? t('transcript.editEmpty') : undefined}
          >
            {(control) => (
              <TextArea
                {...control}
                lang={segment.language}
                rows={4}
                maxLength={MAX_LENGTH}
                value={text}
                onChange={(event) => {
                  setDraft({ id: segment.segment_id, text: event.target.value });
                }}
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={save.isPending}
            disabled={trimmed === '' || trimmed === segment.text}
          >
            {t('transcript.editSave')}
          </Button>
        </form>
      )}
    </Dialog>
  );
}
