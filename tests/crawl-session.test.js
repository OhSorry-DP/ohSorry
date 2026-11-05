'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');
const api = require('../modules/crawlSession.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'crawlSession.js'), 'utf8');
function fakeTime() {
  let now = 0;
  const sleeps = [];
  return { clock: () => now, sleeps, sleep: async (ms) => { sleeps.push(ms); now += ms; } };
}

test('N=1, 2, 3 share the same worker loop and respect the concurrency limit', async () => {
  for (const slots of [1, 2, 3]) {
    let active = 0, peak = 0;
    const result = await api._runQueueForTest({ seriesNos: [5, 1, 3, 2, 4], retryPolicy: {}, betweenRequestsMs: () => 0,
      fetchSeries: async (n) => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return { status: 'ok', charts: [n] }; } }, slots);
    assert.ok(peak <= slots);
    assert.deepEqual(result.series.map((x) => x.seriesNo), [1, 2, 3, 4, 5]);
  }
});

test('empty pages pause all new starts by arrival streak; a nonempty page resets the streak', async () => {
  const t = fakeTime();
  const sequence = [[], [], [], [], [9], [], [10]];
  const starts = [];
  const result = await api._runQueueForTest({ seriesNos: [1, 2, 3, 4, 5, 6, 7], clock: t.clock, sleep: t.sleep, retryPolicy: {}, betweenRequestsMs: () => 0,
    fetchSeries: async (n) => { starts.push([n, t.clock()]); const charts = sequence.shift(); return { status: 'ok', charts }; } }, 1);
  assert.deepEqual(t.sleeps, [2000, 4000, 8000, 8000, 2000]);
  assert.deepEqual(starts.map((x) => x[1]), [0, 2000, 6000, 14000, 22000, 22000, 24000]);
  assert.equal(result.completed, false);
});

test('successes and permanent failures remain complete and are returned in stable order', async () => {
  const result = await api._runQueueForTest({ seriesNos: [3, 1, 2], retryPolicy: {}, betweenRequestsMs: () => 0, fetchSeries: async (n) => {
    await Promise.resolve(); return n === 2 ? { status: 'error', error: 'HTTP 500' } : { status: 'ok', charts: [{ n }] };
  } }, 3);
  assert.deepEqual(result.series.map((x) => [x.seriesNo, x.status, x.completed]), [[1, 'ok', true], [2, 'error', true], [3, 'ok', true]]);
  assert.deepEqual(result.charts.map((x) => x.n), [1, 3]);
});

test('each slot sleeps between requests in both passes and missing delay is rejected', async () => {
  const t = fakeTime(); let calls = 0;
  const result = await api._runQueueForTest({ seriesNos: [1, 2, 3, 4], clock: t.clock, sleep: t.sleep,
    betweenRequestsMs: () => 7, retryPolicy: { maxCycles: 1, delaysMs: [0], capMs: 0 }, fetchSeries: async () => {
      calls++;
      return { status: 'ok', charts: calls <= 4 ? [] : [calls] };
    } }, 2);
  assert.equal(result.completed, true);
  assert.ok(t.sleeps.filter((ms) => ms === 7).length >= 4);
  await assert.rejects(api._runQueueForTest({ seriesNos: [], fetchSeries: async () => ({ status: 'ok', charts: [] }) }, 2), /betweenRequestsMs/);
});

test('each retry cycle delays from its own start; retry errors stay pending', async () => {
  let now = 0, attempt = 0; const starts = [];
  const result = await api._runQueueForTest({ seriesNos: [1], clock: () => now, sleep: async (ms) => { now += ms; },
    betweenRequestsMs: () => 0, retryPolicy: { maxCycles: 2, delaysMs: [10, 20], capMs: 20 }, fetchSeries: async () => {
      starts.push(now); attempt++;
      if (attempt === 1) { now += 50; return { status: 'ok', charts: [] }; }
      if (attempt === 2) { now += 50; return { status: 'error', error: 'temporary' }; }
      return { status: 'ok', charts: [1] };
    } }, 1);
  assert.ok(starts[2] - starts[1] >= 20);
  assert.equal(result.series[0].status, 'ok');

  let failedCalls = 0;
  const failedTime = fakeTime();
  const failed = await api._runQueueForTest({ seriesNos: [1], clock: failedTime.clock, sleep: failedTime.sleep, betweenRequestsMs: () => 0, retryPolicy: { maxCycles: 1, delaysMs: [0], capMs: 0 },
    fetchSeries: async () => { failedCalls++; return failedCalls === 1 ? { status: 'ok', charts: [] } : { status: 'error', error: 'offline' }; } }, 1);
  assert.equal(failed.completed, false);
  assert.equal(failed.series[0].error, 'offline');
});

test('browser UMD and CommonJS expose the same API', () => {
  const browser = {};
  vm.runInNewContext(source, { globalThis: browser, setTimeout, Promise, Object, Array, Map, Number, Math });
  assert.deepEqual(Object.keys(browser.OhsorryCrawlSession), Object.keys(api));
  assert.equal(browser.OhsorryCrawlSession.SERIES_CONCURRENCY, api.SERIES_CONCURRENCY);
  assert.deepEqual(Array.from(browser.OhsorryCrawlSession.EMPTY_PAUSE_MS), api.EMPTY_PAUSE_MS);
});
