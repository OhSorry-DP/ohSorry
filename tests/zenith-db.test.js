'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'modules', 'dbConn.js');
function response(body, ok = true) {
  const text = body == null ? '' : JSON.stringify(body);
  return { ok, status: ok ? 200 : 404, async json() { return body; }, async text() { return text; } };
}
function loadDb() {
  const calls = [], logs = [], warnings = [];
  const context = {
    window: { OhsorryNorm: { norm: (s) => String(s).toLowerCase() } },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes('service-status.json')) return response({ uploadEnabled: true });
      if (url.includes('/rest/v1/songs?')) return response([
        { song_id: 1564, title: 'ZENITH', ac: 1, legen: 0, series_no: 28 },
        { song_id: 99, title: 'Normal', ac: 1, legen: 0, series_no: null },
      ]);
      if (url.startsWith('https://data.iidx.in/hist/')) return response([]);
      if (url.includes('/rpc/ensure_song')) return response(1677);
      if (url.includes('/rpc/upsert_scores')) return response(1);
      if (url.includes('/rpc/bump_song_series')) return response(1);
      return response(null);
    },
    console: { log(...x) { logs.push(x); }, warn(...x) { warnings.push(x); }, error(...x) { warnings.push(x); } },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' }, AbortController,
    Date, Map, Set, Promise, Number, String, BigInt, TypeError, Error, Object, Array, Math, JSON,
    isFinite, encodeURIComponent, URL, setTimeout, clearTimeout,
  };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath });
  return { db: context.window.OhsorryDb, calls, logs, warnings };
}
const row = (title, seriesNo, overrides = {}) => ({ iidx_id: '89388691', title, diff: 'ANOTHER', lamp: 'AC', ex_score: 100,
  played_version: 34, play_style: 0, date: '2026-10-23T01:02:03.123457+00:00', seriesNo, ...overrides });
const rpc = (calls, name) => calls.filter((x) => x.url.endsWith('/rpc/' + name));

test('v34 eagate ZENITH series 30 uses 1677 and other series pages skip', async () => {
  const { db, calls, warnings } = loadDb();
  await db.upsertUserChartScores([row('Zenith', 28), row('ZENITH', 30, { ex_score: 200, play_style: 1 }), row('Normal', 8),
    row('ZENITH', 28), row('ZENITH', 34), row('ZENITH', null), row('ZENITH', undefined)]);
  const body = rpc(calls, 'upsert_scores').map((x) => JSON.parse(x.options.body)).flatMap((x) => x.p_rows);
  assert.deepEqual(body.map((x) => x.song_id), [1564, 1677, 99]);
  assert.equal(rpc(calls, 'ensure_song').length, 0);
  const bumpIds = rpc(calls, 'bump_song_series').flatMap((x) => JSON.parse(x.options.body).p_song_ids);
  assert.deepEqual(bumpIds, [99]);
  assert.equal(bumpIds.includes(1564) || bumpIds.includes(1677), false);
  const log = warnings.map((x) => x.join(' ')).join('\n');
  assert.match(log, /song 매칭 실패 4건/);
  assert.match(log, /seriesNo=undefined/);
  assert.match(log, /제니스 관측 시리즈 불일치/);
});

test('version 33, INF and CSV keep the ordinary matching path', async () => {
  const { db, calls } = loadDb();
  await db.upsertUserChartScores([row('ZENITH', 30, { played_version: 33 }), row('ZENITH', 30, { played_version: 0 }),
    row('ZENITH', 30)], { completionSource: 'csv', fastDumpEnabled: false });
  const body = rpc(calls, 'upsert_scores').map((x) => JSON.parse(x.options.body)).flatMap((x) => x.p_rows);
  assert.deepEqual(body.map((x) => x.song_id), [1564, 1564, 1564]);
});

test('unplayed ZENITH skips ensure and excludes protected IDs from bump', async () => {
  const { db, calls } = loadDb();
  await db.ensureUnplayedSongs(['ZENITH', 'Zenith', 'Normal'], 34);
  const bumps = rpc(calls, 'bump_song_series').map((x) => JSON.parse(x.options.body));
  assert.deepEqual(bumps, [{ p_song_ids: [99], p_series_no: 34 }]);
  assert.equal(rpc(calls, 'ensure_song').length, 0);
});
