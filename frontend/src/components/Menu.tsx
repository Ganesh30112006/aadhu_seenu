import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './Overlay.module.css';

/** Styled Radix DropdownMenu: full keyboard support (arrows, Home/End, type-ahead, Esc). */
export function Menu({
  trigger,
  children,
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  label?: string;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={styles.menu}
          align="end"
          sideOffset={6}
          {...(label !== undefined && { 'aria-label': label })}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

interface MenuItemProps {
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  children: ReactNode;
}

export function MenuItem({ icon: Icon, onSelect, disabled = false, children }: MenuItemProps) {
  return (
    <DropdownMenu.Item className={styles.menuItem} onSelect={onSelect} disabled={disabled}>
      {Icon !== undefined && <Icon aria-hidden="true" />}
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className={styles.menuLabel}>{children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className={styles.menuSeparator} />;
}
