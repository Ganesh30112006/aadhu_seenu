import type {
  FlashcardSet,
  RevisionNotes,
  KeyTerm,
  Notes,
  QuestionSet,
  Summary,
  TranscriptSegment,
} from '@/api/types';
import { LECTURE_IDS } from './lectures';
import { average, fcfs, sjf, srtf, type Proc } from './scheduling';
import { firstMention } from './transcript';

const SET_A: Proc[] = [
  { id: 'P1', arrival: 0, burst: 8 },
  { id: 'P2', arrival: 1, burst: 4 },
  { id: 'P3', arrival: 2, burst: 9 },
  { id: 'P4', arrival: 3, burst: 5 },
];
const avgWait = (schedule: ReturnType<typeof fcfs>): number =>
  average(schedule.results.map((r) => r.waiting));

export function buildSchedulingNotes(
  sectionStarts: Record<string, number>,
  updatedAt: string,
): Notes {
  const at = (id: string): number | null => sectionStarts[id] ?? null;
  return {
    lecture_id: LECTURE_IDS.scheduling,
    published: true,
    generation_status: 'ready',
    updated_at: updatedAt,
    version: 3,
    sections: [
      {
        id: 'n-intro',
        heading: 'Why CPU scheduling matters',
        start_ms: at('intro'),
        body_markdown: [
          'In a multiprogrammed system many processes are **ready**, but one core runs one process at a time.',
          '',
          '- The **short-term (CPU) scheduler** picks the next ready process.',
          '- The **dispatcher** hands it the CPU: context switch, switch to user mode, jump to the program counter.',
          '- **Dispatch latency** is the time the dispatcher takes; keep it small.',
          '',
          'Processes alternate between **CPU bursts** and **I/O bursts**. I/O-bound processes have many short bursts; CPU-bound processes have fewer, longer ones.',
        ].join('\n'),
      },
      {
        id: 'n-criteria',
        heading: 'Scheduling criteria',
        start_ms: at('criteria'),
        body_markdown: [
          '| Criterion | Meaning | Goal |',
          '|---|---|---|',
          '| CPU utilisation | Fraction of time the CPU is busy | Maximise |',
          '| Throughput | Processes completed per unit time | Maximise |',
          '| Turnaround time | Completion time − arrival time | Minimise |',
          '| Waiting time | Time spent in the ready queue (turnaround − burst) | Minimise |',
          '| Response time | Submission until first response | Minimise |',
          '',
          '**Non-preemptive:** a process keeps the CPU until it finishes or blocks. **Preemptive:** the OS may take the CPU away.',
        ].join('\n'),
      },
      {
        id: 'n-fcfs',
        heading: 'First Come, First Served (FCFS)',
        start_ms: at('fcfs'),
        body_markdown: [
          'A FIFO queue; non-preemptive; simple, but average waiting time is often long.',
          '',
          `Worked example (set A: P1 0/8, P2 1/4, P3 2/9, P4 3/5): average waiting time **${avgWait(fcfs(SET_A))} ms**.`,
          '',
          '**Convoy effect:** short processes queue behind one long CPU-bound process, lowering CPU and device utilisation.',
        ].join('\n'),
      },
      {
        id: 'n-sjf',
        heading: 'Shortest Job First and SRTF',
        start_ms: at('sjf'),
        body_markdown: [
          '- **SJF** runs the process with the smallest next CPU burst. It is *optimal* for average waiting time.',
          '- **SRTF** is preemptive SJF: a new arrival with a shorter burst than the remaining time preempts.',
          `- Set A: SJF **${avgWait(sjf(SET_A))} ms**, SRTF **${avgWait(srtf(SET_A))} ms** average waiting time.`,
          '',
          'The next burst is unknown, so it is predicted by **exponential averaging**:',
          '',
          '`τ(n+1) = α · t(n) + (1 − α) · τ(n)`, usually with α = ½.',
          '',
          'Long jobs can starve if short jobs keep arriving.',
        ].join('\n'),
      },
      {
        id: 'n-priority',
        heading: 'Priority scheduling, starvation and aging',
        start_ms: at('priority'),
        body_markdown: [
          'Each process has a priority number; the CPU goes to the highest priority (here, the **smallest number**). SJF is priority scheduling with the predicted burst as priority.',
          '',
          '- Priorities can be **internal** (memory needs, I/O-to-CPU ratio) or **external** (importance).',
          '- **Starvation:** a low-priority process may wait indefinitely.',
          '- **Aging:** gradually raise the priority of waiting processes, e.g. +1 every 15 minutes.',
        ].join('\n'),
      },
      {
        id: 'n-rr',
        heading: 'Round Robin and the time quantum',
        start_ms: at('rr'),
        body_markdown: [
          'FCFS with preemption: each process runs for at most one **time quantum** q, then goes to the tail of a circular ready queue.',
          '',
          '- With n processes, no process waits more than (n − 1) · q for its next turn.',
          '- Quantum too small → too many context switches. Too large → behaves like FCFS.',
          '- Rule of thumb: ~80% of CPU bursts should be shorter than q (typically 10–100 ms).',
          '- Higher average turnaround than SJF, but much better **response time**.',
        ].join('\n'),
      },
      {
        id: 'n-mlq',
        heading: 'Multilevel queues and feedback queues',
        start_ms: at('mlq'),
        body_markdown: [
          '**Multilevel queue:** separate queues (e.g. foreground RR, background FCFS), scheduled by fixed priority or time slicing. A process stays in its queue.',
          '',
          '**Multilevel feedback queue:** processes move between queues: heavy CPU users are demoted; long waiters are promoted (aging).',
          '',
          'Defined by: number of queues, algorithm per queue, and the promotion/demotion rules.',
        ].join('\n'),
      },
      {
        id: 'n-compare',
        heading: 'Comparison',
        start_ms: at('summary'),
        body_markdown: [
          '| Algorithm | Preemptive | Strength | Weakness |',
          '|---|---|---|---|',
          '| FCFS | No | Simple, fair by arrival | Convoy effect |',
          '| SJF | No | Minimum average waiting time | Needs burst prediction; starvation |',
          '| SRTF | Yes | Even lower waiting time | Prediction, frequent preemption |',
          '| Priority | Either | Expresses importance | Starvation (fix with aging) |',
          '| Round Robin | Yes | Good response time | Sensitive to quantum size |',
          '| MLFQ | Yes | Adapts to process behaviour | Complex to tune |',
        ].join('\n'),
      },
    ],
  };
}

