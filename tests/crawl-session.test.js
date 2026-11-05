'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');
const api = require('../modules/crawlSession.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'crawlSession.js'), 'utf8');
const adapterSource = fs.readFileSync(path.join(__dirname, '..', 'modules', 'eagateFetch.js'), 'utf8');
function fakeTime() {
  let now = 0;
  const sleeps = [];
  return { clock: () => now, sleeps, sleep: async (ms) => { sleeps.push(ms); now += ms; } };
}

function loadEagate(fetchImpl, session = api, timing = {}) {
  const window = { OhsorryCrawlSession: session };
  const simulated = { now: 0 };
  class FakeDOMParser {
    parseFromString(html) {
      const title = html.trim();
      return { querySelectorAll: () => title ? [{
        querySelector: (selector) => selector === 'a.music_info' ? { textContent: title } : null,
        querySelectorAll: () => [{
          querySelector: (selector) => selector.includes('clflg') ? { getAttribute: () => '/clflg0.gif', src: '/clflg0.gif' } : null,
          getAttribute: () => '/clflg0.gif', src: '/clflg0.gif', textContent: '0',
        }],
      }] : [] };
    }
  }
  const fakeMath = Object.create(Math);
  fakeMath.random = () => 0;
  const FakeDate = class extends Date { static now() { return timing.clock ? timing.clock() : simulated.now; } };
  const fakeSetTimeout = timing.sleep
    ? (callback, ms) => { timing.sleep(ms).then(callback); }
    : (callback, ms) => { simulated.now += ms; Promise.resolve().then(callback); };
  vm.runInNewContext(adapterSource, { window, fetch: fetchImpl, URLSearchParams, DOMParser: FakeDOMParser,
    Math: fakeMath, Date: FakeDate, Promise, setTimeout: fakeSetTimeout, console });
  return window.OhsorryEagateFetch;
}

test('eagate adapter maps seriesNo to list and preserves same-title charts from separate series', async () => {
  const requests = [];
  const adapter = loadEagate(async (_url, options) => {
    requests.push(new URLSearchParams(options.body).get('list'));
    return { ok: true, text: async () => '22DUNK' };
  });
  const result = await adapter.collectCharts({ series: '33', seriesList: [0, 1], style: '0', updateProgress() {}, alertFn() {} });
  assert.deepEqual(requests.sort(), ['0', '1']);
  assert.deepEqual({ title: result.charts[0].title, diff: result.charts[0].diff, exScore: result.charts[0].exScore,
    lampNum: result.charts[0].lampNum, lamp: result.charts[0].lamp, seriesNo: result.charts[0].seriesNo },
  { title: '22DUNK', diff: 'BEGINNER', exScore: 0, lampNum: 0, lamp: 'NO PLAY', seriesNo: 1 });
  assert.deepEqual(result.charts.map(({ title, seriesNo, playStyle, playedVersion }) => [title, seriesNo, playStyle, playedVersion]),
    [['22DUNK', 1, 0, 33], ['22DUNK', 2, 0, 33]]);
  assert.equal(result.pageCount, 2);
  assert.equal(result.completed, true);
  assert.equal(result.observations.length, 2);
});

test('eagate adapter applies retry policy and returns exhausted empty-series failures', async () => {
  const t = fakeTime(); let attempts = 0; let configured;
  const session = { runQueue: async (options) => {
    configured = options;
    return api._runQueueForTest({ ...options, clock: t.clock, sleep: t.sleep }, 2);
  } };
  const notices = [];
  const adapter = loadEagate(async (_url, options) => {
    attempts++;
    return new URLSearchParams(options.body).get('list') === '0'
      ? { ok: true, text: async () => '' } : { ok: true, text: async () => '22DUNK' };
  }, session);
  const result = await adapter.collectCharts({ series: '33', seriesList: [0, 1], style: '1', updateProgress() {}, alertFn: (message) => notices.push(message) });
  assert.deepEqual({ ...configured.retryPolicy, delaysMs: Array.from(configured.retryPolicy.delaysMs) }, { maxCycles: 10, delaysMs: [2000, 4000, 8000], capMs: 8000 });
  assert.equal(typeof configured.betweenRequestsMs, 'function');
  assert.equal(configured.betweenRequestsMs(), 1300);
  assert.equal(attempts, 12);
  assert.deepEqual(t.sleeps.filter((ms) => ms === 2000 || ms === 4000 || ms === 8000), [2000, 4000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.series.map((item) => [item.seriesNo, item.completed]), [[1, false], [2, true]]);
  assert.deepEqual(result.charts.map((row) => [row.title, row.seriesNo]), [['22DUNK', 2]]);
  assert.deepEqual(notices, ['다음 시리즈는 이번에 못 읽었어요: 1. 나머지는 저장해요.']);

  const emptyTime = fakeTime();
  const emptySession = { runQueue: (options) => api._runQueueForTest({ ...options, clock: emptyTime.clock, sleep: emptyTime.sleep }, 2) };
  const emptyAdapter = loadEagate(async () => ({ ok: true, text: async () => '' }), emptySession);
  const allEmpty = await emptyAdapter.collectCharts({ series: '33', seriesList: [0], style: '1', updateProgress() {}, alertFn() {} });
  assert.equal(allEmpty.ok, false);
});

test('eagate adapter keeps first-series login failure fatal while returning later observations', async () => {
  const adapter = loadEagate(async (_url, options) => {
    const list = new URLSearchParams(options.body).get('list');
    return list === '0' ? { ok: false, status: 500 } : { ok: true, text: async () => '22DUNK' };
  });
  const result = await adapter.collectCharts({ series: '33', seriesList: [0, 1], style: '1', updateProgress() {}, alertFn() {} });
  assert.deepEqual(result.series.map((item) => [item.seriesNo, item.status, item.completed]), [[1, 'error', false], [2, 'ok', true]]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.observations.map((row) => [row.title, row.seriesNo, row.playStyle]), [['22DUNK', 2, 1]]);
});

test('eagate adapter allows two queue slots to have requests in progress at once', async () => {
  const t = fakeTime(); const starts = []; let active = 0, peak = 0, releaseFirst;
  const session = { runQueue: (options) => api._runQueueForTest({ ...options, clock: t.clock, sleep: t.sleep }, 2) };
  const adapter = loadEagate(async (_url, options) => {
    const list = new URLSearchParams(options.body).get('list');
    starts.push([list, t.clock()]);
    active++; peak = Math.max(peak, active);
    if (list === '0') await new Promise((resolve) => { releaseFirst = resolve; });
    if (list === '1') releaseFirst();
    await Promise.resolve(); active--;
    return { ok: true, text: async () => '22DUNK' };
  }, session);
  await adapter.collectCharts({ series: '33', seriesList: [0, 1, 2, 3], style: '1', updateProgress() {}, alertFn() {} });
  assert.equal(peak, 2);
  assert.equal(starts.length, 4);
});

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
  assert.equal(api.resolveObservation(row, songs, identityKey, []).status, 'unresolved');
  assert.equal(api.resolveObservation(row, songs, identityKey, [{ ...exception[0], songId: 999 }]).status, 'unresolved');
  assert.equal(api.resolveObservation(row, songs, identityKey, [exception[0], { ...exception[0], songId: 41 }]).status, 'unresolved');
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

test('song title keys are indexed once per songs array and commonKey function', () => {
  const songs = Array.from({ length: 2000 }, (_, index) => ({
    song_id: index + 1, title: `Song ${index}`, series_no: 30, ac: 1, legen: 0,
  }));
  let calls = 0;
  const countedKey = (title) => { calls += 1; return identityKey(title); };
  for (let index = 0; index < 1000; index += 1) {
    api.resolveObservation(observation(30, `Song ${index}`), songs, countedKey, []);
  }
  assert.ok(calls <= songs.length + 1000);

  const otherSongs = songs.slice();
  const beforeOtherArray = calls;
  api.resolveObservation(observation(30, 'Song 0'), otherSongs, countedKey, []);
  assert.equal(calls - beforeOtherArray, otherSongs.length + 1);
});

const aliasIdentity = (value) => value === 'ZE?ITH' ? 'ZENITH' : value;
const resolved = (seriesNo, title, songId) => ({ status: 'matched', songId, observation: observation(seriesNo, title) });
const missing = (seriesNo, title, extra = {}) => ({ status: 'unmatched', songId: null, observation: observation(seriesNo, title, extra) });
const completeCoverage = (series) => ({ requiredSeries: series, succeededSeries: series });

test('finalize never joins matching titles across series; unmatched rows follow coverage', () => {
  const one = api.finalizeIdentity([resolved(28, 'Shared', 8), missing(30, 'Shared')], completeCoverage([28, 30]), aliasIdentity);
  assert.equal(one.observations[0].songId, 8);
  assert.equal(one.observations[1].status, 'new');
  const partial = api.finalizeIdentity([resolved(28, 'Shared', 8), missing(30, 'Shared')], { requiredSeries: [28, 30], succeededSeries: [28] }, aliasIdentity);
  assert.equal(partial.observations[1].status, 'deferred');
});

test('finalize creates NEW despite same title only in a different master series and keeps ambiguous matches unresolved', () => {
  assert.equal(api.finalizeIdentity([missing(34, 'Same')], completeCoverage([34]), aliasIdentity).observations[0].status, 'new');
  const songs = [{ song_id: 1, title: 'Same', series_no: 34, ac: 1 }, { song_id: 2, title: 'Same', series_no: 34, ac: 1 }];
  assert.equal(api.resolveObservation(observation(34, 'Same'), songs, identityKey, []).status, 'unresolved');
});

test('incomplete coverage defers unmatched rows but preserves confirmed IDs', () => {
  const result = api.finalizeIdentity([resolved(28, 'Known', 8), missing(30, 'Unknown')], { requiredSeries: [28, 30], succeededSeries: [28] }, aliasIdentity);
  assert.equal(result.observations[0].songId, 8);
  assert.equal(result.observations[1].status, 'deferred');
  assert.deepEqual(result.coverage.failedSeries, [30]);
  assert.equal(api.finalizeIdentity([missing(30, 'Unknown')], completeCoverage([30]), aliasIdentity).observations[0].status, 'new');
});

test('old-series NEW limit allows ten unique titles and defers all eleven with reason', () => {
  const ten = Array.from({ length: 10 }, (_, i) => missing(12, `T${i}`, { playedVersion: 34 }));
  assert.ok(api.finalizeIdentity(ten, completeCoverage([12]), aliasIdentity).observations.every((x) => x.status === 'new'));
  const result = api.finalizeIdentity([...ten, missing(12, 'T10', { playedVersion: 34 })], completeCoverage([12]), aliasIdentity);
  assert.ok(result.observations.every((x) => x.status === 'deferred'));
  assert.deepEqual(result.observations[0].limit, { seriesNo: 12, count: 11, maximum: 10 });
  const duplicate = [missing(12, 'T', { playedVersion: 34, diff: 'HYPER' }), missing(12, 'T', { playedVersion: 34, diff: 'ANOTHER', playStyle: 'SP' })];
  assert.ok(api.finalizeIdentity(duplicate, completeCoverage([12]), aliasIdentity).observations.every((x) => x.status === 'new'));
});

test('latest-series NEW is unlimited and old-series limit does not affect other rows', () => {
  const rows = [...Array.from({ length: 11 }, (_, i) => missing(34, `N${i}`, { playedVersion: 34 })), ...Array.from({ length: 11 }, (_, i) => missing(12, `O${i}`, { playedVersion: 34 })), resolved(28, 'Confirmed', 8)];
  const result = api.finalizeIdentity(rows, completeCoverage([12, 28, 34]), aliasIdentity);
  assert.ok(result.observations.slice(0, 11).every((x) => x.status === 'new'));
  assert.ok(result.observations.slice(11, 22).every((x) => x.status === 'deferred'));
  assert.equal(result.observations[22].songId, 8);
});

test('NEW retains alias and observation details and is deterministic regardless of completion order', () => {
  const rows = [missing(12, 'ZE?ITH', { playedVersion: 34, diff: 'LEGGENDARIA', playStyle: 'DP', observedAt: 't1' }), missing(12, 'Other', { playedVersion: 34, observedAt: 't2' })];
  const run = (items) => api.finalizeIdentity(items, completeCoverage([12]), aliasIdentity).observations;
  const first = run(rows), reversed = run([...rows].reverse());
  const sort = (items) => items.map((x) => [x.status, x.aliasTitle, x.observation.title, x.observation.diff, x.observation.playStyle, x.observation.playedVersion, x.observation.observedAt]).sort((a, b) => String(a[2]).localeCompare(String(b[2])));
  assert.deepEqual(sort(first), sort(reversed));
  assert.equal(first[0].aliasTitle, 'ZENITH');
  assert.equal(first[0].observation.diff, 'LEGGENDARIA');
});

const lampNames = { 0: 'NO PLAY', 1: 'FAILED', 2: 'ASSIST', 3: 'EASY', 4: 'CLEAR', 5: 'HARD', 6: 'EX HARD', 7: 'FULL COMBO' };
const scoreRow = (extra = {}) => {
  const songId = extra.songId ?? 1;
  const row = { iidxId: 'u1', exScore: 100, lampNum: 4, lamp: 'CLEAR', missCount: 0,
    playedVersion: 33, playStyle: 1, ...extra };
  delete row.songId;
  if (Object.hasOwn(row, 'ex_score')) { row.exScore = row.ex_score; delete row.ex_score; }
  if (Object.hasOwn(extra, 'lamp') && Number.isInteger(extra.lamp)) { row.lampNum = extra.lamp; row.lamp = lampNames[extra.lamp]; }
  if (Object.hasOwn(extra, 'lamp') && typeof extra.lamp === 'string') {
    row.lampNum = Object.entries(lampNames).find(([, name]) => name === extra.lamp)?.[0] * 1;
  }
  if (Object.hasOwn(extra, 'playStyle') && typeof extra.playStyle === 'string') row.playStyle = extra.playStyle === 'DP' ? 1 : 0;
  if (Object.hasOwn(row, 'bp')) { row.missCount = row.bp; delete row.bp; }
  if (Object.hasOwn(row, 'note_count')) { row.noteCount = row.note_count; delete row.note_count; }
  return { status: 'matched', songId, observation: observation(34, 'Shared', row) };
};
let actualFilter;
const actualFilterReady = import('../../ohsorry-data/.github/scripts/score-history.mjs').then((module) => {
  actualFilter = module.filterWebCrawlHistoryRows;
});
const planner = (items, histRows = [], options = {}) => api.buildPlan({ observations: items, iidxId: 'u1',
  hist: options.hist ?? { status: 'ok', rows: histRows }, songs: [], chartNotes: options.chartNotes ?? (() => 1000),
  compareHistory: options.compareHistory ?? actualFilter });

test('buildPlan uses the real C6 comparator with real crawl and hist row shapes', async () => {
  await actualFilterReady;
  const hist = [[160, 3, 4, 100, 33, '2026-08-20T08:44:38.019+00:00', '2026-08-20', 1, null, 1000]];
  const plan = (exScore, lamp) => planner([scoreRow({ songId: 160, exScore, lamp, playedVersion: 33, playStyle: 1,
    observedAt: '2026-11-05T20:00:00.000Z' })], hist);
  const hard = plan(90, 'HARD'), assistWin = plan(110, 'ASSIST'), assistLose = plan(90, 'ASSIST');
  assert.equal(hard.rows.length, 1);
  assert.equal(assistWin.rows.length, 1);
  assert.equal(assistLose.rows.length, 0);
  assert.deepEqual([hard.rows[0].diff, hard.rows[0].lamp], [3, 5]);
  assert.deepEqual([hard.rows[0].date_kst, hard.rows[0].play_style], ['2026-11-06', 1]);
});

test('buildPlan preserves same-EX BP and NULL note enrichment after ID merge', () => {
  const result = planner([scoreRow({ missCount: null, noteCount: null }), scoreRow({ seriesNo: 35, missCount: 0, noteCount: 1000 })],
    [[1, 3, 5, 100, 33, '2026-11-01T00:00:00.000Z', '2026-11-01', 1, null, null]]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].bp, 0);
  assert.equal(result.rows[0].note_count, 1000);
});

test('buildPlan rejects over-maximum observations before merging and accepts equality', () => {
  const result = planner([scoreRow({ exScore: 2001, seriesNo: 34 }), scoreRow({ exScore: 1900, seriesNo: 35 })]);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].ex, 2001);
  assert.equal(result.rows[0].ex_score, 1900);
  assert.equal(planner([scoreRow({ exScore: 2000 })]).rows[0].ex_score, 2000);
});

