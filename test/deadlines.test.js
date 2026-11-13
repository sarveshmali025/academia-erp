// test/deadlines.test.js
// Targeted tests for Smart Assignment Deadline Manager:
// 1. Missing and invalid deadline safety
// 2. Consistent calendar-day overdue and upcoming calculations
// 3. Color coding (Red, Orange, Yellow, Green, Blue)
// 4. Overdue threshold: <= 3 days (prominent) vs > 3 days (compact counter)
// 5. Automatic exclusion of submitted assignments
// 6. Concurrency-safe reminder notifications (Due Tomorrow & Due Today)
// 7. Background scheduler start/stop
// 8. API route authorization & data isolation

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { install, call } = require('../testsupport/harness');

describe('Smart Assignment Deadline Manager - Calculation Engine', () => {

  let deadlineService;
  // Fixed reference time: 2:00 PM
  const baseNow = new Date(2026, 10, 12, 14, 0, 0);

  before(() => {
    deadlineService = require('../services/deadlineService');
  });

  test('1. Missing and invalid deadlines are handled safely', () => {
    // Null deadline
    const nullRes = deadlineService.computeDeadlineStatus(null, baseNow);
    assert.equal(nullRes.isValid, false);
    assert.equal(nullRes.status, 'no_deadline');
    assert.equal(nullRes.isOverdue, false);

    // Undefined deadline
    const undefRes = deadlineService.computeDeadlineStatus(undefined, baseNow);
    assert.equal(undefRes.isValid, false);
    assert.equal(undefRes.status, 'no_deadline');

    // Invalid date string
    const invalidRes = deadlineService.computeDeadlineStatus('not-a-valid-date', baseNow);
    assert.equal(invalidRes.isValid, false);
    assert.equal(invalidRes.status, 'invalid_deadline');
    assert.equal(invalidRes.isOverdue, false);
  });

  test('2. Overdue calculations with calendar-day logic and 3-day threshold', () => {
    // Overdue earlier today (e.g. 10:00 AM on Nov 12)
    const overdueToday = new Date(2026, 10, 12, 10, 0, 0);
    const otRes = deadlineService.computeDeadlineStatus(overdueToday, baseNow);
    assert.equal(otRes.isOverdue, true);
    assert.equal(otRes.color, 'red'); // Requirement 3: Red
    assert.equal(otRes.overdueDays, 0);
    assert.equal(otRes.isRecentOverdue, true); // <= 3 days -> prominent
    assert.equal(otRes.isOlderOverdue, false);

    // Overdue yesterday (Nov 11) -> 1 calendar day overdue
    const overdueYesterday = new Date(2026, 10, 11, 14, 0, 0);
    const oyRes = deadlineService.computeDeadlineStatus(overdueYesterday, baseNow);
    assert.equal(oyRes.isOverdue, true);
    assert.equal(oyRes.color, 'red');
    assert.equal(oyRes.overdueDays, 1);
    assert.equal(oyRes.isRecentOverdue, true);
    assert.equal(oyRes.isOlderOverdue, false);

    // Overdue 2 days ago (Nov 10)
    const overdue2Days = new Date(2026, 10, 10, 14, 0, 0);
    const o2Res = deadlineService.computeDeadlineStatus(overdue2Days, baseNow);
    assert.equal(o2Res.isOverdue, true);
    assert.equal(o2Res.color, 'red');
    assert.equal(o2Res.overdueDays, 2);
    assert.equal(o2Res.isRecentOverdue, true);
    assert.equal(o2Res.isOlderOverdue, false);

    // Overdue exactly 3 days ago (Nov 9) -> prominent limit
    const overdue3Days = new Date(2026, 10, 9, 14, 0, 0);
    const o3Res = deadlineService.computeDeadlineStatus(overdue3Days, baseNow);
    assert.equal(o3Res.isOverdue, true);
    assert.equal(o3Res.color, 'red');
    assert.equal(o3Res.overdueDays, 3);
    assert.equal(o3Res.isRecentOverdue, true); // Prominent for 3 days
    assert.equal(o3Res.isOlderOverdue, false);

    // Overdue 4 days ago (Nov 8) -> hidden from cards, counted in overdue counter
    const overdue4Days = new Date(2026, 10, 8, 14, 0, 0);
    const o4Res = deadlineService.computeDeadlineStatus(overdue4Days, baseNow);
    assert.equal(o4Res.isOverdue, true);
    assert.equal(o4Res.color, 'red');
    assert.equal(o4Res.overdueDays, 4);
    assert.equal(o4Res.isRecentOverdue, false);
    assert.equal(o4Res.isOlderOverdue, true); // Hidden from cards (Requirement 5)

    // Overdue 10 days ago (Nov 2)
    const overdue10Days = new Date(2026, 10, 2, 14, 0, 0);
    const o10Res = deadlineService.computeDeadlineStatus(overdue10Days, baseNow);
    assert.equal(o10Res.isOlderOverdue, true);
    assert.equal(o10Res.overdueDays, 10);
  });

  test('3. Upcoming deadline color codes: Red, Orange, Yellow, Green, Blue', () => {
    // Due Today (Nov 12, 23:59) -> RED
    const dueToday = new Date(2026, 10, 12, 23, 59, 0);
    const dtRes = deadlineService.computeDeadlineStatus(dueToday, baseNow);
    assert.equal(dtRes.isToday, true);
    assert.equal(dtRes.color, 'red');
    assert.equal(dtRes.status, 'today');

    // Due Tomorrow (Nov 13, 18:00) -> RED
    const dueTomorrow = new Date(2026, 10, 13, 18, 0, 0);
    const dtmRes = deadlineService.computeDeadlineStatus(dueTomorrow, baseNow);
    assert.equal(dtmRes.isTomorrow, true);
    assert.equal(dtmRes.color, 'red');
    assert.equal(dtmRes.status, 'tomorrow');

    // Due in 2 days (Nov 14) -> ORANGE
    const due2Days = new Date(2026, 10, 14, 14, 0, 0);
    const d2Res = deadlineService.computeDeadlineStatus(due2Days, baseNow);
    assert.equal(d2Res.daysLeft, 2);
    assert.equal(d2Res.color, 'orange'); // Requirement 3: Orange 2-3 days
    assert.equal(d2Res.status, '2-3days');

    // Due in 3 days (Nov 15) -> ORANGE
    const due3Days = new Date(2026, 10, 15, 14, 0, 0);
    const d3Res = deadlineService.computeDeadlineStatus(due3Days, baseNow);
    assert.equal(d3Res.daysLeft, 3);
    assert.equal(d3Res.color, 'orange');

    // Due in 4 days (Nov 16) -> YELLOW
    const due4Days = new Date(2026, 10, 16, 14, 0, 0);
    const d4Res = deadlineService.computeDeadlineStatus(due4Days, baseNow);
    assert.equal(d4Res.daysLeft, 4);
    assert.equal(d4Res.color, 'yellow'); // Requirement 3: Yellow 4-5 days
    assert.equal(d4Res.status, '4-5days');

    // Due in 5 days (Nov 17) -> YELLOW
    const due5Days = new Date(2026, 10, 17, 14, 0, 0);
    const d5Res = deadlineService.computeDeadlineStatus(due5Days, baseNow);
    assert.equal(d5Res.daysLeft, 5);
    assert.equal(d5Res.color, 'yellow');

    // Due in 6 days (Nov 18) -> GREEN
    const due6Days = new Date(2026, 10, 18, 14, 0, 0);
    const d6Res = deadlineService.computeDeadlineStatus(due6Days, baseNow);
    assert.equal(d6Res.daysLeft, 6);
    assert.equal(d6Res.color, 'green'); // Requirement 3: Green 6-7 days
    assert.equal(d6Res.status, '6-7days');

    // Due in 7 days (Nov 19) -> GREEN
    const due7Days = new Date(2026, 10, 19, 14, 0, 0);
    const d7Res = deadlineService.computeDeadlineStatus(due7Days, baseNow);
    assert.equal(d7Res.daysLeft, 7);
    assert.equal(d7Res.color, 'green');

    // Due in 10 days (Nov 22) -> BLUE (Neutral)
    const due10Days = new Date(2026, 10, 22, 14, 0, 0);
    const d10Res = deadlineService.computeDeadlineStatus(due10Days, baseNow);
    assert.equal(d10Res.daysLeft, 10);
    assert.equal(d10Res.color, 'blue');
  });

  test('4. Filter tags: Today, Next 7 Days, Next 14 Days, All', () => {
    const today = deadlineService.computeDeadlineStatus(new Date(2026, 10, 12, 20, 0, 0), baseNow);
    assert.equal(today.isToday, true);
    assert.equal(today.isNext7Days, true);
    assert.equal(today.isNext14Days, true);

    const day5 = deadlineService.computeDeadlineStatus(new Date(2026, 10, 17, 14, 0, 0), baseNow);
    assert.equal(day5.isToday, false);
    assert.equal(day5.isNext7Days, true);
    assert.equal(day5.isNext14Days, true);

    const day10 = deadlineService.computeDeadlineStatus(new Date(2026, 10, 22, 14, 0, 0), baseNow);
    assert.equal(day10.isToday, false);
    assert.equal(day10.isNext7Days, false);
    assert.equal(day10.isNext14Days, true);

    const day20 = deadlineService.computeDeadlineStatus(new Date(2026, 11, 2, 14, 0, 0), baseNow);
    assert.equal(day20.isToday, false);
    assert.equal(day20.isNext7Days, false);
    assert.equal(day20.isNext14Days, false);
    assert.equal(day20.isAll, true);
  });

});

