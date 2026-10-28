// ════════════════════════════════════════════════════════════════
//  Admin "Job Queue & Scheduling" page  (OS features)
//  Loaded by index.html after the main script; reuses its globals
//  ($, api, toast, fmtDT, avColor …). Admin role only.
//
//  Two clearly separated areas:
//    ● LIVE  – real job queue, real worker processes (PIDs), real timings
//    ● SIMULATION – textbook CPU-scheduling models; nothing is executed
// ════════════════════════════════════════════════════════════════
(function () {
  const H = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { status: '', page: 1, limit: 10, timer: null, auto: true, procs: null };
  const DEFAULT_PROCS = [{ id: 'P1', arrival: 0, burst: 5 }, { id: 'P2', arrival: 1, burst: 3 }, { id: 'P3', arrival: 2, burst: 8 }, { id: 'P4', arrival: 3, burst: 6 }];
  const badge = { waiting: 'ba', running: 'bb', completed: 'bg', failed: 'br' };
  const wbadge = { idle: 'bg', busy: 'bb', starting: 'ba', restarting: 'br', stopping: 'ba', stopped: 'br' };
  const dur = ms => ms == null ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
  const bytes = b => (typeof fSize === 'function' ? fSize(b || 0) : `${b || 0} B`);

  function shell() {
    $('page-jobs').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:6px;">
        <div><div style="font-size:17px;font-weight:800;">Job Queue &amp; Scheduling</div>
        <div style="font-size:12.5px;color:var(--text3);">Assignment-processing queue · worker processes · CPU scheduling</div></div>
        <div style="display:flex;gap:10px;align-items:center;">
          <label style="font-size:12px;color:var(--text2);display:flex;gap:5px;align-items:center;cursor:pointer;"><input type="checkbox" id="jq-auto" ${st.auto ? 'checked' : ''} data-jq-change="auto"> Auto-refresh (15s)</label>
          <button class="btn btn-s btn-sm" data-jq-action="refresh">↻ Refresh</button>
        </div>
      </div>
      <div class="alert ai" style="margin:10px 0 14px;"><span>🟢</span><span><b>LIVE</b> sections below show real data: jobs executing in real child processes (<code>child_process.fork</code>) with real PIDs and measured times.
        The <b>Simulator</b> at the bottom is a separate textbook model and executes nothing.</span></div>
      <div id="jq-live"><div class="loading"><span class="spin spin-d"></span> Loading...</div></div>
      <div id="jq-sim"></div>`;
    renderSim();
  }

  async function refresh() {
    const live = $('jq-live'); if (!live) return;
    try {
      const qs = `?page=${st.page}&limit=${st.limit}${st.status ? '&status=' + st.status : ''}`;
      const r = await api('/admin/jobs/overview' + qs);
      if (!r.success) { live.innerHTML = `<div class="alert ae">${H(r.message || 'Failed to load job data.')}</div>`; return; }
      live.innerHTML = renderLive(r);
    } catch (e) { live.innerHTML = `<div class="alert ae">${H(e.message)}</div>`; }
  }

  function renderLive(r) {
    const c = r.stats.counts, lim = r.stats.limits;
    const pages = Math.max(1, Math.ceil(r.total / r.limit));
    return `
      <div class="sr">
        <div class="sb"><div class="sl">Waiting</div><div class="sv">${c.waiting}</div><div class="ss">limit ${lim.maxWaiting}</div></div>
        <div class="sb"><div class="sl">Running</div><div class="sv">${c.running}</div><div class="ss">${lim.workers} worker process(es)</div></div>
        <div class="sb"><div class="sl">Completed</div><div class="sv">${c.completed}</div></div>
        <div class="sb"><div class="sl">Failed</div><div class="sv" style="color:${c.failed ? 'var(--red)' : 'inherit'};">${c.failed}</div><div class="ss">max ${lim.maxAttempts} attempts</div></div>
      </div>

      <div class="card" style="margin-bottom:14px;"><div class="ch"><span class="ct">⚙️ Process Manager — worker processes <span class="badge bg" style="margin-left:6px;">LIVE</span></span>
        <span style="display:flex;gap:8px;align-items:center;font-size:12px;">Dispatch policy (real):
          <select class="fc" id="jq-policy" style="width:auto;padding:4px 8px;"><option value="fcfs" ${r.stats.policy === 'fcfs' ? 'selected' : ''}>FCFS</option><option value="sjf" ${r.stats.policy === 'sjf' ? 'selected' : ''}>SJF (non-preemptive)</option></select>
          <button class="btn btn-s btn-sm" data-jq-action="policy">Apply</button></span></div>
        <div class="tw"><table><thead><tr><th>Worker</th><th>PID</th><th>State</th><th>Current job</th><th>Progress</th><th>Done</th><th>Restarts</th><th>Uptime</th><th>Last exit</th><th></th></tr></thead><tbody>
        ${r.workers.map(w => `<tr>
          <td style="font-weight:600;">${H(w.id)}</td><td style="font-family:var(--m);">${w.pid || '—'}</td>
          <td><span class="badge ${wbadge[w.state] || 'ba'}">${H(w.state)}</span></td>
          <td style="font-family:var(--m);font-size:11.5px;">${w.currentJobId ? H(String(w.currentJobId).slice(-8)) : '—'}</td>
          <td style="min-width:90px;">${w.state === 'busy' ? `<div class="prog"><div class="pb pb-b" style="width:${w.progress || 0}%;"></div></div>` : '—'}</td>
          <td>${w.jobsCompleted}</td><td>${w.restarts}</td><td>${w.uptimeMs ? dur(w.uptimeMs) : '—'}</td>
          <td style="font-size:11.5px;color:var(--text3);">${w.lastExit ? H(`${w.lastExit.reason}${w.lastExit.signal ? ' (' + w.lastExit.signal + ')' : ''}`) : '—'}</td>
          <td><button class="btn btn-d btn-sm" title="Sends SIGKILL – demonstrates crash recovery" data-jq-action="kill" data-id="${H(w.id)}">Kill</button></td></tr>`).join('')}
        </tbody></table></div></div>

      <div class="card" style="margin-bottom:14px;"><div class="ch"><span class="ct">📥 Assignment processing jobs <span class="badge bg" style="margin-left:6px;">LIVE</span></span>
        <span style="display:flex;gap:6px;">${['', 'waiting', 'running', 'completed', 'failed'].map(s => `<button class="btn ${st.status === s ? 'btn-p' : 'btn-s'} btn-sm" data-jq-action="filter" data-status="${s}">${s || 'All'}</button>`).join('')}</span></div>
        <div class="tw"><table><thead><tr><th>Job</th><th>Status</th><th>Files</th><th>Attempts</th><th>Worker (PID)</th><th title="enqueue → start">Waiting</th><th title="start → finish">Burst</th><th title="enqueue → finish">Turnaround</th><th>Result</th><th></th></tr></thead><tbody>
        ${r.jobs.length === 0 ? '<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:24px;">No jobs yet. Jobs are created automatically when a student submits an assignment.</td></tr>' :
          r.jobs.map(j => `<tr>
          <td><div style="font-weight:600;font-size:12.5px;">${H(j.label || j._id)}</div><div style="font-size:10.5px;color:var(--text3);font-family:var(--m);">${H(fmtDT(j.enqueuedAt))}</div></td>
          <td><span class="badge ${badge[j.status]}">${H(j.status)}</span></td>
          <td>${j.fileCount} · ${bytes(j.estimatedBytes)}</td>
          <td>${j.attempts}/${j.maxAttempts}</td>
          <td style="font-family:var(--m);font-size:11.5px;">${j.workerId ? H(j.workerId) + ' (' + (j.workerPid || '?') + ')' : '—'}</td>
          <td>${dur(j.metrics.waitingMs)}</td><td>${dur(j.metrics.burstMs)}</td><td>${dur(j.metrics.turnaroundMs)}</td>
          <td style="font-size:12px;">${j.status === 'failed' ? `<span style="color:var(--red);" title="${H(j.error)}">${H((j.error || '').slice(0, 40))}</span>` :
              j.verdict ? `<span class="badge ${j.verdict === 'clean' ? 'bg' : 'ba'}">${H(j.verdict)}</span>` : (j.lastFailure ? `<span title="${H(j.lastFailure)}">retrying…</span>` : '—')}</td>
          <td>${j.status === 'failed' ? `<button class="btn btn-s btn-sm" data-jq-action="retry" data-id="${H(j._id)}">Retry</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="cb" style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text3);">
          <span>${r.total} job(s) · page ${r.page}/${pages}</span>
          <span style="display:flex;gap:6px;"><button class="btn btn-s btn-sm" ${r.page <= 1 ? 'disabled' : ''} data-jq-action="page" data-page="${r.page - 1}">‹ Prev</button><button class="btn btn-s btn-sm" ${r.page >= pages ? 'disabled' : ''} data-jq-action="page" data-page="${r.page + 1}">Next ›</button></span></div></div>

      ${renderTimeline(r.timeline)}`;
  }

  // Real execution timeline: one lane per worker, built from measured start/finish times.
  function renderTimeline(jobs) {
    jobs = (jobs || []).filter(j => j.startedAt && j.finishedAt);
    if (!jobs.length) return '';
    const t0 = Math.min(...jobs.map(j => +new Date(j.startedAt))), t1 = Math.max(...jobs.map(j => +new Date(j.finishedAt))), span = Math.max(1, t1 - t0);
    const lanes = [...new Set(jobs.map(j => j.workerId))].sort();
    return `<div class="card" style="margin-bottom:14px;"><div class="ch"><span class="ct">📊 Actual execution timeline — last ${jobs.length} finished jobs <span class="badge bg" style="margin-left:6px;">LIVE · measured</span></span></div><div class="cb">
      ${lanes.map(l => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><div style="width:70px;font-size:11.5px;font-family:var(--m);">${H(l)}</div>
        <div style="position:relative;flex:1;height:26px;background:var(--bg);border-radius:4px;">
        ${jobs.filter(j => j.workerId === l).map(j => { const left = (new Date(j.startedAt) - t0) / span * 100, w = Math.max(0.8, (new Date(j.finishedAt) - new Date(j.startedAt)) / span * 100);
          return `<div title="${H(j.label)} — ${dur(j.metrics.burstMs)} (${j.status})" style="position:absolute;left:${left}%;width:${w}%;top:2px;bottom:2px;border-radius:3px;background:${j.status === 'failed' ? 'var(--red)' : avColor(j.label)};opacity:.9;"></div>`; }).join('')}
        </div></div>`).join('')}
      <div style="font-size:11px;color:var(--text3);">Span: ${dur(span)}. Hover a bar for the job. Bars are real start→finish times of the last attempt.</div></div></div>`;
  }

  // ───────────────────────── SIMULATOR ─────────────────────────
  function renderSim() {
    if (!st.procs) st.procs = DEFAULT_PROCS.map(p => ({ ...p }));
    $('jq-sim').innerHTML = `
      <div class="card" style="border:2px dashed var(--border2);"><div class="ch"><span class="ct">🧪 CPU Scheduling Simulator <span class="badge ba" style="margin-left:6px;">SIMULATION — nothing is executed</span></span></div><div class="cb">
        <div style="font-size:12.5px;color:var(--text2);margin-bottom:10px;">Textbook model of ONE virtual CPU running FCFS, non-preemptive SJF and Round Robin over the processes below. It is independent of the live queue above
          (real dispatch supports FCFS and SJF only – a forked job cannot be time-sliced, so Round Robin exists only here). Times are in abstract units (or ms when loaded from real jobs).</div>
        <table style="width:auto;margin-bottom:8px;"><thead><tr><th>Process</th><th>Arrival</th><th>Burst</th><th></th></tr></thead><tbody>
        ${st.procs.map((p, i) => `<tr>
          <td><input class="fc" style="width:90px;" value="${H(p.id)}" data-jq-proc-idx="${i}" data-jq-proc-key="id"></td>
          <td><input class="fc" type="number" min="0" style="width:90px;" value="${H(p.arrival)}" data-jq-proc-idx="${i}" data-jq-proc-key="arrival"></td>
          <td><input class="fc" type="number" min="1" style="width:90px;" value="${H(p.burst)}" data-jq-proc-idx="${i}" data-jq-proc-key="burst"></td>
          <td><button class="btn btn-d btn-sm" data-jq-action="procDel" data-idx="${i}">✕</button></td></tr>`).join('')}
        </tbody></table>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
          <button class="btn btn-s btn-sm" data-jq-action="procAdd">+ Add process</button>
          <button class="btn btn-s btn-sm" data-jq-action="procSample">Sample set</button>
          <button class="btn btn-s btn-sm" data-jq-action="procFromJobs">Load recent real jobs</button>
          <label style="font-size:12px;margin-left:8px;">Quantum (RR) <input class="fc" id="jq-q" type="number" min="1" value="2" style="width:70px;display:inline-block;padding:5px 8px;"></label>
          <button class="btn btn-p btn-sm" data-jq-action="simulate">▶ Run simulation</button>
        </div>
        <div id="jq-sim-out"></div></div></div>`;
  }

  function gantt(g) {
    const total = g[g.length - 1].end - g[0].start || 1;
    return `<div style="display:flex;border:1px solid var(--border);border-radius:4px;overflow:hidden;height:34px;">
      ${g.map(s => `<div title="${H(s.pid)}: ${s.start}–${s.end}" style="flex:${Math.max(0.5, (s.end - s.start) / total * 100)} 0 0;min-width:14px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${s.pid === 'IDLE' ? 'var(--text3)' : '#fff'};background:${s.pid === 'IDLE' ? 'repeating-linear-gradient(45deg,#eee,#eee 4px,#ddd 4px,#ddd 8px)' : avColor(s.pid)};border-right:1px solid rgba(255,255,255,.5);overflow:hidden;">${H(s.pid)}</div>`).join('')}</div>
      <div style="display:flex;margin-top:2px;font-size:10.5px;font-family:var(--m);color:var(--text3);">
      ${g.map(s => `<div style="flex:${Math.max(0.5, (s.end - s.start) / total * 100)} 0 0;min-width:14px;overflow:hidden;">${(s.end - s.start) / total >= 0.03 || s === g[0] ? s.start : ''}</div>`).join('')}<div>${g[g.length - 1].end}</div></div>`;
  }

  function renderSimResults(results) {
    return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;">
      ${results.map(r => `<div class="sb"><div class="sl">${H(r.algorithm)}</div><div class="ss">Avg waiting <b>${r.averages.waiting}</b> · Avg turnaround <b>${r.averages.turnaround}</b><br>Avg response ${r.averages.response} · CPU ${r.cpuUtilization}%</div></div>`).join('')}</div>
      ${results.map(r => `<div style="margin-bottom:18px;"><div style="font-size:13.5px;font-weight:700;margin-bottom:6px;">${H(r.algorithm)} <span class="badge ba">SIMULATION</span></div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:6px;">Order of first dispatch: <b>${r.executionOrder.map(H).join(' → ')}</b> · Completion order: ${r.completionOrder.map(H).join(' → ')}</div>
        ${gantt(r.gantt)}
        <div class="tw" style="margin-top:8px;"><table><thead><tr><th>Process</th><th>Arrival</th><th>Burst</th><th>Start</th><th>Completion</th><th>Waiting</th><th>Turnaround</th><th>Response</th></tr></thead><tbody>
        ${r.processes.map(p => `<tr><td><b>${H(p.id)}</b></td><td>${p.arrival}</td><td>${p.burst}</td><td>${p.start}</td><td>${p.completion}</td><td>${p.waiting}</td><td>${p.turnaround}</td><td>${p.response}</td></tr>`).join('')}
        <tr style="background:var(--bg);font-weight:700;"><td colspan="5">Average</td><td>${r.averages.waiting}</td><td>${r.averages.turnaround}</td><td>${r.averages.response}</td></tr></tbody></table></div></div>`).join('')}
      <div style="font-size:11.5px;color:var(--text3);">Waiting = turnaround − burst · Turnaround = completion − arrival · Response = first start − arrival.</div>`;
  }

  // ───────────────────────── actions (global for inline handlers) ─────────────────────────
  Object.assign(window, {
    jqRefresh: refresh,
    jqAuto(on) { st.auto = on; arm(); },
    jqFilter(s) { st.status = s; st.page = 1; refresh(); },
    jqPage(p) { st.page = Math.max(1, p); refresh(); },
    async jqPolicy() {
      try { const r = await api('/admin/jobs/policy', { method: 'PATCH', body: JSON.stringify({ policy: $('jq-policy').value }) });
        if (!r.success) throw new Error(r.message); toast(r.message, 's'); refresh(); } catch (e) { toast(e.message, 'e'); }
    },
    async jqKill(id) {
      if (!confirm(`Send SIGKILL to ${id}? Its running job will be re-queued and the worker restarted automatically.`)) return;
      try { const r = await api(`/admin/jobs/workers/${encodeURIComponent(id)}/kill`, { method: 'POST' });
        if (!r.success) throw new Error(r.message); toast(r.message, 's'); setTimeout(refresh, 600); } catch (e) { toast(e.message, 'e'); }
    },
    async jqRetry(id) {
      try { const r = await api(`/admin/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' });
        if (!r.success) throw new Error(r.message); toast('Job re-queued.', 's'); refresh(); } catch (e) { toast(e.message, 'e'); }
    },
    jqProc(i, k, v) { st.procs[i][k] = k === 'id' ? v : Number(v); },
    jqProcAdd() { st.procs.push({ id: `P${st.procs.length + 1}`, arrival: 0, burst: 1 }); renderSim(); },
    jqProcDel(i) { st.procs.splice(i, 1); renderSim(); },
    jqProcSample() { st.procs = DEFAULT_PROCS.map(p => ({ ...p })); renderSim(); },
    async jqProcFromJobs() {
      try { const r = await api('/admin/jobs/simulate/from-jobs');
        if (!r.success) throw new Error(r.message);
        if (!r.processes.length) return toast(r.note || 'No completed jobs yet.', 'w');
        st.procs = r.processes.map(({ id, arrival, burst }) => ({ id, arrival, burst })); renderSim(); toast(r.note, 'i'); } catch (e) { toast(e.message, 'e'); }
    },
    async jqSimulate() {
      const out = $('jq-sim-out'); out.innerHTML = '<div class="loading"><span class="spin spin-d"></span></div>';
      try { const r = await api('/admin/jobs/simulate', { method: 'POST', body: JSON.stringify({ processes: st.procs, quantum: Number($('jq-q').value) }) });
        if (!r.success) throw new Error(r.message); out.innerHTML = renderSimResults(r.results); } catch (e) { out.innerHTML = `<div class="alert ae">${H(e.message)}</div>`; }
    },
    loadJobsAdmin() { shell(); refresh(); arm(); }
  });

  // Poll only while the page is visible; stop as soon as the admin navigates away (keeps API rate-limit usage low).
  function arm() {
    clearInterval(st.timer);
    if (!st.auto) return;
    st.timer = setInterval(() => {
      const pg = $('page-jobs');
      if (!pg || !pg.classList.contains('active') || typeof TOKEN === 'undefined' || !TOKEN) { clearInterval(st.timer); return; }
      if (!document.hidden) refresh();
    }, 15000);
  }

  // Event delegation inside page-jobs to avoid inline event attributes
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-jq-action]');
    if (!btn) return;
    const act = btn.getAttribute('data-jq-action');
    if (act === 'refresh') refresh();
    else if (act === 'policy') window.jqPolicy();
    else if (act === 'kill') window.jqKill(btn.getAttribute('data-id'));
    else if (act === 'filter') window.jqFilter(btn.getAttribute('data-status'));
    else if (act === 'retry') window.jqRetry(btn.getAttribute('data-id'));
    else if (act === 'page') window.jqPage(Number(btn.getAttribute('data-page')));
    else if (act === 'procDel') window.jqProcDel(Number(btn.getAttribute('data-idx')));
    else if (act === 'procAdd') window.jqProcAdd();
    else if (act === 'procSample') window.jqProcSample();
    else if (act === 'procFromJobs') window.jqProcFromJobs();
    else if (act === 'simulate') window.jqSimulate();
  });

  document.addEventListener('change', function (e) {
    if (e.target && e.target.getAttribute('data-jq-change') === 'auto') {
      window.jqAuto(e.target.checked);
    } else if (e.target && e.target.hasAttribute('data-jq-proc-idx')) {
      const idx = Number(e.target.getAttribute('data-jq-proc-idx'));
      const key = e.target.getAttribute('data-jq-proc-key');
      window.jqProc(idx, key, e.target.value);
    }
  });

})();
