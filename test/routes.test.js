// Runs the REAL routes/jobs.js, routes/assignments.js (submit), middleware/auth.js, services/jobService.js,
// queue and forked workers. Faked: express (tiny router), mongoose models, multer, JWT → see testsupport/harness.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { install, call } = require('../testsupport/harness');

const q = v => { const p = Promise.resolve(v); p.lean = () => Promise.resolve(v); p.select = () => p; return p; };
const users = {
  admin1: { _id: 'admin1', role: 'admin', name: 'Admin', isActive: true },
  stu1: { _id: 'stu1', role: 'student', name: 'Stu One', isActive: true },
  stu2: { _id: 'stu2', role: 'student', name: 'Stu Two', isActive: true },
  prof1: { _id: 'prof1', role: 'professor', name: 'Prof', isActive: true }
};
const db = { subs: new Map(), notifs: [] };
const assignment = { _id: 'asg1', title: 'Lab 1', classroom: 'cls1', professor: 'prof1', deadline: new Date(Date.now() + 1e7), allowedExtensions: ['txt', 'pdf'] };
const models = {
  Assignment: { findById: id => q(id === 'asg1' ? assignment : null) },
  Classroom: { findById: () => q({ students: ['stu1', 'stu2'] }) },
  Notification: { create: async n => { db.notifs.push(n); return n; } },
  Submission: {
    findOne: ({ assignment: a, student }) => q([...db.subs.values()].find(s => s.assignment === a && s.student === student) || null),
    create: async d => { const s = { _id: `sub${db.subs.size + 1}`, ...d, toObject() { return { ...this }; } }; db.subs.set(s._id, s); return s; },
    findById: id => q(db.subs.get(id) || null)
  }
};

let env, jobsRouter, asgRouter, jobService;
test.before(async () => {
  env = install({ users, models });
  process.env.JOB_WORKERS = '2'; process.env.JOB_QUEUE_MAX = '3'; process.env.JOB_POLICY = 'fcfs';
  jobService = require('../services/jobService');
  jobsRouter = require('../routes/jobs');
  asgRouter = require('../routes/assignments');
});
test.after(async () => { await jobService.shutdown(); env.restore(); });

const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 25)); } throw new Error('timeout'); };
const submit = (token, name, content) => call(asgRouter, 'POST', '/asg1/submit', { token, body: { notes: 'n' },
  files: [{ originalname: name, mimetype: 'text/plain', size: content.length, buffer: Buffer.from(content) }] });

test('every new admin endpoint rejects anonymous (401), student (403) and professor (403)', async () => {
  const eps = [['GET', '/overview'], ['GET', '/'], ['GET', '/workers'], ['PATCH', '/policy'], ['POST', '/simulate'], ['GET', '/simulate/from-jobs'],
               ['POST', '/workers/worker-1/kill'], ['POST', '/submissions/sub1/enqueue'], ['POST', '/job1/retry']];
  for (const [m, u] of eps) {
    assert.equal((await call(jobsRouter, m, u)).status, 401, `anon ${m} ${u}`);
    assert.equal((await call(jobsRouter, m, u, { token: 'stu1' })).status, 403, `student ${m} ${u}`);
    assert.equal((await call(jobsRouter, m, u, { token: 'prof1' })).status, 403, `prof ${m} ${u}`);
  }
});

test('admin endpoints answer 503 (not crash) while job processing is not running', async () => {
  const r = await call(jobsRouter, 'GET', '/overview', { token: 'admin1' });
  assert.equal(r.status, 503);
  // submissions still work with the queue off
  const s = await submit('stu1', 'x.txt', 'abc');
  assert.equal(s.status, 201); assert.equal(s.body.processing.status, 'disabled');
  db.subs.clear();
});

test('simulation endpoint works without the queue, is labelled SIMULATION and validates input', async () => {
  const r = await call(jobsRouter, 'POST', '/simulate', { token: 'admin1', body: { quantum: 2, processes: [{ id: 'A', arrival: 0, burst: 3 }, { id: 'B', arrival: 1, burst: 2 }] } });
  assert.equal(r.status, 200); assert.equal(r.body.mode, 'SIMULATION');
  assert.deepEqual(r.body.results.map(x => x.mode), ['SIMULATION', 'SIMULATION', 'SIMULATION']);
  assert.equal((await call(jobsRouter, 'POST', '/simulate', { token: 'admin1', body: { processes: [] } })).status, 400);
  assert.equal((await call(jobsRouter, 'POST', '/simulate', { token: 'admin1', body: { quantum: -1, algorithms: ['rr'], processes: [{ id: 'A', arrival: 0, burst: 3 }] } })).status, 400);
});

