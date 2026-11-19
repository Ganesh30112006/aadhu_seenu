import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/errors';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { Button } from '@/components/Button';
import { ErrorState, LoadingRegion, Skeleton } from '@/components/Feedback';
import { Select } from '@/components/Field';
import { PageHeader } from '@/components/Page';
import { toast } from '@/components/Toast';
import { useCurrentUser } from '@/features/auth/api';
import { AddUserDialog } from './AddUserDialog';
import { useUpdateUser, useUsers } from './api';
import { ROLES } from './roles';
import styles from './Admin.module.css';

export function UsersRoute() {
  const { t } = useTranslation('admin');
  const { t: ts } = useTranslation('shell');
  const { t: tc } = useTranslation();
  useDocumentTitle(t('users.title'));
  const me = useCurrentUser();
  const users = useUsers();
  const update = useUpdateUser();
  const onUpdated = (name: string) => ({
    onSuccess: () => {
      toast.success(t('users.updated', { name }));
    },
    onError: (error: unknown) => {
      toast.error(
        isApiError(error) && error.code === 'cannot_disable_self'
          ? t('users.errors.self')
          : t('users.errors.generic'),
      );
    },
  });

  return (
    <>
      <PageHeader
        title={t('users.title')}
        description={t('users.description')}
        actions={<AddUserDialog />}
      />
      {users.isPending ? (
        <LoadingRegion label={tc('loading')}>
          <Skeleton className={styles.skeleton} />
        </LoadingRegion>
      ) : users.isError ? (
        <ErrorState title={t('users.errorTitle')} onRetry={() => void users.refetch()} />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('users.fullName')}</th>
                <th scope="col">{t('users.email')}</th>
                <th scope="col">{t('users.role')}</th>
                <th scope="col">{t('users.status')}</th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.full_name}
                    {u.id === me?.id && <span className={styles.muted}> ({t('users.you')})</span>}
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <Select
                      aria-label={t('users.changeRole', { name: u.full_name })}
                      value={u.role}
                      disabled={u.id === me?.id}
                      onChange={(e) => {
                        const role = ROLES.find((r) => r === e.target.value);
                        if (role)
                          update.mutate({ id: u.id, body: { role } }, onUpdated(u.full_name));
                      }}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ts(`userMenu.role.${r}`)}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td>
                    <Button
                      variant={u.active ? 'secondary' : 'primary'}
                      disabled={u.id === me?.id}
                      onClick={() => {
                        update.mutate(
                          { id: u.id, body: { active: !u.active } },
                          onUpdated(u.full_name),
                        );
                      }}
                    >
                      {u.active ? t('users.disableAction') : t('users.enableAction')}
                      <span className="visually-hidden"> {u.full_name}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
