/*
 * Script of the fixture lecture "CPU Scheduling Algorithms" (Operating Systems, CS501).
 * Hand-written teaching lines in English with natural Telugu/Hindi code-switching, plus
 * worked-example narration generated from real simulations (./scheduling.ts).
 */
import {
  average,
  fcfs,
  priorityNp,
  priorityP,
  roundRobin,
  sjf,
  srtf,
  type Proc,
  type Schedule,
} from './scheduling';

export type ScriptLanguage = 'en' | 'te' | 'hi';

export interface ScriptLine {
  text: string;
  language: ScriptLanguage;
  transliteration: string | null;
}

export interface ScriptSection {
  id: string;
  heading: string;
  lines: ScriptLine[];
}

const en = (text: string): ScriptLine => ({ text, language: 'en', transliteration: null });
const te = (text: string, transliteration: string): ScriptLine => ({
  text,
  language: 'te',
  transliteration,
});
const hi = (text: string, transliteration: string): ScriptLine => ({
  text,
  language: 'hi',
  transliteration,
});

const SET_A: Proc[] = [
  { id: 'P1', arrival: 0, burst: 8 },
  { id: 'P2', arrival: 1, burst: 4 },
  { id: 'P3', arrival: 2, burst: 9 },
  { id: 'P4', arrival: 3, burst: 5 },
];
const SET_B: Proc[] = [
  { id: 'P1', arrival: 0, burst: 5, priority: 3 },
  { id: 'P2', arrival: 1, burst: 3, priority: 1 },
  { id: 'P3', arrival: 2, burst: 8, priority: 4 },
  { id: 'P4', arrival: 3, burst: 6, priority: 2 },
];
const SET_C: Proc[] = [
  { id: 'P1', arrival: 0, burst: 10 },
  { id: 'P2', arrival: 1, burst: 4 },
  { id: 'P3', arrival: 2, burst: 6 },
  { id: 'P4', arrival: 3, burst: 3 },
];
const SET_D: Proc[] = [
  { id: 'P1', arrival: 0, burst: 6 },
  { id: 'P2', arrival: 2, burst: 2 },
  { id: 'P3', arrival: 4, burst: 7 },
  { id: 'P4', arrival: 5, burst: 3 },
  { id: 'P5', arrival: 6, burst: 4 },
];

function describeSet(name: string, procs: readonly Proc[], withPriority = false): ScriptLine[] {
  return [
    en(`Let's take process set ${name}, with ${procs.length} processes.`),
    ...procs.map((p) =>
      en(
        `${p.id} arrives at time ${p.arrival} with a CPU burst of ${p.burst} milliseconds` +
          (withPriority && p.priority !== undefined ? `, priority ${p.priority}.` : '.'),
      ),
    ),
    ...(withPriority
      ? [en('Remember, in our convention a smaller number means a higher priority.')]
      : []),
  ];
}

function narrateSchedule(
  algorithm: string,
  schedule: Schedule,
  explain: (index: number) => string,
): ScriptLine[] {
  const lines: ScriptLine[] = [en(`Now let us schedule this set with ${algorithm}.`)];
  schedule.slices.forEach((slice, index) => {
    lines.push(en(`From time ${slice.start} to ${slice.end}, ${slice.id} runs${explain(index)}.`));
  });
  lines.push(
    en(
      `So the Gantt chart reads: ${schedule.slices.map((s) => `${s.id} from ${s.start} to ${s.end}`).join(', ')}.`,
    ),
  );
  for (const r of schedule.results) {
    lines.push(
      en(
        `${r.id} completes at ${r.completion}, so its turnaround time is ${r.completion} minus its arrival, which is ${r.turnaround}.`,
      ),
      en(`Its waiting time is turnaround minus burst, that is ${r.waiting} milliseconds.`),
    );
  }
  const waits = schedule.results.map((r) => r.waiting);
  const tats = schedule.results.map((r) => r.turnaround);
  const responses = schedule.results.map((r) => r.response);
  lines.push(
    en(
      `Average waiting time is (${waits.join(' + ')}) divided by ${waits.length}, which gives ${average(waits)} milliseconds.`,
    ),
    en(`Average turnaround time comes to ${average(tats)} milliseconds.`),
    en(
      `And the average response time, the time until each process first gets the CPU, is ${average(responses)}.`,
    ),
  );
  return lines;
}

