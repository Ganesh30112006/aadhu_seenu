import { http } from 'msw';
import { z } from 'zod';
import type {
  Device,
  SystemInfo,
  DeviceRegistered,
  SearchGroup,
  SearchResponse,
  Subject,
  User,
} from '@/api/types';
import { findMatches } from '@/lib/highlight';
import { getDb, publicDevice, publicUser } from '../db';
import { deviceStatusNow } from '../live/simulator';
import { segmentsFor } from './lectures';
import { API, body, csrfFailure, error, json, latency, param, requireUser } from './util';

const MAX_HITS_PER_LECTURE = 8;

/** UTF-16 index → Unicode code-point index (the API reports code points, like Python). */
function codePointLength(text: string): number {
  let count = 0;
  for (const _char of text) count += 1;
  return count;
}
const toCodePoint = (text: string, utf16: number): number => codePointLength(text.slice(0, utf16));

function devicesView() {
  return getDb().devices.map((d) => ({ ...publicDevice(d), ...deviceStatusNow(d.id) }));
}

export const searchHandlers = [
  http.get(`${API}/search`, async ({ request }) => {
    await latency(200, 500);
    const guard = requireUser();
    if (guard.denied) return guard.denied;
    const url = new URL(request.url);
    const q = url.searchParams.get('q')?.trim() ?? '';
    const subjectId = url.searchParams.get('subject_id');
    if (codePointLength(q) < 2) return error(422, 'query_too_short', 'Type at least 2 characters.');
    let total = 0;
    const groups: SearchGroup[] = [];
    for (const lecture of getDb().lectures) {
      if (subjectId !== null && lecture.subject?.id !== subjectId) continue;
      const hits = segmentsFor(lecture)
        .segments.map((s) => ({ s, ranges: findMatches(s.text, q) }))
        .filter((x) => x.ranges.length > 0);
      if (hits.length === 0) continue;
      total += hits.length;
      groups.push({
        lecture: {
          id: lecture.id,
          title: lecture.title,
          subject: lecture.subject,
          started_at: lecture.started_at,
        },
        hits: hits.slice(0, MAX_HITS_PER_LECTURE).map(({ s, ranges }) => ({
          segment_id: s.segment_id,
          start_ms: s.start_ms,
          text: s.text,
          language: s.language,
          highlights: ranges.map((r) => ({
            start: toCodePoint(s.text, r.start),
            end: toCodePoint(s.text, r.end),
          })),
        })),
      });
    }
    groups.sort((a, b) => b.hits.length - a.hits.length);
    return json<SearchResponse>({ query: q, total_hits: total, groups });
  }),
];

