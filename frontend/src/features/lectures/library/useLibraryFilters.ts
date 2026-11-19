import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import type { LibraryFilters } from '../api';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const StatusParam = z.enum(['scheduled', 'recording', 'processing', 'completed', 'failed']);

/** Library filters live in the URL (shareable, back-button friendly). URL values are untrusted. */
export function useLibraryFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo((): LibraryFilters => {
    const subject = params.get('subject');
    const status = StatusParam.safeParse(params.get('status'));
    const from = params.get('from');
    const to = params.get('to');
    const q = params.get('q')?.trim();
    return {
      ...(subject !== null && subject !== '' && { subjectId: subject }),
      ...(status.success && { status: status.data }),
      ...(from !== null && DATE.test(from) && { from }),
      ...(to !== null && DATE.test(to) && { to }),
      ...(q !== undefined && q !== '' && { q }),
    };
  }, [params]);

  const setFilter = (key: 'subject' | 'status' | 'from' | 'to' | 'q', value: string): void => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === '') next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };

  const clear = (): void => {
    setParams(new URLSearchParams(), { replace: true });
  };

  const active = Object.keys(filters).length > 0;
  return { filters, setFilter, clear, active };
}
