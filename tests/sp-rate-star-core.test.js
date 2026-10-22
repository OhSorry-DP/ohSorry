'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { test: nodeTest } = require('node:test');
const enabledTests = new Set([
  '초기 own 프로필 지연·실패에도 compute를 진행하고 rival은 별도 저장하지 않는다',
  'DP는 공식 payload와 이전 scores 조회 없이 C04 완료 신호에 맡긴다',
  'SP는 프로필 뒤 scores 성공 후 완료 신호를 한 번 보내고 공식 조회·저장을 하지 않는다',
  '기본 33·늦은 33·부분 시리즈 payload가 바뀌지 않는다',
  'SP 빈 세션·부분 점수 실패·완료 신호 실패를 구분한다',
  '단일·다중 완료 문구는 덤프 대기와 신호 재시도를 알리고 로컬값을 저장하지 않는다',
]);
function test(name, fn) { if (enabledTests.has(name)) nodeTest(name, fn); }

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
  const calls = { fetch: [], loads: [], infer: [], profile: [], initialProfile: [], warns: [], scoreUploads: [], cpiReads: 0, cpiWrites: [], spPattern: 0, order: [], doneHtml: [] };
  const db = {
    async fetchUserStars() {
      calls.order.push('fetchUserStars');
      calls.fetch.push('previous');
      if (options.previousThrow && calls.fetch.filter((x) => x === 'previous').length >= 2) throw new Error('previous lookup failed');
      if (options.previousError && calls.fetch.filter((x) => x === 'previous').length >= 2) {
        return { ok: false, star: null, ereter_star: null, r_star: null, sp_r_star: null,
          sp_r_star_model_id: null, sp_r_star_formula_version: null };
      }
      return { ok: true, star: 6, ereter_star: 7, r_star: 8,
        sp_r_star: options.prevRStar ?? 4.5,
        sp_r_star_model_id: options.prevModelId || MODEL_A,
        sp_r_star_formula_version: options.prevFormula || FORMULA };
    },
    async upsertUserProfile(payload) {
      calls.order.push('profile');
      calls.profile.push(payload);
      return { ok: true };
    },
    async upsertInitialUserProfile(payload) {
      calls.initialProfile.push(payload);
      if (options.initialProfileThrow) throw new Error('initial profile failed');
      if (options.initialProfileFail) return { ok: false, error: 'initial profile failed' };
      return { ok: true };
    },
    async upsertUserChartScores(rows) {
      calls.order.push('scores');
      calls.scoreUploads.push(rows);
      if (options.uploadError) return { ok: false, error: 'score upload failed', inserted: options.inserted || 0 };
      return { ok: true, inserted: options.inserted ?? rows.length };
    },
    async notifyUploadComplete() { calls.order.push('notify'); calls.notify = (calls.notify || 0) + 1; return options.notifyError ? { ok: false, error: 'signal failed' } : { ok: true }; },
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
    return { ok: true, charts: [{ title: 'Session only', diff: 'ANOTHER', gameLevel: 12, exScore: options.empty ? 0 : 250, lampNum: options.empty ? 0 : 5, noteCount: 100 }], pageCount: 1 };
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
    console: { log() {}, warn(...args) { calls.warns.push(args); }, error() {} },
    document: {
      getElementById() { return null; }, createElement() { return { style: {}, remove() {}, appendChild() {}, querySelector() { return null; }, querySelectorAll() { return []; } }; },
      body: { appendChild(el) { calls.doneHtml.push(el.innerHTML); } }, head: { appendChild() {} },
    },
    location: { hostname: 'p.eagate.573.jp' },
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; }, alert() {}, confirm: () => false,
    URL, Date, Map, Set, Promise, Number, String, Object, Array, Math, JSON,
    isFinite, encodeURIComponent,
  };
  vm.runInNewContext(fs.readFileSync(CORE_PATH, 'utf8'), context, { filename: CORE_PATH });
  return { core: context.window.OhsorryCore, calls, context };
}

