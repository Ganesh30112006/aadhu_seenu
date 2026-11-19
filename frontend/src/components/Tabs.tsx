import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import styles from './Tabs.module.css';

interface TabsProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  label: string;
  tabs: readonly { value: T; label: string }[];
  children: ReactNode;
}

/**
 * Radix Tabs (arrow keys move between tabs, Home/End jump). The active tab is controlled from
 * the URL by the caller; only the active panel is rendered (`children`).
 */
export function Tabs<T extends string>({
  value,
  onValueChange,
  label,
  tabs,
  children,
}: TabsProps<T>) {
  return (
    <RadixTabs.Root
      value={value}
      onValueChange={(next) => {
        const match = tabs.find((tab) => tab.value === next);
        if (match !== undefined) onValueChange(match.value);
      }}
      activationMode="manual"
    >
      <RadixTabs.List className={styles.list} aria-label={label}>
        {tabs.map((tab) => (
          <RadixTabs.Trigger key={tab.value} value={tab.value} className={styles.trigger}>
            {tab.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      <RadixTabs.Content value={value} className={styles.panel}>
        {children}
      </RadixTabs.Content>
    </RadixTabs.Root>
  );
}
