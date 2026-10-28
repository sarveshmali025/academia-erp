// Real child processes (child_process.fork), real IPC, in-memory store.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');
const ProcessManager = require('../services/processManager');
const { JobQueue, QueueFullError } = require('../services/jobQueue');
const createMemoryStore = require('../services/stores/memoryJobStore');

const TEST_WORKER = path.join(__dirname, '..', 'testsupport', 'testWorker.js');
const quiet = { log() {}, warn() {}, error() {} };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };
const until = async (fn, ms = 8000, step = 20) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, step)); } throw new Error('timeout waiting for condition'); };

function setup({ workers = 1, worker = TEST_WORKER, policy = 'fcfs', maxWaiting = 50, maxAttempts = 3, pm: pmOpts = {}, sjfAgingMs = 60000, payloads = {} } = {}) {
  const store = createMemoryStore();
  const pm = new ProcessManager({ size: workers, workerPath: worker, baseBackoffMs: 30, shutdownGraceMs: 3000, ...pmOpts });
  const loadPayload = async job => payloads[job.dedupeKey] || { jobType: 'x' };
  const queue = new JobQueue({ store, processManager: pm, loadPayload, policy, maxWaiting, maxAttempts, sjfAgingMs, logger: quiet });
  const finished = [];
  queue.on('finished', j => finished.push(j));
  let n = 0;
  const add = (key, extra = {}, payload) => { if (payload) payloads[key] = payload; return queue.enqueue({ dedupeKey: key, label: key, fileCount: 1, estimatedBytes: 100, ...extra }); };
  return { store, pm, queue, finished, add, payloads, stop: () => queue.shutdown() };
}
const ready = async pm => until(() => pm.snapshot().length && pm.snapshot().every(w => w.state === 'idle'));

test('real job executes in a separate OS process and returns a real result over IPC', async () => {
  const t = setup({ worker: path.join(__dirname, '..', 'workers', 'jobWorker.js') });
  const data = Buffer.from('hello world\nsecond line\n');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20, 7)]);
  t.payloads.k1 = { jobType: 'assignment_processing', allowedExtensions: ['txt', 'png'], files: [
    { originalName: 'a.txt', size: data.length, data: data.toString('base64') },
    { originalName: 'b.png', size: png.length, data: png.toString('base64') },
    { originalName: 'evil.exe', size: 3, data: Buffer.from('abc').toString('base64') }] };
  await t.queue.start(); await ready(t.pm);
  const { job } = await t.add('k1');
  const done = await until(() => t.finished.find(j => j._id === job._id));
  assert.equal(done.status, 'completed');
  const r = done.result;
  assert.notEqual(r.workerPid, process.pid);
  assert.equal(done.workerPid, r.workerPid);
  assert.equal(r.files[0].sha256, crypto.createHash('sha256').update(data).digest('hex'));
  assert.equal(r.files[0].lines, 2); assert.equal(r.files[0].words, 4);
  assert.equal(r.files[1].detectedType, 'png');
  assert.deepEqual(r.files[2].flags.sort(), ['extension_not_allowed']);
  assert.equal(r.verdict, 'needs_review');
  await t.stop();
});

test('FCFS dispatch order', async () => {
  const t = setup({ policy: 'fcfs' });
  await t.queue.start(); await ready(t.pm);
  await t.add('blocker', {}, { delayMs: 250 });
  await until(() => t.pm.snapshot()[0].state === 'busy');
  await t.add('A', { estimatedBytes: 900 }); await new Promise(r => setTimeout(r, 5));
  await t.add('B', { estimatedBytes: 10 });  await new Promise(r => setTimeout(r, 5));
  await t.add('C', { estimatedBytes: 100 });
  await until(() => t.finished.length === 4);
  assert.deepEqual(t.finished.map(j => j.dedupeKey), ['blocker', 'A', 'B', 'C']);
  await t.stop();
});

test('SJF dispatch order (non-preemptive: running job is never interrupted)', async () => {
  const t = setup({ policy: 'sjf' });
  await t.queue.start(); await ready(t.pm);
  await t.add('blocker', { estimatedBytes: 5000 }, { delayMs: 250 });
  await until(() => t.pm.snapshot()[0].state === 'busy');
  await t.add('big', { estimatedBytes: 900 }); await t.add('small', { estimatedBytes: 10 }); await t.add('mid', { estimatedBytes: 100 });
  await until(() => t.finished.length === 4);
  assert.deepEqual(t.finished.map(j => j.dedupeKey), ['blocker', 'small', 'mid', 'big']);
  await t.stop();
});

