import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { isApiError } from '@/api/errors';
import type { Notes } from '@/api/types';
import { Button, IconButton } from '@/components/Button';
import { Banner } from '@/components/Feedback';
import { Field, TextArea, TextInput } from '@/components/Field';
import { toast } from '@/components/Toast';
import { useNotesMutations } from '../api';
import styles from '../Study.module.css';
import { MarkdownBody } from './NotesView';

function useSchema() {
  const { t } = useTranslation('study');
  return useMemo(
    () =>
      z.object({
        sections: z
          .array(
            z.object({
              id: z.string().nullable(),
              heading: z
                .string()
                .trim()
                .min(1, t('editor.validation.heading'))
                .max(160, t('editor.validation.headingLong')),
              body_markdown: z.string().max(20_000, t('editor.validation.bodyLong')),
            }),
          )
          .min(1, t('editor.validation.atLeastOne')),
      }),
    [t],
  );
}

type Values = z.infer<ReturnType<typeof useSchema>>;

/** Section-by-section Markdown editor with live preview; saves with optimistic concurrency. */
export function NotesEditor({
  lectureId,
  notes,
  onDone,
}: {
  lectureId: string;
  notes: Notes;
  onDone: () => void;
}) {
  const { t } = useTranslation('study');
  const { save } = useNotesMutations(lectureId);
  const schema = useSchema();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      sections: notes.sections.map((s) => ({
        id: s.id,
        heading: s.heading,
        body_markdown: s.body_markdown,
      })),
    },
  });
  const { fields, append, remove, swap } = useFieldArray({
    control: form.control,
    name: 'sections',
  });
  const watched = useWatch({ control: form.control, name: 'sections' });
  const errors = form.formState.errors.sections;
  const conflict = save.isError && isApiError(save.error) && save.error.isConflict;

  const submit = (values: Values): void => {
    save.mutate(
      { version: notes.version, sections: values.sections },
      {
        onSuccess: () => {
          toast.success(t('editor.saved'));
          onDone();
        },
      },
    );
  };

  return (
    <form
      noValidate
      onSubmit={(e) => void form.handleSubmit(submit)(e)}
      aria-label={t('editor.title')}
    >
      {save.isError && (
        <Banner tone="danger" role="alert">
          {conflict ? t('editor.conflict') : t('editor.errors.generic')}
        </Banner>
      )}
      {errors?.root?.message !== undefined && (
        <Banner tone="danger" role="alert">
          {errors.root.message}
        </Banner>
      )}
      {fields.map((field, index) => (
        <fieldset key={field.id} className={styles.editorSection}>
          <div className={styles.editorHead}>
            <h3>{t('editor.section', { n: index + 1 })}</h3>
            <IconButton
              icon={ArrowUp}
              label={t('editor.moveUp', { n: index + 1 })}
              disabled={index === 0}
              onClick={() => {
                swap(index, index - 1);
              }}
            />
            <IconButton
              icon={ArrowDown}
              label={t('editor.moveDown', { n: index + 1 })}
              disabled={index === fields.length - 1}
              onClick={() => {
                swap(index, index + 1);
              }}
            />
            <IconButton
              icon={Trash2}
              label={t('editor.removeSection', { n: index + 1 })}
              disabled={fields.length === 1}
              onClick={() => {
                remove(index);
              }}
            />
          </div>
          <Field label={t('editor.heading')} error={errors?.[index]?.heading?.message}>
            {(c) => <TextInput {...c} {...form.register(`sections.${index}.heading`)} />}
          </Field>
          <Field
            label={t('editor.body')}
            hint={t('editor.bodyHint')}
            error={errors?.[index]?.body_markdown?.message}
          >
            {(c) => (
              <TextArea {...c} rows={8} {...form.register(`sections.${index}.body_markdown`)} />
            )}
          </Field>
          <div className={styles.preview} aria-label={t('editor.preview')}>
            <MarkdownBody markdown={watched[index]?.body_markdown ?? ''} />
          </div>
        </fieldset>
      ))}
      <div className={styles.toolbar}>
        <Button
          icon={Plus}
          onClick={() => {
            append({ id: null, heading: '', body_markdown: '' });
          }}
        >
          {t('editor.addSection')}
        </Button>
        <span className={styles.toolbarSpacer} />
        <Button onClick={onDone}>{t('editor.discard')}</Button>
        <Button type="submit" variant="primary" icon={Save} loading={save.isPending}>
          {save.isPending ? t('editor.saving') : t('editor.save')}
        </Button>
      </div>
    </form>
  );
}
