import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, type ButtonVariant } from './Button';
import styles from './Overlay.module.css';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** "sheet" slides up from the bottom (mobile side panels). */
  variant?: 'dialog' | 'sheet';
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  variant = 'dialog',
}: DialogProps) {
  const { t } = useTranslation();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content
          className={variant === 'sheet' ? styles.sheet : styles.dialog}
          {...(description === undefined && { 'aria-describedby': undefined })}
        >
          <RadixDialog.Title className={styles.dialogTitle}>{title}</RadixDialog.Title>
          {description !== undefined && (
            <RadixDialog.Description className={styles.dialogDescription}>
              {description}
            </RadixDialog.Description>
          )}
          <div className={styles.dialogBody}>{children}</div>
          <RadixDialog.Close asChild>
            <IconButton className={styles.dialogClose} icon={X} label={t('actions.close')} />
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  confirmVariant?: ButtonVariant;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  confirmVariant = 'primary',
  loading = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className={styles.dialogActions}>
        <Button
          variant="secondary"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          {t('actions.cancel')}
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

export { styles as overlayStyles };
