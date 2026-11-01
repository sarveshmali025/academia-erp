// routes/attendance.js - Attendance Module Endpoints
// Role-based access:
// - Professors: Create sessions, update records, view sessions/reports for their classrooms
// - Students: View ONLY their own subject-wise stats, 75% calculator, and date-wise attendance
// - Admins: View overall reports, filter by classroom/professor/date, view session details

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Classroom, User, Attendance } = require('../models');
const { protect, restrictTo } = require('../middleware/auth');

// All attendance routes require authentication
router.use(protect);

// ─────────────────────────────────────────────────────────────
// 1. PROFESSOR / ADMIN: List classrooms available for attendance
// ─────────────────────────────────────────────────────────────
router.get('/classrooms', async (req, res) => {
  try {
    let query = { isActive: true };
    if (req.user.role === 'professor') {
      query.professor = req.user._id;
    }
    const classrooms = await Classroom.find(query)
      .populate('professor', 'name email department')
      .populate('students', 'name email studentId')
      .sort('name');
    res.json({ success: true, classrooms });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 2. PROFESSOR / ADMIN: Get enrolled students of a classroom
// ─────────────────────────────────────────────────────────────
router.get('/classroom/:classroomId/students', async (req, res) => {
  try {
    const { classroomId } = req.params;
    const classroom = await Classroom.findById(classroomId)
      .populate('students', 'name email studentId department');
    if (!classroom || !classroom.isActive) {
      return res.status(404).json({ success: false, message: 'Classroom not found.' });
    }

    if (req.user.role === 'professor' && classroom.professor.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'You are not assigned to this classroom.' });
    }

    res.json({
      success: true,
      classroom: {
        _id: classroom._id,
        name: classroom.name,
        subject: classroom.subject,
        semester: classroom.semester,
        academicYear: classroom.academicYear
      },
      students: classroom.students || []
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 3. PROFESSOR / ADMIN: Record new attendance session
// ─────────────────────────────────────────────────────────────
router.post('/classroom/:classroomId/session', restrictTo('professor', 'admin'), async (req, res) => {
  try {
    const { classroomId } = req.params;
    const { date, slot = '1', topic = '', records = [] } = req.body;

    if (!date) {
      return res.status(400).json({ success: false, message: 'Date is required.' });
    }

    const classroom = await Classroom.findById(classroomId).populate('students', '_id name studentId');
    if (!classroom || !classroom.isActive) {
      return res.status(404).json({ success: false, message: 'Classroom not found.' });
    }

    // Authorization check
    if (req.user.role === 'professor' && classroom.professor.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'You can only mark attendance for your own classrooms.' });
    }

    // Format date key: YYYY-MM-DD
    const sessionDate = new Date(date);
    if (isNaN(sessionDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date provided.' });
    }
    const dateKey = sessionDate.toISOString().split('T')[0];

    // Check duplicate session
    const existingSession = await Attendance.findOne({
      classroom: classroom._id,
      dateKey,
      slot: String(slot).trim()
    });
    if (existingSession) {
      return res.status(409).json({
        success: false,
        message: `An attendance session already exists for this class on ${dateKey} (Slot: ${slot}). You can edit the existing session instead.`
      });
    }

    // Validate that student IDs in records belong to classroom
    const enrolledIds = new Set(classroom.students.map(s => s._id.toString()));
    const finalRecords = [];
    let presentCount = 0;
    let absentCount = 0;

    for (const item of records) {
      const sId = String(item.student || item.studentId || '');
      if (enrolledIds.has(sId)) {
        const status = item.status === 'absent' ? 'absent' : 'present';
        if (status === 'present') presentCount++;
        else absentCount++;

        finalRecords.push({
          student: sId,
          status,
          remarks: item.remarks ? String(item.remarks).trim() : ''
        });
      }
    }

    // If records were empty or partial, auto-fill missing enrolled students as absent
    const processedIds = new Set(finalRecords.map(r => r.student.toString()));
    classroom.students.forEach(s => {
      const sId = s._id.toString();
      if (!processedIds.has(sId)) {
        finalRecords.push({
          student: sId,
          status: 'absent',
          remarks: 'Auto-marked'
        });
        absentCount++;
      }
    });

    const session = await Attendance.create({
      classroom: classroom._id,
      professor: classroom.professor,
      date: sessionDate,
      dateKey,
      slot: String(slot).trim(),
      topic: topic ? String(topic).trim() : '',
      records: finalRecords,
      totalStudents: finalRecords.length,
      presentCount,
      absentCount
    });

    res.status(201).json({
      success: true,
      message: `Attendance marked successfully for ${finalRecords.length} student(s).`,
      session
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Attendance already recorded for this slot and date.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 4. PROFESSOR / ADMIN: Update / correct existing attendance session
// ─────────────────────────────────────────────────────────────
router.patch('/session/:sessionId', restrictTo('professor', 'admin'), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { topic, records } = req.body;

    const session = await Attendance.findById(sessionId).populate('classroom');
    if (!session) {
      return res.status(404).json({ success: false, message: 'Attendance session not found.' });
    }

    if (req.user.role === 'professor' && session.professor.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized to modify this session.' });
    }

    if (topic !== undefined) session.topic = String(topic).trim();

    if (Array.isArray(records)) {
      const recMap = new Map();
      records.forEach(r => {
        const sId = String(r.student || r.studentId || '');
        if (sId) recMap.set(sId, r);
      });

      let presentCount = 0;
      let absentCount = 0;
      session.records.forEach(r => {
        const update = recMap.get(r.student.toString());
        if (update) {
          r.status = update.status === 'absent' ? 'absent' : 'present';
          if (update.remarks !== undefined) r.remarks = String(update.remarks).trim();
        }
        if (r.status === 'present') presentCount++;
        else absentCount++;
      });

      session.presentCount = presentCount;
      session.absentCount = absentCount;
      session.totalStudents = session.records.length;
    }

    await session.save();
    res.json({ success: true, message: 'Attendance updated successfully.', session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 5. PROFESSOR / ADMIN: List date-wise sessions for a classroom
// ─────────────────────────────────────────────────────────────
router.get('/classroom/:classroomId/sessions', async (req, res) => {
  try {
    const { classroomId } = req.params;
    const classroom = await Classroom.findById(classroomId);
    if (!classroom) return res.status(404).json({ success: false, message: 'Classroom not found.' });

    if (req.user.role === 'professor' && classroom.professor.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const sessions = await Attendance.find({ classroom: classroomId })
      .select('-records') // light payload for list
      .sort({ date: -1, slot: -1 });

    res.json({ success: true, sessions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 6. PROFESSOR / ADMIN: View single session detail (with student records)
// ─────────────────────────────────────────────────────────────
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Attendance.findById(sessionId)
      .populate('classroom', 'name subject classCode')
      .populate('professor', 'name email')
      .populate('records.student', 'name email studentId department');
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });

    if (req.user.role === 'professor' && session.professor._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 7. PROFESSOR / ADMIN: Classroom Attendance Matrix & Summary
// ─────────────────────────────────────────────────────────────
router.get('/classroom/:classroomId/report', async (req, res) => {
  try {
    const { classroomId } = req.params;
    const classroom = await Classroom.findById(classroomId)
      .populate('students', 'name email studentId department')
      .populate('professor', 'name email');
    if (!classroom) return res.status(404).json({ success: false, message: 'Classroom not found.' });

    if (req.user.role === 'professor' && classroom.professor._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const sessions = await Attendance.find({ classroom: classroomId }).sort({ date: 1, slot: 1 });
    const conducted = sessions.length;

    // Build per-student aggregate
    const studentStats = (classroom.students || []).map(student => {
      let present = 0;
      let absent = 0;
      sessions.forEach(sess => {
        const rec = (sess.records || []).find(r => r.student.toString() === student._id.toString());
        if (rec) {
          if (rec.status === 'present') present++;
          else absent++;
        } else {
          // If session didn't include this student (e.g. joined late), treat unrecorded
          absent++;
        }
      });

      const calc = Attendance.calculate75(present, conducted);
      return {
        student: {
          _id: student._id,
          name: student.name,
          email: student.email,
          studentId: student.studentId || '—'
        },
        present,
        absent,
        conducted,
        ...calc
      };
    });

    res.json({
      success: true,
      classroom: {
        _id: classroom._id,
        name: classroom.name,
        subject: classroom.subject,
        professor: classroom.professor?.name
      },
      conductedLectures: conducted,
      studentStats
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 8. STUDENT: Own attendance across all enrolled subjects
// ─────────────────────────────────────────────────────────────
router.get('/my-attendance', restrictTo('student'), async (req, res) => {
  try {
    const studentId = req.user._id;

    // Find classrooms the student is enrolled in
    const classrooms = await Classroom.find({ students: studentId, isActive: true })
      .populate('professor', 'name email department')
      .sort('name');

    const subjectAttendance = await Promise.all(
      classrooms.map(async (cls) => {
        const sessions = await Attendance.find({ classroom: cls._id }).sort({ date: -1, slot: -1 });
        const conducted = sessions.length;
        let present = 0;
        let absent = 0;
        const history = [];

        sessions.forEach(sess => {
          const rec = (sess.records || []).find(r => r.student.toString() === studentId.toString());
          const status = rec ? rec.status : 'absent';
          if (status === 'present') present++;
          else absent++;

          history.push({
            sessionId: sess._id,
            date: sess.date,
            dateKey: sess.dateKey,
            slot: sess.slot,
            topic: sess.topic,
            status,
            remarks: rec?.remarks || ''
          });
        });

        const calc = Attendance.calculate75(present, conducted);

        return {
          classroom: {
            _id: cls._id,
            name: cls.name,
            subject: cls.subject,
            classCode: cls.classCode,
            professor: cls.professor?.name || '—'
          },
          conducted,
          present,
          absent,
          ...calc,
          history
        };
      })
    );

    // Compute overall across all enrolled subjects
    const totalConducted = subjectAttendance.reduce((acc, s) => acc + s.conducted, 0);
    const totalPresent = subjectAttendance.reduce((acc, s) => acc + s.present, 0);
    const totalAbsent = subjectAttendance.reduce((acc, s) => acc + s.absent, 0);
    const overallCalc = Attendance.calculate75(totalPresent, totalConducted);

    res.json({
      success: true,
      overall: {
        totalConducted,
        totalPresent,
        totalAbsent,
        ...overallCalc
      },
      subjects: subjectAttendance
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 9. ADMIN: Overall Attendance Reports with filters
// ─────────────────────────────────────────────────────────────
router.get('/admin/overview', restrictTo('admin'), async (req, res) => {
  try {
    const { classroomId, professorId, startDate, endDate } = req.query;

    let filter = {};
    if (classroomId) filter.classroom = classroomId;
    if (professorId) filter.professor = professorId;

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    const sessions = await Attendance.find(filter)
      .populate('classroom', 'name subject classCode')
      .populate('professor', 'name email department')
      .sort({ date: -1 });

    const totalSessions = sessions.length;
    let totalPresent = 0;
    let totalAbsent = 0;
    sessions.forEach(s => {
      totalPresent += s.presentCount || 0;
      totalAbsent += s.absentCount || 0;
    });

    const totalStudentSlots = totalPresent + totalAbsent;
    const overallPercentage = totalStudentSlots > 0
      ? Math.round((totalPresent / totalStudentSlots) * 1000) / 10
      : 100;

    // Classrooms with attendance summary
    const classrooms = await Classroom.find({ isActive: true })
      .populate('professor', 'name email department')
      .select('name subject classCode professor students');

    const classroomSummaries = await Promise.all(
      classrooms.map(async (c) => {
        const cSessions = await Attendance.find({ classroom: c._id });
        const cConducted = cSessions.length;
        let cPres = 0, cAbs = 0;
        cSessions.forEach(s => {
          cPres += s.presentCount || 0;
          cAbs += s.absentCount || 0;
        });
        const cSlots = cPres + cAbs;
        const avgPct = cSlots > 0 ? Math.round((cPres / cSlots) * 1000) / 10 : 100;

        return {
          _id: c._id,
          name: c.name,
          subject: c.subject,
          professor: c.professor?.name || '—',
          enrolledCount: (c.students || []).length,
          conductedLectures: cConducted,
          avgAttendance: avgPct
        };
      })
    );

    res.json({
      success: true,
      stats: {
        totalSessions,
        totalPresent,
        totalAbsent,
        overallPercentage
      },
      sessions: sessions.slice(0, 50), // recent 50 sessions
      classroomSummaries
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

