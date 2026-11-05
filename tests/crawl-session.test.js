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
  assert.deepEqual(result.series.map((x) => [x.seriesNo, x.status, x.completed]), [[1, 'ok', true], [2, 'error', false], [3, 'ok', true]]);
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

const identityKey = (value) => String(value ?? '').replace(/И/g, 'N').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
const observation = (seriesNo, title, extra = {}) => ({ seriesNo, title, diff: 'ANOTHER', playStyle: 'DP', playedVersion: 30, observedAt: '2026-11-05T00:00:00Z', ...extra });

test('same-series common keys resolve ZENITH aliases while preserving the observation', () => {
  const songs = [
    { song_id: 1677, title: 'ZEИITH', series_no: 30, ac: 1, legen: 0, textage_song_id: 'zenith30' },
    { song_id: 1564, title: 'Zenith', series_no: 28, ac: 1, legen: 0, textage_song_id: 'zenith28' },
  ];
  const source = observation(30, 'ZENITH');
  const result = api.resolveObservation(source, songs, identityKey, []);
  assert.equal(result.status, 'matched');
  assert.equal(result.songId, 1677);
  assert.deepEqual(result.observation, { ...source, rawKey: [30, 'ZENITH', 'ANOTHER', 'DP'] });
  assert.equal(api.resolveObservation(observation(28, 'Zenith'), songs, identityKey, []).songId, 1564);
});

test('same-title entries in different series only resolve within the observed series', () => {
  const songs = [
    { song_id: 369, title: 'SHOOTING STAR', series_no: 30, ac: 1, legen: 0 },
    { song_id: 1700, title: 'Shooting Star', series_no: 31, ac: 1, legen: 0 },
  ];
  assert.equal(api.resolveObservation(observation(30, 'Shooting Star'), songs, identityKey, []).songId, 369);
  assert.equal(api.resolveObservation(observation(29, 'Shooting Star'), songs, identityKey, []).status, 'unmatched');
});

test('AC bit narrows ADVANCE to the eagate AC song', () => {
  const songs = [
    { song_id: 'advanc32', title: 'ADVANCE', series_no: 30, ac: 1, legen: 0 },
    { song_id: 'advance', title: 'ADVANCE', series_no: 30, ac: 2, legen: 0 },
  ];
  assert.equal(api.resolveObservation(observation(30, 'ADVANCE'), songs, identityKey, []).songId, 'advanc32');
});

test('C2 series identity exception selects exactly one remaining AC candidate', () => {
  const songs = [
    { song_id: 41, title: 'Shared', series_no: 30, ac: 1, legen: 0 },
    { song_id: 42, title: 'Shared', series_no: 30, ac: 1, legen: 0 },
  ];
  const row = observation(30, 'Shared');
  const exception = [{ seriesNo: 30, sourceTitle: 'Shared', songId: 42 }];
  assert.equal(api.resolveObservation(row, songs, identityKey, exception).songId, 42);
  assert.equal(api.resolveObservation(row, songs, identityKey, []).status, 'unmatched');
  assert.equal(api.resolveObservation(row, songs, identityKey, [{ ...exception[0], songId: 999 }]).status, 'unmatched');
  assert.equal(api.resolveObservation(row, songs, identityKey, [exception[0], { ...exception[0], songId: 41 }]).status, 'unmatched');
});

test('raw observations with Shared in different series remain separate', () => {
  const rows = [observation(30, 'Shared'), observation(31, 'Shared')];
  const resolved = rows.map((row) => api.resolveObservation(row, [], identityKey, []));
  assert.notDeepEqual(resolved[0].observation.rawKey, resolved[1].observation.rawKey);
  assert.deepEqual(resolved.map((item) => item.observation.seriesNo), [30, 31]);
});

test('songs load failure is distinct from a valid empty song list', () => {
  const row = observation(30, 'Unknown');
  assert.equal(api.resolveObservation(row, null, identityKey, []).status, 'error');
  const empty = api.resolveObservation(row, [], identityKey, []);
  assert.equal(empty.status, 'unmatched');
  assert.equal(empty.songId, null);
});
