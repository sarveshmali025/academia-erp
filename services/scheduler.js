// services/scheduler.js
// ═══════════════════════════════════════════════════════════════
//  CPU-SCHEDULING ALGORITHMS (pure functions, no I/O)
//
//  Two different things live here – keep them apart:
//
//  1. SIMULATION  – fcfs(), sjf(), roundRobin(), simulate()
//     Textbook CPU-scheduling models on a single virtual CPU.
//     They NEVER execute anything. Output is always tagged
//     mode: 'SIMULATION'.
//
//  2. REAL DISPATCH – pickNextJob()
//     Used by the live job queue to decide which waiting job is
//     handed to the next free worker process (FCFS or
//     non-preemptive SJF). Round Robin is deliberately NOT a real
//     dispatch policy: a forked job cannot be time-sliced/preempted
//     safely, so RR exists only as a simulation.
// ═══════════════════════════════════════════════════════════════

const LIMITS = { maxProcesses: 100, maxBurst: 1e6, maxSlices: 20000 };

function bad(msg) { const e = new Error(msg); e.status = 400; return e; }

/** Validate + normalise [{id, arrival, burst}] */
function normalize(processes) {
  if (!Array.isArray(processes) || processes.length === 0) throw bad('At least one process is required.');
  if (processes.length > LIMITS.maxProcesses) throw bad(`At most ${LIMITS.maxProcesses} processes are allowed.`);
  const seen = new Set();
  return processes.map((p, index) => {
    const id = String(p && p.id !== undefined ? p.id : '').trim();
    if (!id || id.length > 40) throw bad(`Process #${index + 1}: id is required (max 40 chars).`);
    if (id === 'IDLE') throw bad('"IDLE" is a reserved process id.');
    if (seen.has(id)) throw bad(`Duplicate process id "${id}".`);
    seen.add(id);
    const arrival = Number(p.arrival), burst = Number(p.burst);
    if (!Number.isFinite(arrival) || arrival < 0) throw bad(`Process ${id}: arrival must be a number >= 0.`);
    if (!Number.isFinite(burst) || burst <= 0 || burst > LIMITS.maxBurst) throw bad(`Process ${id}: burst must be > 0 and <= ${LIMITS.maxBurst}.`);
    return { id, arrival, burst, index };
  });
}

/** Append a Gantt slice, merging with the previous one if contiguous and same pid. */
function pushSlice(gantt, pid, start, end) {
  const last = gantt[gantt.length - 1];
  if (last && last.pid === pid && last.end === start) last.end = end;
  else gantt.push({ pid, start, end });
}

function finalize(algorithm, procs, gantt, extra = {}) {
  const rows = procs.map(p => {
    const turnaround = p.completion - p.arrival;
    return {
      id: p.id, arrival: p.arrival, burst: p.burst,
      start: p.firstStart, completion: p.completion,
      turnaround, waiting: turnaround - p.burst, response: p.firstStart - p.arrival
    };
  });
  const n = rows.length;
  const avg = k => +(rows.reduce((a, r) => a + r[k], 0) / n).toFixed(2);
  const first = gantt.length ? gantt[0].start : 0;
  const last = gantt.length ? gantt[gantt.length - 1].end : 0;
  const busy = gantt.filter(g => g.pid !== 'IDLE').reduce((a, g) => a + (g.end - g.start), 0);
  return {
    mode: 'SIMULATION',
    note: 'Single virtual CPU model. Nothing was executed.',
    algorithm,
    ...extra,
    gantt,
    executionOrder: [...procs].sort((a, b) => a.firstStart - b.firstStart || a.index - b.index).map(p => p.id),
    completionOrder: [...procs].sort((a, b) => a.completion - b.completion || a.index - b.index).map(p => p.id),
    processes: rows,
    averages: { waiting: avg('waiting'), turnaround: avg('turnaround'), response: avg('response') },
    cpuUtilization: last > first ? +((busy / (last - first)) * 100).toFixed(1) : 100,
    makespan: last
  };
}

/** First-Come First-Served (non-preemptive). Ties broken by input order. */
function fcfs(input) {
  const procs = normalize(input).map(p => ({ ...p }));
  const order = [...procs].sort((a, b) => a.arrival - b.arrival || a.index - b.index);
  const gantt = [];
  let t = 0;
  for (const p of order) {
    if (t < p.arrival) { pushSlice(gantt, 'IDLE', t, p.arrival); t = p.arrival; }
    p.firstStart = t; t += p.burst; p.completion = t;
    pushSlice(gantt, p.id, p.firstStart, t);
  }
  return finalize('FCFS', procs, gantt);
}

