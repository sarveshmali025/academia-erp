// models/Job.js - Background job record (kept in its own file so models/index.js is untouched)
const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  type: { type: String, default: 'assignment_processing' },
  // One job per submission → duplicate protection at the database level
  dedupeKey: { type: String, required: true, unique: true },
  submission: { type: mongoose.Schema.Types.ObjectId, ref: 'Submission', default: null },
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', default: null },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  classroom: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', default: null },
  label: { type: String, default: '' },

  status: { type: String, enum: ['waiting', 'running', 'completed', 'failed'], default: 'waiting', index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 3 },

  fileCount: { type: Number, default: 0 },
  estimatedBytes: { type: Number, default: 0 },   // job "length" used by SJF dispatch

  enqueuedAt: { type: Date, default: Date.now },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  workerId: { type: String, default: null },
  workerPid: { type: Number, default: null },

  result: { type: mongoose.Schema.Types.Mixed, default: null },
  error: { type: String, default: null },
  lastFailure: { type: String, default: null }     // reason of the last crash/timeout that caused a retry
}, { timestamps: true });

jobSchema.index({ status: 1, enqueuedAt: 1 });

module.exports = mongoose.models.Job || mongoose.model('Job', jobSchema);
