'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');

const DB_CONN = path.join(__dirname, '..', 'modules', 'dbConn.js');

function response(body, { ok = true, status = 200 } = {}) {
  const text = body == null ? '' : JSON.stringify(body);
  return { ok, status, async text() { return text; }, async json() { return body; } };
}

function loadDb(handler, uploadEnabled = true, dateParse = Date.parse) {
  const calls = [];
  const warnings = [];
  const logs = [];
  const context = {
    window: { OhsorryNorm: { norm: (value) => String(value).toLowerCase() } },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes('service-status.json')) return response({ uploadEnabled });
      if (typeof handler !== 'function') throw new Error(`unhandled fetch URL: ${url}`);
      const result = await handler(url, options);
      if (result === undefined) throw new Error(`unhandled fetch URL: ${url}`);
      return result;
    },
    console: { log(...args) { logs.push(args); }, warn(...args) { warnings.push(args); }, error(...args) { warnings.push(args); } },
    Date: class extends Date { static parse(value) { return dateParse(value); } }, Map, Set, Promise, Number, String, BigInt, TypeError, Error,
    Object, Array, Math, JSON, isFinite, encodeURIComponent, URL, setTimeout, clearTimeout,
  };
  vm.runInNewContext(fs.readFileSync(DB_CONN, 'utf8'), context, { filename: DB_CONN });
  return { db: context.window.OhsorryDb, calls, warnings, logs };
}

function rpc(calls, name) { return calls.filter(({ url }) => url.endsWith('/rpc/' + name)); }

function scoreRow(overrides = {}) {
  return { iidx_id: '89388691', title: 'Filter Song', diff: 'ANOTHER', lamp: 5, ex_score: 2100,
    played_version: 33, play_style: 1, date: '2026-10-23T01:02:03.123457+00:00', date_kst: '2026-10-23',
    bp: 0, note_count: 1500, ...overrides };
}

const HIST_ROW = [100, 3, 5, 2000, 33, '2026-10-22T01:02:03.123456+00:00', '2026-10-22', 1, null, 1500];
function capturedScoreBodies(calls) { return rpc(calls, 'upsert_scores').map(({ options }) => JSON.parse(options.body)); }
function validBulkRow(i) { return scoreRow({ title: `Song ${i}`, ex_score: 100 }); }

test('hist snapshot is shared per user within an upload and refreshed on the next call', async () => {
  const reads = new Map();
  let currentHist = [HIST_ROW];
  const { db, calls } = loadDb(async (url) => {
    if (url.includes('/rest/v1/songs')) return response([{ song_id: 100, title: 'Filter Song', ac: 1 }, { song_id: 101, title: 'Other Song', ac: 1 }]);
    if (url.startsWith('https://data.iidx.in/hist/')) {
      const id = url.split('/').pop().replace('.json', ''); reads.set(id, (reads.get(id) || 0) + 1);
      return id === '89388691' ? response(currentHist) : response(null, { ok: false, status: 404 });
    }
    return response(null);
  });
  const result = await db.upsertUserChartScores([scoreRow(), scoreRow({ title: 'Other Song', ex_score: 100 }), scoreRow({ title: 'Other Song', ex_score: 110 })]);
  assert.equal(result.inserted, 2);
  assert.deepEqual(capturedScoreBodies(calls).map((x) => x.p_rows.length), [2]);
  assert.equal(reads.get('89388691'), 1);
  currentHist = [...currentHist, [100, 3, 5, 2100, 33, '2026-10-23T01:02:03.123457+00:00', '2026-10-23', 1, 0, 1500]];
  const next = await db.upsertUserChartScores([scoreRow()]);
  assert.equal(next.ok, true, JSON.stringify(next)); assert.equal(next.unchanged, true);
  assert.equal(reads.get('89388691'), 2);
  assert.equal(rpc(calls, 'upsert_scores').length, 1);
});

test('score history date memo reuses successful parses within one upload', async () => {
  let parseCalls = 0;
  const { db } = loadDb(async (url) => url.includes('/rest/v1/songs')
    ? response([{ song_id: 100, title: 'Filter Song', ac: 1 }]) : response([]), true,
  (value) => { parseCalls++; return Date.parse(value); });
  const { db: cachedDb } = loadDb(async (url) => url.includes('/rest/v1/songs')
    ? response([{ song_id: 100, title: 'Filter Song', ac: 1 }])
    : url.startsWith('https://data.iidx.in/hist/') ? response([HIST_ROW, [101, 3, 5, 1900, 33, HIST_ROW[5], HIST_ROW[6], 1, null, 1500]]) : response(null), true,
  (value) => { parseCalls++; return Date.parse(value); });
  await cachedDb.upsertUserChartScores([scoreRow()]);
  assert.ok(parseCalls > 0);
  assert.ok(parseCalls < 12, `expected repeated date parsing to be skipped, got ${parseCalls} Date.parse calls`);
});