/** Shortest-Job-First, NON-preemptive. Ties: earlier arrival, then input order. */
function sjf(input) {
  const procs = normalize(input).map(p => ({ ...p }));
  const pending = [...procs];
  const gantt = [];
  let t = 0;
  while (pending.length) {
    const ready = pending.filter(p => p.arrival <= t);
    if (ready.length === 0) {
      const next = Math.min(...pending.map(p => p.arrival));
      pushSlice(gantt, 'IDLE', t, next); t = next; continue;
    }
    ready.sort((a, b) => a.burst - b.burst || a.arrival - b.arrival || a.index - b.index);
    const p = ready[0];
    pending.splice(pending.indexOf(p), 1);
    p.firstStart = t; t += p.burst; p.completion = t;
    pushSlice(gantt, p.id, p.firstStart, t);
  }
  return finalize('SJF (non-preemptive)', procs, gantt);
}

/**
 * Round Robin with time quantum q.
 * Queue discipline (the part most implementations get wrong):
 *   - a process that arrives while another is running (or exactly when its
 *     slice ends) is placed in the ready queue BEFORE the pre-empted process
 *     is re-appended to the tail;
 *   - the CPU goes idle (and jumps forward) only when the ready queue is empty
 *     and nobody has arrived yet;
 *   - a process that finishes inside its slice releases the CPU immediately
 *     (the slice is not padded to q).
 */
function roundRobin(input, quantum) {
  const q = Number(quantum);
  if (!Number.isFinite(q) || q <= 0) throw bad('Time quantum must be a number > 0.');
  const procs = normalize(input).map(p => ({ ...p, remaining: p.burst, firstStart: null }));
  const slices = procs.reduce((a, p) => a + Math.ceil(p.burst / q), 0);
  if (slices > LIMITS.maxSlices) throw bad('Quantum too small for these bursts (too many time slices).');

  const arrivals = [...procs].sort((a, b) => a.arrival - b.arrival || a.index - b.index);
  let next = 0, t = 0, done = 0;
  const ready = [], gantt = [];
  const admit = () => { while (next < arrivals.length && arrivals[next].arrival <= t) ready.push(arrivals[next++]); };

  admit();
  while (done < procs.length) {
    if (ready.length === 0) {
      const at = arrivals[next].arrival;
      pushSlice(gantt, 'IDLE', t, at); t = at; admit(); continue;
    }
    const p = ready.shift();
    if (p.firstStart === null) p.firstStart = t;
    const run = Math.min(q, p.remaining);
    pushSlice(gantt, p.id, t, t + run);
    t += run; p.remaining -= run;
    admit();                       // arrivals up to and including time t go first
    if (p.remaining > 0) ready.push(p);
    else { p.completion = t; done++; }
  }
  return finalize(`Round Robin (q=${q})`, procs, gantt, { quantum: q });
}

/** Run one or more algorithms over the same process set. */
function simulate(processes, { algorithms = ['fcfs', 'sjf', 'rr'], quantum = 2 } = {}) {
  const map = { fcfs: () => fcfs(processes), sjf: () => sjf(processes), rr: () => roundRobin(processes, quantum) };
  const wanted = [...new Set(algorithms)];
  for (const a of wanted) if (!map[a]) throw bad(`Unknown algorithm "${a}". Use fcfs, sjf or rr.`);
  return wanted.map(a => map[a]());
}

// ───────────────────────── REAL DISPATCH ─────────────────────────
const DISPATCH_POLICIES = ['fcfs', 'sjf'];

/**
 * Choose the next waiting job for a free worker (REAL scheduling decision).
 *  - fcfs : oldest enqueuedAt first
 *  - sjf  : smallest estimatedBytes first (non-preemptive: a running job is
 *           never interrupted). To avoid starvation of big jobs, any job
 *           that has waited longer than agingMs is served first (FCFS among
 *           the aged jobs).
 */
function pickNextJob(waiting, policy = 'fcfs', now = Date.now(), agingMs = 60000) {
  if (!waiting || waiting.length === 0) return null;
  const t = j => new Date(j.enqueuedAt).getTime();
  const byFifo = (a, b) => t(a) - t(b) || String(a._id).localeCompare(String(b._id));
  if (policy === 'sjf') {
    const aged = waiting.filter(j => now - t(j) >= agingMs).sort(byFifo);
    if (aged.length) return aged[0];
    return [...waiting].sort((a, b) => (a.estimatedBytes || 0) - (b.estimatedBytes || 0) || byFifo(a, b))[0];
  }
  return [...waiting].sort(byFifo)[0];
}

module.exports = { fcfs, sjf, roundRobin, simulate, pickNextJob, DISPATCH_POLICIES, LIMITS };
