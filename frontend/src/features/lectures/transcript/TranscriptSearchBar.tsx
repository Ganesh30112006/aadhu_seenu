import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@/components/Button';
import { TextInput } from '@/components/Field';
import styles from '../detail/Detail.module.css';

interface TranscriptSearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  current: number; // 0-based, -1 when no matches
  total: number;
  onNext: () => void;
  onPrevious: () => void;
}

/** In-lecture search: Enter = next match, Shift+Enter = previous, Esc = clear. */
export function TranscriptSearchBar({
  query,
  onQueryChange,
  current,
  total,
  onNext,
  onPrevious,
}: TranscriptSearchBarProps) {
  const { t } = useTranslation('lectures');
  const active = query.trim() !== '';
  return (
    <div className={styles.searchBar} role="search">
      <label htmlFor="transcript-search" className="visually-hidden">
        {t('search.label')}
      </label>
      <TextInput
        id="transcript-search"
        type="search"
        className={styles.searchInput}
        value={query}
        placeholder={t('search.placeholder')}
        enterKeyHint="search"
        aria-describedby="transcript-search-count"
        onChange={(e) => {
          onQueryChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrevious();
            else onNext();
          } else if (e.key === 'Escape') {
            onQueryChange('');
          }
        }}
      />
      <span id="transcript-search-count" className={styles.matches} role="status">
        {active ? (
          total === 0 ? (
            t('search.noMatches')
          ) : (
            t('search.matches', { current: current + 1, total })
          )
        ) : (
          <Search aria-hidden="true" />
        )}
      </span>
      <IconButton
        icon={ChevronUp}
        label={t('search.previous')}
        disabled={total === 0}
        onClick={onPrevious}
      />
      <IconButton
        icon={ChevronDown}
        label={t('search.next')}
        disabled={total === 0}
        onClick={onNext}
      />
      {active && (
        <IconButton
          icon={X}
          label={t('search.clear')}
          onClick={() => {
            onQueryChange('');
          }}
        />
      )}
    </div>
  );
}