test('score history date memo preserves repeated invalid input errors', async () => {
  const { db, warnings } = loadDb(async (url) => url.includes('/rest/v1/songs')
    ? response([{ song_id: 100, title: 'Filter Song', ac: 1 }])
    : url.startsWith('https://data.iidx.in/hist/') ? response([[100, 3, 5, 2000, 33, 'bad-date', '2026-10-22', 1, null, 1500]]) : response(null));
  await db.upsertUserChartScores([scoreRow()]);
  const messages = warnings.map((args) => args.join(' ')).filter((value) => value.includes('비교 실패'));
  assert.equal(messages.length, 1);
  assert.match(messages[0], /date requires a timestamp with timezone/);
});

test('score history date memos remain correct after 32769 distinct valid inputs', async () => {
  const base = Date.UTC(2000, 0, 1);
  const dayValues = Array.from({ length: 32769 }, (_, i) => new Date(base + i * 86400000).toISOString().slice(0, 10));
  const instantValues = dayValues.map((day) => `${day}T01:02:03.123456+00:00`);
  const { db } = loadDb(async (url) => url.includes('/rest/v1/songs')
    ? response([{ song_id: 100, title: 'Filter Song', ac: 1 }]) : response([]));
  const rows = dayValues.map((day, i) => scoreRow({
    iidx_id: String(10000000 + i), date: instantValues[i], date_kst: new Date(Date.parse(day + 'T00:00:00Z') + 9 * 3600000).toISOString().slice(0, 10),
    title: 'Filter Song', ex_score: 100,
  }));
  const result = await db.upsertUserChartScores(rows);
  assert.equal(result.ok, true);
  assert.equal(result.inserted, 32769);
});

test('hist transport, JSON, schema, and date failures warn and send all rows', async () => {
  const cases = [
    ['500', response(null, { ok: false, status: 500 }), /HTTP 500/], ['network', null, /offline/], ['json', null, /bad JSON/],
    ['schema', response({ scores: [], history: [] }), /array/],
    ['date', response([[100, 3, 5, 2000, 33, 'bad-date', '2026-10-22', 1, null, 1500]]), /date/],
  ];
  for (const [kind, hist, reason] of cases) {
    const payloads = [];
    const { db, warnings } = loadDb(async (url, options) => {
      if (url.includes('/rest/v1/songs')) return response([{ song_id: 100, title: 'Filter Song', ac: 1 }]);
      if (url.startsWith('https://data.iidx.in/hist/')) {
        if (kind === 'network') throw new Error('offline');
        if (kind === 'json') return { ok: true, status: 200, async json() { throw new Error('bad JSON'); } };
        return hist;
      }
      if (url.endsWith('/rpc/upsert_scores')) { payloads.push(JSON.parse(options.body)); return response(null); }
      return response(null);
    });
    const result = await db.upsertUserChartScores([scoreRow()]);
    assert.equal(result.inserted, 1, kind);
    assert.equal(payloads[0].p_rows.length, 1, kind);
    assert.ok(warnings.some((args) => reason.test(args.join(' '))), kind);
  }
});

test('late 33 uploads, NULL note_count, bp zero, and source timestamp survive in RPC payload', async () => {
  const bodies = [];
  const { db } = loadDb(async (url, options) => {
    if (url.includes('/rest/v1/songs')) return response([{ song_id: 100, title: 'Filter Song', ac: 1 }]);
    if (url.startsWith('https://data.iidx.in/hist/')) return response([[100, 3, 5, 2100, 34, '2026-10-22T01:02:03.123456+00:00', '2026-10-22', 1, null, 1500]]);
    if (url.endsWith('/rpc/upsert_scores')) { bodies.push(JSON.parse(options.body)); return response(null); }
    return response(null);
  });
  const row = scoreRow({ ex_score: 2100, bp: 0, note_count: null });
  assert.equal((await db.upsertUserChartScores([row])).inserted, 1);
  assert.deepEqual([bodies[0].p_rows[0].played_version, bodies[0].p_rows[0].bp, bodies[0].p_rows[0].note_count, bodies[0].p_rows[0].date], [33, 0, null, row.date]);
});