test('buildPlan skips unknown note metadata and keeps NEW with the server reservation fields', () => {
  const fresh = { status: 'new', observation: observation(34, 'ZE?ITH', { playedVersion: 34, diff: 'LEGGENDARIA', playStyle: 1,
    exScore: 0, lampNum: 0, lamp: 'NO PLAY' }), aliasTitle: 'ZENITH' };
  const result = planner([scoreRow({ exScore: 0, lamp: 'NO PLAY' }), fresh], [], { chartNotes: () => null });
  assert.equal(result.rejected.length, 0);
  assert.equal(result.newRequests[0].title, 'ZENITH');
  assert.equal(result.newRequests[0].p_textage_song_id, '@crawl:new-only');
  assert.equal(result.newRequests[0].p_ac, null);
  assert.equal(result.newRequests[0].p_legen, 1);
  assert.deepEqual([5, 2, 1, 0].map((lamp) => planner([scoreRow({ exScore: 0, lamp })], [], { compareHistory: (_, rows) => rows }).rows.length), [1, 1, 0, 0]);
  assert.equal(result.rows.length, 0);
  assert.equal(result.newRequests[0].scoreless, true);
  assert.equal(planner([{ ...fresh, observation: { ...fresh.observation, lampNum: 5, lamp: 'HARD' } }], [], { chartNotes: () => null }).newRequests[0].lamp, 5);
});

