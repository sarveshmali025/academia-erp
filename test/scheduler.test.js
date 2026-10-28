const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../services/scheduler');

// Classic textbook set:  P1(0,5) P2(1,3) P3(2,8) P4(3,6)
const SET = [{ id: 'P1', arrival: 0, burst: 5 }, { id: 'P2', arrival: 1, burst: 3 }, { id: 'P3', arrival: 2, burst: 8 }, { id: 'P4', arrival: 3, burst: 6 }];
const col = (r, k) => Object.fromEntries(r.processes.map(p => [p.id, p[k]]));

test('FCFS: order, gantt, WT, TAT (hand-computed)', () => {
  const r = S.fcfs(SET);
  assert.equal(r.mode, 'SIMULATION');
  assert.deepEqual(r.gantt, [{ pid: 'P1', start: 0, end: 5 }, { pid: 'P2', start: 5, end: 8 }, { pid: 'P3', start: 8, end: 16 }, { pid: 'P4', start: 16, end: 22 }]);
  assert.deepEqual(col(r, 'turnaround'), { P1: 5, P2: 7, P3: 14, P4: 19 });
  assert.deepEqual(col(r, 'waiting'), { P1: 0, P2: 4, P3: 6, P4: 13 });
  assert.equal(r.averages.turnaround, 11.25);
  assert.equal(r.averages.waiting, 5.75);
});

test('SJF non-preemptive: P1 is NOT interrupted by shorter P2', () => {
  const r = S.sjf(SET);
  assert.deepEqual(r.gantt.map(g => [g.pid, g.start, g.end]), [['P1', 0, 5], ['P2', 5, 8], ['P4', 8, 14], ['P3', 14, 22]]);
  assert.deepEqual(col(r, 'waiting'), { P1: 0, P2: 4, P3: 12, P4: 5 });
  assert.deepEqual(col(r, 'turnaround'), { P1: 5, P2: 7, P3: 20, P4: 11 });
  assert.equal(r.averages.waiting, 5.25);
  assert.equal(r.averages.turnaround, 10.75);
});

test('Round Robin q=2: arrivals enter the queue BEFORE the pre-empted process', () => {
  const r = S.roundRobin(SET, 2);
  // hand-derived: P1 0-2 | P2 2-4 | P3 4-6 | P1 6-8 | P4 8-10 | P2 10-11 | P3 11-13 | P1 13-14 | P4 14-16 | P3 16-18 | P4 18-20 | P3 20-22
  assert.deepEqual(r.gantt.map(g => `${g.pid}:${g.start}-${g.end}`),
    ['P1:0-2', 'P2:2-4', 'P3:4-6', 'P1:6-8', 'P4:8-10', 'P2:10-11', 'P3:11-13', 'P1:13-14', 'P4:14-16', 'P3:16-18', 'P4:18-20', 'P3:20-22']);
  assert.deepEqual(col(r, 'completion'), { P1: 14, P2: 11, P3: 22, P4: 20 });
  assert.deepEqual(col(r, 'turnaround'), { P1: 14, P2: 10, P3: 20, P4: 17 });
  assert.deepEqual(col(r, 'waiting'), { P1: 9, P2: 7, P3: 12, P4: 11 });
  assert.deepEqual(col(r, 'response'), { P1: 0, P2: 1, P3: 2, P4: 5 });
  assert.equal(r.averages.turnaround, 15.25);
  assert.equal(r.averages.waiting, 9.75);
});

test('RR: process finishing inside its quantum releases the CPU immediately', () => {
  const r = S.roundRobin([{ id: 'A', arrival: 0, burst: 1 }, { id: 'B', arrival: 0, burst: 3 }], 2);
  assert.deepEqual(r.gantt, [{ pid: 'A', start: 0, end: 1 }, { pid: 'B', start: 1, end: 4 }]); // A not padded to q; B's slices merge
});

test('RR: lone process keeps the CPU (contiguous slices merged), idle gaps modelled', () => {
  const r = S.roundRobin([{ id: 'A', arrival: 0, burst: 5 }, { id: 'B', arrival: 10, burst: 2 }], 2);
  assert.deepEqual(r.gantt, [{ pid: 'A', start: 0, end: 5 }, { pid: 'IDLE', start: 5, end: 10 }, { pid: 'B', start: 10, end: 12 }]);
  assert.equal(r.processes.find(p => p.id === 'B').waiting, 0);
  assert.ok(r.cpuUtilization < 100);
});

test('RR: arrival exactly at slice end goes ahead of the re-queued process', () => {
  const r = S.roundRobin([{ id: 'A', arrival: 0, burst: 4 }, { id: 'B', arrival: 2, burst: 2 }], 2);
  assert.deepEqual(r.gantt.map(g => g.pid), ['A', 'B', 'A']);
});

test('FCFS/SJF idle gap before first arrival', () => {
  for (const f of [S.fcfs, S.sjf]) {
    const r = f([{ id: 'X', arrival: 3, burst: 2 }]);
    assert.deepEqual(r.gantt, [{ pid: 'IDLE', start: 0, end: 3 }, { pid: 'X', start: 3, end: 5 }]);
    assert.equal(r.processes[0].waiting, 0);
  }
});

test('SJF tie on burst → earlier arrival wins', () => {
  const r = S.sjf([{ id: 'A', arrival: 0, burst: 4 }, { id: 'C', arrival: 2, burst: 2 }, { id: 'B', arrival: 1, burst: 2 }]);
  assert.deepEqual(r.executionOrder, ['A', 'B', 'C']);
});

test('input validation', () => {
  assert.throws(() => S.fcfs([]), /At least one/);
  assert.throws(() => S.fcfs([{ id: 'A', arrival: 0, burst: 0 }]), /burst/);
  assert.throws(() => S.fcfs([{ id: 'A', arrival: -1, burst: 1 }]), /arrival/);
  assert.throws(() => S.fcfs([{ id: 'A', arrival: 0, burst: 1 }, { id: 'A', arrival: 0, burst: 1 }]), /Duplicate/);
  assert.throws(() => S.roundRobin(SET, 0), /quantum/i);
  assert.throws(() => S.roundRobin([{ id: 'A', arrival: 0, burst: 1e6 }], 1), /too many/);
  assert.throws(() => S.simulate(SET, { algorithms: ['lottery'] }), /Unknown algorithm/);
  assert.equal(S.simulate(SET).length, 3);
});

test('real dispatch pickNextJob: FCFS, SJF and SJF aging', () => {
  const now = 1_000_000;
  const jobs = [
    { _id: 'a', enqueuedAt: new Date(now - 5000), estimatedBytes: 900 },
    { _id: 'b', enqueuedAt: new Date(now - 4000), estimatedBytes: 10 },
    { _id: 'c', enqueuedAt: new Date(now - 3000), estimatedBytes: 100 }];
  assert.equal(S.pickNextJob(jobs, 'fcfs', now)._id, 'a');
  assert.equal(S.pickNextJob(jobs, 'sjf', now, 60000)._id, 'b');
  assert.equal(S.pickNextJob(jobs, 'sjf', now, 4500)._id, 'a', 'aged job is served first (no starvation)');
  assert.equal(S.pickNextJob([], 'fcfs'), null);
});
