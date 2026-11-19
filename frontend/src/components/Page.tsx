import type { ReactNode } from 'react';
import type { LanguageCode } from '@/lib/lang';
import { languageTag } from '@/lib/lang';
import { cx } from '@/lib/cx';
import styles from './Page.module.css';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}

/** The page's single <h1>. Route components use this so heading order stays correct. */
export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        {eyebrow !== undefined && <div className={styles.eyebrow}>{eyebrow}</div>}
        <h1 className={styles.title}>{title}</h1>
        {description !== undefined && <p className={styles.description}>{description}</p>}
      </div>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  children,
  actions,
  className,
  headingId,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string | undefined;
  headingId?: string;
}) {
  return (
    <section className={cx(styles.section, className)} aria-labelledby={headingId}>
      <div className={styles.sectionHeader}>
        <h2 id={headingId} className={styles.sectionTitle}>
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** "EN" / "TE" / "HI" tag; the full language name is exposed to assistive tech. */
export function LanguageTag({ code, name }: { code: LanguageCode; name: string }) {
  return (
    <abbr className={styles.langTag} title={name}>
      <span aria-hidden="true">{languageTag(code)}</span>
      <span className="visually-hidden">{name}</span>
    </abbr>
  );
}
