import { BookOpen } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { formatOffset } from '@/lib/time';
import type { LiveKeyTerm } from '@/api/ws/messages';
import { useLive } from './live';
import styles from './Live.module.css';

export function KeyTermList({ terms }: { terms: readonly LiveKeyTerm[] }) {
  const { t } = useTranslation('live');
  if (terms.length === 0) return <p className={styles.muted}>{t('keyTerms.empty')}</p>;
  return (
    <dl className={styles.terms}>
      {terms.map((term) => (
        <div key={term.id} className={styles.term}>
          <dt lang={term.language}>{term.term}</dt>
          <dd>
            {term.definition}
            {term.first_mentioned_ms !== null && (
              <span className={styles.muted}>
                {' '}
                · {t('keyTerms.firstMentioned', { time: formatOffset(term.first_mentioned_ms) })}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Live key terms: a side panel on wide screens, a bottom sheet behind a button on phones. */
export function LiveKeyTermsPanel() {
  const { t } = useTranslation('live');
  const keyTerms = useLive((s) => s.session.keyTerms);
  const terms = useMemo(
    () =>
      [...keyTerms.values()].sort(
        (a, b) => (a.first_mentioned_ms ?? 0) - (b.first_mentioned_ms ?? 0),
      ),
    [keyTerms],
  );
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside
        className={styles.aside}
        aria-labelledby="live-terms-heading"
        // Exception: this sticky panel scrolls on its own, so keyboard users must be able to
        // focus it to scroll it (WCAG 2.1.1, axe scrollable-region-focusable).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
      >
        <h2 id="live-terms-heading" className={styles.asideTitle}>
          {t('keyTerms.heading')}
        </h2>
        <KeyTermList terms={terms} />
      </aside>
      <div className={styles.sheetButton}>
        <Button
          icon={BookOpen}
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('keyTerms.open', { count: terms.length })}
        </Button>
        <Dialog open={open} onOpenChange={setOpen} title={t('keyTerms.heading')} variant="sheet">
          <KeyTermList terms={terms} />
        </Dialog>
      </div>
    </>
  );
}