export function buildSemaphoreNotes(updatedAt: string): Notes {
  return {
    lecture_id: LECTURE_IDS.semaphores,
    published: false,
    generation_status: 'ready',
    updated_at: updatedAt,
    version: 1,
    sections: [
      {
        id: 's-semaphore',
        heading: 'Semaphores',
        start_ms: 5_000,
        body_markdown:
          'A semaphore **S** is an integer accessed only through atomic `wait()` and `signal()`.\n\n- `wait`: decrement; block if negative.\n- `signal`: increment; wake one waiting process.\n- A **binary semaphore** behaves like a mutex lock.',
      },
      {
        id: 's-bounded',
        heading: 'Bounded-buffer producer–consumer',
        start_ms: 42_500,
        body_markdown:
          'Uses three semaphores: `mutex = 1`, `empty = n`, `full = 0`. The producer waits on `empty`, the consumer on `full`.',
      },
    ],
  };
}

export function buildSchedulingSummary(generatedAt: string): Summary {
  return {
    lecture_id: LECTURE_IDS.scheduling,
    generated_at: generatedAt,
    overview:
      'The lecture introduced CPU scheduling: how the short-term scheduler and dispatcher choose which ready process runs next, and how algorithms are compared using utilisation, throughput, turnaround, waiting and response time. It worked through FCFS, SJF, SRTF, priority scheduling, Round Robin and multilevel feedback queues on concrete process sets, computing Gantt charts and average times for each.',
    key_points: [
      'Waiting time = turnaround time − burst time; turnaround time = completion − arrival.',
      `FCFS is simple but suffers from the convoy effect (set A: ${avgWait(fcfs(SET_A))} ms average wait).`,
      `SJF is optimal for average waiting time (set A: ${avgWait(sjf(SET_A))} ms; SRTF: ${avgWait(srtf(SET_A))} ms) but needs burst prediction by exponential averaging.`,
      'Priority scheduling can starve low-priority processes; aging fixes this.',
      'Round Robin trades turnaround for response time; the quantum should exceed ~80% of CPU bursts.',
      'Multilevel feedback queues move processes between queues and are used by real operating systems.',
    ],
  };
}

