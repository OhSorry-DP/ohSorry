// ============================================================
// STEP 2: p.eagate.573.jp 도메인 어느 페이지에서나 실행 가능
// ============================================================
// 자동으로 LEVEL 12 / DP 의 difficulty.html 페이지를 fetch 합니다.
// ereter 데이터도 Gist 에서 자동으로 불러옵니다 (사전 작업 불필요).
//
// 동작:
//   1. Gist 에서 ereter JSON 데이터 fetch (localStorage 에 24시간 캐시)
//   2. difficulty.html?difficult=11&style=1&disp=1&offset=0 부터 fetch
//   3. NEXT 링크 없을 때까지 offset 증가시키며 순회
//      각 페이지 사이 3~6초 랜덤 대기 (봇 의심 회피)
//   4. 모든 곡의 클리어램프 + 차트 추출 후 ereter diff 와 매칭
//   5. ★값 추정 (사용자 실력 지표)
//   6. status.html fetch 로 프로필 정보 (DJ 이름, IIDX ID, SP/DP 단위, 쿠프로) 추출
//   7. 추천곡 계산: 안 친 곡 (NO PLAY) 중 ★값 근처 EXH 난이도의 10곡
//   8. 화면에 프로필 카드 + ★값 + 추천곡 표시
//
// 다른 레벨/스타일을 보고 싶으면 코드 안의 difficult/style 값 변경
// 딜레이 조정: DELAY_MIN_MS / DELAY_MAX_MS 변수 변경
//   기본: 600~1800ms (12레벨 8페이지면 총 약 5~14초)
// ============================================================
//
// [DB 모드] window.__dp_render(dbData) 로 호출하면 eagate fetch 없이
//   supabase user_profiles row (dbData) 로 바로 렌더 → 아무 사이트에서나 사용 가능.
//   dbData 없이 호출 (또는 eagate 도메인 자동 실행) 하면 기존 eagate fetch 모드.
//   dbData 형식: { iidx_id, dj_name, sp_rank, dp_rank, charts_json, notes_radar, ... }
// ============================================================

