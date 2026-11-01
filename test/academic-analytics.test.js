// test/academic-analytics.test.js
// Targeted tests for Academic Performance Analytics module:
// 1. Overall Academic Performance percentage calculations
// 2. Subject-wise Strong/Weak Analysis and Insufficient Data handling
// 3. Performance Trend Graph chronological and cumulative calculations
// 4. Assignment Progress Analysis (total, submitted, pending, evaluated)
// 5. What-If Score Simulator projections and target calculations
// 6. Role-based authorization and student data isolation

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const analyticsService = require('../services/academicAnalyticsService');
const { install, call } = require('../testsupport/harness');

// ─────────────────────────────────────────────────────────────
// 1. SERVICE UNIT TESTS: Pure Calculation Logic
// ─────────────────────────────────────────────────────────────

describe('Feature 1: Overall Academic Performance', () => {

  test('calculates correct percentage = (obtained / max) * 100', () => {
    const evaluated = [
      { marksObtained: 40, assignment: { totalMarks: 50 } },
      { marksObtained: 45, assignment: { totalMarks: 50 } },
      { marksObtained: 85, assignment: { totalMarks: 100 } }
    ];
    // Total obtained: 170, Total max: 200 -> 85.0%
    const res = analyticsService.calculateOverallPerformance(evaluated);
    assert.equal(res.obtainedMarks, 170);
    assert.equal(res.totalMaxMarks, 200);
    assert.equal(res.percentage, 85);
    assert.equal(res.evaluatedCount, 3);
  });

  test('handles zero evaluated assignments gracefully', () => {
    const res = analyticsService.calculateOverallPerformance([]);
    assert.equal(res.obtainedMarks, 0);
    assert.equal(res.totalMaxMarks, 0);
    assert.equal(res.percentage, null);
    assert.equal(res.evaluatedCount, 0);
  });

  test('strictly excludes unevaluated or null marks and zero max marks', () => {
    const submissions = [
      { marksObtained: null, assignment: { totalMarks: 50 } }, // pending evaluation
      { marksObtained: undefined, assignment: { totalMarks: 100 } }, // unevaluated
      { marksObtained: 20, assignment: { totalMarks: 0 } }, // invalid zero max marks
      { marksObtained: 'NaN', assignment: { totalMarks: 50 } }, // invalid NaN
      { marksObtained: 30, assignment: { totalMarks: 40 } } // valid: 30/40 = 75%
    ];
    const res = analyticsService.calculateOverallPerformance(submissions);
    assert.equal(res.obtainedMarks, 30);
    assert.equal(res.totalMaxMarks, 40);
    assert.equal(res.percentage, 75);
    assert.equal(res.evaluatedCount, 1);
  });

  test('handles fractional marks correctly and rounds to 1 decimal place', () => {
    const submissions = [
      { marksObtained: 33.5, assignment: { totalMarks: 50 } },
      { marksObtained: 42.5, assignment: { totalMarks: 50 } }
    ];
    // 76 / 100 = 76.0%
    const res = analyticsService.calculateOverallPerformance(submissions);
    assert.equal(res.obtainedMarks, 76);
    assert.equal(res.totalMaxMarks, 100);
    assert.equal(res.percentage, 76);
  });

});

