import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Subject } from '@/api/types';
import { Button, IconButton } from '@/components/Button';
import { Field, Select, TextInput } from '@/components/Field';
import type { LibraryFilters as Filters } from '../api';
import styles from './Library.module.css';

const STATUSES = ['completed', 'recording', 'processing', 'scheduled', 'failed'] as const;

interface LibraryFiltersProps {
  filters: Filters;
  subjects: readonly Subject[];
  onChange: (key: 'subject' | 'status' | 'from' | 'to' | 'q', value: string) => void;
  onClear: () => void;
  active: boolean;
}

export function LibraryFilters({
  filters,
  subjects,
  onChange,
  onClear,
  active,
}: LibraryFiltersProps) {
  const { t } = useTranslation('lectures');
  const { t: tc } = useTranslation();
  return (
    <section aria-label={t('library.filters')} className={styles.filters}>
      <form
        role="search"
        className={styles.searchRow}
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get('q');
          onChange('q', typeof value === 'string' ? value.trim() : '');
        }}
      >
        <Field label={t('library.search')} className={styles.grow}>
          {(control) => (
            <TextInput
              {...control}
              key={filters.q ?? ''}
              name="q"
              type="search"
              defaultValue={filters.q ?? ''}
              placeholder={t('library.searchPlaceholder')}
              enterKeyHint="search"
            />
          )}
        </Field>
        <IconButton
          type="submit"
          icon={Search}
          label={t('library.search')}
          variant="secondary"
          className={styles.alignEnd}
        />
      </form>
      <div className={styles.filterGrid}>
        <Field label={t('library.subject')}>
          {(control) => (
            <Select
              {...control}
              value={filters.subjectId ?? ''}
              onChange={(e) => {
                onChange('subject', e.target.value);
              }}
            >
              <option value="">{t('library.allSubjects')}</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('library.status')}>
          {(control) => (
            <Select
              {...control}
              value={filters.status ?? ''}
              onChange={(e) => {
                onChange('status', e.target.value);
              }}
            >
              <option value="">{t('library.allStatuses')}</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {tc(`status.${status}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('library.from')}>
          {(control) => (
            <TextInput
              {...control}
              type="date"
              value={filters.from ?? ''}
              max={filters.to}
              onChange={(e) => {
                onChange('from', e.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t('library.to')}>
          {(control) => (
            <TextInput
              {...control}
              type="date"
              value={filters.to ?? ''}
              min={filters.from}
              onChange={(e) => {
                onChange('to', e.target.value);
              }}
            />
          )}
        </Field>
      </div>
      {active && (
        <Button variant="ghost" icon={X} onClick={onClear} className={styles.clear}>
          {tc('actions.clearFilters')}
        </Button>
      )}
    </section>
  );
}
