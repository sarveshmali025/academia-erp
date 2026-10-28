// services/jobQueue.js
// ═══════════════════════════════════════════════════════════════
//  BOUNDED BACKGROUND JOB QUEUE + REAL DISPATCH SCHEDULER
//
//  States: Waiting → Running → Completed | Failed
//   • bounded      : at most `maxWaiting` jobs may be Waiting; extra
//                    enqueue() calls throw QueueFullError (HTTP 429 style)
//   • duplicates   : dedupeKey is unique (DB index + in-process mutex)
//   • dispatch     : free worker → pickNextJob(policy) → atomic claim →
//                    send to worker over IPC. Policies: FCFS, SJF
//   • retries      : crash / timeout / hang → job returns to Waiting until
//                    maxAttempts, then Failed. Deterministic worker errors
//                    (payload problems) fail immediately.
//   • restart      : on start(), jobs left "running" by a dead server are
//                    re-queued (or failed if out of attempts)
//   • shutdown     : stops dispatching, drains/kills workers, puts
//                    interrupted jobs back to Waiting so none are lost
// ═══════════════════════════════════════════════════════════════

const EventEmitter = require('events');
const { pickNextJob, DISPATCH_POLICIES } = require('./scheduler');

class QueueFullError extends Error {
  constructor(max) { super(`Job queue is full (${max} waiting). Try again later.`); this.name = 'QueueFullError'; this.status = 429; this.code = 'QUEUE_FULL'; }
}

class JobQueue extends EventEmitter {
  constructor({ store, processManager, loadPayload, policy = 'fcfs', maxWaiting = 50, maxAttempts = 3, sjfAgingMs = 60000, onJobFinished = null, logger = console }) {
    super();
    Object.assign(this, { store, pm: processManager, loadPayload, maxWaiting, maxAttempts, sjfAgingMs, onJobFinished, log: logger });
    this.policy = DISPATCH_POLICIES.includes(policy) ? policy : 'fcfs';
    this.closed = false;
    this.started = false;
    this._dispatching = false; this._again = false;
    this._enqLock = Promise.resolve();
    this._inflight = new Set();
    this.dispatched = []; // ring buffer of recent dispatch decisions (for the UI)
  }

  // ───────── lifecycle ─────────
  async start() {
    if (this.started) return;
    this.started = true;
    const rec = await this.store.recoverInterrupted();
    if (rec.requeued || rec.failed) this.log.log(`[jobs] recovered after restart: ${rec.requeued} re-queued, ${rec.failed} failed`);
    const pm = this.pm;
    pm.on('worker-idle', () => this.kick());
    pm.on('job-result', e => this._track(this._onResult(e)));
    pm.on('job-error', e => this._track(this._onError(e)));
    pm.on('job-lost', e => this._track(this._onLost(e)));
    pm.on('worker-crash', e => this.log.warn(`[jobs] ${e.workerId} (pid ${e.pid}) died: ${e.reason} code=${e.code} signal=${e.signal}; restart in ${e.restartInMs}ms`));
    pm.start();
    return rec;
  }

  _track(p) { this._inflight.add(p); p.finally(() => this._inflight.delete(p)); return p; }

  setPolicy(policy) {
    if (!DISPATCH_POLICIES.includes(policy)) { const e = new Error(`Dispatch policy must be one of: ${DISPATCH_POLICIES.join(', ')}. (Round Robin is simulation-only.)`); e.status = 400; throw e; }
    this.policy = policy;
    this.kick();
  }

  // ───────── enqueue (bounded, duplicate-safe) ─────────
  enqueue(data) {
    // Serialised so two concurrent enqueues cannot both slip under the limit.
    const p = this._enqLock.then(async () => {
      if (this.closed) { const e = new Error('Queue is shutting down.'); e.status = 503; throw e; }
      const existing = await this.store.getByKey(data.dedupeKey);
      if (existing) return { job: existing, duplicate: true };
      if ((await this.store.countWaiting()) >= this.maxWaiting) throw new QueueFullError(this.maxWaiting);
      const { job, created } = await this.store.create({ ...data, maxAttempts: this.maxAttempts });
      if (created) this.kick();
      return { job, duplicate: !created };
    });
    this._enqLock = p.catch(() => {});
    return p;
  }

