import { zodResolver } from '@hookform/resolvers/zod';
import { BookMarked, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { isApiError } from '@/api/errors';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button } from '@/components/Button';
import { Banner, EmptyState, ErrorState, LoadingRegion, Skeleton } from '@/components/Feedback';
import { Field, TextInput } from '@/components/Field';
import { PageHeader } from '@/components/Page';
import { toast } from '@/components/Toast';
import { useSubjects } from '@/features/lectures/api';
import { useCreateSubject } from './api';
import styles from './Admin.module.css';

export function SubjectsRoute() {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  useDocumentTitle(t('subjects.title'));
  const subjects = useSubjects();
  const create = useCreateSubject();
  const schema = useMemo(
    () =>
      z.object({
        code: z
          .string()
          .trim()
          .min(2, t('subjects.validation.code'))
          .max(16, t('subjects.validation.code')),
        name: z
          .string()
          .trim()
          .min(2, t('subjects.validation.name'))
          .max(120, t('subjects.validation.name')),
      }),
    [t],
  );
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { code: '', name: '' },
  });

  return (
    <>
      <PageHeader title={t('subjects.title')} description={t('subjects.description')} />
      <form
        className={styles.inlineForm}
        noValidate
        onSubmit={(e) =>
          void form.handleSubmit((values) => {
            create.mutate(values, {
              onSuccess: (subject) => {
                toast.success(t('subjects.added', { code: subject.code }));
                form.reset();
              },
            });
          })(e)
        }
      >
        {create.isError && (
          <Banner tone="danger" role="alert" className={styles.full}>
            {isApiError(create.error) && create.error.isConflict
              ? t('subjects.errors.exists')
              : t('subjects.errors.generic')}
          </Banner>
        )}
        <Field label={t('subjects.code')} error={form.formState.errors.code?.message}>
          {(c) => (
            <TextInput
              {...c}
              {...form.register('code')}
              placeholder={t('subjects.codePlaceholder')}
              autoCapitalize="characters"
            />
          )}
        </Field>
        <Field label={t('subjects.name')} error={form.formState.errors.name?.message}>
          {(c) => (
            <TextInput
              {...c}
              {...form.register('name')}
              placeholder={t('subjects.namePlaceholder')}
            />
          )}
        </Field>
        <Button
          type="submit"
          variant="primary"
          icon={Plus}
          loading={create.isPending}
          className={styles.submit}
        >
          {create.isPending ? t('subjects.adding') : t('subjects.add')}
        </Button>
      </form>
      {subjects.isPending ? (
        <LoadingRegion label={tc('loading')}>
          <Skeleton className={styles.skeleton} />
        </LoadingRegion>
      ) : subjects.isError ? (
        <ErrorState title={t('subjects.errorTitle')} onRetry={() => void subjects.refetch()} />
      ) : subjects.data.length === 0 ? (
        <EmptyState
          icon={BookMarked}
          title={t('subjects.emptyTitle')}
          body={t('subjects.emptyBody')}
        />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('subjects.code')}</th>
              <th scope="col">{t('subjects.name')}</th>
            </tr>
          </thead>
          <tbody>
            {subjects.data.map((s) => (
              <tr key={s.id}>
                <td>
                  <code>{s.code}</code>
                </td>
                <td>{s.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
