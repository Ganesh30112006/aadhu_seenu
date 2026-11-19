import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import styles from './Overlay.module.css';

/**
 * Supplementary hint on hover/focus. Never put essential information only in a tooltip:
 * touch users can't hover.
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <RadixTooltip.Root delayDuration={300}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className={styles.tooltip} sideOffset={6}>
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export const TooltipProvider = RadixTooltip.Provider;
