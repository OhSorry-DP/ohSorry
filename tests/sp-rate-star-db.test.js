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

function loadDb(handler, uploadEnabled = true, dateParse = Date.parse, { fastDumpEnabled = false, uuidFactory } = {}) {
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
    crypto: { randomUUID: uuidFactory || (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })() },
    AbortController,
    Date: class extends Date { static parse(value) { return dateParse(value); } }, Map, Set, Promise, Number, String, BigInt, TypeError, Error,
    Object, Array, Math, JSON, isFinite, encodeURIComponent, URL, setTimeout, clearTimeout,
  };
  let source = fs.readFileSync(DB_CONN, 'utf8');
  if (fastDumpEnabled) {
    const enabledSource = source.replace('const FAST_DUMP_ENQUEUE_CRAWLER = false;', 'const FAST_DUMP_ENQUEUE_CRAWLER = true;');
    assert.notEqual(enabledSource, source, 'crawler feature gate declaration must be present');
    assert.equal((source.match(/const FAST_DUMP_ENQUEUE_CRAWLER = false;/g) || []).length, 1);
    source = enabledSource;
  }
  vm.runInNewContext(source, context, { filename: DB_CONN });
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

test('fast completion stays off by default and explicit off preserves upload behavior', async () => {
  for (const explicitOff of [false, true]) {
    let scoreCalls = 0;
    const { db, calls } = loadDb(async (url) => {
      if (url.includes('/rest/v1/songs')) return response([{ song_id: 1, title: 'Filter Song', ac: 1 }]);
      if (url.startsWith('https://data.iidx.in/hist/')) return response([]);
      if (url.endsWith('/rpc/upsert_scores')) { scoreCalls++; return response(null); }
      return response(null);
    });
    const rows = [scoreRow()];
    const result = await db.upsertUserChartScores(rows, explicitOff ? { completionSource: 'csv', fastDumpEnabled: false } : undefined);
    assert.equal(result.ok, true);
    assert.equal(result.inserted, 1);
    assert.equal(scoreCalls, 1);
    assert.equal(calls.some(({ url }) => /auth\/(issue|exchange)|dump-trigger/.test(url)), false);
  }
});

test('CSV completion is sent once after successful score chunks with same-origin credentials', async () => {
  let scoreCalls = 0;
  const { db, calls } = loadDb(async (url, options) => {
    if (url.includes('/rest/v1/songs')) return response([{ song_id: 1, title: 'Filter Song', ac: 1 }]);
    if (url.startsWith('https://data.iidx.in/hist/')) return response([]);
    if (url.endsWith('/rpc/upsert_scores')) { scoreCalls++; return response(null); }
    if (url.includes('/api/dump-trigger')) return response({ accepted: true });
    return response(null);
  });
  const result = await db.upsertUserChartScores([scoreRow()], { completionSource: 'csv', fastDumpEnabled: true });
  assert.equal(result.ok, true);
  assert.equal(scoreCalls, 1);
  const complete = calls.filter(({ url }) => url.includes('/api/dump-trigger'));
  assert.equal(complete.length, 1);
  assert.equal(complete[0].options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(complete[0].options.body), {
    source: 'csv', iidx_id: '89388691', request_id: '00000000-0000-4000-8000-000000000001',
  });
  assert.equal(rpc(calls, 'upsert_user').length, 0);
});

test('CSV completion retries uncertain response with identical UUID and body', async () => {
  const completeCalls = [];
  const { db } = loadDb(async (url, options) => {
    if (url.includes('/rest/v1/songs')) return response([{ song_id: 1, title: 'Filter Song', ac: 1 }]);
    if (url.startsWith('https://data.iidx.in/hist/')) return response([]);
    if (url.includes('/api/dump-trigger')) { completeCalls.push(options); return completeCalls.length === 1 ? Promise.reject(new Error('response lost')) : response({ accepted: true }); }
    return response(null);
  });
  const result = await db.upsertUserChartScores([scoreRow()], { completionSource: 'csv', fastDumpEnabled: true });
  assert.equal(result.ok, true);
  assert.equal(completeCalls.length, 2);
  assert.equal(completeCalls[0].body, completeCalls[1].body);
  assert.deepEqual(JSON.parse(completeCalls[0].body), JSON.parse(completeCalls[1].body));
});

