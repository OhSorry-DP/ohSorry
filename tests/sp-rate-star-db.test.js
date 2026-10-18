'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');

const DB_CONN = path.join(__dirname, '..', 'modules', 'dbConn.js');
const MODEL_ID = 'sp-grade-irt-v1:' + 'a'.repeat(64);
const FORMULA = 'sp-u1-v1';

function loadDb(fetchMock) {
  const context = {
    window: {
      OhsorryNorm: { norm: (value) => String(value).toLowerCase() },
    },
    fetch: fetchMock,
    console: { log() {}, warn() {}, error() {} },
    Date,
    Map,
    Set,
    Promise,
    Number,
    String,
    Object,
    Array,
    Math,
    JSON,
    isFinite,
    encodeURIComponent,
  };
  vm.runInNewContext(fs.readFileSync(DB_CONN, 'utf8'), context, { filename: DB_CONN });
  return context.window.OhsorryDb;
}

function response(body, { ok = true, status = 200, jsonError } = {}) {
  return {
    ok,
    status,
    async json() {
      if (jsonError) throw jsonError;
      return body;
    },
    async text() {
      return body == null ? '' : JSON.stringify(body);
    },
  };
}

function withUploadEnabled(fetchMock) {
  return (url, options) => url.includes('service-status.json')
    ? Promise.resolve(response({ uploadEnabled: true }))
    : fetchMock(url, options);
}

function rpcCalls(calls, name) {
  return calls.filter(({ url }) => url.includes('/rpc/' + name));
}

test('legacy upsert payload omits SP r-star RPC keys', async () => {
  const calls = [];
  const db = loadDb(withUploadEnabled(async (url, options) => {
    calls.push({ url, options });
    return response({});
  }));
  const result = await db.upsertUserProfile({ iidx_id: '12345678', star_estimate: 5, notes_radar: {} });
  assert.equal(result.ok, true);
  const body = JSON.parse(rpcCalls(calls, 'upsert_user')[0].options.body);
  assert.equal(Object.hasOwn(body, 'p_sp_r_star'), false);
  assert.equal(Object.hasOwn(body, 'p_sp_r_star_model_id'), false);
  assert.equal(Object.hasOwn(body, 'p_sp_r_star_formula_version'), false);
});

test('initial profile creates user then valid SP and DP radars with only six user keys', async () => {
  const calls = [];
  const db = loadDb(withUploadEnabled(async (url, options) => {
    calls.push({ url, options });
    return response({});
  }));
  const result = await db.upsertInitialUserProfile({
    iidx_id: '12-345678', dj_name: 'DJ', sp_rank: '---', dp_rank: '---',
    notes_radar: { sp: { NOTES: 1 }, dp: { PEAK: 2 } }, star_estimate: 99, p_star: 100,
  });
  assert.equal(result.ok, true);
  const rpc = calls.filter(({ url }) => url.includes('/rpc/'));
  assert.deepEqual(rpc.map(({ url }) => url.split('/rpc/')[1]), ['upsert_user', 'upsert_user_radar', 'upsert_user_radar']);
  const userBody = JSON.parse(rpc[0].options.body);
  assert.deepEqual(Object.keys(userBody).sort(), ['p_iidx_id', 'p_dj_name', 'p_star', 'p_ereter_star', 'p_sp_rank', 'p_dp_rank'].sort());
  assert.deepEqual(userBody, { p_iidx_id: '12345678', p_dj_name: 'DJ', p_star: null, p_ereter_star: null, p_sp_rank: null, p_dp_rank: null });
  assert.deepEqual(rpc.slice(1).map(({ options }) => JSON.parse(options.body).p_play_style), [0, 1]);
});

test('initial profile omits optional users values and preserves SQL-defined values contract', async () => {
  const calls = [];
  const db = loadDb(withUploadEnabled(async (url, options) => { calls.push({ url, options }); return response({}); }));
  const result = await db.upsertInitialUserProfile({
    iidx_id: '12345678', dj_name: 'DJ', sp_rank: '---', dp_rank: '---', notes_radar: {},
    star_estimate: 6, ereter_star: 7, native_star: 8, sp_cpi: 1900, sp_star: 9, r_star: 10,
    plays: [1], sp_r_star: 11, sp_r_star_model_id: 'model', sp_r_star_formula_version: 'formula',
  });
  assert.equal(result.ok, true);
  const body = JSON.parse(rpcCalls(calls, 'upsert_user')[0].options.body);
  assert.deepEqual(Object.keys(body).sort(), ['p_iidx_id', 'p_dj_name', 'p_star', 'p_ereter_star', 'p_sp_rank', 'p_dp_rank'].sort());
  assert.equal(body.p_star, null);
  assert.equal(body.p_ereter_star, null);
  for (const key of ['p_native_star', 'p_sp_cpi', 'p_sp_star', 'p_r_star', 'p_plays', 'p_sp_r_star', 'p_sp_r_star_model_id', 'p_sp_r_star_formula_version']) assert.equal(Object.hasOwn(body, key), false);
  const sqlPath = path.join(__dirname, '..', '..', 'ohSorryAdmin', 'sql', '33_add_sp_r_star.sql');
  assert.equal(fs.existsSync(sqlPath), true, `Required SQL source is missing: ${sqlPath}`);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  for (const column of ['star', 'ereter_star', 'dj_name', 'sp_rank', 'dp_rank']) {
    const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(sql, new RegExp(`\\b${escaped}\\s*=\\s*COALESCE\\(EXCLUDED\\.${escaped},\\s*users\\.${escaped}\\)`, 'i'),
      `${column} must preserve the existing value with COALESCE(EXCLUDED.${column}, users.${column})`);
  }
  assert.match(sql, /p_sp_r_star\s+IS\s+NULL[\s\S]*?p_sp_r_star_model_id\s+IS\s+NULL[\s\S]*?p_sp_r_star_formula_version\s+IS\s+NULL[\s\S]*?users\.sp_r_star/i,
    'all-null SP r-star tuple must preserve users.sp_r_star');
});

