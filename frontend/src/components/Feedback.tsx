import {
  CircleAlert,
  CircleCheck,
  Info,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '@/lib/cx';
import { Button } from './Button';
import styles from './Feedback.module.css';

type Tone = 'info' | 'warning' | 'danger' | 'success';

const TONE_ICON: Record<Tone, LucideIcon> = {
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
  success: CircleCheck,
};

interface BannerProps {
  tone: Tone;
  children: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  /** "alert" interrupts screen readers: only for urgent, user-blocking problems. */
  role?: 'status' | 'alert' | 'none';
  className?: string | undefined;
}

export function Banner({ tone, children, action, icon, role = 'status', className }: BannerProps) {
  const Icon = icon ?? TONE_ICON[tone];
  return (
    <div
      className={cx(styles.banner, styles[tone], className)}
      role={role === 'none' ? undefined : role}
    >
      <Icon aria-hidden="true" />
      <div className={styles.bannerBody}>
        <div className={styles.bannerText}>{children}</div>
        {action}
      </div>
    </div>
  );
}

/** Decorative placeholder; wrap groups in an element with aria-busy and a visually hidden label. */
export function Skeleton({ className }: { className?: string | undefined }) {
  return <span className={cx(styles.skeleton, className)} aria-hidden="true" />;
}

export function LoadingRegion({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={className} aria-busy="true">
      <span className="visually-hidden" role="status">
        {label}
      </span>
      {children}
    </div>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  headingLevel?: 2 | 3;
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  compact = false,
  headingLevel = 2,
}: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={cx(styles.state, compact && styles.compact)}>
      <Icon aria-hidden="true" />
      <Heading className={styles.stateTitle}>{title}</Heading>
      {body !== undefined && <p className={styles.stateBody}>{body}</p>}
      {action}
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
  headingLevel?: 2 | 3;
}

/** Human error message + retry. Rendered with role="alert" so the failure is announced. */
export function ErrorState({
  title,
  message,
  onRetry,
  retrying = false,
  compact = false,
  headingLevel = 2,
}: ErrorStateProps) {
  const { t } = useTranslation();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={cx(styles.state, compact && styles.compact)} role="alert">
      <CircleAlert aria-hidden="true" className={styles.errorIcon} />
      <Heading className={styles.stateTitle}>{title}</Heading>
      {message !== undefined && <p className={styles.stateBody}>{message}</p>}
      {onRetry !== undefined && (
        <Button icon={RefreshCw} onClick={onRetry} loading={retrying}>
          {t('actions.retry')}
        </Button>
      )}
    </div>
  );
}
