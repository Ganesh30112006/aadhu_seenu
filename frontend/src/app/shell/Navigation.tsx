import { LogOut, Mic, Settings } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { User } from '@/api/types';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/Menu';
import { useLogout } from '@/features/auth/api';
import { cx } from '@/lib/cx';
import { paths } from '../paths';
import { navItemsFor } from './navItems';
import styles from './AppShell.module.css';

function initials(name: string): string {
  const words = name.replace(/^(Dr|Prof|Mr|Ms|Mrs)\.?\s+/i, '').split(/\s+/);
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

export function TopBar({ user }: { user: User }) {
  const { t } = useTranslation('shell');
  const { t: tc } = useTranslation();
  return (
    <div className={styles.topBar}>
      <NavLink
        to={user.role === 'admin' ? paths.devices() : paths.home()}
        className={cx(styles.brand)}
      >
        <Mic aria-hidden="true" />
        <span>{tc('appName')}</span>
      </NavLink>
      <nav aria-label={t('nav.label')} className={styles.topNav}>
        <ul>
          {navItemsFor(user.role)
            .filter((item) => item.key !== 'settings')
            .map((item) => (
              <li key={item.key}>
                <NavLink
                  to={item.to}
                  end={item.key === 'home'}
                  className={({ isActive }) => cx(styles.topLink, isActive && styles.active)}
                >
                  <item.icon aria-hidden="true" />
                  {t(`nav.${item.key}`)}
                </NavLink>
              </li>
            ))}
        </ul>
      </nav>
      <UserMenu user={user} />
    </div>
  );
}

function UserMenu({ user }: { user: User }) {
  const { t } = useTranslation('shell');
  const navigate = useNavigate();
  const logout = useLogout();
  const adminLinks = navItemsFor(user.role).filter((item) => !item.mobile);
  return (
    <Menu
      label={t('userMenu.label', { name: user.full_name })}
      trigger={
        <button type="button" className={styles.userButton}>
          <span className={styles.avatar} aria-hidden="true">
            {initials(user.full_name)}
          </span>
          <span className={styles.userName}>{user.full_name}</span>
        </button>
      }
    >
      <MenuLabel>
        {user.full_name} · {t(`userMenu.role.${user.role}`)}
      </MenuLabel>
      <MenuSeparator />
      {adminLinks.map((item) => (
        <MenuItem key={item.key} icon={item.icon} onSelect={() => void navigate(item.to)}>
          {t(`nav.${item.key}`)}
        </MenuItem>
      ))}
      <MenuItem icon={Settings} onSelect={() => void navigate(paths.settings())}>
        {t('userMenu.settings')}
      </MenuItem>
      <MenuItem
        icon={LogOut}
        disabled={logout.isPending}
        onSelect={() => {
          logout.mutate(undefined, {
            onSettled: () => {
              void navigate(paths.login(), { replace: true });
            },
          });
        }}
      >
        {logout.isPending ? t('userMenu.signingOut') : t('userMenu.signOut')}
      </MenuItem>
    </Menu>
  );
}

/** Phone navigation: a bottom tab bar within thumb reach. */
export function BottomNav({ user }: { user: User }) {
  const { t } = useTranslation('shell');
  return (
    <nav aria-label={t('nav.label')} className={styles.bottomNav}>
      <ul>
        {navItemsFor(user.role)
          .filter((item) => item.mobile)
          .map((item) => (
            <li key={item.key}>
              <NavLink
                to={item.to}
                end={item.key === 'home'}
                className={({ isActive }) => cx(styles.bottomLink, isActive && styles.active)}
              >
                <item.icon aria-hidden="true" />
                <span>{t(`nav.${item.key}`)}</span>
              </NavLink>
            </li>
          ))}
      </ul>
    </nav>
  );
}
