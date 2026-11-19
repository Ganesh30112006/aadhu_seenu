import { Link, useParams } from 'react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { paths } from '@/app/paths';
import { Field, TextInput } from '@/components/Field';
import { formatOffset } from '@/lib/time';
import { useKeyTerms } from '../api';
import { AiNote, StudyError, StudySkeleton } from '../StudyCommon';
import styles from '../Study.module.css';

export function KeyTermsTab() {
  const { lectureId = '' } = useParams();
  const { t } = useTranslation('study');
  const terms = useKeyTerms(lectureId);
  const [filter, setFilter] = useState('');
  if (terms.isPending) return <StudySkeleton />;
  if (terms.isError) {
    return (
      <StudyError
        error={terms.error}
        notReady={{ title: t('keyTerms.notReadyTitle'), body: t('keyTerms.notReadyBody') }}
        notPublished={{ title: t('notes.notPublishedTitle'), body: t('notes.notPublishedBody') }}
        errorTitle={t('keyTerms.errorTitle')}
        onRetry={() => void terms.refetch()}
      />
    );
  }
  const needle = filter.trim().toLowerCase();
  const shown = terms.data.items.filter(
    (term) =>
      needle === '' ||
      term.term.toLowerCase().includes(needle) ||
      term.definition.toLowerCase().includes(needle),
  );
  return (
    <>
      <AiNote />
      <div className={styles.toolbar}>
        <Field label={t('keyTerms.filter')}>
          {(c) => (
            <TextInput
              {...c}
              type="search"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
              }}
            />
          )}
        </Field>
        <span className={styles.muted} role="status">
          {t('keyTerms.count', { count: shown.length })}
        </span>
      </div>
      {shown.length === 0 ? (
        <p>{t('keyTerms.noMatches', { query: filter })}</p>
      ) : (
        <dl className={styles.terms}>
          {shown.map((term) => (
            <div key={term.id}>
              <dt lang={term.language}>{term.term}</dt>
              <dd>
                {term.definition}
                {term.first_mentioned_ms !== null && (
                  <>
                    {' '}
                    <Link to={paths.transcriptAt(lectureId, term.first_mentioned_ms)}>
                      {t('keyTerms.firstMentioned', {
                        time: formatOffset(term.first_mentioned_ms),
                      })}
                    </Link>
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}