test('buildPlan output is stable across observation completion order', () => {
  const rows = [scoreRow({ exScore: 100, observedAt: '2026-11-01T00:00:00Z' }), scoreRow({ exScore: 2001, observedAt: '2026-11-02T00:00:00Z' })];
  const run = (items) => planner(items);
  assert.deepEqual(run(rows), run([...rows].reverse()));
});

test('buildPlan handles hist errors, failed series, and deferred rows without network or writes', () => {
  const deferred = { status: 'deferred', observation: observation(33, 'Later') };
  const result = planner([scoreRow(), deferred], [], { hist: { status: 'error' } });
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.deferred.map((x) => x.status), ['deferred']);
  assert.deepEqual(result.failedSeries, []);
  assert.deepEqual(result.newRequests, []);
});

test('NEW reservations group by alias title and observed series while duplicate charts merge', () => {
  const fresh = (seriesNo, title, exScore = 10) => ({ status: 'new', aliasTitle: aliasIdentity(title),
    observation: observation(seriesNo, title, { playedVersion: 34, diff: 'ANOTHER', playStyle: 1,
      exScore, lampNum: 1, lamp: 'FAILED' }) });
  const result = planner([fresh(34, 'One'), fresh(34, 'Two'), fresh(34, 'One', 20), fresh(33, 'One')]);
  assert.equal(result.newRequests.length, 3);
  assert.deepEqual(result.newRequests.map((row) => [row.title, row.song_id]), [
    ['One', '@crawl:new:One:33:1:3'], ['One', '@crawl:new:One:34:1:3'], ['Two', '@crawl:new:Two:34:1:3'],
  ]);
  assert.equal(result.newRequests.find((row) => row.title === 'One' && row.song_id.includes(':34:')).ex_score, 20);
});

test('chartNotes receives the original observation and confirmed song ID for per-song limits', () => {
  const calls = [];
  const songs = [
    { song_id: 101, title: 'A', series_no: 34, textage_song_id: 'a34' },
    { song_id: 202, title: 'B', series_no: 34, textage_song_id: 'b34' },
  ];
  const items = songs.map((song, index) => ({ status: 'matched', songId: song.song_id,
    observation: observation(34, song.title, { playedVersion: 34, diff: 'ANOTHER', playStyle: 1,
      exScore: index ? 199 : 201, lampNum: 4, lamp: 'CLEAR' }) }));
  const result = api.buildPlan({ observations: items, songs, iidxId: 'u1', hist: { status: 'ok', rows: [] },
    chartNotes: (source, songId) => { calls.push([source.title, songId]); return songId === 101 ? 100 : 100; }, compareHistory: () => [] });
  assert.deepEqual(calls, [['A', 101], ['B', 202]]);
  assert.deepEqual(result.rejected.map((row) => row.ex), [201]);
});
