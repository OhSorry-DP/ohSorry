'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test } = require('node:test');

const CORE_PATH = path.join(__dirname, '..', 'modules', 'calcOhsorryCore.js');
// Rating 공용 모듈 — 형제 레포 ohSorryRating(또는 OHSORRY_RATING_ROOT). worktree 에서는 환경변수로 지정한다.
const RATING_ROOT = process.env.OHSORRY_RATING_ROOT || path.join(__dirname, '..', '..', 'ohSorryRating');
const USER_STAR_PATH = path.join(RATING_ROOT, 'modules', 'userRateStar.js');
const SP_STAR_PATH = path.join(RATING_ROOT, 'modules', 'spUserRateStar.js');
for (const ratingPath of [USER_STAR_PATH, SP_STAR_PATH]) {
  if (!fs.existsSync(ratingPath)) {
    throw new Error(`Rating 모듈을 찾을 수 없습니다: ${ratingPath} — OHSORRY_RATING_ROOT 를 지정하세요`);
  }
}
const SOURCE_VERSION = 'onlyosr-v1';
const MODEL_A = 'sp-grade-irt-v1:' + 'a'.repeat(64);
const MODEL_B = 'sp-grade-irt-v1:' + 'b'.repeat(64);
const FORMULA = 'sp-u1-v1';

const ratingSeed = {
  ratings: Array.from({ length: 5 }, (_, i) => ({
    key: 'song-' + i + '|ANOTHER', title: 'Song ' + i, diff: 'ANOTHER', gameLevel: 12,
    rStarA: i < 2 ? -1 : 1, rStarAa: null, rStarAaa: null, rStarMaxm: null,
    confidenceA: 'high', confidenceAa: null, confidenceAaa: null, confidenceMaxm: null,
  })),
  scale: { anchorStage: 'a', star0: 0, star1: 1, unit: 1, bounds: [0, 20] },
    modelId: MODEL_A,
  userCalculator: { formulaVersion: FORMULA, method: 'bin50+logistic', alpha: 1.5, bounds: [0, 20] },
};

function scoreRows(count = 8) {
  return Array.from({ length: count }, (_, i) => ({
    score_id: i + 1, title: 'Song ' + (i % 5), diff: 3,
    ex_score: i < 4 ? 150 : 300, note_count: 100, played_version: 33, lamp: 5, play_style: 0,
  }));
}

