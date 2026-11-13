// services/academicAnalyticsService.js
// Pure business logic and calculation engine for Academic Performance Analytics.
// Safe, deterministic, and fully testable with zero database side-effects.

/**
 * Calculate overall academic performance across evaluated assignments.
 * Formula: (total obtained marks / total maximum marks) * 100
 *
 * @param {Array} evaluatedSubmissions - Submissions with valid marksObtained and assignment.totalMarks
 * @returns {Object} { obtainedMarks, totalMaxMarks, percentage, evaluatedCount }
 */
function calculateOverallPerformance(evaluatedSubmissions = []) {
  let obtainedMarks = 0;
  let totalMaxMarks = 0;
  let evaluatedCount = 0;

  for (const sub of evaluatedSubmissions) {
    const marks = sub.marksObtained;
    const total = sub.assignment ? sub.assignment.totalMarks : null;

    // Only count if marks are numerical and assignment has valid max marks > 0
    if (typeof marks === 'number' && typeof total === 'number' && total > 0 && !isNaN(marks)) {
      obtainedMarks += marks;
      totalMaxMarks += total;
      evaluatedCount++;
    }
  }

  const percentage = totalMaxMarks > 0
    ? Math.round((obtainedMarks / totalMaxMarks) * 1000) / 10
    : null;

  return {
    obtainedMarks: Math.round(obtainedMarks * 10) / 10,
    totalMaxMarks,
    percentage,
    evaluatedCount
  };
}

/**
 * Analyze performance grouped by subject and identify strong/weak subjects.
 * Threshold: subjects with fewer than 2 evaluated assignments receive "Insufficient Data".
 *
 * @param {Array} enrolledClassrooms - Student's enrolled classrooms
 * @param {Array} publishedAssignments - Published assignments for these classrooms
 * @param {Array} submissions - Student's submissions
 * @param {Object} options - { minEvaluatedThreshold: 2 }
 * @returns {Object} { subjects, strongSubjects, weakSubjects, insufficientDataSubjects }
 */
function analyzeSubjects(enrolledClassrooms = [], publishedAssignments = [], submissions = [], options = {}) {
  const minThreshold = options.minEvaluatedThreshold || 2;

  // Build lookup of submissions by assignmentId
  const subByAssignId = new Map();
  for (const s of submissions) {
    const aId = s.assignment ? (s.assignment._id || s.assignment).toString() : null;
    if (aId) subByAssignId.set(aId, s);
  }

  // Group classrooms and assignments by subject
  const subjectMap = new Map();

  for (const cls of enrolledClassrooms) {
    const subName = cls.subject ? cls.subject.trim() : 'General';
    if (!subjectMap.has(subName)) {
      subjectMap.set(subName, {
        subject: subName,
        classroomIds: [],
        classroomNames: [],
        assignments: [],
        evaluatedSubmissions: []
      });
    }
    const entry = subjectMap.get(subName);
    entry.classroomIds.push(cls._id ? cls._id.toString() : '');
    entry.classroomNames.push(cls.name);
  }

  for (const a of publishedAssignments) {
    const clsId = a.classroom ? (a.classroom._id || a.classroom).toString() : null;
    for (const [subName, entry] of subjectMap.entries()) {
      if (entry.classroomIds.includes(clsId)) {
        entry.assignments.push(a);
        const sub = subByAssignId.get(a._id.toString());
        if (sub && typeof sub.marksObtained === 'number' && (sub.status === 'graded' || sub.marksObtained !== null)) {
          entry.evaluatedSubmissions.push({
            submission: sub,
            assignment: a
          });
        }
        break;
      }
    }
  }

  const subjects = [];

  for (const [subName, data] of subjectMap.entries()) {
    let obtainedMarks = 0;
    let totalMaxMarks = 0;

    for (const item of data.evaluatedSubmissions) {
      obtainedMarks += item.submission.marksObtained;
      totalMaxMarks += item.assignment.totalMarks;
    }

    const evaluatedCount = data.evaluatedSubmissions.length;
    const totalAssignments = data.assignments.length;
    const hasSufficientData = evaluatedCount >= minThreshold;

    const percentage = totalMaxMarks > 0
      ? Math.round((obtainedMarks / totalMaxMarks) * 1000) / 10
      : null;

    subjects.push({
      subject: subName,
      classroomNames: [...new Set(data.classroomNames)],
      obtainedMarks: Math.round(obtainedMarks * 10) / 10,
      totalMaxMarks,
      percentage,
      evaluatedCount,
      totalAssignments,
      pendingCount: totalAssignments - evaluatedCount,
      hasSufficientData,
      status: !hasSufficientData ? 'insufficient_data' : null
    });
  }

  // Classify strong and weak subjects among those with sufficient data
  const eligibleSubjects = subjects.filter(s => s.hasSufficientData && s.percentage !== null);

  let strongSubjects = [];
  let weakSubjects = [];
  const insufficientDataSubjects = subjects.filter(s => !s.hasSufficientData);

  if (eligibleSubjects.length > 0) {
    // Sort descending by percentage
    eligibleSubjects.sort((a, b) => b.percentage - a.percentage);

    const maxPct = eligibleSubjects[0].percentage;
    const minPct = eligibleSubjects[eligibleSubjects.length - 1].percentage;

    eligibleSubjects.forEach(s => {
      // Benchmark logic:
      // Strong: highest score OR >= 75%
      // Weak: lowest score (if lower than highest) OR < 60%
      if (s.percentage === maxPct && (s.percentage >= 70 || eligibleSubjects.length > 1)) {
        s.status = 'strong';
        strongSubjects.push(s);
      } else if (s.percentage === minPct && maxPct !== minPct) {
        s.status = 'weak';
        weakSubjects.push(s);
      } else if (s.percentage >= 75) {
        s.status = 'strong';
        strongSubjects.push(s);
      } else if (s.percentage < 60) {
        s.status = 'weak';
        weakSubjects.push(s);
      } else {
        s.status = 'average';
      }
    });
  }

  return {
    subjects,
    strongSubjects,
    weakSubjects,
    insufficientDataSubjects
  };
}

