/*
 * Real CPU-scheduling simulations used to generate the worked-example narration of the fixture
 * lecture. Every number spoken in the mock transcript is computed here, so it is correct.
 */

export interface Proc {
  id: string;
  arrival: number;
  burst: number;
  priority?: number;
}

export interface Slice {
  id: string;
  start: number;
  end: number;
}

export interface ProcResult {
  id: string;
  completion: number;
  turnaround: number;
  waiting: number;
  response: number;
}

export interface Schedule {
  slices: Slice[];
  results: ProcResult[];
}

function finish(procs: readonly Proc[], slices: Slice[]): Schedule {
  const merged: Slice[] = [];
  for (const slice of slices) {
    const last = merged.at(-1);
    if (last?.id === slice.id && last.end === slice.start) last.end = slice.end;
    else merged.push({ ...slice });
  }
  const results = procs.map((p) => {
    const own = merged.filter((s) => s.id === p.id);
    const completion = Math.max(...own.map((s) => s.end));
    const firstRun = Math.min(...own.map((s) => s.start));
    const turnaround = completion - p.arrival;
    return {
      id: p.id,
      completion,
      turnaround,
      waiting: turnaround - p.burst,
      response: firstRun - p.arrival,
    };
  });
  return { slices: merged, results };
}

/** Non-preemptive scheduler picking the best ready process by `rank` (lower wins). */
function nonPreemptive(procs: readonly Proc[], rank: (p: Proc) => number): Schedule {
  const pending = [...procs].sort((a, b) => a.arrival - b.arrival);
  const slices: Slice[] = [];
  let time = 0;
  while (pending.length > 0) {
    const ready = pending.filter((p) => p.arrival <= time);
    if (ready.length === 0) {
      time = Math.min(...pending.map((p) => p.arrival));
      continue;
    }
    ready.sort((a, b) => rank(a) - rank(b) || a.arrival - b.arrival);
    const next = ready[0];
    if (next === undefined) break;
    slices.push({ id: next.id, start: time, end: time + next.burst });
    time += next.burst;
    pending.splice(pending.indexOf(next), 1);
  }
  return finish(procs, slices);
}

/** Preemptive scheduler re-evaluated every time unit. */
function preemptive(
  procs: readonly Proc[],
  rank: (p: Proc, remaining: number) => number,
): Schedule {
  const remaining = new Map(procs.map((p) => [p.id, p.burst]));
  const slices: Slice[] = [];
  let time = 0;
  while ([...remaining.values()].some((r) => r > 0)) {
    const ready = procs.filter((p) => p.arrival <= time && (remaining.get(p.id) ?? 0) > 0);
    if (ready.length === 0) {
      time += 1;
      continue;
    }
    ready.sort(
      (a, b) =>
        rank(a, remaining.get(a.id) ?? 0) - rank(b, remaining.get(b.id) ?? 0) ||
        a.arrival - b.arrival,
    );
    const next = ready[0];
    if (next === undefined) break;
    slices.push({ id: next.id, start: time, end: time + 1 });
    remaining.set(next.id, (remaining.get(next.id) ?? 0) - 1);
    time += 1;
  }
  return finish(procs, slices);
}

export const fcfs = (procs: readonly Proc[]): Schedule => nonPreemptive(procs, (p) => p.arrival);
export const sjf = (procs: readonly Proc[]): Schedule => nonPreemptive(procs, (p) => p.burst);
export const srtf = (procs: readonly Proc[]): Schedule => preemptive(procs, (_p, rem) => rem);
export const priorityNp = (procs: readonly Proc[]): Schedule =>
  nonPreemptive(procs, (p) => p.priority ?? 0);
export const priorityP = (procs: readonly Proc[]): Schedule =>
  preemptive(procs, (p) => p.priority ?? 0);

/** Round Robin; new arrivals join the queue before the preempted process. */
export function roundRobin(procs: readonly Proc[], quantum: number): Schedule {
  const remaining = new Map(procs.map((p) => [p.id, p.burst]));
  const byArrival = [...procs].sort((a, b) => a.arrival - b.arrival);
  const queue: Proc[] = [];
  const slices: Slice[] = [];
  let time = 0;
  let nextArrival = 0;
  const admit = (until: number): void => {
    while (
      nextArrival < byArrival.length &&
      (byArrival[nextArrival]?.arrival ?? Infinity) <= until
    ) {
      const p = byArrival[nextArrival];
      if (p !== undefined) queue.push(p);
      nextArrival += 1;
    }
  };
  admit(time);
  while (queue.length > 0 || nextArrival < byArrival.length) {
    const current = queue.shift();
    if (current === undefined) {
      time = byArrival[nextArrival]?.arrival ?? time;
      admit(time);
      continue;
    }
    const left = remaining.get(current.id) ?? 0;
    const run = Math.min(quantum, left);
    slices.push({ id: current.id, start: time, end: time + run });
    time += run;
    remaining.set(current.id, left - run);
    admit(time);
    if (left - run > 0) queue.push(current);
  }
  return finish(procs, slices);
}

export const average = (values: readonly number[]): number =>
  Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
