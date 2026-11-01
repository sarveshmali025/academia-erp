
// ── CSP COMPLIANT ACTION DISPATCHER ──
document.addEventListener('click', function(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.getAttribute('data-action');
  if (!action) return;

  try {
    switch (action) {
      case 'navTo': {
        const page = target.getAttribute('data-page');
        const param = target.getAttribute('data-param');
        navTo(page, param || undefined);
        break;
      }
      case 'openCreateCls': openCreateCls(); break;
      case 'openJoinCls': openJoinCls(); break;
      case 'openCls': openCls(target.getAttribute('data-id')); break;
      case 'cpyCode': {
        e.stopPropagation();
        cpyCode(e, target.getAttribute('data-code'));
        break;
      }
      case 'openEditCls': {
        e.stopPropagation();
        openEditCls(
          target.getAttribute('data-id'),
          target.getAttribute('data-name'),
          target.getAttribute('data-subject'),
          target.getAttribute('data-desc') || '',
          target.getAttribute('data-sem') || '',
          target.getAttribute('data-ay') || ''
        );
        break;
      }
      case 'delCls': {
        e.stopPropagation();
        delCls(target.getAttribute('data-id'), target.getAttribute('data-name'));
        break;
      }
      case 'swTab': {
        const tab = target.getAttribute('data-tab');
        swTab(tab, target);
        break;
      }
      case 'openCreateAsgn': openCreateAsgn(target.getAttribute('data-cid')); break;
      case 'remStud': remStud(target.getAttribute('data-cid'), target.getAttribute('data-sid'), target.getAttribute('data-name')); break;
      case 'exportGrades': exportGrades(target.getAttribute('data-cid'), target.getAttribute('data-name')); break;
      case 'openAsgn': openAsgn(target.getAttribute('data-id')); break;
      case 'createCls': createCls(); break;
      case 'updCls': updCls(target.getAttribute('data-id')); break;
      case 'joinCls': joinCls(); break;
      case 'openEditAsgn': {
        openEditAsgn(
          target.getAttribute('data-id'),
          target.getAttribute('data-title'),
          Number(target.getAttribute('data-marks')),
          target.getAttribute('data-deadline')
        );
        break;
      }
      case 'delAsgn': delAsgn(target.getAttribute('data-id'), target.getAttribute('data-title')); break;
      case 'triggerUpload': {
        const fi = document.getElementById('sfi');
        if (fi) fi.click();
        break;
      }
      case 'submitAsgn': submitAsgn(target.getAttribute('data-id')); break;
      case 'viewFiles': viewFiles(target.getAttribute('data-subid'), target.getAttribute('data-sname')); break;
      case 'openGrade': {
        const m = target.getAttribute('data-marks');
        openGrade(
          target.getAttribute('data-subid'),
          target.getAttribute('data-asgnid'),
          target.getAttribute('data-sname'),
          Number(target.getAttribute('data-totalmarks') || 100),
          m === 'null' || m === '' ? null : Number(m),
          target.getAttribute('data-feedback') || ''
        );
        break;
      }
      case 'downloadFile': {
        downloadFile(target.getAttribute('data-subid'), Number(target.getAttribute('data-idx')), target.getAttribute('data-name'));
        break;
      }
      case 'remFile': remFile(Number(target.getAttribute('data-idx'))); break;
      case 'togExt': togExt(target); break;
      case 'createAsgn': createAsgn(target.getAttribute('data-cid')); break;
      case 'updAsgn': updAsgn(target.getAttribute('data-id')); break;
      case 'saveGrade': saveGrade(target.getAttribute('data-asgnid'), target.getAttribute('data-subid'), Number(target.getAttribute('data-totalmarks'))); break;
      case 'togUser': togUser(target.getAttribute('data-id'), target.getAttribute('data-name'), target.getAttribute('data-active') === 'true'); break;
      case 'loadClsAnalytics': loadClsAnalytics(target.getAttribute('data-id'), target.getAttribute('data-name')); break;
      case 'loadAnalytics': loadAnalytics(); break;
      case 'saveProfile': saveProfile(); break;
      case 'changePwd': changePwd(); break;
      case 'readNotif': readNotif(target.getAttribute('data-id')); break;
      case 'stopProp': e.stopPropagation(); break;
    }
  } catch (err) {
    console.error('Action error:', err);
  }
});

document.addEventListener('dragover', function(e) {
  const dz = e.target.closest('#sdz');
  if (dz) {
    e.preventDefault();
    dz.classList.add('over');
  }
});
document.addEventListener('dragleave', function(e) {
  const dz = e.target.closest('#sdz');
  if (dz) {
    dz.classList.remove('over');
  }
});
document.addEventListener('drop', function(e) {
  const dz = e.target.closest('#sdz');
  if (dz) {
    e.preventDefault();
    dz.classList.remove('over');
    if (typeof dropFiles === 'function') dropFiles(e);
  }
});
document.addEventListener('change', function(e) {
  if (e.target && e.target.id === 'sfi') {
    if (typeof addFiles === 'function') addFiles(e);
  }
});


// ════════════════════════════════════════════════════
//  ACADEMIA ERP — Complete Frontend Logic
//  ⚠️  Set API_BASE to your backend URL below!
// ════════════════════════════════════════════════════
const API_BASE = window.location.origin && window.location.origin !== 'null' && window.location.protocol.startsWith('http')
  ? window.location.origin
  : 'http://localhost:5000';

let CU = null, TOKEN = null, curClass = null, curAssign = null, pollTimer = null;
const $ = id => document.getElementById(id);

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  const t = localStorage.getItem('acad_tok');
  const u = localStorage.getItem('acad_usr');
  if (t && u) {
    try {
      TOKEN = t;
      CU = JSON.parse(u);
      showApp();
      navTo('dashboard');
      startPoll();
    } catch (e) {
      localStorage.removeItem('acad_tok');
      localStorage.removeItem('acad_usr');
    }
  }

  // Auth event bindings
  $('tab-login-btn')?.addEventListener('click', () => switchTab('login'));
  $('tab-register-btn')?.addEventListener('click', () => switchTab('register'));
  $('lbtn')?.addEventListener('click', doLogin);
  $('rbtn')?.addEventListener('click', doReg);
  $('lpwd')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('rpwd')?.addEventListener('keydown', e => { if (e.key === 'Enter') doReg(); });

  $('role-card-prof')?.addEventListener('click', function () { selRole('professor', this); });
  $('role-card-stu')?.addEventListener('click', function () { selRole('student', this); });

  // App chrome event bindings
  $('signout-btn')?.addEventListener('click', doLogout);
  $('nbbtn')?.addEventListener('click', toggleNotif);
  $('notif-mark-read-btn')?.addEventListener('click', markAllRead);
  $('notif-close-btn')?.addEventListener('click', toggleNotif);

  // Modal backdrop & close
  $('modal-close-btn')?.addEventListener('click', () => closeMod());
  $('ov')?.addEventListener('click', e => closeMod(e));
});