const plain = (): string => '';
const rrExplain =
  (schedule: Schedule, quantum: number) =>
  (index: number): string => {
    const slice = schedule.slices[index];
    if (slice === undefined) return '';
    const length = slice.end - slice.start;
    return length === quantum
      ? ' for one full quantum'
      : `, needing only ${length} more, so it finishes inside the quantum`;
  };

function workedExamples() {
  const rr3 = roundRobin(SET_C, 3);
  const rr4 = roundRobin(SET_C, 4);
  const rr2d = roundRobin(SET_D, 2);
  const rr4a = roundRobin(SET_A, 4);
  return {
    fcfsA: [
      ...describeSet('A', SET_A),
      ...narrateSchedule('first come, first served', fcfs(SET_A), plain),
    ],
    sjfA: narrateSchedule('non-preemptive shortest job first', sjf(SET_A), plain),
    srtfA: narrateSchedule(
      'shortest remaining time first, the preemptive version',
      srtf(SET_A),
      plain,
    ),
    prioB: [
      ...describeSet('B', SET_B, true),
      ...narrateSchedule('non-preemptive priority scheduling', priorityNp(SET_B), plain),
    ],
    prioPB: narrateSchedule('preemptive priority scheduling', priorityP(SET_B), plain),
    rrC: [
      ...describeSet('C', SET_C),
      ...narrateSchedule('Round Robin with a quantum of 3', rr3, rrExplain(rr3, 3)),
      ...narrateSchedule('Round Robin again, but with a quantum of 4', rr4, rrExplain(rr4, 4)),
      en('For comparison, here is the same set C under plain FCFS.'),
      ...narrateSchedule('first come, first served', fcfs(SET_C), plain),
      en('And set A from earlier, now under Round Robin with quantum 4.'),
      ...narrateSchedule('Round Robin with quantum 4', rr4a, rrExplain(rr4a, 4)),
    ],
    practiceD: [
      ...describeSet('D for practice', SET_D),
      ...narrateSchedule('first come, first served', fcfs(SET_D), plain),
      ...narrateSchedule('shortest job first', sjf(SET_D), plain),
      ...narrateSchedule('shortest remaining time first', srtf(SET_D), plain),
      ...narrateSchedule('Round Robin with quantum 2', rr2d, rrExplain(rr2d, 2)),
    ],
  };
}

