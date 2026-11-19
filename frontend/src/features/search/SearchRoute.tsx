import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, SearchX } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { api, request } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { SearchHit } from '@/api/types';
import { paths } from '@/app/paths';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button } from '@/components/Button';
import { EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/Feedback';
import { Field, Select, TextInput } from '@/components/Field';
import { PageHeader } from '@/components/Page';
import { useSubjects } from '@/features/lectures/api';
import { codePointRangesToUtf16, splitByRanges } from '@/lib/highlight';
import { formatDate, formatOffset } from '@/lib/time';
import styles from './Search.module.css';

function Snippet({ hit }: { hit: SearchHit }) {
  // The API reports code-point offsets (Python); JavaScript strings index UTF-16 units.
  const parts = splitByRanges(hit.text, codePointRangesToUtf16(hit.text, hit.highlights));
  return (
    <span lang={hit.language}>
      {parts.map((part, i) =>
        part.highlighted ? (
          <mark key={i} className={styles.mark}>
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </span>
  );
}

export function SearchRoute() {
  const { t } = useTranslation('search');
  const { t: tc } = useTranslation();
  useDocumentTitle(t('title'));
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const subject = params.get('subject') ?? '';
  const subjects = useSubjects();
  const ready = Array.from(q).length >= 2; // code points, like the backend
  const results = useQuery({
    queryKey: queryKeys.search(q, subject || undefined),
    queryFn: ({ signal }) =>
      request(
        api.GET('/search', {
          signal,
          params: { query: { q, ...(subject !== '' && { subject_id: subject }) } },
        }),
      ),
    enabled: ready,
    placeholderData: keepPreviousData,
  });
  const lectures = results.data?.groups.length ?? 0;

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <form
        role="search"
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const next = new URLSearchParams();
          const query = data.get('q');
          const subj = data.get('subject');
          if (typeof query === 'string' && query.trim() !== '') next.set('q', query.trim());
          if (typeof subj === 'string' && subj !== '') next.set('subject', subj);
          setParams(next);
        }}
      >
        <Field label={t('label')} className={styles.grow}>
          {(c) => (
            <TextInput
              {...c}
              key={q}
              name="q"
              type="search"
              defaultValue={q}
              placeholder={t('placeholder')}
              enterKeyHint="search"
            />
          )}
        </Field>
        <Field label={t('subject')}>
          {(c) => (
            <Select {...c} key={subject} name="subject" defaultValue={subject}>
              <option value="">{t('allSubjects')}</option>
              {(subjects.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" variant="primary" icon={Search} className={styles.submit}>
          {t('submit')}
        </Button>
      </form>

      {!ready ? (
        q === '' ? (
          <EmptyState icon={Search} title={t('promptTitle')} body={t('promptBody')} />
        ) : (
          <p role="status">{t('tooShort')}</p>
        )
      ) : results.isPending ? (
        <LoadingRegion label={tc('loading')} className={styles.groups}>
          {[0, 1].map((i) => (
            <Skeleton key={i} className={styles.skeleton} />
          ))}
        </LoadingRegion>
      ) : results.isError ? (
        <ErrorState title={t('errorTitle')} onRetry={() => void results.refetch()} />
      ) : results.data.total_hits === 0 ? (
        <EmptyState
          icon={SearchX}
          title={t('noResultsTitle', { query: q })}
          body={t('noResultsBody')}
        />
      ) : (
        <>
          <p className={styles.count} role="status">
            {t('results', { count: results.data.total_hits, lectures })}
          </p>
          <div className={styles.groups}>
            {results.data.groups.map((group) => (
              <section
                key={group.lecture.id}
                className={styles.group}
                aria-labelledby={`g-${group.lecture.id}`}
              >
                <h2 id={`g-${group.lecture.id}`} className={styles.groupTitle}>
                  <Link to={paths.lecture(group.lecture.id)}>{group.lecture.title}</Link>
                </h2>
                <p className={styles.meta}>
                  {group.lecture.subject !== null &&
                    `${group.lecture.subject.code} · ${group.lecture.subject.name}`}
                  {group.lecture.started_at !== null &&
                    ` · ${formatDate(group.lecture.started_at)}`}
                </p>
                <ul className={styles.hits}>
                  {group.hits.map((hit) => (
                    <li key={hit.segment_id}>
                      <Link
                        className={styles.hit}
                        to={paths.transcriptAt(group.lecture.id, hit.start_ms, hit.segment_id)}
                      >
                        <span className={styles.time}>
                          <span className="visually-hidden">
                            {t('openAt', { time: formatOffset(hit.start_ms) })}:{' '}
                          </span>
                          <span aria-hidden="true">{formatOffset(hit.start_ms)}</span>
                        </span>
                        <Snippet hit={hit} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