test('unchanged differs from empty and completion is sent only after inserted rows', async () => {
  const { db, calls } = loadDb(async (url) => {
    if (url.includes('/rest/v1/songs')) return response([{ song_id: 100, title: 'Filter Song', ac: 1 }]);
    if (url.startsWith('https://data.iidx.in/hist/')) return response([HIST_ROW]);
    return response(null);
  });
  let result = await db.uploadResult({ dbPayload: { iidx_id: '89388691', dj_name: 'DJ' }, chartScoreRows: [scoreRow({
    ex_score: 2000, date: HIST_ROW[5], date_kst: HIST_ROW[6], bp: null, note_count: HIST_ROW[9],
  })] });
  assert.equal(result.profile.ok, true); assert.equal(result.scores.ok, true); assert.equal(result.scores.unchanged, true);
  assert.equal(result.scores.inserted, 0); assert.equal(result.dump, null); assert.equal(rpc(calls, 'upsert_scores').length, 0);
  result = await db.uploadResult({ dbPayload: { iidx_id: '89388691' }, chartScoreRows: [] });
  assert.equal(result.scores.empty, true); assert.equal(result.dump, null); assert.equal(rpc(calls, 'upsert_scores').length, 0);
  assert.equal(rpc(calls, 'upsert_user').length, 2); assert.equal(rpc(calls, 'upsert_user_radar').length, 0);
  const sending = loadDb(async (url) => url.startsWith('https://data.iidx.in/hist/') ? response([]) : url.includes('/rest/v1/songs') ? response([{ song_id: 100, title: 'Filter Song', ac: 1 }]) : response(null));
  result = await sending.db.uploadResult({ dbPayload: { iidx_id: '89388691' }, chartScoreRows: [scoreRow()] });
  assert.equal(result.scores.inserted, 1); assert.equal(result.dump.ok, true);
});

test('filtered 1001 rows preserve two chunk failure accounting', async () => {
  const bodies = []; let scoreCalls = 0;
  const { db } = loadDb(async (url, options) => {
    if (url.includes('/rest/v1/songs')) {
      const offset = Number(new URL(url).searchParams.get('offset'));
      return response(Array.from({ length: Math.min(1000, 1001 - offset) }, (_, i) => ({ song_id: offset + i + 1, title: `Song ${offset + i}`, ac: 1 })));
    }
    if (url.startsWith('https://data.iidx.in/hist/')) return response([]);
    if (url.endsWith('/rpc/upsert_scores')) { bodies.push(JSON.parse(options.body)); return ++scoreCalls === 1 ? response(null) : response(null, { ok: false, status: 500 }); }
    return response(null);
  });
  const result = await db.upsertUserChartScores(Array.from({ length: 1001 }, (_, i) => validBulkRow(i)));
  assert.equal(result.ok, false); assert.equal(result.inserted, 1000); assert.equal(result.failedChunk, 2); assert.equal(result.totalChunks, 2);
  assert.deepEqual(bodies.map((x) => x.p_rows.length), [1000, 1]);
});

test('ac and legen bit supplementation checks ensure_song ID and preserves series grouping', async () => {
  const ensure = [];
  const { db, calls, warnings } = loadDb(async (url, options) => {
    if (url.includes('/rest/v1/songs')) return response([{ song_id: 100, title: 'Filter Song', ac: 0, legen: 0 }, { song_id: 101, title: 'Leg Song', ac: 0, legen: 0 }]);
    if (url.startsWith('https://data.iidx.in/hist/')) return response([HIST_ROW, [101, 4, 5, 2000, 33, HIST_ROW[5], HIST_ROW[6], 1, null, 1500]]);
    if (url.endsWith('/rpc/ensure_song')) { ensure.push(JSON.parse(options.body)); return response(999); }
    return response(null);
  });
  const result = await db.upsertUserChartScores([scoreRow({ title: 'Leg Song', diff: 'LEGGENDARIA', ex_score: 2000, bp: null, seriesNo: 7 })]);
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.unchanged, true); assert.equal(ensure.length, 1);
  assert.ok(warnings.some((args) => args.join(' ').includes('ID mismatch')));
  const bump = rpc(calls, 'bump_song_series'); assert.equal(bump.length, 1);
  assert.deepEqual(JSON.parse(bump[0].options.body).p_song_ids, [101]);
  assert.equal(rpc(calls, 'upsert_scores').length, 0); assert.equal(calls.some(({ url }) => url.includes('/rest/v1/scores')), false);
});