test('crawler gate sends one completion after both score chunks and uploadResult adds no duplicate', async () => {
  let scoreCalls = 0;
  const { db, calls } = loadDb(async (url, options) => {
    if (url.includes('/rest/v1/songs')) {
      const offset = Number(new URL(url).searchParams.get('offset'));
      return response(Array.from({ length: Math.min(1000, 1001 - offset) }, (_, i) => ({ song_id: offset + i + 1, title: `Song ${offset + i}`, ac: 1 })));
    }
    if (url.startsWith('https://data.iidx.in/hist/')) return response([]);
    if (url.endsWith('/rpc/upsert_scores')) { scoreCalls++; return response(null); }
    if (url.endsWith('/auth/issue')) return response({ url: 'https://iidx.in/login?ticket=ticket-one' });
    if (url.endsWith('/auth/exchange')) return response({ iidx_id: '89388691', token: 'token-one' });
    if (url.includes('/api/dump-trigger')) return response({ accepted: true });
    return response(null);
  }, true, Date.parse, { fastDumpEnabled: true });
  const rows = Array.from({ length: 1001 }, (_, i) => validBulkRow(i));
  const scores = await db.upsertUserChartScores(rows);
  assert.equal(scores.ok, true);
  assert.equal(scoreCalls, 2);
  assert.equal(calls.filter(({ url }) => url.includes('/api/dump-trigger')).length, 1);
  assert.deepEqual(calls.filter(({ url }) => url.endsWith('/rpc/upsert_scores')).map(({ options }) => JSON.parse(options.body).p_rows.length), [1000, 1]);

  const upload = loadDb(async (url) => {
    if (url.includes('/rest/v1/songs')) return response([{ song_id: 1, title: 'Filter Song', ac: 1 }]);
    if (url.startsWith('https://data.iidx.in/hist/')) return response([]);
    return response(null);
  }, true, Date.parse, { fastDumpEnabled: true });
  await upload.db.uploadResult({ dbPayload: { iidx_id: '89388691' }, chartScoreRows: [scoreRow()] });
  assert.equal(upload.calls.some(({ url }) => url.includes('/api/dump-trigger')), false);
});

test('crawler failures and no-op score uploads never enqueue while existing partial notify remains', async () => {
  for (const failChunk of [1, 2]) {
    let scoreCalls = 0;
    const { db, calls } = loadDb(async (url) => {
      if (url.includes('/rest/v1/songs')) {
        const offset = Number(new URL(url).searchParams.get('offset'));
        return response(Array.from({ length: Math.min(1000, 1001 - offset) }, (_, i) => ({ song_id: offset + i + 1, title: `Song ${offset + i}`, ac: 1 })));
      }
      if (url.startsWith('https://data.iidx.in/hist/')) return response([]);
      if (url.endsWith('/rpc/upsert_scores')) return ++scoreCalls === failChunk ? response(null, { ok: false, status: 500 }) : response(null);
      return response(null);
    }, true, Date.parse, { fastDumpEnabled: true });
    const result = await db.upsertUserChartScores(Array.from({ length: 1001 }, (_, i) => validBulkRow(i)));
    assert.equal(result.ok, false);
    assert.equal(calls.some(({ url }) => url.includes('/api/dump-trigger')), false);
  }
  for (const rows of [[], [scoreRow({ ex_score: HIST_ROW[3], date: HIST_ROW[5], date_kst: HIST_ROW[6], bp: null, note_count: HIST_ROW[9] })]]) {
    const { db, calls } = loadDb(async (url) => url.includes('/rest/v1/songs') ? response([{ song_id: 100, title: 'Filter Song', ac: 1 }])
      : url.startsWith('https://data.iidx.in/hist/') ? response([HIST_ROW]) : response(null), true, Date.parse, { fastDumpEnabled: true });
    const result = await db.upsertUserChartScores(rows);
    assert.equal(result.ok, true);
    assert.equal(calls.some(({ url }) => url.includes('/api/dump-trigger')), false);
  }
  let scoreCalls = 0;
  const partial = loadDb(async (url) => {
    if (url.includes('/rest/v1/songs')) {
      const offset = Number(new URL(url).searchParams.get('offset'));
      return response(Array.from({ length: Math.min(1000, 1001 - offset) }, (_, i) => ({ song_id: offset + i + 1, title: `Song ${offset + i}`, ac: 1 })));
    }
    if (url.startsWith('https://data.iidx.in/hist/')) return response([]);
    if (url.endsWith('/rpc/upsert_scores')) return ++scoreCalls === 1 ? response(null) : response(null, { ok: false, status: 500 });
    return response(null);
  }, true, Date.parse, { fastDumpEnabled: true });
  const result = await partial.db.uploadResult({ dbPayload: { iidx_id: '89388691' }, chartScoreRows: Array.from({ length: 1001 }, (_, i) => validBulkRow(i)) });
  assert.equal(result.scores.ok, false);
  assert.equal(result.scores.inserted, 1000);
  assert.equal(result.dump.ok, true);
  assert.equal(rpc(partial.calls, 'upsert_user').length, 2);
  assert.equal(partial.calls.some(({ url }) => url.includes('/api/dump-trigger')), false);
});

