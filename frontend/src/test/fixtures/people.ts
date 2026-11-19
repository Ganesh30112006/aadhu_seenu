import type { Device, Subject, User } from '@/api/types';

export interface MockUser extends User {
  /** Mock-mode only. Documented in README so the app can be explored without a backend. */
  password: string;
}

export const USER_IDS = {
  priya: '0b6c1d2e-1a2b-4c3d-8e4f-000000000001',
  venkat: '0b6c1d2e-1a2b-4c3d-8e4f-000000000002',
  anitha: '0b6c1d2e-1a2b-4c3d-8e4f-000000000003',
  arjun: '0b6c1d2e-1a2b-4c3d-8e4f-000000000004',
  meena: '0b6c1d2e-1a2b-4c3d-8e4f-000000000005',
  sravya: '0b6c1d2e-1a2b-4c3d-8e4f-000000000006',
} as const;

export const MOCK_USERS: readonly MockUser[] = [
  {
    id: USER_IDS.priya,
    email: 'priya.raghavan@college.example',
    full_name: 'Dr. Priya Raghavan',
    role: 'lecturer',
    active: true,
    password: 'lecturer-demo',
  },
  {
    id: USER_IDS.venkat,
    email: 'venkat.reddy@college.example',
    full_name: 'Prof. Venkat Reddy',
    role: 'lecturer',
    active: true,
    password: 'lecturer-demo',
  },
  {
    id: USER_IDS.anitha,
    email: 'anitha.kumari@college.example',
    full_name: 'Dr. Anitha Kumari',
    role: 'lecturer',
    active: true,
    password: 'lecturer-demo',
  },
  {
    id: USER_IDS.arjun,
    email: 'arjun.kumar@college.example',
    full_name: 'Arjun Kumar',
    role: 'student',
    active: true,
    password: 'student-demo',
  },
  {
    id: USER_IDS.sravya,
    email: 'sravya.n@college.example',
    full_name: 'Sravya Nallapaneni',
    role: 'student',
    active: false,
    password: 'student-demo',
  },
  {
    id: USER_IDS.meena,
    email: 'meena.iyer@college.example',
    full_name: 'Meena Iyer',
    role: 'admin',
    active: true,
    password: 'admin-demo',
  },
];

export const SUBJECT_IDS = {
  os: '5d0e7c1a-2b3c-4d5e-9f60-000000000501',
  cn: '5d0e7c1a-2b3c-4d5e-9f60-000000000502',
  dbms: '5d0e7c1a-2b3c-4d5e-9f60-000000000503',
  toc: '5d0e7c1a-2b3c-4d5e-9f60-000000000504',
} as const;

export const MOCK_SUBJECTS: readonly Subject[] = [
  { id: SUBJECT_IDS.os, code: 'CS501', name: 'Operating Systems' },
  { id: SUBJECT_IDS.cn, code: 'CS502', name: 'Computer Networks' },
  { id: SUBJECT_IDS.dbms, code: 'CS503', name: 'Database Management Systems' },
  { id: SUBJECT_IDS.toc, code: 'CS504', name: 'Theory of Computation' },
];

export const DEVICE_IDS = {
  room204: '9a8b7c6d-5e4f-4a3b-8c2d-000000000204',
  room310: '9a8b7c6d-5e4f-4a3b-8c2d-000000000310',
  seminar: '9a8b7c6d-5e4f-4a3b-8c2d-000000000999',
} as const;

export interface MockDevice extends Device {
  /** Lecturers who may use this device (backend-side visibility rule, not part of the API). */
  assignedTo: string[];
}

export function buildDevices(now: number, liveLectureId: string): MockDevice[] {
  const iso = (msAgo: number): string => new Date(now - msAgo).toISOString();
  return [
    {
      id: DEVICE_IDS.room204,
      name: 'Desk mic · Room 204',
      room: 'Block A, Room 204',
      serial: '24A160C3F1B8',
      firmware_version: '1.4.2',
      online: true,
      wifi_rssi: -58,
      psram_buffer_pct: 0,
      flash_buffer_pct: 0,
      recording: false,
      last_seen_at: iso(4_000),
      current_lecture_id: null,
      lecturer_ids: [USER_IDS.priya],
      assignedTo: [USER_IDS.priya],
      paused: false,
      level_dbfs: -62,
      mic_ok: null,
      pending_chunks: 0,
      gain: 4,
      vad_enabled: true,
    },
    {
      id: DEVICE_IDS.room310,
      name: 'Desk mic · Room 310',
      room: 'Block B, Room 310',
      serial: '24A160C3E07C',
      firmware_version: '1.4.2',
      online: true,
      wifi_rssi: -71,
      psram_buffer_pct: 0,
      flash_buffer_pct: 0,
      recording: true,
      last_seen_at: iso(2_000),
      current_lecture_id: liveLectureId,
      lecturer_ids: [USER_IDS.venkat, USER_IDS.anitha],
      assignedTo: [USER_IDS.venkat, USER_IDS.anitha],
      paused: false,
      level_dbfs: -21,
      mic_ok: true,
      pending_chunks: 1,
      gain: 4,
      vad_enabled: true,
    },
    {
      id: DEVICE_IDS.seminar,
      name: 'Desk mic · Seminar Hall',
      room: 'Main Building, Seminar Hall',
      serial: '24A160C3D2A4',
      firmware_version: '1.3.9',
      online: false,
      wifi_rssi: null,
      psram_buffer_pct: 0,
      flash_buffer_pct: 12,
      recording: false,
      last_seen_at: iso(2 * 24 * 3_600_000),
      current_lecture_id: null,
      lecturer_ids: [USER_IDS.priya, USER_IDS.venkat, USER_IDS.anitha],
      assignedTo: [USER_IDS.priya, USER_IDS.venkat, USER_IDS.anitha],
      paused: false,
      level_dbfs: null,
      mic_ok: null,
      pending_chunks: 24,
      gain: 6,
      vad_enabled: false,
    },
  ];
}
