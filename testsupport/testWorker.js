// Fixture worker used ONLY by automated tests (same IPC protocol as workers/jobWorker.js)
// payload: {delayMs, crashOnAttempt, alwaysCrash, hang, throwError, echo}
let silent = false;
process.on('message', async msg => {
  if (silent) return;
  if (msg.type === 'ping') return process.send({ type: 'pong' });
  if (msg.type === 'shutdown') return process.exit(0);
  if (msg.type !== 'job') return;
  const p = msg.payload || {};
  if (p.hang) { silent = true; return; }                           // stop answering pings too
  if (p.alwaysCrash || (p.crashOnAttempt && msg.attempt <= p.crashOnAttempt)) process.exit(1);
  if (p.delayMs) await new Promise(r => setTimeout(r, p.delayMs));
  if (p.throwError) return process.send({ type: 'error', jobId: msg.jobId, error: p.throwError, retryable: false });
  process.send({ type: 'result', jobId: msg.jobId, result: { echo: p.echo || null, pid: process.pid, attempt: msg.attempt } });
});
process.on('disconnect', () => process.exit(0));
process.send({ type: 'ready', pid: process.pid });