const TERMS: [string, string, string][] = [
  [
    'CPU scheduler',
    'short-term scheduler',
    'The OS component that selects which ready process runs next on the CPU.',
  ],
  [
    'Dispatcher',
    'dispatcher',
    'Gives control of the CPU to the selected process: context switch, switch to user mode, jump to the program.',
  ],
  [
    'Dispatch latency',
    'dispatch latency',
    'Time taken by the dispatcher to stop one process and start another.',
  ],
  ['Turnaround time', 'turnaround time', 'Time from a process’s arrival to its completion.'],
  [
    'Waiting time',
    'waiting time',
    'Total time a process spends in the ready queue; turnaround minus burst.',
  ],
  ['Response time', 'response time', 'Time from submission until the process first gets the CPU.'],
  ['Convoy effect', 'convoy effect', 'Short processes waiting behind one long process under FCFS.'],
  [
    'Shortest Job First',
    'shortest job first',
    'Runs the process with the smallest next CPU burst; optimal average waiting time.',
  ],
  [
    'Exponential averaging',
    'exponential average',
    'Predicts the next burst as α·t(n) + (1 − α)·τ(n).',
  ],
  [
    'Starvation',
    'starvation',
    'A ready process waits indefinitely because others are always preferred.',
  ],
  ['Aging', 'aging', 'Gradually raising the priority of processes that wait a long time.'],
  ['Time quantum', 'time quantum', 'The fixed CPU time slice each process gets in Round Robin.'],
  [
    'Multilevel feedback queue',
    'multilevel feedback queue',
    'Several ready queues where processes move between queues based on behaviour.',
  ],
];

export function buildSchedulingKeyTerms(segments: readonly TranscriptSegment[]): KeyTerm[] {
  return TERMS.map(([term, search, definition], index) => ({
    id: `kt-${String(index + 1).padStart(2, '0')}`,
    term,
    definition,
    language: 'en',
    first_mentioned_ms: firstMention(segments, search),
  }));
}