test('SJF aging prevents starvation of the big job', async () => {
  const t = setup({ policy: 'sjf', sjfAgingMs: 100 });
  await t.queue.start(); await ready(t.pm);
  await t.add('blocker', { estimatedBytes: 1 }, { delayMs: 300 });
  await until(() => t.pm.snapshot()[0].state === 'busy');
  await t.add('big', { estimatedBytes: 900 });
  await new Promise(r => setTimeout(r, 150));          // big is now "aged"
  await t.add('small', { estimatedBytes: 1 });
  await until(() => t.finished.length === 3);
  assert.deepEqual(t.finished.map(j => j.dedupeKey), ['blocker', 'big', 'small']);
  await t.stop();
});

test('bounded queue: exactly maxWaiting accepted under 10 concurrent enqueues', async () => {
  const t = setup({ maxWaiting: 3 });                  // not started → nothing drains
  const res = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => t.add(`j${i}`)));
  assert.equal(res.filter(r => r.status === 'fulfilled').length, 3);
  const rejected = res.filter(r => r.status === 'rejected');
  assert.equal(rejected.length, 7);
  assert.ok(rejected.every(r => r.reason instanceof QueueFullError && r.reason.status === 429));
  assert.equal(await t.store.countWaiting(), 3);
});

test('duplicate jobs: concurrent enqueues of the same submission create one job; duplicate allowed even when full', async () => {
  const t = setup({ maxWaiting: 1 });
  const r = await Promise.all(Array.from({ length: 6 }, () => t.add('same')));
  assert.equal(new Set(r.map(x => x.job._id)).size, 1);
  assert.equal(r.filter(x => x.duplicate).length, 5);
  assert.equal((await t.store.list()).total, 1);
  const again = await t.add('same');                   // queue is full, but this is a duplicate → reported as such
  assert.equal(again.duplicate, true);
  await assert.rejects(t.add('other'), QueueFullError);
});

test('crash recovery: worker killed mid-job → job re-queued, worker respawned with new PID, job completes', async () => {
  const t = setup({ pm: { jobTimeoutMs: 10000 } });
  await t.queue.start(); await ready(t.pm);
  const pid1 = t.pm.snapshot()[0].pid;
  const { job } = await t.add('victim', {}, { delayMs: 1500 });
  await until(() => t.pm.snapshot()[0].state === 'busy');
  process.kill(pid1, 'SIGKILL');                       // external kill -9
  const done = await until(() => t.finished.find(j => j._id === job._id));
  assert.equal(done.status, 'completed');
  assert.equal(done.attempts, 2);
  assert.match(done.lastFailure, /crash/);
  const w = t.pm.snapshot()[0];
  assert.notEqual(w.pid, pid1);
  assert.equal(w.restarts, 1);
  assert.ok(
    w.lastExit.signal === 'SIGKILL' ||
    (process.platform === 'win32' && w.lastExit.signal === null),
    `Expected SIGKILL or Windows null signal, got ${w.lastExit.signal}`
  );
  assert.equal(alive(pid1), false);
  await t.stop();
});

test('worker that crashes on every attempt → job Failed after maxAttempts; pool survives and serves the next job', async () => {
  const t = setup({ maxAttempts: 2 });
  await t.queue.start(); await ready(t.pm);
  const { job } = await t.add('doomed', {}, { alwaysCrash: true });
  const f = await until(() => t.finished.find(j => j._id === job._id));
  assert.equal(f.status, 'failed'); assert.equal(f.attempts, 2); assert.match(f.error, /gave up after 2/);
  const { job: ok } = await t.add('fine', {}, { echo: 'hi' });
  const g = await until(() => t.finished.find(j => j._id === ok._id));
  assert.equal(g.status, 'completed'); assert.equal(g.result.echo, 'hi');
  await t.stop();
});

test('crash on first attempt only → retried and succeeds on attempt 2', async () => {
  const t = setup();
  await t.queue.start(); await ready(t.pm);
  const { job } = await t.add('flaky', {}, { crashOnAttempt: 1 });
  const d = await until(() => t.finished.find(j => j._id === job._id));
  assert.equal(d.status, 'completed'); assert.equal(d.result.attempt, 2);
  await t.stop();
});

test('job timeout kills the worker (SIGKILL) and fails the job when attempts are exhausted', async () => {
  const t = setup({ maxAttempts: 1, pm: { jobTimeoutMs: 300 } });
  await t.queue.start(); await ready(t.pm);
  const pid = t.pm.snapshot()[0].pid;
  const { job } = await t.add('slow', {}, { delayMs: 5000 });
  const d = await until(() => t.finished.find(j => j._id === job._id));
  assert.equal(d.status, 'failed'); assert.match(d.error, /timeout/);
  assert.equal(alive(pid), false);
  await until(() => t.pm.snapshot()[0].state === 'idle');   // replacement worker is up
  await t.stop();
});

