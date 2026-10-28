// workers/jobWorker.js
// ═══════════════════════════════════════════════════════════════
//  CHILD PROCESS – started by services/processManager.js with
//  child_process.fork(). Talks to the parent ONLY through IPC.
//
//  Parent → child : {type:'job', jobId, attempt, payload} | {type:'ping'} | {type:'shutdown'}
//  Child → parent : {type:'ready', pid} | {type:'pong'} | {type:'progress', jobId, pct}
//                   {type:'result', jobId, result} | {type:'error', jobId, error, retryable}
//
//  The actual work (type "assignment_processing") is a real integrity
//  check of a student's submission: it decodes each file in chunks,
//  computes SHA-256 + size, verifies the declared size, the extension
//  against the assignment's allowed list, sniffs the file signature,
//  counts lines/words for text files and flags duplicate files.
//  It does not touch MongoDB; the parent persists the result.
// ═══════════════════════════════════════════════════════════════

const crypto = require('crypto');
const path = require('path');

const MIN_MS = Math.max(0, parseInt(process.env.JOB_MIN_PROCESSING_MS || '0', 10) || 0);
const CHUNK = 3 * 1024 * 1024; // base64 chars per step (multiple of 4)
const TEXT_EXT = new Set(['txt', 'md', 'csv', 'js', 'py', 'java', 'c', 'cpp', 'h', 'html', 'css', 'json', 'xml', 'sql']);

const SIGNATURES = [
  { type: 'pdf', exts: ['pdf'], test: b => b.slice(0, 5).toString('latin1') === '%PDF-' },
  { type: 'zip/office', exts: ['zip', 'docx', 'xlsx', 'pptx'], test: b => b[0] === 0x50 && b[1] === 0x4b },
  { type: 'png', exts: ['png'], test: b => b[0] === 0x89 && b.slice(1, 4).toString('latin1') === 'PNG' },
  { type: 'jpeg', exts: ['jpg', 'jpeg'], test: b => b[0] === 0xff && b[1] === 0xd8 },
  { type: 'ole/office', exts: ['doc', 'xls', 'ppt'], test: b => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const tick = () => new Promise(r => setImmediate(r)); // yield so IPC pings are answered

async function processFile(file, allowed, onBytes) {
  const b64 = String(file.data || '');
  const hash = crypto.createHash('sha256');
  let size = 0, head = null, lines = 0, words = 0, inWord = false;
  const ext = path.extname(file.originalName || '').slice(1).toLowerCase();
  const isText = TEXT_EXT.has(ext);

  for (let i = 0; i < b64.length; i += CHUNK) {
    const buf = Buffer.from(b64.slice(i, i + CHUNK), 'base64');
    hash.update(buf);
    size += buf.length;
    if (!head) head = buf.slice(0, 16);
    if (isText) {
      for (let k = 0; k < buf.length; k++) {
        const c = buf[k];
        if (c === 10) lines++;
        const ws = c === 32 || c === 10 || c === 13 || c === 9;
        if (!ws && !inWord) { words++; inWord = true; } else if (ws) inWord = false;
      }
    }
    onBytes(buf.length);
    await tick();
  }

  const sig = head ? SIGNATURES.find(s => s.test(head)) : null;
  const flags = [];
  if (allowed && allowed.length && !allowed.map(x => x.toLowerCase()).includes(ext)) flags.push('extension_not_allowed');
  if (size === 0) flags.push('empty_file');
  if (typeof file.size === 'number' && file.size !== size) flags.push('size_mismatch');
  const known = SIGNATURES.find(s => s.exts.includes(ext));
  if (known && size > 0 && !known.test(head)) flags.push('signature_mismatch');

  const out = { name: file.originalName, extension: ext, bytes: size, sha256: hash.digest('hex'), detectedType: sig ? sig.type : (isText ? 'text' : 'unknown'), flags };
  if (isText) { out.lines = lines + (size > 0 && inWord ? 1 : 0) ; out.words = words; }
  return out;
}

async function assignmentProcessing(jobId, payload) {
  const started = Date.now();
  const files = Array.isArray(payload.files) ? payload.files : [];
  const total = files.reduce((a, f) => a + String(f.data || '').length, 0) || 1;
  let done = 0, lastPct = -1;
  const onBytes = n => {
    done += Math.ceil(n * 4 / 3);
    const pct = Math.min(99, Math.floor((done / total) * 100));
    if (pct !== lastPct) { lastPct = pct; process.send({ type: 'progress', jobId, pct }); }
  };
  const results = [];
  for (const f of files) results.push(await processFile(f, payload.allowedExtensions, onBytes));

  const seen = new Map(), dup = [];
  for (const r of results) { if (seen.has(r.sha256)) dup.push([seen.get(r.sha256), r.name]); else seen.set(r.sha256, r.name); }
  const flagged = results.filter(r => r.flags.length).length;

  if (MIN_MS) { const left = MIN_MS - (Date.now() - started); if (left > 0) await sleep(left); }
  return {
    workerPid: process.pid,
    fileCount: results.length,
    totalBytes: results.reduce((a, r) => a + r.bytes, 0),
    files: results,
    duplicateFiles: dup,
    flaggedFiles: flagged,
    verdict: flagged || dup.length ? 'needs_review' : (results.length ? 'clean' : 'no_files'),
    processingMs: Date.now() - started
  };
}

const HANDLERS = { assignment_processing: assignmentProcessing };
let busy = false;

process.on('message', async msg => {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'ping': return process.send({ type: 'pong' });
    case 'shutdown': return process.exit(0);
    case 'job': {
      if (busy) return process.send({ type: 'error', jobId: msg.jobId, error: 'worker busy', retryable: true });
      busy = true;
      try {
        const h = HANDLERS[(msg.payload || {}).jobType];
        if (!h) throw new Error(`Unknown job type "${(msg.payload || {}).jobType}"`);
        const result = await h(msg.jobId, msg.payload);
        process.send({ type: 'result', jobId: msg.jobId, result });
      } catch (err) {
        process.send({ type: 'error', jobId: msg.jobId, error: err.message, retryable: false });
      } finally { busy = false; }
    }
  }
});

// If the parent dies the IPC channel closes – do not become an orphan.
process.on('disconnect', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.send({ type: 'ready', pid: process.pid });