export const adminHandlers = [
  http.get(`${API}/subjects`, async () => {
    await latency(80, 200);
    const guard = requireUser();
    if (guard.denied) return guard.denied;
    return json<Subject[]>(getDb().subjects);
  }),

  http.post(`${API}/subjects`, async ({ request }) => {
    await latency();
    const guard = requireUser('admin');
    if (guard.denied) return guard.denied;
    const csrf = csrfFailure(request);
    if (csrf !== null) return csrf;
    const parsed = await body(
      request,
      z.object({ code: z.string().trim().min(2).max(16), name: z.string().trim().min(2).max(120) }),
    );
    if ('invalid' in parsed) return parsed.invalid;
    const code = parsed.data.code.toUpperCase();
    if (getDb().subjects.some((s) => s.code === code)) {
      return error(409, 'subject_exists', `A subject with code ${code} already exists.`);
    }
    const subject: Subject = { id: crypto.randomUUID(), code, name: parsed.data.name };
    getDb().subjects.push(subject);
    return json<Subject>(subject, 201);
  }),

  http.get(`${API}/devices`, async () => {
    await latency();
    const guard = requireUser('lecturer', 'admin');
    if (guard.denied) return guard.denied;
    const visible = getDb().devices.filter(
      (d) => guard.user.role === 'admin' || d.assignedTo.includes(guard.user.id),
    );
    const ids = new Set(visible.map((d) => d.id));
    return json<Device[]>(devicesView().filter((d) => ids.has(d.id)));
  }),

  http.get(`${API}/devices/:device_id`, async ({ params }) => {
    await latency();
    const guard = requireUser('lecturer', 'admin');
    if (guard.denied) return guard.denied;
    const device = devicesView().find((d) => d.id === param(params, 'device_id'));
    if (device === undefined) return error(404, 'device_not_found', 'This device does not exist.');
    return json<Device>(device);
  }),

  http.post(`${API}/devices`, async ({ request }) => {
    await latency();
    const guard = requireUser('admin');
    if (guard.denied) return guard.denied;
    const csrf = csrfFailure(request);
    if (csrf !== null) return csrf;
    const parsed = await body(
      request,
      z.object({
        name: z.string().trim().min(2).max(60),
        room: z.string().trim().min(1).max(60),
        serial: z.string().regex(/^[0-9A-F]{12}$/, 'Serial must be 12 hexadecimal characters'),
        lecturer_ids: z.array(z.string()).optional(),
      }),
    );
    if ('invalid' in parsed) return parsed.invalid;
    if (getDb().devices.some((d) => d.serial === parsed.data.serial)) {
      return error(409, 'device_exists', 'A device with this serial is already registered.');
    }
    const { lecturer_ids: _ids, ...fields } = parsed.data;
    const device = {
      id: crypto.randomUUID(),
      ...fields,
      firmware_version: 'unknown',
      online: false,
      wifi_rssi: null,
      psram_buffer_pct: 0,
      flash_buffer_pct: 0,
      recording: false,
      last_seen_at: null,
      current_lecture_id: null,
      lecturer_ids: parsed.data.lecturer_ids ?? [],
      assignedTo: parsed.data.lecturer_ids ?? [],
      paused: false,
      level_dbfs: null,
      mic_ok: null,
      pending_chunks: 0,
      gain: 4,
      vad_enabled: true,
    };
    getDb().devices.push(device);
    return json<DeviceRegistered>(
      { device: publicDevice(device), token: crypto.randomUUID().replaceAll('-', '') },
      201,
    );
  }),

  http.patch(`${API}/devices/:device_id`, async ({ params, request }) => {
    await latency();
    const guard = requireUser('admin');
    if (guard.denied) return guard.denied;
    const csrf = csrfFailure(request);
    if (csrf !== null) return csrf;
    const device = getDb().devices.find((d) => d.id === param(params, 'device_id'));
    if (device === undefined) return error(404, 'device_not_found', 'This device does not exist.');
    const parsed = await body(
      request,
      z.object({
        name: z.string().trim().min(2).max(60).optional(),
        room: z.string().trim().min(1).max(60).optional(),
        gain: z.number().min(0.5).max(16).optional(),
        vad_enabled: z.boolean().optional(),
      }),
    );
    if ('invalid' in parsed) return parsed.invalid;
    Object.assign(device, parsed.data);
    return json<Device>(devicesView().find((d) => d.id === device.id) ?? publicDevice(device));
  }),

  http.put(`${API}/devices/:device_id/lecturers`, async ({ params, request }) => {
    await latency();
    const guard = requireUser('admin');
    if (guard.denied) return guard.denied;
    const csrf = csrfFailure(request);
    if (csrf !== null) return csrf;
    const device = getDb().devices.find((d) => d.id === param(params, 'device_id'));
    if (device === undefined) return error(404, 'device_not_found', 'This device does not exist.');
    const parsed = await body(request, z.object({ lecturer_ids: z.array(z.string()) }));
    if ('invalid' in parsed) return parsed.invalid;
    device.lecturer_ids = [...new Set(parsed.data.lecturer_ids)];
    device.assignedTo = device.lecturer_ids;
    return json<Device>(devicesView().find((d) => d.id === device.id) ?? publicDevice(device));
  }),

  http.get(`${API}/system`, async () => {
    await latency();
    const guard = requireUser('admin');
    if (guard.denied) return guard.denied;
    return json<SystemInfo>({
      environment: 'demo',
      llm_model: 'anthropic.claude-sonnet (mock)',
      embedding_model: 'amazon.titan-embed-text-v2:0',
      asr_model: 'large-v3',
      asr_device: 'cpu/int8',
      prompt_version: 'v1',
      audio_retention_days: 90,
      device_gain_default: 4,
      device_vad_default: true,
    });
  }),

  http.get(`${API}/users`, async () => {
    await latency();
    const guard = requireUser('admin');
    if (guard.denied) return guard.denied;
    return json<User[]>(getDb().users.map(publicUser));
  }),

  http.post(`${API}/users`, async ({ request }) => {
    await latency();
    const guard = requireUser('admin');
    if (guard.denied) return guard.denied;
    const csrf = csrfFailure(request);
    if (csrf !== null) return csrf;
    const parsed = await body(
      request,
      z.object({
        email: z.email(),
        full_name: z.string().trim().min(1),
        role: z.enum(['lecturer', 'student', 'admin']),
        password: z.string().min(8),
      }),
    );
    if ('invalid' in parsed) return parsed.invalid;
    if (getDb().users.some((u) => u.email.toLowerCase() === parsed.data.email.toLowerCase())) {
      return error(409, 'user_exists', 'A user with this email already exists.');
    }
    const user = { id: crypto.randomUUID(), active: true, ...parsed.data };
    getDb().users.push(user);
    return json<User>(publicUser(user), 201);
  }),

  http.patch(`${API}/users/:user_id`, async ({ params, request }) => {
    await latency();
    const guard = requireUser('admin');
    if (guard.denied) return guard.denied;
    const csrf = csrfFailure(request);
    if (csrf !== null) return csrf;
    const user = getDb().users.find((u) => u.id === param(params, 'user_id'));
    if (user === undefined) return error(404, 'user_not_found', 'This user does not exist.');
    const parsed = await body(
      request,
      z.object({
        full_name: z.string().trim().min(1).optional(),
        role: z.enum(['lecturer', 'student', 'admin']).optional(),
        active: z.boolean().optional(),
      }),
    );
    if ('invalid' in parsed) return parsed.invalid;
    if (user.id === guard.user.id && parsed.data.active === false) {
      return error(409, 'cannot_disable_self', 'You cannot disable your own account.');
    }
    if (parsed.data.full_name !== undefined) user.full_name = parsed.data.full_name;
    if (parsed.data.role !== undefined) user.role = parsed.data.role;
    if (parsed.data.active !== undefined) user.active = parsed.data.active;
    return json<User>(publicUser(user));
  }),
];
