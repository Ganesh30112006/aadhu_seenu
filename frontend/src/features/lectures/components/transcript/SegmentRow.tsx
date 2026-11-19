import { CloudUpload, Copy, Link2, Pencil } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, MenuItem } from '@/components/Menu';
import { LanguageTag } from '@/components/Page';
import { cx } from '@/lib/cx';
import { splitByRanges, type TextRange } from '@/lib/highlight';
import type { DisplaySegment } from '@/lib/transcript/timeline';
import { formatOffset, toIsoDuration } from '@/lib/time';
import styles from './Transcript.module.css';

export interface SegmentRowProps {
  segment: DisplaySegment;
  highlights?: readonly TextRange[] | undefined;
  /** The search match currently selected with next/previous. */
  activeRange?: TextRange | undefined;
  /** Deep-linked (?seg=) or cited segment. */
  linked?: boolean;
  showLanguage: boolean;
  showTransliteration: boolean;
  wallClock?: string | null;
  onCopyText: (segment: DisplaySegment) => void;
  /** Present on the recorded transcript: copies a deep link and moves the URL to this moment. */
  onCopyLink?: ((segment: DisplaySegment) => void) | undefined;
  /** Present for the lecture's lecturer/admin: opens the correction dialog (finals only). */
  onEdit?: ((segment: DisplaySegment) => void) | undefined;
}

function SegmentRowView({
  segment,
  highlights,
  activeRange,
  linked = false,
  showLanguage,
  showTransliteration,
  wallClock = null,
  onCopyText,
  onCopyLink,
  onEdit,
}: SegmentRowProps) {
  const { t } = useTranslation('lectures');
  const { t: tl } = useTranslation('live');
  const { t: tc } = useTranslation();
  const time = formatOffset(segment.start_ms);
  const partial = segment.state === 'partial';
  const parts =
    highlights === undefined || highlights.length === 0
      ? null
      : splitByRanges(segment.text, highlights);
  let cursor = 0;

  return (
    <div
      className={cx(styles.segment, partial && styles.partial, linked && styles.linked)}
      data-segment-id={segment.segment_id}
    >
      <Menu
        label={t('transcript.copyLink')}
        trigger={
          <button
            type="button"
            className={styles.time}
            aria-label={`${time}${wallClock === null ? '' : `, ${tc('time.wallClock', { time: wallClock })}`}`}
          >
            <time dateTime={toIsoDuration(segment.start_ms)}>{time}</time>
          </button>
        }
      >
        <MenuItem
          icon={Copy}
          onSelect={() => {
            onCopyText(segment);
          }}
        >
          {t('transcript.copySegment')}
        </MenuItem>
        {onCopyLink !== undefined && (
          <MenuItem
            icon={Link2}
            onSelect={() => {
              onCopyLink(segment);
            }}
          >
            {t('transcript.copyLink')}
          </MenuItem>
        )}
        {onEdit !== undefined && !partial && (
          <MenuItem
            icon={Pencil}
            onSelect={() => {
              onEdit(segment);
            }}
          >
            {t('transcript.editLine')}
          </MenuItem>
        )}
      </Menu>
      <div className={styles.body}>
        <p lang={segment.language} className={styles.text}>
          {parts === null
            ? segment.text
            : parts.map((part, index) => {
                const start = cursor;
                cursor += part.text.length;
                if (!part.highlighted) return part.text;
                const active =
                  activeRange !== undefined &&
                  activeRange.start < cursor &&
                  activeRange.end > start;
                return (
                  <mark
                    key={index}
                    className={cx(styles.mark, active && styles.markActive)}
                    data-active={active || undefined}
                  >
                    {part.text}
                  </mark>
                );
              })}
          {partial && <span className="visually-hidden"> ({tl('transcript.partial')})</span>}
        </p>
        {showTransliteration && segment.transliteration !== null && (
          <p lang={`${segment.language}-Latn`} className={styles.transliteration}>
            {segment.transliteration}
          </p>
        )}
        {(showLanguage || segment.source === 'backfill' || linked || segment.edited) && (
          <p className={styles.tags}>
            {showLanguage && (
              <LanguageTag code={segment.language} name={tc(`language.${segment.language}`)} />
            )}
            {segment.source === 'backfill' && (
              <span className={styles.late}>
                <CloudUpload aria-hidden="true" />
                <span className="visually-hidden">{tl('transcript.syncedLate')}</span>
              </span>
            )}
            {segment.edited && <span className={styles.edited}>{t('transcript.edited')}</span>}
            {linked && <span className={styles.linkedLabel}>{t('transcript.highlighted')}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

/** Memoised: on the live screen only new or changed rows re-render. */
export const SegmentRow = memo(SegmentRowView);