// ── UTILS ──
const fmtD = d => d ? new Date(d).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'}) : '—';
const fmtDT = d => d ? new Date(d).toLocaleString('en-IN', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
const isPast = d => new Date(d) < new Date();
const fSize = b => b < 1024 ? b+'B' : b < 1048576 ? (b/1024).toFixed(1)+'KB' : (b/1048576).toFixed(1)+'MB';
const initials = n => (n||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
const avColors = ['#1971C2','#0C8599','#2F9E44','#C92A2A','#E67700','#6741D9','#A61E4D','#087F5B'];
const avColor = n => { let h=0; for(const c of (n||'')) h=c.charCodeAt(0)+((h<<5)-h); return avColors[Math.abs(h)%avColors.length]; };
const esc = s => (s||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');
const timeAgo = d => {
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff/60000)+'m ago';
  if (diff < 86400000) return Math.floor(diff/3600000)+'h ago';
  return Math.floor(diff/86400000)+'d ago';
};

// ── API ──
async function api(path, opts={}) {
  const hdrs = {'Content-Type':'application/json',...(opts.headers||{})};
  if (TOKEN) hdrs['Authorization'] = `Bearer ${TOKEN}`;
  const res = await fetch(`${API_BASE}/api${path}`, {...opts, headers: hdrs});
  const data = await res.json().catch(() => ({success:false, message:'Server error'}));
  if (res.status === 401) { doLogout(); throw new Error('Session expired.'); }
  return {...data, _status: res.status};
}

async function apiForm(path, fd) {
  const hdrs = {};
  if (TOKEN) hdrs['Authorization'] = `Bearer ${TOKEN}`;
  const res = await fetch(`${API_BASE}/api${path}`, {method:'POST', headers:hdrs, body:fd});
  return res.json().catch(() => ({success:false, message:'Server error'}));
}

// ── TOAST ──
function toast(msg, type='i') {
  const icons = {s:'✅', e:'❌', i:'ℹ️', w:'⚠️'};
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  $('tc').appendChild(el);
  setTimeout(() => { el.style.animation='toastIn .25s ease reverse'; setTimeout(()=>el.remove(), 250); }, 4000);
}

// ── MODAL ──
function openMod(title, html, cb) {
  $('mtitle').textContent = title;
  $('mbody').innerHTML = html;
  $('ov').classList.add('show');
  if (cb) cb();
}
function closeMod(e) {
  if (e && e.target !== $('ov')) return;
  $('ov').classList.remove('show');
}

// ── AUTH ──
function switchTab(t) {
  document.querySelectorAll('.tab-btn').forEach((b,i) => b.classList.toggle('active',(i===0)===(t==='login')));
  $('login-form').style.display = t==='login'?'block':'none';
  $('register-form').style.display = t==='register'?'block':'none';
}

function selRole(r, el) {
  document.querySelectorAll('.role-card').forEach(c=>c.classList.remove('sel'));
  el.classList.add('sel');
  $('rrole').value = r;
  $('rsidg').style.display = r==='student'?'block':'none';
  $('rname').placeholder = r==='professor'?'Dr. Jane Smith':'Jane Smith';
}

async function doLogin() {
  const email = $('lemail').value.trim(), pwd = $('lpwd').value;
  if (!email||!pwd) { showErr('l','Please enter email and password.'); return; }
  const btn = $('lbtn');
  btn.innerHTML = '<span class="spin"></span> Signing in...'; btn.disabled=true;
  $('lerr').style.display='none';
  try {
    const r = await api('/auth/login', {method:'POST', body:JSON.stringify({email,password:pwd})});
    if (!r.success) { showErr('l',r.message); return; }
    TOKEN=r.token; CU=r.user;
    localStorage.setItem('acad_tok',TOKEN); localStorage.setItem('acad_usr',JSON.stringify(CU));
    showApp(); navTo('dashboard'); startPoll();
    toast(`Welcome back, ${CU.name.split(' ')[0]}!`,'s');
  } catch(e) { showErr('l',e.message||'Cannot connect to server.'); }
  finally { btn.innerHTML='Sign In'; btn.disabled=false; }
}

async function doReg() {
  const name=$('rname').value.trim(), email=$('remail').value.trim(), pwd=$('rpwd').value,
        role=$('rrole').value, dept=$('rdept').value.trim(), sid=$('rsid')?.value.trim();
  if (!name||!email||!pwd) { showErr('r','Please fill all required fields.'); return; }
  const btn = $('rbtn');
  btn.innerHTML = '<span class="spin"></span> Creating...'; btn.disabled=true;
  $('rerr').style.display='none';
  try {
    const r = await api('/auth/register', {method:'POST', body:JSON.stringify({name,email,password:pwd,role,department:dept,studentId:sid})});
    if (!r.success) { showErr('r',r.message); return; }
    TOKEN=r.token; CU=r.user;
    localStorage.setItem('acad_tok',TOKEN); localStorage.setItem('acad_usr',JSON.stringify(CU));
    showApp(); navTo('dashboard'); startPoll();
    toast(`Welcome, ${CU.name.split(' ')[0]}!`,'s');
  } catch(e) { showErr('r',e.message||'Cannot connect to server.'); }
  finally { btn.innerHTML='Create Account'; btn.disabled=false; }
}

function showErr(f, msg) {
  const el = $(`${f==='l'?'lerr':'rerr'}`);
  el.textContent = msg; el.style.display='flex';
}

function doLogout() {
  TOKEN=null; CU=null; curClass=null;
  if (pollTimer) clearInterval(pollTimer);
  localStorage.removeItem('acad_tok'); localStorage.removeItem('acad_usr');
  $('app').style.display='none'; $('auth').style.display='flex';
}

// ── APP ──
function showApp() {
  $('auth').style.display='none';
  $('app').style.display='block'; // block not flex so sidebar+main fill full width
  buildNav(); updateUser();
}

function updateUser() {
  const c = avColor(CU.name);
  $('sbav').textContent = initials(CU.name); $('sbav').style.background = c;
  $('sbname').textContent = CU.name; $('sbrole').textContent = CU.role==='professor'?'Professor':CU.role==='admin'?'Administrator':'Student';
  $('tbusr').textContent = CU.email;
}

function buildNav() {
  const common = [{id:'dashboard',lbl:'Dashboard',ic:'📊'}];
  const extra = {
    professor: [
      {id:'classrooms',lbl:'My Classrooms',ic:'🏫'},
      {id:'attendance',lbl:'Attendance',ic:'📅'},
      {id:'activity',lbl:'Activity Feed',ic:'📡'},
      {id:'profile',lbl:'My Profile',ic:'👤'}
    ],
    student: [
      {id:'classrooms',lbl:'My Classrooms',ic:'🏫'},
      {id:'attendance',lbl:'My Attendance',ic:'📅'},
      {id:'my-marks',lbl:'My Grades',ic:'🎯'},
      {id:'profile',lbl:'My Profile',ic:'👤'}
    ],
    admin: [
      {id:'classrooms',lbl:'All Classrooms',ic:'🏫'},
      {id:'attendance',lbl:'Attendance Reports',ic:'📅'},
      {id:'users',lbl:'Manage Users',ic:'👥'},
      {id:'analytics',lbl:'Analytics',ic:'📈'},
      {id:'jobs',lbl:'Job Queue & Scheduling',ic:'⚙️'},
      {id:'profile',lbl:'My Profile',ic:'👤'}
    ]
  };
  const items = [...common,...(extra[CU.role]||[])];
  $('sbnav').innerHTML = items.map(i=>`<div class="sb-item" id="nav-${i.id}" data-action="navTo" data-page="${i.id}"><span class="sb-ico">${i.ic}</span><span>${i.lbl}</span></div>`).join('');
}

const pageTitles = {
  dashboard:'Dashboard',
  classrooms:'Classrooms',
  'classroom-detail':'Classroom',
  'assignment-detail':'Assignment',
  'my-marks':'My Grades',
  users:'Users',
  analytics:'Analytics',
  profile:'My Profile',
  activity:'Activity Feed',
  jobs:'Job Queue & Scheduling',
  attendance:'Attendance Management'
};

function navTo(pid, data) {
  document.querySelectorAll('.sb-item').forEach(e=>e.classList.remove('active'));
  const nav = $(`nav-${pid}`); if(nav) nav.classList.add('active');
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const pg = $(`page-${pid}`); if(pg) pg.classList.add('active');
  $('tbtitle').textContent = pageTitles[pid]||pid;
  switch(pid) {
    case 'dashboard': loadDash(); break;
    case 'classrooms': loadClassrooms(); break;
    case 'classroom-detail': loadClassDetail(data); break;
    case 'assignment-detail': loadAssignDetail(data); break;
    case 'my-marks': loadMyMarks(); break;
    case 'users': loadUsers(); break;
    case 'analytics': loadAnalytics(); break;
    case 'profile': loadProfile(); break;
    case 'activity': loadActivity(); break;
    case 'jobs': if (CU.role==='admin') loadJobsAdmin(); break;
    case 'attendance': if (typeof loadAttendanceModule === 'function') loadAttendanceModule(data); break;
  }
}

// ── DASHBOARD ──
async function loadDash() {
  $('page-dashboard').innerHTML = '<div class="loading"><span class="spin spin-d"></span> Loading...</div>';
  try {
    if (CU.role==='admin') {
      const r = await api('/admin/dashboard');
      renderAdminDash(r);
    } else if (CU.role==='professor') {
      const r = await api('/classrooms');
      renderProfDash(r.classrooms||[]);
    } else {
      const [cr, mr] = await Promise.all([api('/classrooms'), api('/assignments/me/marks')]);
      renderStudDash(cr.classrooms||[], mr.grouped||[]);
    }
  } catch(e) { $('page-dashboard').innerHTML=`<div class="alert ae">${e.message}</div>`; }
}

function renderAdminDash(d) {
  const s = d.stats||{};
  $('page-dashboard').innerHTML = `
    <div style="margin-bottom:16px;"><span style="font-size:15px;color:var(--text2);">Welcome, <strong>${CU.name}</strong> — System Administrator</span></div>
    <div class="sr">
      <div class="sb"><div class="sl">Total Users</div><div class="sv">${s.totalUsers||0}</div><div class="ss">${s.totalProfessors||0} professors · ${s.totalStudents||0} students</div></div>
      <div class="sb"><div class="sl">Classrooms</div><div class="sv">${s.totalClassrooms||0}</div></div>
      <div class="sb"><div class="sl">Assignments</div><div class="sv">${s.totalAssignments||0}</div></div>
      <div class="sb"><div class="sl">Submissions</div><div class="sv">${s.totalSubmissions||0}</div><div class="ss">${s.gradedSubmissions||0} graded · ${s.pendingGrading||0} pending</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      <div class="card"><div class="ch"><span class="ct">Recent Submissions</span></div><div class="cb">
        ${(d.recentSubmissions||[]).length===0?'<p style="font-size:13px;color:var(--text3);">No submissions yet.</p>':
          (d.recentSubmissions||[]).slice(0,8).map(s=>`<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);">
            <div class="uav" style="width:28px;height:28px;font-size:10px;background:${avColor(s.student?.name)};">${initials(s.student?.name)}</div>
            <div style="flex:1;min-width:0;"><div style="font-size:12.5px;font-weight:600;">${s.student?.name||'—'}</div><div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.assignment?.title||'—'}</div></div>
            <div style="font-size:11px;color:var(--text3);">${fmtD(s.submittedAt)}</div>
          </div>`).join('')}
      </div></div>
      <div class="card"><div class="ch"><span class="ct">Avg Marks by Classroom</span></div><div class="cb">
        ${(d.avgMarks||[]).length===0?'<p style="font-size:13px;color:var(--text3);">No grades yet.</p>':
          (d.avgMarks||[]).map(m=>`<div style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="font-size:12.5px;font-weight:600;">${m.classroomName}</span><span style="font-size:12.5px;font-weight:700;color:var(--accent);">${m.avgMarks}</span></div><div class="prog"><div class="pb pb-b" style="width:${Math.min((m.avgMarks||0),100)}%;"></div></div></div>`).join('')}
      </div></div>
    </div>`;
}

function renderProfDash(cls) {
  const stud = cls.reduce((a,c)=>a+(c.students?.length||0),0);
  $('page-dashboard').innerHTML = `
    <div style="margin-bottom:16px;"><span style="font-size:15px;color:var(--text2);">Good day, <strong>${CU.name}</strong></span></div>
    <div class="sr">
      <div class="sb"><div class="sl">Classrooms</div><div class="sv">${cls.length}</div></div>
      <div class="sb"><div class="sl">Total Students</div><div class="sv">${stud}</div></div>
    </div>
    <div class="card"><div class="ch"><span class="ct">Your Classrooms</span><button class="btn btn-p btn-sm" data-action="openCreateCls">+ New Classroom</button></div><div class="cb">
      ${cls.length===0?`<div class="empty"><div class="ei">🏫</div><h3>No classrooms yet</h3><p>Create your first classroom to begin teaching.</p><button class="btn btn-p" data-action="openCreateCls">Create Classroom</button></div>`:
        `<div class="cg">${cls.map(clsCard).join('')}</div>`}
    </div></div>`;
}