// calcOhsorryCore — 오소리 본체 / 라이벌오소리 wrapper 가 공통으로 사용하는 핵심 모듈.
// opts:
//   mode: 'own' | 'rival'  (기본 'own')
//   dbData: supabase row (없으면 eagate fetch 모드)
//   rivalToken: rival 모드 시 URL 의 rival 토큰 (옵션 — 본인 모드는 무시)
//   wrapperVersion: wrapper 자기 버전 (예: 'v3.3.6') — supabase version 컬럼은
//                   `${wrapperVersion}-core${CORE_VERSION_SHORT}` 조합 (예: 'v3.3.6-core335')
window.OhsorryCore = {
  VERSION: '0.0.367',
  compute: async (opts) => {
  opts = opts || {};
  const mode = opts.mode || 'own';
  const isRival = mode === 'rival';
  let dbData = opts.dbData || null;
  const rivalToken = opts.rivalToken || null;
  const wrapperVersion = opts.wrapperVersion || 'unknown';
  const CORE_VERSION_SHORT = '0.0.370'.replace(/^0\.0\./, '');  // '346'
  const dbVersionString = `${wrapperVersion}-core${CORE_VERSION_SHORT}`;
  dbData = dbData || null;
  // -------- 0. ereter 데이터 로드 (Gist 에서 자동 fetch) --------
  // ereter.net 데이터는 Gist 에 ereter-data.json 으로 올려둔 걸 가져옵니다.
  // 형식: { extractedAt: "ISO 일시", source, count, charts: [...] }
  //       또는 옛 형식 [{...}, ...] (호환성 유지)
  // 한 번 받으면 24시간 동안 localStorage 에 캐시됨
  // 강제로 새로 받고 싶으면: localStorage.removeItem('ereter_dp_diff_v4'); 후 재실행
  const ERETER_DATA_URL = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/ereter-data.json';
  // zasa.sakura.ne.jp 의 비공식 ☆12 난이도표 — ereter 미등록 차트 검증용 (보충).
  // 추천곡 / ★값 추정에는 사용 X. "★ 단위별 클리어 램프 표" 의 곡 수 보강만.
  const ZASA_DATA_URL = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/zasa-data.json';
  // textage 채보 메타 — 채보별 총 노트 수 (notes.DN/DH/DA/DX). noteCount 보강 + missCount 계산용.
  const TEXTAGE_DATA_URL = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/textage-meta.json';
  const CACHE_KEY = 'ereter_dp_diff_v4';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 24시간

  // 형식 정규화:
  //   옛 형식: [{...}, ...]  (배열)
  //   v1 형식: { extractedAt, charts: [...] }
  //   v2 형식 (현재): { extractedAt, charts: [...], players: { iidxId: ★ } }
  const normalizePayload = (raw) => {
    if (Array.isArray(raw)) {
      return { charts: raw, extractedAt: null, players: null };
    }
    if (raw && typeof raw === 'object' && Array.isArray(raw.charts)) {
      return {
        charts: raw.charts,
        extractedAt: raw.extractedAt || null,
        players: raw.players && typeof raw.players === 'object' ? raw.players : null,
      };
    }
    return { charts: null, extractedAt: null, players: null };
  };

  let ereterData = null;
  let ereterExtractedAt = null;
  let ereterPlayers = null;  // { iidxId: ★ } 매핑 (있으면)

  // 캐시 확인 + 원격 extractedAt 비교
  let cachedExtractedAt = null;
  let cachedData = null;
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (stored) {
      const cached = JSON.parse(stored);
      if (cached && cached.ts && (Date.now() - cached.ts < CACHE_TTL_MS) && Array.isArray(cached.data)) {
        cachedData = cached.data;
        cachedExtractedAt = cached.extractedAt || null;
      }
    }
  } catch {}

  // 항상 Gist 의 최신 extractedAt 빠르게 확인 (HEAD 같은 거 안 됨, GET 짧게)
  // 다행히 ereter-data.json 가 그렇게 크지 않으니 fetch 하면서 compare
  // batch (라이벌 다수) 처리 시 두 번째부터 ereter fetch 도 skip — 메모리 캐시
  if (window.__ohsorryEreterCache) {
    ereterData = window.__ohsorryEreterCache.charts;
    ereterExtractedAt = window.__ohsorryEreterCache.extractedAt;
    ereterPlayers = window.__ohsorryEreterCache.players;
    console.log(`[step2] ereter 메모리 캐시 hit (${ereterData.length}개)`);
  } else {
  console.log('[step2] ereter 데이터 fetch 중...');
  try {
    const url = ERETER_DATA_URL + '?t=' + Date.now();  // CDN 캐시 우회
    const res = await fetch(url, { cache: 'no-store' });  // 브라우저 캐시도 우회
    if (!res.ok) {
      alert(
        `ereter 데이터를 못 가져왔어요 (HTTP ${res.status}).\n` +
        `Gist URL 확인이 필요합니다:\n${ERETER_DATA_URL}`
      );
      return;
    }
    const raw = await res.json();
    const payloadNorm = normalizePayload(raw);
    if (!payloadNorm.charts || payloadNorm.charts.length === 0) {
      alert('ereter 데이터가 비어있거나 형식이 잘못됐어요.');
      return;
    }
    ereterData = payloadNorm.charts;
    ereterExtractedAt = payloadNorm.extractedAt;
    ereterPlayers = payloadNorm.players;
    if (ereterPlayers) {
      console.log(`[step2] ereter players ★ 매핑: ${Object.keys(ereterPlayers).length}명`);
    }

    // 캐시랑 비교 - 같으면 캐시 그대로 사용한 셈, 다르면 새 데이터
    if (cachedExtractedAt && cachedExtractedAt === ereterExtractedAt) {
      const ageHr = ((Date.now() - JSON.parse(localStorage.getItem(CACHE_KEY) || '{}').ts) / 3600000).toFixed(1);
      console.log(`[step2] ereter 데이터 동일 (캐시와 같음, 캐시 ${ageHr}시간 전)`);
      if (ereterExtractedAt) console.log(`         원본 추출일시: ${ereterExtractedAt}`);
    } else {
      // 새 데이터 → 캐시 갱신 (players 도 포함)
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          ts: Date.now(),
          data: ereterData,
          extractedAt: ereterExtractedAt,
          players: ereterPlayers,
        }));
      } catch {}
      if (cachedExtractedAt) {
        console.log(`[step2] ereter 데이터 갱신됨! (${cachedExtractedAt} → ${ereterExtractedAt})`);
      } else {
        console.log(`[step2] ereter 데이터 ${ereterData.length}개 fetch 완료, 캐시함`);
        if (ereterExtractedAt) console.log(`         원본 추출일시: ${ereterExtractedAt}`);
      }
    }
  } catch (e) {
    console.error('[step2] ereter fetch 실패:', e);
    alert(`ereter 데이터 fetch 실패: ${e.message}\n네트워크 또는 CSP 문제일 수 있습니다.`);
    return;
  }
  // 메모리 캐시 저장 — 다음 compute 호출 시 fetch skip
  window.__ohsorryEreterCache = { charts: ereterData, extractedAt: ereterExtractedAt, players: ereterPlayers };
  }
  console.log(`[step2] ereter 차트 ${ereterData.length}개 로드`);

  // 모듈 lifetime memory cache — batch (라이벌 다수) 처리 시 두 번째 호출부터 외부 lib fetch skip.
  // 페이지 reload 시 다시 받음 (localStorage 캐시는 24h TTL 별도로 동작).
  window.__ohsorryLibCache = window.__ohsorryLibCache || {};

  // -------- 0.5. zasa 보충 데이터 fetch (선택, 실패해도 무시) --------
  // ereter 에 없는 ☆12 차트를 검증용으로 보충. 추천 / ★ 추정엔 사용 X.
  let zasaData = [];
  if (window.__ohsorryLibCache.zasa) {
    zasaData = window.__ohsorryLibCache.zasa;
    console.log(`[step2] zasa 보충 차트 ${zasaData.length}개 (memory cache hit)`);
  } else {
    try {
      const res = await fetch(ZASA_DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const raw = await res.json();
        if (raw && Array.isArray(raw.charts)) {
          zasaData = raw.charts;
          window.__ohsorryLibCache.zasa = zasaData;
          console.log(`[step2] zasa 보충 차트 ${zasaData.length}개 로드`);
        }
      }
    } catch (e) {
      console.warn('[step2] zasa fetch 실패 (무시 가능):', e.message);
    }
  }

  // -------- 0.55. textage 채보 메타 fetch (선택, 실패해도 무시) --------
  // 채보별 총 노트 수 → charts 의 noteCount 보강 + missCount 계산 (noteCount - pgreat - great).
  let textageSongs = null;
  if (window.__ohsorryLibCache.textage) {
    textageSongs = window.__ohsorryLibCache.textage;
    console.log(`[step2] textage 채보 메타 ${Object.keys(textageSongs).length}곡 (memory cache hit)`);
  } else try {
    const res = await fetch(TEXTAGE_DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) {
      const raw = await res.json();
      if (raw && raw.songs && typeof raw.songs === 'object') {
        textageSongs = raw.songs;
        window.__ohsorryLibCache.textage = textageSongs;
        console.log(`[step2] textage 채보 메타 ${Object.keys(textageSongs).length}곡 로드`);
      }
    }
  } catch (e) {
    console.warn('[step2] textage fetch 실패 (무시 가능):', e.message);
  }

  // -------- 0.6. ohSorryRating 데이터 + 외부 ★ 추정 lib fetch (localStorage 캐시) --------
  // v3.3.4: user ★ 추정 로직을 외부 lib 으로 분리. 본체는 fetch + ensemble (oldOSR + OSR) / 2 만.
  //   fetch 실패 시 localStorage 캐시 사용. 캐시도 없으면 ohSorry 동작 불가 (에러 표시).
  const GIST_RAW = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw';
  const OHSORRY_RATING_URL = GIST_RAW + '/ohSorryRating.json';
  const CALC_OLD_OSR_URL = GIST_RAW + '/oldOSR.js';
  const CALC_OSR_URL = GIST_RAW + '/osr.js';
  // v3.3.5: OSR13.5+ (bin50 + 50% 임계 + 상향 bin 부분 보너스) — 13.5 이상 시 ensemble 오버라이드
  const CALC_OSR135_URL = GIST_RAW + '/OSR13.5%2B.js';
  // v3.3.7: adopt.js — v335E 채택 분기 (세 lib raw 값 → 최종 ★) 통합 lib
  const CALC_ADOPT_URL = GIST_RAW + '/adopt.js';
  // ohsorryShelf.js — renderChartRow (추천곡 곡명 클릭 토스트용). 실패해도 무시.
  const CALC_SHELF_URL = GIST_RAW + '/ohsorryShelf.js';
  // 패턴 분석 — 유저 약점/강점 9 feature 벡터 + 차트별 강점 매치 점수 (추천 정렬 가중치).
  //   patterns-all-slim.json: 2348 차트 × 9 feature pt (DP 1P/2P 분리).
  //   calcWeakness.js: 유저 차트 점수 + patterns → 약점/강점 벡터 + chartStrengthMatch helper.
  //   추천에 영향 — sample15 정렬을 강점 매치 desc 로 (기존 count desc 대신).
  const PATTERNS_URL = GIST_RAW + '/patterns-all-slim.json';
  // feature-scores-slim.json — 차트별 28 feature quantile score (0~100). 약점보완 bin 평균 비교 + top 3 feature 분류용.
  const FEATURE_SCORES_URL = GIST_RAW + '/feature-scores-slim.json';
  const CALC_WEAKNESS_URL = GIST_RAW + '/calcWeakness.js';
  // rate-reference-slim.json — 3550명 ereter-fetched 평균 EX rate (estEc/Hc/Exh × 0.5 bucket, isotonic monotonic).
  //   calcWeakness 에 rateRef 전달 시 absolute reference 기준 잔차 분석 → 사용자간 vec 직접 비교 가능.
  const RATE_REF_URL = GIST_RAW + '/rate-reference-slim.json';

  // 외부 lib 메모리 캐시 (페이지 lifetime 유지) — batch (라이벌 다수) 처리 시 두 번째부터 fetch skip
  if (!window.__ohsorryLibCache) window.__ohsorryLibCache = {};

  // localStorage 캐시 헬퍼 — memory > network fetch > localStorage 순으로 fallback
  const loadWithCache = async (url, cacheKey, isJson) => {
    // memory cache 우선 — batch (라이벌 다수) 처리 시 두 번째 호출부터 fetch skip
    if (window.__ohsorryLibCache[cacheKey]) {
      return window.__ohsorryLibCache[cacheKey];
    }
    try {
      const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = isJson ? await res.json() : await res.text();
      try {
        localStorage.setItem(cacheKey, isJson ? JSON.stringify(data) : data);
        localStorage.setItem(cacheKey + ':ts', new Date().toISOString());
      } catch {}
      const result = { data, source: 'fetch' };
      window.__ohsorryLibCache[cacheKey] = result;
      return result;
    } catch (e) {
      const cached = localStorage.getItem(cacheKey);
      if (cached != null) {
        const ts = localStorage.getItem(cacheKey + ':ts') || '시간 불명';
        console.warn(`[step2] ${cacheKey} fetch 실패 (${e.message}) → localStorage 캐시 사용 (${ts})`);
        const result = { data: isJson ? JSON.parse(cached) : cached, source: 'cache' };
        window.__ohsorryLibCache[cacheKey] = result;
        return result;
      }
      throw new Error(`${cacheKey}: fetch 실패 + 캐시 없음 — ${e.message}`);
    }
  };

  // ohSorryRating.json — chart 별 EC/HC/EXH 추정값 (v0.0.2)
  let ohSorryRatings = [], ratingData = null;
  try {
    const { data, source } = await loadWithCache(OHSORRY_RATING_URL, 'ohSorry:ratingData', true);
    ratingData = data;
    if (data && Array.isArray(data.ratings)) {
      ohSorryRatings = data.ratings;
      console.log(`[step2] ohSorryRating ${ohSorryRatings.length}곡 로드 (${source})`);
    }
  } catch (e) {
    console.error('[step2] ohSorryRating 로드 실패:', e.message);
  }

  // oldOSR.js (v3.3.3 모델) + osr.js (v0.0.2 모델) + OSR13.5+.js + adopt.js lib fetch + eval
  //   eval 은 UMD wrapper 라 window.oldOSR / window.ohSorryRating / window.OSR135 / window.adopt 글로벌 등록
  // v3.3.8: DB 모드 (dbData 있음 = ohSorryWeb 게스트 페이지 / INF) 일 때는 fetch 자체 skip.
  //   ★ 추정은 dbData.star_estimate 를 그대로 사용하므로 4 lib (oldOSR / osr / OSR13.5+ / adopt) 다 필요 없음.
  //   ohSorryWeb 게스트 페이지 진입 시 그만큼 다운로드 절감 + lib eval 비용 절감.
  let oldOSR = null, ohSorryRatingLib = null, osr135Lib = null, shelfLib = null;
  let adoptLib = null;
  if (!dbData) {
    try {
      const { data: oldOSRSrc, source: oldSrc } = await loadWithCache(CALC_OLD_OSR_URL, 'ohSorry:libOldOSR', false);
      // UMD 가 window 에 등록 — IIFE 실행
      (new Function(oldOSRSrc))();
      oldOSR = window.oldOSR;
      if (!oldOSR) throw new Error('oldOSR global 등록 실패');
      console.log(`[step2] oldOSR.js v${oldOSR.version} 로드 (${oldSrc})`);
    } catch (e) {
      console.error('[step2] oldOSR.js 로드 실패:', e.message);
    }
    try {
      const { data: osrSrc, source: newSrc } = await loadWithCache(CALC_OSR_URL, 'ohSorry:libOSR', false);
      (new Function(osrSrc))();
      ohSorryRatingLib = window.ohSorryRating;
      if (!ohSorryRatingLib) throw new Error('ohSorryRating global 등록 실패');
      console.log(`[step2] osr.js 로드 (${newSrc})`);
    } catch (e) {
      console.error('[step2] osr.js 로드 실패:', e.message);
    }
    // v3.3.5: OSR13.5+ lib (13.5 이상 ★ 정확도 ↑)
    try {
      const { data: osr135Src, source: src135 } = await loadWithCache(CALC_OSR135_URL, 'ohSorry:libOSR135', false);
      (new Function(osr135Src))();
      osr135Lib = window.OSR135;
      if (!osr135Lib) throw new Error('OSR135 global 등록 실패');
      console.log(`[step2] OSR13.5+.js v${osr135Lib.version} 로드 (${src135})`);
    } catch (e) {
      console.error('[step2] OSR13.5+.js 로드 실패:', e.message);
    }
    // v3.3.7: adopt.js — v335E 채택 분기 통합 lib (세 lib raw → 최종 ★)
    try {
      const { data: adoptSrc, source: srcAdopt } = await loadWithCache(CALC_ADOPT_URL, 'ohSorry:libAdopt', false);
      (new Function(adoptSrc))();
      adoptLib = window.adopt;
      if (!adoptLib) throw new Error('adopt global 등록 실패');
      console.log(`[step2] adopt.js v${adoptLib.version} 로드 (${srcAdopt})`);
    } catch (e) {
      console.error('[step2] adopt.js 로드 실패:', e.message, '— 본체 inline 분기 fallback');
    }
  } else {
    console.log('[step2] DB 모드 — ★ 추정 lib 4종 (oldOSR / osr / OSR13.5+ / adopt) fetch skip');
  }
  // ohsorryShelf.js — 추천곡 곡명 클릭 토스트 (renderChartRow) 용. 실패해도 무시 (토스트만 비활성).
  try {
    const { data: shelfSrc, source: shelfSrcType } = await loadWithCache(CALC_SHELF_URL, 'ohSorry:libShelf', false);
    (new Function(shelfSrc))();
    shelfLib = window.OhSorryShelf;
    if (shelfLib) {
      shelfLib.injectStyle();
      console.log(`[step2] ohsorryShelf.js v${shelfLib.version} 로드 (${shelfSrcType})`);
    }
  } catch (e) {
    console.warn('[step2] ohsorryShelf.js 로드 실패 (무시 가능):', e.message);
  }

  // 패턴 데이터 + weakness 모듈 fetch (실패 시 추천 가중치 없이 진행, 기존 정렬 fallback)
  let patternsMap = null, weaknessLib = null, rateRefData = null, featureScoresMap = null;
  try {
    const { data: pData, source: pSrc } = await loadWithCache(PATTERNS_URL, 'ohSorry:patterns', true);
    patternsMap = pData;
    console.log(`[step2] patterns-all-slim.json ${Object.keys(patternsMap).length}곡 로드 (${pSrc})`);
  } catch (e) {
    console.warn('[step2] patterns-all-slim.json 로드 실패 (가중치 비활성):', e.message);
  }
  // feature-scores-slim.json — 약점보완 bin 평균 + top 3 feature 분류용. 실패해도 다른 기능 영향 없음.
  try {
    const { data: fsData, source: fsSrc } = await loadWithCache(FEATURE_SCORES_URL, 'ohSorry:featureScores', true);
    featureScoresMap = fsData;
    const cnt = (fsData && fsData.scores) ? Object.keys(fsData.scores).length : 0;
    console.log(`[step2] feature-scores-slim.json ${cnt}곡 로드 (${fsSrc})`);
  } catch (e) {
    console.warn('[step2] feature-scores-slim.json 로드 실패 (약점보완 새 알고리즘 비활성):', e.message);
  }
  try {
    const { data: wSrc, source: wSrcType } = await loadWithCache(CALC_WEAKNESS_URL, 'ohSorry:libWeakness', false);
    (new Function(wSrc))();
    weaknessLib = window.OhsorryWeakness;
    if (!weaknessLib) throw new Error('OhsorryWeakness global 등록 실패');
    console.log(`[step2] calcWeakness.js 로드 (${wSrcType})`);
  } catch (e) {
    console.warn('[step2] calcWeakness.js 로드 실패 (가중치 비활성):', e.message);
  }
  // rate-reference — calcWeakness 의 absolute 잔차 분석용. 실패해도 self-relative 모드로 fallback.
  try {
    const { data: rrData, source: rrSrc } = await loadWithCache(RATE_REF_URL, 'ohSorry:rateRef', true);
    rateRefData = rrData;
    console.log(`[step2] rate-reference-slim.json 로드 (${rrSrc})`);
  } catch (e) {
    console.warn('[step2] rate-reference-slim.json 로드 실패 (self-relative fallback):', e.message);
  }

  // -------- 1. 곡명 정규화 + 인덱싱 --------
  const norm = (s) => (s || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[~∼〜～]/g, '~')
    .replace(/[!！]/g, '!')
    .replace(/[?？]/g, '?')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    // 더블 쿼터 종류 → ASCII " (좌우 / 일본식 / 독일)
    .replace(/[“”„‟〝〞〟]/g, '"')
    // 싱글 쿼터 종류 → ASCII ' (좌우 / backtick / acute / modifier)
    .replace(/[‘’‚‛`´ʼˈˊˋ]/g, "'")
    // 라틴 확장
    .replace(/ƒ/g, 'f')
    .replace(/[Øø]/g, 'o')
    .replace(/[Ææ]/g, 'a')
    .replace(/ə/g, 'e')
    .replace(/[Œœ]/g, 'oe')
    .replace(/ß/g, 'ss')
    // 키릴 → ASCII (homoglyph 케이스)
    .replace(/[Ии]/g, 'n')
    .replace(/[Аа]/g, 'a')
    .replace(/[Ее]/g, 'e')
    .replace(/[Кк]/g, 'k')
    .replace(/[Мм]/g, 'm')
    .replace(/[Оо]/g, 'o')
    .replace(/[Рр]/g, 'p')
    .replace(/[Сс]/g, 'c')
    .replace(/[Тт]/g, 't')
    .replace(/[Хх]/g, 'x')
    // 대시 변종 → ASCII '-' (가타카나 장음 ー U+30FC 는 제외)
    .replace(/[—–‐‑−]/g, '-')
    // 장식 기호 / 음악 / 수학 기호 제거
    .replace(/[♠-♯]/g, '')
    .replace(/[†‡]/g, '')
    .replace(/[→←↑↓]/g, '')
    .replace(/[※⁂]/g, '')
    .replace(/[★☆]/g, '')
    .replace(/[∫∮∂∇∈∞]/g, '')
    // diacritic 분해 후 라틴 결합 마크만 제거 (Ü → u, ê → e). 일본어 탁점은 보존.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFKC');

  const ereterMap = new Map();
  for (const c of ereterData) {
    if (!c.title || !c.diff) continue;
    ereterMap.set(norm(c.title) + '|' + c.diff, c);
  }

  // zasa 차트 인덱스 (ereter 와 같은 키 형식)
  const zasaMap = new Map();
  for (const c of zasaData) {
    if (!c.title || !c.diff) continue;
    zasaMap.set(norm(c.title) + '|' + c.diff, c);
  }
  // ohSorry 추정 차트 인덱스 (ereter 와 같은 키 형식, ec/hc 만 — exh 추정 X)
  // ★ 추정 모델 (fitData) 의 fallback 으로만 사용. 다른 로직 영향 X.
  const ratingMap = new Map();
  for (const r of ohSorryRatings) {
    if (!r.title || !r.diff) continue;
    if (typeof r.estEc !== 'number' && typeof r.estHc !== 'number') continue;
    ratingMap.set(norm(r.title) + '|' + r.diff, r);
  }

  // gameLevel 별 zasaLevel 평균 — 차트에 zasa 가 없을 때 fallback (★ 거리 감쇠용).
  //   ohSorryRatings (lv11/12) + zasaData (lv1~10 등) 합쳐서 산출.
  const zasaAvgByGameLv = (() => {
    const sum = {}, cnt = {};
    for (const r of ohSorryRatings || []) {
      if (typeof r.zasaLevel === 'number' && typeof r.gameLevel === 'number') {
        sum[r.gameLevel] = (sum[r.gameLevel] || 0) + r.zasaLevel;
        cnt[r.gameLevel] = (cnt[r.gameLevel] || 0) + 1;
      }
    }
    for (const z of zasaData || []) {
      if (typeof z.level === 'number' && typeof z.gameLevel === 'number') {
        sum[z.gameLevel] = (sum[z.gameLevel] || 0) + z.level;
        cnt[z.gameLevel] = (cnt[z.gameLevel] || 0) + 1;
      }
    }
    const out = {};
    for (const lv in sum) out[lv] = sum[lv] / cnt[lv];
    return out;
  })();
  // ★ 거리 감쇠 weight — 약점보완 (buildWeaknessRecs) cutoff 용. EC/HC/EXH 클리어 추천은 풀 자체가 좁아져 미사용.
  //   W = STAR_DISTANCE_W (3). chart★ 가 baseStar±W 안이면 1→0 선형, 밖이면 0 (정렬에서 제외).
  //   baseStar 또는 chart★ 정보 없으면 1 (감쇠 없음).
  const STAR_DISTANCE_W = 3;
  const starDistanceWeight = (star, baseStar) => {
    if (star == null || baseStar == null) return 1;
    return Math.max(0, 1 - Math.abs(star - baseStar) / STAR_DISTANCE_W);
  };

  // ereter 에 없는 zasa 전용 차트 (★ 단위별 표의 곡 수 보강용)
  const zasaSupplemental = zasaData.filter((c) => {
    const k = norm(c.title) + '|' + c.diff;
    return !ereterMap.has(k);
  });
  if (zasaSupplemental.length > 0) {
    console.log(`[step2] zasa 보충 (ereter 미등록): ${zasaSupplemental.length}곡`);
  }

  // -------- 2. 대상 페이지 설정 (수집 모드: level / series) --------
  // p.eagate.573.jp 도메인 안 어느 페이지에서나 실행 가능.
  // 수집 모드 (opts.fetchMode):
  //   'level'  (기본) : difficulty.html 의 레벨별 페이지 fetch.
  //                     opts.levels (게임레벨 배열, 예: [12,11]) — 없으면 [12,11].
  //                     difficult 파라미터 = 게임레벨 - 1 (0-indexed, 11=LEVEL 12).
  //                     style 0=SP / 1=DP.
  //   'series' : series.html 에 list=0..32 POST → 시리즈 폴더 전곡 + 클리어램프 + 점수.
  //              한 곡 row 에 BEGINNER~LEGGENDARIA 5개 차트. getAcSongList.js 와 동일 방식.
  // opts 를 안 주면 (rival wrapper / DB 모드 등) 'level' + [12,11] — 기존 동작 그대로.
  //
  // LEVEL 11 도 가져오는 이유: zasa★ 11.6~12.1 인 어려운 lv11 차트의 lamp 데이터를
  //                          ohSorryRating fallback 으로 ★ 추정 / EC·HC 추천에 활용.
  const fetchMode = opts.fetchMode === 'series' ? 'series' : 'level';
  const SERIES = '33';            // 현재 시즌 (Sparkle Shower)
  const style = '1';              // DP
  const disp = '1';
  // level 모드 — 가져올 게임레벨 목록 (1~12 만 허용, 내림차순 정렬, 중복 제거).
  //   eagateFetch.collectCharts 가 ctx.levels 로 받아 자체적으로 LEVELS_TO_FETCH / URL 빌드.
  //   core 는 fetchMode 만 유지 (이후 4.6 단계에서 series 모드 유령 차트 제거 분기에 사용).
  const requestedLevels = (Array.isArray(opts.levels) && opts.levels.length > 0)
    ? [...new Set(opts.levels.map(Number).filter((n) => n >= 1 && n <= 12))].sort((a, b) => b - a)
    : [12, 11];

  // 도메인 체크 (잘못된 사이트에서 실행하면 의미 없으니 안내).
  // DB 모드 (dbData 있음) 에서는 eagate fetch 를 안 하므로 도메인 체크 스킵 → 그대로 진행.
  // dbData 없음 + 다른 도메인 → "p.eagate.573.jp 로 이동할까요?" 토스트 + return (render 가 있으면 사용).
  if (!dbData && !location.hostname.endsWith('p.eagate.573.jp')) {
    const msg = isRival
      ? '라이벌 오소리는 p.eagate.573.jp 의 라이벌 페이지에서 실행해야 합니다. 이동할까요?'
      : 'p.eagate.573.jp 에서 실행해야 결과를 볼 수 있어요. 이동할까요?';
    const targetUrl = 'https://p.eagate.573.jp/';
    if (window.OhsorryRender && window.OhsorryRender.confirmRedirect) {
      window.OhsorryRender.confirmRedirect(msg, targetUrl);
    } else {
      // render 모듈이 안 떠있는 fallback — 기본 alert
      if (window.confirm(msg)) location.href = targetUrl;
    }
    return;
  }

  // -------- 3. eagate 페이지 파싱은 modules/eagateFetch.js (v0.0.1+) 로 분리 --------
  //   parseDoc (difficulty.html level 모드) + parseSeriesDoc (series.html series 모드)
  //   둘 다 eagateFetch 모듈 안의 private 함수. core 는 결과 차트 배열만 받음.

  // -------- 4. allCharts / pageCount — eagateFetch 결과 보관, DB 모드는 charts_json 으로 직접 --------
  let allCharts = [];
  let pageCount = 0;

  // DB 모드 — charts_json 으로 allCharts 를 바로 채우고 아래 eagate fetch 블록은 전부 스킵.
  // deep copy — 외부 lib / 본체가 차트 객체를 in-place 가공하므로 호출자 원본 (서열표 등) 오염 방지.
  if (dbData) {
    allCharts = Array.isArray(dbData.charts_json) ? JSON.parse(JSON.stringify(dbData.charts_json)) : [];
    console.log(`[오소리] DB 모드 — charts_json ${allCharts.length}곡 (eagate fetch 스킵)`);
    if (allCharts.length === 0) {
      alert('DB 데이터에 charts_json 이 없습니다.');
      return;
    }
  }

  // 진행 상황을 화면에 표시 (긴 대기 시간 동안 사용자가 진행도 볼 수 있게) — eagate 모드만
  if (!dbData) {
  document.getElementById('__dp_progress')?.remove();
  const progress = document.createElement('div');
  progress.id = '__dp_progress';
  progress.style.cssText = `
    position: fixed; top: 16px; right: 16px; z-index: 999999;
    width: 360px; background: #fff; color: #222;
    font-family: -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif;
    font-size: 13px; line-height: 1.5;
    border: 1px solid #ccc; border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0,0,0,.18); padding: 14px 16px;
  `;
  progress.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px">DP 점수 계산 중...</div>
    <div id="__dp_progress_text" style="font-size:12px;color:#666">시작합니다</div>
    <div style="background:#eee;height:6px;border-radius:3px;margin-top:8px;overflow:hidden">
      <div id="__dp_progress_bar" style="background:#1d9e75;height:100%;width:0%;transition:width .3s"></div>
    </div>
  `;
  document.body.appendChild(progress);
  }
  const updateProgress = (text, pct) => {
    const t = document.getElementById('__dp_progress_text');
    const b = document.getElementById('__dp_progress_bar');
    if (t) t.textContent = text;
    if (b) b.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  };

  // 수집 실행 — eagateFetch 모듈에 위임 (v3.3.8+, modules/eagateFetch.js v0.0.1+).
  // 이전 in-place 구현 (fetchOneLevel + collectByLevel + collectBySeries + parseDoc + parseSeriesDoc 약 400줄) 을
  // 모듈로 분리. closure mutate 대신 { ok, charts, pageCount } return 형태. wrapper 가 dbData 없을 때만 모듈 로드.
  if (!dbData) {
    if (!window.OhsorryEagateFetch || !window.OhsorryEagateFetch.collectCharts) {
      alert('eagateFetch 모듈이 로드되지 않았어요. 페이지 새로고침 후 재시도해주세요.');
      return;
    }
    const r = await window.OhsorryEagateFetch.collectCharts({
      fetchMode,
      levels: requestedLevels,
      series: SERIES,
      style, disp,
      isRival, rivalToken,
      updateProgress,
    });
    if (!r.ok) return;  // 수집 실패 → 중단 (alert 는 eagateFetch 내부에서 이미 표시)
    allCharts = r.charts;
    pageCount = r.pageCount;
    const unit = fetchMode === 'series' ? '시리즈' : '페이지';
    updateProgress(`완료! ${pageCount}${unit} ${allCharts.length}곡`, 100);
    // 잠시 후 진행 패널 제거 (점수 패널이 같은 위치에 뜨므로)
    await new Promise((rs) => setTimeout(rs, 500));
    document.getElementById('__dp_progress')?.remove();

    if (allCharts.length === 0) {
      alert('곡을 하나도 못 찾았어요. 페이지 구조가 변경됐을 수 있습니다.');
      return;
    }
  }

  // -------- 4.5. textage 채보 메타로 noteCount 보강 --------
  // textage notes (DN/DH/DA/DX) → noteCount. 이미 있으면 (INF charts) 유지, 없으면 (오소리) textage 로 채움.
  //
  // missCount 는 보강 X — IIDX 판정은 Pgreat/Great/Good/Bad/Poor 이고 MISS COUNT(BP) = Bad+Poor 인데
  // EX 표기 2392(986/420) 에선 Pgreat/Great 만 알 수 있고 Good 을 모름 → BP 계산 불가.
  // (noteCount - pgreat - great = Good+Bad+Poor 라 MISS 가 아님.) EXH 추천은 rate(%) 로 정렬.
  //
  // 매칭 주의:
  //   - textage title 에 HTML 태그 (<font ...>) 가 섞인 곡 多 → norm 전에 태그 제거.
  //   - norm 충돌 (예: "Fly Away" lv8 ↔ "FlyAway" lv12 둘 다 norm "flyaway") → 한 키에 엔트리 배열로
  //     보관하고, 매칭 시 levels[slot] 이 차트 gameLevel 과 일치하는 엔트리를 우선 선택.
  //     (안 그러면 lv12 곡이 lv8 노트수에 매칭돼 rate 가 100% 초과 등 오류)
  if (textageSongs) {
    const stripHtml = (s) => (s || '').replace(/<[^>]*>/g, '');
    // norm(태그제거 title) → [{ notes, levels }, ...]
    const textageMap = {};
    for (const id in textageSongs) {
      const s = textageSongs[id];
      if (!s || !s.notes || !s.title) continue;
      const key = norm(stripHtml(s.title));
      (textageMap[key] = textageMap[key] || []).push({ notes: s.notes, levels: s.levels || {} });
    }
    const DIFF_TO_TEXTAGE = { NORMAL: 'DN', HYPER: 'DH', ANOTHER: 'DA', LEGGENDARIA: 'DX', BEGINNER: 'DB' };
    let filledNote = 0, filledLevel = 0;
    for (const c of allCharts) {
      const entries = textageMap[norm(c.title)];
      if (!entries) continue;
      const tKey = DIFF_TO_TEXTAGE[c.diff];
      if (!tKey) continue;
      // norm 충돌 시 — gameLevel 이 있으면 (level 모드) levels[slot] 일치 엔트리 우선,
      //               없으면 (series 모드) 해당 diff 채보가 실재하는 엔트리 우선.
      let chosen = entries[0];
      if (entries.length > 1) {
        chosen = entries.find((e) => (c.gameLevel != null
          ? e.levels[tKey] === c.gameLevel
          : typeof e.levels[tKey] === 'number')) || entries[0];
      }
      // 게임레벨 역추정 — series 모드는 페이지에 레벨이 없어 textage levels 로 채움.
      if (c.gameLevel == null && typeof chosen.levels[tKey] === 'number') {
        c.gameLevel = chosen.levels[tKey];
        filledLevel++;
      }
      const nc = chosen.notes[tKey];
      if (typeof nc !== 'number' || nc <= 0) continue;
      if (typeof c.noteCount !== 'number') { c.noteCount = nc; filledNote++; }
    }
    console.log(`[step2] textage 보강 — noteCount ${filledNote}곡, gameLevel ${filledLevel}곡`);
  }

  // -------- 4.6. series 모드 — 실재하지 않는 채보 칸 제거 --------
  // series.html 은 곡마다 BEGINNER~LEGGENDARIA 5칸을 항상 렌더한다 (DP BEGINNER 처럼
  // 채보가 없는 칸도 clflg0 + ---.gif + 0(0/0) 으로). 아래 중 하나라도 만족하면 남긴다:
  //   - textage levels 로 게임레벨이 확인된 차트
  //   - 플레이 흔적이 있는 차트 — 클리어램프(lampNum>0) 또는 EX점수(exScore>0).
  //     점수 0 이어도 램프(FAILED~FULL COMBO)만 있으면 실재 채보로 보고 유지.
  //   - ereter / rating 에 등록된 차트
  if (fetchMode === 'series') {
    const before = allCharts.length;
    allCharts = allCharts.filter((c) =>
      c.gameLevel != null ||
      c.lampNum > 0 ||
      c.exScore > 0 ||
      ereterMap.has(norm(c.title) + '|' + c.diff) ||
      ratingMap.has(norm(c.title) + '|' + c.diff),
    );
    console.log(`[step2] series 모드 유령 차트 제거: ${before} → ${allCharts.length}차트`);
  }

  // -------- 5. 매칭 + 점수 계산 --------
  // ereter.net 의 'combined' 분석 페이지와 동일한 방식:
  // 클리어한 모든 단계의 diff 를 합산.
  //   - FULL COMBO (7): EC + HC + EXH (모든 단계 도달)
  //   - EX HARD (6):    EC + HC + EXH (모든 단계 도달)
  //   - HARD (5):       EC + HC       (HARD 까지 도달)
  //   - CLEAR (4):      EC            (EASY 까지)
  //   - EASY (3):       EC            (EASY 까지)
  //   - FAILED/ASSIST/NO PLAY: 0      (어떤 단계도 클리어 못함)
  const lampToScore = (n, ec, hc, exh) => {
    const v = (x) => (typeof x === 'number' ? x : 0);
    if (n >= 6) return v(ec) + v(hc) + v(exh);  // EX HARD / FULL COMBO
    if (n === 5) return v(ec) + v(hc);          // HARD
    if (n >= 3) return v(ec);                   // EASY / CLEAR
    return 0;                                    // FAILED / ASSIST / NO PLAY
  };

  let total = 0, matched = 0, unmatched = 0;
  const perLamp = {}, perLevel = {};
  const details = [];
  const unmatchedSamples = [];
  // ★값 추정용 데이터: (diff, passed) 쌍의 배열
  // 사용자가 시도한 곡(NO PLAY 제외)에 대해 EC/HC/EXH 각 단계마다 한 점씩
  // ASSIST 는 ereter 에서 FAILED 로 처리됨 (모든 단계 fail)
  //
  // v3.3.4: fitData 생성 + runStarModel 호출은 외부 lib (oldOSR.js / osr.js) 안에서 수행.
  // 본체에서는 matched / unmatched / perLamp / details / score 통계만 계산 — 점수 합계 + UI 표시 용도.

  // 모드 결정 — LEVEL 12 플레이 곡 ≥ 30 이면 lv12 only 통계, else lv11+lv12 통합 통계
  const nLv12PlayedAll = allCharts.filter((c) => c.gameLevel === 12 && c.lampNum > 0).length;
  const useOnlyLv12 = nLv12PlayedAll >= 30;
  console.log(
    `[step2] LEVEL 12 플레이 ${nLv12PlayedAll}곡 → ${useOnlyLv12 ? 'lv12 only (이레터 대상곡만)' : 'lv11+lv12 통합'} 통계 모드`,
  );

  for (const c of allCharts) {
    const skipForStats = useOnlyLv12 && c.gameLevel !== 12;
    const e = ereterMap.get(norm(c.title) + '|' + c.diff);
    if (!e) {
      if (!skipForStats) {
        unmatched++;
        if (c.lampNum > 0 && unmatchedSamples.length < 10) {
          unmatchedSamples.push(`${c.title} [${c.diff}] (lamp=${c.lamp})`);
        }
      }
      continue;
    }
    if (!skipForStats) {
      matched++;
      perLamp[c.lamp] = (perLamp[c.lamp] || 0) + 1;
      const score = lampToScore(c.lampNum, e.ec, e.hc, e.exh);
      total += score;
      if (e.level != null) perLevel[e.level] = (perLevel[e.level] || 0) + score;
      if (score > 0) {
        details.push({
          title: c.title, diff: c.diff, level: e.level, lamp: c.lamp,
          ec: e.ec, hc: e.hc, exh: e.exh, score,
        });
      }
    }
  }
  details.sort((a, b) => b.score - a.score);

  console.log(`[step2] 매칭 ${matched} / 미매칭 ${unmatched} / 총점 ${total.toFixed(2)}`);
  if (unmatchedSamples.length > 0) {
    console.log('미매칭된 곡 (플레이 흔적 있는 것 중):');
    unmatchedSamples.forEach(s => console.log('  -', s));
  }

  // -------- 5.5. ★값 추정 (v3.3.5) --------
  // v3.3.5 변경 (분기 D2):
  //   - OSR13.5+.js 추가, OSR135 ≥ 13.0 → OSR135 / else → OSR / fallback → oldOSR
  //   - max(oldOSR, OSR) ensemble 폐기, oldOSR 는 fallback 으로만 유지
  //   - 1021명 검증: 전체 MAE 0.398 → 0.363, max|err| 6.989 → 4.264, bias +0.192 → +0.016
  //   - (표기 변경) group C (12.0+ 클리어 ≥ 30) + OSR135 < 13.0 영역만 oldOSR 로 표기. group A/B (저클리어) 는 OSR 유지. 내부 starEstimateNew 는 추천 풀 baseStar 용으로 유지.
  // v3.3.4 변경:
  //   - 상세통계 패널 UX 정리: 난이도 선택 토글 (Lv12 / Lv11+) 추가
  //     · DOM in-place 갱신 → details 펼침/닫힘 상태 보존
  //     · 난이도별 stacked bar 의 zasa★ levels 동적 (실제 데이터 있는 11.6/11.8/12.0~12.7)
  //     · "★ 추정 비교 · 곡 정보" 와 토글이 같은 row 좌/우 배치
  //   - 모델 자체 변경 X (v3.3.3 그대로)
  // v3.3.3 변경:
  //   - 4종 fitData 동시 수집 + 모델 함수 분리 (runStarModel)
  //     · 이레터넷만 / lv12-only / 11.6+ 전체 / primary (useOnlyLv12 분기 결과)
  //     · 4개 결과 중 max 채택 → 저렙 fallback (★0.01) 자동 보완
  //   - 상세 통계 패널에 ★ 추정 비교 표시 (곡 정보 토글 안)
  //   - lv12 ratingMap fallback 차트 곡명 하늘색 / lv11 진한 연두색 (#9ccc65)
  //   - 추천 풀 lv11+lv12 전곡으로 확장 (zasa < 11.6 lv11 lower-tier 포함)
  //   - EC 정리곡: HC < baseStar - 3 미만 곡 제외 (시간 낭비 방지)
  //   - bug fix: runStarModel 내부 closure 변수 fitData → fit (4 호출 모두 동일 데이터로 돌던 문제)
  // v3.3.2 변경:
  //   - EC-only 사용자 (HC/EXH 클리어 < 10) 에 raw + max_clear 기반 선형 보정 추가
  //     · 16명 EC-only 샘플 fit: true ≈ -0.158 + 0.761*raw_s + 0.250*fEc.max_clear
  //     · MAE 0.637 → 0.374 (41% 감소), 11명 개선 / 3명 작은 악화
  //     · 이레터★ 유무 무관 적용
  // v3.3.1 변경:
  //   - ohSorryRating.json (lv11/12 미등록 차트 추정) 통합 — fitData fallback + EC/HC 추천 풀 포함
  //   - 추정 하한 0.5 → 0.01 (LOW_FALLBACK + RAW_BOUNDS)
  //   - lv11 추정 차트 추천 시 곡명 연한 연두색 표시
  //
  // v3.2.10 변경 (★값 추정 모델 자체는 v3.2.9 그대로):
  //   - 추천곡 challenge offset 동적화: ★0.5 → +1.2, ★14.0 → +0.3 선형 보간
  //   - 6:4 비율 고정 (저레벨 3:7 분기 제거)
  //   - 풀 샘플 10+10=20 → picked 10 (한 쪽 부족 시 다른 쪽에서 보충)
  //
  // v3.2.9 모델: v3.2.7 + 4단계 진입 시 bin 보너스 활성 + ridge 음수 → ridge 0 처리
  //   - 86명 (n_cleared >= 50) 학습 (LOOCV 기준)
  //   - mean abs err: 0.1696 ★ (v3.2.7 의 0.1722 → 1.5% 개선, v3.2.1 대비 14.7%)
  //   - median:       0.1240 ★
  //   - max:          1.2657 ★
  //   - RMSE:         0.2517 ★
  //   - ≤0.10 ★: 35/86 (40.7%)
  //   - ≤0.30 ★: 76/86 (88.4%)
  //
  // 1단계: v3.1.1 의 logistic raw_s (HC × 2 + golden-section)
  //
  // 2단계: 36-feature Ridge 회귀 (α=5.0) — v3.2.1 그대로
  //   - v3.1.1 의 29 feature (raw_s, raw_s², 21 base, 8 AC/FC)
  //   - v3.2 추가 7 feature:
  //     · M: 사용자 도달 stage 의 max ★
  //     · M_top10_avg: top 1~10 cleared 평균 (robust estimator)
  //     · gap_top10: M - top10 (M 이 outlier 인지 신호)
  //     · gap × is_ec/hc/exh: M 의 stage 별 차등 페널티
  //     · prob_sum: S_hat=M_top10_avg 기준 sigmoid prob > 0.99 제외 failed 페널티
  //
  // 4단계 (v3.2.4 + v3.2.7 + v3.2.9): bin clear-rate 누적 post-correction
  //   stage 별 0.1 단위 bin 으로 곡 분류 (NO PLAY 제외, 분모는 시도한 곡만)
  //   rate ≥ 80% 인정, rateW = (rate - 0.8) / 0.2 [linear, 80~100% → 0~1]
  //   MIN_SAMPLES 차등 (EC=4/HC=3/EXH=2)
  //   eligible bin top 3 의 bonus 누적: top1 ×1.0 / top2 ×0.5 / top3 ×0.25, 각 bin × rateW
  //   bonus 차등: EC=0.05 / HC=0.10 / EXH=0.15 (어려운 stage 일수록 강한 신호)
  //   stage 별 implied = top1.bin_start + 누적_bonus → max(EC,HC,EXH) 채택
  //   단방향: implied > pred 일 때만 보너스 적용 (final = pred + diff × 0.7)
  //
  //   v3.2.9: bin 보너스 활성 (implied > raw_s + ridge) AND ridge < 0 일 때
  //     → ridge 의 음수 (페널티) 부분 무시 (RAY 같이 ridge 가 잘못 페널티 준 경우)
  //     → final pred = raw_s + 0 + post + djBoost
  //
  // 5단계 (v3.2.6): djLevel boost
  //   조건: M lamp = EC (3 또는 4) + djLevel(M 곡) ≥ A + raw_s ≥ 3
  //   gap (M - rawS) 곡률 with cutoff: gap < 2.5 → 0, gap ≥ 4.0 → 1, 사이 linear
  //   단방향: M > pred 일 때만 → final = pred + (M - pred) × 0.7 × curveW
  //   POCHI 처럼 lamp 약하지만 max clear 곡 점수 좋은 사용자 보정 (1명 영향, collateral 0)
  //
  // cutoff: n_cleared >= 50 (실전 평가에서 미달 시 v3.1.1 fallback)
  //
  // v3.3.4: ★ 추정 모델 (runStarModel) 은 외부 lib (oldOSR.js, osr.js) 으로 분리됨.
  //   본체에는 stub 만 — 아래 dead code 는 일괄 제거. 외부 lib fetch + ensemble 흐름은 step2 끝에서 처리.

  // ----- v3.3.5: 외부 lib 3종 (oldOSR + OSR + OSR135) 분기 채택 -----
  //   oldOSR (v3.3.3): runStarModel — fallback 용 (OSR 실패 시)
  //   OSR (v0.0.2):    IRT + ridge OLS 기반 user★ 추정 (ereter scale) — 13 미만 영역 메인
  //   OSR135 (v0.0.2): bin50 + 50% 임계 + 상향 bin 부분 보너스 — 13+ 영역 메인 (14+ MAE 0.014)
  //   분기 (D2): OSR135 ≥ 13.0 → OSR135 / else → OSR / 둘 다 없으면 oldOSR
  let starEstimate = null;
  let starRaw = null;
  let starEstimateOld = null;
  let starEstimateNew = null;
  // 4종 모드별 비교용 (상세통계 패널에 작은 텍스트 표시 유지)
  let starEstimateEreterOnly = null;
  let starEstimateLv12Only = null;
  let starEstimateAll = null;
  // INF DB 데이터 판별 — INFOhSorry 가 series:'INF' / version:'INFv...' 로 업로드함 (로그 라벨 분기 용)
  const isInfData = !!dbData && (dbData.series === 'INF' ||
    (typeof dbData.version === 'string' && dbData.version.indexOf('INF') === 0));
  // v3.3.8: DB 모드 (dbData 있음) 면 OSR/oldOSR/OSR135/adopt 호출 다 skip — supabase 저장값 그대로 사용.
  //   기존엔 INF 일 때만 skip 했으나, AC + 게스트 페이지 일반 케이스도 동일하게 처리해 모델 재실행 비용 제거.
  //   추천곡은 ohsorryRecBase = starEstimateNew != null ? starEstimateNew : starEstimate 이므로
  //   starEstimateNew 에 같은 값을 셋업해 두면 기존 추천 흐름 그대로 동작.
  if (dbData) {
    starEstimate = typeof dbData.star_estimate === 'number' ? dbData.star_estimate : null;
    starRaw = typeof dbData.raw_s === 'number' ? dbData.raw_s : null;
    starEstimateNew = starEstimate;  // 추천 풀 baseStar (ohsorryRecBase) 용 — supabase 저장 ★ 와 동일
    const label = isInfData ? 'INF DB' : 'AC DB';
    console.log(`[오소리] ${label} 데이터 — ★ 모델 스킵, supabase 저장 ★${starEstimate != null ? starEstimate.toFixed(2) : 'N/A'} 그대로 사용`);
  } else {
  if (oldOSR && ratingData && Array.isArray(ereterData) && ereterData.length > 0) {
    try {
      const ereterPayload = { charts: ereterData, players: ereterPlayers || {} };
      const r = oldOSR.inferUser(allCharts, ratingData, ereterPayload);
      starEstimateOld = r.starEstimate;
      starRaw = r.starRaw;
      starEstimateEreterOnly = r.starEstimates?.ereterOnly ?? null;
      starEstimateLv12Only = r.starEstimates?.lv12Only ?? null;
      starEstimateAll = r.starEstimates?.all ?? null;
      console.log(`[step2] oldOSR (v3.3.3): ★${starEstimateOld != null ? starEstimateOld.toFixed(2) : 'N/A'} (raw=${starRaw != null ? starRaw.toFixed(2) : 'N/A'}, adopted=${r.adopted}, n=${r.fitLen}, lamps=${r.validStages.join('/')})`);
    } catch (e) {
      console.error('[step2] oldOSR.inferUser 실패:', e.message);
    }
  }
  let osrGroup = null;  // tiered 그룹 (A/B/C) — 표기 분기에서 사용
  if (ohSorryRatingLib && ratingData) {
    try {
      // v3.3.4: tiered 사용 (그룹별 scope + B 보정) — lib 에 inferUserTiered 가 있으면 사용
      const useTiered = typeof ohSorryRatingLib.inferUserTiered === 'function';
      const r = useTiered ? ohSorryRatingLib.inferUserTiered(allCharts, ratingData) : ohSorryRatingLib.inferUser(allCharts, ratingData);
      starEstimateNew = typeof r.ereterCompatStar === 'number' ? r.ereterCompatStar : null;
      osrGroup = r.group || null;
      const tieredInfo = useTiered && r.group ? ` [tiered:${r.group} lv12cl=${r.nLv12Cleared} z12cl=${r.nZ12_0upCleared} corr=${r.bandCorrection >= 0 ? '+' : ''}${r.bandCorrection?.toFixed(3) ?? 0}]` : '';
      console.log(`[step2] OSR (v0.0.2${useTiered ? ' tiered' : ''}): ★${starEstimateNew != null ? starEstimateNew.toFixed(2) : 'N/A'}${tieredInfo} (native=${typeof r.nativeStar === 'number' ? r.nativeStar.toFixed(2) : 'N/A'}, n_enriched=${r.nEnriched || 0})`);
    } catch (e) {
      console.error('[step2] ohSorryRating.inferUser 실패:', e.message);
    }
  }
  // v3.3.5: OSR13.5+ 계산 — OSR >= 13.5 + OSR135 >= 13.5 면 오버라이드, 아니면 oldOSR
  let starEstimate135 = null;
  let osr135Meta = null;  // { ec, hc, exh } — spread gate 용 (세 분기 일관성 판정)
  if (osr135Lib && ereterData && Array.isArray(ereterData) && ereterData.length > 0) {
    try {
      const r135 = osr135Lib.inferUser(allCharts, { charts: ereterData });
      starEstimate135 = r135.starEstimate;
      osr135Meta = { ec: r135.ec.final, hc: r135.hc.final, exh: r135.exh.final };
      console.log(`[step2] OSR13.5+ (v${osr135Lib.version}): ★${starEstimate135 != null ? starEstimate135.toFixed(2) : 'N/A'} (adopted=${r135.adopted}, EC=${r135.ec.final.toFixed(2)}, HC=${r135.hc.final.toFixed(2)}, EXH=${r135.exh.final.toFixed(2)})`);
    } catch (e) {
      console.error('[step2] OSR13.5+.inferUser 실패:', e.message);
    }
  }

  // v3.3.7: adopt.js (lib) 사용 가능하면 v335E 채택 분기 lib 호출. 실패 시 본체 inline fallback.
  //   adopt 안에서 group C 2-scope max + baseStar2 + spread gate + under-blend 다 처리.
  if (adoptLib) {
    const r = adoptLib.adoptStar({
      starOld: starEstimateOld, starNew: starEstimateNew, star135: starEstimate135,
      starEreterOnly: starEstimateEreterOnly, starLv12Only: starEstimateLv12Only,
      osr135Stages: osr135Meta, group: osrGroup,
    });
    starEstimate = r.star;
    starEstimateOld = r.oldStarUsed;  // group C 2-scope 적용 후 값 (UI 표시 일관성)
    console.log(`[step2] ★ = ${r.adoptedLib} ${typeof r.star === 'number' ? r.star.toFixed(2) : 'N/A'} ` +
      `(adopt v${adoptLib.version}, group ${osrGroup}, OSR135=${typeof starEstimate135 === 'number' ? starEstimate135.toFixed(2) : 'N/A'} ` +
      `OSR=${typeof starEstimateNew === 'number' ? starEstimateNew.toFixed(2) : 'N/A'} ` +
      `old=${typeof r.oldStarUsed === 'number' ? r.oldStarUsed.toFixed(2) : 'N/A'}` +
      (r.osr135Trusted ? '' : ' ⚠ OSR135 spread > 2.5') + ')');
  } else {
  // ===== adopt.js fetch 실패 시 inline fallback (이전 분기 로직 그대로) =====
  // group C 인 경우 oldOSR 의 4종 max 에서 all-11.6+ scope 제외 — ereterOnly / lv12Only 중 max 로 재계산
  //   이유: group C (12.0+ 클리어 ≥ 30) 고수는 ratingMap 의 lv11 추정곡 보강이 오히려 잡음
  //   group C 면 useOnlyLv12=true 보장 (12.0+ 클리어 30+ → lv12 플레이 30+) → primary === lv12Only 라 추가 채택 불필요
  if (osrGroup === 'C' && (starEstimateEreterOnly != null || starEstimateLv12Only != null)) {
    const cands = [starEstimateEreterOnly, starEstimateLv12Only].filter(x => typeof x === 'number');
    const newOldStar = Math.max(...cands);
    console.log(`[step2] group C → oldOSR all-11.6+ 제외, max(ereter=${starEstimateEreterOnly?.toFixed(2) ?? 'N/A'}, lv12=${starEstimateLv12Only?.toFixed(2) ?? 'N/A'}) = ${newOldStar.toFixed(2)} (기존 4종 max ${starEstimateOld?.toFixed(2) ?? 'N/A'})`);
    starEstimateOld = newOldStar;
  }

  // 채택 로직 (v335E — 1021명 검증 통과) — D3 분기 + spread gate:
  //   [신뢰도 게이트] OSR135 세 분기(EC/HC/EXH) 중 0(데이터 없음) 제외, max-min spread > 2.5 면
  //                  OSR135 내부 불일치 → 신뢰 X → baseStar2 직행
  //   spread ≤ 2.5 일 때만 OSR135 사용:
  //     ≥13.5            → OSR135 직행 (14+ 정확도 핵심)
  //     12.5 ≤ x < 13.5  → 블렌드 구간:
  //         osr > osr135 → 기본 OSR135 직행. 단, OSR135 ≥ 13.0 + gap ≥ 0.35 면 낮은 base 와 제한 블렌드
  //         diffBlend = baseStar2 ↔ osr135 (osr135 위치로 12.5~13.5 선형)
  //         gapW = clamp((osr135 - osr) / 3) — gap 작으면 diffBlend, 크면 (osr 망가짐) osr135 직행
  //         최종 = diffBlend × (1-gapW) + osr135 × gapW
  //     < 12.5           → baseStar2
  //   group 별 base 값 (baseStar2):
  //     group A·B → OSR  (없으면 oldOSR fallback)
  //     group C   → OSR값 ≥ 11.0 → OSR / < 11.0 → oldOSR / 10.5~11.0 보간
  // 내부 계산용 starEstimateNew (OSR) 는 그대로 유지 — 추천 풀 baseStar (ohsorryRecBase) 에서 사용
  const OSR135_TH = 13.5;       // OSR135 직행 하한
  const BLEND_W = 1.0;          // 12.5~13.5 블렌드 폭
  const GAP_GUARD = 3.0;        // OSR135-OSR gap (osr 망가짐 판정)
  const SPREAD_MAX = 2.5;       // OSR135 세 분기 spread 신뢰 상한
  const OSR135_UNDER_TH = 13.0;  // OSR>OSR135 과소평가 보정 하한 (12점대 과상승 방지)
  const OSR135_UNDER_GAP = 0.35; // OSR 과 OSR135 차이가 충분히 큰 경우만 보정
  const isAB135 = osrGroup === 'A' || osrGroup === 'B';
  // group 별 base 값 (baseStar2) + 로그 라벨 (groupLib)
  let baseStar2, groupLib;
  if (isAB135) {
    baseStar2 = starEstimateNew != null ? starEstimateNew : starEstimateOld;
    groupLib = starEstimateNew != null ? 'OSR' : 'oldOSR(fb)';
  } else {
    // group C: 11~13 은 OSR 가 최강 → OSR값 ≥ 11.0 → OSR / < 11.0 → oldOSR / 10.5~11.0 보간
    const C_TH = 11.0, C_W = 0.5;
    if (starEstimateNew != null && starEstimateNew >= C_TH) {
      baseStar2 = starEstimateNew; groupLib = 'OSR(C)';
    } else if (starEstimateNew != null && starEstimateNew >= C_TH - C_W && starEstimateOld != null) {
      const ct = (starEstimateNew - (C_TH - C_W)) / C_W;
      baseStar2 = starEstimateOld * (1 - ct) + starEstimateNew * ct;
      groupLib = 'OSR↔oldOSR(C)';
    } else if (starEstimateOld != null) {
      baseStar2 = starEstimateOld; groupLib = 'oldOSR(C)';
    } else {
      baseStar2 = starEstimateNew; groupLib = 'OSR(C,fb)';
    }
  }
  // OSR135 신뢰도 게이트 — 세 분기 spread > 2.5 면 OSR135 안 씀
  let osr135Trusted = true;
  if (osr135Meta) {
    const stages = [osr135Meta.ec, osr135Meta.hc, osr135Meta.exh].filter((v) => typeof v === 'number' && v > 0.01);
    if (stages.length >= 2 && (Math.max(...stages) - Math.min(...stages)) > SPREAD_MAX) osr135Trusted = false;
  }
  // 채택 분기 (v335E 와 동일)
  if (starEstimate135 == null) {
    starEstimate = baseStar2;
    if (baseStar2 != null) console.log(`[step2] ★ = ${groupLib} ${starEstimate.toFixed(2)} (group ${osrGroup}, OSR135 결과 없음)`);
    else console.error('[step2] 모든 lib 실패 — ★ 추정 불가. lib fetch + localStorage 캐시 모두 실패 가능성');
  } else if (!osr135Trusted) {
    starEstimate = baseStar2 != null ? baseStar2 : starEstimate135;
    const lib = baseStar2 != null ? groupLib : 'OSR13.5+(fb)';
    console.log(`[step2] ★ = ${lib} ${starEstimate.toFixed(2)} (OSR135 spread > ${SPREAD_MAX} → 불신, 세 분기 ${osr135Meta.ec.toFixed(2)}/${osr135Meta.hc.toFixed(2)}/${osr135Meta.exh.toFixed(2)})`);
  } else if (starEstimate135 >= OSR135_TH) {
    starEstimate = starEstimate135;
    console.log(`[step2] ★ = OSR13.5+ ${starEstimate.toFixed(2)} (≥ ${OSR135_TH})`);
  } else if (starEstimate135 < OSR135_TH - BLEND_W || baseStar2 == null) {
    starEstimate = baseStar2 != null ? baseStar2 : starEstimate135;
    const lib = baseStar2 != null ? groupLib : 'OSR13.5+(fb)';
    const reason = baseStar2 != null ? `OSR135 ${starEstimate135.toFixed(2)} < ${OSR135_TH - BLEND_W}` : 'group lib 없음';
    console.log(`[step2] ★ = ${lib} ${starEstimate.toFixed(2)} (${reason})`);
  } else if (starEstimateNew != null && starEstimateNew > starEstimate135) {
    const lowBase = Math.min(
      starEstimateNew,
      starEstimateOld != null ? starEstimateOld : starEstimateNew,
    );
    if (
      starEstimate135 >= OSR135_UNDER_TH &&
      starEstimateNew - starEstimate135 >= OSR135_UNDER_GAP &&
      lowBase > starEstimate135
    ) {
      starEstimate = starEstimate135 * 0.35 + lowBase * 0.65;
      console.log(`[step2] ★ = OSR13.5+ under-blend ${starEstimate.toFixed(2)} (osr ${starEstimateNew.toFixed(2)} > osr135 ${starEstimate135.toFixed(2)}, lowBase ${lowBase.toFixed(2)})`);
    } else {
      starEstimate = starEstimate135;
      console.log(`[step2] ★ = OSR13.5+ ${starEstimate.toFixed(2)} (osr ${starEstimateNew.toFixed(2)} > osr135 → 직행)`);
    }
  } else {
    const t = (starEstimate135 - (OSR135_TH - BLEND_W)) / BLEND_W;
    const diffBlend = baseStar2 * (1 - t) + starEstimate135 * t;
    if (starEstimateNew == null) {
      starEstimate = diffBlend;
      console.log(`[step2] ★ = diffBlend ${starEstimate.toFixed(2)} (OSR135 ${starEstimate135.toFixed(2)} ↔ ${groupLib} ${baseStar2.toFixed(2)}, t=${t.toFixed(2)})`);
    } else {
      const gapW = Math.max(0, Math.min((starEstimate135 - starEstimateNew) / GAP_GUARD, 1));
      starEstimate = diffBlend * (1 - gapW) + starEstimate135 * gapW;
      console.log(`[step2] ★ = blend ${starEstimate.toFixed(2)} (OSR135 ${starEstimate135.toFixed(2)} ↔ ${groupLib} ${baseStar2.toFixed(2)}, t=${t.toFixed(2)}, gapW=${gapW.toFixed(2)}, group ${osrGroup})`);
    }
  }
  }  // ← adopt.js fetch 실패 시 inline fallback 블록 끝
  }

  // -------- 5.6. status 페이지에서 프로필 정보 fetch --------
  // 쿠프로(クプロ) 이미지, DJ 이름, IIDX ID, SP/DP 단위(段位), 노트레이더 등
  let profile = null;
  if (dbData) {
    // DB 모드 — supabase row 에서 프로필 구성 (status.html fetch 스킵).
    // 쿠프로 이미지는 DB 에 없음. 노트레이더는 notes_radar 있으면 복원, 없으면 미표시.
    profile = {
      djName: dbData.dj_name || null,
      iidxId: dbData.iidx_id || null,
      spRank: dbData.sp_rank || null,
      dpRank: dbData.dp_rank || null,
    };
    const nr = dbData.notes_radar;
    if (nr && typeof nr === 'object') {
      if (nr.sp && typeof nr.sp === 'object') profile.spRadar = nr.sp;
      if (nr.dp && typeof nr.dp === 'object') profile.dpRadar = nr.dp;
    }
    console.log('[오소리] DB 모드 프로필:', profile);
  } else {
  updateProgress('프로필 정보 fetch 중...', 96);
  try {
    const statusUrl = isRival
      ? 'https://p.eagate.573.jp/game/2dx/33/djdata/rival/rival_status.html?rival=' + encodeURIComponent(rivalToken)
      : 'https://p.eagate.573.jp/game/2dx/33/djdata/status.html';
    const res = await fetch(statusUrl, { credentials: 'include' });
    if (res.ok) {
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      profile = {};
      // 쿠프로 이미지 (절대 URL 로 변환)
      const qproImg = doc.querySelector('div.qpro-img img');
      if (qproImg) {
        let src = qproImg.getAttribute('src') || '';
        if (src.startsWith('/')) src = 'https://p.eagate.573.jp' + src;
        else if (!src.startsWith('http')) src = new URL(src, statusUrl).href;
        profile.qproImg = src;
      }
      // DJ 프로필 테이블
      const profileTable = doc.querySelector('div.dj-profile table');
      if (profileTable) {
        profileTable.querySelectorAll('tr').forEach(tr => {
          const tds = tr.querySelectorAll('td');
          if (tds.length === 2) {
            const key = tds[0].textContent.trim();
            const val = tds[1].textContent.trim();
            if (key === 'DJ NAME')        profile.djName = val;
            else if (key === '所属エリア')  profile.area = val;
            else if (key === 'IIDX ID')    profile.iidxId = val;
            else if (key === '所持LIME')   profile.lime = val;
            else if (key === 'プレー回数') profile.playCount = val;
          }
        });
      }
      // 段位 (단위) / ノーツレーダー - dj-rank 영역들 순회
      doc.querySelectorAll('div.dj-rank').forEach(dr => {
        const cn = dr.querySelector('div.cat-name');
        if (!cn) return;
        const catName = cn.textContent.trim();
        if (catName === '段位認定') {
          dr.querySelectorAll('div.rank-cat').forEach(rc => {
            const divs = rc.querySelectorAll('div');
            if (divs.length >= 2) {
              const style = divs[0].textContent.trim();  // 'SP' or 'DP'
              const rank = divs[1].textContent.trim();   // '中伝', '十段', '---' 등
              if (style === 'SP') profile.spRank = rank;
              if (style === 'DP') profile.dpRank = rank;
            }
          });
        } else if (catName === 'ノーツレーダー') {
          dr.querySelectorAll('div.rank-cat').forEach(rc => {
            const style = rc.querySelector('span')?.textContent.trim();
            if (style !== 'SP' && style !== 'DP') return;
            const radar = {};
            // 6각 레이더 이미지 (KONAMI 동적 img_radar.html — relative URL 절대화)
            const img = rc.querySelector('img');
            if (img) {
              let src = img.getAttribute('src') || '';
              if (src.startsWith('/')) src = 'https://p.eagate.573.jp' + src;
              else if (!src.startsWith('http')) src = new URL(src, statusUrl).href;
              radar.img = src;
            }
            // 카테고리별 수치 + 합계
            rc.querySelectorAll('ul li').forEach(li => {
              const ps = li.querySelectorAll('p');
              if (ps.length < 2) return;
              const key = ps[0].textContent.trim();
              const num = parseFloat(ps[1].textContent.trim());
              if (isNaN(num)) return;
              if (key === '合計レーダースコア') radar.total = num;
              else radar[key] = num;  // NOTES / CHORD / PEAK / CHARGE / SCRATCH / SOF-LAN
            });
            if (style === 'SP') profile.spRadar = radar;
            else profile.dpRadar = radar;
          });
        }
      });
      console.log('[step2] 프로필 fetch 완료:', profile);
    } else {
      console.warn(`[step2] 프로필 fetch 실패 HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn('[step2] 프로필 fetch 실패:', e);
  }
  }

  // 레이더 데이터 유효성 — 객체이고 6개 카테고리 중 하나라도 숫자값이 있어야 함.
  // (null / undefined / 빈 객체 {} 면 레이더 영역 자체를 만들지 않음)
  const RADAR_CATS = ['NOTES', 'CHORD', 'PEAK', 'CHARGE', 'SCRATCH', 'SOF-LAN'];
  const hasRadarData = (r) =>
    !!r && typeof r === 'object' &&
    (RADAR_CATS.some((c) => typeof r[c] === 'number') || typeof r.total === 'number');
  const profileHasRadar = !!profile && (hasRadarData(profile.spRadar) || hasRadarData(profile.dpRadar));

  // -------- 5.7. 추천곡 계산 (EC/HC/EXH 3종류) --------
  // 추천곡 기준 ★값: ereter (이레터 원본) / ohsorry (우리 모델 추정) 토글로 선택 가능
  const idNormForRec = profile && profile.iidxId ? profile.iidxId.replace(/-/g, '') : null;
  const eraterTrueStar = (idNormForRec && ereterPlayers) ? ereterPlayers[idNormForRec] : null;

  // EC-only 보정은 runStarModel 함수 내부에서 이미 적용됨 (모든 4종 결과 모두 보정 완료)

  // v3.3.5: D2 의 표기 ★ (starEstimate) 대신 OSR (v0.0.2) 단독값을 추천 baseStar 로 사용
  //   이유: OSR135 의 over-estimation (12점대 +0.46 bias) 을 추천 풀 결정에서 배제
  //   OSR 결과 없으면 starEstimate (D2) 로 fallback
  const ohsorryRecBase = starEstimateNew != null ? starEstimateNew : starEstimate;
  let recBaseMode = eraterTrueStar != null ? 'ereter' : 'ohsorry';
  let recBaseStar = recBaseMode === 'ereter' ? eraterTrueStar : ohsorryRecBase;
  console.log(`[step2] 추천곡 기준: ${recBaseMode} (★${recBaseStar != null ? recBaseStar.toFixed(2) : 'N/A'}, ohsorry=OSR단독 ${ohsorryRecBase != null ? ohsorryRecBase.toFixed(2) : 'N/A'})`);

  // 유저 약점/강점 9 feature 벡터 + 차트별 강점 매치 점수 (추천 정렬 가중치).
  // patterns 또는 calcWeakness lib 로드 실패 시 가중치 없이 (chartStrengthMatch 항상 0 → fallback to count desc).
  let userVec = null;
  const patternsTitleMap = {};
  if (patternsMap && weaknessLib) {
    for (const id in patternsMap) {
      const k = norm(patternsMap[id].t || '');
      if (k && !patternsTitleMap[k]) patternsTitleMap[k] = id;
    }
    userVec = weaknessLib.calcUserWeakness({ allCharts, patternsMap, normFn: norm, ratingMap: ohSorryRatings, zasaMap: zasaData, rateRef: rateRefData });
    const vecLog = {};
    for (const f of weaknessLib.FEATS) vecLog[f] = +userVec[f].toFixed(2);
    console.log(`[step2] userVec (${userVec.__meta.matched}곡 매칭):`, vecLog);
  }
  const chartStrengthMatch = (r) => {
    if (!userVec || !weaknessLib) return 0;
    const sid = patternsTitleMap[norm(r.title || '')];
    if (!sid) return 0;
    const cn = weaknessLib.DIFF2CHART[r.chart];
    if (!cn || !patternsMap[sid] || !patternsMap[sid].c[cn]) return 0;
    return weaknessLib.chartStrengthMatch(patternsMap[sid].c[cn], userVec);
  };

  // 손 분리 + FLIP 매치 — chart 의 p1/p2 와 vecL/vecR 각각 dot product, FLIP 배치도 같이 비교.
  //   return: { L, R, total, max, flipL, flipR, flipTotal, flipMax, best:'normal'|'flip', bestTotal }
  //   추천 정렬은 bestTotal desc — FLIP 으로 더 잘 맞는 곡도 같이 우선순위 결정.
  //   weaknessLib 신규 함수 / __vecL / __vecR 모두 있어야 동작 (옛 gist 호환 위해 null 반환 fallback).
  // 새 gist (chartStrengthMatch8Way 있음) 우선 — 8 배치 (N/N, M/-, -/M, M/M, F, F M/-, F -/M, F M/M) 평가.
  // 옛 gist fallback — 2 배치 (normal / flip) 평가. return 형식 normalize 해서 _matchByHand 통일.
  const chartStrengthMatchByHand = (r) => {
    if (!userVec || !userVec.__vecL || !userVec.__vecR || !weaknessLib) return null;
    const sid = patternsTitleMap[norm(r.title || '')];
    if (!sid) return null;
    const cn = weaknessLib.DIFF2CHART[r.chart];
    if (!cn || !patternsMap[sid] || !patternsMap[sid].c[cn]) return null;
    const chartC = patternsMap[sid].c[cn];
    if (weaknessLib.chartStrengthMatch8Way) {
      const w8 = weaknessLib.chartStrengthMatch8Way(chartC, userVec);
      if (!w8) return null;
      return {
        bestTotal: w8.bestTotal,
        bestLabel: w8.bestLabel,
        best: w8.best,
        L: w8.best.L, R: w8.best.R,
        flip: w8.best.flip, mL: w8.best.mL, mR: w8.best.mR,
        total: w8.best.total,
        results: w8.results,
      };
    }
    // 옛 gist fallback
    if (weaknessLib.chartStrengthMatchByHand) {
      const w = weaknessLib.chartStrengthMatchByHand(chartC, userVec.__vecL, userVec.__vecR);
      const isF = w.best === 'flip';
      return {
        bestTotal: w.bestTotal,
        bestLabel: isF ? 'F' : '',
        best: { flip: isF, mL: false, mR: false, label: isF ? 'F' : '', L: isF ? w.flipL : w.L, R: isF ? w.flipR : w.R, total: w.bestTotal },
        L: isF ? w.flipL : w.L, R: isF ? w.flipR : w.R,
        flip: isF, mL: false, mR: false,
        total: w.bestTotal,
        results: null,
      };
    }
    return null;
  };

  // 차트 패턴 hashtag — 그 곡의 강한 top 3 feature (양손 평균 pt 큰 순) → 한국어 약어.
  //   추천 row hover / 토스트에 "#동치 #계단 #밀도" 식으로 표시.
  const FEAT_TAG_MAP = {
    NOTES: '밀도', CHORD: '동치', PEAK: '순간밀도', CHARGE: '롱잡',
    SCRATCH: '스크', 'SOF-LAN': '변속', PHRASE: '계단',
    JACK: '축연타', TRILL: '트릴', RAND: '난타',
  };
  const FEAT_TAG_KEYS = Object.keys(FEAT_TAG_MAP);
  const computeChartTags = (r) => {
    if (!weaknessLib || !weaknessLib.avgPt) return [];
    const sid = patternsTitleMap[norm(r.title || '')];
    if (!sid) return [];
    const cn = weaknessLib.DIFF2CHART[r.chart];
    if (!cn || !patternsMap[sid] || !patternsMap[sid].c[cn]) return [];
    const pt = weaknessLib.avgPt(patternsMap[sid].c[cn]);
    const arr = FEAT_TAG_KEYS.map(f => ({ f, v: pt[f] || 0 }));
    arr.sort((a, b) => b.v - a.v);
    return arr.slice(0, 3).filter(x => x.v > 0).map(x => FEAT_TAG_MAP[x.f]);
  };

  // 추천 row 전용 hashtag 배열 계산 — ohsorryRender 가 hover/toast 에 그대로 표시.
  //   순서: [카테고리(필수), FLIP+N(있을 때), 한손위주(편차 30%+), pattern feature top 3]
  const CATEGORY_TAG_MAP = { hard: '강도전', easy: '약도전' };  // cleanup (정리곡) 은 표기 생략
  const HAND_BIAS_THRESHOLD = 0.3;
  const computeRecHashtags = (r) => {
    const tags = [];
    if (r._category && CATEGORY_TAG_MAP[r._category]) tags.push('#' + CATEGORY_TAG_MAP[r._category]);
    const m = r._matchByHand;
    if (m) {
      // 한 손 위주 — best 배치의 |L−R| / max(L,R) ≥ 30%. 8 배치 wrapper 가 m.L/m.R 에 best 배치 값 노출.
      const l = m.L || 0;
      const rh = m.R || 0;
      const mxLR = l > rh ? l : rh;
      if (mxLR > 0 && Math.abs(l - rh) / mxLR >= HAND_BIAS_THRESHOLD) {
        tags.push(l > rh ? '#왼손위주' : '#오른손위주');
      }
    }
    // pattern feature top 3
    const pt = r._tags || computeChartTags(r);
    if (pt && pt.length > 0) for (const t of pt) tags.push('#' + t);
    return tags;
  };

  const recsEC = [], recsHC = [], recsEXH = [], recsWeakness = [];

  // Fisher-Yates shuffle
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // 추천 풀 — 카테고리 (미도달 / 도달DJ미도달) × 분류 (hard / easy / cleanup).
  // 새 룰 (2026-05-27~) — stage 별 effectiveBase + d 기반:
  //   topClearStar  = 그 stage 클리어 한 차트의 ★ 최댓값 (e[ec/hc/exh])
  //   effectiveBase = EC: baseStar - 0.5  /  HC: baseStar  /  EXH: baseStar + 2
  //   d             = max(0, topClearStar - effectiveBase)
  //
  //   EC / HC:
  //     정리곡 (cleanup) = [0, effectiveBase)
  //     약도전 (easy)    = [effectiveBase, effectiveBase + 0.7d)
  //     강도전 (hard)    = [effectiveBase + 0.7d, topClearStar + 0.3d]
  //     dv > topClearStar + 0.3d → 풀 제외
  //
  //   EXH:
  //     정리곡만 (cleanup) = [0, effectiveBase). dv ≥ effectiveBase → 풀 제외 (약/강도전 분류 없음)
  //
  //   d=0 (사용자가 effectiveBase 이상 클리어 없음) → 약/강도전 한 점으로 수렴 → 대부분 정리곡
  const buildPools = (threshold, getDiffField, baseStar, recLevelMode, djMode) => {
    const empty = { hard: [], easy: [], cleanup: [] };
    const underLamp = { hard: [], easy: [], cleanup: [] };       // lampNum < threshold
    const reached   = { hard: [], easy: [], cleanup: [] };       // lampNum >= threshold && !accuracyOK
    if (baseStar == null) return { underLamp: empty, reached: empty };
    const isEC = getDiffField === 'ec';
    const isHC  = getDiffField === 'hc';
    const isEXH = getDiffField === 'exh';
    // 그 stage 클리어 한 차트들의 ★ 중 최댓값
    let topClearStar = 0;
    for (const c of allCharts) {
      if (c.lampNum < threshold) continue;
      const e0 = ereterMap.get(norm(c.title) + '|' + c.diff);
      if (!e0 || typeof e0[getDiffField] !== 'number') continue;
      if (e0[getDiffField] > topClearStar) topClearStar = e0[getDiffField];
    }
    // stage 별 effectiveBase + d 산정
    const effectiveBase = isEC  ? (baseStar - 0.5)
                        : isEXH ? (baseStar + 2)
                        : baseStar;  // HC
    const d = Math.max(0, topClearStar - effectiveBase);
    // EC/HC: 정리곡 [0, effectiveBase) / 약도전 [effectiveBase, effectiveBase+0.7d) / 강도전 [effectiveBase+0.7d, topClearStar+0.3d]
    // EXH:   정리곡만 [0, effectiveBase). dv ≥ effectiveBase → 풀 제외
    const hardMin = effectiveBase + 0.7 * d;
    const hardMax = topClearStar + 0.3 * d;
    const easyMin = effectiveBase;
    // stage 별 정확도 임계치 — EC: A 이상이면 OK / HC: AA 이상 / EXH: AAA 만
    const accuracyOK = (djLv) => {
      if (isEXH) return djLv === 'AAA';
      if (isHC)  return djLv === 'AAA' || djLv === 'AA';
      return djLv === 'AAA' || djLv === 'AA' || djLv === 'A';  // EC default
    };
    const reachedStageLamp = (lampN) => {
      if (isEXH) return lampN >= 6;       // EX/FC/PFC + AAA 미도달
      if (isHC)  return lampN === 5;      // HC + AA 미도달
      return lampN === 3 || lampN === 4;  // EC/NC + A 미도달
    };
    for (const c of allCharts) {
      if (recLevelMode === 'lv12' && c.gameLevel !== 12) continue;
      if (recLevelMode === 'lv11+12' && c.gameLevel !== 11 && c.gameLevel !== 12) continue;
      const under = c.lampNum < threshold;
      const reachedForDj = reachedStageLamp(c.lampNum);
      // DJ레벨 미달 풀 제외 모드 — 클리어램프 미달 곡만 후보로 (램프 도달·DJ레벨 미달 곡 제외).
      if (djMode === 'off' && !under) continue;
      // 해당 stage 를 못 딴 곡 + 해당 stage 에서 DJ Level 미도달인 곡만 추천 후보.
      // 예: EASY 추천에서 HC/EX/FC 는 제외, EXH 추천은 EX/FC/PFC 도 AAA 미도달이면 포함.
      if (!under && !reachedForDj) continue;
      if (reachedForDj && accuracyOK(c.djLevel)) continue;
      if (reachedForDj && c.exScore === 0) continue;
      let e = ereterMap.get(norm(c.title) + '|' + c.diff);
      let gameLevel = null;
      if (!e || e.level == null) {
        const r = ratingMap.get(norm(c.title) + '|' + c.diff);
        if (!r || typeof r.zasaLevel !== 'number') continue;
        e = {
          level: r.zasaLevel,
          ec: typeof r.estEc === 'number' ? r.estEc : null,
          hc: typeof r.estHc === 'number' ? r.estHc : null,
          exh: typeof r.estExh === 'number' ? r.estExh : null,
          ec_n: r.nEcCleared || 0,
          hc_n: r.nHcCleared || 0,
          exh_n: r.nExhCleared || 0,
        };
        gameLevel = r.gameLevel ?? null;
      }
      const dv = e[getDiffField];
      if (typeof dv !== 'number') continue;
      const item = {
        title: c.title, chart: c.diff, level: e.level,
        ec: e.ec, hc: e.hc, exh: e.exh,
        ec_n: e.ec_n, hc_n: e.hc_n, exh_n: e.exh_n,
        diffValue: dv, currentLamp: c.lamp,
        margin: baseStar - dv,
        gameLevel,
      };
      // dv 기반 분류 (2026-05-27~) — stage 별 effectiveBase + hardMax 상한.
      //   EC/HC: 정리곡 [0, easyMin) / 약도전 [easyMin, hardMin) / 강도전 [hardMin, hardMax]. dv > hardMax 풀 제외.
      //   EXH:   정리곡만 [0, effectiveBase). dv ≥ effectiveBase 풀 제외.
      let cls;
      if (isEXH) {
        if (dv >= effectiveBase) continue;  // 약/강도전 분류 없음 — 풀 제외
        cls = 'cleanup';
      } else {
        if (dv > hardMax) continue;  // 강도전 상한 초과 풀 제외
        if (dv >= hardMin) cls = 'hard';
        else if (dv >= easyMin) cls = 'easy';
        else {
          if (isEC && typeof e.hc === 'number' && e.hc < baseStar - 3) continue;  // 너무 쉬운 곡 제외
          cls = 'cleanup';
        }
      }
      item._category = cls;
      (reachedForDj ? reached : underLamp)[cls].push(item);
    }
    return { underLamp, reached };
  };

  const buildRecs = (threshold, getDiffField, baseStar, recLevelMode, djMode) => {
    const { underLamp, reached } = buildPools(threshold, getDiffField, baseStar, recLevelMode, djMode);
    const countField = getDiffField + '_n';

    // 카테고리 내 모든 분류 합쳐서 sample 15 — bestTotal desc top 15 (2026-05-27~).
    //   풀 자체가 stage 별 effectiveBase 기준으로 ★ 범위 좁혀짐 → 추가 ★ 거리 감쇠 불필요.
    //   정렬: bestTotal desc (사용자 강점 dot product). 동점 시 그 stage 클리어 count desc tiebreak.
    //   1순위: 8 way / by-hand 매치 — vecL/vecR + 신규 gist
    //   2순위: 양손 평균 매치 — 옛 fallback
    //   3순위: count desc — userVec 자체 없을 때
    const canUseByHand = !!(userVec && userVec.__vecL && userVec.__vecR && weaknessLib && (weaknessLib.chartStrengthMatch8Way || weaknessLib.chartStrengthMatchByHand));
    const sample15 = (cat) => {
      const pool = [...cat.hard, ...cat.easy, ...cat.cleanup];
      for (const r of pool) {
        if (r._matchByHand === undefined) r._matchByHand = canUseByHand ? chartStrengthMatchByHand(r) : null;
        if (r._tags === undefined) r._tags = computeChartTags(r);
        if (r._hashtags === undefined) r._hashtags = computeRecHashtags(r);
      }
      let sorted;
      if (canUseByHand) {
        sorted = [...pool].sort((a, b) => {
          const sa = a._matchByHand ? a._matchByHand.bestTotal : 0;
          const sb = b._matchByHand ? b._matchByHand.bestTotal : 0;
          return (sb - sa) || ((b[countField] || 0) - (a[countField] || 0));
        });
      } else if (userVec) {
        sorted = [...pool].sort((a, b) => {
          const sa = chartStrengthMatch(a);
          const sb = chartStrengthMatch(b);
          return (sb - sa) || ((b[countField] || 0) - (a[countField] || 0));
        });
      } else {
        sorted = [...pool].sort((a, b) => (b[countField] || 0) - (a[countField] || 0));
      }
      return sorted.slice(0, 15);
    };
    const underSample = sample15(underLamp);
    const reachedSample = sample15(reached);

    // 분류 tag 부여 (sample 안에서 다시 hard/easy/cleanup 으로 그룹)
    const tagged = (sample, cat) => {
      const out = { hard: [], easy: [], cleanup: [] };
      const allTagged = new Map();
      ['hard', 'easy', 'cleanup'].forEach(cls => cat[cls].forEach(r => allTagged.set(keyOf(r), cls)));
      for (const r of sample) {
        const cls = allTagged.get(keyOf(r));
        if (cls) out[cls].push(r);
      }
      return out;
    };
    const under = tagged(underSample, underLamp);
    const reach = tagged(reachedSample, reached);

    // 최종 추출 — hard 2 (under 1 + reach 1), easy 4 (2+2), cleanup 4 (2+2)
    // 한 슬롯 부족 시 반대 카테고리의 같은 분류에서 보충 / 그래도 부족하면 전체 풀에서
    const used = new Set();
    const picks = [];
    const SLOTS = [
      { primary: under.hard,    fallback: reach.hard,    n: 1 },
      { primary: reach.hard,    fallback: under.hard,    n: 1 },
      { primary: under.easy,    fallback: reach.easy,    n: 2 },
      { primary: reach.easy,    fallback: under.easy,    n: 2 },
      { primary: under.cleanup, fallback: reach.cleanup, n: 2 },
      { primary: reach.cleanup, fallback: under.cleanup, n: 2 },
    ];
    for (const s of SLOTS) {
      // primary 에서 우선
      const avail1 = shuffle(s.primary).filter(r => !used.has(keyOf(r)));
      const taken1 = avail1.slice(0, s.n);
      taken1.forEach(r => used.add(keyOf(r)));
      picks.push(...taken1);
      // 부족분은 같은 분류의 반대 카테고리에서 보충
      const short = s.n - taken1.length;
      if (short > 0) {
        const avail2 = shuffle(s.fallback).filter(r => !used.has(keyOf(r)));
        const taken2 = avail2.slice(0, short);
        taken2.forEach(r => used.add(keyOf(r)));
        picks.push(...taken2);
      }
    }
    // 분류 안 fallback 모두 실패해도 합계가 부족하면 마지막으로 전체 풀 (분류 무관) 에서 보충.
    let need = 10 - picks.length;
    if (need > 0) {
      const allCands = [...underSample, ...reachedSample];
      const rest = allCands.filter(r => !used.has(keyOf(r)));
      picks.push(...shuffle(rest).slice(0, need));
    }
    return picks.sort((a, b) => a.diffValue - b.diffValue);
  };

  // (2026-05-27~) buildExhRecs 제거 — EXH 도 buildRecs(6, 'exh') 새 룰로 통일.
  //   buildPools 의 effectiveBase = baseStar + 2, 정리곡만 (약/강도전 없음).

  // 약점보완 추천 (2026-05-27~) — chartWeaknessMatchByHand 의 bestTotal (= -strength) 기반.
  //   bestTotal 양수면 약점 차트 (FLIP best 까지 고려) — 값 클수록 약점 정도 큼.
  //   정렬은 asc (점진학습 — 약점 살짝 드러나는 곡부터).
  //   ★ 상한 — 사용자가 EC 이상 (lampNum >= 4) 클리어한 차트의 zasaLevel max 이하 (= topClearZasa).
  //            "지금 칠 수 있는 최고 난이도" 안에서만 약점보완 곡 추천 → 절벽 없음.
  //   대상 feature subset (mode 옵션):
  //     'all' (default): NOTES/CHORD/PEAK/PHRASE/JACK/TRILL/RAND (7개, SOF-LAN/SCRATCH/CHARGE 제외)
  //     'CHARGE' / 'SCRATCH' / 'SOF-LAN': 단일 feature 전용
  //   기타 opts:
  //     flipOn   : true (default) / false — UI 토글. ON=8 배치 best, OFF=정규(N/N) 강제.
  //                내부적으로 chartWeaknessMatch8Way 에 flipOn / mirrorOn 동시 전달 (둘 다 같이 ON/OFF).
  //     handMode : 'both' (default) / 'left' / 'right' — 매치 점수 합계의 손 범위.
  //     strength : 1 (default) / 2 / 3 ... — offset 단계. offset = (strength - 1) × topN, slice(offset, offset+topN).
  //     topN     : 5 (default) / 10 / 20
  const WEAKNESS_FEATS = ['NOTES', 'CHORD', 'PEAK', 'PHRASE', 'JACK', 'TRILL', 'RAND'];
  const WEAKNESS_CLEAR_LAMP = 4;   // EC 이상 (lampNum >= 4) 을 "클리어" 로 봄 — topClearZasa 산정 기준
  const WEAKNESS_MODE_FEATS = {
    all:       WEAKNESS_FEATS,
    CHARGE:    ['CHARGE'],
    SCRATCH:   ['SCRATCH'],
    'SOF-LAN': ['SOF-LAN'],
  };
  // CHART2DIFF — patternsMap chartName (DP_HYP 등) → diff 문자열 (HYPER 등). DIFF2CHART 의 역.
  const CHART2DIFF_REC = {};
  if (weaknessLib && weaknessLib.DIFF2CHART) {
    for (const d in weaknessLib.DIFF2CHART) CHART2DIFF_REC[weaknessLib.DIFF2CHART[d]] = d;
  }
  // recLevelMode 인자는 받지 않음 — 약점보완은 일반 추천 lv 토글 무관 (자체 ★ 상한 + 거리 cutoff).
  // 새 약점보완 알고리즘 (2026-05-27~) — zasa 0.1 단위 bin 안의 사용자 평균 rate 대비 deficit 기반.
  //   1. 사용자가 친 곡 (rate>0) 만 풀에 진입 — 안 친 곡은 bin 평균 + 추천 풀 둘 다 제외 (사용자 수준 안에서만 추천)
  //   2. zasa 0.1 단위 bin 의 사용자 EX rate 평균 — bin 곡 < MIN_BIN_N 이면 이웃 bin 결합 (양쪽 ±0.1 씩 확장)
  //   3. deficit = bin 평균 rate - 사용자 rate. deficit > 0 곡들 (= 그 bin 평균보다 못 친 곡) 만 약점 풀
  //   4. mode 별 풀 필터 — 'all' 은 7 feature (NOTES/CHORD/PEAK/PHRASE/JACK/TRILL/RAND) 의 raw pt 필터,
  //                       단일 mode (CHARGE/SCRATCH/SOF-LAN) 는 그 feature 강한 곡만
  //   5. deficit asc 정렬 + 강도 1/2/3 위치 — 1=소(앞, 살짝 부족) / 2=중(중간 median) / 3=대(뒤, 큰 약점)
  //   6. 곡의 top 3 feature (7 feature 안) 추출 — 표시/태그 용. mode 'all' 풀 분류는 곡 자체 (한 풀)
  //   7. _matchByHand — 배치추천 라벨 (8 way best) 표시용. 정렬 영향 X.
  const MIN_BIN_N = 10;
  const buildWeaknessRecs = (baseStar, opts) => {
    if (!userVec || !userVec.__vecL || !userVec.__vecR) return [];
    if (!patternsMap) return [];
    const fsScores = featureScoresMap && featureScoresMap.scores;
    if (!fsScores) return [];  // 새 알고리즘은 feature-scores-slim 필수
    if (baseStar == null) baseStar = 11;
    const mode = (opts && opts.mode) || 'all';
    const feats = WEAKNESS_MODE_FEATS[mode] || WEAKNESS_FEATS;
    const flipOn = !(opts && opts.flipOn === false);
    const handMode = (opts && opts.handMode) || 'both';
    const topN = (opts && typeof opts.topN === 'number') ? opts.topN : 5;
    const strength = (opts && typeof opts.strength === 'number' && opts.strength >= 1) ? opts.strength : 1;
    const zasaMin = (opts && typeof opts.zasaMin === 'number') ? opts.zasaMin : null;
    const zasaMax = (opts && typeof opts.zasaMax === 'number') ? opts.zasaMax : null;
    // ★ 상한
    let topClearZasa = 0;
    for (const c of allCharts) {
      if (typeof c.lampNum !== 'number' || c.lampNum < WEAKNESS_CLEAR_LAMP) continue;
      const k0 = norm(c.title || '') + '|' + c.diff;
      const e0 = ereterMap.get(k0);
      let zasa = null;
      if (e0 && typeof e0.level === 'number') zasa = e0.level;
      else {
        const r0 = ratingMap.get(k0);
        if (r0 && typeof r0.zasaLevel === 'number') zasa = r0.zasaLevel;
      }
      if (zasa != null && zasa > topClearZasa) topClearZasa = zasa;
    }
    const userChartByKey = new Map();
    for (const c of allCharts) userChartByKey.set(norm(c.title || '') + '|' + c.diff, c);

    // 1단계 — 후보 풀 수집 (사용자 친 곡 + mode 필터 + zasa lookup + ★ 상한 / 거리 / 범위 필터 통과)
    const candidates = [];
    for (const sid in patternsMap) {
      const sm = patternsMap[sid];
      if (!sm || !sm.c) continue;
      const title = sm.t || '';
      if (!title) continue;
      for (const cn in sm.c) {
        const diff = CHART2DIFF_REC[cn];
        if (!diff) continue;
        const chartPt = sm.c[cn];
        const gameLevel = chartPt.lv;
        // 사용자 친 곡만 (안 친 곡은 둘 다 제외)
        const uc = userChartByKey.get(norm(title) + '|' + diff);
        if (!uc) continue;
        const exScore = uc.exScore;
        const noteCount = uc.noteCount;
        if (typeof exScore !== 'number' || exScore <= 0) continue;
        if (typeof noteCount !== 'number' || noteCount <= 0) continue;
        const rate = (exScore / (noteCount * 2)) * 100;
        // mode 별 raw pt 필터 (기존 동일)
        const ptL_pre = chartPt.p1 || {};
        const ptR_pre = chartPt.p2 || {};
        const soflanAvg = ((ptL_pre['SOF-LAN'] || 0) + (ptR_pre['SOF-LAN'] || 0)) / 2;
        const chargeAvg = ((ptL_pre.CHARGE || 0) + (ptR_pre.CHARGE || 0)) / 2;
        const scratchAvg = ((ptL_pre.SCRATCH || 0) + (ptR_pre.SCRATCH || 0)) / 2;
        if (mode === 'all') {
          if (soflanAvg > 0) continue;
          if (chargeAvg > 0) continue;
          if (scratchAvg >= 6.35) continue;
        } else if (mode === 'CHARGE')   { if (chargeAvg <= 0) continue; }
        else if (mode === 'SCRATCH')    { if (scratchAvg < 6.35) continue; }
        else if (mode === 'SOF-LAN')    { if (soflanAvg <= 0) continue; }
        // 차트 zasa lookup
        let e = ereterMap.get(norm(title) + '|' + diff);
        if (!e || e.level == null) {
          const r = ratingMap.get(norm(title) + '|' + diff);
          if (r && typeof r.zasaLevel === 'number') {
            e = {
              level: r.zasaLevel,
              ec: typeof r.estEc === 'number' ? r.estEc : null,
              hc: typeof r.estHc === 'number' ? r.estHc : null,
              exh: typeof r.estExh === 'number' ? r.estExh : null,
              ec_n: r.nEcCleared || 0, hc_n: r.nHcCleared || 0, exh_n: r.nExhCleared || 0,
            };
          } else if (typeof zasaAvgByGameLv[gameLevel] === 'number') {
            e = { level: zasaAvgByGameLv[gameLevel], ec: null, hc: null, exh: null, ec_n: 0, hc_n: 0, exh_n: 0 };
          } else continue;
        }
        if (typeof e.level !== 'number') continue;
        if (topClearZasa > 0 && e.level > topClearZasa) continue;
        if (starDistanceWeight(e.level, baseStar) <= 0) continue;
        if (zasaMin != null && e.level < zasaMin) continue;
        if (zasaMax != null && e.level > zasaMax) continue;
        // feature score lookup (top 3 분류용)
        const songFs = fsScores[sid];
        const featScores = songFs && songFs[cn];
        if (!featScores) continue;
        candidates.push({
          sid, cn, title, diff, chartPt,
          zasa: e.level, gameLevel, e, uc, rate, featScores,
          dv: typeof e.exh === 'number' ? e.exh : (typeof e.hc === 'number' ? e.hc : e.level),
        });
      }
    }

    // 2단계 — zasa 0.1 bin 별 사용자 rate 합/카운트 산출
    const binMap = {};
    for (const c of candidates) {
      const bk = (Math.round(c.zasa * 10) / 10).toFixed(1);
      if (!binMap[bk]) binMap[bk] = { sum: 0, n: 0 };
      binMap[bk].sum += c.rate;
      binMap[bk].n += 1;
    }
    // bin 곡 < MIN_BIN_N 이면 이웃 bin 결합 — 양쪽 ±0.1 씩 확장하면서 누적, n >= MIN_BIN_N 되면 멈춤.
    function binMeanFor(targetBk) {
      let sum = 0, n = 0;
      const seen = {};
      function add(bk) {
        if (seen[bk]) return false;
        seen[bk] = true;
        if (binMap[bk]) { sum += binMap[bk].sum; n += binMap[bk].n; return true; }
        return false;
      }
      const t = (Math.round(targetBk * 10) / 10);
      add(t.toFixed(1));
      let step = 1;
      while (n < MIN_BIN_N && step <= 30) {
        const lo = (t - step * 0.1);
        const hi = (t + step * 0.1);
        const a1 = add((Math.round(lo * 10) / 10).toFixed(1));
        const a2 = add((Math.round(hi * 10) / 10).toFixed(1));
        if (!a1 && !a2) {
          // 양쪽 모두 빈 bin — 다음 step 으로 (zasa 분포 띄엄띄엄일 수 있음)
        }
        step += 1;
      }
      return n > 0 ? sum / n : null;
    }
    for (const c of candidates) {
      c.binMean = binMeanFor(c.zasa);
      c.deficit = (c.binMean != null) ? (c.binMean - c.rate) : 0;
    }

    // 3단계 — deficit > 0 (bin 평균보다 못 친 곡) 만 풀.
    //   top 3 feature 분류 — 7 feature 안에서. 표시용 + mode 'all' 풀의 hashtag 활용.
    const pool = [];
    for (const c of candidates) {
      if (c.deficit <= 0) continue;
      // top 3 feature (7 feature subset 에서) 추출 — 단일 mode 도 같은 계산 (정보용)
      const arr = [];
      for (let fi = 0; fi < WEAKNESS_FEATS.length; fi++) {
        const f = WEAKNESS_FEATS[fi];
        const s = c.featScores[f];
        if (typeof s !== 'number' || s <= 0) continue;
        arr.push({ f, s });
      }
      arr.sort((a, b) => b.s - a.s);
      c.top3 = arr.slice(0, 3).map((x) => x.f);
      pool.push(c);
    }

    // 4단계 — deficit asc 정렬 + 강도 1/2/3 위치
    pool.sort((a, b) => a.deficit - b.deficit);
    const P = pool.length;
    let startIdx;
    if (strength === 1) startIdx = 0;
    else if (strength >= 3) startIdx = Math.max(0, P - topN);
    else startIdx = Math.max(0, Math.floor((P - topN) / 2));  // 강도 2 = 중간
    const slice = pool.slice(startIdx, startIdx + topN);

    // 5단계 — items 변환 + _matchByHand (8 way best 라벨) + tags/hashtags
    const items = [];
    for (const c of slice) {
      items.push({
        title: c.title, chart: c.diff, level: c.zasa,
        ec: c.e.ec, hc: c.e.hc, exh: c.e.exh,
        ec_n: c.e.ec_n, hc_n: c.e.hc_n, exh_n: c.e.exh_n,
        diffValue: c.dv,
        currentLamp: c.uc ? c.uc.lamp : null,
        margin: baseStar - c.dv,
        gameLevel: c.gameLevel,
        _weaknessScore: c.deficit,
        _weaknessDeficit: c.deficit,
        _weaknessBinMean: c.binMean,
        _weaknessRate: c.rate,
        _weaknessTop3: c.top3,
        _category: 'weakness',
      });
    }
    // _matchByHand — 8 way best 라벨 (표시용, 정렬 영향 X)
    if (weaknessLib && weaknessLib.chartStrengthMatch8Way) {
      for (let i = 0; i < items.length; i++) {
        const r = items[i];
        const c = slice[i];
        const w8 = weaknessLib.chartStrengthMatch8Way(c.chartPt, userVec,
          { feats, handMode, flipOn, mirrorOn: flipOn });
        if (w8 && w8.best) {
          r._matchByHand = {
            bestTotal: w8.bestTotal, bestLabel: w8.bestLabel, best: w8.best,
            L: w8.best.L, R: w8.best.R,
            flip: w8.best.flip, mL: w8.best.mL, mR: w8.best.mR,
            total: w8.best.total, results: w8.results,
          };
        }
      }
    }
    const top = items;
    for (const r of top) {
      if (r._tags === undefined) r._tags = computeChartTags(r);
      if (r._hashtags === undefined) r._hashtags = computeRecHashtags(r);
    }
    return top;
  };

  // EC 는 실력값 없을 때 0.3 으로 fallback (저렙 진입자도 추천 받을 수 있게)
  // HC / EXH 는 실력값 없으면 빈 배열
  const EC_FALLBACK_BASE = 0.3;
  const REC_LEVEL_MODE_DEFAULT = recBaseStar != null && recBaseStar >= 6 ? 'lv12' : 'all';
  // 추천곡 DJ레벨 미달 풀 기본값 — 'off' (클리어램프 미달 곡만), 토글로 'on' 가능
  const REC_DJ_MODE_DEFAULT = 'off';
  const ecBase = recBaseStar != null ? recBaseStar : EC_FALLBACK_BASE;
  // EC fallback (recBaseStar==null, baseStar=0.3) 케이스는 ★ 거리 cutoff 끄기 — 안 그러면 lv11/12 풀이 통째로 컷됨.
  recsEC.push(...buildRecs(3, 'ec', ecBase, REC_LEVEL_MODE_DEFAULT, REC_DJ_MODE_DEFAULT));
  if (recBaseStar != null) {
    recsHC.push(...buildRecs(5, 'hc', recBaseStar, REC_LEVEL_MODE_DEFAULT, REC_DJ_MODE_DEFAULT));
    recsEXH.push(...buildRecs(6, 'exh', recBaseStar, REC_LEVEL_MODE_DEFAULT, REC_DJ_MODE_DEFAULT));
  }
  // 약점보완 — userVec.__vecL/__vecR 있어야 동작. default (FLIP on + 양손 통합, 합산 mode, top 5). UI 토글로 변경 가능.
  //   recLevelMode (lv12 / lv11+12 / all) 와 무관 — 약점보완은 자체 ★ 상한 (topClearZasa) + 거리 cutoff 로 좁힘.
  recsWeakness.push(...buildWeaknessRecs(recBaseStar, { flipOn: true, handMode: 'both', mode: 'all', topN: 5, strength: 1, zasaMin: 11.6, zasaMax: 12.7 }));
  // window.__dp_rerollWeakness(opts) — ohsorryRender UI 토글에서 호출. opts: { flipOn, handMode, mode, topN, strength }
  window.__dp_rerollWeakness = (opts) => buildWeaknessRecs(recBaseStar, opts || {});
  console.log(`[step2] 추천곡: EC ${recsEC.length}, HC ${recsHC.length}, EXH ${recsEXH.length}, 약점보완 ${recsWeakness.length}`);

  const topEC  = recsEC;
  const topHC  = recsHC;
  const topEXH = recsEXH;
  const topWeakness = recsWeakness;

  // 다시 뽑기 버튼에서 사용할 수 있도록 노출
  // (panel 생성 후 클릭으로 재호출 → DOM 부분 업데이트)
  window.__dp_rerollRecs = (stage, baseStarOverride, recLevelMode, djMode) => {
    const base = typeof baseStarOverride === 'number' ? baseStarOverride : recBaseStar;
    const lvMode = recLevelMode === 'lv12' ? 'lv12' : REC_LEVEL_MODE_DEFAULT;
    const dMode = djMode === 'on' ? 'on' : 'off';
    if (stage === 'exh') return base != null ? buildRecs(6, 'exh', base, lvMode, dMode) : [];
    if (stage === 'hc')  return base != null ? buildRecs(5, 'hc', base, lvMode, dMode) : [];
    // EC reroll 도 base==null 이면 EC_FALLBACK_BASE + ★ 거리 cutoff 끄기 (초기 계산과 동일).
    if (stage === 'ec')  return buildRecs(3, 'ec', base != null ? base : EC_FALLBACK_BASE, lvMode, dMode);
    return [];
  };

  // -------- 6. 결과 → ohsorryRender 모듈로 전달 (panel build + supabase upload 는 render 가 담당) --------

  // user_profiles upsert payload build — DB 모드는 skip (render 가 dbData 체크)
  let dbPayload = null;
  let chartScoreRows = null;
  if (!dbData && profile && profile.iidxId) {
    const iidxIdNorm = profile.iidxId.replace(/-/g, '');
    const nowIso = new Date().toISOString();
    let nPlayedLv12 = 0, fcCount = 0, exhCount = 0, hcCount = 0, nClearedLv12 = 0;
    for (const c of allCharts) {
      if (useOnlyLv12 && c.gameLevel !== 12) continue;
      const e = ereterMap.get(norm(c.title) + '|' + c.diff);
      if (!e || e.level == null || e.level < 11.6 || e.level > 12.7) {
        const r = ratingMap.get(norm(c.title) + '|' + c.diff);
        if (r && r.zasaLevel >= 11.6 && r.zasaLevel <= 12.7) {
          if (c.lampNum > 0) nPlayedLv12++;
          if (c.lampNum >= 3) nClearedLv12++;
          if (c.lampNum >= 5) hcCount++;
          if (c.lampNum >= 6) exhCount++;
          if (c.lampNum === 7) fcCount++;
        }
        continue;
      }
      if (c.lampNum > 0) nPlayedLv12++;
      if (c.lampNum >= 3) nClearedLv12++;
      if (c.lampNum >= 5) hcCount++;
      if (c.lampNum >= 6) exhCount++;
      if (c.lampNum === 7) fcCount++;
    }
    dbPayload = {
      iidx_id: iidxIdNorm,
      dj_name: profile.djName || null,
      star_estimate: starEstimate != null ? Number(starEstimate.toFixed(4)) : null,
      ereter_star: eraterTrueStar != null ? Number(eraterTrueStar) : null,
      raw_s: starRaw != null ? Number(starRaw.toFixed(4)) : null,
      version: dbVersionString,
      sp_rank: profile.spRank || null,
      dp_rank: profile.dpRank || null,
      n_cleared: nClearedLv12,
      n_played_lv12: nPlayedLv12,
      fc_count: fcCount,
      hc_count: hcCount,
      exh_count: exhCount,
      level_filter: 'lv12',
      series: SERIES,
      // v3.3.6 core 0.0.345 — charts_json=null. user_chart_scores 가 single source of truth.
      //   게스트 페이지 서열표는 get_user_charts RPC 로 fallback. INFOhSorry / ereter backfill 도 동일.
      //   디스크 부담 큰 jsonb (~270KB/user) 제거 + 중복 데이터 정리.
      charts_json: null,
      notes_radar: profileHasRadar
        ? { sp: hasRadarData(profile.spRadar) ? profile.spRadar : null, dp: hasRadarData(profile.dpRadar) ? profile.dpRadar : null }
        : null,
    };
    // 점수가 있거나, 한 번이라도 플레이해 램프가 붙은(FAILED 포함) 차트만 — NO PLAY 만 제외
    chartScoreRows = allCharts.filter((c) => c.exScore > 0 || c.lampNum > 0).map((c) => {
      const key = norm(c.title) + '|' + c.diff;
      const r = ratingMap.get(key);
      const e = ereterMap.get(key);
      return {
        played_version: SERIES,
        level: r && typeof r.zasaLevel === 'number' ? r.zasaLevel : (e && typeof e.level === 'number' ? e.level : null),
        title: c.title,
        iidx_id: iidxIdNorm,
        dj_name: profile.djName || null,
        diff: c.diff,
        game_level: c.gameLevel != null ? c.gameLevel : null,
        dj_level: c.djLevel != null ? c.djLevel : null,
        ex_score: c.exScore != null ? c.exScore : null,
        lamp: c.lamp || null,
        date: nowIso,
      };
    });
  }

  // result 객체 — render 가 받아서 panel + supabase upload 진행
  const result = {
    mode, isRival, dbData, wrapperVersion, dbVersionString,
    profile, profileHasRadar, hasRadarData,
    starEstimate, starRaw, starEstimateNew, starEstimateOld,
    starEstimateEreterOnly, starEstimateLv12Only, starEstimateAll, eraterTrueStar,
    allCharts,
    ereterData, zasaSupplemental, ereterMap, zasaMap, ratingMap, ereterExtractedAt,
    ohsorryRecBase,
    topEC, topHC, topEXH, topWeakness,
    pageCount, useOnlyLv12, matched, unmatched, details, perLevel, perLamp,
    recsEC, recsHC, recsEXH, recsWeakness,
    total,
    recBaseMode, recBaseStar,
    recLevelModeDefault: REC_LEVEL_MODE_DEFAULT,
    recDjModeDefault: REC_DJ_MODE_DEFAULT,
    userVec,
    weaknessLib,
    norm, SERIES, shelfLib,
    dbPayload, chartScoreRows,
  };

  // ohsorryRender 모듈은 wrapper 가 미리 fetch 해서 window.OhsorryRender 로 노출했다고 가정.
  // wrapper 가 안 띄웠다면 console.error 만 — 결과 객체는 return 으로 반환되니 호출자가 처리 가능.
  if (window.OhsorryRender && window.OhsorryRender.show) {
    await window.OhsorryRender.show(result);
  } else {
    console.error('[OhsorryCore] window.OhsorryRender 가 없습니다. wrapper 가 ohsorryRender.js 를 fetch 하지 않았을 수 있어요.');
  }

  return result;
  // compute: async (opts) => { ... } 의 본문 끝
  },

  // ===== runFromDb — supabase row 만으로 가벼운 렌더 (게스트 리드미용) =====
  // 외부 lib (oldOSR / OSR / OSR135 / ereter / zasa / textage) 안 받음.
  // dbData 의 값 그대로 사용 — star_estimate, ereter_star 등은 row 에 저장된 값.
  // 추천곡 / 상세통계 / ★ 추정 비교 섹션은 빈 상태 (render 가 graceful 하게 일부만 그림).
  // dbPayload 는 null — 게스트 리드미는 supabase 재업로드 X.
  runFromDb: async (row, opts) => {
    opts = opts || {};
    const wrapperVersion = opts.wrapperVersion || 'light';
    const CORE_VERSION_SHORT = '0.0.344'.replace(/^0\.0\./, '');
    const dbVersionString = `${wrapperVersion}-core${CORE_VERSION_SHORT}`;

    if (!row || !row.iidx_id) {
      console.error('[OhsorryCore.runFromDb] row 가 비어있거나 iidx_id 없음');
      return null;
    }

    const profile = {
      djName: row.dj_name,
      iidxId: row.iidx_id,
      spRank: row.sp_rank,
      dpRank: row.dp_rank,
      spRadar: (row.notes_radar && row.notes_radar.sp) || null,
      dpRadar: (row.notes_radar && row.notes_radar.dp) || null,
      qproImg: null,  // supabase row 에 없음
    };
    const hasRadarData = (r) => r && typeof r === 'object' && Object.keys(r).length > 0;
    const profileHasRadar = hasRadarData(profile.spRadar) || hasRadarData(profile.dpRadar);

    // 곡명 정규화 — 간이 norm (full norm 은 외부 lib 의존)
    const norm = (s) => String(s == null ? '' : s).toLowerCase()
      .replace(/[\s　]+/g, '').normalize('NFKC');

    const result = {
      mode: 'own', isRival: false, dbData: row, wrapperVersion, dbVersionString,
      profile, profileHasRadar, hasRadarData,
      starEstimate: row.star_estimate != null ? Number(row.star_estimate) : null,
      starRaw: row.raw_s != null ? Number(row.raw_s) : null,
      eraterTrueStar: row.ereter_star != null ? Number(row.ereter_star) : null,
      starEstimateNew: null, starEstimateOld: null,
      starEstimateEreterOnly: null, starEstimateLv12Only: null, starEstimateAll: null,
      allCharts: Array.isArray(row.charts_json) ? row.charts_json : [],
      ereterData: [], zasaSupplemental: [],
      ereterMap: new Map(), zasaMap: new Map(), ratingMap: new Map(),
      ereterExtractedAt: null,
      ohsorryRecBase: null,
      topEC: [], topHC: [], topEXH: [], topWeakness: [],
      pageCount: 0, useOnlyLv12: false, matched: 0, unmatched: 0, details: [], perLevel: {}, perLamp: {},
      recsEC: [], recsHC: [], recsEXH: [], recsWeakness: [],
      total: Array.isArray(row.charts_json) ? row.charts_json.length : 0,
      recBaseMode: 'ohsorry', recBaseStar: null,
        norm, SERIES: row.series || '33',
        shelfLib: window.OhSorryShelf || null,
        dbPayload: null,  // 재업로드 X
        chartScoreRows: null,
      };

    if (window.OhsorryRender && window.OhsorryRender.show) {
      await window.OhsorryRender.show(result);
    } else {
      console.error('[OhsorryCore.runFromDb] window.OhsorryRender 없음 — render 모듈 먼저 load 필요');
    }
    return result;
  },
};
// 자동 실행 / 노출 함수 (__dp_render, __dp_render_rival 등) 는 wrapper 가 담당.
// core 자체는 window.OhsorryCore 만 등록하고 종료.
