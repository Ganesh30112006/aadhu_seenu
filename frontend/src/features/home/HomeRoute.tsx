import { useInfiniteQuery } from '@tanstack/react-query';
import { Cpu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { User } from '@/api/types';
import { paths } from '@/app/paths';
import { useDocumentTitle } from '@/app/useDocumentTitle';
import { ButtonLink } from '@/components/Button';
import { EmptyState, ErrorState } from '@/components/Feedback';
import { PageHeader, Section } from '@/components/Page';
import { useCurrentUser } from '@/features/auth/api';
import { DeviceCard } from '@/features/devices/DeviceCard';
import { useDevices } from '@/features/devices/api';
import { lecturesQuery, useSubjects } from '@/features/lectures/api';
import { CardsSkeleton, LectureCards } from './HomeCards';
import { PrepareLectureForm } from './PrepareLectureForm';
import { StudentHome } from './StudentHome';
import styles from './Home.module.css';

function LecturerHome() {
  const { t } = useTranslation('home');
  const { t: tc } = useTranslation();
  const { t: tl } = useTranslation('lectures');
  const subjects = useSubjects();
  const devices = useDevices();
  const recent = useInfiniteQuery(lecturesQuery({}, 6));
  return (
    <div className={styles.columns}>
      <Section title={tl('prepare.title')} headingId="prepare">
        <p className={styles.lead}>{tl('prepare.description')}</p>
        {devices.isPending || subjects.isPending ? (
          <CardsSkeleton label={tc('loading')} />
        ) : devices.isError || subjects.isError ? (
          <ErrorState
            compact
            headingLevel={3}
            title={t('devicesErrorTitle')}
            onRetry={() => void devices.refetch()}
          />
        ) : (
          <PrepareLectureForm subjects={subjects.data} devices={devices.data} />
        )}
      </Section>
      <div>
        <Section title={t('lecturer.devicesHeading')} headingId="devices">
          {devices.isPending ? (
            <CardsSkeleton label={tc('loading')} />
          ) : devices.isError ? (
            <ErrorState
              compact
              headingLevel={3}
              title={t('devicesErrorTitle')}
              onRetry={() => void devices.refetch()}
            />
          ) : devices.data.length === 0 ? (
            <EmptyState compact headingLevel={3} icon={Cpu} title={tl('prepare.noDevices')} />
          ) : (
            <div className={styles.list}>
              {devices.data.map((d) => (
                <DeviceCard key={d.id} device={d} />
              ))}
            </div>
          )}
        </Section>
        <Section title={t('lecturer.recentHeading')} headingId="recent">
          {recent.isPending ? (
            <CardsSkeleton label={tc('loading')} />
          ) : recent.isError ? (
            <ErrorState
              compact
              headingLevel={3}
              title={t('recentErrorTitle')}
              onRetry={() => void recent.refetch()}
            />
          ) : (
            <LectureCards lectures={recent.data.pages[0]?.items ?? []} drafts />
          )}
        </Section>
      </div>
    </div>
  );
}

function AdminHome() {
  const { t } = useTranslation('home');
  const { t: tc } = useTranslation();
  const devices = useDevices();
  return (
    <Section
      title={t('admin.devicesHeading')}
      headingId="devices"
      actions={
        <>
          <ButtonLink to={paths.adminUsers()}>{t('admin.manageUsers')}</ButtonLink>
          <ButtonLink to={paths.adminSubjects()}>{t('admin.manageSubjects')}</ButtonLink>
        </>
      }
    >
      {devices.isPending ? (
        <CardsSkeleton label={tc('loading')} />
      ) : devices.isError ? (
        <ErrorState
          compact
          headingLevel={3}
          title={t('devicesErrorTitle')}
          onRetry={() => void devices.refetch()}
        />
      ) : (
        <div className={styles.list}>
          {devices.data.map((d) => (
            <DeviceCard key={d.id} device={d} />
          ))}
        </div>
      )}
    </Section>
  );
}

const SUBTITLE: Record<User['role'], 'lecturer.subtitle' | 'student.subtitle' | 'admin.subtitle'> =
  {
    lecturer: 'lecturer.subtitle',
    student: 'student.subtitle',
    admin: 'admin.subtitle',
  };

export function HomeRoute() {
  const { t } = useTranslation('home');
  const { t: ts } = useTranslation('shell');
  useDocumentTitle(ts('nav.home'));
  const user = useCurrentUser();
  if (user === null) return null;
  return (
    <>
      <PageHeader
        title={t('greeting', { name: user.full_name })}
        description={t(SUBTITLE[user.role])}
      />
      {user.role === 'lecturer' ? (
        <LecturerHome />
      ) : user.role === 'student' ? (
        <StudentHome />
      ) : (
        <AdminHome />
      )}
    </>
  );
}
