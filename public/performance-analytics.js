// public/performance-analytics.js
// Academic Performance Analytics UI Module (Student)
// 100% Helmet CSP compliant: all events bound via addEventListener (no inline onclick).

(function () {
  const H = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Module state
  let analyticsData = null;
  let simulatorState = {
    targetPercentage: 75,
    customAssignments: [],
    hypotheticalMarksMap: {} // key: assignmentId -> hypothetical marks
  };

  /**
   * Main entry point called by navTo('performance', data)
   */
  async function loadPerformanceAnalytics() {
    const container = $('page-performance');
    if (!container) return;

    container.innerHTML = '<div class="loading"><span class="spin spin-d"></span> Loading Academic Performance Analytics...</div>';

    try {
      const res = await api('/academic-analytics/my-performance');
      if (!res.success) {
        throw new Error(res.message || 'Failed to load analytics.');
      }

      analyticsData = res.data;
      renderAnalyticsView();
    } catch (err) {
      container.innerHTML = `
        <div class="alert ae" style="margin:20px 0;">
          <strong>Error loading analytics:</strong> ${H(err.message)}
          <div style="margin-top:10px;">
            <button class="btn btn-s btn-sm" id="perf-retry-btn">Retry</button>
          </div>
        </div>`;
      $('perf-retry-btn')?.addEventListener('click', loadPerformanceAnalytics);
    }
  }

  /**
   * Render the complete Academic Performance Analytics dashboard
   */
  function renderAnalyticsView() {
    const container = $('page-performance');
    if (!container || !analyticsData) return;

    const { overall, subjectAnalysis, trend, progress, upcomingAssignments } = analyticsData;

    // Initialize hypothetical marks map for simulator if empty
    if (Object.keys(simulatorState.hypotheticalMarksMap).length === 0 && Array.isArray(upcomingAssignments)) {
      upcomingAssignments.forEach(a => {
        if (!a.evaluated) {
          // Default hypothetical mark to 75% of total
          simulatorState.hypotheticalMarksMap[a._id] = Math.round(a.totalMarks * 0.75);
        }
      });
    }

    const overallPct = overall.percentage;
    const overallCol = overallPct === null ? 'var(--text3)' : (overallPct >= 70 ? 'var(--green)' : overallPct >= 50 ? 'var(--accent)' : 'var(--red)');
    const overallPbCls = overallPct >= 70 ? 'pb-g' : overallPct >= 50 ? 'pb-b' : 'pb-r';

    container.innerHTML = `
      <!-- HEADER -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
        <div>
          <div style="font-size:20px;font-weight:800;letter-spacing:-.4px;display:flex;align-items:center;gap:8px;">
            <span>📈</span> Academic Performance Analytics
          </div>
          <div style="font-size:12.5px;color:var(--text3);margin-top:2px;">
            Evaluated assignment metrics, subject mastery analysis, chronological trend, and What-If simulation
          </div>
        </div>
        <div>
          <button class="btn btn-s btn-sm" id="perf-refresh-btn">🔄 Refresh Data</button>
        </div>
      </div>

      <!-- FEATURE 4: ASSIGNMENT PROGRESS ANALYSIS (METRIC CARDS) -->
      <div class="sr" style="margin-bottom:18px;">
        <div class="sb">
          <div class="sl">Total Assignments</div>
          <div class="sv">${progress.total}</div>
          <div class="ss">across enrolled subjects</div>
        </div>
        <div class="sb">
          <div class="sl">Submitted</div>
          <div class="sv" style="color:var(--accent);">${progress.submitted}</div>
          <div class="ss">${progress.total > 0 ? Math.round((progress.submitted / progress.total) * 100) : 0}% submission rate</div>
        </div>
        <div class="sb">
          <div class="sl">Pending Submission</div>
          <div class="sv" style="color:${progress.pending > 0 ? '#F59E0B' : 'var(--green)'};">${progress.pending}</div>
          <div class="ss">${progress.pending === 0 ? 'All submitted!' : 'Awaiting your submission'}</div>
        </div>
        <div class="sb">
          <div class="sl">Evaluated Work</div>
          <div class="sv" style="color:var(--green);">${progress.evaluated}</div>
          <div class="ss">${progress.pendingGrading > 0 ? `${progress.pendingGrading} pending grading` : 'All submitted graded'}</div>
        </div>
      </div>

      <!-- FEATURE 1: OVERALL ACADEMIC PERFORMANCE HERO -->
      <div class="card" style="margin-bottom:18px;">
        <div class="ch">
          <span class="ct">1. Overall Academic Performance</span>
          <span class="badge ${overallPct >= 70 ? 'bg' : overallPct >= 50 ? 'bb' : 'br'}">
            ${overallPct !== null ? `${overallPct}% Aggregate` : 'No Evaluated Data'}
          </span>
        </div>
        <div class="cb">
          <div style="display:grid;grid-template-columns:auto 1fr;align-items:center;gap:24px;flex-wrap:wrap;">
            <div style="text-align:center;min-width:120px;padding:8px 16px;background:var(--bg);border-radius:12px;border:1px solid var(--border);">
              <div style="font-size:46px;font-weight:900;color:${overallCol};letter-spacing:-1.5px;line-height:1;">
                ${overallPct !== null ? `${overallPct}%` : '—'}
              </div>
              <div style="font-size:11.5px;color:var(--text3);margin-top:4px;font-weight:600;">Overall Assignment Average</div>
            </div>
            <div>
              <div style="font-size:14px;font-weight:700;margin-bottom:8px;color:var(--text);">
                ${overall.obtainedMarks} / ${overall.totalMaxMarks} Marks Obtained
                <span style="font-size:12px;color:var(--text3);font-weight:400;margin-left:6px;">
                  (${overall.evaluatedCount} evaluated assignment${overall.evaluatedCount !== 1 ? 's' : ''})
                </span>
              </div>
              <div class="prog" style="height:10px;border-radius:6px;margin-bottom:8px;">
                <div class="pb ${overallPbCls}" style="width:${Math.min(overallPct || 0, 100)}%;"></div>
              </div>
              <div style="font-size:12px;color:var(--text3);line-height:1.5;">
                ${overall.evaluatedCount > 0
                  ? `Computed purely from evaluated assignments. Unevaluated assignments and pending submissions are strictly excluded from actual percentage.`
                  : `You do not have any graded assignments yet. Once your professors grade your submissions, your overall academic performance will appear here.`
                }
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- FEATURE 2: SUBJECT-WISE STRONG / WEAK ANALYSIS -->
      <div class="card" style="margin-bottom:18px;">
        <div class="ch">
          <div>
            <span class="ct">2. Subject-wise Strong & Weak Analysis</span>
            <div style="font-size:11.5px;color:var(--text3);margin-top:2px;">
              Subjects require at least 2 evaluated assignments for strength classification.
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${(subjectAnalysis.strongSubjects || []).length > 0 ? `<span class="badge bg">🌟 ${subjectAnalysis.strongSubjects.length} Strong</span>` : ''}
            ${(subjectAnalysis.weakSubjects || []).length > 0 ? `<span class="badge br">⚠️ ${subjectAnalysis.weakSubjects.length} Needs Attention</span>` : ''}
            ${(subjectAnalysis.insufficientDataSubjects || []).length > 0 ? `<span class="badge bgr">ℹ️ ${subjectAnalysis.insufficientDataSubjects.length} Insufficient Data</span>` : ''}
          </div>
        </div>
        <div class="cb" style="padding-top:10px;">
          ${renderSubjectAnalysisGrid(subjectAnalysis)}
        </div>
      </div>

      <!-- FEATURE 3: PERFORMANCE TREND GRAPH -->
      <div class="card" style="margin-bottom:18px;">
        <div class="ch">
          <div>
            <span class="ct">3. Performance Trend Graph</span>
            <div style="font-size:11.5px;color:var(--text3);margin-top:2px;">
              Assignment marks progression over time in chronological sequence
            </div>
          </div>
          <span style="font-size:12px;color:var(--text3);">${trend.length} Graded Assignment${trend.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="cb">
          ${renderTrendGraphSection(trend)}
        </div>
      </div>

      <!-- FEATURE 5: WHAT-IF SCORE SIMULATOR -->
      <div class="card" style="margin-bottom:18px;" id="simulator-card">
        <div class="ch">
          <div>
            <span class="ct">5. What-If Score Simulator</span>
            <div style="font-size:11.5px;color:var(--text3);margin-top:2px;">
              Simulate hypothetical scores on upcoming or custom assignments. Never alters actual records.
            </div>
          </div>
          <button class="btn btn-g btn-sm" id="sim-reset-btn">Reset Simulator</button>
        </div>
        <div class="cb">
          ${renderWhatIfSimulator(overall, subjectAnalysis.subjects, upcomingAssignments)}
        </div>
      </div>
    `;

    // Bind event listeners (CSP-safe)
    bindAnalyticsEvents();
  }

  /**
   * Render Subject Analysis Cards Grid
   */
  function renderSubjectAnalysisGrid(subjectAnalysis) {
    const subjects = subjectAnalysis.subjects || [];
    if (subjects.length === 0) {
      return `<div class="empty" style="padding:24px;"><p>No enrolled subjects found.</p></div>`;
    }

    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:14px;">
        ${subjects.map(s => {
          let badgeHtml = '';
          let borderStyle = 'border:1px solid var(--border);';
          let pctCol = 'var(--text3)';
          let pbCls = 'pb-b';

          if (!s.hasSufficientData) {
            badgeHtml = `<span class="badge bgr" title="Requires at least 2 evaluated assignments">⚠️ Insufficient Data</span>`;
          } else if (s.status === 'strong') {
            badgeHtml = `<span class="badge bg">🌟 Strong Subject</span>`;
            borderStyle = 'border:1px solid rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.03);';
            pctCol = 'var(--green)';
            pbCls = 'pb-g';
          } else if (s.status === 'weak') {
            badgeHtml = `<span class="badge br">⚠️ Needs Attention</span>`;
            borderStyle = 'border:1px solid rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.03);';
            pctCol = 'var(--red)';
            pbCls = 'pb-r';
          } else {
            badgeHtml = `<span class="badge bb">✓ Average</span>`;
            pctCol = 'var(--accent)';
            pbCls = 'pb-b';
          }

          return `
            <div style="padding:14px;border-radius:10px;${borderStyle}">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
                <div>
                  <div style="font-weight:700;font-size:14px;color:var(--text);">${H(s.subject)}</div>
                  <div style="font-size:11px;color:var(--text3);">${H(s.classroomNames.join(', ') || 'Classroom')}</div>
                </div>
                <div>${badgeHtml}</div>
              </div>

              <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:6px;">
                <div>
                  <div style="font-size:11px;color:var(--text3);">Score / Max Marks</div>
                  <div style="font-size:13px;font-weight:600;">
                    ${s.obtainedMarks} / ${s.totalMaxMarks}
                  </div>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:20px;font-weight:800;color:${pctCol};line-height:1;">
                    ${s.percentage !== null ? `${s.percentage}%` : '—'}
                  </div>
                </div>
              </div>

              <div class="prog" style="height:6px;margin-bottom:10px;">
                <div class="pb ${pbCls}" style="width:${Math.min(s.percentage || 0, 100)}%;"></div>
              </div>

              <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);border-top:1px solid var(--border);padding-top:8px;">
                <span>Evaluated: <b>${s.evaluatedCount}</b> / ${s.totalAssignments}</span>
                <span>Pending: <b>${s.pendingCount}</b></span>
              </div>
              ${!s.hasSufficientData ? `
                <div style="font-size:10.5px;color:var(--text3);margin-top:6px;font-style:italic;">
                  * ${s.evaluatedCount === 0 ? '0 assignments evaluated yet.' : 'Only 1 assignment evaluated. Minimum 2 needed for strong/weak rating.'}
                </div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  /**
   * Render SVG Performance Trend Chart and Timeline
   */
  function renderTrendGraphSection(points) {
    if (!points || points.length === 0) {
      return `
        <div class="empty" style="padding:28px;">
          <div class="ei">📊</div>
          <h3>No Graded Assignments Yet</h3>
          <p>Your performance trend line will appear as assignments get evaluated over time.</p>
        </div>`;
    }

    if (points.length === 1) {
      const pt = points[0];
      return `
        <div style="padding:16px;background:var(--bg);border-radius:10px;border:1px solid var(--border);margin-bottom:14px;">
          <div style="font-size:13px;font-weight:600;margin-bottom:4px;">Single Evaluated Assignment Recorded</div>
          <div style="font-size:12px;color:var(--text3);margin-bottom:12px;">
            <b>${H(pt.assignmentTitle)}</b> (${H(pt.subject)}) — <b>${pt.marksObtained} / ${pt.totalMarks}</b> (${pt.percentage}%) on ${fmtD(pt.date)}.
          </div>
          <p style="font-size:12px;color:var(--text3);">More data points will draw a multi-assignment trend curve.</p>
        </div>
      `;
    }

    // Build SVG chart dimensions
    const width = 760;
    const height = 220;
    const padding = { top: 20, right: 30, bottom: 40, left: 45 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // Coordinate mapping
    const n = points.length;
    const getX = i => padding.left + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW);
    const getY = pct => padding.top + chartH - (Math.max(0, Math.min(pct, 100)) / 100) * chartH;

    // Build polyline points for individual assignment percentages
    const polyPoints = points.map((pt, i) => `${getX(i).toFixed(1)},${getY(pt.percentage).toFixed(1)}`).join(' ');

    // Build polyline points for cumulative moving average
    const cumPoints = points.map((pt, i) => `${getX(i).toFixed(1)},${getY(pt.cumulativePercentage).toFixed(1)}`).join(' ');

    // Horizontal grid lines for 25%, 50%, 75%, 100%
    const gridLevels = [0, 25, 50, 75, 100];
    const gridLines = gridLevels.map(lvl => {
      const y = getY(lvl);
      return `
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="var(--border)" stroke-dasharray="3,3" stroke-width="1" />
        <text x="${padding.left - 8}" y="${y + 4}" font-size="10" fill="var(--text3)" text-anchor="end">${lvl}%</text>
      `;
    }).join('');

    // Circles and value labels
    const dotsHtml = points.map((pt, i) => {
      const cx = getX(i);
      const cy = getY(pt.percentage);
      const col = pt.percentage >= 70 ? 'var(--green)' : pt.percentage >= 50 ? 'var(--accent)' : 'var(--red)';
      return `
        <g class="trend-point" data-idx="${i}" style="cursor:pointer;">
          <circle cx="${cx}" cy="${cy}" r="5" fill="${col}" stroke="#fff" stroke-width="2" />
          <text x="${cx}" y="${cy - 9}" font-size="10" font-weight="700" fill="var(--text)" text-anchor="middle">${pt.percentage}%</text>
          <text x="${cx}" y="${height - padding.bottom + 16}" font-size="9.5" fill="var(--text3)" text-anchor="middle">#${i + 1}</text>
        </g>
      `;
    }).join('');

    return `
      <div style="overflow-x:auto;margin-bottom:16px;">
        <svg viewBox="0 0 ${width} ${height}" style="width:100%;max-width:${width}px;height:auto;display:block;margin:0 auto;background:var(--bg);border-radius:10px;border:1px solid var(--border);">
          <!-- Grid lines -->
          ${gridLines}

          <!-- 75% Benchmark reference line -->
          <line x1="${padding.left}" y1="${getY(75)}" x2="${width - padding.right}" y2="${getY(75)}" stroke="rgba(16, 185, 129, 0.4)" stroke-width="1.5" />

          <!-- Cumulative average line (dashed grey) -->
          <polyline fill="none" stroke="var(--text3)" stroke-width="1.5" stroke-dasharray="4,4" points="${cumPoints}" opacity="0.6" />

          <!-- Individual assignment score line (solid blue) -->
          <polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${polyPoints}" />

          <!-- Data dots & text -->
          ${dotsHtml}
        </svg>
      </div>

      <div style="display:flex;justify-content:center;gap:18px;font-size:11.5px;color:var(--text3);margin-bottom:14px;flex-wrap:wrap;">
        <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:12px;height:3px;background:var(--accent);display:inline-block;border-radius:2px;"></span> Assignment Score</span>
        <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:12px;height:2px;border-top:2px dashed var(--text3);display:inline-block;"></span> Cumulative Average</span>
        <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:12px;height:2px;background:var(--green);display:inline-block;"></span> 75% Benchmark</span>
      </div>

      <!-- History Table -->
      <div class="tw">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Assignment</th>
              <th>Subject</th>
              <th>Graded Date</th>
              <th>Marks</th>
              <th>Score %</th>
              <th>Running Avg</th>
            </tr>
          </thead>
          <tbody>
            ${points.map((pt, i) => `
              <tr>
                <td><b>${i + 1}</b></td>
                <td><b>${H(pt.assignmentTitle)}</b></td>
                <td><span class="badge bgr">${H(pt.subject)}</span></td>
                <td>${fmtD(pt.date)}</td>
                <td><strong>${pt.marksObtained}</strong> / ${pt.totalMarks}</td>
                <td><span class="badge ${pt.percentage >= 70 ? 'bg' : pt.percentage >= 50 ? 'bb' : 'br'}">${pt.percentage}%</span></td>
                <td><b style="color:var(--text2);">${pt.cumulativePercentage}%</b></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * Render What-If Score Simulator Section
   */
  function renderWhatIfSimulator(overall, currentSubjects, upcomingAssignments) {
    const target = simulatorState.targetPercentage;
    const pendingList = (upcomingAssignments || []).filter(a => !a.evaluated);

    // Compute simulation using service logic directly in browser
    const hypoAssignments = [];

    // Add pending assignments with student's hypothetical input
    pendingList.forEach(a => {
      const userMark = simulatorState.hypotheticalMarksMap[a._id];
      const marksVal = userMark !== undefined ? Number(userMark) : Math.round(a.totalMarks * 0.75);
      hypoAssignments.push({
        id: a._id,
        title: a.title,
        subject: a.subject,
        maxMarks: a.totalMarks,
        hypotheticalMarks: marksVal
      });
    });

    // Add any custom hypothetical assignments
    simulatorState.customAssignments.forEach((c, idx) => {
      hypoAssignments.push({
        id: `custom_${idx}`,
        title: c.title || `Mock Assignment ${idx + 1}`,
        subject: c.subject || 'General',
        maxMarks: Number(c.maxMarks) || 50,
        hypotheticalMarks: Number(c.hypotheticalMarks) || 40
      });
    });

    // Calculate simulation result
    const simResult = calculateWhatIfInClient(overall, currentSubjects, hypoAssignments, target);

    const projPct = simResult.projected.percentage;
    const delta = simResult.projected.deltaPercentage;
    const meetsTarget = simResult.targetAnalysis.meetsTarget;

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start;flex-wrap:wrap;">
        <!-- LEFT: INPUTS & CONTROLS -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <label style="font-size:13px;font-weight:700;color:var(--text);">Target Overall Percentage:</label>
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="number" class="fc" id="sim-target-input" value="${target}" min="1" max="100" style="width:75px;font-weight:800;text-align:center;">
              <span style="font-weight:700;">%</span>
            </div>
          </div>

          <div style="font-size:12.5px;font-weight:700;margin-bottom:8px;color:var(--text2);display:flex;justify-content:space-between;">
            <span>Hypothetical Scores on Upcoming Work (${pendingList.length})</span>
            <span style="font-size:11px;color:var(--text3);font-weight:normal;">Edit marks to test projections</span>
          </div>

          ${pendingList.length === 0 ? `
            <div style="padding:14px;background:var(--bg);border-radius:8px;border:1px solid var(--border);font-size:12px;color:var(--text3);margin-bottom:12px;">
              No pending assignments. You can add hypothetical custom assignments below to project future semester scores!
            </div>` : `
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;max-height:260px;overflow-y:auto;padding-right:4px;">
              ${pendingList.map(a => {
                const currentHypo = simulatorState.hypotheticalMarksMap[a._id] !== undefined
                  ? simulatorState.hypotheticalMarksMap[a._id]
                  : Math.round(a.totalMarks * 0.75);
                return `
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;background:var(--bg);border-radius:8px;border:1px solid var(--border);">
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${H(a.title)}</div>
                      <div style="font-size:11px;color:var(--text3);">${H(a.subject)} · Max: ${a.totalMarks} marks</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                      <span style="font-size:11.5px;color:var(--text3);">Score:</span>
                      <input type="number" class="fc sim-hypo-input" data-assign-id="${a._id}" value="${currentHypo}" min="0" max="${a.totalMarks}" style="width:65px;padding:4px 6px;text-align:center;font-weight:700;">
                      <span style="font-size:11.5px;color:var(--text3);">/ ${a.totalMarks}</span>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}

          <!-- Custom hypothetical assignments -->
          ${simulatorState.customAssignments.length > 0 ? `
            <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:var(--text2);">Custom Mock Assignments:</div>
            <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">
              ${simulatorState.customAssignments.map((c, idx) => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg);border-radius:8px;border:1px solid var(--border);gap:8px;">
                  <div style="font-size:12px;font-weight:600;">${H(c.title)} (${H(c.subject)})</div>
                  <div style="display:flex;align-items:center;gap:6px;">
                    <span style="font-size:11px;">${c.hypotheticalMarks} / ${c.maxMarks}</span>
                    <button class="btn btn-d btn-sm sim-del-custom-btn" data-idx="${idx}" style="padding:2px 6px;font-size:10px;">✕</button>
                  </div>
                </div>
              `).join('')}
            </div>` : ''}

          <button class="btn btn-s btn-sm" id="sim-add-custom-btn" style="width:100%;margin-bottom:10px;">
            + Add Custom Mock Assignment
          </button>
        </div>

        <!-- RIGHT: PROJECTION OUTPUT & TARGET ANALYSIS -->
        <div>
          <div style="padding:18px;background:var(--bg);border-radius:12px;border:1px solid var(--border);margin-bottom:14px;">
            <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">
              Projected Overall Outcome
            </div>

            <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">
              <div style="font-size:38px;font-weight:900;color:${projPct >= target ? 'var(--green)' : 'var(--accent)'};line-height:1;">
                ${projPct}%
              </div>
              <div style="font-size:13px;font-weight:700;">
                <span class="badge ${delta >= 0 ? 'bg' : 'br'}" style="font-size:12px;">
                  ${delta >= 0 ? `+${delta}%` : `${delta}%`} vs current
                </span>
              </div>
            </div>

            <div style="font-size:12px;color:var(--text2);margin-bottom:12px;">
              Projected: <b>${simResult.projected.obtainedMarks}</b> / <b>${simResult.projected.totalMaxMarks}</b> marks
              (Current: ${overall.obtainedMarks} / ${overall.totalMaxMarks})
            </div>

            <div class="prog" style="height:8px;margin-bottom:14px;">
              <div class="pb ${projPct >= 70 ? 'pb-g' : projPct >= 50 ? 'pb-b' : 'pb-r'}" style="width:${Math.min(projPct, 100)}%;"></div>
            </div>

            <!-- Target evaluation banner -->
            <div style="padding:10px 12px;border-radius:8px;font-size:12.5px;line-height:1.4;${meetsTarget ? 'background:rgba(16,185,129,0.1);color:var(--green);border:1px solid rgba(16,185,129,0.3);' : 'background:rgba(245,158,11,0.1);color:#D97706;border:1px solid rgba(245,158,11,0.3);'}">
              ${meetsTarget
                ? `<strong>🎉 Target Met!</strong> Your projected score of ${projPct}% achieves your ${target}% goal with room to spare (+${Math.abs(simResult.targetAnalysis.gap)}%).`
                : `<strong>⚠️ Target Gap:</strong> Your projected score is ${Math.abs(simResult.targetAnalysis.gap)}% below your ${target}% target.${simResult.targetAnalysis.marksNeededForTarget !== null ? ` You need at least <b>${simResult.targetAnalysis.marksNeededForTarget} marks</b> across simulated assignments to reach ${target}%.` : ''}`
              }
            </div>
          </div>

          <!-- Subject-wise projected breakdown table -->
          ${simResult.projectedSubjects.length > 0 ? `
            <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:var(--text2);">Projected Subject Impact:</div>
            <div class="tw" style="max-height:180px;overflow-y:auto;">
              <table style="font-size:11.5px;">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Current %</th>
                    <th>Projected %</th>
                    <th>Impact</th>
                  </tr>
                </thead>
                <tbody>
                  ${simResult.projectedSubjects.map(ps => `
                    <tr>
                      <td><b>${H(ps.subject)}</b></td>
                      <td>${ps.currentPercentage !== null ? `${ps.currentPercentage}%` : '—'}</td>
                      <td><b style="color:${ps.projectedPercentage >= 70 ? 'var(--green)' : 'var(--text)'};">${ps.projectedPercentage !== null ? `${ps.projectedPercentage}%` : '—'}</b></td>
                      <td>
                        <span class="badge ${ps.deltaPercentage > 0 ? 'bg' : ps.deltaPercentage < 0 ? 'br' : 'bgr'}">
                          ${ps.deltaPercentage > 0 ? `+${ps.deltaPercentage}%` : `${ps.deltaPercentage}%`}
                        </span>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Pure client calculation mirroring the backend simulateWhatIf
   */
  function calculateWhatIfInClient(currentOverall, currentSubjects, hypotheticalAssignments, targetPercentage) {
    const curObtained = Number(currentOverall.obtainedMarks) || 0;
    const curMax = Number(currentOverall.totalMaxMarks) || 0;
    const target = Number(targetPercentage) || 75;

    let hypoTotalObtained = 0;
    let hypoTotalMax = 0;
    const hypoBySubject = new Map();

    for (const item of hypotheticalAssignments) {
      const max = Number(item.maxMarks) || 0;
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

    const meetsTarget = projectedPercentage >= target;
    const gap = Math.round((target - projectedPercentage) * 10) / 10;

    let marksNeededForTarget = null;
    if (hypoTotalMax > 0) {
      const req = Math.ceil(((target / 100) * (curMax + hypoTotalMax) - curObtained) * 10) / 10;
      marksNeededForTarget = Math.max(0, Math.min(req, hypoTotalMax));
    }

    const projectedSubjects = (currentSubjects || []).map(s => {
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
        deltaPercentage: subDelta
      };
    });

    return {
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

  /**
   * Bind event listeners in a CSP-compliant manner
   */
  function bindAnalyticsEvents() {
    // Refresh button
    $('perf-refresh-btn')?.addEventListener('click', loadPerformanceAnalytics);

    // Target percentage input
    $('sim-target-input')?.addEventListener('input', e => {
      const val = Number(e.target.value);
      if (!isNaN(val) && val >= 1 && val <= 100) {
        simulatorState.targetPercentage = val;
        updateSimulatorCard();
      }
    });

    // Hypothetical marks inputs
    document.querySelectorAll('.sim-hypo-input').forEach(input => {
      input.addEventListener('input', e => {
        const aId = e.target.getAttribute('data-assign-id');
        const val = Number(e.target.value);
        if (aId && !isNaN(val)) {
          simulatorState.hypotheticalMarksMap[aId] = val;
          updateSimulatorCard();
        }
      });
    });

    // Reset button
    $('sim-reset-btn')?.addEventListener('click', () => {
      simulatorState.targetPercentage = 75;
      simulatorState.customAssignments = [];
      simulatorState.hypotheticalMarksMap = {};
      if (Array.isArray(analyticsData?.upcomingAssignments)) {
        analyticsData.upcomingAssignments.forEach(a => {
          if (!a.evaluated) {
            simulatorState.hypotheticalMarksMap[a._id] = Math.round(a.totalMarks * 0.75);
          }
        });
      }
      updateSimulatorCard();
      toast('Simulator reset to defaults.', 's');
    });

    // Delete custom assignment buttons
    document.querySelectorAll('.sim-del-custom-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        if (!isNaN(idx)) {
          simulatorState.customAssignments.splice(idx, 1);
          updateSimulatorCard();
        }
      });
    });

    // Add custom mock assignment button
    $('sim-add-custom-btn')?.addEventListener('click', showAddCustomModal);
  }

  /**
   * Re-render only the simulator card when inputs change
   */
  function updateSimulatorCard() {
    const simCard = $('simulator-card');
    if (!simCard || !analyticsData) return;
    const cb = simCard.querySelector('.cb');
    if (cb) {
      cb.innerHTML = renderWhatIfSimulator(
        analyticsData.overall,
        analyticsData.subjectAnalysis.subjects,
        analyticsData.upcomingAssignments
      );
      bindAnalyticsEvents();
    }
  }

  /**
   * Show modal to add a custom hypothetical assignment
   */
  function showAddCustomModal() {
    const subjects = (analyticsData?.subjectAnalysis?.subjects || []).map(s => s.subject);
    const subjectOptions = subjects.length > 0
      ? subjects.map(s => `<option value="${H(s)}">${H(s)}</option>`).join('')
      : '<option value="General">General</option>';

    const modalBody = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="fg">
          <label>Assignment Title / Label</label>
          <input type="text" class="fc" id="modal-custom-title" placeholder="e.g. Endterm Project or Lab Test" value="Mock Assignment ${simulatorState.customAssignments.length + 1}">
        </div>
        <div class="fg">
          <label>Subject</label>
          <select class="fc" id="modal-custom-subject">
            ${subjectOptions}
          </select>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="fg">
            <label>Maximum Marks</label>
            <input type="number" class="fc" id="modal-custom-max" value="50" min="1" max="500">
          </div>
          <div class="fg">
            <label>Hypothetical Score</label>
            <input type="number" class="fc" id="modal-custom-score" value="40" min="0" max="500">
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
          <button class="btn btn-g" id="modal-custom-cancel">Cancel</button>
          <button class="btn btn-p" id="modal-custom-save">Add to Simulation</button>
        </div>
      </div>
    `;

    openMod('Add Mock Assignment', modalBody);

    $('modal-custom-cancel')?.addEventListener('click', closeMod);
    $('modal-custom-save')?.addEventListener('click', () => {
      const title = $('modal-custom-title')?.value.trim() || `Mock Assignment`;
      const subject = $('modal-custom-subject')?.value || 'General';
      const max = Number($('modal-custom-max')?.value) || 50;
      const score = Number($('modal-custom-score')?.value) || 0;

      simulatorState.customAssignments.push({
        title,
        subject,
        maxMarks: max,
        hypotheticalMarks: Math.min(score, max)
      });

      closeMod();
      updateSimulatorCard();
      toast('Mock assignment added to simulator.', 's');
    });
  }

  // Export to global window object
  window.loadPerformanceAnalytics = loadPerformanceAnalytics;
})();