describe('Feature 2: Subject-wise Strong & Weak Analysis', () => {

  const dummyClassrooms = [
    { _id: 'cls1', name: 'OS A', subject: 'Operating Systems' },
    { _id: 'cls2', name: 'DSA B', subject: 'Data Structures' },
    { _id: 'cls3', name: 'Math C', subject: 'Mathematics' }
  ];

  test('flags "insufficient_data" when subject has fewer than 2 evaluated assignments', () => {
    const assignments = [
      { _id: 'a1', classroom: 'cls1', totalMarks: 50 },
      { _id: 'a2', classroom: 'cls2', totalMarks: 50 },
      { _id: 'a3', classroom: 'cls3', totalMarks: 50 }
    ];
    // Only 1 evaluated assignment in OS, 0 in DSA, 0 in Math
    const submissions = [
      { assignment: 'a1', marksObtained: 48, status: 'graded' }
    ];

    const res = analyticsService.analyzeSubjects(dummyClassrooms, assignments, submissions);
    assert.equal(res.subjects.length, 3);

    const os = res.subjects.find(s => s.subject === 'Operating Systems');
    assert.equal(os.evaluatedCount, 1);
    assert.equal(os.hasSufficientData, false);
    assert.equal(os.status, 'insufficient_data');

    const dsa = res.subjects.find(s => s.subject === 'Data Structures');
    assert.equal(dsa.evaluatedCount, 0);
    assert.equal(dsa.hasSufficientData, false);
    assert.equal(dsa.status, 'insufficient_data');

    assert.equal(res.insufficientDataSubjects.length, 3);
    assert.equal(res.strongSubjects.length, 0);
    assert.equal(res.weakSubjects.length, 0);
  });

  test('identifies strong and weak subjects when sufficient data (>= 2) is available', () => {
    const assignments = [
      // OS: 2 assignments -> 45/50 (90%) and 45/50 (90%) => 90% (Strong)
      { _id: 'os1', classroom: 'cls1', totalMarks: 50 },
      { _id: 'os2', classroom: 'cls1', totalMarks: 50 },
      // DSA: 2 assignments -> 25/50 (50%) and 20/50 (40%) => 45% (Weak)
      { _id: 'dsa1', classroom: 'cls2', totalMarks: 50 },
      { _id: 'dsa2', classroom: 'cls2', totalMarks: 50 },
      // Math: 1 assignment -> Insufficient
      { _id: 'm1', classroom: 'cls3', totalMarks: 50 }
    ];

    const submissions = [
      { assignment: 'os1', marksObtained: 45, status: 'graded' },
      { assignment: 'os2', marksObtained: 45, status: 'graded' },
      { assignment: 'dsa1', marksObtained: 25, status: 'graded' },
      { assignment: 'dsa2', marksObtained: 20, status: 'graded' },
      { assignment: 'm1', marksObtained: 50, status: 'graded' } // 1 assignment -> insufficient
    ];

    const res = analyticsService.analyzeSubjects(dummyClassrooms, assignments, submissions);

    const os = res.subjects.find(s => s.subject === 'Operating Systems');
    assert.equal(os.hasSufficientData, true);
    assert.equal(os.percentage, 90);
    assert.equal(os.status, 'strong');

    const dsa = res.subjects.find(s => s.subject === 'Data Structures');
    assert.equal(dsa.hasSufficientData, true);
    assert.equal(dsa.percentage, 45);
    assert.equal(dsa.status, 'weak');

    const math = res.subjects.find(s => s.subject === 'Mathematics');
    assert.equal(math.hasSufficientData, false);
    assert.equal(math.status, 'insufficient_data');

    assert.equal(res.strongSubjects.length, 1);
    assert.equal(res.strongSubjects[0].subject, 'Operating Systems');
    assert.equal(res.weakSubjects.length, 1);
    assert.equal(res.weakSubjects[0].subject, 'Data Structures');
  });

});

