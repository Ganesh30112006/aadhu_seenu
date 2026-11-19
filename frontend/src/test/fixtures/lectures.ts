import type { Lecture, LectureStatus, TranscriptGap, TranscriptSegment } from '@/api/types';
import { DEVICE_IDS, MOCK_SUBJECTS, SUBJECT_IDS, USER_IDS } from './people';

const LECTURER_IDS: Record<string, string> = {
  'Dr. Priya Raghavan': USER_IDS.priya,
  'Prof. Venkat Reddy': USER_IDS.venkat,
  'Dr. Anitha Kumari': USER_IDS.anitha,
};
import { buildTranscript } from './transcript';

export const LECTURE_IDS = {
  scheduling: 'c1a5e0de-7f3a-4b2c-9d10-000000000001',
  schedulingLive: 'c1a5e0de-7f3a-4b2c-9d10-000000000002',
  semaphores: 'c1a5e0de-7f3a-4b2c-9d10-000000000003',
  threads: 'c1a5e0de-7f3a-4b2c-9d10-000000000004',
  congestion: 'c1a5e0de-7f3a-4b2c-9d10-000000000005',
  subnetting: 'c1a5e0de-7f3a-4b2c-9d10-000000000006',
  normalization: 'c1a5e0de-7f3a-4b2c-9d10-000000000007',
  transactions: 'c1a5e0de-7f3a-4b2c-9d10-000000000008',
  pumping: 'c1a5e0de-7f3a-4b2c-9d10-000000000009',
  deadlocks: 'c1a5e0de-7f3a-4b2c-9d10-000000000010',
  routing: 'c1a5e0de-7f3a-4b2c-9d10-000000000011',
  btree: 'c1a5e0de-7f3a-4b2c-9d10-000000000012',
} as const;

/** How long ago (at mock start) the live Section B lecture began. */
export const LIVE_LECTURE_ELAPSED_MS = 6 * 60_000;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Lang = 'en' | 'te' | 'hi';
const en = (text: string): [string, Lang, string | null] => [text, 'en', null];

/** Short transcript excerpts for lectures other than the fully transcribed fixture lecture. */
const EXCERPTS: Record<string, [string, Lang, string | null][]> = {
  [LECTURE_IDS.semaphores]: [
    en('Last class we saw the critical section problem. Today we solve it with semaphores.'),
    en(
      'A semaphore S is an integer variable accessed only through two atomic operations, wait and signal.',
    ),
    en('wait decrements S and blocks the process if the value becomes negative.'),
    [
      'ఇది binary semaphore, దీన్ని mutex lock లాగా వాడతాం.',
      'te',
      'idi binary semaphore, deenni mutex lock laagaa vaadataam.',
    ],
    en('signal increments S and wakes up one waiting process, if any.'),
    en('Next, the producer–consumer problem with a bounded buffer of size n.'),
  ],
  [LECTURE_IDS.threads]: [
    en(
      'A thread is a basic unit of CPU utilisation: a thread ID, a program counter, registers and a stack.',
    ),
    en('Threads of the same process share code, data and open files.'),
    en('We have three multithreading models: many-to-one, one-to-one and many-to-many.'),
    en('Linux and Windows both use the one-to-one model.'),
    en('In many-to-one, one blocking system call blocks the entire process.'),
  ],
  [LECTURE_IDS.congestion]: [
    en('TCP congestion control keeps a sender from overwhelming the network.'),
    en('The congestion window, cwnd, limits the amount of unacknowledged data in flight.'),
    en('In slow start, cwnd doubles every round-trip time until it reaches the threshold.'),
    [
      'Threshold के बाद congestion avoidance में cwnd linearly बढ़ता है।',
      'hi',
      'threshold ke baad congestion avoidance mein cwnd linearly badhta hai.',
    ],
    en('On three duplicate ACKs, TCP Reno halves the window: that is fast recovery.'),
    en('A timeout is treated as more serious, and cwnd drops back to one segment.'),
  ],
  [LECTURE_IDS.subnetting]: [
    en('An IPv4 address has 32 bits, written as four decimal octets.'),
    en('The subnet mask tells us which bits are the network part and which are the host part.'),
    en('With a slash 26 mask we get four subnets of 64 addresses each from a slash 24 block.'),
    en(
      'Two addresses in every subnet are reserved: the network address and the broadcast address.',
    ),
    en('So each slash 26 subnet has 62 usable host addresses.'),
  ],
  [LECTURE_IDS.normalization]: [
    en('Normalization removes redundancy and update anomalies from relational schemas.'),
    [
      'First normal form का मतलब है हर attribute atomic होना चाहिए।',
      'hi',
      'first normal form ka matlab hai har attribute atomic hona chahiye.',
    ],
    en('Second normal form removes partial dependencies on a composite key.'),
    en('Third normal form removes transitive dependencies.'),
    en('BCNF requires that every determinant is a candidate key.'),
  ],
  [LECTURE_IDS.transactions]: [
    en('A transaction is a unit of program execution that accesses and possibly updates data.'),
    en('ACID stands for atomicity, consistency, isolation and durability.'),
    en('Atomicity means all operations of the transaction happen, or none of them do.'),
    en('Durability is usually provided by the recovery system using a write-ahead log.'),
    en('A schedule is serializable if it is equivalent to some serial schedule.'),
  ],
  [LECTURE_IDS.pumping]: [
    en('The pumping lemma gives a property every regular language must satisfy.'),
    en('If L is regular, there is a pumping length p.'),
    en(
      'Any string s in L of length at least p can be split as x y z with y not empty and x y of length at most p.',
    ),
    [
      'అప్పుడు x y to the power i z కూడా L లోనే ఉండాలి, ప్రతి i కి.',
      'te',
      'appudu x y to the power i z koodaa L lone undaali, prati i ki.',
    ],
    en(
      'We use it by contradiction to prove that a language like a to the n b to the n is not regular.',
    ),
  ],
  [LECTURE_IDS.routing]: [
    en('Routing algorithms decide the path packets take through the network.'),
    en('Link-state routing floods link costs to every router, which then runs Dijkstra.'),
    en(
      'Distance-vector routing exchanges distance tables only with neighbours, using Bellman–Ford.',
    ),
    en('Distance vector suffers from the count-to-infinity problem.'),
  ],
  [LECTURE_IDS.btree]: [
    en('Today we look at indexing with B plus trees.'),
    en('All records are stored in the leaf level, and leaves are linked for range scans.'),
  ],
};

