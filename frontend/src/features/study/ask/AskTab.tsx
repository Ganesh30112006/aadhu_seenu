import { zodResolver } from '@hookform/resolvers/zod';
import { useMutationState } from '@tanstack/react-query';
import { MessageSquare, Send, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { isApiError } from '@/api/errors';
import { mutationKeys } from '@/api/queryKeys';
import type { AskResponse } from '@/api/types';
import { paths } from '@/app/paths';
import { Button } from '@/components/Button';
import { Banner, EmptyState } from '@/components/Feedback';
import { Field, TextArea } from '@/components/Field';
import { useFullTranscript } from '@/features/lectures/api';
import { cx } from '@/lib/cx';
import { formatOffset } from '@/lib/time';
import { useAsk } from '../api';
import { AiNote } from '../StudyCommon';
import styles from '../Study.module.css';

/** Mutation-cache data is untyped: validate instead of casting. */
const AskResponseSchema = z.object({ answer: z.string(), cited_segment_ids: z.array(z.string()) });

function Citations({ lectureId, ids }: { lectureId: string; ids: readonly string[] }) {
  const { t } = useTranslation('study');
  const { transcript } = useFullTranscript(lectureId);
  if (ids.length === 0) {
    return (
      <Banner tone="warning" icon={TriangleAlert} role="none">
        {t('ask.noCitations')}
      </Banner>
    );
  }
  return (
    <>
      <p className={styles.bubbleLabel}>{t('ask.sources')}</p>
      <ul className={styles.citations}>
        {ids.map((id) => {
          const segment = transcript?.timeline.segments.get(id);
          if (segment === undefined) return null;
          return (
            <li key={id}>
              <Link
                className={styles.citation}
                to={paths.transcriptAt(lectureId, segment.start_ms, id)}
              >
                <strong>{t('ask.citation', { time: formatOffset(segment.start_ms) })}</strong>{' '}
                <span lang={segment.language}>“{segment.text}”</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function AskTab() {
  const { lectureId = '' } = useParams();
  const { t } = useTranslation('study');
  const ask = useAsk(lectureId);
  // The conversation lives in the mutation cache: it survives switching tabs, no extra store.
  const thread = useMutationState({
    filters: { mutationKey: mutationKeys.ask(lectureId) },
    select: (m) => ({
      question: m.state.variables,
      status: m.state.status,
      data: AskResponseSchema.safeParse(m.state.data).data,
      error: m.state.error,
      at: m.state.submittedAt,
    }),
  });
  const schema = useMemo(
    () =>
      z.object({
        question: z
          .string()
          .trim()
          .min(3, t('ask.validation.short'))
          .max(500, t('ask.validation.long')),
      }),
    [t],
  );
  const form = useForm<{ question: string }>({
    resolver: zodResolver(schema),
    defaultValues: { question: '' },
  });

  return (
    <>
      <AiNote />
      <p className={styles.muted}>{t('ask.intro')}</p>
      {thread.length === 0 ? (
        <EmptyState compact headingLevel={3} icon={MessageSquare} title={t('ask.empty')} />
      ) : (
        <ol className={styles.thread} aria-live="polite">
          {thread.map((entry) => (
            <li key={entry.at}>
              <div className={cx(styles.bubble, styles.bubbleQuestion)}>
                <p className={styles.bubbleLabel}>{t('ask.you')}</p>
                <p>{typeof entry.question === 'string' ? entry.question : ''}</p>
              </div>
              <div className={styles.bubble}>
                <p className={styles.bubbleLabel}>{t('ask.answer')}</p>
                {entry.status === 'pending' && <p role="status">{t('ask.thinking')}</p>}
                {entry.status === 'error' && (
                  <p role="alert">
                    {isApiError(entry.error) && entry.error.isRateLimited
                      ? t('ask.errors.rateLimited')
                      : t('ask.errors.generic')}
                  </p>
                )}
                {entry.status === 'success' && entry.data !== undefined && (
                  <Answer lectureId={lectureId} response={entry.data} />
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <form
        className={styles.askForm}
        noValidate
        onSubmit={(e) =>
          void form.handleSubmit(({ question }) => {
            ask.mutate(question.trim());
            form.reset();
          })(e)
        }
      >
        <Field label={t('ask.label')} error={form.formState.errors.question?.message}>
          {(c) => (
            <TextArea
              {...c}
              rows={3}
              placeholder={t('ask.placeholder')}
              {...form.register('question')}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" icon={Send} loading={ask.isPending}>
          {t('ask.submit')}
        </Button>
      </form>
    </>
  );
}

function Answer({ lectureId, response }: { lectureId: string; response: AskResponse }) {
  return (
    <>
      {/* Plain text only: model output is never rendered as HTML. */}
      <p>{response.answer}</p>
      <Citations lectureId={lectureId} ids={response.cited_segment_ids} />
    </>
  );
}
