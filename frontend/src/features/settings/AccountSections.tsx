import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { isApiError } from '@/api/errors';
import type { User } from '@/api/types';
import { Button } from '@/components/Button';
import { Banner, ErrorState, LoadingRegion, Skeleton } from '@/components/Feedback';
import { Field, TextInput } from '@/components/Field';
import { Section } from '@/components/Page';
import { toast } from '@/components/Toast';
import { useChangePassword, useSystemInfo, useUpdateProfile } from './api';
import styles from './Settings.module.css';

export function ProfileSection({ user }: { user: User }) {
  const { t } = useTranslation('settings');
  const update = useUpdateProfile();
  const schema = useMemo(
    () => z.object({ full_name: z.string().trim().min(1, t('profile.nameRequired')).max(120) }),
    [t],
  );
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    values: { full_name: user.full_name },
  });
  return (
    <Section title={t('profile.heading')} headingId="profile">
      <form
        className={styles.form}
        noValidate
        onSubmit={(e) =>
          void form.handleSubmit((values) => {
            update.mutate(values.full_name, {
              onSuccess: () => {
                toast.success(t('profile.saved'));
              },
            });
          })(e)
        }
      >
        {update.isError && (
          <Banner tone="danger" role="alert">
            {t('profile.error')}
          </Banner>
        )}
        <Field label={t('profile.name')} error={form.formState.errors.full_name?.message}>
          {(c) => <TextInput {...c} autoComplete="name" {...form.register('full_name')} />}
        </Field>
        <dl className={styles.facts}>
          <dt>{t('profile.email')}</dt>
          <dd>{user.email}</dd>
          <dt>{t('profile.role')}</dt>
          <dd>{t(`profile.roles.${user.role}`)}</dd>
        </dl>
        <div>
          <Button type="submit" variant="primary" loading={update.isPending}>
            {t('profile.save')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

export function PasswordSection() {
  const { t } = useTranslation('settings');
  const change = useChangePassword();
  const schema = useMemo(
    () =>
      z
        .object({
          current_password: z.string().min(1, t('password.currentRequired')),
          new_password: z.string().min(8, t('password.tooShort')).max(200),
          confirm: z.string(),
        })
        .refine((v) => v.new_password === v.confirm, {
          path: ['confirm'],
          message: t('password.mismatch'),
        }),
    [t],
  );
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { current_password: '', new_password: '', confirm: '' },
  });
  const errors = form.formState.errors;
  const wrong = isApiError(change.error) && change.error.code === 'wrong_password';
  return (
    <Section title={t('password.heading')} headingId="password">
      <form
        className={styles.form}
        noValidate
        onSubmit={(e) =>
          void form.handleSubmit(({ current_password, new_password }) => {
            change.mutate(
              { current_password, new_password },
              {
                onSuccess: () => {
                  toast.success(t('password.changed'));
                  form.reset();
                },
              },
            );
          })(e)
        }
      >
        <p className={styles.hint}>{t('password.intro')}</p>
        {change.isError && (
          <Banner tone="danger" role="alert">
            {wrong ? t('password.wrong') : t('password.error')}
          </Banner>
        )}
        <Field label={t('password.current')} error={errors.current_password?.message}>
          {(c) => (
            <TextInput
              {...c}
              type="password"
              autoComplete="current-password"
              {...form.register('current_password')}
            />
          )}
        </Field>
        <Field
          label={t('password.new')}
          hint={t('password.newHint')}
          error={errors.new_password?.message}
        >
          {(c) => (
            <TextInput
              {...c}
              type="password"
              autoComplete="new-password"
              {...form.register('new_password')}
            />
          )}
        </Field>
        <Field label={t('password.confirm')} error={errors.confirm?.message}>
          {(c) => (
            <TextInput
              {...c}
              type="password"
              autoComplete="new-password"
              {...form.register('confirm')}
            />
          )}
        </Field>
        <div>
          <Button type="submit" variant="primary" loading={change.isPending}>
            {t('password.submit')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** Admin only: read-only view of the server configuration. Changed in the server's .env. */
export function SystemSection() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation();
  const info = useSystemInfo();
  const orNone = (value: string): string => (value === '' ? t('system.notConfigured') : value);
  return (
    <Section title={t('system.heading')} headingId="system">
      <p className={styles.hint}>{t('system.intro')}</p>
      {info.isPending ? (
        <LoadingRegion label={tc('loading')}>
          <Skeleton className={styles.skeleton} />
        </LoadingRegion>
      ) : info.isError ? (
        <ErrorState title={t('system.error')} onRetry={() => void info.refetch()} />
      ) : (
        <dl className={styles.facts}>
          <dt>{t('system.environment')}</dt>
          <dd>{info.data.environment}</dd>
          <dt>{t('system.llm')}</dt>
          <dd>{orNone(info.data.llm_model)}</dd>
          <dt>{t('system.embedding')}</dt>
          <dd>{orNone(info.data.embedding_model)}</dd>
          <dt>{t('system.asr')}</dt>
          <dd>{`${info.data.asr_model} (${info.data.asr_device})`}</dd>
          <dt>{t('system.prompts')}</dt>
          <dd>{info.data.prompt_version}</dd>
          <dt>{t('system.retention')}</dt>
          <dd>
            {info.data.audio_retention_days === 0
              ? t('system.retentionForever')
              : t('system.retentionDays', { count: info.data.audio_retention_days })}
          </dd>
          <dt>{t('system.deviceDefaults')}</dt>
          <dd>
            {t('system.deviceDefaultsValue', {
              gain: info.data.device_gain_default,
              vad: info.data.device_vad_default ? t('system.on') : t('system.off'),
            })}
          </dd>
        </dl>
      )}
      <p className={styles.hint}>{t('system.retentionHint')}</p>
    </Section>
  );
}