// Execute the checked-in wrapper with mocked module loading and a controllable modal.
function createWrapperHarness(source = fs.readFileSync(path.join(__dirname, '..', 'ohsorry.js'), 'utf8'), options = {}) {
  let resolveChoice;
  const choice = new Promise((resolve) => { resolveChoice = resolve; });
  const calls = { saves: [], computes: [], fetchProfile: 0, warns: [] };
  const profile = { iidxId: '12-345678', djName: 'Wrapper DJ', spRadar: { NOTES: 1 } };
  const core = {
    async fetchProfile(opts) { calls.fetchProfile++; assert.deepEqual(JSON.parse(JSON.stringify(opts)), { isRival: false }); return profile; },
    saveInitialProfile: options.noSaveMethod ? undefined : (...args) => {
      calls.saves.push(args);
      if (options.savePromise) return options.savePromise;
      if (options.rejectSave) return Promise.reject(new Error('save rejected'));
      if (options.failSave) { calls.warns.push(['Core initial save failed']); return Promise.resolve({ ok: false }); }
      return Promise.resolve({ ok: true });
    },
    prefetch: async () => ({}),
    async compute(args) { calls.computes.push(args); return { profile }; },
    fetchRivalToken: async () => 'rival-token', showDoneList() {},
  };
  const doc = { createElement() { return { style: {}, appendChild() {}, addEventListener() {}, setAttribute() {}, remove() {}, value: '', checked: false, disabled: false }; },
    getElementById() { return null; }, body: { appendChild() {} }, head: { appendChild() {} } };
  const window = { OhsorryNorm: {}, OhsorryDb: {}, OhsorryCore: core, OhsorryEagateFetch: {} };
  const context = { window, document: doc, location: { hostname: 'p.eagate.573.jp' }, URL, Date, Promise, console: { log() {}, warn(...a) { calls.warns.push(a); }, error() {} },
    fetch: async () => ({ ok: true, text: async () => '' }), alert() {}, confirm: () => false, setTimeout(fn) { if (fn) fn(); }, clearTimeout() {} };
  // Replace modal construction with a stable test seam while retaining the production run path.
  const instrumented = source.replace('const ui = askFetchOptions();', 'const ui = { choice: __choice, fillProfile() {} };');
  const safeSource = instrumented;
  context.__choice = choice;
  // loadModule remains the real wrapper function; mocked fetch supplies a fresh script that
  // registers the already prepared module objects in the VM global.
  context.fetch = async () => ({ ok: true, text: async () => "window.OhsorryNorm={};window.OhsorryDb={};window.OhsorryCore=window.__core;window.OhsorryEagateFetch={};" });
  window.__core = core;
  vm.runInNewContext(safeSource, context, { filename: 'ohsorry.js' });
  const running = Promise.resolve();
  return { calls, core, resolveChoice, profile, run: window.__dp_run, running };
}

async function assertWrapperInitialSave(h, id = '12345678') {
  for (let i = 0; i < 12 && h.calls.fetchProfile === 0; i++) await new Promise((resolve) => setImmediate(resolve));
  for (let i = 0; i < 12 && h.calls.saves.length === 0 && h.calls.fetchProfile > 0; i++) await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.calls.saves.length, 1);
  assert.equal(h.calls.computes.length, 0);
  assert.equal(h.calls.fetchProfile, 1);
  assert.equal(h.calls.saves[0][0], h.profile);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.saves[0][1])), { isRival: false });
}

test('actual wrapper starts initial own profile save before choice for new and existing IDs', async () => {
  for (const targetId of ['12-345678', '12 345678']) {
    const h = createWrapperHarness();
    await assertWrapperInitialSave(h);
    assert.ok(h.calls.saves[0][0].iidxId.replace(/-/g, '') === '12345678');
    h.resolveChoice({ seriesList: [], playStyle: 'SP', targetId, gameVersion: '2' });
    await new Promise((r) => setImmediate(r));
  }
});