function renderStudDash(cls, grouped) {
  const total = grouped.reduce((a,g)=>a+g.submissions.length,0);
  const overall = grouped.length ? grouped.reduce((a,g)=>a+parseFloat(g.percentage||0),0)/grouped.length : null;
  $('page-dashboard').innerHTML = `
    <div style="margin-bottom:16px;"><span style="font-size:15px;color:var(--text2);">Welcome, <strong>${CU.name}</strong></span></div>
    <div class="sr">
      <div class="sb"><div class="sl">Enrolled In</div><div class="sv">${cls.length}</div><div class="ss">classrooms</div></div>
      <div class="sb"><div class="sl">Graded Work</div><div class="sv">${total}</div><div class="ss">assignments</div></div>
      ${overall!==null?`<div class="sb"><div class="sl">Overall Avg</div><div class="sv" style="color:${overall>=70?'var(--green)':overall>=50?'var(--accent)':'var(--red)'};">${overall.toFixed(0)}%</div></div>`:''}
    </div>
    <div class="card"><div class="ch"><span class="ct">Your Classrooms</span><button class="btn btn-s btn-sm" data-action="openJoinCls">+ Join Classroom</button></div><div class="cb">
      ${cls.length===0?`<div class="empty"><div class="ei">📚</div><h3>No classrooms joined</h3><p>Ask your professor for a class code.</p><button class="btn btn-p" data-action="openJoinCls">Join Classroom</button></div>`:
        `<div class="cg">${cls.map(clsCard).join('')}</div>`}
    </div></div>`;
}

// ── CLASSROOM CARD ──
function clsCard(c) {
  const col = c.coverColor||'#1971C2';
  const isProf = CU.role==='professor' && (c.professor?._id||c.professor)===CU._id;
  return `<div class="cc" data-action="openCls" data-id="${c._id}">
    <div class="cb2" style="background:linear-gradient(135deg,${col} 0%,${col}CC 100%)">
      <span class="ccode" data-action="cpyCode" data-code="${c.classCode}" title="Copy code">${c.classCode}</span>
    </div>
    <div class="cbody">
      <div class="cn">${c.name}</div>
      <div class="csub">${c.subject}</div>
      <div class="cm">
        <span>👥 ${c.students?.length||0} student${(c.students?.length||0)!==1?'s':''}</span>
        ${c.professor?.name?`<span>· ${c.professor.name}</span>`:''}
        ${c.semester?`<span class="badge bgr">${c.semester}</span>`:''}
      </div>
    </div>
    ${isProf||CU.role==='admin'?`<div class="cf" data-action="stopProp">
      <button class="btn btn-s btn-sm" data-action="openEditCls" data-id="${c._id}" data-name="${esc(c.name)}" data-subject="${esc(c.subject)}" data-desc="${esc(c.description||'')}" data-sem="${esc(c.semester||'')}" data-ay="${esc(c.academicYear||'')}">Edit</button>
      <button class="btn btn-d btn-sm" data-action="delCls" data-id="${c._id}" data-name="${esc(c.name)}">Delete</button>
    </div>`:''}
  </div>`;
}

function cpyCode(e, code) {
  e.stopPropagation();
  navigator.clipboard.writeText(code).then(()=>toast(`Code ${code} copied!`,'s'));
}