function createHarness(options = {}) {
  const calls = { fetch: [], loads: [], infer: [], profile: [], scoreUploads: [], cpiReads: 0, cpiWrites: [], spPattern: 0 };
  const db = {
    async fetchUserStars() {
      calls.fetch.push('previous');
      if (options.previousError && calls.fetch.filter((x) => x === 'previous').length >= 1) throw new Error('previous lookup failed');
      return { ok: true, star: 6, ereter_star: 7, r_star: 8,
        sp_r_star: options.prevRStar ?? 4.5,
        sp_r_star_model_id: options.prevModelId || MODEL_A,
        sp_r_star_formula_version: options.prevFormula || FORMULA };
    },
    async upsertUserProfile(payload) {
      calls.profile.push(payload);
      return { ok: true };
    },
    async upsertUserChartScores(rows) {
      calls.scoreUploads.push(rows);
      return options.uploadError ? { ok: false, error: 'score upload failed' } : { ok: true };
    },
    async fetchSpChartsForStar() { calls.cpiReads++; return [{ title: 'Song 0', diff: 'ANOTHER', gameLevel: 12, lampNum: 7 }]; },
    async fetchSpRateStarRows() {
      calls.fetch.push('rows');
      if (options.rpcError) throw new Error('RPC failed');
      return options.rows || scoreRows();
    },
    async upsertSpPatternScore() { calls.spPattern++; return null; },
  };
  const cpi = { computeSpStarGuarded: () => ({ cpiInt: 42, starRounded: 3.25 }) };
  const userRateStar = require(USER_STAR_PATH);
  const realSpStar = require(SP_STAR_PATH);
  const spRateStar = {
    inferSpUserRStar(rows, seed, opts) {
      calls.infer.push({ rows, seed, opts });
      if (options.inferError) throw new Error('estimator failed');
      const result = realSpStar.inferSpUserRStar(options.fewPlays ? [] : rows, { ...seed, modelId: options.resultModelId || seed.modelId }, { ...opts, prev: options.resultModelId ? opts.prev : { ...opts.prev, rStar: options.prevRStar ?? opts.prev.rStar } });
      return options.unavailable ? { ...result, status: 'unavailable', rStar: null, rStarRaw: null, reason: 'fit_failed' } : result;
    },
  };
  const eagate = { async collectCharts({ seriesList }) {
    calls.loads.push({ type: 'crawl', seriesList });
    return { ok: true, charts: [{ title: 'Session only', diff: 'ANOTHER', gameLevel: 12, exScore: 250, lampNum: 5, noteCount: 100 }], pageCount: 1 };
  } };
  const loaderSp = options.noSpResource || options.resourceError ? null : spRateStar;
  const context = {
    __loads: calls.loads,
    window: {
      OhsorryNorm: { norm: (s) => String(s || '').toLowerCase() }, OhsorryDb: db,
      OhsorryEagateFetch: eagate,
      __ohsorryEreterCache: { charts: [{ title: 'Song 0', diff: 'ANOTHER', level: 12 }], players: {} },
      __ohsorryLibCache: { textage: Object.fromEntries(Array.from({ length: 5 }, (_, i) => ['id-' + i, { title: 'Song ' + i, levels: { SA: 12 }, notes: { SA: 100 } }])), 'ohSorry:ratingData': { data: { ratings: [], spRateStar: ratingSeed } } },
      userRateStar: null, spUserRateStar: loaderSp, onlyOSRtoEreter: null,
      cpiStar: {}, spSkillCpi: cpi,
    },
    fetch: async (url) => {
      calls.loads.push({ type: 'fetch', url: String(url) });
      if (options.resourceError && String(url).includes('spUserRateStar')) throw new Error('resource fetch failed');
      return { ok: true, async json() { return String(url).includes('ohSorryRating') ? { ratings: [], spRateStar: ratingSeed } : []; }, async text() { return ''; } };
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    console: { log() {}, warn() {}, error() {} },
    document: {
      getElementById() { return null; }, createElement() { return { style: {}, remove() {}, appendChild() {} }; },
      body: { appendChild() {} }, head: { appendChild() {} },
    },
    location: { hostname: 'p.eagate.573.jp' },
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; }, alert() {}, confirm: () => false,
    URL, Date, Map, Set, Promise, Number, String, Object, Array, Math, JSON,
    isFinite, encodeURIComponent,
  };
  vm.runInNewContext(fs.readFileSync(CORE_PATH, 'utf8'), context, { filename: CORE_PATH });
  return { core: context.window.OhsorryCore, calls, context };
}

async function runSp(options = {}) {
  const h = createHarness(options);
  h.context.window.OhsorryCore.prefetch = async () => ({
    ereterData: [{ title: 'Song 0', diff: 'ANOTHER', level: 12 }], ereterPlayers: {},
    textageSongs: Object.fromEntries(Array.from({ length: 5 }, (_, i) => ['song-' + i, { title: 'Song ' + i, levels: { SA: 12 }, notes: { SA: 100 } }])),
    ratingData: { ratings: [] }, ohSorryRatings: [], spRateStar: ratingSeed,
    onlyOSR2eLib: null, userRateStarLib: require(USER_STAR_PATH), spUserRateStarLib: spRateStar,
    cpiData: [], spSkillLib: { computeSpStarGuarded: () => ({ cpiInt: 42, starRounded: 3.25 }) },
  });
  const result = await h.core.compute({
    playStyle: 'SP', mode: 'own', gameVersion: '2', seriesList: [1],
    profile: { djName: 'Tester', iidxId: '12-345678', spRank: '七段' }, suppressDone: true,
  });
  if (options.debug) return { ...h, result };
  return { ...h, result };
}

test('core loader loads DP kernel before SP resource and passes the seed container to the real SP estimator', async () => {
  const { calls } = await runSp({ debug: true });
  const urls = calls.loads.filter((x) => x.type === 'fetch').map((x) => x.url);
  assert.ok(urls.some((u) => u.includes('userRateStar.js')));
  assert.ok(calls.infer.length === 1);
  assert.equal(calls.infer[0].seed.modelId, MODEL_A);
  assert.equal(calls.infer[0].seed.ratings.length, 5);
  assert.equal(calls.infer[0].opts.prev.modelId, MODEL_A);
  assert.equal(calls.infer[0].opts.prev.formulaVersion, FORMULA);
  assert.equal(calls.profile.some((p) => p.sp_r_star_model_id === MODEL_A), true);
});