export function buildLectureScript(): ScriptSection[] {
  const ex = workedExamples();
  return [
    {
      id: 'intro',
      heading: 'Why CPU scheduling matters',
      lines: [
        en('Good morning everyone. Today we start a new topic: CPU scheduling.'),
        te(
          'ఇప్పుడు మనం CPU scheduling గురించి చూద్దాం.',
          'ippudu manam CPU scheduling gurinchi chooddaam.',
        ),
        en(
          'In a multiprogrammed system several processes are ready to run, but a single core can run only one at a time.',
        ),
        en(
          'The short-term scheduler, also called the CPU scheduler, decides which ready process gets the CPU next.',
        ),
        en('The dispatcher then gives control of the CPU to that process.'),
        en(
          'Dispatching involves a context switch, switching to user mode, and jumping to the right place in the program.',
        ),
        en(
          'The time the dispatcher takes is called dispatch latency, and we want it to be as small as possible.',
        ),
        hi(
          'Context switch में भी थोड़ा time लगता है, वो overhead है।',
          'context switch mein bhi thoda time lagta hai, vo overhead hai.',
        ),
        en(
          'Processes alternate between CPU bursts and I/O bursts. This is the CPU–I/O burst cycle.',
        ),
        en(
          'Most CPU bursts are short; a few are long. I/O-bound processes have many short bursts.',
        ),
        en(
          'CPU-bound processes have fewer but longer bursts. A good scheduler balances both kinds.',
        ),
        te(
          'ఈ concept చాలా important, exam లో తప్పకుండా వస్తుంది.',
          'ee concept chaalaa important, exam lo tappakundaa vastundi.',
        ),
      ],
    },
    {
      id: 'criteria',
      heading: 'Scheduling criteria',
      lines: [
        en('How do we compare scheduling algorithms? We use five criteria.'),
        en('First, CPU utilisation: keep the CPU as busy as possible.'),
        en('Second, throughput: the number of processes completed per unit time.'),
        en('Third, turnaround time: the time from submission of a process to its completion.'),
        te(
          'turnaround time అంటే completion time మైనస్ arrival time.',
          'turnaround time ante completion time mainas arrival time.',
        ),
        en('Fourth, waiting time: the total time a process spends waiting in the ready queue.'),
        te(
          'waiting time అంటే process ready queue లో ఎంత సేపు wait చేసిందో అది.',
          'waiting time ante process ready queue lo enta sepu wait chesindo adi.',
        ),
        en('So waiting time equals turnaround time minus burst time, when there is no I/O.'),
        en('Fifth, response time: the time from submission until the first response is produced.'),
        hi(
          'Response time मतलब पहली बार CPU मिलने तक का समय।',
          'response time matlab pehli baar CPU milne tak ka samay.',
        ),
        en(
          'We want to maximise utilisation and throughput, and minimise turnaround, waiting and response time.',
        ),
        en('Another key distinction is preemptive versus non-preemptive scheduling.'),
        en(
          'In non-preemptive scheduling, once a process gets the CPU it keeps it until it finishes or blocks for I/O.',
        ),
        te(
          'ఇది preemptive, అంటే మధ్యలో CPU లాక్కోవచ్చు.',
          'idi preemptive, ante madhyalo CPU laakkovachchu.',
        ),
        en(
          'In preemptive scheduling, the OS can take the CPU away, for example when a higher priority process arrives.',
        ),
      ],
    },
    {
      id: 'fcfs',
      heading: 'First Come, First Served (FCFS)',
      lines: [
        en('The simplest algorithm is first come, first served, FCFS.'),
        en(
          'It is implemented with a FIFO queue: the process that requests the CPU first gets it first.',
        ),
        en(
          'FCFS is non-preemptive. It is easy to understand, but the average waiting time is often long.',
        ),
        ...ex.fcfsA,
        en('Notice how the short process P2 had to wait behind the long process P1.'),
        en('This is called the convoy effect.'),
        te(
          'convoy effect అంటే ఒక పెద్ద process వెనకాల చిన్న processes అన్నీ ఆగిపోవడం.',
          'convoy effect ante oka pedda process venakaala chinna processes annee aagipovadam.',
        ),
        en(
          'It leads to lower CPU and device utilisation, because I/O-bound processes sit idle behind one CPU-bound process.',
        ),
        te('ఒక్కసారి board చూడండి.', 'okkasaari board choodandi.'),
        te('Gantt chart గీయడం practice చేయండి.', 'Gantt chart geeyadam practice cheyandi.'),
      ],
    },
    {
      id: 'sjf',
      heading: 'Shortest Job First (SJF) and SRTF',
      lines: [
        en('Shortest job first associates with each process the length of its next CPU burst.'),
        en('When the CPU is free, it is given to the process with the smallest next burst.'),
        en(
          'SJF is provably optimal: it gives the minimum average waiting time for a given set of processes.',
        ),
        ...ex.sjfA,
        en('Compare that with FCFS on the same set. The average waiting time dropped noticeably.'),
        en('SJF can also be preemptive. Then it is called shortest remaining time first, SRTF.'),
        en(
          'If a new process arrives with a burst shorter than what remains of the current process, we preempt.',
        ),
        ...ex.srtfA,
        te(
          'SJF optimal, కానీ next burst time ముందే తెలియదు.',
          'SJF optimal, kaanee next burst time munde teliyadu.',
        ),
        en('The real difficulty with SJF is knowing the length of the next CPU request.'),
        en('We cannot know it, so we predict it using an exponential average of previous bursts.'),
        en('tau n plus one equals alpha times t n, plus one minus alpha times tau n.'),
        en('With alpha equal to one half, recent history and past history are weighted equally.'),
        te(
          'అందుకే exponential averaging వాడి predict చేస్తాం.',
          'anduke exponential averaging vaadi predict chestaam.',
        ),
        te('అర్థమైందా? ఏమైనా doubts ఉంటే అడగండి.', 'arthamaindaa? emainaa doubts unte adagandi.'),
        en(
          'Yes, good question at the back. Long jobs can indeed starve under SJF if short jobs keep arriving.',
        ),
      ],
    },
    {
      id: 'priority',
      heading: 'Priority scheduling, starvation and aging',
      lines: [
        en(
          'SJF is a special case of priority scheduling, where the priority is the predicted next burst.',
        ),
        en(
          'In general, a priority number is associated with each process and the CPU goes to the highest priority.',
        ),
        en(
          'Priorities can be internal, like memory needs or the ratio of I/O to CPU burst, or external, like importance or fees paid.',
        ),
        ...ex.prioB,
        ...ex.prioPB,
        hi(
          'Priority scheduling में starvation की problem आती है।',
          'priority scheduling mein starvation ki problem aati hai.',
        ),
        en(
          'A low priority process may wait indefinitely. This is called starvation, or indefinite blocking.',
        ),
        te(
          'starvation అంటే ఒక process కి CPU ఎప్పటికీ దొరకకపోవడం.',
          'starvation ante oka process ki CPU eppatikee dorakakapovadam.',
        ),
        en(
          'The solution is aging: gradually increase the priority of processes that wait for a long time.',
        ),
        te(
          'దీనికి solution aging, అంటే wait చేసే కొద్దీ priority పెంచడం.',
          'deeniki solution aging, ante wait chese koddee priority penchadam.',
        ),
        en(
          'For example, raise the priority by one every fifteen minutes of waiting, and every process eventually runs.',
        ),
        hi(
          'ध्यान से देखो, P2 पहले आया लेकिन बाद में खत्म हुआ।',
          'dhyaan se dekho, P2 pehle aaya lekin baad mein khatm hua.',
        ),
      ],
    },
    {
      id: 'rr',
      heading: 'Round Robin and the time quantum',
      lines: [
        en('Round Robin is designed for time-sharing systems.'),
        en(
          'It is like FCFS, but with preemption: each process gets a small unit of CPU time, the time quantum.',
        ),
        te(
          'Round Robin లో ప్రతి process కి ఒక time quantum ఇస్తాం.',
          'Round Robin lo prati process ki oka time quantum istaam.',
        ),
        en('The ready queue is treated as a circular queue.'),
        en('If the process finishes within the quantum, it releases the CPU voluntarily.'),
        en(
          'Otherwise a timer interrupt fires, a context switch happens, and the process goes to the tail of the queue.',
        ),
        hi(
          'चलो, अब Round Robin को एक example से समझते हैं।',
          'chalo, ab Round Robin ko ek example se samajhte hain.',
        ),
        ...ex.rrC,
        en(
          'With n processes and quantum q, no process waits more than n minus one times q before its next turn.',
        ),
        te(
          'quantum చాలా చిన్నది అయితే context switches ఎక్కువ అవుతాయి.',
          'quantum chaalaa chinnadi aithe context switches ekkuva avutaayi.',
        ),
        te(
          'quantum చాలా పెద్దది అయితే అది FCFS లాగా అయిపోతుంది.',
          'quantum chaalaa peddadi aithe adi FCFS laagaa aipotundi.',
        ),
        en(
          'A rule of thumb: about eighty percent of CPU bursts should be shorter than the time quantum.',
        ),
        en(
          'Typical quanta are ten to one hundred milliseconds, while a context switch takes under ten microseconds.',
        ),
        hi(
          'Interactive systems के लिए Round Robin अच्छा रहता है।',
          'interactive systems ke liye Round Robin achchha rehta hai.',
        ),
        en(
          'Round Robin usually has a higher average turnaround than SJF, but much better response time.',
        ),
      ],
    },
    {
      id: 'mlq',
      heading: 'Multilevel queues and feedback queues',
      lines: [
        en(
          'In practice, processes are often classified into groups, like foreground interactive and background batch.',
        ),
        en('A multilevel queue scheduler partitions the ready queue into several separate queues.'),
        hi(
          'Multilevel queue में हर queue का अपना algorithm होता है।',
          'multilevel queue mein har queue ka apna algorithm hota hai.',
        ),
        en(
          'For example, the foreground queue might use Round Robin, and the background queue FCFS.',
        ),
        en(
          'Between queues, we use fixed priority preemptive scheduling, or time slicing, such as eighty percent to foreground.',
        ),
        en('In a plain multilevel queue, a process is permanently assigned to one queue.'),
        en('A multilevel feedback queue allows a process to move between queues.'),
        hi(
          'Feedback queue में process एक queue से दूसरी queue में जा सकता है।',
          'feedback queue mein process ek queue se doosri queue mein ja sakta hai.',
        ),
        en('If a process uses too much CPU time, it is moved to a lower priority queue.'),
        en('A process that waits too long in a lower queue can be moved up. That is aging again.'),
        en(
          'A feedback queue is defined by the number of queues, the algorithm for each queue, and the rules for promotion and demotion.',
        ),
        en('It is the most general scheme, and also the most complex to configure.'),
      ],
    },
    {
      id: 'practice',
      heading: 'Practice problem',
      lines: [
        en('Let us do one practice problem together before we wrap up.'),
        te('ఈ table ని మీ notebook లో రాసుకోండి.', 'ee table ni mee notebook lo raasukondi.'),
        hi('इसको अपनी notebook में लिख लो।', 'isko apni notebook mein likh lo.'),
        ...ex.practiceD,
        te(
          'average waiting time ఎంత వచ్చిందో చెప్పండి.',
          'average waiting time enta vachchindo cheppandi.',
        ),
        hi('बिल्कुल सही जवाब।', 'bilkul sahi jawaab.'),
        en(
          'Notice again: SJF gave the lowest average waiting time, and Round Robin gave the best response time.',
        ),
      ],
    },
    {
      id: 'summary',
      heading: 'Summary and next class',
      lines: [
        te('మళ్ళీ ఒకసారి recap చేద్దాం.', 'malli okasaari recap cheddaam.'),
        en('FCFS is simple but suffers from the convoy effect.'),
        en(
          'SJF is optimal for average waiting time but needs burst prediction, and can starve long jobs.',
        ),
        en('Priority scheduling generalises SJF; use aging to prevent starvation.'),
        en('Round Robin gives good response time; choose the quantum carefully.'),
        en(
          'Multilevel feedback queues combine these ideas and are used by real operating systems.',
        ),
        hi('यह exam के लिए बहुत important है।', 'yah exam ke liye bahut important hai.'),
        hi('किसी को कोई doubt है?', 'kisi ko koi doubt hai?'),
        te('next class లో deadlocks మొదలుపెడదాం.', 'next class lo deadlocks modalupedadaam.'),
        en('Read sections 5.1 to 5.3 of the textbook before Thursday. Thank you.'),
      ],
    },
  ];
}
