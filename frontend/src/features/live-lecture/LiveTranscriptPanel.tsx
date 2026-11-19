import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { TextInput } from '@/components/Field';
import { toast } from '@/components/Toast';
import type { VirtualListHandle } from '@/components/VirtualList';
import { EditSegmentDialog } from '@/features/lectures/components/transcript/EditSegmentDialog';
import { TranscriptList } from '@/features/lectures/components/transcript/TranscriptList';
import { usePrefs } from '@/features/settings/prefsStore';
import { findMatches, type TextRange } from '@/lib/highlight';
import type { DisplaySegment } from '@/lib/transcript/timeline';
import { useLive } from './live';
import styles from './Live.module.css';

const BOTTOM_TOLERANCE_PX = 96;

function atBottom(): boolean {
  return (
    window.innerHeight + window.scrollY >=
    document.documentElement.scrollHeight - BOTTOM_TOLERANCE_PX
  );
}

/**
 * Live transcript: follows new lines only while the reader is at the bottom; otherwise shows
 * "Jump to live" with a count. Late (backfilled) lines are inserted in place by start time.
 */
export function LiveTranscriptPanel({
  lectureId,
  canEdit,
}: {
  lectureId: string;
  /** The lecture's lecturer/admin may correct lines while the lecture runs. */
  canEdit: boolean;
}) {
  const { t } = useTranslation('live');
  const { t: tl } = useTranslation('lectures');
  const items = useLive((s) => s.session.timeline.items);
  const latestFinal = useLive((s) => s.session.latestFinal);
  const { autoScroll, announce, showLanguageLabels, showTransliteration, visibleLanguages } =
    usePrefs();
  const listRef = useRef<VirtualListHandle>(null);
  const [following, setFollowing] = useState(true);
  const [seenCount, setSeenCount] = useState(0);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<DisplaySegment | null>(null);

  const visible = useMemo(
    () =>
      items.filter(
        (item) => item.kind === 'gap' || visibleLanguages.includes(item.segment.language),
      ),
    [items, visibleLanguages],
  );

  useEffect(() => {
    const onScroll = (): void => {
      setFollowing(atBottom());
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Keep the newest line in view while following (DOM sync, not derived state).
  useLayoutEffect(() => {
    if (autoScroll && following && visible.length > 0)
      listRef.current?.scrollToIndex(visible.length - 1, 'end');
  }, [visible.length, following, autoScroll]);

  const jumpToLive = useCallback(() => {
    listRef.current?.scrollToIndex(visible.length - 1, 'end');
    setFollowing(true);
    setSeenCount(visible.length);
  }, [visible.length]);

  const copyText = useCallback(
    (segment: DisplaySegment) => {
      void navigator.clipboard.writeText(segment.text).then(() => {
        toast.success(tl('transcript.copiedSegment'));
      });
    },
    [tl],
  );

  // Find-in-transcript: highlights only (the reader keeps control of scrolling while live).
  const highlights = useMemo(() => {
    const map = new Map<string, TextRange[]>();
    if (query.trim() === '') return map;
    for (const item of visible) {
      if (item.kind !== 'segment') continue;
      const ranges = findMatches(item.segment.text, query);
      if (ranges.length > 0) map.set(item.segment.segment_id, ranges);
    }
    return map;
  }, [visible, query]);
  const matchCount = useMemo(
    () => [...highlights.values()].reduce((n, ranges) => n + ranges.length, 0),
    [highlights],
  );

  const unseen = following ? 0 : Math.max(0, visible.length - Math.max(seenCount, 0));

  return (
    <section aria-labelledby="live-transcript-heading" className={styles.transcript}>
      <h2 id="live-transcript-heading" className="visually-hidden">
        {t('transcript.label')}
      </h2>
      <div className={styles.search} role="search">
        <label htmlFor="live-search" className="visually-hidden">
          {t('search.label')}
        </label>
        <TextInput
          id="live-search"
          type="search"
          value={query}
          placeholder={t('search.placeholder')}
          aria-describedby="live-search-count"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <span id="live-search-count" className={styles.searchCount} role="status">
          {query.trim() === ''
            ? ''
            : matchCount === 0
              ? t('search.none')
              : t('search.matches', { count: matchCount })}
        </span>
      </div>
      {visible.length === 0 ? (
        <p className={styles.listening}>{t('transcript.empty')}</p>
      ) : (
        <TranscriptList
          handleRef={listRef}
          items={visible}
          label={t('transcript.label')}
          showLanguage={showLanguageLabels}
          showTransliteration={showTransliteration}
          onCopyText={copyText}
          highlightsFor={(id) => highlights.get(id)}
          onEdit={canEdit ? setEditing : undefined}
          onRangeChange={(last) => {
            if (following) setSeenCount(Math.max(last + 1, visible.length));
          }}
        />
      )}
      {!following && visible.length > 0 && (
        <Button variant="primary" icon={ArrowDown} className={styles.jump} onClick={jumpToLive}>
          {t('transcript.jumpToLive')}
          {unseen > 0 && (
            <span className={styles.jumpCount}>
              {' '}
              · {t('transcript.newLines', { count: unseen })}
            </span>
          )}
        </Button>
      )}
      {canEdit && (
        <EditSegmentDialog
          lectureId={lectureId}
          segment={editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {/* Opt-in: only finished lines are announced, never the whole transcript (no flooding). */}
      <div aria-live="polite" aria-atomic="true" className="visually-hidden">
        {announce && latestFinal !== null ? (
          <span lang={latestFinal.language}>{latestFinal.text}</span>
        ) : null}
      </div>
    </section>
  );
}
