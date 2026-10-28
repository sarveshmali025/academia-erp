// services/stores/mongoJobStore.js - MongoDB-backed job store (production).
// Every state transition is a conditional findOneAndUpdate, so a job can
// never be claimed twice or completed from the wrong state.
const Job = require('../../models/Job');

const lean = d => (d ? d.toObject() : null);

module.exports = {
  async create(data) {
    try {
      return { job: lean(await Job.create(data)), created: true };
    } catch (err) {
      if (err.code === 11000) return { job: lean(await Job.findOne({ dedupeKey: data.dedupeKey })), created: false };
      throw err;
    }
  },
  async get(id) { return lean(await Job.findById(id)); },
  async getByKey(key) { return lean(await Job.findOne({ dedupeKey: key })); },
  countWaiting() { return Job.countDocuments({ status: 'waiting' }); },
  async listWaiting(limit = 500) { return Job.find({ status: 'waiting' }).sort('enqueuedAt').limit(limit).lean(); },

  async claim(id, { workerId, pid }) {
    return lean(await Job.findOneAndUpdate({ _id: id, status: 'waiting' },
      { $set: { status: 'running', startedAt: new Date(), finishedAt: null, workerId, workerPid: pid, error: null }, $inc: { attempts: 1 } }, { new: true }));
  },
  async complete(id, result) {
    return lean(await Job.findOneAndUpdate({ _id: id, status: 'running' },
      { $set: { status: 'completed', finishedAt: new Date(), result, error: null } }, { new: true }));
  },
  async fail(id, error) {
    return lean(await Job.findOneAndUpdate({ _id: id, status: 'running' },
      { $set: { status: 'failed', finishedAt: new Date(), error: String(error).slice(0, 500) } }, { new: true }));
  },
  /** running → waiting without consuming an attempt (job never really ran, or server is shutting down) */
  async release(id, note) {
    return lean(await Job.findOneAndUpdate({ _id: id, status: 'running' },
      { $set: { status: 'waiting', startedAt: null, workerId: null, workerPid: null, lastFailure: note || null }, $inc: { attempts: -1 } }, { new: true }));
  },
  /** running → waiting (retry) or failed when attempts are exhausted */
  async requeueOrFail(id, reason) {
    const cur = await Job.findOne({ _id: id, status: 'running' });
    if (!cur) return { job: null, outcome: 'ignored' };
    if (cur.attempts >= cur.maxAttempts) {
      const job = lean(await Job.findOneAndUpdate({ _id: id, status: 'running' },
        { $set: { status: 'failed', finishedAt: new Date(), error: `Worker ${reason} – gave up after ${cur.attempts} attempt(s).`, lastFailure: reason } }, { new: true }));
      return { job, outcome: job ? 'failed' : 'ignored' };
    }
    const job = lean(await Job.findOneAndUpdate({ _id: id, status: 'running' },
      { $set: { status: 'waiting', startedAt: null, workerId: null, workerPid: null, lastFailure: reason } }, { new: true }));
    return { job, outcome: job ? 'requeued' : 'ignored' };
  },
  /** Server restart: anything still "running" belongs to a dead process. */
  async recoverInterrupted() {
    const stale = await Job.find({ status: 'running' });
    let requeued = 0, failed = 0;
    for (const j of stale) {
      const r = await this.requeueOrFail(j._id, 'interrupted by server restart');
      if (r.outcome === 'requeued') requeued++; else if (r.outcome === 'failed') failed++;
    }
    return { requeued, failed };
  },
  async retry(id) {
    return lean(await Job.findOneAndUpdate({ _id: id, status: 'failed' },
      { $set: { status: 'waiting', attempts: 0, error: null, startedAt: null, finishedAt: null, workerId: null, workerPid: null, enqueuedAt: new Date() } }, { new: true }));
  },
  async list({ status, page = 1, limit = 25 } = {}) {
    const q = status ? { status } : {};
    const [jobs, total] = await Promise.all([
      Job.find(q).sort('-enqueuedAt').skip((page - 1) * limit).limit(limit)
        .populate('student', 'name').populate({ path: 'assignment', select: 'title' }).lean(),
      Job.countDocuments(q)
    ]);
    return { jobs, total };
  },
  async counts() {
    const rows = await Job.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    const c = { waiting: 0, running: 0, completed: 0, failed: 0 };
    rows.forEach(r => { c[r._id] = r.n; });
    return c;
  },
  async recentFinished(limit = 20) {
    return Job.find({ status: { $in: ['completed', 'failed'] }, startedAt: { $ne: null } }).sort('-finishedAt').limit(limit).lean();
  }
};