describe('Feature 3: Performance Trend Graph', () => {

  test('sorts evaluated assignments chronologically and calculates cumulative moving average', () => {
    const t1 = new Date('2026-09-01T10:00:00Z');
    const t2 = new Date('2026-09-15T10:00:00Z');
    const t3 = new Date('2026-10-01T10:00:00Z');

    const evaluated = [
      // Deliberately unsorted in input
      {
        _id: 'sub3',
        gradedAt: t3,
        marksObtained: 90,
        assignment: { _id: 'a3', title: 'Assignment 3', totalMarks: 100, classroom: { subject: 'OS' } }
      },
      {
        _id: 'sub1',
        gradedAt: t1,
        marksObtained: 30,
        assignment: { _id: 'a1', title: 'Assignment 1', totalMarks: 50, classroom: { subject: 'OS' } }
      },
      {
        _id: 'sub2',
        gradedAt: t2,
        marksObtained: 40,
        assignment: { _id: 'a2', title: 'Assignment 2', totalMarks: 50, classroom: { subject: 'DSA' } }
      }
    ];

    const trend = analyticsService.generateTrendData(evaluated);
    assert.equal(trend.length, 3);

    // Verify chronological ascending order
    assert.equal(trend[0].assignmentTitle, 'Assignment 1');
    assert.equal(trend[0].percentage, 60); // 30/50 = 60%
    assert.equal(trend[0].cumulativePercentage, 60);

    assert.equal(trend[1].assignmentTitle, 'Assignment 2');
    assert.equal(trend[1].percentage, 80); // 40/50 = 80%
    // Cumulative at pt 2: (30 + 40) / (50 + 50) = 70/100 = 70%
    assert.equal(trend[1].cumulativePercentage, 70);

    assert.equal(trend[2].assignmentTitle, 'Assignment 3');
    assert.equal(trend[2].percentage, 90); // 90/100 = 90%
    // Cumulative at pt 3: (70 + 90) / (100 + 100) = 160/200 = 80%
    assert.equal(trend[2].cumulativePercentage, 80);
  });

  test('returns empty array when no evaluated assignments exist', () => {
    const trend = analyticsService.generateTrendData([]);
    assert.deepEqual(trend, []);
  });

});

describe('Feature 4: Assignment Progress Analysis', () => {

  test('accurately partitions total, submitted, pending, and evaluated assignments', () => {
    const assignments = [
      { _id: 'a1', totalMarks: 50 },
      { _id: 'a2', totalMarks: 50 },
      { _id: 'a3', totalMarks: 100 },
      { _id: 'a4', totalMarks: 100 }
    ];

    const submissions = [
      { assignment: 'a1', status: 'graded', marksObtained: 45 },    // evaluated
      { assignment: 'a2', status: 'submitted', marksObtained: null }, // submitted, pending grading
      { assignment: 'a3', status: 'graded', marksObtained: 80 }     // evaluated
      // a4 is not in submissions -> pending submission
    ];

    const progress = analyticsService.calculateProgress(assignments, submissions);
    assert.equal(progress.total, 4);
    assert.equal(progress.submitted, 3);
    assert.equal(progress.pending, 1);
    assert.equal(progress.evaluated, 2);
    assert.equal(progress.pendingGrading, 1);
    assert.equal(progress.marksObtained, 125); // 45 + 80
    assert.equal(progress.totalMaxMarks, 150); // 50 + 100
    // 125 / 150 = 83.3%
    assert.equal(progress.percentage, 83.3);
  });

});

