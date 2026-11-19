import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button, IconButton } from '@/components/Button';
import { Banner } from '@/components/Feedback';
import { Field, TextInput } from '@/components/Field';
import styles from './Login.module.css';

function useLoginSchema() {
  const { t } = useTranslation('auth');
  return useMemo(
    () =>
      z.object({
        email: z
          .string()
          .trim()
          .min(1, t('validation.emailRequired'))
          .pipe(z.email(t('validation.emailInvalid'))),
        password: z.string().min(1, t('validation.passwordRequired')),
      }),
    [t],
  );
}

export type LoginValues = z.infer<ReturnType<typeof useLoginSchema>>;

interface LoginFormProps {
  onSubmit: (values: LoginValues) => void;
  pending: boolean;
  errorMessage: string | null;
}

export function LoginForm({ onSubmit, pending, errorMessage }: LoginFormProps) {
  const { t } = useTranslation('auth');
  const schema = useLoginSchema();
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(schema), mode: 'onTouched' });

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        void handleSubmit(onSubmit)(event);
      }}
    >
      {errorMessage !== null && (
        <Banner tone="danger" role="alert">
          {errorMessage}
        </Banner>
      )}
      <Field label={t('email')} error={errors.email?.message}>
        {(control) => (
          <TextInput
            {...control}
            {...register('email')}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
          />
        )}
      </Field>
      <Field label={t('password')} error={errors.password?.message}>
        {(control) => (
          <div className={styles.passwordRow}>
            <TextInput
              {...control}
              {...register('password')}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
            />
            <IconButton
              icon={showPassword ? EyeOff : Eye}
              label={showPassword ? t('hidePassword') : t('showPassword')}
              aria-pressed={showPassword}
              onClick={() => {
                setShowPassword((value) => !value);
              }}
            />
          </div>
        )}
      </Field>
      <Button
        type="submit"
        variant="primary"
        icon={LogIn}
        loading={pending}
        className={styles.submit}
      >
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
