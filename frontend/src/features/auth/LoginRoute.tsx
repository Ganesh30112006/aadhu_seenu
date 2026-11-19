import { Mic } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { isApiError } from '@/api/errors';
import { homeFor } from '@/app/guards';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { safeRedirectPath } from '@/lib/safeRedirect';
import { useLogin } from './api';
import { LoginForm, type LoginValues } from './LoginForm';
import styles from './Login.module.css';

export function loginErrorMessage(error: unknown, t: TFunction<'auth'>): string {
  if (!isApiError(error)) return t('errors.generic');
  if (error.isNetwork) return t('errors.network');
  if (error.isRateLimited) return t('errors.rateLimited');
  if (error.code === 'account_disabled') return t('errors.accountDisabled');
  if (error.isUnauthorized) return t('errors.invalidCredentials');
  return t('errors.generic');
}

export function LoginRoute() {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation();
  useDocumentTitle(t('title'));
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const login = useLogin();

  const submit = (values: LoginValues): void => {
    login.mutate(values, {
      onSuccess: (user) => {
        void navigate(safeRedirectPath(params.get('next'), homeFor(user)), { replace: true });
      },
    });
  };

  return (
    <main id="main-content" className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>
          <Mic aria-hidden="true" />
          {tc('appName')}
        </p>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.subtitle}>{t('subtitle')}</p>
        <LoginForm
          onSubmit={submit}
          pending={login.isPending}
          errorMessage={login.isError ? loginErrorMessage(login.error, t) : null}
        />
      </div>
    </main>
  );
}