test('partial crawl sends full database RPC rows rather than the session chart fixture', async () => {
  const { calls } = await runSp();
  assert.equal(calls.loads.find((x) => x.type === 'crawl').seriesList.length, 1);
  assert.equal(calls.scoreUploads[0].length, 1);
  assert.equal(calls.scoreUploads[0][0].title, 'Session only');
  assert.equal(calls.infer[0].rows.length, 8);
  assert.equal(calls.infer[0].rows[0].title, 'Song 0');
  assert.notEqual(calls.infer[0].rows, calls.scoreUploads[0]);
});

test('same-model previous tuple is passed and saved; another model resets it, with all tuple fields', async () => {
  const same = await runSp({ prevRStar: 19, prevModelId: MODEL_A, prevFormula: FORMULA, fewPlays: false });
  const samePayload = same.calls.profile.find((p) => Object.hasOwn(p, 'sp_r_star'));
  assert.equal(samePayload.sp_r_star, null);
  assert.deepEqual([samePayload.sp_r_star_model_id, samePayload.sp_r_star_formula_version], [MODEL_A, FORMULA]);
  assert.equal(same.calls.infer[0].opts.prev.rStar, 19);

  const changed = await runSp({ prevRStar: 19, prevModelId: MODEL_A, resultModelId: MODEL_B });
  const changedPayload = changed.calls.profile.find((p) => Object.hasOwn(p, 'sp_r_star'));
  assert.notEqual(changedPayload.sp_r_star, 19);
  assert.equal(changedPayload.sp_r_star_model_id, MODEL_B);
  assert.equal(changedPayload.sp_r_star_formula_version, FORMULA);
});

test('few plays stores null with model metadata and unavailable keeps the current tuple untouched', async () => {
  const few = await runSp({ fewPlays: true });
  const fewPayload = few.calls.profile.find((p) => Object.hasOwn(p, 'sp_r_star'));
  assert.deepEqual([fewPayload.sp_r_star, fewPayload.sp_r_star_model_id, fewPayload.sp_r_star_formula_version], [null, MODEL_A, FORMULA]);

  const unavailable = await runSp({ unavailable: true });
  assert.equal(unavailable.calls.profile.some((p) => Object.hasOwn(p, 'sp_r_star')), false);
  assert.deepEqual(unavailable.calls.profile.map((p) => [p.sp_cpi, p.sp_star]), [[null, null], [42, 3.25]]);
});

test('RPC, resource, previous lookup, and score upload errors preserve the SP r-star tuple', async () => {
  for (const options of [
    { rpcError: true }, { resourceError: true }, { noSpResource: true }, { previousError: true },
    { uploadError: true },
  ]) {
    const run = await runSp(options);
    assert.equal(run.calls.profile.some((p) => Object.hasOwn(p, 'sp_r_star')), false, JSON.stringify(options));
  }

  const calculationFailure = await runSp({ inferError: true });
  assert.equal(calculationFailure.calls.profile.some((p) => Object.hasOwn(p, 'sp_r_star')), false);
});

test('SP CPI update remains independent from r-star failures and DP still uses the existing user estimator', async () => {
  const failedSp = await runSp({ rpcError: true });
  assert.equal(failedSp.calls.cpiReads, 1);
  assert.deepEqual(failedSp.calls.profile.map((p) => [p.sp_cpi, p.sp_star]), [[null, null], [42, 3.25]]);
  assert.equal(failedSp.calls.spPattern, 1);

  const h = createHarness();
  h.context.window.OhsorryCore.prefetch = async () => ({
    ereterData: [{ title: 'Song 0', diff: 'ANOTHER', level: 12 }], ereterPlayers: {},
    textageSongs: {}, ratingData: { ratings: [] }, ohSorryRatings: [], spRateStar: ratingSeed,
    onlyOSR2eLib: null, userRateStarLib: require(USER_STAR_PATH), spUserRateStarLib: null,
    cpiData: null, spSkillLib: null,
  });
  h.context.window.OhsorryEagateFetch.collectCharts = async () => ({ ok: true, charts: [{ title: 'Song 0', diff: 'ANOTHER', gameLevel: 12, exScore: 250, lampNum: 5, noteCount: 100 }], pageCount: 1 });
  h.context.window.OhsorryDb.uploadResult = async () => ({ ok: true });
  await h.core.compute({ playStyle: 'DP', mode: 'own', gameVersion: '1', seriesList: [0], profile: { iidxId: '12345678' }, suppressDone: true });
  assert.ok(h.calls.fetch.includes('previous'));
});
