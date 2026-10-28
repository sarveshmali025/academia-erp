// services/jobService.js
// Wires the generic queue/process-manager to this ERP (MongoDB store,
// Submission payload loader, env configuration). Everything is optional:
// if init() was not called (or JOB_PROCESSING_ENABLED=false) the helpers
// become no-ops and the rest of the ERP behaves exactly as before.

const ProcessManager = require('./processManager');
const { JobQueue, QueueFullError } = require('./jobQueue');
const mongoStore = require('./stores/mongoJobStore');

let queue = null;
let pm = null;

const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };

function config(env = process.env) {
  return {
    enabled: String(env.JOB_PROCESSING_ENABLED || 'true').toLowerCase() !== 'false',
    workers: Math.min(8, int(env.JOB_WORKERS, 2)),
    queueMax: int(env.JOB_QUEUE_MAX, 50),
    maxAttempts: int(env.JOB_MAX_ATTEMPTS, 3),
    jobTimeoutMs: int(env.JOB_TIMEOUT_MS, 120000),
    policy: (env.JOB_POLICY || 'fcfs').toLowerCase(),
    sjfAgingMs: int(env.JOB_SJF_AGING_MS, 60000),
    shutdownGraceMs: int(env.JOB_SHUTDOWN_GRACE_MS, 10000)
  };
}

/** Load the heavy data (base64 files) only at dispatch time, so memory is bounded by #workers. */
async function loadPayload(job) {
  const { Submission, Assignment } = require('../models');
  if (!job.submission) return null;
  const sub = await Submission.findById(job.submission).lean();
  if (!sub) return null;
  const asg = await Assignment.findById(sub.assignment).select('allowedExtensions').lean();
  return {
    jobType: job.type || 'assignment_processing',
    submissionId: String(sub._id),
    allowedExtensions: asg ? asg.allowedExtensions : [],
    files: (sub.files || []).map(f => ({ originalName: f.originalName, mimetype: f.mimetype, size: f.size, data: f.data }))
  };
}

async function init(logger = console) {
  const c = config();
  if (!c.enabled) { logger.log('⚙️  Job processing disabled (JOB_PROCESSING_ENABLED=false)'); return null; }
  if (queue) return queue;
  pm = new ProcessManager({ size: c.workers, jobTimeoutMs: c.jobTimeoutMs, shutdownGraceMs: c.shutdownGraceMs });
  queue = new JobQueue({ store: mongoStore, processManager: pm, loadPayload, policy: c.policy, maxWaiting: c.queueMax, maxAttempts: c.maxAttempts, sjfAgingMs: c.sjfAgingMs, logger });
  await queue.start();
  logger.log(`⚙️  Job queue ready: ${c.workers} worker process(es), queue limit ${c.queueMax}, dispatch policy ${queue.policy.toUpperCase()}`);
  return queue;
}

function jobDataFromSubmission(sub, assignment, studentName) {
  const files = sub.files || [];
  return {
    type: 'assignment_processing',
    dedupeKey: `assignment_processing:${sub._id}`,
    submission: sub._id, assignment: assignment._id, student: sub.student, classroom: sub.classroom,
    label: `${studentName || 'Student'} → ${assignment.title}`.slice(0, 160),
    fileCount: files.length,
    estimatedBytes: files.reduce((a, f) => a + (f.size || 0), 0)
  };
}

/**
 * Called from the submit route AFTER the submission is saved. Never throws:
 * a queue problem must not make a student's submission fail.
 * Returns {status, jobId?, duplicate?, reason?}.
 */
async function enqueueSubmission(sub, assignment, studentName) {
  if (!queue) return { status: 'disabled' };
  const data = jobDataFromSubmission(sub, assignment, studentName);
  try {
    const { job, duplicate } = await queue.enqueue(data);
    return { status: job.status, jobId: String(job._id), duplicate };
  } catch (err) {
    if (err instanceof QueueFullError || err.code === 'QUEUE_FULL') {
      // keep a visible record so an admin can retry it later
      try {
        const { job } = await mongoStore.create({ ...data, status: 'failed', finishedAt: new Date(), maxAttempts: queue.maxAttempts,
          error: 'Queue was full at submission time – use Retry in the admin dashboard.' });
        return { status: 'failed', jobId: String(job._id), reason: 'queue_full' };
      } catch (_) { /* ignore */ }
      return { status: 'failed', reason: 'queue_full' };
    }
    console.error('[jobs] enqueue failed:', err.message);
    return { status: 'error', reason: err.message };
  }
}

const getQueue = () => queue;

async function shutdown() {
  if (!queue) return null;
  const q = queue; queue = null; // new submissions stop enqueuing
  return q.shutdown();
}

module.exports = { init, enqueueSubmission, jobDataFromSubmission, getQueue, shutdown, config, loadPayload };