describe('Feature 5: What-If Score Simulator', () => {

  const currentOverall = {
    obtainedMarks: 140,
    totalMaxMarks: 200,
    percentage: 70
  };

  const currentSubjects = [
    { subject: 'Operating Systems', obtainedMarks: 80, totalMaxMarks: 100, percentage: 80 },
    { subject: 'Data Structures', obtainedMarks: 60, totalMaxMarks: 100, percentage: 60 }
  ];

  test('projects overall and subject percentages without mutating current stats', () => {
    const hypotheticalAssignments = [
      { subject: 'Operating Systems', maxMarks: 50, hypotheticalMarks: 45 },
      { subject: 'Data Structures', maxMarks: 50, hypotheticalMarks: 35 }
    ];

    const sim = analyticsService.simulateWhatIf({
      currentOverall,
      currentSubjects,
      hypotheticalAssignments,
      targetPercentage: 75
    });

    // New Total: (140 + 45 + 35) / (200 + 50 + 50) = 220 / 300 = 73.3%
    assert.equal(sim.projected.obtainedMarks, 220);
    assert.equal(sim.projected.totalMaxMarks, 300);
    assert.equal(sim.projected.percentage, 73.3);
    assert.equal(sim.projected.deltaPercentage, 3.3); // +3.3% gain

    // Target analysis: target 75%
    assert.equal(sim.targetAnalysis.targetPercentage, 75);
    assert.equal(sim.targetAnalysis.meetsTarget, false); // 73.3 < 75
    assert.equal(sim.targetAnalysis.gap, 1.7); // 75 - 73.3 = 1.7% gap

    // Marks needed to reach 75% on 300 total marks:
    // 0.75 * 300 - 140 = 225 - 140 = 85 marks needed across the 100 hypothetical marks
    assert.equal(sim.targetAnalysis.marksNeededForTarget, 85);

    // Subject breakdown
    const os = sim.projectedSubjects.find(s => s.subject === 'Operating Systems');
    // OS new: (80 + 45) / (100 + 50) = 125 / 150 = 83.3%
    assert.equal(os.projectedPercentage, 83.3);
    assert.equal(os.deltaPercentage, 3.3);

    // Ensure baseline inputs were not mutated
    assert.equal(currentOverall.obtainedMarks, 140);
    assert.equal(currentOverall.totalMaxMarks, 200);
  });

  test('reports meetsTarget = true when projected score reaches target', () => {
    const hypotheticalAssignments = [
      { subject: 'Operating Systems', maxMarks: 50, hypotheticalMarks: 50 },
      { subject: 'Data Structures', maxMarks: 50, hypotheticalMarks: 50 }
    ];
    // New Total: (140 + 100) / 300 = 240 / 300 = 80.0%
    const sim = analyticsService.simulateWhatIf({
      currentOverall,
      currentSubjects,
      hypotheticalAssignments,
      targetPercentage: 75
    });

    assert.equal(sim.projected.percentage, 80);
    assert.equal(sim.targetAnalysis.meetsTarget, true);
    assert.equal(sim.targetAnalysis.gap, -5); // 5% above target
  });

  test('bounds hypothetical marks within 0 and maxMarks', () => {
    const hypotheticalAssignments = [
      { subject: 'OS', maxMarks: 50, hypotheticalMarks: 100 }, // exceeds max
      { subject: 'DSA', maxMarks: 50, hypotheticalMarks: -20 } // negative
    ];
    const sim = analyticsService.simulateWhatIf({
      currentOverall: { obtainedMarks: 0, totalMaxMarks: 0 },
      currentSubjects: [],
      hypotheticalAssignments
    });

    // 50 (capped from 100) + 0 (floored from -20) = 50 / 100 = 50.0%
    assert.equal(sim.projected.obtainedMarks, 50);
    assert.equal(sim.projected.totalMaxMarks, 100);
    assert.equal(sim.projected.percentage, 50);
  });

});

// ─────────────────────────────────────────────────────────────
// 2. API ROUTE INTEGRATION & ROLE-BASED ACCESS TESTS
// ─────────────────────────────────────────────────────────────