/**
 * Generate historical chronological performance trend data points.
 *
 * @param {Array} evaluatedSubmissions - Submissions with populated assignment and classroom
 * @returns {Array} Ordered data points with dates, marks, percentages, and assignments
 */
function generateTrendData(evaluatedSubmissions = []) {
  const points = [];

  for (const sub of evaluatedSubmissions) {
    const a = sub.assignment;
    if (!a || typeof sub.marksObtained !== 'number' || !a.totalMarks) continue;

    const dateVal = sub.gradedAt || sub.submittedAt || sub.createdAt || new Date();
    const pct = Math.round((sub.marksObtained / a.totalMarks) * 1000) / 10;

    points.push({
      submissionId: sub._id ? sub._id.toString() : null,
      assignmentId: a._id ? a._id.toString() : null,
      assignmentTitle: a.title || 'Untitled Assignment',
      subject: (a.classroom && a.classroom.subject) || 'General',
      date: new Date(dateVal).toISOString(),
      timestamp: new Date(dateVal).getTime(),
      marksObtained: sub.marksObtained,
      totalMarks: a.totalMarks,
      percentage: pct
    });
  }

  // Sort chronologically ascending
  points.sort((a, b) => a.timestamp - b.timestamp);

  // Compute moving average percentage
  let cumulativeObtained = 0;
  let cumulativeMax = 0;
  points.forEach((pt, index) => {
    cumulativeObtained += pt.marksObtained;
    cumulativeMax += pt.totalMarks;
    pt.cumulativePercentage = cumulativeMax > 0
      ? Math.round((cumulativeObtained / cumulativeMax) * 1000) / 10
      : pt.percentage;
    pt.index = index + 1;
  });

  return points;
}

/**
 * Analyze assignment progress: total, submitted, pending, and evaluated.
 *
 * @param {Array} publishedAssignments - All published assignments in student's classrooms
 * @param {Array} submissions - Student's submissions
 * @returns {Object} Breakdown counts and marks
 */
function calculateProgress(publishedAssignments = [], submissions = []) {
  const total = publishedAssignments.length;

  const subByAssignId = new Map();
  for (const s of submissions) {
    const aId = s.assignment ? (s.assignment._id || s.assignment).toString() : null;
    if (aId) subByAssignId.set(aId, s);
  }

  let submittedCount = 0;
  let evaluatedCount = 0;
  let pendingGradingCount = 0;
  let evaluatedObtainedMarks = 0;
  let evaluatedTotalMaxMarks = 0;

  for (const a of publishedAssignments) {
    const aId = a._id ? a._id.toString() : '';
    const sub = subByAssignId.get(aId);

    if (sub) {
      submittedCount++;
      if (typeof sub.marksObtained === 'number' && (sub.status === 'graded' || sub.marksObtained !== null)) {
        evaluatedCount++;
        evaluatedObtainedMarks += sub.marksObtained;
        evaluatedTotalMaxMarks += (a.totalMarks || 0);
      } else {
        pendingGradingCount++;
      }
    }
  }

  const pendingSubmissionCount = Math.max(0, total - submittedCount);
  const evaluatedPercentage = evaluatedTotalMaxMarks > 0
    ? Math.round((evaluatedObtainedMarks / evaluatedTotalMaxMarks) * 1000) / 10
    : null;

  return {
    total,
    submitted: submittedCount,
    pending: pendingSubmissionCount,
    evaluated: evaluatedCount,
    pendingGrading: pendingGradingCount,
    marksObtained: Math.round(evaluatedObtainedMarks * 10) / 10,
    totalMaxMarks: evaluatedTotalMaxMarks,
    percentage: evaluatedPercentage
  };
}

