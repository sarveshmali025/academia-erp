// routes/jobs.js - Admin-only API for the job queue, process manager and scheduler.
// Mounted at /api/admin/jobs. Same JWT + role guards as routes/admin.js.

const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middleware/auth');
const jobService = require('../services/jobService');
const store = require('../services/stores/mongoJobStore');
const scheduler = require('../services/scheduler');

router.use(protect, restrictTo('admin'));

const send = (res, err) => {
  const status = err.name === 'CastError' ? 404 : (err.status || 500);
  res.status(status).json({ success: false, message: err.name === 'CastError' ? 'Not found.' : err.message });
};
const needQueue = (res) => {
  const q = jobService.getQueue();
  if (!q) { res.status(503).json({ success: false, message: 'Job processing is not running (disabled or server starting/stopping).' }); return null; }
  return q;
};

const ms = (a, b) => (a && b ? new Date(b).getTime() - new Date(a).getTime() : null);
/** Real (measured) scheduling metrics for one job, in ms. */
const serialize = j => ({
  _id: j._id, type: j.type, label: j.label, status: j.status,
  student: j.student && j.student.name ? j.student.name : null,
  assignment: j.assignment && j.assignment.title ? j.assignment.title : null,
  submission: j.submission, attempts: j.attempts, maxAttempts: j.maxAttempts,
  fileCount: j.fileCount, estimatedBytes: j.estimatedBytes,
  enqueuedAt: j.enqueuedAt, startedAt: j.startedAt, finishedAt: j.finishedAt,
  workerId: j.workerId, workerPid: j.workerPid, error: j.error, lastFailure: j.lastFailure,
  metrics: {
    waitingMs: ms(j.enqueuedAt, j.startedAt),        // time spent Waiting before the (last) dispatch
    burstMs: ms(j.startedAt, j.finishedAt),          // time spent Running (last attempt)
    turnaroundMs: ms(j.enqueuedAt, j.finishedAt)     // enqueue → finish
  },
  verdict: j.result ? j.result.verdict : null,
  flaggedFiles: j.result ? j.result.flaggedFiles : null
});

// GET /api/admin/jobs/overview?status=&page=&limit=  (one call → fewer requests for the dashboard poll)
router.get('/overview', async (req, res) => {
  try {
    const q = needQueue(res); if (!q) return;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 15));
    const status = ['waiting', 'running', 'completed', 'failed'].includes(req.query.status) ? req.query.status : undefined;
    const [stats, list, recent] = await Promise.all([q.stats(), store.list({ status, page, limit }), store.recentFinished(12)]);
    res.json({
      success: true,
      mode: 'REAL_EXECUTION',
      stats, workers: q.pm.snapshot(),
      jobs: list.jobs.map(serialize), total: list.total, page, limit,
      timeline: recent.reverse().map(serialize)   // real execution history (oldest → newest)
    });
  } catch (err) { send(res, err); }
});

// GET /api/admin/jobs?status=&page=&limit=
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const status = ['waiting', 'running', 'completed', 'failed'].includes(req.query.status) ? req.query.status : undefined;
    const { jobs, total } = await store.list({ status, page, limit });
    res.json({ success: true, jobs: jobs.map(serialize), total, page, limit });
  } catch (err) { send(res, err); }
});

// GET /api/admin/jobs/workers
router.get('/workers', (req, res) => {
  const q = needQueue(res); if (!q) return;
  res.json({ success: true, workers: q.pm.snapshot() });
});

// PATCH /api/admin/jobs/policy  {policy:'fcfs'|'sjf'}  – REAL dispatch policy
router.patch('/policy', (req, res) => {
  try {
    const q = needQueue(res); if (!q) return;
    q.setPolicy(String((req.body || {}).policy || '').toLowerCase());
    res.json({ success: true, policy: q.policy, message: `Dispatch policy set to ${q.policy.toUpperCase()} (resets to JOB_POLICY on restart).` });
  } catch (err) { send(res, err); }
});

