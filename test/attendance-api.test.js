// test/attendance-api.test.js
// Integration tests for Attendance routes using the in-memory test harness.
// No real DB or server required; uses the same harness pattern as routes.test.js.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { install, call } = require('../testsupport/harness');

// ─── Fake data ────────────────────────────────────────────────────────────────
const CLS_ID   = new mongoose.Types.ObjectId().toString();
const PROF_ID  = 'prof1';
const STU1_ID  = 'stu1';
const STU2_ID  = 'stu2';
const ADMIN_ID = 'admin1';

const users = {
  [ADMIN_ID]: { _id: ADMIN_ID, role: 'admin',     name: 'Admin',   isActive: true },
  [PROF_ID]:  { _id: PROF_ID,  role: 'professor', name: 'Prof1',   isActive: true },
  stu1:       { _id: STU1_ID,  role: 'student',   name: 'Stu One', isActive: true },
  stu2:       { _id: STU2_ID,  role: 'student',   name: 'Stu Two', isActive: true },
};

// In-memory attendance store (replaces mongoose Attendance model)
const sessionsStore = [];
let sessionIdCounter = 1;

function makeFakeAttendance() {
  const AttendanceModel = {
    _sessions: sessionsStore,
    find(filter = {}) {
      let results = [...this._sessions];
      if (filter.classroom) results = results.filter(s => s.classroom.toString() === filter.classroom.toString());
      if (filter.professor) results = results.filter(s => s.professor.toString() === filter.professor.toString());
      const chain = {
        _data: results,
        populate() { return this; },
        select() { return this; },
        sort() { return this; },
        then(r, j) { return Promise.resolve(this._data).then(r, j); },
        [Symbol.iterator]() { return this._data[Symbol.iterator](); }
      };
      chain[Symbol.toStringTag] = 'Promise';
      // Make it awaitable
      return Object.assign(Promise.resolve(results), {
        populate() { return this; },
        select(f) {
          // Simulate -records selection
          if (typeof f === 'string' && f.startsWith('-')) {
            const key = f.slice(1);
            const filtered = results.map(s => { const c = {...s}; delete c[key]; return c; });
            return Promise.resolve(filtered);
          }
          return Promise.resolve(results);
        },
        sort() { return this; }
      });
    },
    findOne(filter = {}) {
      const session = this._sessions.find(s => {
        return (!filter.classroom || s.classroom.toString() === filter.classroom.toString()) &&
               (!filter.dateKey  || s.dateKey === filter.dateKey) &&
               (!filter.slot     || s.slot === filter.slot);
      });
      return Promise.resolve(session || null);
    },
    findById(id) {
      const session = this._sessions.find(s => s._id === id);
      return Object.assign(Promise.resolve(session || null), {
        populate() { return this; }
      });
    },
    async create(data) {
      // Simulate unique index violation
      const dup = this._sessions.find(s =>
        s.classroom.toString() === data.classroom.toString() &&
        s.dateKey === data.dateKey && s.slot === data.slot
      );
      if (dup) {
        const err = new Error('Duplicate key'); err.code = 11000; throw err;
      }
      const id = `session${sessionIdCounter++}`;
      const session = { _id: id, ...data, professor: data.professor || PROF_ID };
      this._sessions.push(session);
      return session;
    },
    calculate75(present, conducted) {
      // Mirror the real implementation
      if (conducted === 0) return { percentage: 100, meetsThreshold: true, neededFor75: 0, canMissNext: 0 };
      const pct = Math.round((present / conducted) * 1000) / 10;
      const meets = pct >= 75;
      const needed = meets ? 0 : Math.ceil(3 * conducted - 4 * present);
      const canMiss = meets ? Math.floor((4 * present - 3 * conducted) / 3) : 0;
      return { percentage: pct, meetsThreshold: meets, neededFor75: needed, canMissNext: canMiss };
    }
  };
  return AttendanceModel;
}

