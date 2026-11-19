import { FileText } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { paths } from '@/app/paths';
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/Feedback';
import { toast } from '@/components/Toast';
import type { VirtualListHandle } from '@/components/VirtualList';
import { useCurrentUser } from '@/features/auth/api';
import { usePrefs } from '@/features/settings/prefsStore';
import { findMatches, type TextRange } from '@/lib/highlight';
import { lastIndexAtOrBefore } from '@/lib/sortedInsert';
import { formatOffset, wallClockAt } from '@/lib/time';
import type { DisplaySegment } from '@/lib/transcript/timeline';
import { useFullTranscript, useLecture } from '../api';
import { EditSegmentDialog } from '../components/transcript/EditSegmentDialog';
import { TranscriptList } from '../components/transcript/TranscriptList';
import { canEditLecture } from '../permissions';
import styles from '../detail/Detail.module.css';
import { TranscriptSearchBar } from './TranscriptSearchBar';
import { useFocusLinkedRow } from './useFocusLinkedRow';

interface Match {
  segmentId: string;
  range: TextRange;
  itemIndex: number;
}

export function TranscriptTab() {
  const { lectureId = '' } = useParams();
  const { t } = useTranslation('lectures');
  const [params, setParams] = useSearchParams();
  const lecture = useLecture(lectureId);
  const { transcript, isPending, isError, refetch } = useFullTranscript(lectureId);
  const { showLanguageLabels, showTransliteration, visibleLanguages } = usePrefs();
  const listRef = useRef<VirtualListHandle>(null);
  // The query lives in state and is mirrored to ?q=. Driving the input from the URL directly
  // drops keystrokes (router updates are async) and breaks IME composition for Hindi/Telugu.
  // Only this search bar writes ?q=, so the URL is read once, on mount.
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const t0 = Number(params.get('t'));
  const linkedParam = params.get('seg');
  const [active, setActive] = useState({ query, index: 0 });
  const activeIndex = active.query === query ? active.index : 0;

  const items = useMemo(
    () =>
      (transcript?.timeline.items ?? []).filter(
        (i) => i.kind === 'gap' || visibleLanguages.includes(i.segment.language),
      ),
    [transcript, visibleLanguages],
  );
  const hidden = (transcript?.timeline.items.length ?? 0) - items.length;

  const matches = useMemo((): Match[] => {
    if (query.trim() === '') return [];
    return items.flatMap((item, itemIndex) =>
      item.kind === 'segment'
        ? findMatches(item.segment.text, query).map((range) => ({
            segmentId: item.segment.segment_id,
            range,
            itemIndex,
          }))
        : [],
    );
  }, [items, query]);
  const highlights = useMemo(() => {
    const map = new Map<string, TextRange[]>();
    for (const m of matches) map.set(m.segmentId, [...(map.get(m.segmentId) ?? []), m.range]);
    return map;
  }, [matches]);
  const current = matches[activeIndex] ?? null;

  // Deep link (?t=ms): the row containing that moment, highlighted.
  const linkedIndex = useMemo(() => {
    if (!Number.isFinite(t0) || params.get('t') === null || items.length === 0) return -1;
    return Math.max(
      0,
      lastIndexAtOrBefore(items, t0, (i) => i.start_ms),
    );
  }, [items, t0, params]);
  const linkedItem = items[linkedIndex];
  const linkedSegmentId =
    linkedParam ?? (linkedItem?.kind === 'segment' ? linkedItem.segment.segment_id : null);

  useEffect(() => {
    if (linkedIndex >= 0) listRef.current?.scrollToIndex(linkedIndex, 'center');
  }, [linkedIndex]);
  useFocusLinkedRow(transcript !== undefined && !transcript.loadingMore, linkedSegmentId);
  useEffect(() => {
    if (current !== null) listRef.current?.scrollToIndex(current.itemIndex, 'center');
  }, [current]);

  const step = (delta: number): void => {
    if (matches.length > 0)
      setActive({ query, index: (activeIndex + delta + matches.length) % matches.length });
  };
  const copyText = useCallback(
    (segment: DisplaySegment) => {
      void navigator.clipboard.writeText(segment.text).then(() => {
        toast.success(t('transcript.copiedSegment'));
      });
    },
    [t],
  );
  const copyLink = useCallback(
    (segment: DisplaySegment) => {
      const url = new URL(
        paths.transcriptAt(lectureId, segment.start_ms, segment.segment_id),
        window.location.origin,
      ).toString();
      setParams({ t: String(segment.start_ms), seg: segment.segment_id }, { replace: true });
      void navigator.clipboard.writeText(url).then(() => {
        toast.success(t('transcript.linkCopied', { time: formatOffset(segment.start_ms) }));
      });
    },
    [lectureId, setParams, t],
  );
  const user = useCurrentUser();
  const canEdit = canEditLecture(user, lecture.data);
  const [editing, setEditing] = useState<DisplaySegment | null>(null);
  const startedAt = lecture.data?.started_at ?? null;
  const wallClockFor = useCallback((ms: number) => wallClockAt(startedAt, ms), [startedAt]);

  if (isPending) {
    return (
      <LoadingRegion label={t('transcript.loadingPages', { loaded: 0 })} className={styles.lines}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className={styles.line} />
        ))}
      </LoadingRegion>
    );
  }
  if (isError)
    return <ErrorState title={t('transcript.errorTitle')} onRetry={() => void refetch()} />;
  if (items.length === 0 && hidden === 0) {
    return (
      <EmptyState
        icon={FileText}
        title={
          lecture.data?.status === 'scheduled'
            ? t('transcript.emptyScheduled')
            : t('transcript.empty')
        }
      />
    );
  }

  return (
    <>
      <TranscriptSearchBar
        query={query}
        onQueryChange={(q) => {
          setQuery(q);
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              if (q === '') next.delete('q');
              else next.set('q', q);
              return next;
            },
            { replace: true },
          );
        }}
        current={current === null ? -1 : activeIndex}
        total={matches.length}
        onNext={() => {
          step(1);
        }}
        onPrevious={() => {
          step(-1);
        }}
      />
      {transcript?.loadingMore === true && (
        <p className={styles.note} role="status">
          {t('transcript.loadingPages', { loaded: transcript.segments.length })}
        </p>
      )}
      {hidden > 0 && (
        <p className={styles.note}>{t('transcript.hiddenLanguage', { count: hidden })}</p>
      )}
      <TranscriptList
        handleRef={listRef}
        items={items}
        label={t('transcript.label')}
        showLanguage={showLanguageLabels}
        showTransliteration={showTransliteration}
        onCopyText={copyText}
        onCopyLink={copyLink}
        highlightsFor={(id) => highlights.get(id)}
        activeMatch={
          current === null ? null : { segmentId: current.segmentId, range: current.range }
        }
        linkedSegmentId={linkedSegmentId}
        wallClockFor={wallClockFor}
        onEdit={canEdit ? setEditing : undefined}
      />
      <EditSegmentDialog
        lectureId={lectureId}
        segment={editing}
        onClose={() => {
          setEditing(null);
        }}
      />
    </>
  );
}