test('공식값이 섞인 프로필도 공식 인자 없이 저장하고 비공식 plays와 원본 radar를 보낸다', async () => {
  const { db, calls } = loadDb(async () => response(null));
  const result = await db.upsertUserProfile({
    iidx_id: '12345678', dj_name: 'DJ', sp_rank: '---', dp_rank: '---', notes_radar: { sp: { NOTES: 3 } }, plays: 7,
    star_estimate: 99, ereter_star: 98, native_star: 97, r_star: 96, sp_cpi: 95, sp_star: 94,
    sp_r_star: 93, sp_r_star_model_id: 'evil', sp_r_star_formula_version: 'evil',
  });
  assert.equal(result.ok, true);
  const body = JSON.parse(rpc(calls, 'upsert_user')[0].options.body);
  assert.deepEqual(Object.keys(body).sort(), ['p_iidx_id', 'p_dj_name', 'p_dp_rank', 'p_plays', 'p_sp_rank', 'p_star', 'p_ereter_star'].sort());
  assert.equal(body.p_star, null);
  assert.equal(body.p_ereter_star, 98);   // ereter 외부 룩업은 공식 계산이 아니라 그대로 전달
  assert.equal(body.p_plays, 7);
  assert.deepEqual(JSON.parse(rpc(calls, 'upsert_user_radar')[0].options.body).p_notes, 3);
});

test('초기 부모/radar와 업로드 kill switch 및 ID 검증을 유지한다', async () => {
  const { db, calls } = loadDb(async () => response(null));
  assert.equal((await db.upsertInitialUserProfile({ iidx_id: '12-345678', dj_name: 'DJ', notes_radar: { sp: { NOTES: 1 } } })).ok, true);
  assert.equal(rpc(calls, 'upsert_user').length, 1);
  assert.equal(rpc(calls, 'upsert_user_radar').length, 1);
  let writes = 0;
  const blocked = loadDb(async () => { writes++; return response(null); }, false);
  assert.equal((await blocked.db.notifyUploadComplete('12345678')).ok, false);
  assert.equal((await blocked.db.notifyUploadComplete('not-an-id')).ok, false);
  assert.equal(writes, 0);
});

test('DP/SP scores 커밋 뒤 완료 신호를 보내고 scores 읽기와 패턴 POST는 하지 않는다', async () => {
  const { db, calls } = loadDb(async (url) => url.includes('/rest/v1/songs')
    ? response([{ song_id: 1, title: 'Test DP', ac: 1 }, { song_id: 2, title: 'Test SP', ac: 1 }])
    : response(null));
  const result = await db.uploadResult({
    dbPayload: { iidx_id: '12345678', dj_name: 'DJ' },
    chartScoreRows: [
      { iidx_id: '12345678', title: 'Test DP', diff: 'ANOTHER', ex_score: 100, played_version: 33, play_style: 1 },
      { iidx_id: '12345678', title: 'Test SP', diff: 'ANOTHER', ex_score: 110, played_version: 33, play_style: 0 },
    ],
  });
  assert.equal(result.profile.ok, true);
  assert.equal(result.scores.ok, true);
  assert.equal(result.dump.ok, true);
  assert.equal(rpc(calls, 'upsert_user').length, 2);
  assert.equal(rpc(calls, 'upsert_scores').length, 1);
  assert.equal(calls.some(({ url }) => /make_grid_data|make_sp_rate_star_rows|upsert_user_feature_score|rest\/v1\/scores/.test(url)), false);
});