  // ───────── dispatcher ─────────
  kick() {
    if (this.closed || !this.started) return;
    if (this._dispatching) { this._again = true; return; }
    this._dispatching = true;
    setImmediate(async () => {
      try {
        do { this._again = false; await this._dispatchLoop(); } while (this._again && !this.closed);
      } catch (err) { this.log.error('[jobs] dispatch error:', err.message); }
      finally { this._dispatching = false; }
    });
  }

  async _dispatchLoop() {
    while (!this.closed) {
      const workerId = this.pm.getIdleWorker();
      if (!workerId) return;
      const waiting = await this.store.listWaiting(500);
      const next = pickNextJob(waiting, this.policy, Date.now(), this.sjfAgingMs);
      if (!next) return;
      const w = this.pm.workers.get(workerId);
      const claimed = await this.store.claim(next._id, { workerId, pid: w.pid });
      if (!claimed) continue;                                   // lost the race – pick again
      let payload;
      try { payload = await this.loadPayload(claimed); }
      catch (err) { await this._finishFailed(claimed._id, `payload error: ${err.message}`); continue; }
      if (!payload) { await this._finishFailed(claimed._id, 'source submission no longer exists'); continue; }
      if (!this.pm.run(workerId, claimed._id, payload, { attempt: claimed.attempts })) {
        await this.store.release(claimed._id, 'worker unavailable at dispatch');  // not the job's fault
        continue;
      }
      this.dispatched.unshift({ at: new Date(), jobId: String(claimed._id), workerId, policy: this.policy, waitingBefore: waiting.length, estimatedBytes: claimed.estimatedBytes });
      this.dispatched.length = Math.min(this.dispatched.length, 20);
    }
  }

  // ───────── worker events ─────────
  async _finishFailed(id, error) {
    const job = await this.store.fail(id, error);
    if (job) await this._finished(job);
  }
  async _finished(job) {
    this.emit('finished', job);
    if (this.onJobFinished) { try { await this.onJobFinished(job); } catch (e) { this.log.error('[jobs] onJobFinished:', e.message); } }
  }
  async _onResult({ jobId, result }) {
    try { const job = await this.store.complete(jobId, result); if (job) await this._finished(job); }
    catch (e) { this.log.error('[jobs] complete failed:', e.message); }
    this.kick();
  }
  async _onError({ jobId, error, retryable }) {
    try {
      if (retryable) { const r = await this.store.requeueOrFail(jobId, `error: ${error}`); if (r.outcome === 'failed') await this._finished(r.job); }
      else await this._finishFailed(jobId, error);
    } catch (e) { this.log.error('[jobs] error handling failed:', e.message); }
    this.kick();
  }
  async _onLost({ jobId, reason }) {
    try {
      if (reason === 'shutdown') await this.store.release(jobId, 'interrupted by shutdown');
      else { const r = await this.store.requeueOrFail(jobId, reason); if (r.outcome === 'failed') await this._finished(r.job); }
    } catch (e) { this.log.error('[jobs] recovery failed:', e.message); }
    this.kick();
  }

  // ───────── introspection / admin ─────────
  async retry(id) { const j = await this.store.retry(id); if (j) this.kick(); return j; }
  async stats() {
    return {
      counts: await this.store.counts(),
      policy: this.policy,
      limits: { maxWaiting: this.maxWaiting, maxAttempts: this.maxAttempts, workers: this.pm.size, sjfAgingMs: this.sjfAgingMs },
      recentDispatches: this.dispatched
    };
  }

  // ───────── graceful shutdown ─────────
  async shutdown() {
    if (this.closed) return;
    this.closed = true;
    const summary = await this.pm.shutdown();
    await Promise.allSettled([...this._inflight]);
    await this._enqLock.catch(() => {});
    return summary;
  }
}

module.exports = { JobQueue, QueueFullError };