test('crawler completion failures preserve score result and warn; 401 drops bearer and users get distinct request IDs', async () => {
  const outcome = async (kind) => {
    let attempts = 0;
    const { db, warnings } = loadDb(async (url, options) => {
      if (url.includes('/rest/v1/songs')) return response([{ song_id: 1, title: 'Filter Song', ac: 1 }]);
      if (url.startsWith('https://data.iidx.in/hist/')) return response([]);
      if (url.endsWith('/rpc/upsert_scores')) return response(null);
      if (url.endsWith('/auth/issue')) return response({ url: 'https://iidx.in/login?ticket=ticket' });
      if (url.endsWith('/auth/exchange')) return response({ iidx_id: '89388691', token: 'token' });
      if (url.includes('/api/dump-trigger')) {
        attempts++;
        if (kind === 'throw') throw new Error('network lost');
        if (kind === 'timeout') { options.signal.addEventListener('abort', () => {}); return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))); }
        return response(null, { ok: false, status: 503 });
      }
      return response(null);
    }, true, Date.parse, { fastDumpEnabled: true });
    const result = await db.upsertUserChartScores([scoreRow()]);
    assert.equal(result.ok, true);
    assert.ok(warnings.length > 0);
    return { result, attempts };
  };
  const off = loadDb(async (url) => url.includes('/rest/v1/songs') ? response([{ song_id: 1, title: 'Filter Song', ac: 1 }])
    : url.startsWith('https://data.iidx.in/hist/') ? response([]) : response(null));
  const baseline = await off.db.upsertUserChartScores([scoreRow()]);
  for (const kind of ['503', 'throw', 'timeout']) {
    const { result, attempts } = await outcome(kind);
    assert.deepEqual({ ...result }, { ...baseline });
    assert.equal(attempts, kind === '503' || kind === 'throw' || kind === 'timeout' ? 2 : 0);
  }

  let issues = 0; let completion = 0;
  const idTest = loadDb(async (url, options) => {
    if (url.includes('/rest/v1/songs')) return response([{ song_id: 1, title: 'Filter Song', ac: 1 }]);
    if (url.startsWith('https://data.iidx.in/hist/')) return response([]);
    if (url.endsWith('/auth/issue')) { issues++; return response({ url: `https://iidx.in/login?ticket=ticket-${issues}` }); }
    if (url.endsWith('/auth/exchange')) return response({ iidx_id: '89388691', token: 'token-' + issues });
    if (url.includes('/api/dump-trigger')) { completion++; return response(null, { ok: false, status: completion === 1 ? 401 : 200 }); }
    return response(null);
  }, true, Date.parse, { fastDumpEnabled: true });
  await idTest.db.upsertUserChartScores([scoreRow()]);
  await idTest.db.upsertUserChartScores([scoreRow()]);
  assert.equal(issues, 2);
  assert.equal(completion, 2);

  let requestNo = 0;
  const multi = loadDb(async (url, options) => {
    if (url.includes('/rest/v1/songs')) return response([{ song_id: 1, title: 'Filter Song', ac: 1 }]);
    if (url.startsWith('https://data.iidx.in/hist/')) return response([]);
    if (url.endsWith('/auth/issue')) { const id = JSON.parse(options.body); return response({ url: `https://iidx.in/login?ticket=${id.iidx_id}` }); }
    if (url.endsWith('/auth/exchange')) { const issue = multi.calls.findLast(({ url }) => url.endsWith('/auth/issue')); const id = JSON.parse(issue.options.body).iidx_id; return response({ iidx_id: id, token: 'token-' + id }); }
    if (url.includes('/api/dump-trigger')) { requestNo++; return response({ accepted: true }); }
    return response(null);
  }, true, Date.parse, { fastDumpEnabled: true, uuidFactory: () => `00000000-0000-4000-8000-${String(++requestNo).padStart(12, '0')}` });
  await multi.db.upsertUserChartScores([scoreRow(), scoreRow({ iidx_id: '12345678' })]);
  const posts = multi.calls.filter(({ url }) => url.includes('/api/dump-trigger'));
  assert.equal(posts.length, 2);
  assert.notEqual(JSON.parse(posts[0].options.body).request_id, JSON.parse(posts[1].options.body).request_id);
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
