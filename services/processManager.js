// services/processManager.js
// ═══════════════════════════════════════════════════════════════
//  PROCESS MANAGER – a pool of real OS processes (child_process.fork)
//
//   • IPC           : parent↔child messages (see workers/jobWorker.js)
//   • Worker status : starting | idle | busy | restarting | stopping | stopped
//                     with PID, current job, counters, heartbeat, last exit
//   • Crash recovery: a worker that dies (crash, kill -9, OOM, hang,
//                     timeout) is respawned with exponential back-off and
//                     its in-flight job is reported via 'job-lost'
//   • Hang / timeout: heartbeat pings + per-job timeout → SIGKILL
//   • Shutdown      : drain running jobs up to a grace period, ask workers to
//                     exit over IPC, then SIGTERM → SIGKILL. No orphans.
//
//  Events:  'worker-ready' 'worker-idle' 'worker-crash' 'worker-exit'
//           'job-progress' 'job-result' 'job-error' 'job-lost'
// ═══════════════════════════════════════════════════════════════

const { fork } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

const DEFAULTS = {
  size: 2,
  workerPath: path.join(__dirname, '..', 'workers', 'jobWorker.js'),
  heartbeatIntervalMs: 5000,
  heartbeatTimeoutMs: 20000,
  readyTimeoutMs: 10000,
  jobTimeoutMs: 120000,
  baseBackoffMs: 250,
  maxBackoffMs: 10000,
  shutdownGraceMs: 10000,
  env: {}
};