test('wrapper proceeds after initial save rejection, failure, missing hook, and rival choice', async () => {
  for (const options of [{ rejectSave: true }, { failSave: true }, { noSaveMethod: true }]) {
    const h = createWrapperHarness(undefined, options);
    if (options.noSaveMethod) {
      for (let i = 0; i < 12 && h.calls.fetchProfile === 0; i++) await new Promise((resolve) => setImmediate(resolve));
      assert.equal(h.calls.saves.length, 0);
      assert.equal(h.calls.fetchProfile, 1);
      assert.ok(h.calls.warns.length > 0);
    } else await assertWrapperInitialSave(h);
    h.resolveChoice({ seriesList: [], playStyle: 'SP', targetId: '12345678', gameVersion: '2' });
    await new Promise((r) => setImmediate(r));
    assert.equal(h.calls.computes.length, 1);
    if (options.rejectSave || options.noSaveMethod) assert.ok(h.calls.warns.length > 0);
    else assert.ok(h.calls.warns.length > 0);
  }
  const rival = createWrapperHarness();
  await assertWrapperInitialSave(rival);
  rival.resolveChoice({ seriesList: [], playStyle: 'SP', targetId: '87654321', gameVersion: '2' });
  await new Promise((r) => setImmediate(r));
  assert.equal(rival.calls.saves.length, 1);
  assert.equal(rival.calls.computes.length, 1);
});

test('wrapper compute starts while initial save remains unresolved', async () => {
  let resolveSave;
  const savePromise = new Promise((resolve) => { resolveSave = resolve; });
  const h = createWrapperHarness(undefined, { savePromise });
  await assertWrapperInitialSave(h);
  h.resolveChoice({ seriesList: [], playStyle: 'SP', targetId: '12345678', gameVersion: '2' });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.calls.computes.length, 1);
  resolveSave({ ok: true });
});

test('wrapper test assertion detects a no-op initial save mutation', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ohsorry.js'), 'utf8');
  const original = createWrapperHarness(source);
  await assertWrapperInitialSave(original);
  const mutated = source.replace(/Core\.saveInitialProfile\(ownProfile, \{ isRival: false \}\)/, 'undefined');
  const changed = createWrapperHarness(mutated);
  await assert.rejects(assertWrapperInitialSave(changed), assert.AssertionError);
});

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
    playStyle: 'SP', mode: 'own', gameVersion: options.gameVersion || '33', seriesList: options.seriesList || [1],
    profile: { djName: 'Tester', iidxId: '12-345678', spRank: '七段', spRadar: { NOTES: 3 } }, suppressDone: !!options.suppressDone,
  });
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

test('initial profile saves only the exact basic fields and normalized valid ID', async () => {
  const h = createHarness();
  const profile = { djName: 'Tester', iidxId: '12-345678', spRank: '七段', dpRank: '六段', spRadar: { NOTES: 123 },
    spStar: 9, dpStar: 8, star: 7, version: 'x', plays: 99, sp_r_star: 6 };
  await h.core.saveInitialProfile(profile);
  assert.deepEqual(Object.keys(h.calls.initialProfile[0]).sort(), ['dj_name', 'dp_rank', 'iidx_id', 'notes_radar', 'sp_rank']);
  assert.equal(h.calls.initialProfile[0].iidx_id, '12345678');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.initialProfile[0].notes_radar)), { sp: profile.spRadar });
  for (const key of ['star_estimate', 'r_star', 'native_star', 'ereter_star', 'raw_s', 'version', 'plays', 'sp_star', 'dp_star', 'sp_r_star']) {
    assert.equal(Object.hasOwn(h.calls.initialProfile[0], key), false);
  }
});

test('initial profile radar keeps only valid SP and DP objects, including an empty parent when both are invalid', async () => {
  const h = createHarness();
  const cases = [
    [{ NOTES: 1 }, {}, { sp: { NOTES: 1 } }],
    [{}, { total: 2 }, { dp: { total: 2 } }],
    [{ CHORD: 3 }, { SCRATCH: 4 }, { sp: { CHORD: 3 }, dp: { SCRATCH: 4 } }],
    [{ img: 'x' }, { NOTES: '5' }, {}],
  ];
  for (const [spRadar, dpRadar, expected] of cases) {
    await h.core.saveInitialProfile({ iidxId: '12345678', spRadar, dpRadar });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.initialProfile.map((p) => p.notes_radar))), cases.map((c) => c[2]));
});

