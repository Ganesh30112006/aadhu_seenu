import { FileText, Radio } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Lecture } from '@/api/types';
import { paths } from '@/app/paths';
import { LanguageTag } from '@/components/Page';
import { LectureStatusBadge, StatusBadge } from '@/components/StatusBadge';
import { formatDate, toIsoDuration } from '@/lib/time';
import { useFormatDuration } from './useFormatDuration';
import styles from './LectureCard.module.css';

interface LectureCardProps {
  lecture: Lecture;
  /** Lecturers also see notes that are ready but still in draft. */
  showDrafts: boolean;
  headingLevel?: 2 | 3;
}

/** One lecture in a list. The whole card is clickable through the title link (stretched). */
export function LectureCard({ lecture, showDrafts, headingLevel = 2 }: LectureCardProps) {
  const { t } = useTranslation('lectures');
  const { t: tc } = useTranslation();
  const formatDuration = useFormatDuration();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const live = lecture.status === 'recording';
  const when = lecture.started_at ?? lecture.created_at;
  const target = live ? paths.live(lecture.id) : paths.lecture(lecture.id);

  return (
    <article className={styles.card}>
      <Heading className={styles.title}>
        <Link to={target} className={styles.link}>
          {lecture.title}
        </Link>
      </Heading>
      <p className={styles.meta}>
        <span className={styles.subject}>
          {lecture.subject === null
            ? t('row.noSubject')
            : `${lecture.subject.code} · ${lecture.subject.name}`}
        </span>
        <span aria-hidden="true">·</span>
        <time dateTime={when}>{formatDate(when)}</time>
        {lecture.duration_ms > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={toIsoDuration(lecture.duration_ms)}>
              {formatDuration(lecture.duration_ms)}
            </time>
          </>
        )}
      </p>
      {lecture.lecturer_name !== null && <p className={styles.lecturer}>{lecture.lecturer_name}</p>}
      <div className={styles.badges}>
        {lecture.status !== 'completed' && <LectureStatusBadge status={lecture.status} />}
        {live && (
          <span className={styles.liveHint}>
            <Radio aria-hidden="true" />
            {t('row.live')}
          </span>
        )}
        {lecture.notes_ready && lecture.notes_published && (
          <StatusBadge kind="connected" icon={FileText} label={t('row.notesReady')} />
        )}
        {showDrafts && lecture.notes_ready && !lecture.notes_published && (
          <StatusBadge kind="idle" icon={FileText} label={t('row.notesDraft')} />
        )}
        <span className={styles.languages}>
          <span className="visually-hidden">
            {t('row.languages', {
              list: lecture.languages_detected.map((code) => tc(`language.${code}`)).join(', '),
            })}
          </span>
          <span aria-hidden="true" className={styles.languages}>
            {lecture.languages_detected.map((code) => (
              <LanguageTag key={code} code={code} name={tc(`language.${code}`)} />
            ))}
          </span>
        </span>
      </div>
    </article>
  );
}