class ProcessManager extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = { ...DEFAULTS, ...opts };
    this.opts.size = Math.min(8, Math.max(1, parseInt(this.opts.size, 10) || 1));
    this.workers = new Map();     // id -> record
    this.shuttingDown = false;
    this.started = false;
    this._hb = null;
  }

  // ───────── lifecycle ─────────
  start() {
    if (this.started) return;
    this.started = true;
    for (let slot = 0; slot < this.opts.size; slot++) this._spawn(`worker-${slot + 1}`);
    this._hb = setInterval(() => this._heartbeat(), this.opts.heartbeatIntervalMs);
    this._hb.unref();
  }

  _record(id) {
    let w = this.workers.get(id);
    if (!w) {
      w = { id, child: null, pid: null, state: 'stopped', currentJobId: null, progress: null, startedAt: null,
            jobsCompleted: 0, jobsFailed: 0, restarts: 0, consecutiveCrashes: 0, lastHeartbeat: null,
            lastExit: null, killReason: null, nextRestartAt: null,
            _jobTimer: null, _readyTimer: null, _restartTimer: null };
      this.workers.set(id, w);
    }
    return w;
  }

  _spawn(id) {
    if (this.shuttingDown) return;
    const w = this._record(id);
    const child = fork(this.opts.workerPath, [], {
      env: { ...process.env, ...this.opts.env },
      execArgv: [],                        // do not inherit --inspect etc. (port clashes)
      serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    });
    w.child = child; w.pid = child.pid; w.state = 'starting'; w.startedAt = new Date();
    w.currentJobId = null; w.progress = null; w.killReason = null; w.nextRestartAt = null;
    w.lastHeartbeat = Date.now();

    w._readyTimer = setTimeout(() => {
      if (w.state === 'starting' && w.child === child) { w.killReason = 'startup-timeout'; this._kill(child, 'SIGKILL'); }
    }, this.opts.readyTimeoutMs);

    child.on('message', msg => this._onMessage(w, child, msg));
    child.on('error', err => this.emit('worker-error', { workerId: id, error: err.message }));
    child.on('exit', (code, signal) => this._onExit(w, child, code, signal));
  }

  _kill(child, signal) { try { child.kill(signal); } catch (_) { /* already dead */ } }

  // ───────── IPC from child ─────────
  _onMessage(w, child, msg) {
    if (w.child !== child || !msg || typeof msg !== 'object') return; // stale child
    w.lastHeartbeat = Date.now();
    switch (msg.type) {
      case 'ready':
        clearTimeout(w._readyTimer);
        if (w.state === 'starting') { w.state = 'idle'; this.emit('worker-ready', this._info(w)); this.emit('worker-idle', w.id); }
        break;
      case 'pong': break;
      case 'progress':
        if (msg.jobId === w.currentJobId) { w.progress = msg.pct; this.emit('job-progress', { jobId: msg.jobId, workerId: w.id, pct: msg.pct }); }
        break;
      case 'result':
      case 'error': {
        if (msg.jobId !== w.currentJobId) break;               // late/duplicate message – ignore
        const jobId = w.currentJobId;
        this._clearJob(w);
        if (msg.type === 'result') { w.jobsCompleted++; w.consecutiveCrashes = 0; this.emit('job-result', { jobId, workerId: w.id, pid: w.pid, result: msg.result }); }
        else { w.jobsFailed++; this.emit('job-error', { jobId, workerId: w.id, pid: w.pid, error: String(msg.error || 'unknown error'), retryable: !!msg.retryable }); }
        w.state = 'idle';
        if (this.shuttingDown) this._stopWorker(w); else this.emit('worker-idle', w.id);
        break;
      }
    }
  }

  _clearJob(w) { clearTimeout(w._jobTimer); w._jobTimer = null; w.currentJobId = null; w.progress = null; }

  // ───────── child exit = crash recovery entry point ─────────
  _onExit(w, child, code, signal) {
    if (w.child !== child) return;
    clearTimeout(w._readyTimer); clearTimeout(w._jobTimer);
    const reason = w.killReason || (w.state === 'stopping' ? 'shutdown' : 'crash');
    const lostJob = w.currentJobId;
    const exitInfo = { code, signal, at: new Date(), reason, pid: w.pid };
    w.lastExit = exitInfo; w.child = null; w.currentJobId = null; w.progress = null;
    const wasIntentional = w.state === 'stopping';
    this.emit('worker-exit', { workerId: w.id, ...exitInfo });

    if (lostJob) {
      w.jobsFailed++;
      this.emit('job-lost', { jobId: lostJob, workerId: w.id, pid: exitInfo.pid, reason: wasIntentional && reason === 'shutdown' ? 'shutdown' : reason, code, signal });
    }
    if (this.shuttingDown || wasIntentional) { w.state = 'stopped'; return; }

    // unexpected death → respawn with exponential back-off
    w.consecutiveCrashes++; w.restarts++;
    const delay = Math.min(this.opts.maxBackoffMs, this.opts.baseBackoffMs * 2 ** (w.consecutiveCrashes - 1));
    w.state = 'restarting'; w.nextRestartAt = new Date(Date.now() + delay);
    this.emit('worker-crash', { workerId: w.id, ...exitInfo, restartInMs: delay, restarts: w.restarts });
    w._restartTimer = setTimeout(() => { w._restartTimer = null; this._spawn(w.id); }, delay);
  }

  // ───────── heartbeat / hang detection ─────────
  _heartbeat() {
    if (this.shuttingDown) return;
    const now = Date.now();
    for (const w of this.workers.values()) {
      if (!w.child || !['idle', 'busy'].includes(w.state)) continue;
      if (now - w.lastHeartbeat > this.opts.heartbeatTimeoutMs) { w.killReason = 'hung'; this._kill(w.child, 'SIGKILL'); continue; }
      try { w.child.send({ type: 'ping' }, () => {}); } catch (_) { /* channel closed; exit event follows */ }
    }
  }

  // ───────── dispatch API (used by JobQueue) ─────────
  /** Returns an idle worker id or null. */
  getIdleWorker() {
    if (this.shuttingDown) return null;
    for (const w of this.workers.values()) if (w.state === 'idle' && w.child) return w.id;
    return null;
  }

  /** Send a job to a specific idle worker. Returns false if it could not be handed over. */
  run(workerId, jobId, payload, meta = {}) {
    const w = this.workers.get(workerId);
    if (!w || w.state !== 'idle' || !w.child || this.shuttingDown) return false;
    try {
      w.child.send({ type: 'job', jobId: String(jobId), attempt: meta.attempt || 1, payload }, err => {
        if (err && w.currentJobId === String(jobId)) { w.killReason = 'ipc-error'; this._kill(w.child, 'SIGKILL'); }
      });
    } catch (_) { return false; }
    w.state = 'busy'; w.currentJobId = String(jobId); w.progress = 0;
    w._jobTimer = setTimeout(() => {
      if (w.currentJobId === String(jobId) && w.child) { w.killReason = 'timeout'; this._kill(w.child, 'SIGKILL'); }
    }, this.opts.jobTimeoutMs);
    return true;
  }

  /** Admin/testing aid: kill a worker process to exercise crash recovery. */
  killWorker(workerId, signal = 'SIGKILL') {
    const w = this.workers.get(workerId);
    if (!w || !w.child) return false;
    w.killReason = 'killed-by-admin';
    this._kill(w.child, signal);
    return true;
  }

  _info(w) {
    return {
      id: w.id, pid: w.pid, state: w.state, currentJobId: w.currentJobId, progress: w.progress,
      startedAt: w.startedAt, uptimeMs: w.child && w.startedAt ? Date.now() - w.startedAt.getTime() : 0,
      jobsCompleted: w.jobsCompleted, jobsFailed: w.jobsFailed, restarts: w.restarts,
      lastHeartbeat: w.lastHeartbeat ? new Date(w.lastHeartbeat) : null, lastExit: w.lastExit, nextRestartAt: w.nextRestartAt
    };
  }
  snapshot() { return [...this.workers.values()].map(w => this._info(w)); }
  get size() { return this.opts.size; }

  // ───────── graceful shutdown ─────────
  _stopWorker(w) {
    if (!w.child || w.state === 'stopping') return;
    w.state = 'stopping';
    try { w.child.send({ type: 'shutdown' }, () => {}); } catch (_) { /* ignore */ }
  }

  /**
   * 1. stop handing out work; cancel pending respawns
   * 2. let busy workers finish until shutdownGraceMs
   * 3. ask idle workers to exit over IPC
   * 4. at the deadline kill what is left (SIGTERM, then SIGKILL) – their jobs
   *    are reported through 'job-lost' with reason 'shutdown'
   */
  async shutdown() {
    if (this.shuttingDown) return this._shutdownP;
    this.shuttingDown = true;
    clearInterval(this._hb);
    this._shutdownP = new Promise(resolve => {
      const live = [...this.workers.values()];
      let forced = 0;
      for (const w of live) {
        clearTimeout(w._restartTimer); clearTimeout(w._readyTimer);
        if (!w.child) { w.state = 'stopped'; continue; }
        if (w.state === 'idle' || w.state === 'starting') this._stopWorker(w);
        // busy workers: _onMessage() stops them as soon as their job finishes
      }
      const alive = () => live.filter(w => w.child);
      const finish = () => resolve({ workers: live.length, forced });
      const poll = setInterval(() => { if (alive().length === 0) { clearInterval(poll); clearTimeout(deadline); finish(); } }, 25);
      const deadline = setTimeout(() => {
        for (const w of alive()) {
          forced++;
          if (w.currentJobId) w.state = 'stopping';   // so job-lost is tagged 'shutdown'
          w.killReason = 'shutdown';
          this._kill(w.child, 'SIGTERM');
          const c = w.child;
          setTimeout(() => this._kill(c, 'SIGKILL'), 2000).unref();
        }
      }, this.opts.shutdownGraceMs);
    });
    return this._shutdownP;
  }
}

module.exports = ProcessManager;