test('34행 뒤 늦은 33행도 그대로 버퍼로 보내 played_version, 날짜, BP를 보존한다', async () => {
  const captured = [];
  const { db } = loadDb(async (url, options) => {
    if (url.includes('/rest/v1/songs')) return response([{ song_id: 101, title: 'Late', ac: 1 }]);
    if (url.includes('/rpc/upsert_scores')) { captured.push(JSON.parse(options.body)); return response(null); }
    return response([]);
  });
  const rows = [
    { iidx_id: '12345678', title: 'Late', diff: 'ANOTHER', ex_score: 1800, played_version: 34, date: '2026-10-21T01:02:03.123456+00:00', bp: 20, note_count: 1000 },
    { iidx_id: '12345678', title: 'Late', diff: 'ANOTHER', ex_score: 1900, played_version: 33, date: '2026-10-22T01:02:03.123456+00:00', bp: 18, note_count: 1000 },
  ];
  const result = await db.uploadResult({ dbPayload: { iidx_id: '12345678' }, chartScoreRows: rows });
  assert.equal(result.scores.ok, true);
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].p_rows.map((r) => [r.played_version, r.date, r.bp]), [[34, rows[0].date, 20], [33, rows[1].date, 18]]);
});

test('부분 성공은 신호를 보내고 전체 실패/첫 청크 실패/부모 실패는 보내지 않으며 신호 실패를 분리한다', async () => {
  let scoreCalls = 0;
  let failSignal = false;
  const songRows = Array.from({ length: 1001 }, (_, i) => ({ song_id: i + 1, title: 'Song ' + i, ac: 1 }));
  const { db, calls } = loadDb(async (url) => {
    if (url.includes('/rest/v1/songs')) {
      const offset = Number(new URL(url).searchParams.get('offset'));
      return response(songRows.slice(offset, offset + 1000));
    }
    if (url.includes('/rpc/upsert_scores')) return ++scoreCalls === 1 ? response(null) : response(null, { ok: false, status: 500 });
    if (url.includes('/rpc/upsert_user') && failSignal && rpc(calls, 'upsert_user').length > 1) return response(null, { ok: false, status: 503 });
    return response(null);
  });
  const rows = Array.from({ length: 1001 }, (_, i) => ({ iidx_id: '12345678', title: 'Song ' + i, diff: 'ANOTHER', ex_score: 1, played_version: 33 }));
  // 청크별 결과를 통해 부분 커밋 뒤 신호와 결과 분리를 확인한다.
  failSignal = true;
  const partial = await db.uploadResult({ dbPayload: { iidx_id: '12345678' }, chartScoreRows: rows });
  assert.equal(partial.scores.ok, false);
  assert.equal(partial.scores.inserted, 1000);
  assert.equal(partial.dump.ok, false);
  assert.match(partial.scores.error, /이전 성공 1000행/);
  assert.equal(rpc(calls, 'upsert_user').length, 2);

  const firstFailure = loadDb(async (url) => {
    if (url.includes('/rest/v1/songs')) return response([{ song_id: 1, title: 'One', ac: 1 }]);
    if (url.includes('/rpc/upsert_scores')) return response(null, { ok: false, status: 500 });
    return response(null);
  });
  const failed = await firstFailure.db.uploadResult({
    dbPayload: { iidx_id: '12345678' },
    chartScoreRows: [{ iidx_id: '12345678', title: 'One', diff: 'ANOTHER', ex_score: 1, played_version: 33 }],
  });
  assert.equal(failed.scores.ok, false);
  assert.equal(failed.scores.inserted, 0);
  assert.equal(failed.dump, null);
  assert.equal(rpc(firstFailure.calls, 'upsert_user').length, 1);

  const parentFailure = loadDb(async (url) => url.endsWith('/rpc/upsert_user')
    ? response(null, { ok: false, status: 500 }) : response(null));
  const noParent = await parentFailure.db.uploadResult({
    dbPayload: { iidx_id: '12345678' }, chartScoreRows: [{ iidx_id: '12345678', title: 'One', diff: 'ANOTHER', ex_score: 1, played_version: 33 }],
  });
  assert.equal(noParent.dump, null);
  assert.equal(rpc(parentFailure.calls, 'upsert_scores').length, 0);
});

test('폐기된 SP API는 네트워크 없이 오류를 내고 호환 함수는 notify 결과에 pending을 붙인다', async () => {
  const { db, calls } = loadDb(async () => response(null));
  await assert.rejects(db.fetchSpChartsForStar('12345678'), /retired/);
  await assert.rejects(db.fetchSpRateStarRows('12345678'), /retired/);
  assert.equal(await db.upsertSpPatternScore('12345678'), null);
  const signal = await db.recomputeAndSaveStar('12345678');
  assert.equal(signal.ok, true);
  assert.equal(signal.pending, true);
  assert.equal(Object.hasOwn(signal, 'star'), false);
  assert.equal(rpc(calls, 'upsert_user').length, 1);
});
