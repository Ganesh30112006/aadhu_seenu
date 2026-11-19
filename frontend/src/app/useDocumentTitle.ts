import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/** Sets the tab title ("<page> · Smart Classroom"), announced by screen readers on navigation. */
export function useDocumentTitle(title: string | null): void {
  const { t } = useTranslation();
  const appName = t('appName');
  useEffect(() => {
    document.title = title === null || title === '' ? appName : `${title} · ${appName}`;
  }, [title, appName]);
}
