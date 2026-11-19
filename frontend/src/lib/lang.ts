import type { LanguageCode } from '@/api/types';

export type { LanguageCode };

/** All transcript languages, in display order. */
export const LANGUAGES: readonly LanguageCode[] = ['en', 'te', 'hi'];

/** Short label shown on segment tags: "EN", "TE", "HI". */
export function languageTag(code: LanguageCode): string {
  return code.toUpperCase();
}

export function isLanguageCode(value: string): value is LanguageCode {
  return LANGUAGES.some((code) => code === value);
}