// ── CLASSROOMS LIST ──
async function loadClassrooms() {
  $('page-classrooms').innerHTML = '<div class="loading"><span class="spin spin-d"></span></div>';
  try {
    const r = await api('/classrooms');
    const cls = r.classrooms||[];
    $('page-classrooms').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
        <div><div style="font-size:17px;font-weight:800;letter-spacing:-.3px;">${CU.role==='admin'?'All Classrooms':'My Classrooms'}</div><div style="font-size:12px;color:var(--text3);margin-top:2px;">${cls.length} classroom${cls.length!==1?'s':''}</div></div>
        <div style="display:flex;gap:8px;">
          ${CU.role==='professor'?`<button class="btn btn-p" data-action="openCreateCls">+ New Classroom</button>`:''}
          ${CU.role==='student'?`<button class="btn btn-s" data-action="openJoinCls">+ Join Classroom</button>`:''}
        </div>
      </div>
      ${cls.length===0?`<div class="empty"><div class="ei">🏫</div><h3>No classrooms</h3><p>${CU.role==='professor'?'Create your first classroom.':'Join via class code.'}</p></div>`:
        `<div class="cg">${cls.map(clsCard).join('')}</div>`}`;
  } catch(e) { $('page-classrooms').innerHTML=`<div class="alert ae">${e.message}</div>`; }
}

function openCls(id) { curClass=id; navTo('classroom-detail',id); }

// ── CLASSROOM DETAIL ──
async function loadClassDetail(id) {
  const cid = id||curClass;
  curClass = cid;
  $('page-classroom-detail').innerHTML = '<div class="loading"><span class="spin spin-d"></span></div>';
  try {
    const [cr, ar] = await Promise.all([api(`/classrooms/${cid}`), api(`/assignments/classroom/${cid}`)]);
    if (!cr.success) throw new Error(cr.message);
    const c = cr.classroom, asgns = ar.assignments||[];
    const isProf = CU.role==='professor' && c.professor._id===CU._id;
    const isAdmin = CU.role==='admin';
    $('tbtitle').textContent = c.name;

    $('page-classroom-detail').innerHTML = `
      <button class="back" data-action="navTo" data-page="classrooms">← Back to Classrooms</button>
      <div class="cdh" style="background:linear-gradient(135deg,${c.coverColor||'#1971C2'} 0%,${c.coverColor||'#1971C2'}BB 100%);">
        <div class="cdi">
          <div class="cdn">${c.name}</div>
          <div class="cdsu">${c.subject}${c.semester?' · '+c.semester:''}${c.academicYear?' · '+c.academicYear:''}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
        <span class="badge bb">👤 ${c.professor.name}</span>
        <span class="badge bgr" style="cursor:pointer;font-family:var(--m);" data-action="cpyCode" data-code="${c.classCode}" title="Click to copy">🔑 ${c.classCode}</span>
        <span class="badge bgr">👥 ${c.students?.length||0} students</span>
        ${c.description?`<span style="font-size:12px;color:var(--text3);">${c.description}</span>`:''}
      </div>
      <div class="ctabs" id="ctabs">
        <button class="ctab active" data-action="swTab" data-tab="assignments">📋 Assignments (${asgns.length})</button>
        <button class="ctab" data-action="swTab" data-tab="students">👥 Students (${c.students?.length||0})</button>
        ${isProf||isAdmin?`<button class="ctab" data-action="swTab" data-tab="settings">⚙️ Settings</button>`:''}
        ${isProf||isAdmin?`<button class="ctab" data-action="swTab" data-tab="export">📥 Export Grades</button>`:''}
      </div>

      <div class="tp active" id="tp-assignments">
        ${isProf||isAdmin?`<div style="margin-bottom:12px;"><button class="btn btn-p" data-action="openCreateAsgn" data-cid="${c._id}">+ New Assignment</button></div>`:''}
        ${asgns.length===0?`<div class="empty"><div class="ei">📋</div><h3>No assignments yet</h3><p>${isProf?'Create the first assignment.':'No assignments posted yet.'}</p></div>`:
          `<div class="al">${asgns.map(a=>asgnRow(a,isProf||isAdmin)).join('')}</div>`}
      </div>

      <div class="tp" id="tp-students">
        ${c.students?.length===0?`<div class="empty"><div class="ei">👥</div><h3>No students enrolled</h3><p>Share code <strong>${c.classCode}</strong> with students.</p></div>`:
          `<div class="card"><div class="tw"><table><thead><tr><th>#</th><th>Name</th><th>Email</th><th>Student ID</th><th>Department</th>${isProf||isAdmin?'<th></th>':''}</tr></thead><tbody>
            ${c.students.map((s,i)=>`<tr>
              <td style="color:var(--text3);">${i+1}</td>
              <td><div style="display:flex;align-items:center;gap:8px;"><div class="uav" style="width:28px;height:28px;background:${avColor(s.name)};">${initials(s.name)}</div>${s.name}</div></td>
              <td style="color:var(--text3);">${s.email}</td>
              <td style="font-family:var(--m);font-size:12px;">${s.studentId||'—'}</td>
              <td style="color:var(--text3);">${s.department||'—'}</td>
              ${isProf||isAdmin?`<td><button class="btn btn-d btn-sm" data-action="remStud" data-cid="${c._id}" data-sid="${s._id}" data-name="${esc(s.name)}">Remove</button></td>`:''}
            </tr>`).join('')}
          </tbody></table></div></div>`}
      </div>

      ${isProf||isAdmin?`
      <div class="tp" id="tp-settings">
        <div class="card" style="max-width:480px;"><div class="cb">
          <div style="font-size:14px;font-weight:700;margin-bottom:14px;">Classroom Settings</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button class="btn btn-s" data-action="openEditCls" data-id="${c._id}" data-name="${esc(c.name)}" data-subject="${esc(c.subject)}" data-desc="${esc(c.description||'')}" data-sem="${esc(c.semester||'')}" data-ay="${esc(c.academicYear||'')}">✏️ Edit Details</button>
            <button class="btn btn-d" data-action="delCls" data-id="${c._id}" data-name="${esc(c.name)}">🗑️ Delete Classroom</button>
          </div>
        </div></div>
      </div>
      <div class="tp" id="tp-export">
        <div class="card" style="max-width:580px;"><div class="cb">
          <div style="font-size:14px;font-weight:700;margin-bottom:6px;">Export Grade Report</div>
          <p style="font-size:13px;color:var(--text3);margin-bottom:16px;">Download a detailed Excel spreadsheet with student details, individual assignment scores, and overall averages.</p>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn btn-ok btn-lg" id="export-btn" data-action="exportGrades" data-cid="${c._id}" data-name="${esc(c.name)}">📥 Download Excel Report</button>
            <span id="export-status" style="font-size:12px;color:var(--text3);"></span>
          </div>
          <p style="font-size:11.5px;color:var(--text3);margin-top:12px;">Columns: Name · Email · Dept · Registration No · one column per assignment · Overall %</p>
        </div></div>
      </div>`:''}
    `;

    // Store classroom data for export
    window._curClsData = { classroom: c, assignments: asgns };
  } catch(e) { $('page-classroom-detail').innerHTML=`<div class="alert ae">${e.message}</div>`; }
}

function swTab(id, btn) {
  document.querySelectorAll('.ctab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tp').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  $(`tp-${id}`).classList.add('active');
}

function asgnRow(a, canGrade) {
  const past = isPast(a.deadline);
  const dl = past ? `<span class="badge br">⏰ Closed ${fmtD(a.deadline)}</span>` : `<span class="badge bg">⏳ Due ${fmtDT(a.deadline)}</span>`;
  let st = '';
  if (a.submission) {
    st = a.submission.marksObtained!=null ? `<span class="badge bb">📊 ${a.submission.marksObtained}/${a.totalMarks||'?'}</span>` : `<span class="badge ba">✅ Submitted</span>`;
  } else if (CU.role==='student') {
    st = past ? `<span class="badge br">❌ Missed</span>` : `<span class="badge ba">⚡ Pending</span>`;
  }
  return `<div class="ar" data-action="openAsgn" data-id="${a._id}">
    <div class="ai2">📝</div>
    <div class="ainf">
      <div class="atit">${a.title}</div>
      <div class="amet">${a.totalMarks} marks · ${dl}</div>
    </div>
    <div class="argt">${st}</div>
  </div>`;
}

// ── CLASSROOM MODALS ──
function openCreateCls() {
  openMod('Create New Classroom', `
    <div class="fg"><label>Classroom Name *</label><input class="fc" id="cn" placeholder="e.g. Data Structures & Algorithms"></div>
    <div class="fg"><label>Subject *</label><input class="fc" id="cs" placeholder="e.g. Computer Science"></div>
    <div class="g2">
      <div class="fg"><label>Semester</label><input class="fc" id="csem" placeholder="e.g. Fall 2024"></div>
      <div class="fg"><label>Academic Year</label><input class="fc" id="cyr" placeholder="e.g. 2024-25"></div>
    </div>
    <div class="fg"><label>Description</label><textarea class="fc" id="cd" placeholder="Brief description..."></textarea></div>
    <button class="btn btn-p btn-full" data-action="createCls">Create Classroom</button>`);
}

async function createCls() {
  const name=$('cn').value.trim(), subj=$('cs').value.trim();
  if (!name||!subj) { toast('Name and subject are required.','e'); return; }
  try {
    const r = await api('/classrooms',{method:'POST',body:JSON.stringify({name,subject:subj,description:$('cd').value.trim(),semester:$('csem').value.trim(),academicYear:$('cyr').value.trim()})});
    if (!r.success) throw new Error(r.message);
    toast(`Classroom created! Code: ${r.classroom.classCode}`,'s');
    closeMod(); loadClassrooms();
  } catch(e) { toast(e.message,'e'); }
}

function openEditCls(id,name,subj,desc,sem,yr) {
  openMod('Edit Classroom',`
    <div class="fg"><label>Name</label><input class="fc" id="ecn" value="${name}"></div>
    <div class="fg"><label>Subject</label><input class="fc" id="ecs" value="${subj}"></div>
    <div class="g2">
      <div class="fg"><label>Semester</label><input class="fc" id="ecsem" value="${sem}"></div>
      <div class="fg"><label>Academic Year</label><input class="fc" id="ecyr" value="${yr}"></div>
    </div>
    <div class="fg"><label>Description</label><textarea class="fc" id="ecd">${desc}</textarea></div>
    <button class="btn btn-p btn-full" data-action="updCls" data-id="${id}">Save Changes</button>`);
}

async function updCls(id) {
  try {
    const r = await api(`/classrooms/${id}`,{method:'PATCH',body:JSON.stringify({name:$('ecn').value.trim(),subject:$('ecs').value.trim(),description:$('ecd').value.trim(),semester:$('ecsem').value.trim(),academicYear:$('ecyr').value.trim()})});
    if (!r.success) throw new Error(r.message);
    toast('Classroom updated!','s'); closeMod(); loadClassDetail(id);
  } catch(e) { toast(e.message,'e'); }
}

async function delCls(id, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  try {
    const r = await api(`/classrooms/${id}`,{method:'DELETE'});
    if (!r.success) throw new Error(r.message);
    toast('Classroom deleted.','s'); navTo('classrooms');
  } catch(e) { toast(e.message,'e'); }
}

function openJoinCls() {
  openMod('Join a Classroom',`
    <p style="font-size:13px;color:var(--text3);margin-bottom:14px;">Enter the 6-character class code from your professor.</p>
    <div class="fg"><label>Class Code</label><input class="fc" id="jcode" placeholder="e.g. ABC123" style="font-size:20px;text-align:center;letter-spacing:2px;text-transform:uppercase;font-family:var(--m)" maxlength="6"></div>
    <button class="btn btn-p btn-full" data-action="joinCls">Join Classroom</button>`);
  setTimeout(()=>$('jcode')?.focus(),100);
}

async function joinCls() {
  const code = $('jcode').value.trim().toUpperCase();
  if (!code||code.length!==6) { toast('Enter a valid 6-character code.','e'); return; }
  try {
    const r = await api('/classrooms/join/with-code',{method:'POST',body:JSON.stringify({classCode:code})});
    if (!r.success) throw new Error(r.message);
    toast(r.message,'s'); closeMod(); loadClassrooms();
  } catch(e) { toast(e.message,'e'); }
}

async function remStud(cid, sid, name) {
  if (!confirm(`Remove ${name}?`)) return;
  try {
    const r = await api(`/classrooms/${cid}/remove-student/${sid}`,{method:'DELETE'});
    if (!r.success) throw new Error(r.message);
    toast(`${name} removed.`,'s'); loadClassDetail(cid);
  } catch(e) { toast(e.message,'e'); }
}

// ── ASSIGNMENTS ──
function openAsgn(id) { curAssign=id; navTo('assignment-detail',id); }

async function loadAssignDetail(id) {
  const aid = id||curAssign; curAssign=aid;
  $('page-assignment-detail').innerHTML='<div class="loading"><span class="spin spin-d"></span></div>';
  try {
    const r = await api(`/assignments/${aid}`);
    if (!r.success) throw new Error(r.message);
    const a=r.assignment, sub=r.submission;
    const past = isPast(a.deadline);
    const isProfOrAdmin = CU.role==='professor'||CU.role==='admin';
    $('tbtitle').textContent = a.title;

    let html = `<button class="back" data-action="navTo" data-page="classroom-detail" data-param="${a.classroom}">← Back to Classroom</button>
    <div class="card" style="margin-bottom:14px;"><div class="cb">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
        <div>
          <div style="font-size:20px;font-weight:800;letter-spacing:-.3px;margin-bottom:8px;">${a.title}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${past?`<span class="badge br">🔒 Deadline passed ${fmtDT(a.deadline)}</span>`:`<span class="badge bg">⏰ Due ${fmtDT(a.deadline)}</span>`}
            <span class="badge bb">🏆 ${a.totalMarks} marks</span>
            ${sub?(sub.status==='graded'?`<span class="badge bb">📊 ${sub.marksObtained}/${a.totalMarks}</span>`:`<span class="badge ba">✅ Submitted</span>`):''}
          </div>
        </div>
        ${isProfOrAdmin?`<div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="btn btn-s btn-sm" data-action="openEditAsgn" data-id="${a._id}" data-title="${esc(a.title)}" data-marks="${a.totalMarks}" data-deadline="${new Date(a.deadline).toISOString().slice(0,16)}">Edit</button>
          <button class="btn btn-d btn-sm" data-action="delAsgn" data-id="${a._id}" data-title="${esc(a.title)}">Delete</button>
        </div>`:''}
      </div>
      <div class="divider"></div>
      <div style="font-size:13.5px;line-height:1.7;color:var(--text2);">${a.description}</div>
      <div class="divider"></div>
      <div style="font-size:12px;color:var(--text3);">Allowed: ${a.allowedExtensions.map(e=>`<span class="badge bgr" style="font-family:var(--m);font-size:10px;">.${e}</span>`).join(' ')}</div>
    </div></div>`;

    if (CU.role==='student') {
      if (sub) {
        html += `<div class="card"><div class="cb">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <div style="font-size:14px;font-weight:700;">Your Submission</div>
            <span class="badge ${sub.status==='graded'?'bb':'ba'}">${sub.status==='graded'?'📊 Graded':'✅ Submitted'}</span>
          </div>
          <p style="font-size:12.5px;color:var(--text3);margin-bottom:10px;">Submitted ${fmtDT(sub.submittedAt)} ${sub.isLate?'<span class="badge br">LATE</span>':''}</p>
          ${sub.notes?`<p style="font-size:13px;margin-bottom:10px;"><strong>Notes:</strong> ${sub.notes}</p>`:''}
          ${sub.files?.length>0?`<div style="font-size:12px;color:var(--text3);margin-bottom:10px;"><strong>Files submitted:</strong> ${sub.files.map(f=>`<span class="badge bgr">${f.originalName||f.filename}</span>`).join(' ')}</div>`:''}
          ${sub.status==='graded'?`
            <div style="padding:14px;background:var(--accent-bg);border:1px solid var(--accent-b);border-radius:var(--r);margin-top:10px;">
              <div style="font-size:24px;font-weight:800;color:var(--accent);">${sub.marksObtained} / ${a.totalMarks}</div>
              <div style="font-size:12px;color:var(--text3);margin-bottom:6px;">${((sub.marksObtained/a.totalMarks)*100).toFixed(1)}% score</div>
              ${sub.feedback?`<div style="font-size:13px;color:var(--text2);padding-top:8px;border-top:1px solid var(--accent-b);"><strong>Feedback:</strong> ${sub.feedback}</div>`:''}
            </div>
          `:'<p style="font-size:12.5px;color:var(--text3);margin-top:10px;">Awaiting grading by your professor.</p>'}
        </div></div>`;
      } else if (!past) {
        html += `<div class="card"><div class="cb">
          <div style="font-size:14px;font-weight:700;margin-bottom:12px;">Submit Your Work</div>
          <div id="sf-list" class="fcs"></div>
          <div class="dz" id="sdz" data-action="triggerUpload">
            <div class="di">📂</div>
            <div class="dt">Click to browse or drag and drop files</div>
            <div class="dh">Accepted: ${a.allowedExtensions.join(', ')} · Max 10MB · Up to 5 files</div>
          </div>
          <input type="file" id="sfi" multiple style="display:none" accept="${a.allowedExtensions.map(e=>'.'+e).join(',')}">
          <div class="fg" style="margin-top:14px;"><label>Additional Notes <span style="font-weight:400;color:var(--text3)">(optional)</span></label><textarea class="fc" id="snotes" placeholder="Any notes for your professor..."></textarea></div>
          <button class="btn btn-p btn-full btn-lg" data-action="submitAsgn" data-id="${a._id}" id="subBtn" style="margin-top:4px;">📤 Submit Assignment</button>
        </div></div>`;
        selFiles = [];
      } else {
        html += `<div class="alert ae">⏰ The submission deadline has passed. No further submissions are accepted.</div>`;
      }
    }

    if (isProfOrAdmin) {
      const sr = await api(`/assignments/${aid}/submissions`);
      const subs = sr.submissions||[], noSub = sr.notSubmitted||[];
      const pct = sr.totalStudents>0?((subs.length/sr.totalStudents)*100).toFixed(0):0;
      html += `<div class="card" style="margin-top:14px;"><div class="ch">
        <span class="ct">Submissions (${subs.length}/${sr.totalStudents})</span>
        <span class="badge bb">${pct}% rate</span>
      </div><div class="cb">
        <div style="margin-bottom:12px;"><div class="prog"><div class="pb ${pct>=70?'pb-g':pct>=40?'pb-a':'pb-r'}" style="width:${pct}%;"></div></div></div>
        <div class="tw"><table><thead><tr><th>Student</th><th>Submitted</th><th>Files</th><th>Status</th><th>Marks/${a.totalMarks}</th><th>Actions</th></tr></thead><tbody>
          ${subs.map(s=>`<tr>
            <td><div style="display:flex;align-items:center;gap:8px;"><div class="uav" style="width:28px;height:28px;background:${avColor(s.student?.name)};">${initials(s.student?.name)}</div><div><div style="font-size:12.5px;font-weight:600;">${s.student?.name}</div><div style="font-size:11px;color:var(--text3);">${s.student?.studentId||''}</div></div></div></td>
            <td style="font-size:12px;color:var(--text3);">${fmtDT(s.submittedAt)} ${s.isLate?'<span class="badge br" style="font-size:10px;">LATE</span>':''}</td>
            <td><button class="btn btn-s btn-sm" data-action="viewFiles" data-subid="${s._id}" data-sname="${esc(s.student?.name)}" style="font-size:11px;">📎 View (${s.files?.length||0})</button></td>
            <td><span class="badge ${s.status==='graded'?'bb':'ba'}">${s.status==='graded'?'Graded':'Pending'}</span></td>
            <td>${s.status==='graded'?`<strong>${s.marksObtained}</strong>`:'—'}</td>
            <td><button class="btn btn-p btn-sm" data-action="openGrade" data-subid="${s._id}" data-asgnid="${aid}" data-sname="${esc(s.student?.name)}" data-totalmarks="${a.totalMarks}" data-marks="${s.marksObtained??'null'}" data-feedback="${esc(s.feedback||'')}">Grade</button></td>
          </tr>`).join('')}
          ${noSub.map(s=>`<tr style="opacity:.55;">
            <td><div style="display:flex;align-items:center;gap:8px;"><div class="uav" style="width:28px;height:28px;background:${avColor(s.name)};">${initials(s.name)}</div>${s.name}</div></td>
            <td style="font-size:12px;color:var(--text3);">Not submitted</td>
            <td>—</td><td><span class="badge br">Missing</span></td><td>—</td><td>—</td>
          </tr>`).join('')}
        </tbody></table></div>
      </div></div>`;
    }

    $('page-assignment-detail').innerHTML = html;
  } catch(e) { $('page-assignment-detail').innerHTML=`<div class="alert ae">${e.message}</div>`; }
}

// ── VIEW SUBMITTED FILES ──
async function viewFiles(subId, studentName) {
  openMod(`📎 Files by ${studentName}`, `<div class="loading"><span class="spin spin-d"></span> Loading files...</div>`);
  try {
    const r = await api(`/assignments/submission/${subId}/files-list`);
    if (!r.success) throw new Error(r.message);
    const files = r.files||[];
    if (files.length===0) { $('mbody').innerHTML='<p style="color:var(--text3);font-size:13px;">No files attached to this submission.</p>'; return; }
    $('mbody').innerHTML = `
      <p style="font-size:13px;color:var(--text3);margin-bottom:12px;">${files.length} file${files.length!==1?'s':''} submitted</p>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${files.map((f,i)=>`
          <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);">
            <span style="padding:3px 8px;border-radius:4px;background:var(--accent-bg);color:var(--accent);font-family:var(--m);font-size:11px;font-weight:700;text-transform:uppercase;border:1px solid var(--accent-b);flex-shrink:0;">${(f.originalName||'file').split('.').pop()}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.originalName||f.filename}</div>
              <div style="font-size:11px;color:var(--text3);">${fSize(f.size||0)}</div>
            </div>
            <button class="btn btn-s btn-sm" data-action="downloadFile" data-subid="${subId}" data-idx="${i}" data-name="${esc(f.originalName||f.filename)}">⬇ Download</button>
          </div>`).join('')}
      </div>`;
  } catch(e) { $('mbody').innerHTML=`<div class="alert ae">${e.message}</div>`; }
}

async function downloadFile(subId, fileIdx, filename) {
  toast('Downloading...','i');
  try {
    const r = await api(`/assignments/submission/${subId}/file/${fileIdx}`);
    if (!r.success) throw new Error(r.message);
    const f = r.file;
    const byteStr = atob(f.data);
    const bytes = new Uint8Array(byteStr.length);
    for (let i=0; i<byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
    const blob = new Blob([bytes], {type: f.mimetype||'application/octet-stream'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=filename||'file'; a.click();
    URL.revokeObjectURL(url);
    toast(`Downloaded: ${filename}`,'s');
  } catch(e) { toast(e.message,'e'); }
}

// ── FILE SELECTION ──
let selFiles = [];

function dropFiles(e) {
  e.preventDefault(); $('sdz')?.classList.remove('over');
  addFiles({target:{files:e.dataTransfer.files}});
}

function addFiles(e) {
  Array.from(e.target.files).forEach(f=>{
    if (selFiles.length>=5) { toast('Max 5 files.','w'); return; }
    if (f.size>10*1024*1024) { toast(`${f.name} too large (max 10MB).`,'e'); return; }
    selFiles.push(f);
  });
  renderSelFiles();
}

function remFile(i) { selFiles.splice(i,1); renderSelFiles(); }

function renderSelFiles() {
  const el = $('sf-list'); if(!el) return;
  el.innerHTML = selFiles.map((f,i)=>{
    const ext = f.name.split('.').pop().toLowerCase();
    return `<div class="fc2"><span class="fext">${ext}</span><span class="fn">${f.name}</span><span class="fs">${fSize(f.size)}</span><span class="frm" data-action="remFile" data-idx="${i}">✕</span></div>`;
  }).join('');
}

async function submitAsgn(aid) {
  if (selFiles.length===0) { toast('Please attach at least one file.','e'); return; }
  const btn = $('subBtn'); btn.innerHTML='<span class="spin"></span> Uploading...'; btn.disabled=true;
  try {
    const fd = new FormData();
    selFiles.forEach(f=>fd.append('files',f));
    fd.append('notes', $('snotes')?.value||'');
    const r = await apiForm(`/assignments/${aid}/submit`, fd);
    if (!r.success) throw new Error(r.message);
    toast(r.message,'s'); selFiles=[];
    loadAssignDetail(aid);
  } catch(e) {
    toast(e.message,'e');
    btn.innerHTML='📤 Submit Assignment'; btn.disabled=false;
  }
}

// ── ASSIGNMENT MODALS ──
function openCreateAsgn(cid) {
  const now = new Date(); now.setHours(now.getHours()+1);
  const min = now.toISOString().slice(0,16);
  const exts=['pdf','doc','docx','txt','jpg','jpeg','png','zip','ppt','pptx','xls','xlsx','mp4','py','java','cpp','c'];
  const def=['pdf','doc','docx','jpg','png','zip','txt','ppt','pptx'];
  openMod('Create Assignment',`
    <div class="fg"><label>Title *</label><input class="fc" id="nat" placeholder="e.g. Lab Report 3 — Binary Trees"></div>
    <div class="fg"><label>Description / Instructions *</label><textarea class="fc" id="nad" style="min-height:110px;" placeholder="Detailed instructions, rubric, requirements..."></textarea></div>
    <div class="g2">
      <div class="fg"><label>Deadline *</label><input type="datetime-local" class="fc" id="nadl" min="${min}" value="${min}"></div>
      <div class="fg"><label>Total Marks *</label><input type="number" class="fc" id="nam" value="100" min="1" max="1000"></div>
    </div>
    <div class="fg"><label>Allowed File Types</label>
      <div class="cxg" id="extcx">${exts.map(e=>`<label class="cx ${def.includes(e)?'chk':''}" data-action="togExt"><input type="checkbox" ${def.includes(e)?'checked':''} style="display:none">.${e}</label>`).join('')}</div>
    </div>
    <button class="btn btn-p btn-full" data-action="createAsgn" data-cid="${cid}">Create Assignment</button>`);
}

function togExt(el) { el.classList.toggle('chk'); el.querySelector('input').checked=el.classList.contains('chk'); }

async function createAsgn(cid) {
  const title=$('nat').value.trim(), desc=$('nad').value.trim(), dl=$('nadl').value, marks=$('nam').value;
  if (!title||!desc||!dl||!marks) { toast('All fields required.','e'); return; }
  if (new Date(dl)<=new Date()) { toast('Deadline must be a future date.','e'); return; }
  const exts = Array.from(document.querySelectorAll('#extcx .cx.chk')).map(e=>e.textContent.trim().replace('.',''));
  try {
    const r = await api('/assignments',{method:'POST',body:JSON.stringify({title,description:desc,classroomId:cid,deadline:dl,totalMarks:Number(marks),allowedExtensions:exts})});
    if (!r.success) throw new Error(r.message);
    toast('Assignment created! Students notified.','s'); closeMod(); loadClassDetail(cid);
  } catch(e) { toast(e.message,'e'); }
}

function openEditAsgn(id, title, marks, dl) {
  openMod('Edit Assignment',`
    <div class="fg"><label>Title</label><input class="fc" id="eat" value="${title}"></div>
    <div class="g2">
      <div class="fg"><label>Deadline</label><input type="datetime-local" class="fc" id="eadl" value="${dl}"></div>
      <div class="fg"><label>Total Marks</label><input type="number" class="fc" id="eam" value="${marks}"></div>
    </div>
    <button class="btn btn-p btn-full" data-action="updAsgn" data-id="${id}">Save Changes</button>`);
}

async function updAsgn(id) {
  const dl = $('eadl').value;
  if (new Date(dl)<=new Date()) { toast('Deadline must be in the future.','e'); return; }
  try {
    const r = await api(`/assignments/${id}`,{method:'PATCH',body:JSON.stringify({title:$('eat').value.trim(),deadline:dl,totalMarks:Number($('eam').value)})});
    if (!r.success) throw new Error(r.message);
    toast('Assignment updated!','s'); closeMod(); loadAssignDetail(id);
  } catch(e) { toast(e.message,'e'); }
}

async function delAsgn(id, title) {
  if (!confirm(`Delete "${title}"? All submissions lost.`)) return;
  try {
    const r = await api(`/assignments/${id}`,{method:'DELETE'});
    if (!r.success) throw new Error(r.message);
    toast('Assignment deleted.','s'); navTo('classroom-detail',curClass);
  } catch(e) { toast(e.message,'e'); }
}

// ── GRADING ──
function openGrade(subId, asgnId, studentName, totalMarks, curMarks, curFeedback) {
  openMod(`Grade: ${studentName}`,`
    <p style="font-size:13px;color:var(--text3);margin-bottom:14px;">Marks out of <strong>${totalMarks}</strong></p>
    <div class="fg"><label>Marks Obtained (0–${totalMarks})</label>
      <input type="number" class="fc" id="gm" value="${curMarks!==null&&curMarks!==undefined?curMarks:''}" min="0" max="${totalMarks}" placeholder="Enter marks" style="font-size:22px;font-weight:700;text-align:center;"></div>
    <div class="fg"><label>Feedback <span style="font-weight:400;color:var(--text3)">(optional)</span></label>
      <textarea class="fc" id="gf" placeholder="Write feedback...">${curFeedback||''}</textarea></div>
    <button class="btn btn-p btn-full" data-action="saveGrade" data-asgnid="${asgnId}" data-subid="${subId}" data-totalmarks="${totalMarks}">Save Grade &amp; Notify Student</button>`);
}

async function saveGrade(asgnId, subId, total) {
  const m = $('gm').value, f = $('gf').value.trim();
  if (m===''||m===null) { toast('Enter marks.','e'); return; }
  if (Number(m)<0||Number(m)>total) { toast(`Marks must be 0–${total}.`,'e'); return; }
  try {
    const r = await api(`/assignments/${asgnId}/grade/${subId}`,{method:'PATCH',body:JSON.stringify({marksObtained:Number(m),feedback:f})});
    if (!r.success) throw new Error(r.message);
    toast('Grade saved! Student notified.','s'); closeMod(); loadAssignDetail(asgnId);
  } catch(e) { toast(e.message,'e'); }
}

// ── MY MARKS (STUDENT) ──
async function loadMyMarks() {
  $('page-my-marks').innerHTML='<div class="loading"><span class="spin spin-d"></span></div>';
  try {
    const r = await api('/assignments/me/marks');
    if (!r.success) throw new Error(r.message||'Failed to load grades.');
    const grouped = r.grouped||[], allSubs = r.submissions||[];
    const totPoss = allSubs.reduce((a,s)=>a+(s.assignment?.totalMarks||0),0);
    const totObt = allSubs.reduce((a,s)=>a+(s.marksObtained||0),0);
    const ov = totPoss>0?(totObt/totPoss*100):null;

    let html = `<div style="font-size:17px;font-weight:800;letter-spacing:-.3px;margin-bottom:4px;">My Academic Grades</div>
    <div style="font-size:12.5px;color:var(--text3);margin-bottom:16px;">Performance across all graded assignments</div>`;

    if (allSubs.length>0) {
      const pc = ov>=70?'var(--green)':ov>=50?'var(--accent)':'var(--red)';
      html += `<div class="card" style="margin-bottom:14px;"><div class="cb">
        <div style="display:grid;grid-template-columns:auto 1fr;align-items:center;gap:20px;">
          <div style="text-align:center;min-width:80px;">
            <div style="font-size:42px;font-weight:800;color:${pc};letter-spacing:-1px;line-height:1;">${ov.toFixed(1)}%</div>
            <div style="font-size:11px;color:var(--text3);">Overall Average</div>
          </div>
          <div>
            <div style="font-size:13.5px;font-weight:600;margin-bottom:8px;">${totObt} / ${totPoss} marks obtained across ${allSubs.length} assignment${allSubs.length!==1?'s':''}</div>
            <div class="prog" style="height:8px;"><div class="pb ${ov>=70?'pb-g':ov>=50?'pb-b':'pb-r'}" style="width:${Math.min(ov,100)}%;"></div></div>
            <div style="font-size:11.5px;color:var(--text3);margin-top:6px;">${grouped.length} classroom${grouped.length!==1?'s':''} · ${allSubs.length} graded</div>
          </div>
        </div>
      </div></div>`;
    }

    if (grouped.length===0) {
      html += `<div class="empty"><div class="ei">🎯</div><h3>No grades yet</h3><p>Once your professor grades your work, scores will appear here.</p></div>`;
    } else {
      grouped.forEach(g => {
        const pct = parseFloat(g.percentage||0);
        const pCol = pct>=70?'var(--green)':pct>=50?'var(--accent)':'var(--red)';
        const pbCls = pct>=70?'pb-g':pct>=50?'pb-b':'pb-r';
        html += `<div class="card" style="margin-bottom:12px;">
          <div class="ch">
            <div><div class="ct">${g.classroom?.name||'Unknown Classroom'}</div><div style="font-size:11.5px;color:var(--text3);">${g.classroom?.subject||''}</div></div>
            <div style="text-align:right;">
              <div style="font-size:24px;font-weight:800;color:${pCol};letter-spacing:-.5px;">${g.percentage}%</div>
              <div style="font-size:11px;color:var(--text3);">${g.obtainedMarks} / ${g.totalMarks}</div>
            </div>
          </div>
          <div class="cb" style="padding-top:0;">
            <div class="prog" style="margin-bottom:14px;"><div class="pb ${pbCls}" style="width:${Math.min(pct,100)}%;"></div></div>
            <div class="tw"><table>
              <thead><tr><th>Assignment</th><th>Marks</th><th>Score</th><th>Feedback</th><th>Graded On</th></tr></thead>
              <tbody>${g.submissions.map(s=>{
                const ap=(s.marksObtained/s.assignment.totalMarks*100);
                return `<tr>
                  <td style="font-weight:500;">${s.assignment.title}</td>
                  <td><strong>${s.marksObtained}</strong> / ${s.assignment.totalMarks}</td>
                  <td><span class="badge ${ap>=70?'bg':ap>=50?'bb':'br'}">${ap.toFixed(1)}%</span></td>
                  <td style="font-size:12px;color:var(--text3);max-width:200px;">${s.feedback||'—'}</td>
                  <td style="font-size:11.5px;color:var(--text3);">${fmtD(s.gradedAt)}</td>
                </tr>`;
              }).join('')}</tbody>
            </table></div>
          </div>
        </div>`;
      });
    }

    $('page-my-marks').innerHTML = html;
  } catch(e) { $('page-my-marks').innerHTML=`<div class="alert ae">❌ ${e.message}</div>`; }
}

// ── ACTIVITY FEED (PROFESSOR) ──
async function loadActivity() {
  $('page-activity').innerHTML='<div class="loading"><span class="spin spin-d"></span></div>';
  try {
    const clsRes = await api('/classrooms');
    const cls = clsRes.classrooms||[];
    if (cls.length===0) { $('page-activity').innerHTML='<div class="empty"><div class="ei">📡</div><h3>No classrooms</h3><p>Create a classroom first.</p></div>'; return; }

    // Fetch all submissions across all professor's classrooms
    const allSubsPromises = cls.map(c=>api(`/assignments/classroom/${c._id}`).then(r=>(r.assignments||[]).map(a=>({...a,clsName:c.name}))));
    const allAsgnsByCls = await Promise.all(allSubsPromises);
    const allAsgns = allAsgnsByCls.flat();

    // Fetch submissions for each assignment
    const subPromises = allAsgns.map(a=>api(`/assignments/${a._id}/submissions`).then(r=>({asgn:a, subs:r.submissions||[], noSub:r.notSubmitted||[], total:r.totalStudents||0})));
    const asgnData = await Promise.all(subPromises);

    // Build activity: sort by most recently submitted
    const allSubs = [];
    asgnData.forEach(({asgn, subs})=>{
      subs.forEach(s=>allSubs.push({...s, asgnTitle:asgn.title, clsName:asgn.clsName, totalMarks:asgn.totalMarks}));
    });
    allSubs.sort((a,b)=>new Date(b.submittedAt)-new Date(a.submittedAt));

    // Pending grading
    const pending = asgnData.flatMap(({asgn,subs})=>subs.filter(s=>s.status!=='graded').map(s=>({...s,asgn})));
    const deadline_upcoming = allAsgns.filter(a=>!isPast(a.deadline)).sort((a,b)=>new Date(a.deadline)-new Date(b.deadline));

    $('page-activity').innerHTML = `
      <div style="font-size:17px;font-weight:800;letter-spacing:-.3px;margin-bottom:16px;">Activity Feed</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
        <div class="card"><div class="ch"><span class="ct">⏳ Pending Grading (${pending.length})</span></div><div class="cb">
          ${pending.length===0?'<p style="font-size:13px;color:var(--text3);">All submissions graded! 🎉</p>':
            pending.slice(0,10).map(s=>`<div class="act-item">
              <div class="act-dot" style="background:var(--amber-bg);color:var(--amber);">📝</div>
              <div class="act-body">
                <div class="act-t">${s.student?.name||'—'}</div>
                <div class="act-m">${s.asgn?.title||'—'} · ${s.asgn?.clsName||''} · <button class="btn btn-s btn-sm" style="padding:2px 8px;" data-action="openGrade" data-subid="${s._id}" data-asgnid="${s.asgn?._id}" data-sname="${esc(s.student?.name||'')}" data-totalmarks="${s.asgn?.totalMarks||100}" data-marks="null" data-feedback="">Grade Now</button></div>
              </div>
            </div>`).join('')}
        </div></div>
        <div class="card"><div class="ch"><span class="ct">📅 Upcoming Deadlines (${deadline_upcoming.length})</span></div><div class="cb">
          ${deadline_upcoming.length===0?'<p style="font-size:13px;color:var(--text3);">No upcoming deadlines.</p>':
            deadline_upcoming.slice(0,8).map(a=>`<div class="act-item">
              <div class="act-dot" style="background:var(--accent-bg);color:var(--accent);">📋</div>
              <div class="act-body">
                <div class="act-t">${a.title}</div>
                <div class="act-m">${a.clsName} · Due ${fmtDT(a.deadline)}</div>
              </div>
            </div>`).join('')}
        </div></div>
      </div>
      <div class="card"><div class="ch"><span class="ct">📥 Latest Submissions</span><span style="font-size:12px;color:var(--text3);">${allSubs.length} total</span></div><div class="cb">
        ${allSubs.length===0?'<p style="font-size:13px;color:var(--text3);">No submissions yet.</p>':
          `<div class="tw"><table><thead><tr><th>Student</th><th>Assignment</th><th>Classroom</th><th>Submitted</th><th>Status</th><th>Action</th></tr></thead><tbody>
            ${allSubs.slice(0,20).map(s=>`<tr>
              <td><div style="display:flex;align-items:center;gap:8px;"><div class="uav" style="width:26px;height:26px;font-size:10px;background:${avColor(s.student?.name)};">${initials(s.student?.name)}</div><div><div style="font-size:12.5px;font-weight:600;">${s.student?.name||'—'}</div><div style="font-size:11px;color:var(--text3);">${s.student?.studentId||''}</div></div></div></td>
              <td style="font-size:12.5px;">${s.asgnTitle}</td>
              <td style="font-size:12px;color:var(--text3);">${s.clsName||'—'}</td>
              <td style="font-size:12px;color:var(--text3);">${fmtDT(s.submittedAt)} ${s.isLate?'<span class="badge br" style="font-size:10px;">LATE</span>':''}</td>
              <td><span class="badge ${s.status==='graded'?'bb':'ba'}">${s.status==='graded'?'Graded':'Pending'}</span></td>
              <td>
                <button class="btn btn-s btn-sm" data-action="viewFiles" data-subid="${s._id}" data-sname="${esc(s.student?.name||'')}" style="font-size:11px;">📎 Files</button>
                <button class="btn btn-p btn-sm" data-action="openGrade" data-subid="${s._id}" data-asgnid="${s.assignment}" data-sname="${esc(s.student?.name||'')}" data-totalmarks="${s.totalMarks||100}" data-marks="${s.marksObtained??'null'}" data-feedback="${esc(s.feedback||'')}">Grade</button>
              </td>
            </tr>`).join('')}
          </tbody></table></div>`}
      </div></div>`;
  } catch(e) { $('page-activity').innerHTML=`<div class="alert ae">${e.message}</div>`; }
}

// ── EXCEL EXPORT ──
async function exportGrades(clsId, clsName) {
  const btn = $('export-btn'), st = $('export-status');
  btn.innerHTML = '<span class="spin"></span> Preparing...'; btn.disabled=true;
  st.textContent = 'Fetching data...';
  try {
    // Fetch classroom data + all assignment submissions
    const clsRes = await api(`/classrooms/${clsId}`);
    const asgnsRes = await api(`/assignments/classroom/${clsId}`);
    const asgns = asgnsRes.assignments||[];
    const students = clsRes.classroom?.students||[];

    // Fetch submissions per assignment
    const subData = await Promise.all(asgns.map(a=>api(`/assignments/${a._id}/submissions`).then(r=>({asgn:a, subs:r.submissions||[]}))));

    st.textContent = 'Building spreadsheet...';

    // Build CSV for SheetJS
    const SheetJS = window.XLSX;
    if (!SheetJS) {
      // Fallback: generate CSV
      exportAsCSV(students, asgns, subData, clsName);
      return;
    }

    buildExcel(students, asgns, subData, clsName);
    btn.innerHTML = '📥 Download Excel Report'; btn.disabled=false;
    st.textContent = 'Downloaded!';
    setTimeout(()=>{ st.textContent=''; },3000);
  } catch(e) {
    toast(e.message,'e');
    btn.innerHTML='📥 Download Excel Report'; btn.disabled=false;
    st.textContent='';
  }
}

function exportAsCSV(students, asgns, subData, clsName) {
  // Build lookup: assignment_id -> studentId -> marks/feedback
  const lookup = {};
  subData.forEach(({asgn, subs})=>{
    lookup[asgn._id] = {};
    subs.forEach(s=>{ if(s.student?._id) lookup[asgn._id][s.student._id] = s; });
  });

  const headers = ['Name','Email','Department','Registration No',...asgns.map(a=>a.title+` (/${a.totalMarks})`),'Total Obtained','Total Possible','Overall %'];
  const rows = [headers];

  students.forEach(s=>{
    const sid = s._id||s;
    let totObt=0, totPoss=0;
    const asgnCols = asgns.map(a=>{
      const sub = lookup[a._id]?.[sid];
      if (sub && sub.status==='graded') { totObt+=sub.marksObtained; totPoss+=a.totalMarks; return sub.marksObtained; }
      totPoss += a.totalMarks;
      return sub?'Submitted':'Not Submitted';
    });
    const pct = totPoss>0?((totObt/totPoss)*100).toFixed(1)+'%':'N/A';
    rows.push([s.name||'',s.email||'',s.department||'',s.studentId||'',...asgnCols,totObt,totPoss,pct]);
  });

  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`${clsName.replace(/[^a-z0-9]/gi,'_')}_grades.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('Grade report downloaded as CSV!','s');
  const btn=$('export-btn'); if(btn){btn.innerHTML='📥 Download Excel Report';btn.disabled=false;}
  const st=$('export-status'); if(st){st.textContent=''; }
}

// Load SheetJS dynamically for XLSX
function loadSheetJS(cb) {
  if (window.XLSX) { cb(); return; }
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  s.onload = cb;
  s.onerror = () => cb(null);
  document.head.appendChild(s);
}

function buildExcel(students, asgns, subData, clsName) {
  const XLSX = window.XLSX;
  const lookup = {};
  subData.forEach(({asgn, subs})=>{
    lookup[asgn._id] = {};
    subs.forEach(s=>{ if(s.student?._id) lookup[asgn._id][s.student._id]=s; });
  });

  const wb = XLSX.utils.book_new();
  const wsData = [];

  // Header row
  const hdr = ['Full Name','Email','Department','Registration No',...asgns.map(a=>`${a.title} (/${a.totalMarks})`),'Total Obtained','Total Possible','Overall %'];
  wsData.push(hdr);

  students.forEach(s=>{
    const sid = s._id||s;
    let totObt=0, totPoss=0;
    const cols = asgns.map(a=>{
      const sub = lookup[a._id]?.[sid];
      if (sub && sub.status==='graded') { totObt+=sub.marksObtained; totPoss+=a.totalMarks; return sub.marksObtained; }
      totPoss+=a.totalMarks;
      return sub?'Submitted':'—';
    });
    const pct = totPoss>0?parseFloat(((totObt/totPoss)*100).toFixed(1)):null;
    wsData.push([s.name||'',s.email||'',s.department||'',s.studentId||'',...cols,totObt,totPoss,pct]);
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths
  const wscols = [{wch:24},{wch:28},{wch:20},{wch:16},...asgns.map(()=>({wch:18})),{wch:14},{wch:14},{wch:12}];
  ws['!cols'] = wscols;

  XLSX.utils.book_append_sheet(wb, ws, 'Grade Report');

  // Summary sheet
  const summaryData = [
    ['Academia ERP — Grade Report'],
    ['Classroom:', clsName],
    ['Generated:', new Date().toLocaleString()],
    ['Total Students:', students.length],
    ['Total Assignments:', asgns.length],
    [],
    ['Assignment','Total Marks','Submissions','Graded','Avg Marks'],
    ...asgns.map(a=>{
      const subs = (subData.find(d=>d.asgn._id===a._id)?.subs)||[];
      const graded = subs.filter(s=>s.status==='graded');
      const avg = graded.length?parseFloat((graded.reduce((acc,s)=>acc+s.marksObtained,0)/graded.length).toFixed(1)):null;
      return [a.title, a.totalMarks, subs.length, graded.length, avg];
    })
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(summaryData);
  ws2['!cols'] = [{wch:28},{wch:12},{wch:12},{wch:10},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

  XLSX.writeFile(wb, `${clsName.replace(/[^a-z0-9]/gi,'_')}_grade_report.xlsx`);
  toast('Excel report downloaded!','s');
  const btn=$('export-btn'); if(btn){btn.innerHTML='📥 Download Excel Report';btn.disabled=false;}
  const st=$('export-status'); if(st){st.textContent='';}
}

// Hook exportGrades to load SheetJS
const _origExport = exportGrades;
window.exportGrades = function(clsId, clsName) {
  const btn=$('export-btn'),st=$('export-status');
  if(btn){btn.innerHTML='<span class="spin"></span> Loading...';btn.disabled=true;}
  if(st){st.textContent='Loading SheetJS...';}
  loadSheetJS(()=>{ _origExport(clsId,clsName); });
};

// ── ADMIN USERS ──
async function loadUsers() {
  $('page-users').innerHTML='<div class="loading"><span class="spin spin-d"></span></div>';
  try {
    const [ar, pr, sr] = await Promise.all([api('/admin/users?limit=100'), api('/admin/users?role=professor&limit=50'), api('/admin/users?role=student&limit=100')]);
    const all = ar.users||[];
    $('page-users').innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
        <div><div style="font-size:17px;font-weight:800;">User Management</div><div style="font-size:12px;color:var(--text3);">${ar.total||all.length} users total</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <span class="badge bb">👨‍🏫 ${pr.users?.length||0} professors</span>
          <span class="badge bg">👨‍🎓 ${sr.users?.length||0} students</span>
        </div>
      </div>
      <div class="card"><div class="tw"><table>
        <thead><tr><th>User</th><th>Role</th><th>Department</th><th>Status</th><th>Last Login</th><th>Actions</th></tr></thead>
        <tbody>${all.map(u=>`<tr>
          <td><div style="display:flex;align-items:center;gap:10px;"><div class="uav" style="width:32px;height:32px;font-size:12px;background:${avColor(u.name)};">${initials(u.name)}</div><div><div style="font-size:13px;font-weight:600;">${u.name}</div><div style="font-size:11px;color:var(--text3);">${u.email}</div></div></div></td>
          <td><span class="badge ${u.role==='admin'?'bp':u.role==='professor'?'bb':'bg'}">${u.role}</span></td>
          <td style="font-size:12.5px;color:var(--text3);">${u.department||'—'}</td>
          <td><span class="badge ${u.isActive?'bg':'br'}">${u.isActive?'Active':'Inactive'}</span></td>
          <td style="font-size:12px;color:var(--text3);">${u.lastLogin?fmtD(u.lastLogin):'Never'}</td>
          <td>${u.role!=='admin'?`<button class="btn btn-s btn-sm" data-action="togUser" data-id="${u._id}" data-name="${esc(u.name)}" data-active="${u.isActive}">${u.isActive?'Deactivate':'Activate'}</button>`:'<span style="color:var(--text3);font-size:12px;">—</span>'}</td>
        </tr>`).join('')}</tbody>
      </table></div></div>`;
  } catch(e) { $('page-users').innerHTML=`<div class="alert ae">${e.message}</div>`; }
}

async function togUser(id, name, isActive) {
  if (!confirm(`${isActive?'Deactivate':'Activate'} ${name}?`)) return;
  try {
    const r = await api(`/admin/users/${id}/toggle`,{method:'PATCH'});
    if (!r.success) throw new Error(r.message);
    toast(r.message,'s'); loadUsers();
  } catch(e) { toast(e.message,'e'); }
}

// ── ADMIN ANALYTICS ──
async function loadAnalytics() {
  $('page-analytics').innerHTML='<div class="loading"><span class="spin spin-d"></span></div>';
  try {
    const r = await api('/admin/classrooms');
    const cls = r.classrooms||[];
    $('page-analytics').innerHTML = `
      <div style="font-size:17px;font-weight:800;margin-bottom:4px;">Academic Analytics</div>
      <div style="font-size:12.5px;color:var(--text3);margin-bottom:16px;">Detailed per-classroom analytics and performance metrics</div>
      ${cls.length===0?'<div class="empty"><p>No classrooms.</p></div>':
        `<div style="display:flex;flex-direction:column;gap:10px;">
          ${cls.map(c=>`<div class="card" style="cursor:pointer;" data-action="loadClsAnalytics" data-id="${c._id}" data-name="${esc(c.name)}">
            <div class="cb" style="display:flex;align-items:center;gap:14px;">
              <div style="width:44px;height:44px;border-radius:var(--r);background:${c.coverColor||'#1971C2'};flex-shrink:0;"></div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:14px;font-weight:700;">${c.name}</div>
                <div style="font-size:12px;color:var(--text3);">${c.subject} · ${c.students?.length||0} students · ${c.professor?.name||''}</div>
              </div>
              <button class="btn btn-s btn-sm">View Analytics →</button>
            </div>
          </div>`).join('')}
        </div>`}`;
  } catch(e) { $('page-analytics').innerHTML=`<div class="alert ae">${e.message}</div>`; }
}

async function loadClsAnalytics(cid, name) {
  $('page-analytics').innerHTML='<div class="loading"><span class="spin spin-d"></span></div>';
  try {
    const r = await api(`/admin/classrooms/${cid}/analytics`);
    if (!r.success) throw new Error(r.message);
    const {classroom:c, assignmentAnalytics:aa, studentAnalytics:sa} = r;
    $('page-analytics').innerHTML = `
      <button class="back" data-action="loadAnalytics">← Back to Analytics</button>
      <div style="font-size:17px;font-weight:800;margin-bottom:4px;">${c.name}</div>
      <div style="font-size:12.5px;color:var(--text3);margin-bottom:16px;">${c.subject} · ${c.professor?.name}</div>
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;">Assignment Analytics</div>
      <div class="card" style="margin-bottom:14px;"><div class="tw"><table>
        <thead><tr><th>Assignment</th><th>Deadline</th><th>Submitted</th><th>Graded</th><th>Late</th><th>Avg Marks</th><th>Rate</th></tr></thead>
        <tbody>${aa.length===0?'<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:24px;">No assignments.</td></tr>':
          aa.map(a=>`<tr>
            <td style="font-weight:500;">${a.assignment.title}</td>
            <td style="font-size:12px;color:var(--text3);">${fmtD(a.assignment.deadline)}</td>
            <td>${a.submitted} / ${a.totalStudents}</td><td>${a.graded}</td><td>${a.lateSubmissions}</td>
            <td>${a.avgMarks!==null?`<strong>${a.avgMarks}</strong>`:'—'}</td>
            <td><div style="display:flex;align-items:center;gap:6px;">
              <div class="prog" style="width:70px;"><div class="pb ${a.submissionRate>=70?'pb-g':a.submissionRate>=40?'pb-a':'pb-r'}" style="width:${a.submissionRate}%;"></div></div>
              <span style="font-size:12px;">${a.submissionRate}%</span>
            </div></td>
          </tr>`).join('')}</tbody>
      </table></div></div>
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;">Student Performance</div>
      <div class="card"><div class="tw"><table>
        <thead><tr><th>Student</th><th>Reg No</th><th>Submitted</th><th>Graded</th><th>Score</th><th>%</th><th>Late</th></tr></thead>
        <tbody>${sa.length===0?'<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:24px;">No students.</td></tr>':
          sa.map(s=>`<tr>
            <td><div style="display:flex;align-items:center;gap:8px;"><div class="uav" style="width:26px;height:26px;font-size:10px;background:${avColor(s.student.name)};">${initials(s.student.name)}</div>${s.student.name}</div></td>
            <td style="font-size:12px;font-family:var(--m);">${s.student.studentId||'—'}</td>
            <td>${s.submissionCount}</td><td>${s.gradedCount}</td>
            <td>${s.totalObtained} / ${s.totalPossible}</td>
            <td>${s.percentage!==null?`<span class="badge ${parseFloat(s.percentage)>=70?'bg':parseFloat(s.percentage)>=50?'bb':'br'}">${s.percentage}%</span>`:'—'}</td>
            <td style="color:${s.lateSubmissions>0?'var(--amber)':'var(--text3)'};">${s.lateSubmissions}</td>
          </tr>`).join('')}</tbody>
      </table></div></div>`;
  } catch(e) { $('page-analytics').innerHTML=`<div class="alert ae">${e.message}</div>`; }
}

// ── PROFILE (FIXED - no crash) ──
function loadProfile() {
  const u = CU;
  $('page-profile').innerHTML = `
    <div style="font-size:17px;font-weight:800;margin-bottom:16px;">My Profile</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:680px;">
      <div class="card"><div class="cb">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;">
          <div class="uav" style="width:52px;height:52px;font-size:18px;background:${avColor(u.name)};">${initials(u.name)}</div>
          <div>
            <div style="font-size:15px;font-weight:700;">${u.name}</div>
            <div style="font-size:12.5px;color:var(--text3);">${u.email}</div>
            <span class="badge ${u.role==='admin'?'bp':u.role==='professor'?'bb':'bg'}" style="margin-top:4px;">${u.role}</span>
          </div>
        </div>
        <div class="fg"><label>Full Name</label><input class="fc" id="pn" value="${u.name}"></div>
        <div class="fg"><label>Department</label><input class="fc" id="pd" value="${u.department||''}"></div>
        ${u.role==='student'?`<div class="fg"><label>Student ID</label><input class="fc" id="ps" value="${u.studentId||''}"></div>`:''}
        <button class="btn btn-p btn-full" data-action="saveProfile">Save Changes</button>
      </div></div>
      <div class="card"><div class="cb">
        <div style="font-size:14px;font-weight:700;margin-bottom:14px;">Change Password</div>
        <div class="fg"><label>Current Password</label><input type="password" class="fc" id="pc" placeholder="Enter current password" autocomplete="current-password"></div>
        <div class="fg"><label>New Password</label><input type="password" class="fc" id="pn2" placeholder="Min 6 characters" autocomplete="new-password"></div>
        <div class="fg"><label>Confirm New Password</label><input type="password" class="fc" id="pc2" placeholder="Repeat new password" autocomplete="new-password"></div>
        <div id="pw-err" class="alert ae" style="display:none;margin-bottom:10px;"></div>
        <button class="btn btn-s btn-full" data-action="changePwd">Update Password</button>
      </div></div>
    </div>`;
}

async function saveProfile() {
  const name = $('pn').value.trim(), dept = $('pd').value.trim(), sid = $('ps')?.value.trim();
  if (!name) { toast('Name cannot be empty.','e'); return; }
  try {
    const r = await api('/auth/update-profile',{method:'PATCH',body:JSON.stringify({name,department:dept,studentId:sid})});
    if (!r.success) throw new Error(r.message);
    CU = r.user; localStorage.setItem('acad_usr',JSON.stringify(CU));
    updateUser(); toast('Profile updated!','s');
  } catch(e) { toast(e.message,'e'); }
}

async function changePwd() {
  const cur=$('pc')?.value, nw=$('pn2')?.value, conf=$('pc2')?.value;
  const errEl = $('pw-err');
  if (!cur||!nw||!conf) { errEl.textContent='Please fill all password fields.'; errEl.style.display='flex'; return; }
  if (nw!==conf) { errEl.textContent='New passwords do not match.'; errEl.style.display='flex'; return; }
  if (nw.length<6) { errEl.textContent='Password must be at least 6 characters.'; errEl.style.display='flex'; return; }
  errEl.style.display='none';
  try {
    const r = await api('/auth/change-password',{method:'PATCH',body:JSON.stringify({currentPassword:cur,newPassword:nw})});
    if (!r.success) { errEl.textContent=r.message; errEl.style.display='flex'; return; }
    toast('Password changed successfully!','s');
    $('pc').value=''; $('pn2').value=''; $('pc2').value='';
  } catch(e) { errEl.textContent=e.message; errEl.style.display='flex'; }
}

// ── NOTIFICATIONS ──
function toggleNotif() { $('notif-panel').classList.toggle('open'); if($('notif-panel').classList.contains('open')) loadNotifs(); }

async function loadNotifs() {
  try {
    const r = await api('/notifications');
    const notifs = r.notifications||[], unread=r.unreadCount||0;
    const nd=$('ncount');
    if (unread>0) { nd.textContent=unread>9?'9+':unread; nd.style.display='flex'; } else nd.style.display='none';
    $('nlist').innerHTML = notifs.length===0?'<div class="empty" style="padding:40px;"><div class="ei">🔔</div><p>No notifications yet.</p></div>':
      notifs.map(n=>`<div class="ni ${!n.isRead?'unread':''}" data-action="readNotif" data-id="${n._id}">
        <div class="nit">${n.title}</div>
        <div class="nim">${n.message}</div>
        <div class="nitm">${timeAgo(n.createdAt)}</div>
      </div>`).join('');
  } catch(e) {}
}

async function readNotif(id) { await api(`/notifications/${id}/read`,{method:'PATCH'}); loadNotifs(); }
async function markAllRead() { await api('/notifications/read-all',{method:'PATCH'}); loadNotifs(); toast('All read.','s'); }

function startPoll() { loadNotifs(); pollTimer=setInterval(loadNotifs,60000); }

