import admin from './locales/en/admin.json';
import auth from './locales/en/auth.json';
import common from './locales/en/common.json';
import devices from './locales/en/devices.json';
import home from './locales/en/home.json';
import lectures from './locales/en/lectures.json';
import live from './locales/en/live.json';
import search from './locales/en/search.json';
import settings from './locales/en/settings.json';
import shell from './locales/en/shell.json';
import study from './locales/en/study.json';

/**
 * English UI strings. To add Telugu or Hindi: create locales/te/*.json with the same keys and
 * register them here; transcript text is never translated (it keeps its original script).
 */
export const resources = {
  en: { common, shell, auth, home, live, lectures, study, search, devices, settings, admin },
} as const;

export const defaultNS = 'common';

/** Interface languages: only English ships today. */
export const UI_LANGUAGES = [
  { code: 'en', available: true },
  { code: 'te', available: false },
  { code: 'hi', available: false },
] as const;
