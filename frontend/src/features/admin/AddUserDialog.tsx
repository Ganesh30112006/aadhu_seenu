import { zodResolver } from '@hookform/resolvers/zod';
import { UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { isApiError } from '@/api/errors';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Banner } from '@/components/Feedback';
import { Field, Select, TextInput } from '@/components/Field';
import { toast } from '@/components/Toast';
import { useCreateUser } from './api';
import { ROLES } from './roles';
import styles from './Admin.module.css';

export function AddUserDialog() {
  const { t } = useTranslation('admin');
  const { t: ts } = useTranslation('shell');
  const [open, setOpen] = useState(false);
  const create = useCreateUser();
  const schema = useMemo(
    () =>
      z.object({
        full_name: z.string().trim().min(1, t('users.validation.fullName')),
        email: z.email(t('users.validation.email')),
        role: z.enum(['lecturer', 'student', 'admin']),
        password: z.string().min(8, t('users.validation.password')),
      }),
    [t],
  );
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: '', email: '', role: 'student', password: '' },
  });
  const errors = form.formState.errors;
  return (
    <>
      <Button
        variant="primary"
        icon={UserPlus}
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('users.add')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            form.reset();
            create.reset();
          }
        }}
        title={t('users.addTitle')}
      >
        <form
          className={styles.dialogForm}
          noValidate
          onSubmit={(e) =>
            void form.handleSubmit((values) => {
              create.mutate(values, {
                onSuccess: (user) => {
                  toast.success(t('users.added', { name: user.full_name }));
                  setOpen(false);
                  form.reset();
                },
              });
            })(e)
          }
        >
          {create.isError && (
            <Banner tone="danger" role="alert">
              {isApiError(create.error) && create.error.isConflict
                ? t('users.errors.exists')
                : t('users.errors.generic')}
            </Banner>
          )}
          <Field label={t('users.fullName')} error={errors.full_name?.message}>
            {(c) => <TextInput {...c} {...form.register('full_name')} />}
          </Field>
          <Field label={t('users.email')} error={errors.email?.message}>
            {(c) => <TextInput {...c} type="email" {...form.register('email')} />}
          </Field>
          <Field label={t('users.role')}>
            {(c) => (
              <Select {...c} {...form.register('role')}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ts(`userMenu.role.${r}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={t('users.password')}
            hint={t('users.passwordHint')}
            error={errors.password?.message}
          >
            {(c) => (
              <TextInput
                {...c}
                type="password"
                autoComplete="new-password"
                {...form.register('password')}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={create.isPending}>
            {create.isPending ? t('users.submitting') : t('users.submit')}
          </Button>
        </form>
      </Dialog>
    </>
  );
}