// POST /api/admin/jobs/simulate  – CPU-scheduling SIMULATION (executes nothing)
router.post('/simulate', (req, res) => {
  try {
    const { processes, quantum, algorithms } = req.body || {};
    const results = scheduler.simulate(processes, { algorithms: algorithms || ['fcfs', 'sjf', 'rr'], quantum: quantum === undefined ? 2 : quantum });
    res.json({ success: true, mode: 'SIMULATION', results });
  } catch (err) { send(res, err); }
});

// GET /api/admin/jobs/simulate/from-jobs – build simulator input from recently finished REAL jobs
router.get('/simulate/from-jobs', async (req, res) => {
  try {
    const jobs = (await store.recentFinished(10)).filter(j => j.status === 'completed').reverse();
    if (!jobs.length) return res.json({ success: true, processes: [], note: 'No completed jobs yet.' });
    const t0 = Math.min(...jobs.map(j => new Date(j.enqueuedAt).getTime()));
    const processes = jobs.map((j, i) => ({
      id: `J${i + 1}`,
      arrival: new Date(j.enqueuedAt).getTime() - t0,
      burst: Math.max(1, new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime()),
      label: j.label
    }));
    res.json({ success: true, processes, unit: 'ms', note: 'Arrival/burst derived from real jobs (ms). Replayed on ONE virtual CPU – the real pool has several workers.' });
  } catch (err) { send(res, err); }
});

// POST /api/admin/jobs/workers/:id/kill  – demo/testing: SIGKILL a worker to watch crash recovery
router.post('/workers/:id/kill', (req, res) => {
  const q = needQueue(res); if (!q) return;
  const ok = q.pm.killWorker(req.params.id, 'SIGKILL');
  if (!ok) return res.status(404).json({ success: false, message: 'Worker not found or not running.' });
  res.json({ success: true, message: `SIGKILL sent to ${req.params.id}. It will be restarted automatically.` });
});

// POST /api/admin/jobs/submissions/:submissionId/enqueue – process a submission made before this feature existed
router.post('/submissions/:submissionId/enqueue', async (req, res) => {
  try {
    if (!needQueue(res)) return;
    const { Submission, Assignment, User } = require('../models');
    const sub = await Submission.findById(req.params.submissionId);
    if (!sub) return res.status(404).json({ success: false, message: 'Submission not found.' });
    const [asg, stu] = await Promise.all([Assignment.findById(sub.assignment), User.findById(sub.student).select('name')]);
    if (!asg) return res.status(404).json({ success: false, message: 'Assignment not found.' });
    const r = await jobService.enqueueSubmission(sub, asg, stu && stu.name);
    if (r.reason === 'queue_full') return res.status(429).json({ success: false, message: 'Queue is full.', job: r });
    res.status(r.duplicate ? 200 : 201).json({ success: true, duplicate: !!r.duplicate, job: r });
  } catch (err) { send(res, err); }
});

// POST /api/admin/jobs/:id/retry – failed → waiting
router.post('/:id/retry', async (req, res) => {
  try {
    const q = needQueue(res); if (!q) return;
    const cur = await store.get(req.params.id);
    if (!cur) return res.status(404).json({ success: false, message: 'Job not found.' });
    if (cur.status !== 'failed') return res.status(409).json({ success: false, message: `Only failed jobs can be retried (this one is ${cur.status}).` });
    if ((await store.countWaiting()) >= q.maxWaiting) return res.status(429).json({ success: false, message: 'Queue is full. Retry later.' });
    const job = await q.retry(req.params.id);
    if (!job) return res.status(409).json({ success: false, message: 'Job changed state; refresh and retry.' });
    res.json({ success: true, job: serialize(job) });
  } catch (err) { send(res, err); }
});

module.exports = router;
module.exports.serialize = serialize;