export interface FixtureLectures {
  lectures: Lecture[];
  transcripts: Map<string, { segments: TranscriptSegment[]; gaps: TranscriptGap[] }>;
  sectionStarts: Record<string, number>;
}

function excerptSegments(id: string): TranscriptSegment[] {
  return (EXCERPTS[id] ?? []).map(([text, language, transliteration], index) => ({
    segment_id: `${id.slice(-4)}-seg-${String(index + 1).padStart(3, '0')}`,
    start_ms: 5_000 + index * 7_500,
    end_ms: 5_000 + index * 7_500 + 6_500,
    text,
    language,
    transliteration,
    confidence: language === 'en' ? 0.93 : 0.81,
    source: 'live',
    edited: false,
  }));
}

export function buildLectures(now: number): FixtureLectures {
  const subject = (id: string) => {
    const found = MOCK_SUBJECTS.find((s) => s.id === id);
    if (found === undefined) throw new Error(`unknown subject ${id}`);
    return found;
  };
  const make = (
    id: string,
    title: string,
    subjectId: string,
    lecturer: string,
    status: LectureStatus,
    startedAgoMs: number | null,
    durationMs: number,
    languages: Lang[],
    notes: { ready: boolean; published: boolean },
    deviceId: string | null = null,
  ): Lecture => {
    const startedAt = startedAgoMs === null ? null : new Date(now - startedAgoMs).toISOString();
    const ended =
      startedAgoMs !== null && status !== 'recording' && status !== 'scheduled'
        ? new Date(now - startedAgoMs + durationMs).toISOString()
        : null;
    return {
      id,
      title,
      subject: subject(subjectId),
      lecturer_id: LECTURER_IDS[lecturer] ?? null,
      lecturer_name: lecturer,
      status,
      language: languages[0] ?? 'en',
      languages_detected: languages,
      started_at: startedAt,
      ended_at: ended,
      duration_ms: durationMs,
      notes_ready: notes.ready,
      notes_published: notes.published,
      device_id: deviceId,
      consent_confirmed: true,
      created_at: new Date(now - (startedAgoMs ?? 0) - HOUR).toISOString(),
      paused: false,
      audio_available: true,
    };
  };

  const main = buildTranscript();
  const L = LECTURE_IDS;
  const S = SUBJECT_IDS;
  const lectures: Lecture[] = [
    make(
      L.schedulingLive,
      'CPU Scheduling Algorithms (Section B)',
      S.os,
      'Prof. Venkat Reddy',
      'recording',
      LIVE_LECTURE_ELAPSED_MS,
      LIVE_LECTURE_ELAPSED_MS,
      ['en', 'te', 'hi'],
      { ready: false, published: false },
      DEVICE_IDS.room310,
    ),
    make(
      L.deadlocks,
      'Deadlocks: Detection and Avoidance',
      S.os,
      'Dr. Priya Raghavan',
      'scheduled',
      null,
      0,
      ['en'],
      { ready: false, published: false },
      DEVICE_IDS.room204,
    ),
    make(
      L.routing,
      'Routing Algorithms',
      S.cn,
      'Dr. Anitha Kumari',
      'processing',
      70 * 60_000,
      2_880_000,
      ['en'],
      { ready: false, published: false },
      DEVICE_IDS.room310,
    ),
    make(
      L.scheduling,
      'CPU Scheduling Algorithms',
      S.os,
      'Dr. Priya Raghavan',
      'completed',
      2 * DAY + 3 * HOUR,
      main.durationMs,
      ['en', 'te', 'hi'],
      { ready: true, published: true },
      DEVICE_IDS.room204,
    ),
    make(
      L.congestion,
      'TCP Congestion Control',
      S.cn,
      'Dr. Anitha Kumari',
      'completed',
      3 * DAY,
      2_940_000,
      ['en', 'hi'],
      { ready: false, published: false },
      DEVICE_IDS.room310,
    ),
    make(
      L.normalization,
      'Normalization: 1NF to BCNF',
      S.dbms,
      'Prof. Venkat Reddy',
      'completed',
      4 * DAY,
      3_060_000,
      ['en', 'hi'],
      { ready: false, published: false },
      DEVICE_IDS.room310,
    ),
    make(
      L.semaphores,
      'Process Synchronization with Semaphores',
      S.os,
      'Dr. Priya Raghavan',
      'completed',
      5 * DAY,
      2_820_000,
      ['en', 'te'],
      { ready: true, published: false },
      DEVICE_IDS.room204,
    ),
    make(
      L.pumping,
      'Pumping Lemma for Regular Languages',
      S.toc,
      'Prof. Venkat Reddy',
      'completed',
      6 * DAY,
      2_700_000,
      ['en', 'te'],
      { ready: false, published: false },
      DEVICE_IDS.room310,
    ),
    make(
      L.btree,
      'Indexing with B+ Trees',
      S.dbms,
      'Prof. Venkat Reddy',
      'failed',
      8 * DAY,
      840_000,
      ['en'],
      { ready: false, published: false },
      DEVICE_IDS.seminar,
    ),
    make(
      L.threads,
      'Threads and Multithreading Models',
      S.os,
      'Dr. Priya Raghavan',
      'completed',
      9 * DAY,
      2_910_000,
      ['en'],
      { ready: false, published: false },
      DEVICE_IDS.room204,
    ),
    make(
      L.subnetting,
      'IPv4 Addressing and Subnetting',
      S.cn,
      'Dr. Anitha Kumari',
      'completed',
      10 * DAY,
      3_000_000,
      ['en'],
      { ready: false, published: false },
      DEVICE_IDS.seminar,
    ),
    make(
      L.transactions,
      'Transactions and ACID Properties',
      S.dbms,
      'Prof. Venkat Reddy',
      'completed',
      11 * DAY,
      2_985_000,
      ['en'],
      { ready: false, published: false },
      DEVICE_IDS.room310,
    ),
  ];

  const transcripts = new Map<string, { segments: TranscriptSegment[]; gaps: TranscriptGap[] }>();
  transcripts.set(L.scheduling, { segments: main.segments, gaps: [] });
  transcripts.set(L.schedulingLive, { segments: [], gaps: [] });
  transcripts.set(L.deadlocks, { segments: [], gaps: [] });
  for (const id of Object.keys(EXCERPTS)) {
    transcripts.set(id, { segments: excerptSegments(id), gaps: [] });
  }
  // The seminar-hall device overflowed its buffer during this lecture: audio was lost for good.
  transcripts.set(L.subnetting, {
    segments: excerptSegments(L.subnetting),
    gaps: [{ gap_id: 'gap-subnet-1', start_ms: 43_000, end_ms: 283_000 }],
  });

  return { lectures, transcripts, sectionStarts: main.sectionStarts };
}
