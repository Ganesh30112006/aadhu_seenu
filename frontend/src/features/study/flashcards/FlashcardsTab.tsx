import { ChevronLeft, ChevronRight, Shuffle } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Flashcard } from '@/api/types';
import { paths } from '@/app/paths';
import { Button } from '@/components/Button';
import { formatOffset } from '@/lib/time';
import { useFlashcards } from '../api';
import { AiNote, StudyError, StudySkeleton } from '../StudyCommon';
import styles from '../Study.module.css';

/** Fisher–Yates on a copy; `random` is injectable so the order is testable. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

function Deck({ lectureId, cards }: { lectureId: string; cards: readonly Flashcard[] }) {
  const { t } = useTranslation('study');
  const [order, setOrder] = useState<readonly Flashcard[]>(cards);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const card = order[index];
  if (card === undefined) return null;
  const go = (next: number): void => {
    setIndex(next);
    setRevealed(false);
  };
  return (
    <>
      <div className={styles.toolbar}>
        <span className={styles.muted} role="status">
          {t('flashcards.position', { n: index + 1, total: order.length })}
        </span>
        <span className={styles.toolbarSpacer} />
        <Button
          variant="ghost"
          icon={Shuffle}
          onClick={() => {
            setOrder(shuffled(cards));
            go(0);
          }}
        >
          {t('flashcards.shuffle')}
        </Button>
      </div>
      <section className={styles.flashcard} aria-label={t('flashcards.cardLabel')}>
        <p className={styles.flashcardFront}>{card.front}</p>
        {revealed ? (
          <div className={styles.flashcardBack}>
            <h3 className={styles.flashcardBackLabel}>{t('flashcards.answer')}</h3>
            <p>{card.back}</p>
            {card.source_ms !== null && (
              <Link to={paths.transcriptAt(lectureId, card.source_ms)}>
                {t('flashcards.source', { time: formatOffset(card.source_ms) })}
              </Link>
            )}
          </div>
        ) : (
          <Button
            variant="primary"
            onClick={() => {
              setRevealed(true);
            }}
          >
            {t('flashcards.reveal')}
          </Button>
        )}
      </section>
      <div className={styles.toolbar}>
        <Button
          icon={ChevronLeft}
          disabled={index === 0}
          onClick={() => {
            go(index - 1);
          }}
        >
          {t('flashcards.previous')}
        </Button>
        <Button
          icon={ChevronRight}
          disabled={index === order.length - 1}
          onClick={() => {
            go(index + 1);
          }}
        >
          {t('flashcards.next')}
        </Button>
      </div>
    </>
  );
}

export function FlashcardsTab() {
  const { lectureId = '' } = useParams();
  const { t } = useTranslation('study');
  const cards = useFlashcards(lectureId);
  if (cards.isPending) return <StudySkeleton />;
  if (cards.isError) {
    return (
      <StudyError
        error={cards.error}
        notReady={{ title: t('flashcards.notReadyTitle'), body: t('flashcards.notReadyBody') }}
        notPublished={{ title: t('notes.notPublishedTitle'), body: t('notes.notPublishedBody') }}
        errorTitle={t('flashcards.errorTitle')}
        onRetry={() => void cards.refetch()}
      />
    );
  }
  return (
    <>
      <AiNote />
      <p>{t('flashcards.intro')}</p>
      {cards.data.cards.length === 0 ? (
        <p>{t('flashcards.none')}</p>
      ) : (
        <Deck lectureId={lectureId} cards={cards.data.cards} />
      )}
    </>
  );
}