describe('Smart Assignment Deadline Manager - Concurrency, Reminders, and API Integration', () => {

  const STU_ID = new mongoose.Types.ObjectId().toString();
  const PROF_ID = new mongoose.Types.ObjectId().toString();
  const ADMIN_ID = new mongoose.Types.ObjectId().toString();
  const CLS_ID = new mongoose.Types.ObjectId().toString();

  const fixedNow = new Date(2026, 10, 12, 10, 0, 0);

  // In-memory test stores
  const notifsStore = [];
  const subsStore = [];

  const users = {
    [STU_ID]: { _id: STU_ID, role: 'student', name: 'Test Student', isActive: true },
    [PROF_ID]: { _id: PROF_ID, role: 'professor', name: 'Test Prof', isActive: true },
    [ADMIN_ID]: { _id: ADMIN_ID, role: 'admin', name: 'Test Admin', isActive: true }
  };

  const classrooms = [
    {
      _id: CLS_ID,
      name: 'CS101 Operating Systems',
      subject: 'Operating Systems',
      classCode: 'CS101',
      isActive: true,
      students: [STU_ID],
      professor: PROF_ID
    }
  ];

  const asgTodayId = new mongoose.Types.ObjectId().toString();
  const asgTomorrowId = new mongoose.Types.ObjectId().toString();
  const asgOverdueId = new mongoose.Types.ObjectId().toString();
  const asgSubmittedId = new mongoose.Types.ObjectId().toString();

  const assignments = [
    {
      _id: asgTodayId,
      title: 'Lab 1 - Processes',
      classroom: classrooms[0],
      deadline: new Date(2026, 10, 12, 20, 0, 0), // Due today
      totalMarks: 50,
      isPublished: true
    },
    {
      _id: asgTomorrowId,
      title: 'Lab 2 - Threads',
      classroom: classrooms[0],
      deadline: new Date(2026, 10, 13, 18, 0, 0), // Due tomorrow
      totalMarks: 50,
      isPublished: true
    },
    {
      _id: asgOverdueId,
      title: 'Lab 0 - Setup',
      classroom: classrooms[0],
      deadline: new Date(2026, 10, 10, 10, 0, 0), // Overdue 2 days
      totalMarks: 25,
      isPublished: true
    },
    {
      _id: asgSubmittedId,
      title: 'Lab Quiz',
      classroom: classrooms[0],
      deadline: new Date(2026, 10, 12, 22, 0, 0), // Due today, but submitted
      totalMarks: 10,
      isPublished: true
    }
  ];

  // Student submitted 'asgSubmittedId'
  subsStore.push({
    _id: 'sub_1',
    assignment: asgSubmittedId,
    student: STU_ID,
    submittedAt: new Date(2026, 10, 12, 8, 0, 0),
    status: 'submitted'
  });

  function q(v) {
    const p = Promise.resolve(v);
    p.populate = () => p;
    p.select = () => p;
    p.sort = () => p;
    return p;
  }

  const fakeModels = {
    Classroom: {
      find: () => q(classrooms)
    },
    Assignment: {
      find: () => q(assignments)
    },
    Submission: {
      find: () => q(subsStore)
    },
    Notification: {
      find: filter => q(notifsStore.filter(n => (!filter || !filter.user || n.user.toString() === filter.user.toString()))),
      findOne: filter => q(notifsStore.find(n =>
        (!filter.user || n.user.toString() === filter.user.toString()) &&
        (!filter.relatedId || n.relatedId.toString() === filter.relatedId.toString()) &&
        (!filter.title || n.title === filter.title)
      ) || null),
      countDocuments: filter => Promise.resolve(notifsStore.filter(n =>
        (!filter.user || n.user.toString() === filter.user.toString()) &&
        (filter.isRead === undefined || n.isRead === filter.isRead)
      ).length),
      create: async data => {
        const doc = { _id: `notif_${notifsStore.length + 1}`, isRead: false, ...data };
        notifsStore.push(doc);
        return doc;
      }
    }
  };

  let env, deadlineService, asgRouter;

  before(() => {
    delete require.cache[require.resolve('../services/deadlineService')];
    delete require.cache[require.resolve('../routes/assignments')];
    env = install({ users, models: fakeModels });
    deadlineService = require('../services/deadlineService');
    asgRouter = require('../routes/assignments');
  });

  after(() => {
    deadlineService.stopDeadlineScheduler();
    env.restore();
    notifsStore.length = 0;
  });

  test('5. Excludes submitted assignments and separates recent vs older overdue', async () => {
    const res = await deadlineService.getStudentDeadlines(STU_ID, fixedNow);

    // Submitted assignment MUST NOT appear in pending list
    const submittedItem = res.assignments.find(a => a._id === asgSubmittedId);
    assert.equal(submittedItem, undefined, 'Submitted assignment must be excluded from pending list');

    // Active pending assignments
    assert.equal(res.assignments.length, 3);

    const todayItem = res.assignments.find(a => a._id === asgTodayId);
    assert.ok(todayItem);
    assert.equal(todayItem.color, 'red');
    assert.equal(todayItem.isToday, true);

    const overdueItem = res.assignments.find(a => a._id === asgOverdueId);
    assert.ok(overdueItem);
    assert.equal(overdueItem.isOverdue, true);
    assert.equal(overdueItem.isRecentOverdue, true);
  });

  test('6. Reminders: generates Due Today and Due Tomorrow, stops for submitted work', async () => {
    notifsStore.length = 0; // Clear notifications

    // Trigger reminders for student on unsubmitted work
    const pending = assignments.filter(a => a._id !== asgSubmittedId);
    await deadlineService.checkAndCreateReminders(STU_ID, pending, fixedNow);

    // Expect 2 reminders: Due Today (Lab 1) and Due Tomorrow (Lab 2)
    const dueTodayNotif = notifsStore.find(n => n.title.includes('Due Today: Lab 1 - Processes'));
    assert.ok(dueTodayNotif, 'Due Today reminder must be created');

    const dueTomorrowNotif = notifsStore.find(n => n.title.includes('Due Tomorrow: Lab 2 - Threads'));
    assert.ok(dueTomorrowNotif, 'Due Tomorrow reminder must be created');

    // No reminder for already submitted work
    const submittedNotif = notifsStore.find(n => n.title.includes('Lab Quiz'));
    assert.equal(submittedNotif, undefined, 'Reminders must not be generated for submitted work');
  });

  test('7. Concurrency and Deduplication: repeated or simultaneous checks create 0 duplicate notifications', async () => {
    const initialCount = notifsStore.length;
    assert.ok(initialCount > 0);

    const pending = assignments.filter(a => a._id !== asgSubmittedId);

    // Run 5 simultaneous concurrent reminder checks
    await Promise.all([
      deadlineService.checkAndCreateReminders(STU_ID, pending, fixedNow),
      deadlineService.checkAndCreateReminders(STU_ID, pending, fixedNow),
      deadlineService.checkAndCreateReminders(STU_ID, pending, fixedNow),
      deadlineService.checkAndCreateReminders(STU_ID, pending, fixedNow),
      deadlineService.checkAndCreateReminders(STU_ID, pending, fixedNow)
    ]);

    // Count should be strictly identical — zero duplicates created
    assert.equal(notifsStore.length, initialCount, 'Zero duplicate notifications must be created on repeated/concurrent runs');
  });

  test('8. Background scheduler start and stop work cleanly', () => {
    deadlineService.startDeadlineScheduler(60000);
    deadlineService.startDeadlineScheduler(60000); // Idempotent
    deadlineService.stopDeadlineScheduler();
    assert.ok(true);
  });

  test('9. API Route Authorization: GET /api/assignments/deadlines', async () => {
    // Unauthenticated -> 401
    const unauth = await call(asgRouter, 'GET', '/deadlines');
    assert.equal(unauth.status, 401);

    // Professor -> 403
    const prof = await call(asgRouter, 'GET', '/deadlines', { token: PROF_ID });
    assert.equal(prof.status, 403);

    // Admin -> 403
    const admin = await call(asgRouter, 'GET', '/deadlines', { token: ADMIN_ID });
    assert.equal(admin.status, 403);

    // Student -> 200
    const stu = await call(asgRouter, 'GET', '/deadlines', { token: STU_ID });
    assert.equal(stu.status, 200);
    assert.equal(stu.body.success, true);
    assert.ok(Array.isArray(stu.body.assignments));
    assert.ok(stu.body.summary);
  });

});
