// routes/academicAnalytics.js
// Academic Performance Analytics Module Endpoints
// Strict role-based authorization: Students can ONLY access their own analytics.

const express = require('express');
const router = express.Router();
const { Classroom, Assignment, Submission } = require('../models');
const { protect, restrictTo } = require('../middleware/auth');
const analyticsService = require('../services/academicAnalyticsService');

// All analytics routes require authentication and are restricted to students
router.use(protect);
router.use(restrictTo('student'));

/**
 * GET /api/academic-analytics/my-performance
 * Returns student's comprehensive academic performance analytics:
 * 1. Overall Performance (obtained / max marks, percentage)
 * 2. Subject-wise Strong/Weak Analysis (with "Insufficient Data" handling)
 * 3. Historical Performance Trend Data
 * 4. Assignment Progress Analysis (total, submitted, pending, evaluated)
 * 5. Available upcoming/pending assignments for What-If simulation
 */
router.get('/my-performance', async (req, res) => {
  try {
    const studentId = req.user._id;

    // 1. Get enrolled active classrooms
    const classrooms = await Classroom.find({ students: studentId, isActive: true })
      .select('name subject classCode professor')
      .populate('professor', 'name email');

    const classIds = classrooms.map(c => c._id);

    // 2. Get all published assignments in these classrooms
    const assignments = await Assignment.find({ classroom: { $in: classIds }, isPublished: true })
      .select('title description classroom professor deadline totalMarks createdAt')
      .populate('classroom', 'name subject classCode')
      .sort('deadline');

    const assignmentIds = assignments.map(a => a._id);

    // 3. Get all submissions by this student for these assignments
    const submissions = await Submission.find({ student: studentId, assignment: { $in: assignmentIds } })
      .populate({
        path: 'assignment',
        select: 'title totalMarks classroom',
        populate: { path: 'classroom', select: 'name subject' }
      })
      .sort('gradedAt submittedAt');

    // Filter evaluated submissions only (status === 'graded' and numerical marks)
    const evaluatedSubmissions = submissions.filter(
      s => (s.status === 'graded' || s.marksObtained !== null) &&
           typeof s.marksObtained === 'number' &&
           s.assignment &&
           typeof s.assignment.totalMarks === 'number'
    );

    // 4. Calculate analytics via service
    const overall = analyticsService.calculateOverallPerformance(evaluatedSubmissions);
    const subjectAnalysis = analyticsService.analyzeSubjects(classrooms, assignments, submissions);
    const trend = analyticsService.generateTrendData(evaluatedSubmissions);
    const progress = analyticsService.calculateProgress(assignments, submissions);

    // 5. Build list of pending/upcoming assignments for What-If simulator
    const submittedAssignIds = new Set(submissions.map(s => s.assignment?._id?.toString() || s.assignment?.toString()));
    const upcomingAssignments = assignments.map(a => {
      const aId = a._id.toString();
      const isSubmitted = submittedAssignIds.has(aId);
      const sub = submissions.find(s => (s.assignment?._id?.toString() || s.assignment?.toString()) === aId);
      const isEvaluated = sub && typeof sub.marksObtained === 'number';

      return {
        _id: a._id,
        title: a.title,
        subject: a.classroom ? a.classroom.subject : 'General',
        classroomName: a.classroom ? a.classroom.name : '',
        totalMarks: a.totalMarks,
        deadline: a.deadline,
        submitted: isSubmitted,
        evaluated: isEvaluated,
        marksObtained: isEvaluated ? sub.marksObtained : null
      };
    });

    res.json({
      success: true,
      data: {
        student: {
          _id: req.user._id,
          name: req.user.name,
          email: req.user.email,
          studentId: req.user.studentId
        },
        overall,
        subjectAnalysis,
        trend,
        progress,
        upcomingAssignments
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/academic-analytics/simulate
 * What-If Score Simulator endpoint:
 * Pure in-memory calculation; NEVER modifies actual database records.
 * Body: {
 *   hypotheticalAssignments: [{ subject, maxMarks, hypotheticalMarks }],
 *   targetPercentage: 80
 * }
 */
router.post('/simulate', async (req, res) => {
  try {
    const studentId = req.user._id;
    const { hypotheticalAssignments = [], targetPercentage = 75 } = req.body;

    if (!Array.isArray(hypotheticalAssignments)) {
      return res.status(400).json({ success: false, message: 'hypotheticalAssignments must be an array.' });
    }

    // Fetch student's current baseline data
    const classrooms = await Classroom.find({ students: studentId, isActive: true }).select('name subject');
    const classIds = classrooms.map(c => c._id);
    const assignments = await Assignment.find({ classroom: { $in: classIds }, isPublished: true }).select('classroom totalMarks');
    const assignmentIds = assignments.map(a => a._id);
    const submissions = await Submission.find({ student: studentId, assignment: { $in: assignmentIds } })
      .populate({ path: 'assignment', select: 'totalMarks classroom' });

    const evaluatedSubmissions = submissions.filter(
      s => (s.status === 'graded' || s.marksObtained !== null) &&
           typeof s.marksObtained === 'number' &&
           s.assignment &&
           typeof s.assignment.totalMarks === 'number'
    );

    const overall = analyticsService.calculateOverallPerformance(evaluatedSubmissions);
    const subjectAnalysis = analyticsService.analyzeSubjects(classrooms, assignments, submissions);

    // Run pure What-If calculation
    const simulation = analyticsService.simulateWhatIf({
      currentOverall: overall,
      currentSubjects: subjectAnalysis.subjects,
      hypotheticalAssignments,
      targetPercentage: Number(targetPercentage) || 75
    });

    res.json({
      success: true,
      simulation
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

