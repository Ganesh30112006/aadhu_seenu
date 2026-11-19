import { zodResolver } from '@hookform/resolvers/zod';
import { Copy, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { isApiError } from '@/api/errors';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Banner } from '@/components/Feedback';
import { Field, TextInput } from '@/components/Field';
import { toast } from '@/components/Toast';
import { useRegisterDevice } from './api';
import styles from './Devices.module.css';

/** Admin: register a microphone. The token is shown exactly once (only its hash is stored). */
export function RegisterDeviceDialog() {
  const { t } = useTranslation('devices');
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<{ id: string; token: string } | null>(null);
  const register = useRegisterDevice();
  const schema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(2, t('register.validation.name'))
          .max(60, t('register.validation.name')),
        room: z.string().trim().min(1, t('register.validation.room')).max(60),
        serial: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[0-9A-F]{12}$/, t('register.validation.serial')),
      }),
    [t],
  );
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
  });
  const errors = form.formState.errors;
  const close = (next: boolean): void => {
    setOpen(next);
    if (!next) {
      setToken(null);
      form.reset();
      register.reset();
    }
  };

  return (
    <>
      <Button
        variant="primary"
        icon={Plus}
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('register.button')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={close}
        title={token === null ? t('register.title') : t('register.tokenTitle')}
        description={token === null ? t('register.description') : t('register.tokenBody')}
      >
        {token !== null ? (
          <>
            <p>device_id</p>
            <code className={styles.token}>{token.id}</code>
            <p>device_token</p>
            <code className={styles.token}>{token.token}</code>
            <div className={styles.actions}>
              <Button icon={Copy} onClick={() => void navigator.clipboard.writeText(token.token)}>
                {t('register.copyToken')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  close(false);
                }}
              >
                {t('register.done')}
              </Button>
            </div>
          </>
        ) : (
          <form
            className={styles.formGrid}
            noValidate
            onSubmit={(e) =>
              void form.handleSubmit((values) => {
                register.mutate(
                  { ...values, lecturer_ids: [] },
                  {
                    onSuccess: (result) => {
                      toast.success(t('register.success', { name: result.device.name }));
                      setToken({ id: result.device.id, token: result.token });
                    },
                  },
                );
              })(e)
            }
          >
            {register.isError && (
              <Banner tone="danger" role="alert">
                {isApiError(register.error) && register.error.isConflict
                  ? t('register.errors.exists')
                  : t('register.errors.generic')}
              </Banner>
            )}
            <Field label={t('register.name')} error={errors.name?.message}>
              {(c) => (
                <TextInput
                  {...c}
                  {...form.register('name')}
                  placeholder={t('register.namePlaceholder')}
                />
              )}
            </Field>
            <Field label={t('register.room')} error={errors.room?.message}>
              {(c) => (
                <TextInput
                  {...c}
                  {...form.register('room')}
                  placeholder={t('register.roomPlaceholder')}
                />
              )}
            </Field>
            <Field
              label={t('register.serial')}
              hint={t('register.serialHint')}
              error={errors.serial?.message}
            >
              {(c) => (
                <TextInput
                  {...c}
                  {...form.register('serial')}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              )}
            </Field>
            <div className={styles.actions}>
              <Button type="submit" variant="primary" loading={register.isPending}>
                {register.isPending ? t('register.submitting') : t('register.submit')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}
