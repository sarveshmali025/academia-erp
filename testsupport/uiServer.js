// UI smoke-test server (NOT part of the product): serves the real routes/jobs.js over HTTP
// with the in-memory store and real forked workers, so public/index.html can be exercised in a browser.
const http = require('http');
const { install, call } = require('./harness');
const users = { admintok: { _id: 'a', role: 'admin', name: 'Admin', isActive: true }, stutok: { _id: 's', role: 'student', name: 'S', isActive: true } };
const db = new Map();
const q = v => { const p = Promise.resolve(v); p.lean = () => Promise.resolve(v); p.select = () => p; return p; };
const env = install({ users, models: {
  Submission: { findById: id => q(db.get(id) || null) }, Assignment: { findById: () => q({ allowedExtensions: ['txt', 'pdf'] }) } } });
process.env.JOB_WORKERS = '2'; process.env.JOB_QUEUE_MAX = '20';
const jobService = require('../services/jobService');
const jobs = require('../routes/jobs');
(async () => {
  await jobService.init({ log() {}, warn() {}, error() {} });
  for (let i = 1; i <= 6; i++) {
    const body = Buffer.alloc(i * 400000, 'abc \n'); db.set(`s${i}`, { _id: `s${i}`, assignment: 'a', files: [{ originalName: `f${i}.txt`, size: body.length, data: body.toString('base64') }] });
    await jobService.enqueueSubmission({ _id: `s${i}`, student: 'x', classroom: 'c', files: [{ size: body.length }] }, { _id: 'a', title: `Lab <${i}>` }, i === 2 ? '<img src=x onerror=alert(1)>' : `Student ${i}`);
  }
  http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    let raw = ''; req.on('data', d => raw += d); req.on('end', async () => {
      const m = req.url.match(/^\/api\/admin\/jobs(\/.*)?$/);
      if (!m) { res.writeHead(404); return res.end('{}'); }
      const r = await call(jobs, req.method, m[1] || '/', { token: (req.headers.authorization || '').replace('Bearer ', ''), body: raw ? JSON.parse(raw) : {} });
      res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.body));
    });
  }).listen(5000, () => console.log('ui server on 5000'));
  process.on('SIGTERM', async () => { await jobService.shutdown(); process.exit(0); });
})();