test('initial profile attempts users once and only radars with numeric mapped data', async (t) => {
  const cases = [
    { radar: {}, styles: [] }, { radar: null, styles: [] }, { radar: undefined, styles: [] },
    { radar: { sp: { NOTES: 1 } }, styles: [0] }, { radar: { dp: { PEAK: 1 } }, styles: [1] },
  ];
  for (const { radar, styles } of cases) {
    await t.test(String(radar), async () => {
      const calls = [];
      const db = loadDb(withUploadEnabled(async (url, options) => { calls.push({ url, options }); return response({}); }));
      assert.equal((await db.upsertInitialUserProfile({ iidx_id: '12345678', notes_radar: radar })).ok, true);
      assert.equal(calls.filter(({ url }) => /\/rpc\/upsert_user$/.test(url)).length, 1);
      assert.deepEqual(rpcCalls(calls, 'upsert_user_radar').map(({ options }) => JSON.parse(options.body).p_play_style), styles);
    });
  }
});

test('initial profile continues DP after SP HTTP failure and reports failure', async () => {
  const styles = [];
  const db = loadDb(withUploadEnabled(async (url, options) => {
    if (url.includes('/rpc/upsert_user_radar')) {
      const style = JSON.parse(options.body).p_play_style;
      styles.push(style);
      return style === 0 ? response({}, { ok: false, status: 503 }) : response({});
    }
    return response({});
  }));
  const result = await db.upsertInitialUserProfile({ iidx_id: '12345678', notes_radar: { sp: { NOTES: 1 }, dp: { PEAK: 2 } } });
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTP 503/);
  assert.deepEqual(styles, [0, 1]);
});

test('initial profile fails closed for upload disabled and invalid IDs; parent failure skips radars', async () => {
  let writes = 0;
  const db = loadDb(async (url) => {
    if (url.includes('service-status.json')) return response({ uploadEnabled: false });
    writes++;
    return response({});
  });
  assert.equal((await db.upsertInitialUserProfile({ iidx_id: '12345678' })).ok, false);
  assert.equal((await db.upsertInitialUserProfile({})).ok, false);
  assert.equal((await db.upsertInitialUserProfile({ iidx_id: '1234-abcd' })).ok, false);
  assert.equal(writes, 0);

  const calls = [];
  const failing = loadDb(withUploadEnabled(async (url, options) => {
    calls.push({ url, options });
    return url.includes('/rpc/upsert_user') ? response({}, { ok: false, status: 500 }) : response({});
  }));
  const result = await failing.upsertInitialUserProfile({ iidx_id: '12345678', notes_radar: { sp: { NOTES: 1 }, dp: { PEAK: 2 } } });
  assert.equal(result.ok, false);
  assert.equal(rpcCalls(calls, 'upsert_user_radar').length, 0);
});

test('initial users throw returns ok false; final profile still requires star_estimate', async () => {
  const calls = [];
  const db = loadDb(withUploadEnabled(async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/rpc/upsert_user')) throw new Error('users unavailable');
    return response({});
  }));
  const result = await db.upsertInitialUserProfile({ iidx_id: '12345678', notes_radar: { sp: { NOTES: 1 } } });
  assert.equal(result.ok, false);
  assert.match(result.error, /users unavailable/);
  assert.equal(rpcCalls(calls, 'upsert_user_radar').length, 0);
  assert.equal((await db.upsertUserProfile({ iidx_id: '12345678' })).ok, false);
});

test('upsert sends finite and null SP tuples intact', async () => {
  const payloads = [];
  const db = loadDb(withUploadEnabled(async (url, options) => {
    payloads.push(JSON.parse(options.body));
    return response({});
  }));
  for (const value of [3.125, null]) {
    const result = await db.upsertUserProfile({
      iidx_id: '12345678', star_estimate: null, notes_radar: {},
      sp_r_star: value, sp_r_star_model_id: MODEL_ID, sp_r_star_formula_version: FORMULA,
    });
    assert.equal(result.ok, true);
  }
  assert.deepEqual(payloads.map(({ p_sp_r_star, p_sp_r_star_model_id, p_sp_r_star_formula_version }) =>
    [p_sp_r_star, p_sp_r_star_model_id, p_sp_r_star_formula_version]), [
    [3.125, MODEL_ID, FORMULA], [null, MODEL_ID, FORMULA],
  ]);
});

