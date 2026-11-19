import { useTranslation } from 'react-i18next';
import { durationParts } from '@/lib/time';

/** "50 min" / "1 h 5 min", localised. */
export function useFormatDuration(): (ms: number) => string {
  const { t } = useTranslation();
  return (ms) => {
    const { hours, minutes } = durationParts(ms);
    return hours > 0
      ? t('duration.hoursMinutes', { hours, minutes })
      : t('duration.minutes', { count: minutes });
  };
}
