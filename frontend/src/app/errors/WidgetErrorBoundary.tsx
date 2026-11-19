import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@/components/Feedback';
import { logger } from '@/lib/logger';

interface BoundaryProps {
  onReset: () => void;
  fallback: (reset: () => void) => ReactNode;
  children: ReactNode;
}

class Boundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('widget crashed', { error, componentStack: info.componentStack });
  }

  private readonly reset = (): void => {
    this.props.onReset();
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.reset) : this.props.children;
  }
}

function WidgetFallback({ reset }: { reset: () => void }) {
  const { t } = useTranslation('shell');
  return (
    <ErrorState
      compact
      headingLevel={3}
      title={t('widgetError.title')}
      message={t('widgetError.body')}
      onRetry={reset}
    />
  );
}

/** Isolates a panel (key terms, device banner…) so its crash never takes down the page. */
export function WidgetErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <Boundary onReset={reset} fallback={(retry) => <WidgetFallback reset={retry} />}>
          {children}
        </Boundary>
      )}
    </QueryErrorResetBoundary>
  );
}
