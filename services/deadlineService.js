// services/deadlineService.js
// Smart Assignment Deadline Manager - Service Logic
// Handles deadline calculations, color-coded statuses, overdue filtering,
// concurrency-safe reminder generation, and background deadline scheduling.

const { Classroom, Assignment, Submission, Notification } = require('../models');

// In-memory mutex lock to prevent concurrent requests from creating duplicate reminders
const activeReminderLocks = new Set();

// Background timer reference
let reminderSchedulerTimer = null;

/**
 * Compute the remaining time, status, and colour code for an assignment deadline
 * using consistent calendar-day logic.
 *
 * Colour Rules:
 * - Red: Overdue / Today / Tomorrow
 * - Orange: 2–3 days
 * - Yellow: 4–5 days
 * - Green: 6–7 days
 * - Blue: > 7 days
 *
 * Overdue Handling:
 * - Overdue <= 3 days: shown prominently in main cards
 * - Overdue > 3 days: hidden from regular cards, counted in compact overdue counter
 *
 * Safe handling of missing and invalid dates.
 *
 * @param {Date|string|null|undefined} deadlineDate
 * @param {Date} [now=new Date()]
 * @returns {Object}
 */
function computeDeadlineStatus(deadlineDate, now = new Date()) {
  if (!deadlineDate) {
    return {
      status: 'no_deadline',
      label: 'No Deadline',
      color: 'blue',
      timeText: 'No deadline set',
      diffMs: Infinity,
      daysLeft: Infinity,
      isOverdue: false,
      overdueDays: 0,
      isRecentOverdue: false,
      isOlderOverdue: false,
      isToday: false,
      isTomorrow: false,
      isNext7Days: false,
      isNext14Days: false,
      isAll: true,
      isValid: false
    };
  }

  const d = new Date(deadlineDate);
  if (isNaN(d.getTime())) {
    return {
      status: 'invalid_deadline',
      label: 'Invalid Date',
      color: 'blue',
      timeText: 'Invalid deadline date',
      diffMs: Infinity,
      daysLeft: Infinity,
      isOverdue: false,
      overdueDays: 0,
      isRecentOverdue: false,
      isOlderOverdue: false,
      isToday: false,
      isTomorrow: false,
      isNext7Days: false,
      isNext14Days: false,
      isAll: true,
      isValid: false
    };
  }

  const diffMs = d.getTime() - now.getTime();

  // Consistent calendar day comparison using local start of day
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDeadlineDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDeadlineDay - startOfToday) / (24 * 60 * 60 * 1000));

  const isOverdue = diffMs < 0;

  if (isOverdue) {
    let overdueDays = 0;
    let timeText = 'Overdue';

    if (diffDays === 0) {
      // Due earlier today
      overdueDays = 0;
      const overdueHours = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60));
      const overdueMins = Math.floor((Math.abs(diffMs) / (1000 * 60)) % 60);
      timeText = overdueHours >= 1 ? `Overdue by ${overdueHours}h ${overdueMins}m` : `Overdue by ${Math.max(1, overdueMins)}m`;
    } else {
      overdueDays = Math.abs(diffDays);
      timeText = `Overdue by ${overdueDays} day${overdueDays !== 1 ? 's' : ''}`;
    }

    const isRecentOverdue = overdueDays <= 3;
    const isOlderOverdue = overdueDays > 3;

    return {
      status: 'overdue',
      label: 'Overdue',
      color: 'red',
      timeText,
      diffMs,
      daysLeft: -overdueDays,
      isOverdue: true,
      overdueDays,
      isRecentOverdue,
      isOlderOverdue,
      isToday: false,
      isTomorrow: false,
      isNext7Days: isRecentOverdue,
      isNext14Days: isRecentOverdue,
      isAll: true,
      isValid: true
    };
  }

  // Upcoming
  let status = 'upcoming';
  let label = '';
  let color = 'blue';
  let timeText = '';

  if (diffDays === 0) {
    status = 'today';
    label = 'Due Today';
    color = 'red';
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs / (1000 * 60)) % 60);
    timeText = diffHours >= 1 ? `Due today (in ${diffHours}h ${diffMins}m)` : `Due today (in ${Math.max(1, diffMins)}m)`;
  } else if (diffDays === 1) {
    status = 'tomorrow';
    label = 'Due Tomorrow';
    color = 'red';
    timeText = 'Due tomorrow';
  } else if (diffDays >= 2 && diffDays <= 3) {
    status = '2-3days';
    label = `${diffDays} days left`;
    color = 'orange';
    timeText = `Due in ${diffDays} days`;
  } else if (diffDays >= 4 && diffDays <= 5) {
    status = '4-5days';
    label = `${diffDays} days left`;
    color = 'yellow';
    timeText = `Due in ${diffDays} days`;
  } else if (diffDays >= 6 && diffDays <= 7) {
    status = '6-7days';
    label = `${diffDays} days left`;
    color = 'green';
    timeText = `Due in ${diffDays} days`;
  } else {
    status = 'later';
    label = `${diffDays} days left`;
    color = 'blue';
    timeText = `Due in ${diffDays} days`;
  }

  return {
    status,
    label,
    color,
    timeText,
    diffMs,
    daysLeft: diffDays,
    isOverdue: false,
    overdueDays: 0,
    isRecentOverdue: false,
    isOlderOverdue: false,
    isToday: diffDays === 0,
    isTomorrow: diffDays === 1,
    isNext7Days: diffDays <= 7,
    isNext14Days: diffDays <= 14,
    isAll: true,
    isValid: true
  };
}

