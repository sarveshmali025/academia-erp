// services/stores/memoryJobStore.js - in-memory store with the same contract as
// mongoJobStore. Used by the automated tests (no MongoDB needed here).
let seq = 0;
const clone = o => (o ? JSON.parse(JSON.stringify(o), (k, v) => (k === 'enqueuedAt' || k === 'startedAt' || k === 'finishedAt') && v ? new Date(v) : v) : null);

module.exports = function createMemoryStore() {
  const jobs = new Map();
  const byKey = new Map();
  const s = {
    _jobs: jobs,
    async create(data) {
      if (byKey.has(data.dedupeKey)) return { job: clone(jobs.get(byKey.get(data.dedupeKey))), created: false };
      const _id = `job${++seq}`;
      const job = { status: 'waiting', attempts: 0, maxAttempts: 3, startedAt: null, finishedAt: null, workerId: null, workerPid: null,
                    result: null, error: null, lastFailure: null, enqueuedAt: new Date(), ...data, _id };
      jobs.set(_id, job); byKey.set(job.dedupeKey, _id);
      return { job: clone(job), created: true };
    },
    async get(id) { return clone(jobs.get(String(id))); },
    async getByKey(key) { return byKey.has(key) ? clone(jobs.get(byKey.get(key))) : null; },
    async countWaiting() { return [...jobs.values()].filter(j => j.status === 'waiting').length; },
    async listWaiting(limit = 500) { return [...jobs.values()].filter(j => j.status === 'waiting').sort((a, b) => a.enqueuedAt - b.enqueuedAt).slice(0, limit).map(clone); },
    async claim(id, { workerId, pid }) {
      const j = jobs.get(String(id)); if (!j || j.status !== 'waiting') return null;
      Object.assign(j, { status: 'running', startedAt: new Date(), finishedAt: null, workerId, workerPid: pid, error: null }); j.attempts++;
      return clone(j);
    },
    async complete(id, result) {
      const j = jobs.get(String(id)); if (!j || j.status !== 'running') return null;
      Object.assign(j, { status: 'completed', finishedAt: new Date(), result, error: null }); return clone(j);
    },
    async fail(id, error) {
      const j = jobs.get(String(id)); if (!j || j.status !== 'running') return null;
      Object.assign(j, { status: 'failed', finishedAt: new Date(), error: String(error).slice(0, 500) }); return clone(j);
    },
    async release(id, note) {
      const j = jobs.get(String(id)); if (!j || j.status !== 'running') return null;
      Object.assign(j, { status: 'waiting', startedAt: null, workerId: null, workerPid: null, lastFailure: note || null }); j.attempts--; return clone(j);
    },
    async requeueOrFail(id, reason) {
      const j = jobs.get(String(id)); if (!j || j.status !== 'running') return { job: null, outcome: 'ignored' };
      if (j.attempts >= j.maxAttempts) {
        Object.assign(j, { status: 'failed', finishedAt: new Date(), error: `Worker ${reason} – gave up after ${j.attempts} attempt(s).`, lastFailure: reason });
        return { job: clone(j), outcome: 'failed' };
      }
      Object.assign(j, { status: 'waiting', startedAt: null, workerId: null, workerPid: null, lastFailure: reason });
      return { job: clone(j), outcome: 'requeued' };
    },
    async recoverInterrupted() {
      let requeued = 0, failed = 0;
      for (const j of [...jobs.values()].filter(x => x.status === 'running')) {
        const r = await s.requeueOrFail(j._id, 'interrupted by server restart');
        if (r.outcome === 'requeued') requeued++; else failed++;
      }
      return { requeued, failed };
    },
    async retry(id) {
      const j = jobs.get(String(id)); if (!j || j.status !== 'failed') return null;
      Object.assign(j, { status: 'waiting', attempts: 0, error: null, startedAt: null, finishedAt: null, workerId: null, workerPid: null, enqueuedAt: new Date() });
      return clone(j);
    },
    async list({ status, page = 1, limit = 25 } = {}) {
      const all = [...jobs.values()].filter(j => !status || j.status === status).sort((a, b) => b.enqueuedAt - a.enqueuedAt);
      return { jobs: all.slice((page - 1) * limit, page * limit).map(clone), total: all.length };
    },
    async counts() {
      const c = { waiting: 0, running: 0, completed: 0, failed: 0 };
      for (const j of jobs.values()) c[j.status]++;
      return c;
    },
    async recentFinished(limit = 20) {
      return [...jobs.values()].filter(j => ['completed', 'failed'].includes(j.status) && j.startedAt)
        .sort((a, b) => b.finishedAt - a.finishedAt).slice(0, limit).map(clone);
    }
  };
  return s;
};