test('upsert blocks partial SP tuples and non-finite values before fetch', async () => {
  let requests = 0;
  const db = loadDb(withUploadEnabled(async (url) => {
    requests++;
    return response({});
  }));
  const base = { iidx_id: '12345678', star_estimate: null, notes_radar: {} };
  const invalidPayloads = [
    { sp_r_star: 1 },
    { sp_r_star: null, sp_r_star_model_id: MODEL_ID },
    { sp_r_star: null, sp_r_star_formula_version: FORMULA },
    { sp_r_star: NaN, sp_r_star_model_id: MODEL_ID, sp_r_star_formula_version: FORMULA },
    { sp_r_star: Infinity, sp_r_star_model_id: MODEL_ID, sp_r_star_formula_version: FORMULA },
  ];
  for (const tuple of invalidPayloads) {
    const result = await db.upsertUserProfile({ ...base, ...tuple });
    assert.equal(result.ok, false);
  }
  assert.equal(requests, 0);
});

test('fetchUserStars returns all three SP columns and distinguishes lookup failure', async () => {
  const calls = [];
  let fail = false;
  const db = loadDb(async (url, options) => {
    calls.push({ url, options });
    return fail ? response({}, { ok: false, status: 503 }) : response([{
      star: 7, ereter_star: 8, r_star: 9, sp_r_star: 4.25,
      sp_r_star_model_id: MODEL_ID, sp_r_star_formula_version: FORMULA,
    }]);
  });
  const found = await db.fetchUserStars('12-345678');
  assert.deepEqual(
    [found.sp_r_star, found.sp_r_star_model_id, found.sp_r_star_formula_version],
    [4.25, MODEL_ID, FORMULA],
  );
  assert.match(calls[0].url, /select=star,ereter_star,r_star,sp_r_star,sp_r_star_model_id,sp_r_star_formula_version/);
  fail = true;
  const failed = await db.fetchUserStars('12345678');
  assert.equal(failed.ok, false);
  assert.deepEqual(
    [failed.sp_r_star, failed.sp_r_star_model_id, failed.sp_r_star_formula_version],
    [null, null, null],
  );
});

test('SP RPC rows paginate by 1000, preserve order, send body, and accept empty results', async () => {
  const calls = [];
  let allowedRequests = 3;
  const db = loadDb(async (url, options) => {
    if (--allowedRequests < 0) throw new Error('request limit exceeded');
    calls.push({ url, options });
    const offset = Number(new URL(url).searchParams.get('offset'));
    if (offset === 0) return response(Array.from({ length: 1000 }, (_, i) => ({ id: i })));
    if (offset === 1000) return response([{ id: 1000 }]);
    return response([]);
  });
  const rows = await db.fetchSpRateStarRows('12345678');
  assert.equal(rows.length, 1001);
  assert.deepEqual([rows[0].id, rows[999].id, rows[1000].id], [0, 999, 1000]);
  assert.deepEqual(calls.map(({ url }) => Number(new URL(url).searchParams.get('offset'))), [0, 1000]);
  for (const { url, options } of calls) {
    assert.match(url, /\/rpc\/make_sp_rate_star_rows\?limit=1000&offset=\d+&order=score_id\.asc/);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { p_iidx_id: '12345678' });
  }

  calls.length = 0;
  allowedRequests = 3;
  const empty = loadDb(async (url, options) => {
    calls.push({ url, options });
    return response([]);
  });
  assert.equal((await empty.fetchSpRateStarRows('12345678')).length, 0);
  assert.equal(calls.length, 1);
});

test('SP RPC throws on HTTP and non-array responses while legacy DP RPC body stays unchanged', async () => {
  const httpDb = loadDb(async () => response({}, { ok: false, status: 502 }));
  await assert.rejects(httpDb.fetchSpRateStarRows('12345678'), /HTTP 502/);
  const shapeDb = loadDb(async () => response({ rows: [] }));
  await assert.rejects(shapeDb.fetchSpRateStarRows('12345678'), /non-array/);

  const calls = [];
  const dpDb = loadDb(withUploadEnabled(async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/rpc/make_grid_data')) return response([]);
    if (url.includes('/rest/v1/users')) return response([{ star: 1, ereter_star: 1 }]);
    if (url.includes('/rpc/upsert_user')) return response({});
    return response([]);
  }));
  const recomputed = await dpDb.recomputeAndSaveStar('12345678');
  assert.equal(recomputed.ok, false); // The required legacy core scripts are intentionally absent.
  const gridCall = calls.find(({ url }) => url.includes('/rpc/make_grid_data'));
  assert.ok(gridCall);
  assert.deepEqual(JSON.parse(gridCall.options.body), { p_iidx_id: '12345678' });
  assert.match(gridCall.url, /make_grid_data\?limit=1000&offset=0$/);
});