/**
 * What-If Score Simulator: Calculate projected scores with hypothetical entries.
 * Pure in-memory calculation — never modifies the database.
 *
 * @param {Object} params
 * @param {Object} params.currentOverall - { obtainedMarks, totalMaxMarks }
 * @param {Array} params.currentSubjects - Array of current subject stats
 * @param {Array} params.hypotheticalAssignments - Array of { subject, maxMarks, hypotheticalMarks }
 * @param {number} [params.targetPercentage=75] - Target percentage to evaluate against
 * @returns {Object} Projected metrics and target analysis
 */
function simulateWhatIf({ currentOverall = {}, currentSubjects = [], hypotheticalAssignments = [], targetPercentage = 75 }) {
  const curObtained = Number(currentOverall.obtainedMarks) || 0;
  const curMax = Number(currentOverall.totalMaxMarks) || 0;
  const target = Number(targetPercentage) || 75;

  let hypoTotalObtained = 0;
  let hypoTotalMax = 0;

  // Track hypothetical additions by subject
  const hypoBySubject = new Map();

  for (const item of hypotheticalAssignments) {
    const max = Number(item.maxMarks) || 0;
    // Bounded between 0 and max
    const marks = Math.max(0, Math.min(Number(item.hypotheticalMarks) || 0, max));
    const subName = item.subject ? item.subject.trim() : 'General';

    if (max > 0) {
      hypoTotalObtained += marks;
      hypoTotalMax += max;

      if (!hypoBySubject.has(subName)) {
        hypoBySubject.set(subName, { obtained: 0, max: 0 });
      }
      const e = hypoBySubject.get(subName);
      e.obtained += marks;
      e.max += max;
    }
  }

  const projectedObtained = Math.round((curObtained + hypoTotalObtained) * 10) / 10;
  const projectedMax = curMax + hypoTotalMax;
  const currentPercentage = curMax > 0 ? Math.round((curObtained / curMax) * 1000) / 10 : null;
  const projectedPercentage = projectedMax > 0 ? Math.round((projectedObtained / projectedMax) * 1000) / 10 : 0;
  const deltaPercentage = currentPercentage !== null
    ? Math.round((projectedPercentage - currentPercentage) * 10) / 10
    : projectedPercentage;

  // Target calculation
  const meetsTarget = projectedPercentage >= target;
  const gap = Math.round((target - projectedPercentage) * 10) / 10;

  // Marks needed on upcoming total hypothetical max to reach target
  // (curObtained + needed) / (curMax + hypoTotalMax) >= target / 100
  // needed >= (target/100) * (curMax + hypoTotalMax) - curObtained
  let marksNeededForTarget = null;
  if (hypoTotalMax > 0) {
    const req = Math.ceil(((target / 100) * (curMax + hypoTotalMax) - curObtained) * 10) / 10;
    marksNeededForTarget = Math.max(0, Math.min(req, hypoTotalMax));
  }

  // Subject-wise projected breakdown
  const projectedSubjects = currentSubjects.map(s => {
    const curSubObtained = Number(s.obtainedMarks) || 0;
    const curSubMax = Number(s.totalMaxMarks) || 0;
    const hypo = hypoBySubject.get(s.subject) || { obtained: 0, max: 0 };

    const newSubObtained = Math.round((curSubObtained + hypo.obtained) * 10) / 10;
    const newSubMax = curSubMax + hypo.max;
    const currentSubPct = curSubMax > 0 ? Math.round((curSubObtained / curSubMax) * 1000) / 10 : null;
    const newSubPct = newSubMax > 0 ? Math.round((newSubObtained / newSubMax) * 1000) / 10 : null;
    const subDelta = (currentSubPct !== null && newSubPct !== null)
      ? Math.round((newSubPct - currentSubPct) * 10) / 10
      : 0;

    return {
      subject: s.subject,
      currentPercentage: currentSubPct,
      projectedPercentage: newSubPct,
      deltaPercentage: subDelta,
      currentObtained: curSubObtained,
      currentMax: curSubMax,
      projectedObtained: newSubObtained,
      projectedMax: newSubMax,
      hypotheticalAdded: hypo
    };
  });

  return {
    current: {
      obtainedMarks: curObtained,
      totalMaxMarks: curMax,
      percentage: currentPercentage
    },
    hypothetical: {
      obtainedMarks: Math.round(hypoTotalObtained * 10) / 10,
      totalMaxMarks: hypoTotalMax
    },
    projected: {
      obtainedMarks: projectedObtained,
      totalMaxMarks: projectedMax,
      percentage: projectedPercentage,
      deltaPercentage
    },
    targetAnalysis: {
      targetPercentage: target,
      meetsTarget,
      gap,
      marksNeededForTarget
    },
    projectedSubjects
  };
}

module.exports = {
  calculateOverallPerformance,
  analyzeSubjects,
  generateTrendData,
  calculateProgress,
  simulateWhatIf
};

