import { FileQuestion, Lock, RefreshCw } from 'lucide-react';
import {
  isRouteErrorResponse,
  Navigate,
  useLocation,
  useRevalidator,
  useRouteError,
} from 'react-router';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import { Button, ButtonLink } from '@/components/Button';
import { EmptyState, ErrorState } from '@/components/Feedback';
import { useDocumentTitle } from '../useDocumentTitle';
import { paths } from '../paths';

/** A deploy replaced the hashed chunks this tab was about to load. */
function isChunkLoadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      error.message,
    )
  );
}

export function NotFound() {
  const { t } = useTranslation('shell');
  const { t: tc } = useTranslation();
  useDocumentTitle(t('notFound.title'));
  return (
    <EmptyState
      icon={FileQuestion}
      title={t('notFound.title')}
      body={t('notFound.body')}
      action={<ButtonLink to={paths.home()}>{tc('actions.goHome')}</ButtonLink>}
    />
  );
}

/** Per-route error element: one failing route never blanks the rest of the app. */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const { t } = useTranslation('shell');
  const { t: tc } = useTranslation();
  const revalidator = useRevalidator();
  const location = useLocation();
  useDocumentTitle(t('routeError.title'));

  if (isApiError(error) && error.isUnauthorized) {
    return <Navigate to={paths.login(`${location.pathname}${location.search}`)} replace />;
  }
  if (
    (isRouteErrorResponse(error) && error.status === 404) ||
    (isApiError(error) && error.isNotFound)
  ) {
    return <NotFound />;
  }
  if (
    (isRouteErrorResponse(error) && error.status === 403) ||
    (isApiError(error) && error.isForbidden)
  ) {
    return (
      <EmptyState
        icon={Lock}
        title={t('routeError.forbiddenTitle')}
        body={t('routeError.forbiddenBody')}
        action={<ButtonLink to={paths.home()}>{tc('actions.goHome')}</ButtonLink>}
      />
    );
  }
  if (isChunkLoadError(error)) {
    return (
      <EmptyState
        icon={RefreshCw}
        title={t('routeError.chunkTitle')}
        body={t('routeError.chunkBody')}
        action={
          <Button
            variant="primary"
            icon={RefreshCw}
            onClick={() => {
              window.location.reload();
            }}
          >
            {tc('actions.reload')}
          </Button>
        }
      />
    );
  }
  return (
    <ErrorState
      title={t('routeError.title')}
      message={t('routeError.body')}
      retrying={revalidator.state === 'loading'}
      onRetry={() => {
        void revalidator.revalidate();
      }}
    />
  );
}
