import { WifiOff } from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { Navigate, Outlet, ScrollRestoration, useLocation, useNavigation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Banner } from '@/components/Feedback';
import { useMe } from '@/features/auth/api';
import { pageKey, paths } from '../paths';
import { BottomNav, TopBar } from './Navigation';
import styles from './AppShell.module.css';

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** Moves focus to <main> when the page changes, so keyboard and screen-reader users start there. */
function useRouteFocus(mainRef: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  const key = pageKey(pathname);
  const previous = useRef(key);
  useEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    mainRef.current?.focus({ preventScroll: true });
  }, [key, mainRef]);
}

export function AppShell() {
  const { t } = useTranslation('shell');
  const { t: tc } = useTranslation();
  const { data: user } = useMe();
  const location = useLocation();
  const navigation = useNavigation();
  const online = useOnline();
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef);

  // The session ended mid-use (any 401 clears `me`): send the user to sign in, then back here.
  if (user === null) {
    return <Navigate to={paths.login(`${location.pathname}${location.search}`)} replace />;
  }
  if (user === undefined) return null;

  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>
        {t('skipToContent')}
      </a>
      <header className={styles.header}>
        <TopBar user={user} />
      </header>
      {navigation.state === 'loading' && (
        <div className={styles.progress} role="progressbar" aria-label={t('navigating')} />
      )}
      <main id="main-content" ref={mainRef} tabIndex={-1} className={styles.main}>
        {!online && (
          <Banner tone="warning" icon={WifiOff} className={styles.offline}>
            {tc('offlineBanner')}
          </Banner>
        )}
        <Outlet />
      </main>
      <BottomNav user={user} />
      <ScrollRestoration />
    </div>
  );
}