test('initial profile skips rivals and invalid IDs without database calls', async () => {
  const h = createHarness();
  await h.core.saveInitialProfile({ iidxId: '12345678' }, { isRival: true });
  await h.core.saveInitialProfile({ iidxId: '12-34567x' });
  await h.core.saveInitialProfile({ djName: 'No ID' });
  assert.equal(h.calls.initialProfile.length, 0);
});

test('initial profile DB failures warn safely and do not block compute score upload', async () => {
  for (const options of [{ initialProfileThrow: true }, { initialProfileFail: true }, { noInitialProfileMethod: true }]) {
    const h = createHarness(options);
    if (options.noInitialProfileMethod) delete h.context.window.OhsorryDb.upsertInitialUserProfile;
    const saved = await h.core.saveInitialProfile({ iidxId: '12345678' });
    assert.equal(saved.ok, false);
    assert.equal(h.calls.warns.length, 1);

    h.core.prefetch = async () => ({
      ereterData: [{ title: 'Song 0', diff: 'ANOTHER', level: 12 }], ereterPlayers: {}, textageSongs: {},
      ratingData: { ratings: [] }, ohSorryRatings: [], spRateStar: ratingSeed, onlyOSR2eLib: null,
      userRateStarLib: require(USER_STAR_PATH), spUserRateStarLib: null, cpiData: null, spSkillLib: null,
    });
    h.context.window.OhsorryEagateFetch.collectCharts = async () => ({ ok: true, charts: [{ title: 'Song 0', diff: 'ANOTHER', gameLevel: 12, exScore: 250, lampNum: 5, noteCount: 100 }], pageCount: 1 });
    h.context.window.OhsorryDb.uploadResult = async () => ({ ok: true });
    await h.core.compute({ playStyle: 'DP', mode: 'own', gameVersion: '1', seriesList: [0], profile: { iidxId: '12345678' }, suppressDone: true });
    assert.equal(h.calls.scoreUploads.length, 0); // DP uploadResult owns score persistence.
    assert.ok(h.calls.fetch.includes('previous'));
  }
});

test('초기 own 프로필 지연·실패에도 compute를 진행하고 rival은 별도 저장하지 않는다', async () => {
  for (const options of [{ rejectSave: true }, { failSave: true }, { noSaveMethod: true }]) {
    const h = createWrapperHarness(undefined, options);
    if (options.noSaveMethod) {
      for (let i = 0; i < 12 && h.calls.fetchProfile === 0; i++) await new Promise((resolve) => setImmediate(resolve));
    } else await assertWrapperInitialSave(h);
    h.resolveChoice({ seriesList: [], playStyle: 'SP', targetId: '12345678', gameVersion: '33' });
    await new Promise((r) => setImmediate(r));
    assert.equal(h.calls.computes.length, 1);
  }
  const rival = createWrapperHarness();
  await assertWrapperInitialSave(rival);
  rival.resolveChoice({ seriesList: [], playStyle: 'SP', targetId: '87654321', gameVersion: '33' });
  await new Promise((r) => setImmediate(r));
  assert.equal(rival.calls.saves.length, 1);
  assert.equal(rival.calls.computes.length, 1);
});

