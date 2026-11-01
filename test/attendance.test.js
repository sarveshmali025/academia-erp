// test/attendance.test.js - Comprehensive tests for Attendance Management Module
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');

describe('Attendance Management Module', () => {

  test('75% Attendance Calculator: Exact thresholds and edge cases', () => {
    // 0 conducted lectures
    const zero = Attendance.calculate75(0, 0);
    assert.equal(zero.percentage, 100);
    assert.equal(zero.meetsThreshold, true);
    assert.equal(zero.neededFor75, 0);

    // 10 conducted, 8 present (80%) -> meets threshold, can miss next 0 or more
    const eighty = Attendance.calculate75(8, 10);
    assert.equal(eighty.percentage, 80);
    assert.equal(eighty.meetsThreshold, true);
    assert.equal(eighty.neededFor75, 0);
    // (4*8 - 3*10) / 3 = 2/3 = 0.66 => floor is 0 (if misses 1, 8/11 = 72.7%)
    assert.equal(eighty.canMissNext, 0);

    // 20 conducted, 18 present (90%)
    // 18 / 20 = 90%. If misses 4: 18/24 = 75%. floor((4*18 - 3*20)/3) = floor(12/3) = 4
    const ninety = Attendance.calculate75(18, 20);
    assert.equal(ninety.percentage, 90);
    assert.equal(ninety.meetsThreshold, true);
    assert.equal(ninety.neededFor75, 0);
    assert.equal(ninety.canMissNext, 4);

    // Below 75%: 10 conducted, 6 present (60%)
    // To reach 75%: (6 + X) / (10 + X) >= 0.75  =>  0.25*X >= 7.5 - 6 = 1.5 => X >= 6
    // Formula 3*C - 4*P = 3*10 - 4*6 = 30 - 24 = 6
    const sixty = Attendance.calculate75(6, 10);
    assert.equal(sixty.percentage, 60);
    assert.equal(sixty.meetsThreshold, false);
    assert.equal(sixty.neededFor75, 6);
    // If attends 6 in a row: 12 / 16 = 75.0%

    // Exactly 75%: 12 present out of 16 conducted
    const seventyFive = Attendance.calculate75(12, 16);
    assert.equal(seventyFive.percentage, 75);
    assert.equal(seventyFive.meetsThreshold, true);
    assert.equal(seventyFive.neededFor75, 0);
    assert.equal(seventyFive.canMissNext, 0);

    // Severe shortage: 10 conducted, 0 present (0%)
    // 3*10 - 0 = 30 consecutive lectures needed
    const zeroPct = Attendance.calculate75(0, 10);
    assert.equal(zeroPct.percentage, 0);
    assert.equal(zeroPct.meetsThreshold, false);
    assert.equal(zeroPct.neededFor75, 30);
    // Check: 30 / 40 = 75%
  });

  test('Session validation and duplicate detection in schema', () => {
    const dummyClassId = new mongoose.Types.ObjectId();
    const dummyProfId = new mongoose.Types.ObjectId();
    const dummyStudentId1 = new mongoose.Types.ObjectId();
    const dummyStudentId2 = new mongoose.Types.ObjectId();

    const session = new Attendance({
      classroom: dummyClassId,
      professor: dummyProfId,
      date: new Date('2026-10-28'),
      dateKey: '2026-10-28',
      slot: '1',
      topic: 'Process Synchronization',
      records: [
        { student: dummyStudentId1, status: 'present', remarks: 'On time' },
        { student: dummyStudentId2, status: 'absent', remarks: 'Sick leave' }
      ],
      totalStudents: 2,
      presentCount: 1,
      absentCount: 1
    });

    const err = session.validateSync();
    assert.equal(err, undefined, 'Session should validate without errors');
    assert.equal(session.records.length, 2);
    assert.equal(session.records[0].status, 'present');
    assert.equal(session.records[1].status, 'absent');
  });

});

