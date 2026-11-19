import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Download, FileText, FileType, Hash } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mutationKeys } from '@/api/queryKeys';
import type { ExportFormat } from '@/api/types';
import { Button } from '@/components/Button';
import { Menu, MenuItem } from '@/components/Menu';
import { toast } from '@/components/Toast';
import { downloadWithProgress, saveBlob } from '@/lib/download';
import { env } from '@/lib/env';
import styles from './Detail.module.css';

const FORMATS: readonly { format: ExportFormat; icon: typeof FileText }[] = [
  { format: 'pdf', icon: FileType },
  { format: 'txt', icon: FileText },
  { format: 'md', icon: Hash },
];

export function ExportMenu({ lectureId }: { lectureId: string }) {
  const { t } = useTranslation('lectures');
  const [progress, setProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const exporter = useMutation({
    mutationKey: mutationKeys.export(lectureId),
    mutationFn: (format: ExportFormat) =>
      downloadWithProgress(
        `${env.apiBaseUrl}/lectures/${encodeURIComponent(lectureId)}/export?format=${format}`,
        (loaded, total) => {
          setProgress({ loaded, total });
        },
      ),
    onSuccess: (file) => {
      saveBlob(file);
      toast.success(t('export.done', { filename: file.filename }));
    },
    onError: () => {
      toast.error(t('export.failed'));
    },
    onSettled: () => {
      setProgress(null);
    },
  });
  const format = exporter.variables ?? 'pdf';
  const pct = progress?.total ? Math.round((progress.loaded / progress.total) * 100) : null;

  return (
    <div className={styles.export}>
      <Menu
        label={t('export.label')}
        trigger={
          <Button icon={Download} loading={exporter.isPending} aria-label={t('export.label')}>
            {t('export.button')}
            <ChevronDown aria-hidden="true" />
          </Button>
        }
      >
        {FORMATS.map(({ format: f, icon }) => (
          <MenuItem
            key={f}
            icon={icon}
            disabled={exporter.isPending}
            onSelect={() => {
              exporter.mutate(f);
            }}
          >
            {t(`export.${f}`)}
          </MenuItem>
        ))}
      </Menu>
      {exporter.isPending && (
        <div className={styles.progress} role="status">
          <progress max={100} value={pct ?? undefined} aria-label={t('export.label')} />
          <span>
            {pct === null
              ? t('export.progressUnknown', { format: format.toUpperCase() })
              : t('export.progress', { format: format.toUpperCase(), pct })}
          </span>
        </div>
      )}
    </div>
  );
}