test('DP는 공식 payload와 이전 scores 조회 없이 C04 완료 신호에 맡긴다', async () => {
  const h = createHarness();
  let uploaded;
  h.context.window.__ohsorryEreterCache.players['12345678'] = 12.75;
  h.context.window.OhsorryEagateFetch.collectCharts = async () => ({ ok: true, charts: [{ title: 'Session only', diff: 'ANOTHER', gameLevel: 12, exScore: 250, lampNum: 5 }], pageCount: 1 });
  h.context.window.OhsorryDb.uploadResult = async (result) => { uploaded = result; return { profile: { ok: true }, scores: { ok: true, inserted: 1 }, dump: { ok: true } }; };
  await h.core.compute({ playStyle: 'DP', mode: 'own', gameVersion: '33', seriesList: [0], profile: { iidxId: '12345678', djName: 'Tester', spRank: '七段', spRadar: { NOTES: 1 } }, suppressDone: true });
  assert.equal(uploaded.dbPayload.ereter_star, 12.75);
  assert.equal(Object.hasOwn(uploaded.dbPayload, 'star_estimate'), false);
  assert.equal(Object.hasOwn(uploaded.dbPayload, 'native_star'), false);
  assert.equal(Object.hasOwn(uploaded.dbPayload, 'r_star'), false);
  assert.deepEqual(Object.keys(uploaded.dbPayload).sort(), ['dj_name', 'dp_rank', 'ereter_star', 'iidx_id', 'notes_radar', 'sp_rank']);
  assert.equal(h.calls.fetch.length, 0);
  assert.equal(h.calls.notify || 0, 0);
});

test('SP는 프로필 뒤 scores 성공 후 완료 신호를 한 번 보내고 공식 조회·저장을 하지 않는다', async () => {
  const { calls } = await runSp();
  assert.deepEqual(calls.order, ['profile', 'scores', 'notify']);
  assert.equal(calls.notify, 1);
  assert.equal(calls.fetch.length, 0);
  assert.equal(calls.cpiReads, 0);
  assert.equal(calls.spPattern, 0);
  assert.deepEqual(Object.keys(calls.profile[0]).sort(), ['dj_name', 'dp_rank', 'iidx_id', 'notes_radar', 'sp_rank']);
  assert.equal(calls.scoreUploads[0][0].played_version, '33');
});

test('기본 33·늦은 33·부분 시리즈 payload가 바뀌지 않는다', async () => {
  const run = await runSp({ gameVersion: '33', seriesList: [0, 32] });
  assert.deepEqual(Array.from(run.calls.loads.find((x) => x.type === 'crawl').seriesList), [0, 32]);
  assert.equal(run.calls.scoreUploads[0][0].played_version, '33');
  assert.equal(run.calls.scoreUploads[0][0].title, 'Session only');
  assert.equal(run.calls.notify, 1);
});

test('SP 빈 세션·부분 점수 실패·완료 신호 실패를 구분한다', async () => {
  const empty = await runSp({ empty: true });
  assert.equal(empty.calls.notify || 0, 0);
  assert.equal(empty.result.spUploaded, null);
  const partial = await runSp({ uploadError: true, inserted: 1 });
  assert.equal(partial.calls.notify, 1);
  assert.equal(partial.result.spUploaded, null);
  assert.equal(partial.result.dump.ok, true);
  const signalFail = await runSp({ notifyError: true });
  assert.equal(signalFail.result.spUploaded, 1);
  assert.equal(signalFail.result.dump.ok, false);
  assert.equal(signalFail.result.profile.__dumpSignalError, 'signal failed');
});

test('단일·다중 완료 문구는 덤프 대기와 신호 재시도를 알리고 로컬값을 저장하지 않는다', async () => {
  const single = await runSp({ suppressDone: false, notifyError: true });
  const singleHtml = single.calls.doneHtml.find((html) => html.includes('공식값은 덤프 후 반영'));
  assert.match(singleHtml, /업로드 완료 · 공식값은 덤프 후 반영/);
  assert.match(singleHtml, /완료 신호 실패 · 재시도 필요/);
  const multi = createHarness();
  multi.core.showDoneList([{ profile: { iidxId: '12345678', djName: 'A' }, style: 'SP' }, { profile: { iidxId: '87654321', djName: 'B', __dumpSignalError: 'failed' }, style: 'DP' }]);
  const multiHtml = multi.calls.doneHtml.find((html) => html.includes('공식값은 덤프 후 반영'));
  assert.match(multiHtml, /공식값은 덤프 후 반영/);
  assert.match(multiHtml, /신호 재시도 필요/);
  assert.doesNotMatch(JSON.stringify(single.calls.profile), /star_estimate|native_star|ereter_star|sp_cpi|sp_star|sp_r_star/);
});
