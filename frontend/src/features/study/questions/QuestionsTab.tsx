import { CircleCheck, CircleX, ListChecks, RotateCcw } from 'lucide-react';
import { useReducer, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { McqQuestion, ShortAnswerQuestion } from '@/api/types';
import { paths } from '@/app/paths';
import { Button } from '@/components/Button';
import { Banner, EmptyState } from '@/components/Feedback';
import { cx } from '@/lib/cx';
import { useQuestions } from '../api';
import { AiNote, StudyError, StudySkeleton } from '../StudyCommon';
import styles from '../Study.module.css';
import { INITIAL_QUIZ, quizReducer, quizScore, unanswered } from './quiz';

function McqQuiz({
  lectureId,
  questions,
}: {
  lectureId: string;
  questions: readonly McqQuestion[];
}) {
  const { t } = useTranslation('study');
  const [state, dispatch] = useReducer(quizReducer, INITIAL_QUIZ);
  const missing = unanswered(state, questions);
  return (
    <section aria-labelledby="mcq-heading">
      <h2 id="mcq-heading">{t('questions.mcqHeading')}</h2>
      {state.submitted && (
        <p className={styles.score} role="status">
          {t('questions.score', { score: quizScore(state, questions), total: questions.length })}
        </p>
      )}
      {questions.map((q, index) => {
        const chosen = state.answers[q.id];
        const right = chosen === q.correct_index;
        return (
          <fieldset key={q.id} className={styles.question}>
            <legend>
              <span className="visually-hidden">
                {t('questions.questionN', { n: index + 1, total: questions.length })}:{' '}
              </span>
              {q.prompt}
            </legend>
            {q.options.map((option, i) => (
              <label
                key={option}
                className={cx(
                  styles.option,
                  state.submitted && i === q.correct_index && styles.optionCorrect,
                  state.submitted && chosen === i && !right && styles.optionWrong,
                )}
              >
                <input
                  type="radio"
                  name={q.id}
                  checked={chosen === i}
                  disabled={state.submitted}
                  onChange={() => {
                    dispatch({ type: 'answer', questionId: q.id, option: i });
                  }}
                />
                {option}
              </label>
            ))}
            {state.submitted && (
              <div className={cx(styles.feedback, right ? styles.correct : styles.incorrect)}>
                {right ? <CircleCheck aria-hidden="true" /> : <CircleX aria-hidden="true" />}
                <div>
                  <strong>{right ? t('questions.correct') : t('questions.incorrect')}</strong>
                  {!right && (
                    <p>
                      {t('questions.correctAnswer', { answer: q.options[q.correct_index] ?? '' })}
                    </p>
                  )}
                  <p>{q.explanation}</p>
                  {q.source_ms !== null && (
                    <Link to={paths.transcriptAt(lectureId, q.source_ms)}>
                      {t('questions.reviewInTranscript')}
                    </Link>
                  )}
                </div>
              </div>
            )}
          </fieldset>
        );
      })}
      <div className={styles.toolbar}>
        {state.submitted ? (
          <Button
            icon={RotateCcw}
            onClick={() => {
              dispatch({ type: 'reset' });
            }}
          >
            {t('questions.retry')}
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              icon={ListChecks}
              onClick={() => {
                dispatch({ type: 'submit' });
              }}
            >
              {t('questions.submit')}
            </Button>
            {missing > 0 && (
              <span className={styles.muted}>{t('questions.unanswered', { count: missing })}</span>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function ShortAnswers({
  lectureId,
  questions,
}: {
  lectureId: string;
  questions: readonly ShortAnswerQuestion[];
}) {
  const { t } = useTranslation('study');
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  return (
    <section aria-labelledby="short-heading">
      <h2 id="short-heading">{t('questions.shortHeading')}</h2>
      {questions.map((q) => {
        const open = revealed.has(q.id);
        return (
          <div key={q.id} className={styles.question}>
            <p>{q.prompt}</p>
            <Button
              aria-expanded={open}
              aria-controls={`answer-${q.id}`}
              onClick={() => {
                setRevealed((prev) => {
                  const next = new Set(prev);
                  if (open) next.delete(q.id);
                  else next.add(q.id);
                  return next;
                });
              }}
            >
              {open ? t('questions.hideAnswer') : t('questions.showAnswer')}
            </Button>
            {open && (
              <div id={`answer-${q.id}`} className={styles.preview}>
                <strong>{t('questions.modelAnswer')}</strong>
                <p>{q.model_answer}</p>
                {q.source_ms !== null && (
                  <Link to={paths.transcriptAt(lectureId, q.source_ms)}>
                    {t('questions.reviewInTranscript')}
                  </Link>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

export function QuestionsTab() {
  const { lectureId = '' } = useParams();
  const { t } = useTranslation('study');
  const questions = useQuestions(lectureId);
  if (questions.isPending) return <StudySkeleton />;
  if (questions.isError) {
    return (
      <StudyError
        error={questions.error}
        notReady={{ title: t('questions.notReadyTitle'), body: t('questions.notReadyBody') }}
        notPublished={{ title: t('notes.notPublishedTitle'), body: t('notes.notPublishedBody') }}
        errorTitle={t('questions.errorTitle')}
        onRetry={() => void questions.refetch()}
      />
    );
  }
  const { mcq, short_answer: shortAnswer } = questions.data;
  if (mcq.length === 0 && shortAnswer.length === 0)
    return <EmptyState icon={ListChecks} title={t('questions.noneTitle')} />;
  return (
    <>
      <AiNote />
      <Banner tone="info" role="none">
        {t('questions.intro')}
      </Banner>
      {mcq.length > 0 && <McqQuiz lectureId={lectureId} questions={mcq} />}
      {shortAnswer.length > 0 && <ShortAnswers lectureId={lectureId} questions={shortAnswer} />}
    </>
  );
}
