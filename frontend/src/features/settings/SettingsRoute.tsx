import { useTranslation } from 'react-i18next';
import { UI_LANGUAGES } from '@/app/i18n/resources';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Checkbox, Field, Select } from '@/components/Field';
import { PageHeader, Section } from '@/components/Page';
import { LANGUAGES } from '@/lib/lang';
import { useCurrentUser } from '@/features/auth/api';
import { PasswordSection, ProfileSection, SystemSection } from './AccountSections';
import { usePrefs, type Theme, type TranscriptSize } from './prefsStore';
import styles from './Settings.module.css';

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];
const SIZES: readonly TranscriptSize[] = ['sm', 'md', 'lg', 'xl'];

/** Preferences apply immediately and are stored on this device (no submit step). */
export function SettingsRoute() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation();
  useDocumentTitle(t('title'));
  const prefs = usePrefs();
  const user = useCurrentUser();

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <div className={styles.sections}>
        {user !== null && <ProfileSection user={user} />}
        <PasswordSection />

        <p className={styles.hint}>{t('deviceNote')}</p>
        <Section title={t('appearance.heading')} headingId="appearance">
          <fieldset className={styles.choices}>
            <legend className={styles.legend}>{t('appearance.theme')}</legend>
            {THEMES.map((theme) => (
              <label key={theme} className={styles.choice}>
                <input
                  type="radio"
                  name="theme"
                  checked={prefs.theme === theme}
                  onChange={() => {
                    prefs.set('theme', theme);
                  }}
                />
                {t(`appearance.themes.${theme}`)}
              </label>
            ))}
          </fieldset>
        </Section>

        <Section title={t('transcript.heading')} headingId="transcript">
          <fieldset className={styles.choices}>
            <legend className={styles.legend}>{t('transcript.fontSize')}</legend>
            {SIZES.map((size) => (
              <label key={size} className={styles.choice}>
                <input
                  type="radio"
                  name="size"
                  checked={prefs.transcriptSize === size}
                  onChange={() => {
                    prefs.set('transcriptSize', size);
                  }}
                />
                {t(`transcript.fontSizes.${size}`)}
              </label>
            ))}
          </fieldset>
          <p className={styles.preview} aria-hidden="true">
            {t('transcript.preview')}
          </p>
          <Checkbox
            label={t('transcript.autoScroll')}
            hint={t('transcript.autoScrollHint')}
            checked={prefs.autoScroll}
            onChange={(e) => {
              prefs.set('autoScroll', e.target.checked);
            }}
          />
          <Checkbox
            label={t('transcript.announce')}
            hint={t('transcript.announceHint')}
            checked={prefs.announce}
            onChange={(e) => {
              prefs.set('announce', e.target.checked);
            }}
          />
        </Section>

        <Section title={t('language.heading')} headingId="language">
          <Checkbox
            label={t('language.showLabels')}
            checked={prefs.showLanguageLabels}
            onChange={(e) => {
              prefs.set('showLanguageLabels', e.target.checked);
            }}
          />
          <Checkbox
            label={t('language.showTransliteration')}
            hint={t('language.showTransliterationHint')}
            checked={prefs.showTransliteration}
            onChange={(e) => {
              prefs.set('showTransliteration', e.target.checked);
            }}
          />
          <fieldset className={styles.choices}>
            <legend className={styles.legend}>{t('language.filter')}</legend>
            {LANGUAGES.map((code) => (
              <Checkbox
                key={code}
                label={tc(`language.${code}`)}
                checked={prefs.visibleLanguages.includes(code)}
                disabled={
                  prefs.visibleLanguages.length === 1 && prefs.visibleLanguages.includes(code)
                }
                onChange={() => {
                  prefs.toggleLanguage(code);
                }}
              />
            ))}
            <p className={styles.hint}>{t('language.filterHint')}</p>
          </fieldset>
          <Field label={t('language.uiLanguage')}>
            {(c) => (
              <Select {...c} value="en" onChange={() => undefined}>
                {UI_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code} disabled={!lang.available}>
                    {lang.available
                      ? tc(`language.${lang.code}`)
                      : t('language.uiLanguageComingSoon', {
                          language: tc(`language.${lang.code}`),
                        })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </Section>

        <Section title={t('notifications.heading')} headingId="notifications">
          <p className={styles.hint}>{t('notifications.intro')}</p>
          <Checkbox
            label={t('notifications.connection')}
            checked={prefs.notifyConnection}
            onChange={(e) => {
              prefs.set('notifyConnection', e.target.checked);
            }}
          />
          <Checkbox
            label={t('notifications.lectureEnded')}
            checked={prefs.notifyLectureEnded}
            onChange={(e) => {
              prefs.set('notifyLectureEnded', e.target.checked);
            }}
          />
          <Checkbox
            label={t('notifications.notesReady')}
            checked={prefs.notifyNotesReady}
            onChange={(e) => {
              prefs.set('notifyNotesReady', e.target.checked);
            }}
          />
        </Section>

        {user?.role === 'admin' && <SystemSection />}
      </div>
    </>
  );
}