export function buildSchedulingQuestions(segments: readonly TranscriptSegment[]): QuestionSet {
  const at = (needle: string): number | null => firstMention(segments, needle);
  const a = { fcfs: avgWait(fcfs(SET_A)), sjf: avgWait(sjf(SET_A)), srtf: avgWait(srtf(SET_A)) };
  return {
    lecture_id: LECTURE_IDS.scheduling,
    mcq: [
      {
        id: 'q1',
        prompt:
          'Which algorithm gives the minimum average waiting time for a given set of processes?',
        options: [
          'First Come, First Served',
          'Shortest Job First',
          'Round Robin',
          'Priority scheduling',
        ],
        correct_index: 1,
        explanation:
          'SJF is provably optimal for average waiting time, though it needs the next burst length.',
        source_ms: at('provably optimal'),
      },
      {
        id: 'q2',
        prompt: 'The convoy effect is most associated with which algorithm?',
        options: ['Round Robin', 'SRTF', 'FCFS', 'Multilevel feedback queue'],
        correct_index: 2,
        explanation: 'Under FCFS, short processes wait behind one long CPU-bound process.',
        source_ms: at('convoy effect'),
      },
      {
        id: 'q3',
        prompt: 'What technique prevents starvation in priority scheduling?',
        options: [
          'Aging',
          'Exponential averaging',
          'Increasing the time quantum',
          'Context switching',
        ],
        correct_index: 0,
        explanation:
          'Aging gradually raises the priority of processes that have waited a long time.',
        source_ms: at('aging'),
      },
      {
        id: 'q4',
        prompt: 'If the Round Robin time quantum is made very large, the algorithm behaves like:',
        options: ['SJF', 'FCFS', 'Priority scheduling', 'SRTF'],
        correct_index: 1,
        explanation:
          'Every process finishes within its first quantum, so it is served in arrival order.',
        source_ms: at('FCFS లాగా'),
      },
      {
        id: 'q5',
        prompt:
          'For set A (P1 0/8, P2 1/4, P3 2/9, P4 3/5), what is the average waiting time under SRTF?',
        options: [`${a.fcfs} ms`, `${a.sjf} ms`, `${a.srtf} ms`, '5.25 ms'],
        correct_index: 2,
        explanation: `SRTF preempts P1 at time 1 for P2; the waits average to ${a.srtf} ms.`,
        source_ms: at('shortest remaining time first, the preemptive version'),
      },
      {
        id: 'q6',
        prompt: 'Response time is measured from submission until…',
        options: [
          'the process completes',
          'the process first gets the CPU',
          'the last I/O finishes',
          'the process leaves the ready queue for good',
        ],
        correct_index: 1,
        explanation:
          'Response time is the time until the first response, which matters for interactive systems.',
        source_ms: at('Fifth, response time'),
      },
    ],
    short_answer: [
      {
        id: 's1',
        prompt: 'Distinguish preemptive and non-preemptive scheduling, with one example of each.',
        model_answer:
          'In non-preemptive scheduling a process keeps the CPU until it terminates or blocks (e.g. FCFS, SJF). In preemptive scheduling the OS can take the CPU away, for example when a quantum expires or a higher-priority process arrives (e.g. Round Robin, SRTF).',
        source_ms: at('preemptive versus non-preemptive'),
      },
      {
        id: 's2',
        prompt: 'How does SJF estimate the length of the next CPU burst?',
        model_answer:
          'By exponential averaging of previous bursts: τ(n+1) = α·t(n) + (1 − α)·τ(n), where t(n) is the latest actual burst and τ(n) the previous prediction; α = ½ weights recent and past history equally.',
        source_ms: at('exponential average'),
      },
      {
        id: 's3',
        prompt:
          'What happens if the Round Robin quantum is too small or too large? How should it be chosen?',
        model_answer:
          'Too small causes excessive context-switch overhead; too large degenerates into FCFS. A rule of thumb is that about 80% of CPU bursts should be shorter than the quantum.',
        source_ms: at('eighty percent of CPU bursts'),
      },
    ],
  };
}

export function buildSchedulingFlashcards(segments: readonly TranscriptSegment[]): FlashcardSet {
  const at = (needle: string): number | null => firstMention(segments, needle);
  return {
    lecture_id: LECTURE_IDS.scheduling,
    cards: [
      {
        id: 'fc-01',
        front: 'Which scheduling algorithm minimises average waiting time?',
        back: 'Shortest Job First (SJF). It is provably optimal but needs the next CPU burst length.',
        source_ms: at('provably optimal'),
      },
      {
        id: 'fc-02',
        front: 'What is the convoy effect?',
        back: 'Under FCFS, short processes wait behind one long CPU-bound process.',
        source_ms: at('convoy effect'),
      },
      {
        id: 'fc-03',
        front: 'How does aging prevent starvation?',
        back: 'It gradually raises the priority of processes that have waited a long time.',
        source_ms: at('aging'),
      },
      {
        id: 'fc-04',
        front: 'What happens to Round Robin with a very large time quantum?',
        back: 'It behaves like FCFS, because every process finishes within its first quantum.',
        source_ms: null,
      },
    ],
  };
}

export function buildSchedulingRevision(generatedAt: string): RevisionNotes {
  return {
    lecture_id: LECTURE_IDS.scheduling,
    points: [
      'FCFS is simple but suffers from the convoy effect.',
      'SJF gives the minimum average waiting time; SRTF is its preemptive form.',
      'Round Robin performance depends on the time quantum.',
      'Priority scheduling can starve low-priority processes; aging fixes this.',
    ],
    takeaways: [
      'Know how to compute average waiting and turnaround time for each algorithm.',
      'Be able to compare algorithms on fairness, starvation and overhead.',
    ],
    generated_at: generatedAt,
  };
}
