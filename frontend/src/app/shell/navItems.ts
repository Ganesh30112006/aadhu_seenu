import {
  BookMarked,
  Cpu,
  House,
  LibraryBig,
  Search,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/api/types';
import { paths } from '../paths';

export type NavKey = 'home' | 'library' | 'search' | 'devices' | 'subjects' | 'users' | 'settings';

export interface NavItem {
  key: NavKey;
  to: string;
  icon: LucideIcon;
  roles: readonly Role[];
  /** Shown in the phone bottom bar (max 5 items). */
  mobile: boolean;
}

const ALL: readonly Role[] = ['lecturer', 'student', 'admin'];

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'home', to: paths.home(), icon: House, roles: ['lecturer', 'student'], mobile: true },
  { key: 'library', to: paths.library(), icon: LibraryBig, roles: ALL, mobile: true },
  { key: 'search', to: paths.search(), icon: Search, roles: ALL, mobile: true },
  { key: 'devices', to: paths.devices(), icon: Cpu, roles: ['lecturer', 'admin'], mobile: true },
  { key: 'users', to: paths.adminUsers(), icon: Users, roles: ['admin'], mobile: false },
  { key: 'subjects', to: paths.adminSubjects(), icon: BookMarked, roles: ['admin'], mobile: false },
  { key: 'settings', to: paths.settings(), icon: Settings, roles: ALL, mobile: true },
];

export function navItemsFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
