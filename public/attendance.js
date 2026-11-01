// public/attendance.js - Attendance Frontend UI Module
// Supports Professor, Student, and Admin Dashboards with 75% Attendance Calculator

(function () {
  const H = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let attState = {
    selectedClassroom: null,
    classrooms: [],
    students: [],
    sessions: [],
    studentData: null,
    adminData: null
  };

  // Main entry point called by navTo('attendance', data)
  async function loadAttendanceModule(initialData) {
    const container = $('page-attendance');
    if (!container) return;
    container.innerHTML = '<div class="loading"><span class="spin spin-d"></span> Loading Attendance...</div>';

    if (CU.role === 'professor') {
      await renderProfessorView(initialData);
    } else if (CU.role === 'student') {
      await renderStudentView();
    } else if (CU.role === 'admin') {
      await renderAdminView();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 1. PROFESSOR DASHBOARD
  // ─────────────────────────────────────────────────────────────
  async function renderProfessorView(preSelectedClassId) {
    const container = $('page-attendance');
    try {
      const r = await api('/attendance/classrooms');
      if (!r.success) throw new Error(r.message);
      attState.classrooms = r.classrooms || [];

      if (attState.classrooms.length === 0) {
        container.innerHTML = `
          <div class="empty" style="padding:48px;">
            <div class="ei">🏫</div>
            <h3>No Classrooms Found</h3>
            <p>Create or join a classroom first to manage attendance.</p>
            <button class="btn btn-p" data-action="navTo" data-page="classrooms">Go to Classrooms</button>
          </div>`;
        return;
      }

      // Determine active classroom
      const chosenId = preSelectedClassId || (attState.selectedClassroom ? attState.selectedClassroom._id : attState.classrooms[0]._id);
      attState.selectedClassroom = attState.classrooms.find(c => c._id === chosenId) || attState.classrooms[0];

      // Fetch students and recent sessions for chosen classroom
      const [studRes, sessRes] = await Promise.all([
        api(`/attendance/classroom/${attState.selectedClassroom._id}/students`),
        api(`/attendance/classroom/${attState.selectedClassroom._id}/sessions`)
      ]);

      attState.students = studRes.students || [];
      attState.sessions = sessRes.sessions || [];

      const todayStr = new Date().toISOString().split('T')[0];

      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
          <div>
            <div style="font-size:18px;font-weight:800;letter-spacing:-.3px;">Attendance Management</div>
            <div style="font-size:12.5px;color:var(--text3);">Mark and review date-wise student lecture attendance with 75% tracking</div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <label style="font-size:12.5px;font-weight:600;color:var(--text2);">Classroom:</label>
            <select class="fc" id="att-prof-cls-select" style="width:auto;min-width:200px;font-weight:600;">
              ${attState.classrooms.map(c => `<option value="${c._id}" ${c._id === attState.selectedClassroom._id ? 'selected' : ''}>${H(c.name)} (${H(c.subject)})</option>`).join('')}
            </select>
            <button class="btn btn-s btn-sm" id="att-view-matrix-btn">📊 Full Class Report</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:minmax(320px, 420px) 1fr;gap:20px;align-items:start;">
          <!-- MARK ATTENDANCE CARD -->
          <div class="card">
            <div class="ch">
              <span class="ct">📝 Mark Lecture Attendance</span>
              <span class="badge bb">${H(attState.selectedClassroom.subject)}</span>
            </div>
            <div class="cb">
              <div class="g2" style="margin-bottom:12px;">
                <div class="fg">
                  <label>Lecture Date</label>
                  <input type="date" class="fc" id="att-session-date" value="${todayStr}">
                </div>
                <div class="fg">
                  <label>Lecture Slot</label>
                  <select class="fc" id="att-session-slot">
                    <option value="1">Slot 1 (Morning)</option>
                    <option value="2">Slot 2 (Mid-day)</option>
                    <option value="3">Slot 3 (Afternoon)</option>
                    <option value="4">Slot 4 (Extra)</option>
                  </select>
                </div>
              </div>

              <div class="fg">
                <label>Topic / Lecture Notes (Optional)</label>
                <input type="text" class="fc" id="att-session-topic" placeholder="e.g. Memory Management & Paging">
              </div>

              <div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 10px;">
                <span style="font-weight:700;font-size:13px;">Students (${attState.students.length})</span>
                <div style="display:flex;gap:6px;">
                  <button class="btn btn-ok btn-sm" id="att-all-present-btn">All Present</button>
                  <button class="btn btn-d btn-sm" id="att-all-absent-btn">All Absent</button>
                </div>
              </div>

              <div style="max-height:360px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--rs);padding:8px;background:var(--surface2);margin-bottom:16px;">
                ${attState.students.length === 0 ? '<div style="text-align:center;color:var(--text3);padding:20px;font-size:12.5px;">No students enrolled yet.</div>' :
                  attState.students.map((s, idx) => `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid var(--border);background:var(--surface);border-radius:4px;margin-bottom:6px;">
                      <div>
                        <div style="font-weight:600;font-size:13px;">${H(s.name)}</div>
                        <div style="font-size:11px;color:var(--text3);font-family:var(--m);">${H(s.studentId || s.email)}</div>
                      </div>
                      <div style="display:flex;gap:6px;" data-student-id="${s._id}">
                        <label class="btn btn-sm att-status-toggle" style="cursor:pointer;padding:4px 10px;font-size:11.5px;background:var(--green-bg);color:var(--green);border:1.5px solid var(--green);">
                          <input type="radio" name="att_status_${s._id}" value="present" checked style="display:none"> Present
                        </label>
                        <label class="btn btn-sm att-status-toggle" style="cursor:pointer;padding:4px 10px;font-size:11.5px;background:white;color:var(--text3);border:1.5px solid var(--border);">
                          <input type="radio" name="att_status_${s._id}" value="absent" style="display:none"> Absent
                        </label>
                      </div>
                    </div>
                  `).join('')
                }
              </div>

              <button class="btn btn-p btn-full btn-lg" id="att-submit-session-btn" ${attState.students.length === 0 ? 'disabled' : ''}>
                💾 Save Attendance Session
              </button>
            </div>
          </div>

          <!-- RECENT SESSIONS & HISTORY -->
          <div class="card">
            <div class="ch">
              <span class="ct">📅 Conducted Sessions History (${attState.sessions.length})</span>
              <button class="btn btn-s btn-sm" id="att-refresh-sessions-btn">↻ Refresh</button>
            </div>
            <div class="cb">
              ${attState.sessions.length === 0 ? `
                <div class="empty" style="padding:40px;">
                  <div class="ei">📋</div>
                  <h4>No sessions recorded yet</h4>
                  <p>Mark attendance using the form on the left to start tracking lecture records.</p>
                </div>` : `
                <div class="tw">
                  <table>
                    <thead>
                      <tr>
                        <th>Date &amp; Slot</th>
                        <th>Topic</th>
                        <th>Present</th>
                        <th>Absent</th>
                        <th>Percentage</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${attState.sessions.map(sess => {
                        const total = (sess.presentCount || 0) + (sess.absentCount || 0);
                        const pct = total > 0 ? Math.round((sess.presentCount / total) * 100) : 0;
                        const badgeCls = pct >= 75 ? 'bg' : 'br';
                        return `
                          <tr>
                            <td>
                              <div style="font-weight:700;">${fmtD(sess.date)}</div>
                              <div style="font-size:11px;color:var(--text3);font-family:var(--m);">Slot ${H(sess.slot)}</div>
                            </td>
                            <td><div style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${H(sess.topic)}">${H(sess.topic || '—')}</div></td>
                            <td><b style="color:var(--green);">${sess.presentCount || 0}</b></td>
                            <td><b style="color:var(--red);">${sess.absentCount || 0}</b></td>
                            <td><span class="badge ${badgeCls}">${pct}%</span></td>
                            <td>
                              <button class="btn btn-s btn-sm att-view-session-btn" data-session-id="${sess._id}">Inspect / Edit</button>
                            </td>
                          </tr>`;
                      }).join('')}
                    </tbody>
                  </table>
                </div>`
              }
            </div>
          </div>
        </div>
      `;

      bindProfessorEvents();
    } catch (e) {
      container.innerHTML = `<div class="alert ae">Failed to load attendance data: ${H(e.message)}</div>`;
    }
  }

  function bindProfessorEvents() {
    $('att-prof-cls-select')?.addEventListener('change', e => {
      renderProfessorView(e.target.value);
    });

    $('att-refresh-sessions-btn')?.addEventListener('click', () => {
      renderProfessorView(attState.selectedClassroom._id);
    });

    $('att-view-matrix-btn')?.addEventListener('click', () => {
      showClassroomReportModal(attState.selectedClassroom._id);
    });

    // Mark all present / absent shortcuts
    $('att-all-present-btn')?.addEventListener('click', () => {
      document.querySelectorAll('input[type="radio"][value="present"]').forEach(r => {
        r.checked = true;
        updateToggleStyles(r);
      });
    });

    $('att-all-absent-btn')?.addEventListener('click', () => {
      document.querySelectorAll('input[type="radio"][value="absent"]').forEach(r => {
        r.checked = true;
        updateToggleStyles(r);
      });
    });

    // Handle radio button style toggles
    document.querySelectorAll('.att-status-toggle input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', () => {
        updateToggleStyles(radio);
      });
    });

    // Save attendance session
    $('att-submit-session-btn')?.addEventListener('click', async () => {
      const date = $('att-session-date').value;
      const slot = $('att-session-slot').value;
      const topic = $('att-session-topic').value;
      if (!date) return toast('Please select a lecture date.', 'w');

      const records = [];
      attState.students.forEach(s => {
        const checked = document.querySelector(`input[name="att_status_${s._id}"]:checked`);
        records.push({
          student: s._id,
          status: checked ? checked.value : 'present'
        });
      });

      const btn = $('att-submit-session-btn');
      btn.innerHTML = '<span class="spin"></span> Saving...';
      btn.disabled = true;

      try {
        const r = await api(`/attendance/classroom/${attState.selectedClassroom._id}/session`, {
          method: 'POST',
          body: JSON.stringify({ date, slot, topic, records })
        });
        if (!r.success) throw new Error(r.message);
        toast(r.message || 'Attendance saved!', 's');
        renderProfessorView(attState.selectedClassroom._id);
      } catch (err) {
        toast(err.message, 'e');
      } finally {
        btn.innerHTML = '💾 Save Attendance Session';
        btn.disabled = false;
      }
    });

    // Inspect / edit session detail
    document.querySelectorAll('.att-view-session-btn').forEach(b => {
      b.addEventListener('click', () => {
        const sid = b.getAttribute('data-session-id');
        openSessionDetailModal(sid);
      });
    });
  }

  function updateToggleStyles(radio) {
    const parentContainer = radio.closest('div');
    if (!parentContainer) return;
    parentContainer.querySelectorAll('.att-status-toggle').forEach(label => {
      const input = label.querySelector('input');
      if (input.checked) {
        if (input.value === 'present') {
          label.style.background = 'var(--green-bg)';
          label.style.color = 'var(--green)';
          label.style.borderColor = 'var(--green)';
        } else {
          label.style.background = 'var(--red-bg)';
          label.style.color = 'var(--red)';
          label.style.borderColor = 'var(--red)';
        }
      } else {
        label.style.background = 'white';
        label.style.color = 'var(--text3)';
        label.style.borderColor = 'var(--border)';
      }
    });
  }

  // Session Edit / Inspection Modal
  async function openSessionDetailModal(sessionId) {
    openMod('Attendance Session Details', '<div class="loading"><span class="spin spin-d"></span> Loading...</div>');
    try {
      const r = await api(`/attendance/session/${sessionId}`);
      if (!r.success) throw new Error(r.message);
      const sess = r.session;

      const html = `
        <div style="margin-bottom:12px;">
          <div style="font-weight:700;font-size:15px;">${H(sess.classroom?.name)} — ${fmtD(sess.date)} (Slot ${H(sess.slot)})</div>
          <div style="font-size:12px;color:var(--text3);">Taken by ${H(sess.professor?.name || 'Professor')}</div>
        </div>

        <div class="fg">
          <label>Topic / Notes</label>
          <input type="text" class="fc" id="edit-session-topic" value="${H(sess.topic || '')}">
        </div>

        <div style="font-weight:700;font-size:13px;margin:14px 0 8px;">Student Records (${sess.records.length})</div>
        <div style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--rs);padding:6px;background:var(--surface2);margin-bottom:16px;">
          ${sess.records.map(r => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--surface);border-radius:4px;margin-bottom:4px;border:1px solid var(--border);">
              <div>
                <div style="font-weight:600;font-size:12.5px;">${H(r.student?.name || 'Student')}</div>
                <div style="font-size:11px;color:var(--text3);">${H(r.student?.studentId || r.student?.email || '')}</div>
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                <select class="fc edit-record-status" data-student-id="${r.student?._id}" style="width:auto;padding:3px 8px;font-size:12px;font-weight:600;">
                  <option value="present" ${r.status === 'present' ? 'selected' : ''}>✅ Present</option>
                  <option value="absent" ${r.status === 'absent' ? 'selected' : ''}>❌ Absent</option>
                </select>
                <input type="text" class="fc edit-record-remarks" data-student-id="${r.student?._id}" value="${H(r.remarks || '')}" placeholder="Remarks" style="width:110px;padding:3px 8px;font-size:11.5px;">
              </div>
            </div>
          `).join('')}
        </div>

        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button class="btn btn-s" id="close-session-mod-btn">Cancel</button>
          <button class="btn btn-p" id="save-session-edits-btn">Save Changes</button>
        </div>
      `;

      $('mbody').innerHTML = html;

      $('close-session-mod-btn')?.addEventListener('click', () => closeMod());
      $('save-session-edits-btn')?.addEventListener('click', async () => {
        const topic = $('edit-session-topic').value;
        const records = [];
        document.querySelectorAll('.edit-record-status').forEach(sel => {
          const sId = sel.getAttribute('data-student-id');
          const remInput = document.querySelector(`.edit-record-remarks[data-student-id="${sId}"]`);
          records.push({
            student: sId,
            status: sel.value,
            remarks: remInput ? remInput.value : ''
          });
        });

        try {
          const res = await api(`/attendance/session/${sessionId}`, {
            method: 'PATCH',
            body: JSON.stringify({ topic, records })
          });
          if (!res.success) throw new Error(res.message);
          toast('Attendance session updated!', 's');
          closeMod();
          renderProfessorView(attState.selectedClassroom._id);
        } catch (e) {
          toast(e.message, 'e');
        }
      });
    } catch (err) {
      $('mbody').innerHTML = `<div class="alert ae">${H(err.message)}</div>`;
    }
  }

  // Classroom Full Attendance Matrix Modal
  async function showClassroomReportModal(classroomId) {
    openMod('Classroom Attendance Report & 75% Calculator', '<div class="loading"><span class="spin spin-d"></span> Calculating attendance matrix...</div>');
    try {
      const r = await api(`/attendance/classroom/${classroomId}/report`);
      if (!r.success) throw new Error(r.message);

      const { classroom, conductedLectures, studentStats } = r;

      const html = `
        <div style="margin-bottom:16px;">
          <div style="font-size:16px;font-weight:800;">${H(classroom.name)} (${H(classroom.subject)})</div>
          <div style="font-size:12px;color:var(--text3);">Total Conducted Lectures: <b>${conductedLectures}</b></div>
        </div>

        <div class="tw" style="max-height:420px;overflow-y:auto;">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Present</th>
                <th>Absent</th>
                <th>Attendance %</th>
                <th>75% Status</th>
                <th>Target Action</th>
              </tr>
            </thead>
            <tbody>
              ${studentStats.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:20px;">No students enrolled.</td></tr>' :
                studentStats.map(s => {
                  const statusBadge = s.meetsThreshold
                    ? '<span class="badge bg">✅ ≥ 75% Eligible</span>'
                    : '<span class="badge br">⚠️ Defaulter (< 75%)</span>';
                  const advice = s.meetsThreshold
                    ? `<span style="font-size:11.5px;color:var(--text3);">Can miss up to <b>${s.canMissNext}</b> next lecture(s)</span>`
                    : `<span style="font-size:11.5px;color:var(--red);font-weight:600;">Must attend next <b>${s.neededFor75}</b> lecture(s)</span>`;
                  return `
                    <tr>
                      <td>
                        <div style="font-weight:700;">${H(s.student.name)}</div>
                        <div style="font-size:11px;color:var(--text3);">${H(s.student.studentId || s.student.email)}</div>
                      </td>
                      <td><b style="color:var(--green);">${s.present}</b></td>
                      <td><b style="color:var(--red);">${s.absent}</b></td>
                      <td><b style="font-size:14px;">${s.percentage}%</b></td>
                      <td>${statusBadge}</td>
                      <td>${advice}</td>
                    </tr>`;
                }).join('')
              }
            </tbody>
          </table>
        </div>
      `;

      $('mbody').innerHTML = html;
    } catch (err) {
      $('mbody').innerHTML = `<div class="alert ae">${H(err.message)}</div>`;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 2. STUDENT DASHBOARD
  // ─────────────────────────────────────────────────────────────
  async function renderStudentView() {
    const container = $('page-attendance');
    try {
      const r = await api('/attendance/my-attendance');
      if (!r.success) throw new Error(r.message);
      attState.studentData = r;

      const ov = r.overall || {};
      const subjects = r.subjects || [];

      const overallBadge = ov.meetsThreshold
        ? '<span class="badge bg" style="font-size:12px;padding:4px 8px;">✅ Overall Eligible (≥75%)</span>'
        : '<span class="badge br" style="font-size:12px;padding:4px 8px;">⚠️ Attendance Shortage (&lt;75%)</span>';

      container.innerHTML = `
        <div style="margin-bottom:20px;">
          <div style="font-size:18px;font-weight:800;letter-spacing:-.3px;">My Attendance Tracker</div>
          <div style="font-size:12.5px;color:var(--text3);">Subject-wise attendance metrics and consecutive lecture requirement calculator</div>
        </div>

        <!-- OVERALL STATS HERO -->
        <div class="sr" style="margin-bottom:20px;">
          <div class="sb">
            <div class="sl">Overall Attendance</div>
            <div class="sv" style="color:${ov.meetsThreshold ? 'var(--green)' : 'var(--red)'};">${ov.percentage || 0}%</div>
            <div class="ss">${overallBadge}</div>
          </div>
          <div class="sb">
            <div class="sl">Total Conducted</div>
            <div class="sv">${ov.totalConducted || 0}</div>
            <div class="ss">Across all enrolled subjects</div>
          </div>
          <div class="sb">
            <div class="sl">Total Present</div>
            <div class="sv" style="color:var(--green);">${ov.totalPresent || 0}</div>
            <div class="ss">Attended lectures</div>
          </div>
          <div class="sb">
            <div class="sl">Total Absent</div>
            <div class="sv" style="color:var(--red);">${ov.totalAbsent || 0}</div>
            <div class="ss">Missed lectures</div>
          </div>
        </div>

        <!-- 75% CALCULATOR EXPLANATION BANNER -->
        <div class="alert ${ov.meetsThreshold ? 'aok' : 'ae'}" style="margin-bottom:20px;">
          <span>${ov.meetsThreshold ? '🎯' : '⚠️'}</span>
          <div>
            <b>${ov.meetsThreshold ? 'You are currently meeting the mandatory 75% requirement!' : 'Warning: Your attendance is below the 75% requirement.'}</b>
            <div style="font-size:12px;margin-top:2px;">
              ${ov.meetsThreshold
                ? `You have a safety margin. You can miss up to <b>${ov.canMissNext || 0}</b> consecutive upcoming lecture(s) without dropping below 75%.`
                : `To reach 75%, you must attend the next <b>${ov.neededFor75 || 0}</b> consecutive upcoming lecture(s) without missing any.`
              }
            </div>
          </div>
        </div>

        <!-- SUBJECT-WISE BREAKDOWN CARDS -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div style="font-weight:700;font-size:15px;">Subject-Wise Attendance Details (${subjects.length})</div>
        </div>

        ${subjects.length === 0 ? `
          <div class="card"><div class="cb"><div class="empty">
            <div class="ei">📚</div>
            <h4>No Enrolled Classrooms</h4>
            <p>Join a classroom to view your attendance reports.</p>
          </div></div></div>` :
          `<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(360px, 1fr));gap:16px;">
            ${subjects.map((sub, sIdx) => {
              const pct = sub.percentage;
              const isEligible = sub.meetsThreshold;
              const statusTag = isEligible
                ? `<span class="badge bg">${pct}% · Good</span>`
                : `<span class="badge br">${pct}% · Shortage</span>`;

              const actionNote = isEligible
                ? `<span style="color:var(--green);font-size:11.5px;">Can miss next <b>${sub.canMissNext}</b> lecture(s)</span>`
                : `<span style="color:var(--red);font-weight:700;font-size:11.5px;">Attend next <b>${sub.neededFor75}</b> consecutive lecture(s)</span>`;

              return `
                <div class="card">
                  <div class="ch">
                    <div>
                      <span class="ct">${H(sub.classroom.name)}</span>
                      <div style="font-size:11px;color:var(--text3);">${H(sub.classroom.subject)} · Prof. ${H(sub.classroom.professor)}</div>
                    </div>
                    ${statusTag}
                  </div>
                  <div class="cb">
                    <!-- Progress bar -->
                    <div class="prog" style="margin-bottom:14px;height:8px;">
                      <div class="pb ${isEligible ? 'pb-g' : 'pb-r'}" style="width:${Math.min(100, pct)}%;"></div>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;background:var(--bg);padding:10px;border-radius:var(--rs);margin-bottom:12px;">
                      <div><div style="font-size:10.5px;color:var(--text3);">Conducted</div><div style="font-size:15px;font-weight:800;">${sub.conducted}</div></div>
                      <div><div style="font-size:10.5px;color:var(--text3);">Present</div><div style="font-size:15px;font-weight:800;color:var(--green);">${sub.present}</div></div>
                      <div><div style="font-size:10.5px;color:var(--text3);">Absent</div><div style="font-size:15px;font-weight:800;color:var(--red);">${sub.absent}</div></div>
                    </div>

                    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--surface2);border-radius:var(--rs);margin-bottom:12px;border:1px solid var(--border);">
                      <span style="font-size:12px;font-weight:600;">75% Target Status:</span>
                      ${actionNote}
                    </div>

                    <!-- Date-wise History Toggle -->
                    <button class="btn btn-s btn-sm btn-full att-view-history-btn" data-subject-idx="${sIdx}">
                      📅 View Lecture History (${sub.history.length})
                    </button>
                  </div>
                </div>`;
            }).join('')}
          </div>`
        }
      `;

      // Bind student history modal
      document.querySelectorAll('.att-view-history-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.getAttribute('data-subject-idx'));
          showStudentHistoryModal(subjects[idx]);
        });
      });

    } catch (e) {
      container.innerHTML = `<div class="alert ae">Failed to load attendance tracker: ${H(e.message)}</div>`;
    }
  }

  function showStudentHistoryModal(sub) {
    openMod(`${H(sub.classroom.name)} — Lecture History`, `
      <div style="margin-bottom:12px;">
        <div style="font-size:13px;color:var(--text2);">
          Subject: <b>${H(sub.classroom.subject)}</b> | Attendance: <b>${sub.percentage}%</b> (${sub.present}/${sub.conducted})
        </div>
      </div>
      <div class="tw" style="max-height:360px;overflow-y:auto;">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Slot</th>
              <th>Topic</th>
              <th>Status</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            ${sub.history.length === 0 ? '<tr><td colspan="5" style="text-align:center;padding:20px;">No lecture sessions recorded yet.</td></tr>' :
              sub.history.map(h => `
                <tr>
                  <td><b>${fmtD(h.date)}</b></td>
                  <td>Slot ${H(h.slot)}</td>
                  <td>${H(h.topic || '—')}</td>
                  <td>
                    ${h.status === 'present'
                      ? '<span class="badge bg">Present</span>'
                      : '<span class="badge br">Absent</span>'
                    }
                  </td>
                  <td style="font-size:11.5px;color:var(--text3);">${H(h.remarks || '—')}</td>
                </tr>
              `).join('')
            }
          </tbody>
        </table>
      </div>
    `);
  }

  // ─────────────────────────────────────────────────────────────
  // 3. ADMIN DASHBOARD
  // ─────────────────────────────────────────────────────────────
  async function renderAdminView() {
    const container = $('page-attendance');
    try {
      const [clsRes, ovRes] = await Promise.all([
        api('/attendance/classrooms'),
        api('/attendance/admin/overview')
      ]);

      if (!ovRes.success) throw new Error(ovRes.message);

      attState.classrooms = clsRes.classrooms || [];
      attState.adminData = ovRes;

      const stats = ovRes.stats || {};
      const summaries = ovRes.classroomSummaries || [];
      const recent = ovRes.sessions || [];

      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
          <div>
            <div style="font-size:18px;font-weight:800;letter-spacing:-.3px;">Campus Attendance Analytics &amp; Reports</div>
            <div style="font-size:12.5px;color:var(--text3);">Institutional attendance monitoring across all subjects, professors, and divisions</div>
          </div>
          <button class="btn btn-s btn-sm" id="att-admin-refresh-btn">↻ Refresh Stats</button>
        </div>

        <!-- INSTITUTION STATS -->
        <div class="sr" style="margin-bottom:20px;">
          <div class="sb">
            <div class="sl">Total Sessions</div>
            <div class="sv">${stats.totalSessions || 0}</div>
            <div class="ss">Conducted across campus</div>
          </div>
          <div class="sb">
            <div class="sl">Average Attendance</div>
            <div class="sv" style="color:${(stats.overallPercentage || 0) >= 75 ? 'var(--green)' : 'var(--red)'};">${stats.overallPercentage || 0}%</div>
            <div class="ss">Institutional average</div>
          </div>
          <div class="sb">
            <div class="sl">Student Presences</div>
            <div class="sv" style="color:var(--green);">${stats.totalPresent || 0}</div>
            <div class="ss">Marked Present</div>
          </div>
          <div class="sb">
            <div class="sl">Student Absences</div>
            <div class="sv" style="color:var(--red);">${stats.totalAbsent || 0}</div>
            <div class="ss">Marked Absent</div>
          </div>
        </div>

        <!-- CLASSROOM SUMMARIES TABLE -->
        <div class="card" style="margin-bottom:20px;">
          <div class="ch">
            <span class="ct">🏫 Classrooms Attendance Summary</span>
            <span style="font-size:12px;color:var(--text3);">${summaries.length} classroom(s) active</span>
          </div>
          <div class="cb">
            <div class="tw">
              <table>
                <thead>
                  <tr>
                    <th>Classroom / Subject</th>
                    <th>Professor</th>
                    <th>Students</th>
                    <th>Lectures</th>
                    <th>Avg Attendance</th>
                    <th>75% Compliance</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${summaries.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:20px;">No classrooms available.</td></tr>' :
                    summaries.map(c => {
                      const compliance = c.avgAttendance >= 75
                        ? '<span class="badge bg">Healthy (≥75%)</span>'
                        : '<span class="badge br">Low Attendance</span>';
                      return `
                        <tr>
                          <td>
                            <div style="font-weight:700;">${H(c.name)}</div>
                            <div style="font-size:11.5px;color:var(--text3);">${H(c.subject)}</div>
                          </td>
                          <td>${H(c.professor)}</td>
                          <td>${c.enrolledCount}</td>
                          <td>${c.conductedLectures}</td>
                          <td><b style="font-size:13.5px;">${c.avgAttendance}%</b></td>
                          <td>${compliance}</td>
                          <td>
                            <button class="btn btn-s btn-sm att-admin-cls-report-btn" data-classroom-id="${c._id}">View Full Matrix</button>
                          </td>
                        </tr>`;
                    }).join('')
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- RECENT ATTENDANCE SESSIONS -->
        <div class="card">
          <div class="ch">
            <span class="ct">📋 Recent Campus Attendance Sessions</span>
            <span style="font-size:12px;color:var(--text3);">Last ${recent.length} sessions</span>
          </div>
          <div class="cb">
            <div class="tw">
              <table>
                <thead>
                  <tr>
                    <th>Classroom</th>
                    <th>Date &amp; Slot</th>
                    <th>Faculty</th>
                    <th>Topic</th>
                    <th>Present</th>
                    <th>Absent</th>
                    <th>Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  ${recent.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:20px;">No sessions found.</td></tr>' :
                    recent.map(s => {
                      const total = (s.presentCount || 0) + (s.absentCount || 0);
                      const pct = total > 0 ? Math.round((s.presentCount / total) * 100) : 0;
                      return `
                        <tr>
                          <td><b>${H(s.classroom?.name || 'Classroom')}</b></td>
                          <td>${fmtD(s.date)} <span style="font-size:11px;color:var(--text3);">(Slot ${H(s.slot)})</span></td>
                          <td>${H(s.professor?.name || '—')}</td>
                          <td>${H(s.topic || '—')}</td>
                          <td><b style="color:var(--green);">${s.presentCount || 0}</b></td>
                          <td><b style="color:var(--red);">${s.absentCount || 0}</b></td>
                          <td><span class="badge ${pct >= 75 ? 'bg' : 'br'}">${pct}%</span></td>
                        </tr>`;
                    }).join('')
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;

      $('att-admin-refresh-btn')?.addEventListener('click', renderAdminView);

      document.querySelectorAll('.att-admin-cls-report-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const cid = btn.getAttribute('data-classroom-id');
          showClassroomReportModal(cid);
        });
      });

    } catch (e) {
      container.innerHTML = `<div class="alert ae">Failed to load admin attendance: ${H(e.message)}</div>`;
    }
  }

  // Export to window
  window.loadAttendanceModule = loadAttendanceModule;
})();

