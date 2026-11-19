import { LoaderCircle, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cx } from '@/lib/cx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function buttonClass(variant: ButtonVariant, className?: string, iconOnly = false): string {
  return cx(styles.button, styles[variant], iconOnly && styles.iconOnly, className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shows a spinner and disables the button; keep the label so screen readers know what's busy. */
  loading?: boolean;
  icon?: LucideIcon;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary',
  loading = false,
  icon: Icon,
  className,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <LoaderCircle className={styles.spin} aria-hidden="true" />
      ) : (
        Icon !== undefined && <Icon aria-hidden="true" />
      )}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name; icon-only buttons must always have one. */
  label: string;
  icon: LucideIcon;
  variant?: ButtonVariant;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  icon: Icon,
  variant = 'ghost',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={buttonClass(variant, className, true)}
      {...rest}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  icon?: LucideIcon;
}

/** A navigation link that looks like a button (navigation must stay a link for semantics). */
export function ButtonLink({
  variant = 'secondary',
  icon: Icon,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link
      className={buttonClass(variant, typeof className === 'string' ? className : undefined)}
      {...rest}
    >
      {Icon !== undefined && <Icon aria-hidden="true" />}
      {children}
    </Link>
  );
}
