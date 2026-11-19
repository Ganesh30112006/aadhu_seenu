import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { LANGUAGES, isLanguageCode, type LanguageCode } from '@/lib/lang';

const THEMES = ['system', 'light', 'dark'] as const;
const SIZES = ['sm', 'md', 'lg', 'xl'] as const;

export type Theme = (typeof THEMES)[number];
export type TranscriptSize = (typeof SIZES)[number];

/*
 * Persisted values are untrusted (old versions, manual edits): every field is validated on its
 * own and ignored if wrong. Hand-written guards instead of Zod: this store is in the initial bundle.
 */
const isTheme = (v: unknown): v is Theme => THEMES.some((t) => t === v);
const isSize = (v: unknown): v is TranscriptSize => SIZES.some((s) => s === v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function savedLanguages(v: unknown): LanguageCode[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const codes = v.filter((c): c is LanguageCode => typeof c === 'string' && isLanguageCode(c));
  return codes.length > 0 && codes.length === v.length ? codes : undefined;
}

export interface Preferences {
  theme: Theme;
  transcriptSize: TranscriptSize;
  autoScroll: boolean;
  announce: boolean;
  showLanguageLabels: boolean;
  showTransliteration: boolean;
  visibleLanguages: readonly LanguageCode[];
  /** Live page notifications (toasts). */
  notifyConnection: boolean;
  notifyLectureEnded: boolean;
  notifyNotesReady: boolean;
}

interface PrefsActions {
  set: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  toggleLanguage: (language: LanguageCode) => void;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  transcriptSize: 'md',
  autoScroll: true,
  announce: false,
  showLanguageLabels: true,
  showTransliteration: false,
  visibleLanguages: LANGUAGES,
  notifyConnection: true,
  notifyLectureEnded: true,
  notifyNotesReady: true,
};

export const usePrefs = create<Preferences & PrefsActions>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFERENCES,
      set: (key, value) => {
        set({ [key]: value });
      },
      toggleLanguage: (language) => {
        set((state) => {
          const visible = state.visibleLanguages.includes(language)
            ? state.visibleLanguages.filter((l) => l !== language)
            : LANGUAGES.filter((l) => l === language || state.visibleLanguages.includes(l));
          // Never hide every language: the transcript would look empty.
          return visible.length === 0 ? state : { visibleLanguages: visible };
        });
      },
    }),
    {
      name: 'smart-classroom-preferences',
      version: 1,
      storage: createJSONStorage(() => window.localStorage),
      partialize: ({ set: _set, toggleLanguage: _toggle, ...prefs }) => prefs,
      merge: (persisted, current) => {
        if (!isRecord(persisted)) return current;
        const saved = persisted;
        return {
          ...current,
          theme: isTheme(saved.theme) ? saved.theme : current.theme,
          transcriptSize: isSize(saved.transcriptSize)
            ? saved.transcriptSize
            : current.transcriptSize,
          autoScroll: isBool(saved.autoScroll) ? saved.autoScroll : current.autoScroll,
          announce: isBool(saved.announce) ? saved.announce : current.announce,
          showLanguageLabels: isBool(saved.showLanguageLabels)
            ? saved.showLanguageLabels
            : current.showLanguageLabels,
          showTransliteration: isBool(saved.showTransliteration)
            ? saved.showTransliteration
            : current.showTransliteration,
          visibleLanguages: savedLanguages(saved.visibleLanguages) ?? current.visibleLanguages,
          notifyConnection: isBool(saved.notifyConnection)
            ? saved.notifyConnection
            : current.notifyConnection,
          notifyLectureEnded: isBool(saved.notifyLectureEnded)
            ? saved.notifyLectureEnded
            : current.notifyLectureEnded,
          notifyNotesReady: isBool(saved.notifyNotesReady)
            ? saved.notifyNotesReady
            : current.notifyNotesReady,
        };
      },
    },
  ),
);

/** Mirrors theme and text size onto <html> as data attributes (CSS reads them). */
export function applyPreferences(prefs: Pick<Preferences, 'theme' | 'transcriptSize'>): void {
  const root = document.documentElement;
  if (prefs.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', prefs.theme);
  if (prefs.transcriptSize === 'md') root.removeAttribute('data-transcript-size');
  else root.setAttribute('data-transcript-size', prefs.transcriptSize);
}

/** Applies preferences now and whenever they change. Called once, before the first render. */
export function startPreferenceSync(): () => void {
  applyPreferences(usePrefs.getState());
  return usePrefs.subscribe((state) => {
    applyPreferences(state);
  });
}
