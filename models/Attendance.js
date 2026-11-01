// models/Attendance.js - Attendance Session and Records

const mongoose = require('mongoose');

const attendanceRecordSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['present', 'absent'],
    required: true,
    default: 'present'
  },
  remarks: {
    type: String,
    trim: true,
    default: ''
  }
}, { _id: false });

const attendanceSchema = new mongoose.Schema({
  classroom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Classroom',
    required: true,
    index: true
  },
  professor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  date: {
    type: Date,
    required: true
  },
  dateKey: {
    type: String, // YYYY-MM-DD for uniqueness per classroom and slot
    required: true
  },
  slot: {
    type: String,
    trim: true,
    default: '1' // slot 1, 2, 3 or morning/afternoon if multiple per day
  },
  topic: {
    type: String,
    trim: true,
    default: ''
  },
  records: [attendanceRecordSchema],
  totalStudents: {
    type: Number,
    default: 0
  },
  presentCount: {
    type: Number,
    default: 0
  },
  absentCount: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

// Prevent duplicate sessions for the same classroom on the same date and slot
attendanceSchema.index({ classroom: 1, dateKey: 1, slot: 1 }, { unique: true });

// Helper function: 75% Attendance Calculator
// (P / C) * 100
// If P/C < 0.75, calculate consecutive future lectures X to attend to reach 75%:
// (P + X) / (C + X) >= 0.75  =>  P + X >= 0.75*C + 0.75*X  =>  0.25*X >= 0.75*C - P  =>  X >= 3*C - 4*P
attendanceSchema.statics.calculate75 = function (present, conducted) {
  const p = Math.max(0, Number(present) || 0);
  const c = Math.max(0, Number(conducted) || 0);
  if (c === 0) {
    return {
      percentage: 100,
      meetsThreshold: true,
      neededFor75: 0,
      canMissNext: 0
    };
  }
  const percentage = Math.round((p / c) * 1000) / 10; // 1 decimal place
  const meetsThreshold = percentage >= 75;

  let neededFor75 = 0;
  if (!meetsThreshold) {
    // X >= 3*C - 4*P
    neededFor75 = Math.max(0, (3 * c) - (4 * p));
  }

  // How many can the student miss while maintaining >= 75%:
  // (P) / (C + M) >= 0.75 => P >= 0.75*C + 0.75*M => 0.75*M <= P - 0.75*C => M <= (4*P - 3*C)/3
  let canMissNext = 0;
  if (meetsThreshold) {
    canMissNext = Math.max(0, Math.floor(((4 * p) - (3 * c)) / 3));
  }

  return {
    percentage,
    meetsThreshold,
    neededFor75,
    canMissNext
  };
};

const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = Attendance;

