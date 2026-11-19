import * as RadixToast from '@radix-ui/react-toast';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { cx } from '@/lib/cx';
import { IconButton } from './Button';
import styles from './Overlay.module.css';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (tone: ToastTone, title: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

/** Global, ephemeral UI notifications (truly global client state → Zustand). */
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (tone, title) => {
    const id = nextId;
    nextId += 1;
    set((state) => ({ toasts: [...state.toasts.slice(-2), { id, tone, title }] }));
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));

export const toast = {
  success: (title: string) => {
    useToastStore.getState().push('success', title);
  },
  error: (title: string) => {
    useToastStore.getState().push('error', title);
  },
  info: (title: string) => {
    useToastStore.getState().push('info', title);
  },
};

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info } as const;
const TONE_CLASS = {
  success: styles.toastSuccess,
  error: styles.toastError,
  info: styles.toastInfo,
} as const;

export function Toaster() {
  const { t } = useTranslation();
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  return (
    <RadixToast.Provider swipeDirection="down" duration={5000}>
      {toasts.map((item) => {
        const Icon = ICONS[item.tone];
        return (
          <RadixToast.Root
            key={item.id}
            className={cx(styles.toast, TONE_CLASS[item.tone])}
            type={item.tone === 'error' ? 'foreground' : 'background'}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
          >
            <Icon aria-hidden="true" />
            <RadixToast.Title className={styles.toastTitle}>{item.title}</RadixToast.Title>
            <RadixToast.Close asChild>
              <IconButton icon={X} label={t('actions.close')} />
            </RadixToast.Close>
          </RadixToast.Root>
        );
      })}
      <RadixToast.Viewport className={styles.toastViewport} />
    </RadixToast.Provider>
  );
}