test('student submission → job is queued, executed in a worker process, visible to admin', async () => {
  await jobService.init({ log() {}, warn() {}, error() {} });
  const s = await submit('stu1', 'lab.txt', 'line one\nline two\n');
  assert.equal(s.status, 201);
  assert.ok(['waiting', 'running'].includes(s.body.processing.status));
  const jobId = s.body.processing.jobId;
  const job = await until(async () => { const o = await call(jobsRouter, 'GET', '/overview', { token: 'admin1' }); return o.body.jobs.find(j => j._id === jobId && j.status === 'completed'); });
  assert.equal(job.verdict, 'clean'); assert.ok(job.workerPid && job.workerPid !== process.pid);
  assert.ok(job.metrics.waitingMs >= 0 && job.metrics.turnaroundMs >= job.metrics.burstMs);
  const o = await call(jobsRouter, 'GET', '/overview?status=completed', { token: 'admin1' });
  assert.equal(o.body.mode, 'REAL_EXECUTION'); assert.equal(o.body.workers.length, 2);
  assert.ok(o.body.workers.every(w => Number.isInteger(w.pid)));
  assert.equal(o.body.stats.policy, 'fcfs');
  // grading-independent: the submission itself was saved exactly as before
  assert.equal(db.subs.size, 1); assert.equal(db.notifs.length > 0, true);
});

test('duplicate enqueue of the same submission is rejected idempotently', async () => {
  const r1 = await call(jobsRouter, 'POST', '/submissions/sub1/enqueue', { token: 'admin1' });
  assert.equal(r1.status, 200); assert.equal(r1.body.duplicate, true);
  assert.equal((await call(jobsRouter, 'POST', '/submissions/nope/enqueue', { token: 'admin1' })).status, 404);
});

test('policy switch: sjf accepted, round robin refused for REAL dispatch', async () => {
  assert.equal((await call(jobsRouter, 'PATCH', '/policy', { token: 'admin1', body: { policy: 'sjf' } })).body.policy, 'sjf');
  const rr = await call(jobsRouter, 'PATCH', '/policy', { token: 'admin1', body: { policy: 'rr' } });
  assert.equal(rr.status, 400); assert.match(rr.body.message, /simulation-only/i);
  await call(jobsRouter, 'PATCH', '/policy', { token: 'admin1', body: { policy: 'fcfs' } });
});

test('queue full at submission time: submission still succeeds, a Failed job is recorded, admin can retry later', async () => {
  const q = jobService.getQueue();
  // stop workers from draining: kill & stall by filling waiting directly through the store
  const store = require('../services/stores/mongoJobStore');
  q.closed = true;                       // freeze dispatching only (test hook on the instance)
  for (let i = 0; i < 3; i++) await store.create({ dedupeKey: `fill${i}`, label: `fill${i}`, estimatedBytes: 1 });
  q.closed = false;
  const s = await submit('stu2', 'late.txt', 'zzz');
  assert.equal(s.status, 201, 'student submission must not fail because of the queue');
  assert.equal(s.body.processing.status, 'failed'); assert.equal(s.body.processing.reason, 'queue_full');
  const failedId = s.body.processing.jobId;
  const full = await call(jobsRouter, 'POST', `/${failedId}/retry`, { token: 'admin1' });
  assert.equal(full.status, 429);
  // let the fillers drain (they have no submission → they fail with "no longer exists"), then retry works
  q.kick();
  await until(async () => (await store.countWaiting()) === 0);
  const ok = await call(jobsRouter, 'POST', `/${failedId}/retry`, { token: 'admin1' });
  assert.equal(ok.status, 200);
  await until(async () => (await store.get(failedId)).status === 'completed');
  assert.equal((await call(jobsRouter, 'POST', `/${failedId}/retry`, { token: 'admin1' })).status, 409, 'only failed jobs are retryable');
});

test('job whose submission vanished fails cleanly (assignment deleted case)', async () => {
  const store = require('../services/stores/mongoJobStore');
  const { jobs } = await store.list({ status: 'failed' });
  assert.ok(jobs.some(j => /no longer exists/.test(j.error)));
});

test('admin can SIGKILL a worker through the API; pool recovers with a new PID', async () => {
  const before = (await call(jobsRouter, 'GET', '/workers', { token: 'admin1' })).body.workers.find(w => w.id === 'worker-1');
  assert.equal((await call(jobsRouter, 'POST', '/workers/worker-1/kill', { token: 'admin1' })).status, 200);
  const after = await until(async () => { const w = (await call(jobsRouter, 'GET', '/workers', { token: 'admin1' })).body.workers.find(x => x.id === 'worker-1'); return w.state === 'idle' && w.pid !== before.pid && w; });
  assert.equal(after.restarts, 1);
  assert.equal((await call(jobsRouter, 'POST', '/workers/zzz/kill', { token: 'admin1' })).status, 404);
});

test('simulate/from-jobs builds a valid simulator input from real finished jobs', async () => {
  const r = await call(jobsRouter, 'GET', '/simulate/from-jobs', { token: 'admin1' });
  assert.equal(r.status, 200); assert.ok(r.body.processes.length >= 1);
  const sim = await call(jobsRouter, 'POST', '/simulate', { token: 'admin1', body: { processes: r.body.processes.map(({ id, arrival, burst }) => ({ id, arrival, burst })), quantum: 3 } });
  assert.equal(sim.status, 200);
});
