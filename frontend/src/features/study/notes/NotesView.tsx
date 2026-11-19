import { Link } from 'react-router';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import type { NoteSection } from '@/api/types';
import { paths } from '@/app/paths';
import { formatOffset } from '@/lib/time';
import styles from '../Study.module.css';

/**
 * Safe Markdown (D2): react-markdown builds React elements and never uses innerHTML; raw HTML in
 * lecturer edits or model output is dropped (skipHtml), and unsafe URLs are filtered by default.
 */
export function MarkdownBody({ markdown }: { markdown: string }) {
  return (
    <div className="prose">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml>
        {markdown}
      </Markdown>
    </div>
  );
}

export function sectionAnchor(section: NoteSection): string {
  return `section-${section.id}`;
}

export function NotesToc({ sections }: { sections: readonly NoteSection[] }) {
  const { t } = useTranslation('study');
  return (
    <nav aria-labelledby="notes-toc" className={styles.toc}>
      <h2 id="notes-toc" className={styles.tocTitle}>
        {t('notes.contents')}
      </h2>
      <ol>
        {sections.map((section) => (
          <li key={section.id}>
            <a href={`#${sectionAnchor(section)}`}>{section.heading}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function NotesView({
  lectureId,
  sections,
}: {
  lectureId: string;
  sections: readonly NoteSection[];
}) {
  const { t } = useTranslation('study');
  return (
    <div>
      {sections.map((section) => (
        <section
          key={section.id}
          id={sectionAnchor(section)}
          className={styles.section}
          aria-labelledby={`${sectionAnchor(section)}-h`}
        >
          <h2 id={`${sectionAnchor(section)}-h`} className={styles.sectionHeading}>
            {section.heading}
          </h2>
          {section.start_ms !== null && (
            <Link
              className={styles.sourceLink}
              to={paths.transcriptAt(lectureId, section.start_ms)}
            >
              {t('notes.jumpToTranscript', { time: formatOffset(section.start_ms) })}
            </Link>
          )}
          <MarkdownBody markdown={section.body_markdown} />
        </section>
      ))}
    </div>
  );
}
