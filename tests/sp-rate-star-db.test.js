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

function loadDb(handler, uploadEnabled = true) {
  const calls = [];
  const context = {
    window: { OhsorryNorm: { norm: (value) => String(value).toLowerCase() } },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes('service-status.json')) return response({ uploadEnabled });
      return handler(url, options);
    },
    console: { log() {}, warn() {}, error() {} }, Date, Map, Set, Promise, Number, String,
    Object, Array, Math, JSON, isFinite, encodeURIComponent,
  };
  vm.runInNewContext(fs.readFileSync(DB_CONN, 'utf8'), context, { filename: DB_CONN });
  return { db: context.window.OhsorryDb, calls };
}

function rpc(calls, name) { return calls.filter(({ url }) => url.endsWith('/rpc/' + name)); }

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