/**
 * Concurrency-safe helper to create a reminder notification without duplicates.
 */
async function createReminderSafely({ studentId, assignmentId, title, message }) {
  const lockKey = `${studentId.toString()}_${assignmentId.toString()}_${title}`;
  if (activeReminderLocks.has(lockKey)) {
    return null; // Concurrency lock: skip if identical reminder is in-flight
  }

  activeReminderLocks.add(lockKey);
  try {
    const existing = await Notification.findOne({
      user: studentId,
      relatedId: assignmentId,
      title
    });

    if (existing) {
      return null;
    }

    const notif = await Notification.create({
      user: studentId,
      title,
      message,
      type: 'assignment',
      relatedId: assignmentId,
      isRead: false
    });
    return notif;
  } catch (err) {
    if (err.code === 11000) return null; // Duplicate key guard
    throw err;
  } finally {
    activeReminderLocks.delete(lockKey);
  }
}

/**
 * Check and create in-app reminder notifications for unsubmitted assignments.
 * Reminders:
 * - One day before deadline ("Due Tomorrow")
 * - On deadline day ("Due Today")
 * Prevents duplicate reminders and stops reminders if student submitted.
 *
 * @param {string|ObjectId} studentId
 * @param {Array} pendingAssignments - Only unsubmitted assignments
 * @param {Date} [now=new Date()]
 */
async function checkAndCreateReminders(studentId, pendingAssignments = [], now = new Date()) {
  if (!studentId || !Array.isArray(pendingAssignments) || pendingAssignments.length === 0) {
    return [];
  }

  const createdNotifs = [];

  for (const a of pendingAssignments) {
    if (!a.deadline) continue;
    const d = new Date(a.deadline);
    if (isNaN(d.getTime())) continue;

    const diffMs = d.getTime() - now.getTime();
    if (diffMs < 0) continue; // Skip overdue

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfDeadlineDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfDeadlineDay - startOfToday) / (24 * 60 * 60 * 1000));

    const isToday = diffDays === 0;
    const isTomorrow = diffDays === 1;

    const className = (a.classroom && (a.classroom.name || a.classroom.subject)) || 'your class';

    if (isTomorrow) {
      const title = `Due Tomorrow: ${a.title}`;
      const notif = await createReminderSafely({
        studentId,
        assignmentId: a._id,
        title,
        message: `Reminder: "${a.title}" in ${className} is due tomorrow (${d.toLocaleDateString()}). Submit before deadline!`
      });
      if (notif) createdNotifs.push(notif);
    } else if (isToday) {
      const title = `Due Today: ${a.title}`;
      const notif = await createReminderSafely({
        studentId,
        assignmentId: a._id,
        title,
        message: `Urgent: "${a.title}" in ${className} is due today! Complete and submit your work before the deadline.`
      });
      if (notif) createdNotifs.push(notif);
    }
  }

  return createdNotifs;
}

/**
 * Background sweep across all enrolled classrooms and published assignments
 * to generate due-today and due-tomorrow reminders for all students.
 * Concurrency-safe and idempotent.
 */
async function sweepAllDeadlineReminders(now = new Date()) {
  try {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfTomorrow = startOfToday + 2 * 24 * 60 * 60 * 1000 - 1;

    const assignments = await Assignment.find({
      isPublished: true,
      deadline: { $gte: new Date(now), $lte: new Date(endOfTomorrow) }
    }).populate('classroom', 'name subject students');

    if (!Array.isArray(assignments)) return;

    for (const a of assignments) {
      if (!a.classroom || !Array.isArray(a.classroom.students) || a.classroom.students.length === 0) continue;

      const submissions = await Submission.find({ assignment: a._id }).select('student');
      const submittedStudents = new Set((submissions || []).map(s => (s.student?._id || s.student || '').toString()));

      for (const studentRef of a.classroom.students) {
        const studentId = (studentRef._id || studentRef).toString();
        // Skip submitted students
        if (submittedStudents.has(studentId)) continue;

        await checkAndCreateReminders(studentId, [a], now);
      }
    }
  } catch (err) {
    // Non-fatal logging
  }
}