describe('Feature 6: API Role-Based Authorization and Data Isolation', () => {

  const STU_ID = 'stu_test_1';
  const PROF_ID = 'prof_test_1';
  const ADMIN_ID = 'admin_test_1';
  const CLS_ID = 'cls_test_1';
  const ASG_ID = 'asg_test_1';

  const users = {
    [STU_ID]: { _id: STU_ID, role: 'student', name: 'Student Test', email: 'stu@test.edu', isActive: true },
    [PROF_ID]: { _id: PROF_ID, role: 'professor', name: 'Prof Test', email: 'prof@test.edu', isActive: true },
    [ADMIN_ID]: { _id: ADMIN_ID, role: 'admin', name: 'Admin Test', email: 'admin@test.edu', isActive: true }
  };

  const classrooms = [
    {
      _id: CLS_ID,
      name: 'Class 101',
      subject: 'Operating Systems',
      classCode: 'OS101',
      isActive: true,
      students: [STU_ID],
      professor: { _id: PROF_ID, name: 'Prof Test', email: 'prof@test.edu' }
    }
  ];

  const assignments = [
    {
      _id: ASG_ID,
      title: 'Lab 1 Process Scheduling',
      classroom: { _id: CLS_ID, name: 'Class 101', subject: 'Operating Systems', classCode: 'OS101' },
      professor: PROF_ID,
      totalMarks: 50,
      deadline: new Date(Date.now() + 86400000),
      isPublished: true,
      createdAt: new Date()
    }
  ];

  const submissions = [
    {
      _id: 'sub_test_1',
      assignment: { _id: ASG_ID, title: 'Lab 1 Process Scheduling', totalMarks: 50, classroom: { name: 'Class 101', subject: 'Operating Systems' } },
      student: STU_ID,
      marksObtained: 45,
      status: 'graded',
      gradedAt: new Date()
    }
  ];

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
      find: () => q(submissions)
    }
  };

  let env, analyticsRouter;

  before(() => {
    env = install({ users, models: fakeModels });
    analyticsRouter = require('../routes/academicAnalytics');
  });

  after(() => {
    env.restore();
  });

  test('GET /my-performance — rejects unauthenticated request (401)', async () => {
    const res = await call(analyticsRouter, 'GET', '/my-performance');
    assert.equal(res.status, 401);
  });

  test('GET /my-performance — rejects professor (403)', async () => {
    const res = await call(analyticsRouter, 'GET', '/my-performance', { token: PROF_ID });
    assert.equal(res.status, 403);
  });

  test('GET /my-performance — rejects admin (403)', async () => {
    const res = await call(analyticsRouter, 'GET', '/my-performance', { token: ADMIN_ID });
    assert.equal(res.status, 403);
  });

  test('GET /my-performance — allows enrolled student (200) with full analytics data', async () => {
    const res = await call(analyticsRouter, 'GET', '/my-performance', { token: STU_ID });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data);

    // Verify presence of all 5 features in payload
    assert.ok(res.body.data.overall, 'Feature 1: overall present');
    assert.equal(res.body.data.overall.percentage, 90); // 45/50 = 90%

    assert.ok(res.body.data.subjectAnalysis, 'Feature 2: subjectAnalysis present');
    assert.ok(Array.isArray(res.body.data.subjectAnalysis.subjects));

    assert.ok(res.body.data.trend, 'Feature 3: trend present');
    assert.ok(Array.isArray(res.body.data.trend));

    assert.ok(res.body.data.progress, 'Feature 4: progress present');
    assert.equal(res.body.data.progress.total, 1);
    assert.equal(res.body.data.progress.evaluated, 1);

    assert.ok(res.body.data.upcomingAssignments, 'Feature 5: upcomingAssignments for simulator present');
  });

  test('POST /simulate — rejects non-student (403)', async () => {
    const res = await call(analyticsRouter, 'POST', '/simulate', {
      token: PROF_ID,
      body: { hypotheticalAssignments: [] }
    });
    assert.equal(res.status, 403);
  });

  test('POST /simulate — allows student (200) and computes projected score without DB write', async () => {
    const res = await call(analyticsRouter, 'POST', '/simulate', {
      token: STU_ID,
      body: {
        hypotheticalAssignments: [
          { subject: 'Operating Systems', maxMarks: 50, hypotheticalMarks: 45 }
        ],
        targetPercentage: 85
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.simulation);
    assert.equal(res.body.simulation.projected.percentage, 90); // (45 + 45) / (50 + 50) = 90%
    assert.equal(res.body.simulation.targetAnalysis.meetsTarget, true);
  });

  test('POST /simulate — rejects invalid non-array payload (400)', async () => {
    const res = await call(analyticsRouter, 'POST', '/simulate', {
      token: STU_ID,
      body: { hypotheticalAssignments: 'not-an-array' }
    });
    assert.equal(res.status, 400);
  });

});