function makeFakeClassroom(role) {
  const profStr = role === 'professor' ? PROF_ID : 'other-prof';
  return {
    find(q = {}) {
      // Return classrooms the user's enrolled in
      const cls = [{
        _id: CLS_ID,
        name: 'CS101',
        subject: 'OS',
        classCode: 'CS-101',
        isActive: true,
        professor: { toString: () => PROF_ID, _id: PROF_ID, name: 'Prof1' },
        students: [
          { _id: STU1_ID, name: 'Stu One', email: 'stu1@test.com', studentId: 'S001', toString: () => STU1_ID },
          { _id: STU2_ID, name: 'Stu Two', email: 'stu2@test.com', studentId: 'S002', toString: () => STU2_ID }
        ]
      }];
      return Object.assign(Promise.resolve(cls), {
        populate() { return this; },
        sort() { return this; },
        select() { return this; }
      });
    },
    findById(id) {
      if (id !== CLS_ID) return Object.assign(Promise.resolve(null), { populate() { return this; } });
      const cls = {
        _id: CLS_ID,
        name: 'CS101',
        subject: 'OS',
        classCode: 'CS-101',
        isActive: true,
        professor: { toString: () => PROF_ID, _id: PROF_ID, name: 'Prof1', email: 'prof@test.com' },
        students: [
          { _id: STU1_ID, name: 'Stu One', email: 'stu1@test.com', studentId: 'S001', toString: () => STU1_ID },
          { _id: STU2_ID, name: 'Stu Two', email: 'stu2@test.com', studentId: 'S002', toString: () => STU2_ID }
        ]
      };
      return Object.assign(Promise.resolve(cls), { populate() { return this; } });
    }
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────
describe('Attendance API — Role-based access and business rules', () => {
  let env, attendanceRouter;
  const fakeAttendance = makeFakeAttendance();

  before(() => {
    env = install({
      users,
      models: {
        Classroom: makeFakeClassroom('professor'),
        Attendance: fakeAttendance,
        User: { findById: id => ({ select: () => Promise.resolve(users[id] || null) }) }
      }
    });
    attendanceRouter = require('../routes/attendance');
  });

  after(() => {
    env.restore();
    sessionsStore.length = 0;
  });

  // ── Auth enforcement ──────────────────────────────────────────────────────

  test('GET /classrooms — rejects unauthenticated (401)', async () => {
    const r = await call(attendanceRouter, 'GET', '/classrooms');
    assert.equal(r.status, 401);
  });

  test('GET /admin/overview — rejects student (403)', async () => {
    const r = await call(attendanceRouter, 'GET', '/admin/overview', { token: STU1_ID });
    assert.equal(r.status, 403);
  });

  test('GET /admin/overview — rejects professor (403)', async () => {
    const r = await call(attendanceRouter, 'GET', '/admin/overview', { token: PROF_ID });
    assert.equal(r.status, 403);
  });

  test('GET /admin/overview — allows admin (200)', async () => {
    const r = await call(attendanceRouter, 'GET', '/admin/overview', { token: ADMIN_ID });
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.ok('stats' in r.body);
    assert.ok('classroomSummaries' in r.body);
  });

  // ── Student restriction ───────────────────────────────────────────────────

  test('GET /my-attendance — rejects professor (403)', async () => {
    const r = await call(attendanceRouter, 'GET', '/my-attendance', { token: PROF_ID });
    assert.equal(r.status, 403);
  });

  test('GET /my-attendance — rejects admin (403)', async () => {
    const r = await call(attendanceRouter, 'GET', '/my-attendance', { token: ADMIN_ID });
    assert.equal(r.status, 403);
  });

  test('GET /my-attendance — allows student (200) with own data only', async () => {
    const r = await call(attendanceRouter, 'GET', '/my-attendance', { token: STU1_ID });
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.ok(Array.isArray(r.body.subjects));
    assert.ok('overall' in r.body);
  });

  // ── Session creation ──────────────────────────────────────────────────────

  test('POST /classroom/:id/session — rejects student (403)', async () => {
    const r = await call(attendanceRouter, 'POST', `/classroom/${CLS_ID}/session`,
      { token: STU1_ID, body: { date: '2026-10-28', slot: '1', topic: 'Intro', records: [] } });
    assert.equal(r.status, 403);
  });

  test('POST /classroom/:id/session — rejects missing date (400)', async () => {
    const r = await call(attendanceRouter, 'POST', `/classroom/${CLS_ID}/session`,
      { token: PROF_ID, body: { slot: '1' } });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /Date is required/);
  });

  test('POST /classroom/:id/session — creates session for professor (201)', async () => {
    const r = await call(attendanceRouter, 'POST', `/classroom/${CLS_ID}/session`, {
      token: PROF_ID,
      body: {
        date: '2026-10-28',
        slot: '1',
        topic: 'Process Scheduling',
        records: [
          { student: STU1_ID, status: 'present' },
          { student: STU2_ID, status: 'absent' }
        ]
      }
    });
    assert.equal(r.status, 201, `Expected 201, got ${r.status}: ${r.body.message}`);
    assert.equal(r.body.success, true);
    assert.ok(r.body.session._id);
    assert.equal(r.body.session.presentCount, 1);
    assert.equal(r.body.session.absentCount, 1);
  });

  test('POST /classroom/:id/session — duplicate session returns 409', async () => {
    // Same classroom, date, slot as previous test → should 409
    const r = await call(attendanceRouter, 'POST', `/classroom/${CLS_ID}/session`, {
      token: PROF_ID,
      body: { date: '2026-10-28', slot: '1', topic: 'Dup', records: [] }
    });
    assert.equal(r.status, 409, `Expected 409, got ${r.status}: ${r.body.message}`);
    assert.equal(r.body.success, false);
  });

  test('POST /classroom/:id/session — different slot same day succeeds (201)', async () => {
    const r = await call(attendanceRouter, 'POST', `/classroom/${CLS_ID}/session`, {
      token: PROF_ID,
      body: { date: '2026-10-28', slot: '2', topic: 'Slot 2 lecture', records: [] }
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.session.slot, '2');
  });

  // ── Classroom not found ───────────────────────────────────────────────────

  test('POST /classroom/nonexistent/session — returns 404', async () => {
    const r = await call(attendanceRouter, 'POST', '/classroom/nonexistent-id/session', {
      token: PROF_ID,
      body: { date: '2026-10-28', slot: '3', records: [] }
    });
    assert.equal(r.status, 404);
  });

  // ── Classroom list per role ───────────────────────────────────────────────

  test('GET /classrooms — professor sees classrooms (200)', async () => {
    const r = await call(attendanceRouter, 'GET', '/classrooms', { token: PROF_ID });
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.ok(Array.isArray(r.body.classrooms));
  });

  test('GET /classrooms — admin sees classrooms (200)', async () => {
    const r = await call(attendanceRouter, 'GET', '/classrooms', { token: ADMIN_ID });
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
  });

  test('GET /classrooms — student sees classrooms (200)', async () => {
    // Students are also allowed to hit /classrooms (used for their enrollment check)
    const r = await call(attendanceRouter, 'GET', '/classrooms', { token: STU1_ID });
    assert.equal(r.status, 200);
  });

  // ── Student enrollment check ──────────────────────────────────────────────

  test('GET /classroom/:id/students — professor of this class gets student list (200)', async () => {
    const r = await call(attendanceRouter, 'GET', `/classroom/${CLS_ID}/students`, { token: PROF_ID });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.students));
    assert.equal(r.body.students.length, 2);
  });

  // ── Session list ──────────────────────────────────────────────────────────

  test('GET /classroom/:id/sessions — professor sees session list (200)', async () => {
    const r = await call(attendanceRouter, 'GET', `/classroom/${CLS_ID}/sessions`, { token: PROF_ID });
    assert.equal(r.status, 200);
    assert.equal(r.body.success, true);
    assert.ok(Array.isArray(r.body.sessions));
    assert.ok(r.body.sessions.length >= 2, 'Should have at least 2 sessions from earlier tests');
  });

  test('GET /classroom/:id/sessions — admin can list all sessions (200)', async () => {
    const r = await call(attendanceRouter, 'GET', `/classroom/${CLS_ID}/sessions`, { token: ADMIN_ID });
    assert.equal(r.status, 200);
  });

});