test('hung worker (stops answering heartbeat pings) is detected and killed', async () => {
  const t = setup({ maxAttempts: 1, pm: { heartbeatIntervalMs: 100, heartbeatTimeoutMs: 500, jobTimeoutMs: 30000 } });
  await t.queue.start(); await ready(t.pm);
  const { job } = await t.add('hang', {}, { hang: true });
  const d = await until(() => t.finished.find(j => j._id === job._id));
  assert.equal(d.status, 'failed'); assert.match(d.error, /hung/);
  await t.stop();
});

test('non-retryable worker error fails immediately (no retry storm)', async () => {
  const t = setup();
  await t.queue.start(); await ready(t.pm);
  const { job } = await t.add('bad', {}, { throwError: 'corrupt file' });
  const d = await until(() => t.finished.find(j => j._id === job._id));
  assert.equal(d.status, 'failed'); assert.equal(d.attempts, 1); assert.equal(d.error, 'corrupt file');
  await t.stop();
});

test('pool runs jobs in parallel in distinct processes', async () => {
  const t = setup({ workers: 3 });
  await t.queue.start(); await ready(t.pm);
  const t0 = Date.now();
  for (const k of ['p1', 'p2', 'p3']) await t.add(k, {}, { delayMs: 400 });
  await until(() => t.finished.length === 3);
  assert.ok(Date.now() - t0 < 1000, 'ran in parallel');
  assert.equal(new Set(t.finished.map(j => j.workerPid)).size, 3);
  await t.stop();
});

test('server restart recovery: jobs left "running" by a dead server are re-queued and then processed', async () => {
  const store = createMemoryStore();
  await store.create({ dedupeKey: 'orphan', status: 'running', attempts: 1, maxAttempts: 3, workerPid: 99999 });
  await store.create({ dedupeKey: 'exhausted', status: 'running', attempts: 3, maxAttempts: 3 });
  const pm = new ProcessManager({ size: 1, workerPath: TEST_WORKER });
  const q = new JobQueue({ store, processManager: pm, loadPayload: async () => ({ echo: 1 }), logger: quiet });
  const rec = await q.start();
  assert.deepEqual(rec, { requeued: 1, failed: 1 });
  await until(async () => (await store.counts()).completed === 1);
  assert.equal((await store.counts()).failed, 1);
  await q.shutdown();
});

test('graceful shutdown (drain): running job finishes, workers exit, no orphan processes', async () => {
  const t = setup({ workers: 2, pm: { shutdownGraceMs: 5000 } });
  await t.queue.start(); await ready(t.pm);
  const pids = t.pm.snapshot().map(w => w.pid);
  const { job } = await t.add('drain', {}, { delayMs: 300 });
  await until(() => t.pm.snapshot().some(w => w.state === 'busy'));
  const sum = await t.stop();
  assert.equal(sum.forced, 0);
  assert.equal((await t.store.get(job._id)).status, 'completed');
  await until(() => pids.every(p => !alive(p)));
  assert.ok(t.pm.snapshot().every(w => w.state === 'stopped'));
});

test('graceful shutdown (grace expired): job is force-stopped and returned to Waiting with its attempt refunded', async () => {
  const t = setup({ pm: { shutdownGraceMs: 200 } });
  await t.queue.start(); await ready(t.pm);
  const pid = t.pm.snapshot()[0].pid;
  const { job } = await t.add('long', {}, { delayMs: 10000 });
  await until(() => t.pm.snapshot()[0].state === 'busy');
  const sum = await t.stop();
  assert.equal(sum.forced, 1);
  const j = await t.store.get(job._id);
  assert.equal(j.status, 'waiting'); assert.equal(j.attempts, 0);
  assert.equal(alive(pid), false);
  assert.equal(await t.pm.getIdleWorker(), null);
  await assert.rejects(t.add('late'), /shutting down/);
});

test('no respawn after shutdown begins; ghost kill during shutdown does not resurrect workers', async () => {
  const t = setup();
  await t.queue.start(); await ready(t.pm);
  const p = t.stop();
  await p;
  await new Promise(r => setTimeout(r, 200));
  assert.ok(t.pm.snapshot().every(w => w.state === 'stopped' && w.pid && !alive(w.pid)));
});

test('admin kill of a worker triggers automatic restart', async () => {
  const t = setup();
  await t.queue.start(); await ready(t.pm);
  const pid = t.pm.snapshot()[0].pid;
  assert.equal(t.pm.killWorker('worker-1'), true);
  await until(() => { const w = t.pm.snapshot()[0]; return w.state === 'idle' && w.pid !== pid; });
  assert.equal(t.pm.killWorker('nope'), false);
  await t.stop();
});
