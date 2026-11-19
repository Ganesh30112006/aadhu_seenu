import type { Ref } from 'react';
import { VirtualList, type VirtualListHandle } from '@/components/VirtualList';
import type { TextRange } from '@/lib/highlight';
import type { DisplaySegment, TimelineItem } from '@/lib/transcript/timeline';
import { GapRow } from './GapRow';
import { SegmentRow } from './SegmentRow';
import styles from './Transcript.module.css';

export interface TranscriptListProps {
  items: readonly TimelineItem[];
  label: string;
  showLanguage: boolean;
  showTransliteration: boolean;
  onCopyText: (segment: DisplaySegment) => void;
  onCopyLink?: (segment: DisplaySegment) => void;
  onEdit?: ((segment: DisplaySegment) => void) | undefined;
  highlightsFor?: (segmentId: string) => readonly TextRange[] | undefined;
  activeMatch?: { segmentId: string; range: TextRange } | null;
  linkedSegmentId?: string | null;
  wallClockFor?: (offsetMs: number) => string | null;
  onRangeChange?: (lastIndex: number) => void;
  handleRef?: Ref<VirtualListHandle>;
}

const ESTIMATE = { segment: 76, gap: 64 } as const;

/** Virtualised transcript shared by the Live Lecture and Lecture Detail screens. */
export function TranscriptList({
  items,
  label,
  showLanguage,
  showTransliteration,
  onCopyText,
  onCopyLink,
  onEdit,
  highlightsFor,
  activeMatch = null,
  linkedSegmentId = null,
  wallClockFor,
  onRangeChange,
  handleRef,
}: TranscriptListProps) {
  return (
    <VirtualList
      label={label}
      className={styles.list}
      items={items}
      getKey={(item) => item.key}
      estimateSize={(index) => (items[index]?.kind === 'gap' ? ESTIMATE.gap : ESTIMATE.segment)}
      {...(onRangeChange !== undefined && { onRangeChange })}
      {...(handleRef !== undefined && { handleRef })}
      renderItem={(item) =>
        item.kind === 'gap' ? (
          <GapRow gap={item.gap} />
        ) : (
          <SegmentRow
            segment={item.segment}
            highlights={highlightsFor?.(item.segment.segment_id)}
            activeRange={
              activeMatch?.segmentId === item.segment.segment_id ? activeMatch.range : undefined
            }
            linked={linkedSegmentId === item.segment.segment_id}
            showLanguage={showLanguage}
            showTransliteration={showTransliteration}
            wallClock={wallClockFor?.(item.segment.start_ms) ?? null}
            onCopyText={onCopyText}
            onCopyLink={onCopyLink}
            onEdit={onEdit}
          />
        )
      }
    />
  );
}
