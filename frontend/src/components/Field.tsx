import { CircleAlert } from 'lucide-react';
import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from '@/lib/cx';
import styles from './Field.module.css';

export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': boolean;
}

interface FieldProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  className?: string | undefined;
  /** Receives the ids/ARIA wiring for the control so label, hint and error are announced. */
  children: (control: FieldControlProps) => ReactNode;
}

/** Label + control + hint + error, correctly associated for screen readers. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint !== undefined ? hintId : null, error !== undefined ? errorId : null]
    .filter((value) => value !== null)
    .join(' ');
  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        'aria-invalid': error !== undefined,
      })}
      {hint !== undefined && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className={styles.error}>
          <CircleAlert aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> };
export function TextInput({ className, ...props }: InputProps) {
  return <input className={cx(styles.control, className)} {...props} />;
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> };
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select className={cx(styles.control, className)} {...props}>
      {children}
    </select>
  );
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: Ref<HTMLTextAreaElement>;
};
export function TextArea({ className, ...props }: TextAreaProps) {
  return <textarea className={cx(styles.control, className)} {...props} />;
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  hint?: string;
}

export function Checkbox({ label, hint, className, ...props }: CheckboxProps) {
  const id = useId();
  return (
    <label className={cx(styles.check, className)} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        aria-describedby={hint !== undefined ? `${id}-hint` : undefined}
        {...props}
      />
      <span className={styles.checkText}>
        <span>{label}</span>
        {hint !== undefined && (
          <span id={`${id}-hint`} className={styles.hint}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}
