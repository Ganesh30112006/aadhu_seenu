import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { Device } from '@/api/types';
import { Button } from '@/components/Button';
import { Banner } from '@/components/Feedback';
import { Checkbox, Field, TextInput } from '@/components/Field';
import { Section } from '@/components/Page';
import { toast } from '@/components/Toast';
import { useUsers } from '@/features/admin/api';
import { useSetDeviceLecturers, useUpdateDevice } from './api';
import styles from './Devices.module.css';

/** Admin: rename/move the device and change its microphone settings. */
export function DeviceSettingsForm({ device }: { device: Device }) {
  const { t } = useTranslation('devices');
  const update = useUpdateDevice(device.id);
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(2, t('register.validation.name')).max(60),
        room: z.string().trim().min(1, t('register.validation.room')).max(60),
        gain: z
          .number(t('settings.gainInvalid'))
          .min(0.5, t('settings.gainInvalid'))
          .max(16, t('settings.gainInvalid')),
        vad_enabled: z.boolean(),
      }),
    [t],
  );
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    values: {
      name: device.name,
      room: device.room,
      gain: device.gain,
      vad_enabled: device.vad_enabled,
    },
    resetOptions: { keepDirtyValues: true },
  });
  const errors = form.formState.errors;
  return (
    <Section title={t('settings.heading')} headingId="device-settings">
      <form
        className={styles.formGrid}
        noValidate
        onSubmit={(e) =>
          void form.handleSubmit((values) => {
            update.mutate(values, {
              onSuccess: () => {
                toast.success(t('settings.saved'));
              },
            });
          })(e)
        }
      >
        {update.isError && (
          <Banner tone="danger" role="alert">
            {t('settings.error')}
          </Banner>
        )}
        <Field label={t('register.name')} error={errors.name?.message}>
          {(c) => <TextInput {...c} {...form.register('name')} />}
        </Field>
        <Field label={t('register.room')} error={errors.room?.message}>
          {(c) => <TextInput {...c} {...form.register('room')} />}
        </Field>
        <Field
          label={t('settings.gain')}
          hint={t('settings.gainHint')}
          error={errors.gain?.message}
        >
          {(c) => (
            <TextInput
              {...c}
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0.5"
              max="16"
              {...form.register('gain', { valueAsNumber: true })}
            />
          )}
        </Field>
        <Checkbox
          label={t('settings.vad')}
          hint={t('settings.vadHint')}
          {...form.register('vad_enabled')}
        />
        <p className={styles.muted}>{t('settings.appliedNote')}</p>
        <div>
          <Button type="submit" variant="primary" loading={update.isPending}>
            {t('settings.save')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** Admin: which lecturers may record with this device. */
export function DeviceLecturersForm({ device }: { device: Device }) {
  const { t } = useTranslation('devices');
  const users = useUsers();
  const save = useSetDeviceLecturers(device.id);
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const selected = chosen ?? new Set(device.lecturer_ids);
  const lecturers = (users.data ?? []).filter((u) => u.role === 'lecturer' && u.active);
  const toggle = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };
  return (
    <Section title={t('lecturers.heading')} headingId="device-lecturers">
      {users.isError ? (
        <Banner tone="danger" role="alert">
          {t('lecturers.loadError')}
        </Banner>
      ) : users.isPending ? (
        <p className={styles.muted}>{t('lecturers.loading')}</p>
      ) : lecturers.length === 0 ? (
        <p className={styles.muted}>{t('lecturers.none')}</p>
      ) : (
        <form
          className={styles.formGrid}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate([...selected], {
              onSuccess: () => {
                setChosen(null);
                toast.success(t('lecturers.saved'));
              },
            });
          }}
        >
          {save.isError && (
            <Banner tone="danger" role="alert">
              {t('lecturers.error')}
            </Banner>
          )}
          <fieldset className={styles.checkList}>
            <legend>{t('lecturers.legend')}</legend>
            {lecturers.map((u) => (
              <Checkbox
                key={u.id}
                label={u.full_name}
                hint={u.email}
                checked={selected.has(u.id)}
                onChange={() => {
                  toggle(u.id);
                }}
              />
            ))}
          </fieldset>
          <div>
            <Button type="submit" variant="primary" loading={save.isPending}>
              {t('lecturers.save')}
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}