/**
 * Start background deadline scheduler.
 * Runs sweep on startup and periodically.
 *
 * @param {number} [intervalMs=1800000] - Default: 30 minutes
 */
function startDeadlineScheduler(intervalMs = 30 * 60 * 1000) {
  if (reminderSchedulerTimer) return;

  // Initial sweep
  sweepAllDeadlineReminders().catch(() => {});

  reminderSchedulerTimer = setInterval(() => {
    sweepAllDeadlineReminders().catch(() => {});
  }, intervalMs);

  if (reminderSchedulerTimer.unref) {
    reminderSchedulerTimer.unref();
  }
}

/**
 * Stop background deadline scheduler (for graceful shutdown / tests).
 */
function stopDeadlineScheduler() {
  if (reminderSchedulerTimer) {
    clearInterval(reminderSchedulerTimer);
    reminderSchedulerTimer = null;
  }
}

/**
 * Get all upcoming and pending assignments for a student, with status, colors, and overdue grouping.
 *
 * @param {string|ObjectId} studentId
 * @param {Date} [now=new Date()]
 * @returns {Promise<Object>}
 */
async function getStudentDeadlines(studentId, now = new Date()) {
  const classrooms = await Classroom.find({ students: studentId, isActive: true })
    .select('name subject classCode professor');

  if (!classrooms || classrooms.length === 0) {
    return {
      assignments: [],
      summary: {
        totalPending: 0,
        activeCardsCount: 0,
        dueToday: 0,
        dueTomorrow: 0,
        overdueRecent: 0,
        overdueOlder: 0,
        totalOverdue: 0
      },
      olderOverdueList: []
    };
  }

  const classIds = classrooms.map(c => c._id);

  const assignments = await Assignment.find({ classroom: { $in: classIds }, isPublished: true })
    .populate('classroom', 'name subject classCode')
    .sort('deadline');

  if (!assignments || assignments.length === 0) {
    return {
      assignments: [],
      summary: {
        totalPending: 0,
        activeCardsCount: 0,
        dueToday: 0,
        dueTomorrow: 0,
        overdueRecent: 0,
        overdueOlder: 0,
        totalOverdue: 0
      },
      olderOverdueList: []
    };
  }

  const submissions = await Submission.find({
    student: studentId,
    assignment: { $in: assignments.map(a => a._id) }
  }).select('assignment submittedAt isLate status');

  const submittedSet = new Set((submissions || []).map(s => (s.assignment?._id || s.assignment || '').toString()));

  // Exclude submitted assignments
  const pendingAssignments = assignments.filter(a => !submittedSet.has(a._id.toString()));

  // Trigger in-app reminder checks
  try {
    await checkAndCreateReminders(studentId, pendingAssignments, now);
  } catch (err) {
    // Non-fatal
  }

  const processed = [];
  const olderOverdueList = [];

  let countToday = 0;
  let countTomorrow = 0;
  let countRecentOverdue = 0;
  let countOlderOverdue = 0;

  for (const a of pendingAssignments) {
    const meta = computeDeadlineStatus(a.deadline, now);

    const item = {
      _id: a._id,
      title: a.title,
      description: a.description,
      totalMarks: a.totalMarks,
      deadline: a.deadline,
      classroom: {
        _id: a.classroom ? a.classroom._id : null,
        name: a.classroom ? a.classroom.name : 'Classroom',
        subject: a.classroom ? a.classroom.subject : 'General',
        classCode: a.classroom ? a.classroom.classCode : ''
      },
      ...meta
    };

    if (meta.isOlderOverdue) {
      countOlderOverdue++;
      olderOverdueList.push(item);
    } else {
      processed.push(item);

      if (meta.isToday) countToday++;
      else if (meta.isTomorrow) countTomorrow++;
      else if (meta.isRecentOverdue) countRecentOverdue++;
    }
  }

  // Overdue first, then earliest deadline first
  processed.sort((a, b) => {
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });

  // Older overdue sorted descending (most recent overdue first)
  olderOverdueList.sort((a, b) => new Date(b.deadline).getTime() - new Date(a.deadline).getTime());

  return {
    assignments: processed,
    summary: {
      totalPending: processed.length + olderOverdueList.length,
      activeCardsCount: processed.length,
      dueToday: countToday,
      dueTomorrow: countTomorrow,
      overdueRecent: countRecentOverdue,
      overdueOlder: countOlderOverdue,
      totalOverdue: countRecentOverdue + countOlderOverdue
    },
    olderOverdueList
  };
}

module.exports = {
  computeDeadlineStatus,
  createReminderSafely,
  checkAndCreateReminders,
  sweepAllDeadlineReminders,
  startDeadlineScheduler,
  stopDeadlineScheduler,
  getStudentDeadlines
};
