import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, request } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { Device, DeviceCreate, DeviceUpdate } from '@/api/types';

const REFRESH_MS = 15_000;

export const devicesQuery = queryOptions({
  queryKey: queryKeys.devices.all(),
  queryFn: ({ signal }) => request(api.GET('/devices', { signal })),
  refetchInterval: REFRESH_MS,
  refetchIntervalInBackground: false,
});

export function deviceQuery(deviceId: string) {
  return queryOptions({
    queryKey: queryKeys.devices.detail(deviceId),
    queryFn: ({ signal }) =>
      request(
        api.GET('/devices/{device_id}', { signal, params: { path: { device_id: deviceId } } }),
      ),
    refetchInterval: REFRESH_MS,
  });
}

export function useDevices(enabled = true) {
  return useQuery({ ...devicesQuery, enabled });
}

export function useDevice(deviceId: string) {
  return useQuery(deviceQuery(deviceId));
}

export function useRegisterDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DeviceCreate) => request(api.POST('/devices', { body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices.all() });
    },
  });
}

function useDeviceSaved() {
  const queryClient = useQueryClient();
  return (device: Device): void => {
    queryClient.setQueryData(queryKeys.devices.detail(device.id), device);
    void queryClient.invalidateQueries({ queryKey: queryKeys.devices.all(), exact: true });
  };
}

export function useUpdateDevice(deviceId: string) {
  const saved = useDeviceSaved();
  return useMutation({
    mutationFn: (body: DeviceUpdate) =>
      request(
        api.PATCH('/devices/{device_id}', { params: { path: { device_id: deviceId } }, body }),
      ),
    onSuccess: saved,
  });
}

export function useSetDeviceLecturers(deviceId: string) {
  const saved = useDeviceSaved();
  return useMutation({
    mutationFn: (lecturerIds: string[]) =>
      request(
        api.PUT('/devices/{device_id}/lecturers', {
          params: { path: { device_id: deviceId } },
          body: { lecturer_ids: lecturerIds },
        }),
      ),
    onSuccess: saved,
  });
}

/** Wi-Fi quality from RSSI (dBm), matching the bars on the device's OLED. */
export function signalLevel(rssi: number | null): 'excellent' | 'good' | 'fair' | 'weak' | 'none' {
  if (rssi === null) return 'none';
  if (rssi >= -55) return 'excellent';
  if (rssi >= -65) return 'good';
  if (rssi >= -75) return 'fair';
  return 'weak';
}
