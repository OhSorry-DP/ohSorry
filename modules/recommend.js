// 오소리 추천 모듈 — calcOhsorryCore.js 의 추천 풀 / 클리어 추천 / 약점 추천 / 배치 추천 / 해시태그 로직 분리.
//
// 분리 목적:
//   - calcOhsorryCore.js 자체가 매우 큰 파일 (~2300 line) → INFOhSorry / 다른 클라이언트가 가볍게 추천만 필요할 때
//     이 작은 모듈만 fetch 해서 사용 가능.
//   - ohSorry 본체 (calcOhsorryCore) / ohSorryWeb / INFOhSorry 셋이 같은 추천 알고리즘 reuse.
//   - 추후 추천 알고리즘 갱신 시 이 파일 한 곳만 갱신.
//
// 의존:
//   - weaknessLib (calcWeakness.js / window.OhsorryWeakness) — chartStrengthMatch / chartStrengthMatch8Way / avgPt 등.
//   - patternsMap (patterns-all-slim.json gist).
//   - userVec (calcUserWeakness 결과 — 사용자 약점 vec).
//
// 사용:
//   const ctx = window.OhsorryRecommend.createContext({
//     userVec, weaknessLib, patternsMap, patternsTitleMap, normFn,
//     seriesNames, textageSeriesByNorm,
//     charts, ratingMap, zasaMap, songsMap, ...  // 큰 함수들이 추가로 받음
//   });
//   const recsEC = ctx.buildRecs(3, 'ec', baseStar, levelMode, djMode);
//   const recsHC = ctx.buildRecs(5, 'hc', baseStar, levelMode, djMode);
//   const recsWeak = ctx.buildWeaknessRecs(baseStar, opts);
//   ctx.setLayoutMode('off');  // 배치 추천 OFF (정규 배치 강제)
//
// UMD — 브라우저 (window.OhsorryRecommend) / Node (module.exports).
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;  // Node
  if (typeof window !== 'undefined') window.OhsorryRecommend = api;        // 브라우저
})(function () {
  'use strict';

  var VERSION = '0.0.10';

  // 차트 패턴 hashtag — 그 곡의 강한 top 3 feature → 한국어 약어.
  //   추천 row hover / 토스트에 "#동치 #계단 #밀도" 식으로 표시.
  //   FEAT_TAG_MAP / KEYS — 모듈 상수.
  var FEAT_TAG_MAP = {
    NOTES: '밀도', CHORD: '동치', PEAK: '순간밀도', CHARGE: '롱잡',
    SCRATCH: '스크', 'SOF-LAN': '변속', PHRASE: '계단',
    JACK: '축연타', TRILL: '트릴', RAND: '난타',
  };
  var FEAT_TAG_KEYS = Object.keys(FEAT_TAG_MAP);

  // 추천 row 전용 hashtag 상수 (카테고리 / 연습 type / 한손 편차 임계치).
  var CATEGORY_TAG_MAP = { hard: '#어려움', easy: '#도전', cleanup: '' };
  var PRACTICE_TAG_MAP = { review: '복습', pattern: '패턴연습', score: '점수회복', practical: '실전연습' };
  var HAND_BIAS_THRESHOLD = 0.3;

  // 계층 랜덤 추출 — 점수순 ranked 배열을 bandCount 개 밴드로 나눠, 밴드별 할당 수만큼 무작위로 뽑음.
  //   목적: 추천 풀(예: 30곡)에서 매번 조금씩 다른 N곡(예: 10곡) → 리롤 / "다시 뽑기" 변동성.
  //   할당: 기본 균등 + 나머지는 상위 밴드부터 (상위권 약간 더 자주). 예) 30곡→10곡, 밴드3 = [4, 3, 3].
  //   밴드가 작아 할당을 못 채우면 남은 곡(leftover)에서 보충. ranked.length <= n 이면 전부 반환.
  function stratifiedSample(ranked, n, bandCount) {
    bandCount = bandCount || 3;
    if (!Array.isArray(ranked) || ranked.length <= n) return (ranked || []).slice();
    var shuffleInPlace = function (a) {
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    };
    var bandSize = Math.ceil(ranked.length / bandCount);
    var base = Math.floor(n / bandCount);
    var rem = n - base * bandCount;
    var out = [];
    var leftover = [];
    for (var b = 0; b < bandCount; b++) {
      var band = shuffleInPlace(ranked.slice(b * bandSize, (b + 1) * bandSize));
      var alloc = base + (b < rem ? 1 : 0);  // 상위 밴드(작은 b)부터 나머지 +1
      var k = Math.min(alloc, band.length);
      out = out.concat(band.slice(0, k));
      leftover = leftover.concat(band.slice(k));
    }
    if (out.length < n) out = out.concat(shuffleInPlace(leftover).slice(0, n - out.length));
    return out;
  }

  // ─── createContext — 추천 관련 함수들을 deps closure 안에 묶어 반환 ────────────
  //
  // deps (필수):
  //   userVec               — calcUserWeakness 결과 ({ ..feature: -1~1, __vecL, __vecR, __entries, ... })
  //   weaknessLib           — window.OhsorryWeakness (calcWeakness.js 의 export)
  //   patternsMap           — patterns-all-slim.json (객체. sid → { t, c: { DP_NOR, DP_HYP, DP_ANO, DP_LEG } })
  //   patternsTitleMap      — { normTitle: sid } 인덱스 (calcOhsorryCore 가 미리 빌드, deps 로 전달)
  //   normFn                — 곡명 정규화 함수 (norm)
  // deps (해시태그용, 선택):
  //   seriesNames           — { "99":"NEW", ... } (series-name.json)
  //   textageSeriesByNorm   — Map<normTitle, series_no> (textage-meta lookup)
  // deps (큰 함수용 — buildPools / buildRecs):
  //   allCharts            — 사용자 차트 array (extractCharts 결과 + ohSorryRating 보강. INFOhSorry 는 TSV 변환)
  //   ereterMap            — Map<norm(title)+'|'+diff, { level, ec, hc, exh, ec_n, hc_n, exh_n }>
  //   ratingMap            — Map<norm(title)+'|'+diff, { zasaLevel, estEc, estHc, estExh, nEcCleared, ..., gameLevel }>
  //   zasaMap              — Map<norm(title)+'|'+diff, { level }> (sub-12 차트 fallback)
  //   zasaAvgByGameLv      — { 8: ..., 9: ..., 10: ... } sub-12 차트 zasa 평균 (low-level 추천 fallback)
  // deps (buildWeaknessRecs — 향후 추가):
  //   (의존성 큰 함수라 다음 단계에서 추가 예정)
  //
  // return: {
  //   chartStrengthMatch, chartStrengthMatchByHand, computeChartTags, computeRecHashtags,
  //   buildPools, buildRecs, buildWeaknessRecs, setLayoutMode, getLayoutMode,
  // }
  function createContext(deps) {
    deps = deps || {};
    var userVec = deps.userVec;
    var weaknessLib = deps.weaknessLib;
    var patternsMap = deps.patternsMap || {};
    var patternsTitleMap = deps.patternsTitleMap || {};
    var normFn = deps.normFn || function (s) { return String(s || '').toLowerCase(); };
    var seriesNames = deps.seriesNames || null;
    var textageSeriesByNorm = deps.textageSeriesByNorm || null;
    var allCharts = deps.allCharts || [];
    var ereterMap = deps.ereterMap || new Map();
    var ratingMap = deps.ratingMap || new Map();
    var zasaMap = deps.zasaMap || new Map();
    var zasaAvgByGameLv = deps.zasaAvgByGameLv || {};
    // buildWeaknessRecs 전용 deps.
    //   featureScoresMap: { scores: { sid: { cn: { feat: 0~100, ... }, ... }, ... } } (feature-scores-slim.json)
    //   isInfChartInSeries: (title, chartName) → boolean. INF 유저 차트 단위 필터 (없으면 모든 차트 통과 — AC user fallback).
    //   pdLayoutMap: { ['title|diff']: bestLabel } — buildWeaknessRecs 가 layoutLabel 기록할 외부 객체 (optional).
    var featureScoresMap = deps.featureScoresMap || null;
    var isInfChartInSeries = typeof deps.isInfChartInSeries === 'function' ? deps.isInfChartInSeries : function () { return true; };
    var pdLayoutMap = deps.pdLayoutMap || null;

    // CHART2DIFF — patternsMap chartName (DP_HYP 등) → diff 문자열 (HYPER 등). weaknessLib.DIFF2CHART 의 역.
    var CHART2DIFF_REC = {};
    if (weaknessLib && weaknessLib.DIFF2CHART) {
      for (var d2c in weaknessLib.DIFF2CHART) CHART2DIFF_REC[weaknessLib.DIFF2CHART[d2c]] = d2c;
    }

    // 약점 추천 모듈 상수 — feature subset / 클리어 lampNum 임계 / bin 최소.
    var WEAKNESS_FEATS = ['NOTES', 'CHORD', 'PEAK', 'PHRASE', 'JACK', 'TRILL', 'RAND'];
    var WEAKNESS_CLEAR_LAMP = 4;
    var MIN_BIN_N = 10;
    var WEAKNESS_MODE_FEATS = {
      all:       WEAKNESS_FEATS,
      // 개별 건반 피처 — '건반'(all) 의 7 feature 를 하나씩 단독 연습. 후보 풀은 all 과 동일(개인차 제외).
      NOTES:     ['NOTES'],
      CHORD:     ['CHORD'],
      PEAK:      ['PEAK'],
      PHRASE:    ['PHRASE'],
      JACK:      ['JACK'],
      TRILL:     ['TRILL'],
      RAND:      ['RAND'],
      // 개인차 — 전용 feature 만.
      CHARGE:    ['CHARGE'],
      SCRATCH:   ['SCRATCH'],
      'SOF-LAN': ['SOF-LAN'],
    };

    // maxClearGameLevel — 사용자가 EC 이상 클리어한 차트 중 최고 game level. low-level 추천 + practiceZasaDefault 산정용.
    var maxClearGameLevel = (function () {
      var mx = 0;
      for (var ci = 0; ci < allCharts.length; ci++) {
        var c = allCharts[ci];
        if (typeof c.gameLevel === 'number' && typeof c.lampNum === 'number' && c.lampNum >= 3) {
          if (c.gameLevel > mx) mx = c.gameLevel;
        }
      }
      return mx;
    })();
    // practiceZasaDefault — 사용자가 클리어 (lampNum>=3) 한 차트들의 zasa 최고값 기준 -1.0 범위 (max=최고값). 이력 없으면 5.9~6.9 고정.
    var practiceZasaDefault = (function () {
      var topClearZasa = 0;
      for (var ci = 0; ci < allCharts.length; ci++) {
        var c = allCharts[ci];
        if (typeof c.lampNum !== 'number' || c.lampNum < 3) continue;
        var k0 = normFn(c.title || '') + '|' + c.diff;
        var e0 = ereterMap.get(k0);
        var zasa = null;
        if (e0 && typeof e0.level === 'number') zasa = e0.level;
        else {
          var r0 = ratingMap.get(k0);
          if (r0 && typeof r0.zasaLevel === 'number') zasa = r0.zasaLevel;
          else {
            // sub-12 (11렙 등) 차트는 ereter/rating 에 없고 zasaMap 에만 있음 — fallback 추가.
            var z0 = zasaMap.get(k0);
            if (z0 && typeof z0.level === 'number') zasa = z0.level;
          }
        }
        if (zasa != null && zasa > topClearZasa) topClearZasa = zasa;
      }
      if (topClearZasa > 0) return { min: +(topClearZasa - 1).toFixed(1), max: topClearZasa };
      // 최대 클리어 zasa 이력 없으면 (game level 무관) 입문 범위 고정.
      return { min: 5.9, max: 6.9 };
    })();

    // 배치 추천 토글 — 'on' = 8 배치 best (default), 'off' = 정규 N/N 강제.
    //   chartStrengthMatchByHand 가 chartStrengthMatch8Way 의 opts 로 활용.
    //   외부 (UI 토글) 가 setLayoutMode 로 갱신.
    var layoutModeForClear = 'on';

    // ─── 차트 매칭 함수 ────────────────────────────────────────────────
    // 양손 합산 — fallback (8 way / by hand 못 쓸 때 정렬용). 0 = 매칭 불가.
    function chartStrengthMatch(r) {
      if (!userVec || !weaknessLib) return 0;
      var sid = patternsTitleMap[normFn(r.title || '')];
      if (!sid) return 0;
      var cn = weaknessLib.DIFF2CHART[r.chart];
      if (!cn || !patternsMap[sid] || !patternsMap[sid].c[cn]) return 0;
      return weaknessLib.chartStrengthMatch(patternsMap[sid].c[cn], userVec);
    }

    // 손 분리 + FLIP / 8 배치 매치 — bestTotal / bestLabel / mirror·flip 부호 등 반환.
    //   chartStrengthMatch8Way 우선 (8 배치), 옛 gist 면 chartStrengthMatchByHand fallback (2 배치).
    //   layoutModeForClear === 'off' 면 정규 N/N 강제 (mirror/flip 안 비교).
    function chartStrengthMatchByHand(r, normalize) {
      if (!userVec || !userVec.__vecL || !userVec.__vecR || !weaknessLib) return null;
      var sid = patternsTitleMap[normFn(r.title || '')];
      if (!sid) return null;
      var cn = weaknessLib.DIFF2CHART[r.chart];
      if (!cn || !patternsMap[sid] || !patternsMap[sid].c[cn]) return null;
      var chartC = patternsMap[sid].c[cn];
      if (weaknessLib.chartStrengthMatch8Way) {
        var w8Opts = layoutModeForClear === 'off' ? { flipOn: false, mirrorOn: false } : {};
        if (normalize) w8Opts.normalize = true;
        var w8 = weaknessLib.chartStrengthMatch8Way(chartC, userVec, w8Opts);
        if (!w8) return null;
        return {
          bestTotal: w8.bestTotal,
          bestLabel: w8.bestLabel,
          best: w8.best,
          L: w8.best.L, R: w8.best.R,
          flip: w8.best.flip, mL: w8.best.mL, mR: w8.best.mR,
          total: w8.best.total,
          results: w8.results,
          bestNorm: w8.bestNorm,
        };
      }
      // 옛 gist fallback
      if (weaknessLib.chartStrengthMatchByHand) {
        var w = weaknessLib.chartStrengthMatchByHand(chartC, userVec.__vecL, userVec.__vecR);
        var isF = w.best === 'flip';
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
    }

    // 차트 feature top 3 → 한국어 약어 (밀도/동치/계단 등).
    function computeChartTags(r) {
      if (!weaknessLib || !weaknessLib.avgPt) return [];
      var sid = patternsTitleMap[normFn(r.title || '')];
      if (!sid) return [];
      var cn = weaknessLib.DIFF2CHART[r.chart];
      if (!cn || !patternsMap[sid] || !patternsMap[sid].c[cn]) return [];
      var pt = weaknessLib.avgPt(patternsMap[sid].c[cn]);
      var arr = FEAT_TAG_KEYS.map(function (f) { return { f: f, v: pt[f] || 0 }; });
      arr.sort(function (a, b) { return b.v - a.v; });
      return arr.slice(0, 3).filter(function (x) { return x.v > 0; }).map(function (x) { return FEAT_TAG_MAP[x.f]; });
    }

    // 추천 row 의 hashtag 배열 — 카테고리(필수) / 시리즈명 / 클리어가능성 / FLIP·미러·한손 편차 / pattern top 3.
    //   ohsorryRender 가 hover/toast 에 그대로 표시.
    function computeRecHashtags(r) {
      var tags = [];
      if (r._category && CATEGORY_TAG_MAP[r._category]) tags.push(CATEGORY_TAG_MAP[r._category]);
      // 시리즈명 — textage-meta lookup. 미매핑/실패 시 skip.
      if (seriesNames) {
        var sno = textageSeriesByNorm ? textageSeriesByNorm.get(normFn(r.title || '')) : null;
        var sname = sno != null ? seriesNames[String(sno)] : null;
        if (sname) tags.push('#' + sname);
      }
      if (r._clearScore != null) {
        if (r._clearScore >= 0.72) tags.push('#가능성높음');
        else if (r._clearScore < 0.45) tags.push('#도전권');
        if (r._clearType === 'near-lamp') tags.push('#램프근접');
        else if (r._clearType === 'score-ready') tags.push('#점수충분');
        else if (r._clearType === 'popular') tags.push('#검증곡');
      }
      if (r._category === 'weakness') {
        tags.push('#연습');
        if (r._practiceType && PRACTICE_TAG_MAP[r._practiceType]) tags.push('#' + PRACTICE_TAG_MAP[r._practiceType]);
      }
      var m = r._matchByHand;
      if (m) {
        if (m.bestLabel) {
          if (m.flip) tags.push('#FLIP');
          if (m.mL && m.mR) tags.push('#쌍미러');
          else if (m.mL) tags.push('#좌미러');
          else if (m.mR) tags.push('#우미러');
        }
        // 한 손 위주 — best 배치의 |L−R| / max(L,R) ≥ 30%.
        var l = m.L || 0;
        var rh = m.R || 0;
        var mxLR = l > rh ? l : rh;
        if (mxLR > 0 && Math.abs(l - rh) / mxLR >= HAND_BIAS_THRESHOLD) {
          tags.push(l > rh ? '#왼손위주' : '#오른손위주');
        }
      }
      // pattern feature top 3
      var pt = r._tags || computeChartTags(r);
      if (pt && pt.length > 0) for (var i = 0; i < pt.length; i++) tags.push('#' + pt[i]);
      return tags;
    }

    // ─── 큰 함수들 (다음 turn 에서 옮김) ────────────────────────────────────
    //
    // - buildPools(threshold, getDiffField, baseStar, recLevelMode, djMode)
    //   → { underLamp: {hard,easy,cleanup}, reached: {hard,easy,cleanup} }
    //   필요 deps: charts (allCharts ratingMap 매핑), ratingMap, zasaMap, weaknessLib (이미)
    //
    // - buildRecs(threshold, getDiffField, baseStar, recLevelMode, djMode)
    //   → 10개 추천곡 array (각 row 에 _clearScore / _matchByHand / _tags / _hashtags 부착)
    //   buildPools 호출 + sample15 + 분류 tag + 최종 추출.
    //
    // - buildWeaknessRecs(baseStar, opts)
    //   → 약점 기반 추천 (분석탭의 약점 카드와 같은 풀).
    //
    // ─── buildPools ─────────────────────────────────────────────────
    // 추천 풀 — 카테고리 (미도달 lampNum < threshold / 도달DJ미도달) × 분류 (hard / easy / cleanup).
    //
    // 새 룰 (calcOhsorryCore 2026-05-27~) — stage 별 effectiveBase + d 기반:
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
    //     정리곡만 (cleanup) = [0, effectiveBase). dv ≥ effectiveBase → 풀 제외
    function buildPools(threshold, getDiffField, baseStar, recLevelMode, djMode) {
      var empty = { hard: [], easy: [], cleanup: [] };
      var underLamp = { hard: [], easy: [], cleanup: [] };
      var reached   = { hard: [], easy: [], cleanup: [] };
      if (baseStar == null) return { underLamp: empty, reached: empty };
      var isLowLevelRec = recLevelMode === 'low';
      var maxClearGameLevel = 0;
      for (var ci = 0; ci < allCharts.length; ci++) {
        var c0 = allCharts[ci];
        if (typeof c0.gameLevel === 'number' && typeof c0.lampNum === 'number' && c0.lampNum >= 3) {
          if (c0.gameLevel > maxClearGameLevel) maxClearGameLevel = c0.gameLevel;
        }
      }
      var lowAllowedLevels = maxClearGameLevel >= 12 ? [10, 11, 12]
        : maxClearGameLevel >= 11 ? [10, 11]
        : [8, 9, 10];
      var isEC = getDiffField === 'ec';
      var isHC = getDiffField === 'hc';
      var isEXH = getDiffField === 'exh';
      // 그 stage 클리어 한 차트들의 ★ 중 최댓값
      var topClearStar = 0;
      for (var ci2 = 0; ci2 < allCharts.length; ci2++) {
        var c1 = allCharts[ci2];
        if (c1.lampNum < threshold) continue;
        var e0 = ereterMap.get(normFn(c1.title) + '|' + c1.diff);
        if (!e0 || typeof e0[getDiffField] !== 'number') continue;
        if (e0[getDiffField] > topClearStar) topClearStar = e0[getDiffField];
      }
      var effectiveBase = isEC  ? (baseStar - 0.5)
                        : isEXH ? (baseStar + 2)
                        : baseStar;  // HC
      var d = Math.max(0, topClearStar - effectiveBase);
      var hardMin = effectiveBase + 0.65 * d;
      // hard 상한 — 기본은 내 최고기록(topClearStar)보다 0.3d 위까지 허용.
      //   EC(이지클) 는 도전곡이 과하게 어렵다는 피드백 → 0.15d 로 완화.
      var hardMax = isEC ? topClearStar + 0.15 * d : topClearStar + 0.3 * d;
      var easyMin = effectiveBase;
      // stage 별 정확도 임계치 — EC: A 이상이면 OK / HC: AA 이상 / EXH: AAA 만
      var accuracyOK = function (djLv) {
        if (isEXH) return djLv === 'AAA';
        if (isHC)  return djLv === 'AAA' || djLv === 'AA';
        return djLv === 'AAA' || djLv === 'AA' || djLv === 'A';
      };
      var reachedStageLamp = function (lampN) {
        if (isEXH) return lampN >= 6;       // EX/FC/PFC + AAA 미도달
        if (isHC)  return lampN === 5;      // HC + AA 미도달
        return lampN === 3 || lampN === 4;  // EC/NC + A 미도달
      };
      for (var i = 0; i < allCharts.length; i++) {
        var c = allCharts[i];
        if (isLowLevelRec && (c.gameLevel == null || lowAllowedLevels.indexOf(c.gameLevel) === -1)) continue;
        if (recLevelMode === 'lv12' && c.gameLevel !== 12) continue;
        if (recLevelMode === 'lv11+12' && c.gameLevel !== 11 && c.gameLevel !== 12) continue;
        var under = c.lampNum < threshold;
        var reachedForDj = reachedStageLamp(c.lampNum);
        // DJ레벨 미달 풀 제외 모드 — 클리어램프 미달 곡만 후보로
        if (djMode === 'off' && !under) continue;
        if (!under && !reachedForDj) continue;
        if (reachedForDj && accuracyOK(c.djLevel)) continue;
        if (reachedForDj && c.exScore === 0) continue;
        var e = ereterMap.get(normFn(c.title) + '|' + c.diff);
        var gameLevel = (typeof c.gameLevel === 'number') ? c.gameLevel : null;
        var ratingOnly = false;
        if (!e || e.level == null) {
          var rRat = ratingMap.get(normFn(c.title) + '|' + c.diff);
          if (rRat && typeof rRat.zasaLevel === 'number') {
            e = {
              level: rRat.zasaLevel,
              ec: typeof rRat.estEc === 'number' ? rRat.estEc : null,
              hc: typeof rRat.estHc === 'number' ? rRat.estHc : null,
              exh: typeof rRat.estExh === 'number' ? rRat.estExh : null,
              ec_n: rRat.nEcCleared || 0,
              hc_n: rRat.nHcCleared || 0,
              exh_n: rRat.nExhCleared || 0,
            };
            gameLevel = rRat.gameLevel != null ? rRat.gameLevel : gameLevel;
            ratingOnly = true;
          } else if (isLowLevelRec && typeof c.gameLevel === 'number') {
            var z = zasaMap.get(normFn(c.title) + '|' + c.diff);
            var lowLv = c.gameLevel;
            var lowBase = lowLv === 8 ? 0.20 : lowLv === 9 ? 0.45 : 0.70;
            e = {
              level: z && typeof z.level === 'number' ? z.level : (typeof zasaAvgByGameLv[lowLv] === 'number' ? zasaAvgByGameLv[lowLv] : lowLv),
              ec: lowBase,
              hc: lowBase + 0.28,
              exh: lowBase + 0.58,
              ec_n: 0, hc_n: 0, exh_n: 0,
              __lowFallback: true,
            };
            gameLevel = lowLv;
            ratingOnly = true;
          } else continue;
        }
        var dv = e[getDiffField];
        if (typeof dv !== 'number') continue;
        var item = {
          title: c.title, chart: c.diff, level: e.level,
          ec: e.ec, hc: e.hc, exh: e.exh,
          ec_n: e.ec_n, hc_n: e.hc_n, exh_n: e.exh_n,
          diffValue: dv, currentLamp: c.lamp,
          margin: baseStar - dv,
          gameLevel: gameLevel,
          ratingOnly: ratingOnly,
          lampNum: c.lampNum,
          djLevel: c.djLevel || null,
          exScore: c.exScore,
          noteCount: c.noteCount,
          scoreRate: (typeof c.exScore === 'number' && typeof c.noteCount === 'number' && c.noteCount > 0)
            ? (c.exScore / (c.noteCount * 2)) * 100
            : null,
          _hideDiffValue: !!e.__lowFallback,
        };
        // dv 기반 분류
        var cls;
        if (isLowLevelRec) {
          if (c.gameLevel <= 8) cls = 'cleanup';
          else if (c.gameLevel === 9) cls = 'easy';
          else cls = 'hard';
        } else if (isEXH) {
          if (dv >= effectiveBase) continue;
          cls = 'cleanup';
        } else {
          if (dv > hardMax) continue;
          if (dv >= hardMin) cls = 'hard';
          else if (dv >= easyMin) cls = 'easy';
          else {
            if (isEC && typeof e.hc === 'number' && e.hc < baseStar - 3) continue;
            cls = 'cleanup';
          }
        }
        item._category = cls;
        (reachedForDj ? reached : underLamp)[cls].push(item);
      }
      return { underLamp: underLamp, reached: reached };
    }

    // ─── buildRecs ──────────────────────────────────────────────────
    // 한 stage (EC / HC / EXH) 의 10개 추천곡 array 반환.
    //   buildPools 호출 → cleanup/easy/hard 분류 → 각 row enrich (clearScore / matchByHand / tags / hashtags)
    //   → sample15 (top 15 + cleanup 50/50 보정) → 최종 추출 (underTarget 우선, djMode='on' 면 reached 2곡 섞음)
    function buildRecs(threshold, getDiffField, baseStar, recLevelMode, djMode, opts) {
      var pools = buildPools(threshold, getDiffField, baseStar, recLevelMode, djMode);
      // 풀 / 랜덤 옵션 (옵션 없으면 기존 결정적 동작 100% 보존):
      //   opts.randomize  — true 면 풀에서 stratifiedSample 로 LIMIT 곡 추출 (리롤마다 변동).
      //   opts.withPool   — true 면 { picked, pool } 반환 (INFOhSorry refill 용. pool = 나머지 후보).
      //   opts.limit      — 표시 곡 수 (default 10).
      //   opts.poolSize   — 후보 풀 크기 (default 30). randomize/withPool 일 때만 풀 확대.
      opts = opts || {};
      var scoreMode = opts.scoreMode === 'v2' ? 'v2' : 'v1';   // v2 = 28dim 배치적합(matchScore) 주력 점수식. 기본 v1 = 기존 동작.
      var LIMIT = typeof opts.limit === 'number' ? opts.limit : 10;
      var RANDOMIZE = !!opts.randomize;
      var WANT_POOL = !!opts.withPool;
      var POOL_N = (RANDOMIZE || WANT_POOL) ? (typeof opts.poolSize === 'number' ? opts.poolSize : 30) : LIMIT;
      var SAMPLE_SIZE = (RANDOMIZE || WANT_POOL) ? POOL_N : 15;
      var FACTOR = POOL_N / 10;                                   // 슬롯 분배 수 스케일 (default 1 = 기존 그대로)
      var slotN = function (x) { return Math.max(1, Math.round(x * FACTOR)); };
      // 후보 모음(picks, 최대 POOL_N) → 점수순 정렬 → randomize 면 계층추출, withPool 이면 {picked,pool}.
      var finalizeRecs = function (arr) {
        var rankedArr = arr.slice().sort(function (a, b) { return (b._clearScore || 0) - (a._clearScore || 0); });
        if (WANT_POOL) {
          var pickedArr = RANDOMIZE ? stratifiedSample(rankedArr, LIMIT) : rankedArr.slice(0, LIMIT);
          var pk = {};
          for (var pj = 0; pj < pickedArr.length; pj++) pk[(pickedArr[pj].title || '') + '|' + pickedArr[pj].chart] = 1;
          var poolArr = rankedArr.filter(function (r) { return !pk[(r.title || '') + '|' + r.chart]; });
          return { picked: pickedArr, pool: poolArr };
        }
        if (RANDOMIZE) return stratifiedSample(rankedArr, LIMIT);
        return rankedArr.slice(0, LIMIT);
      };
      var underLamp = pools.underLamp;
      var reached = pools.reached;
      var countField = getDiffField + '_n';
      var keyOf = function (r) { return (r.title || '') + '|' + r.chart; };
      var isLowLevelRec = recLevelMode === 'low';
      var clamp01 = function (v) { return Math.max(0, Math.min(1, v)); };
      var djRankScore = function (djLv) {
        var m = { F: 0, E: 0.1, D: 0.2, C: 0.35, B: 0.5, A: 0.68, AA: 0.84, AAA: 1 };
        return m[djLv] != null ? m[djLv] : 0;
      };
      var stageRateTarget = getDiffField === 'exh' ? 89 : getDiffField === 'hc' ? 82 : 74;
      var stageRateWidth  = getDiffField === 'exh' ? 10 : getDiffField === 'hc' ? 12 : 14;
      var layoutKey = function (m) {
        if (!m) return 0;
        return typeof m.bestTotal === 'number' ? m.bestTotal : (m.total || 0);
      };
      // 한 row 에 _clearScore / _layoutGain / _clearType 부착. 이미 계산되어 있으면 skip.
      var enrichClearCandidate = function (r) {
        if (r._clearScore !== undefined) return r;
        var diffFit = clamp01(1 - Math.abs(r.diffValue - baseStar) / (getDiffField === 'exh' ? 3.2 : 2.4));
        var underGap = Math.max(0, threshold - (typeof r.lampNum === 'number' ? r.lampNum : 0));
        var lampFit = r.lampNum >= threshold
          ? 0.74
          : clamp01(1 - (underGap - 1) / 4);
        var rateFit = typeof r.scoreRate === 'number'
          ? clamp01((r.scoreRate - (stageRateTarget - stageRateWidth)) / stageRateWidth)
          : 0.35;
        var countRaw = r[countField] || 0;
        var countFit = clamp01(Math.log10(countRaw + 1) / 3);
        var djFit = djRankScore(r.djLevel);
        var layoutFit = r._matchByHand ? clamp01((layoutKey(r._matchByHand) + 12) / 24) : 0.5;
        var layoutGain = r._matchByHand && Array.isArray(r._matchByHand.results)
          ? layoutKey(r._matchByHand) - layoutKey(r._matchByHand.results.find(function (x) { return !x.flip && !x.mL && !x.mR; }))
          : 0;
        var layoutGainFit = clamp01(layoutGain / 8);
        var categoryBoost = r._category === 'cleanup' ? 0.10 : r._category === 'easy' ? 0.04 : -0.03;
        r._layoutGain = layoutGain;
        if (scoreMode === 'v2') {
          // v2 — "어떻게든 깰 수 있는 방향". 28dim 배치적합(matchScore)을 주력으로,
          //   클리어 가능성(난이도·램프·점수)은 가드로 유지(못 깰 곡 차단), 배치이득은 강조(배치 걸면 깰 곡).
          //   matchScore: bestNorm(-1~1, 강점/배치적합) → 0~1. bestNorm 없으면(데이터 미스) 0.5 중립.
          var matchScore = (typeof r._matchNorm === 'number') ? r._matchNorm : 0.5;   // 풀 내 bestNorm min-max 정규화값 (sample15 의 applyMatchNorm 이 설정)
          r._matchScore = matchScore;
          r._clearScore =
            matchScore    * 0.45 +   // 28dim 배치 적합 — 주력 (내 손으로 배치 걸어서라도 칠 수 있는가)
            layoutGainFit * 0.10 +   // 배치 걸면 깰 수 있는 곡 강조
            diffFit       * 0.15 +   // 난이도 가드
            lampFit       * 0.12 +   // 램프 근접 (깰 수 있는지)
            rateFit       * 0.10 +   // 점수 근접
            countFit      * 0.04 +   // 검증곡(클리어 인원)
            djFit         * 0.04 +
            categoryBoost;
        } else {
          r._clearScore =
            diffFit * 0.24 +
            lampFit * 0.18 +
            rateFit * 0.18 +
            countFit * 0.14 +
            layoutFit * 0.14 +
            layoutGainFit * 0.06 +
            djFit * 0.06 +
            categoryBoost;
        }
        if (r.lampNum === threshold - 1 || (typeof r.scoreRate === 'number' && r.scoreRate >= stageRateTarget - 2)) r._clearType = 'near-lamp';
        else if (typeof r.scoreRate === 'number' && r.scoreRate >= stageRateTarget - 5) r._clearType = 'score-ready';
        else if (countFit >= 0.6) r._clearType = 'popular';
        else r._clearType = 'fit';
        return r;
      };

      // 카테고리 내 모든 분류 합쳐서 sample 15 — bestTotal desc top 15.
      //   cleanup 50/50 보정 — cleanup 곡 절반은 bestTotal 낮은 쪽 잘라내고 cleanup 풀 dv asc 곡으로 교체.
      var canUseByHand = !!(userVec && userVec.__vecL && userVec.__vecR && weaknessLib && (weaknessLib.chartStrengthMatch8Way || weaknessLib.chartStrengthMatchByHand));
      // v2 — 풀 내 bestNorm min-max 정규화 → _matchNorm (0~1). 유저 절대 실력 레벨을 제거하고 곡 간 상대 변별만 남김.
      var applyMatchNorm = function (arr) {
        var mn = Infinity, mx = -Infinity;
        for (var ai = 0; ai < arr.length; ai++) {
          var mb = arr[ai]._matchByHand;
          if (mb && typeof mb.bestNorm === 'number') { if (mb.bestNorm < mn) mn = mb.bestNorm; if (mb.bestNorm > mx) mx = mb.bestNorm; }
        }
        var range = mx - mn;
        for (var aj = 0; aj < arr.length; aj++) {
          var mb2 = arr[aj]._matchByHand;
          arr[aj]._matchNorm = (mb2 && typeof mb2.bestNorm === 'number' && range > 0) ? (mb2.bestNorm - mn) / range : 0.5;
        }
      };
      var sample15 = function (cat) {
        var pool = cat.hard.concat(cat.easy, cat.cleanup);
        // 1-pass: 8배치 매치(bestNorm) + 태그 — v2 풀 정규화가 bestNorm 분포를 먼저 알아야 함.
        for (var pi = 0; pi < pool.length; pi++) {
          var r = pool[pi];
          if (r._matchByHand === undefined) r._matchByHand = canUseByHand ? chartStrengthMatchByHand(r, scoreMode === 'v2') : null;
          if (r._tags === undefined) r._tags = computeChartTags(r);
        }
        if (scoreMode === 'v2') applyMatchNorm(pool);
        // 2-pass: 점수화 (matchScore = 풀 정규화된 _matchNorm)
        for (var pj = 0; pj < pool.length; pj++) {
          var r = pool[pj];
          enrichClearCandidate(r);
          if (r._hashtags === undefined) r._hashtags = computeRecHashtags(r);
        }
        var sortByBest = function (a, b) {
          return ((b._clearScore || 0) - (a._clearScore || 0)) ||
            ((b[countField] || 0) - (a[countField] || 0)) ||
            (a.diffValue - b.diffValue);
        };
        var sortByMatch = function (a, b) {
          var sa = chartStrengthMatch(a);
          var sb = chartStrengthMatch(b);
          return ((b._clearScore || 0) - (a._clearScore || 0)) || (sb - sa) || ((b[countField] || 0) - (a[countField] || 0));
        };
        var sorted;
        if (canUseByHand) sorted = pool.slice().sort(sortByBest);
        else if (userVec)  sorted = pool.slice().sort(sortByMatch);
        else               sorted = pool.slice().sort(function (a, b) { return (b[countField] || 0) - (a[countField] || 0); });

        var top15 = sorted.slice(0, SAMPLE_SIZE);
        // cleanup 50/50 교체
        var cleanupKeys = new Set(cat.cleanup.map(keyOf));
        var cleanupInTop = top15.filter(function (r) { return cleanupKeys.has(keyOf(r)); });
        var halfCount = Math.floor(cleanupInTop.length / 2);
        if (halfCount > 0) {
          var cleanupSorted = (canUseByHand ? cleanupInTop.slice().sort(sortByBest)
                                : userVec ? cleanupInTop.slice().sort(sortByMatch)
                                : cleanupInTop.slice());
          var toRemove = new Set(cleanupSorted.slice(-halfCount).map(keyOf));
          top15 = top15.filter(function (r) { return !toRemove.has(keyOf(r)); });
          var usedKeys = new Set(top15.map(keyOf));
          var dvAscPool = cat.cleanup.slice()
            .filter(function (r) { return !usedKeys.has(keyOf(r)); })
            .sort(function (a, b) { return (a.diffValue || 0) - (b.diffValue || 0); });
          top15 = top15.concat(dvAscPool.slice(0, halfCount));
        }
        return top15;
      };
      var underSample = sample15(underLamp);
      var reachedSample = sample15(reached);

      // 분류 tag 부여 (sample 안에서 다시 hard/easy/cleanup 으로 그룹)
      var tagged = function (sample, cat) {
        var out = { hard: [], easy: [], cleanup: [] };
        var allTagged = new Map();
        ['hard', 'easy', 'cleanup'].forEach(function (cls) {
          cat[cls].forEach(function (r) { allTagged.set(keyOf(r), cls); });
        });
        for (var si = 0; si < sample.length; si++) {
          var r2 = sample[si];
          var cls2 = allTagged.get(keyOf(r2));
          if (cls2) out[cls2].push(r2);
        }
        return out;
      };
      var under = tagged(underSample, underLamp);
      var reach = tagged(reachedSample, reached);

      // 최종 추출 — underLamp 우선 (목표 램프 미도달).
      //   djMode='on' 이면 reached (도달DJ미달) 도 섞음 (최대 2곡).
      var used = new Set();
      var picks = [];
      var byClearScore = function (arr) {
        return arr.slice().sort(function (a, b) { return (b._clearScore || 0) - (a._clearScore || 0); });
      };
      var takeFrom = function (arr, n) {
        if (n <= 0) return 0;
        var taken = 0;
        var sortedArr = byClearScore(arr);
        for (var ai = 0; ai < sortedArr.length; ai++) {
          if (taken >= n || picks.length >= POOL_N) break;
          var rr = sortedArr[ai];
          var k = keyOf(rr);
          if (used.has(k)) continue;
          used.add(k);
          picks.push(rr);
          taken += 1;
        }
        return taken;
      };
      if (isLowLevelRec) {
        var underAll = under.cleanup.concat(under.easy, under.hard);
        var lowLevels = Array.from(new Set(
          underAll.map(function (r) { return r.gameLevel; })
                  .filter(function (lv) { return typeof lv === 'number'; })
        )).sort(function (a, b) { return a - b; });
        var targetLv12 = lowLevels.indexOf(12) !== -1 ? 1 : 0;
        var mainLevels = lowLevels.filter(function (lv) { return lv !== 12; });
        var perLevel = mainLevels.length > 0 ? Math.max(1, Math.floor((POOL_N - targetLv12) / mainLevels.length)) : POOL_N - targetLv12;
        for (var li = 0; li < mainLevels.length; li++) {
          var lv = mainLevels[li];
          takeFrom(underAll.filter(function (r) { return r.gameLevel === lv; }), perLevel);
        }
        if (targetLv12 > 0) takeFrom(underAll.filter(function (r) { return r.gameLevel === 12; }), slotN(1));
        if (picks.length < POOL_N) takeFrom(underAll, POOL_N - picks.length);
        if (djMode === 'on' && picks.length < POOL_N) takeFrom(reach.cleanup.concat(reach.easy, reach.hard), POOL_N - picks.length);
        return finalizeRecs(picks);
      }
      var underTargetBase = djMode === 'on' ? 8 : 10;
      var underTarget = Math.round(underTargetBase * FACTOR);
      var underSlots = getDiffField === 'exh'
        ? [
            { pool: under.cleanup, n: underTarget },
            { pool: under.easy,    n: slotN(1) },
            { pool: under.hard,    n: slotN(1) },
          ]
        : getDiffField === 'ec'
        ? [
            // EC — 도전곡(hard) 비중 축소. easy 로 보충.
            { pool: under.cleanup, n: slotN(underTargetBase >= 10 ? 4 : 3) },
            { pool: under.easy,    n: slotN(underTargetBase >= 10 ? 5 : 4) },
            { pool: under.hard,    n: slotN(1) },
          ]
        : [
            { pool: under.cleanup, n: slotN(underTargetBase >= 10 ? 4 : 3) },
            { pool: under.easy,    n: slotN(underTargetBase >= 10 ? 4 : 3) },
            { pool: under.hard,    n: slotN(2) },
          ];
      var underTaken = 0;
      for (var si2 = 0; si2 < underSlots.length; si2++) {
        var s = underSlots[si2];
        underTaken += takeFrom(s.pool, Math.min(s.n, underTarget - underTaken));
      }
      if (underTaken < underTarget) {
        underTaken += takeFrom(under.cleanup.concat(under.easy, under.hard), underTarget - underTaken);
      }
      if (djMode === 'on') {
        takeFrom(reach.cleanup.concat(reach.easy, reach.hard), POOL_N - picks.length);
      }
      // 그래도 부족하면 전체 풀에서 clearScore 순 보충.
      var need = POOL_N - picks.length;
      if (need > 0) {
        var allCands = underSample.concat(reachedSample);
        takeFrom(allCands, need);
      }
      return finalizeRecs(picks);
    }

    // ─── buildWeaknessRecs ──────────────────────────────────────────
    // 연습곡 추천 (calcOhsorryCore 2026-05-27~) — 복습곡 + 신규 패턴곡 + 실전 연습곡 혼합.
    //   '건반'(all) 모드: 7 feature (NOTES/CHORD/PEAK/PHRASE/JACK/TRILL/RAND) — CHARGE/SCRATCH/SOF-LAN 제외.
    //   개별 건반 피처 모드(NOTES/CHORD/...): 해당 feature 단독 — 후보 풀은 all 과 동일(개인차 제외).
    //   CHARGE/SCRATCH/SOF-LAN 모드: 전용 feature 만.
    //   안 친 곡도 후보. 이미 잘 친 (rate>=95) 곡 제외. 평균 미달 곡 복습 가산.
    //
    // opts: { mode, flipOn, handMode, topN, strength, zasaMin, zasaMax }
    //   mode      : 'all' (default) / 개별 건반 'NOTES'|'CHORD'|'PEAK'|'PHRASE'|'JACK'|'TRILL'|'RAND' / 개인차 'CHARGE'|'SCRATCH'|'SOF-LAN'
    //   flipOn    : true (default) / false — UI 토글. ON=8 배치 best, OFF=정규(N/N) 강제
    //   handMode  : 'both' (default) / 'left' / 'right'
    //   strength  : 1 (default) / 2 / 3 — 난이도 강도
    //   topN      : 5 (default)
    //   zasaMin/Max : zasa 범위 (기본 practiceZasaDefault)
    function buildWeaknessRecs(baseStar, opts) {
      if (!userVec || !userVec.__vecL || !userVec.__vecR) return [];
      if (!patternsMap) return [];
      var fsScores = featureScoresMap && featureScoresMap.scores;
      if (!fsScores) return [];  // 새 알고리즘은 feature-scores-slim 필수
      if (baseStar == null) baseStar = 11;
      var mode = (opts && opts.mode) || 'all';
      var feats = WEAKNESS_MODE_FEATS[mode] || WEAKNESS_FEATS;
      var flipOn = !(opts && opts.flipOn === false);
      var handMode = (opts && opts.handMode) || 'both';
      var scoreMode = (opts && opts.scoreMode === 'v2') ? 'v2' : 'v1';   // v2 = 28dim 약점매칭(weakMatchScore) 주력
      var topN = (opts && typeof opts.topN === 'number') ? opts.topN : 5;
      // 풀 + 계층 랜덤 (opts.randomize) — 점수순 상위 POOL_N_W(기본 60) 풀에서 topN 곡을 밴드별 무작위 추출.
      //   리롤마다 변동. opts 없으면(=randomize 미지정) 기존 practiceType 다양성 takeType 로직 유지(결정적).
      var RANDOMIZE_W = !!(opts && opts.randomize);
      var POOL_N_W = RANDOMIZE_W ? ((opts && typeof opts.poolSize === 'number') ? opts.poolSize : 60) : topN;
      var strength = (opts && typeof opts.strength === 'number' && opts.strength >= 1) ? opts.strength : 1;
      var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
      var zasaMin = (opts && typeof opts.zasaMin === 'number') ? opts.zasaMin : practiceZasaDefault.min;
      var zasaMax = (opts && typeof opts.zasaMax === 'number') ? opts.zasaMax : practiceZasaDefault.max;
      var rangeW = Math.max(0.1, zasaMax - zasaMin);
      var targetZasa = strength >= 3 ? (zasaMax - rangeW * 0.2)
                     : strength === 2 ? ((zasaMin + zasaMax) / 2)
                     : (zasaMin + rangeW * 0.35);
      // 상한 안전장치 — 클리어 최고점보다 너무 위만 제외.
      //   topClearZasa   : HC 이상(lampNum>=WEAKNESS_CLEAR_LAMP) 클리어 최고 zasa.
      //   ecTopClearZasa : EC 이상(lampNum>=3) 클리어 최고 zasa.
      //   하드캡 = max(topClearZasa + 0.5, ecTopClearZasa) — 하드클 +0.5 또는 EC클 최고까지 허용.
      var topClearZasa = 0;
      var ecTopClearZasa = 0;
      for (var ci = 0; ci < allCharts.length; ci++) {
        var c = allCharts[ci];
        if (typeof c.lampNum !== 'number' || c.lampNum < 3) continue;
        var k0 = normFn(c.title || '') + '|' + c.diff;
        var e0 = ereterMap.get(k0);
        var zasa = null;
        if (e0 && typeof e0.level === 'number') zasa = e0.level;
        else {
          var r0 = ratingMap.get(k0);
          if (r0 && typeof r0.zasaLevel === 'number') zasa = r0.zasaLevel;
          else {
            // sub-12 (11렙 등) 차트는 ereter/rating 에 없고 zasaMap 에만 있음 — fallback 추가.
            var z0 = zasaMap.get(k0);
            if (z0 && typeof z0.level === 'number') zasa = z0.level;
          }
        }
        if (zasa == null) continue;
        if (zasa > ecTopClearZasa) ecTopClearZasa = zasa;
        if (c.lampNum >= WEAKNESS_CLEAR_LAMP && zasa > topClearZasa) topClearZasa = zasa;
      }
      // 하드캡 — HC클 +0.5 와 EC클 최고 중 큰 값. HC 클리어 이력 없으면(topClearZasa=0) 미적용.
      var zasaHardCap = Math.max(topClearZasa + 0.5, ecTopClearZasa);
      var userChartByKey = new Map();
      for (var ci2 = 0; ci2 < allCharts.length; ci2++) {
        var cc = allCharts[ci2];
        userChartByKey.set(normFn(cc.title || '') + '|' + cc.diff, cc);
      }

      // 1단계 — 후보 풀 수집.
      var candidates = [];
      for (var sid in patternsMap) {
        if (!Object.prototype.hasOwnProperty.call(patternsMap, sid)) continue;
        var sm = patternsMap[sid];
        if (!sm || !sm.c) continue;
        var title = sm.t || '';
        if (!title) continue;
        for (var cn in sm.c) {
          if (!Object.prototype.hasOwnProperty.call(sm.c, cn)) continue;
          var diff = CHART2DIFF_REC[cn];
          if (!diff) continue;
          if (!isInfChartInSeries(title, cn)) continue;
          var chartPt = sm.c[cn];
          var gameLevel = chartPt.lv;
          var ptL_pre = chartPt.p1 || {};
          var ptR_pre = chartPt.p2 || {};
          var soflanAvg = ((ptL_pre['SOF-LAN'] || 0) + (ptR_pre['SOF-LAN'] || 0)) / 2;
          var chargeAvg = ((ptL_pre.CHARGE || 0) + (ptR_pre.CHARGE || 0)) / 2;
          var scratchAvg = ((ptL_pre.SCRATCH || 0) + (ptR_pre.SCRATCH || 0)) / 2;
          if (mode === 'CHARGE') {
            if (chargeAvg <= 0 || soflanAvg > 0 || scratchAvg >= 6.35) continue;
          } else if (mode === 'SCRATCH') {
            if (scratchAvg < 6.35 || chargeAvg > 0 || soflanAvg > 0) continue;
          } else if (mode === 'SOF-LAN') {
            if (soflanAvg <= 0 || chargeAvg > 0 || scratchAvg >= 6.35) continue;
          } else {
            // all + 개별 건반 피처(NOTES/CHORD/PEAK/PHRASE/JACK/TRILL/RAND) — 순수 건반곡만(개인차 제외).
            if (soflanAvg > 0) continue;
            if (chargeAvg > 0) continue;
            if (scratchAvg >= 6.35) continue;
          }
          var e = ereterMap.get(normFn(title) + '|' + diff);
          if (!e || e.level == null) {
            var rr = ratingMap.get(normFn(title) + '|' + diff);
            var zz = zasaMap.get(normFn(title) + '|' + diff);
            if (rr && typeof rr.zasaLevel === 'number') {
              e = {
                level: rr.zasaLevel,
                ec: typeof rr.estEc === 'number' ? rr.estEc : null,
                hc: typeof rr.estHc === 'number' ? rr.estHc : null,
                exh: typeof rr.estExh === 'number' ? rr.estExh : null,
                ec_n: rr.nEcCleared || 0, hc_n: rr.nHcCleared || 0, exh_n: rr.nExhCleared || 0,
              };
            } else if (zz && typeof zz.level === 'number') {
              // sub-12 (11렙 등) 실측 — ereter/rating 엔 없고 zasaMap 에만 있음. 실측이므로 ☆ 정상 표시.
              e = { level: zz.level, ec: null, hc: null, exh: null, ec_n: 0, hc_n: 0, exh_n: 0 };
            } else if (typeof zasaAvgByGameLv[gameLevel] === 'number') {
              // zasa 실측 없음 — 게임레벨 평균으로 임의 채움 (정렬/필터 계산용). 표시는 미표기(__lowFallback).
              e = { level: zasaAvgByGameLv[gameLevel], ec: null, hc: null, exh: null, ec_n: 0, hc_n: 0, exh_n: 0, __lowFallback: true };
            } else continue;
          }
          if (typeof e.level !== 'number') continue;
          // 게임레벨 캡 — 클리어 최고 게임레벨(maxClearGameLevel) 초과 곡 제외.
          //   플레이만 하고 클리어 못한 상위 레벨이 추천 상한을 끌어올리는 것 방지.
          if (maxClearGameLevel > 0 && typeof gameLevel === 'number' && gameLevel > maxClearGameLevel) continue;
          if (topClearZasa > 0 && e.level > zasaHardCap) continue;
          if (zasaMin != null && e.level < zasaMin) continue;
          if (zasaMax != null && e.level > zasaMax) continue;
          var songFs = fsScores[sid];
          var featScores = songFs && songFs[cn];
          if (!featScores) continue;
          var uc = userChartByKey.get(normFn(title) + '|' + diff);
          var rate = null;
          if (uc && typeof uc.exScore === 'number' && uc.exScore > 0 && typeof uc.noteCount === 'number' && uc.noteCount > 0) {
            rate = (uc.exScore / (uc.noteCount * 2)) * 100;
          }
          if (rate != null && rate >= 95) continue;
          candidates.push({
            sid: sid, cn: cn, title: title, diff: diff, chartPt: chartPt,
            zasa: e.level, gameLevel: gameLevel, e: e, uc: uc, rate: rate, featScores: featScores,
            dv: typeof e.exh === 'number' ? e.exh : (typeof e.hc === 'number' ? e.hc : e.level),
          });
        }
      }

      // 2단계 — zasa bin 평균. 친 곡만으로 산출. 안 친 곡은 복습 점수 0, 신규 보너스만.
      var binMap = {};
      for (var ci3 = 0; ci3 < candidates.length; ci3++) {
        var cc3 = candidates[ci3];
        if (cc3.rate == null) continue;
        var bk = (Math.round(cc3.zasa * 10) / 10).toFixed(1);
        if (!binMap[bk]) binMap[bk] = { sum: 0, n: 0 };
        binMap[bk].sum += cc3.rate;
        binMap[bk].n += 1;
      }
      // bin n < MIN_BIN_N 이면 이웃 bin 결합.
      function binMeanFor(targetBk) {
        var sum = 0, n = 0;
        var seen = {};
        function add(bk) {
          if (seen[bk]) return false;
          seen[bk] = true;
          if (binMap[bk]) { sum += binMap[bk].sum; n += binMap[bk].n; return true; }
          return false;
        }
        var t = (Math.round(targetBk * 10) / 10);
        add(t.toFixed(1));
        var step = 1;
        while (n < MIN_BIN_N && step <= 30) {
          var lo = (t - step * 0.1);
          var hi = (t + step * 0.1);
          add((Math.round(lo * 10) / 10).toFixed(1));
          add((Math.round(hi * 10) / 10).toFixed(1));
          step += 1;
        }
        return n > 0 ? sum / n : null;
      }
      for (var ci4 = 0; ci4 < candidates.length; ci4++) {
        var cc4 = candidates[ci4];
        cc4.binMean = binMeanFor(cc4.zasa);
        cc4.deficit = (cc4.binMean != null && cc4.rate != null) ? (cc4.binMean - cc4.rate) : 0;
      }

      // 3단계 — 점수화. 복습/신규/실전 연습 혼합.
      var weakFeats = feats.filter(function (f) { return (userVec[f] || 0) < 0; });
      var pool = [];
      for (var ci5 = 0; ci5 < candidates.length; ci5++) {
        var cc5 = candidates[ci5];
        var arr = [];
        for (var fi = 0; fi < feats.length; fi++) {
          var f = feats[fi];
          var s = cc5.featScores[f];
          if (typeof s !== 'number' || s <= 0) continue;
          arr.push({ f: f, s: s });
        }
        arr.sort(function (a, b) { return b.s - a.s; });
        cc5.top3 = arr.slice(0, 3).map(function (x) { return x.f; });
        var patternScore = arr.length > 0
          ? arr.slice(0, 3).reduce(function (a, x) { return a + x.s; }, 0) / (Math.min(3, arr.length) * 100)
          : 0;
        if (patternScore <= 0) continue;
        var weakSignal = 0, weakWeight = 0;
        for (var xi = 0; xi < arr.length; xi++) {
          var x = arr[xi];
          var uv = userVec[x.f] || 0;
          var w = Math.max(0, -uv);
          weakSignal += (x.s / 100) * w;
          weakWeight += w;
        }
        weakSignal = weakWeight > 0 ? clamp(weakSignal / weakWeight, 0, 1) : patternScore * 0.35;
        var difficultyFit = clamp(1 - Math.abs(cc5.zasa - targetZasa) / Math.max(0.7, rangeW), 0, 1);
        var deficitScore = cc5.deficit > 0 ? clamp(cc5.deficit / 12, 0, 1) : 0;
        var played = cc5.rate != null;
        var lampNeed = cc5.uc && typeof cc5.uc.lampNum === 'number' && cc5.uc.lampNum < WEAKNESS_CLEAR_LAMP ? 0.12 : 0;
        var unplayedBonus = played ? 0 : 0.16;
        var alreadyGoodPenalty = played && cc5.rate >= 90 ? 0.18 : 0;
        var practiceType = 'practical';
        if (played && cc5.deficit > 1) practiceType = 'review';
        else if (!played) practiceType = 'pattern';
        else if (lampNeed > 0 || (played && cc5.rate < 88)) practiceType = 'score';
        cc5.practiceScore =
          weakSignal * 0.32 +
          patternScore * 0.18 +
          difficultyFit * 0.22 +
          deficitScore * 0.18 +
          unplayedBonus +
          lampNeed -
          alreadyGoodPenalty;
        // v2 재구성용 중간값 보존 — 4단계에서 28dim 약점매칭 주력으로 재조합.
        cc5._weakSignal = weakSignal;
        cc5._patternScore = patternScore;
        cc5._difficultyFit = difficultyFit;
        cc5._deficitScore = deficitScore;
        cc5._unplayedBonus = unplayedBonus;
        cc5._lampNeed = lampNeed;
        cc5._alreadyGoodPenalty = alreadyGoodPenalty;
        cc5.practiceType = practiceType;
        pool.push(cc5);
      }

      var layoutKeyW = function (r) {
        if (!r) return 0;
        if (handMode === 'left') return r.L || 0;
        if (handMode === 'right') return r.R || 0;
        return r.total || 0;
      };

      // 4단계 — 8-way 배치 점수 반영.
      if (weaknessLib && weaknessLib.chartStrengthMatch8Way) {
        for (var pi = 0; pi < pool.length; pi++) {
          var cp = pool[pi];
          var w8 = weaknessLib.chartStrengthMatch8Way(cp.chartPt, userVec,
            { feats: feats, handMode: handMode, flipOn: flipOn, mirrorOn: flipOn, normalize: scoreMode === 'v2' });
          cp._w8 = w8;
          var normal = w8 && Array.isArray(w8.results) ? w8.results.find(function (r) { return !r.flip && !r.mL && !r.mR; }) : null;
          cp.bestTotal = w8 && w8.best ? layoutKeyW(w8.best) : 0;
          cp.layoutBaseTotal = normal ? layoutKeyW(normal) : cp.bestTotal;
          cp.layoutGain = cp.bestTotal - cp.layoutBaseTotal;
          cp.layoutLabel = w8 ? (w8.bestLabel || '') : '';
          if (pdLayoutMap && cp.title && cp.diff && cp.layoutLabel) {
            pdLayoutMap[cp.title + '|' + cp.diff] = cp.layoutLabel;
          }
          cp.layoutAssistScore = clamp((cp.bestTotal + 12) / 24, 0, 1);
          cp.layoutGainScore = clamp(cp.layoutGain / 8, 0, 1);
          cp.layoutPracticeScore = clamp((-cp.layoutBaseTotal) / 12, 0, 1);
          if (scoreMode !== 'v2') {
            cp.practiceScore +=
              cp.layoutAssistScore * 0.08 +
              cp.layoutGainScore * 0.08 +
              cp.layoutPracticeScore * (strength >= 3 ? 0.08 : strength === 2 ? 0.05 : 0.03);
          }
          // v2 는 풀 전체 bestNorm 분포가 필요하므로 아래 루프 후 재구성.
        }
        if (scoreMode === 'v2') {
          // 풀 내 bestNorm min-max → weakMatchScore (풀에서 강점이 가장 안 나오는=약점 곡 = 1). 유저 절대 레벨 제거.
          var wmn = Infinity, wmx = -Infinity;
          for (var wi = 0; wi < pool.length; wi++) {
            var bnw = (pool[wi]._w8 && typeof pool[wi]._w8.bestNorm === 'number') ? pool[wi]._w8.bestNorm : null;
            if (bnw != null) { if (bnw < wmn) wmn = bnw; if (bnw > wmx) wmx = bnw; }
          }
          var wrange = wmx - wmn;
          for (var wj = 0; wj < pool.length; wj++) {
            var cpj = pool[wj];
            var bnj = (cpj._w8 && typeof cpj._w8.bestNorm === 'number') ? cpj._w8.bestNorm : null;
            var weakMatchScore = (bnj != null && wrange > 0) ? (wmx - bnj) / wrange : 0.5;   // 약점방향: 풀에서 bestNorm 가장 낮은 곡 = 1
            cpj.weakMatchScore = weakMatchScore;
            cpj.practiceScore =
              weakMatchScore      * 0.38 +   // 28dim 약점 매칭 (손별 포함, 풀 상대) — 주력
              cpj._weakSignal     * 0.18 +
              cpj._patternScore   * 0.08 +
              cpj._difficultyFit  * 0.18 +
              cpj._deficitScore   * 0.10 +
              cpj.layoutGainScore * 0.08 +
              cpj._unplayedBonus +
              cpj._lampNeed -
              cpj._alreadyGoodPenalty;
          }
        }
      } else {
        for (var pi2 = 0; pi2 < pool.length; pi2++) {
          var cp2 = pool[pi2];
          cp2.bestTotal = 0;
          cp2.layoutBaseTotal = 0;
          cp2.layoutGain = 0;
        }
      }
      pool.sort(function (a, b) { return (b.practiceScore - a.practiceScore) || (a.zasa - b.zasa); });

      var keyOfW = function (c) { return c.title + '|' + c.diff; };
      var usedW = new Set();
      var sliceW = [];
      if (RANDOMIZE_W) {
        // 풀 버전 — 점수순 상위 POOL_N_W 곡 → topN 곡 계층 랜덤 추출 (밴드별 ≈topN/3, 상위 약간 가중).
        sliceW = stratifiedSample(pool.slice(0, POOL_N_W), topN);
      } else {
        // 결정적 — practiceType (복습/패턴/점수/실전) 다양성 쿼터로 topN 채움.
        var takeType = function (type, n) {
          for (var pi3 = 0; pi3 < pool.length; pi3++) {
            var cp3 = pool[pi3];
            if (sliceW.length >= topN || n <= 0) break;
            if (cp3.practiceType !== type) continue;
            var k = keyOfW(cp3);
            if (usedW.has(k)) continue;
            usedW.add(k);
            sliceW.push(cp3);
            n -= 1;
          }
        };
        takeType('review', Math.ceil(topN * 0.3));
        takeType('pattern', Math.ceil(topN * 0.3));
        takeType('score', Math.ceil(topN * 0.2));
        takeType('practical', topN - sliceW.length);
        for (var pi4 = 0; pi4 < pool.length; pi4++) {
          var cp4 = pool[pi4];
          if (sliceW.length >= topN) break;
          var kk = keyOfW(cp4);
          if (usedW.has(kk)) continue;
          usedW.add(kk);
          sliceW.push(cp4);
        }
      }

      // 5단계 — items 변환 + _matchByHand + tags/hashtags.
      var items = [];
      var nextDjTarget = function (exScore, noteCount) {
        if (typeof exScore !== 'number' || typeof noteCount !== 'number' || noteCount <= 0) return null;
        var maxEx = noteCount * 2;
        var rankSteps = [
          { lv: 'E',   rate: 2 / 9 },
          { lv: 'D',   rate: 3 / 9 },
          { lv: 'C',   rate: 4 / 9 },
          { lv: 'B',   rate: 5 / 9 },
          { lv: 'A',   rate: 6 / 9 },
          { lv: 'AA',  rate: 7 / 9 },
          { lv: 'AAA', rate: 8 / 9 },
        ];
        for (var ri = 0; ri < rankSteps.length; ri++) {
          var st = rankSteps[ri];
          var score = Math.ceil(maxEx * st.rate);
          if (exScore < score) return { djLevel: st.lv, score: score, rate: (score / maxEx) * 100 };
        }
        return null;
      };
      for (var si = 0; si < sliceW.length; si++) {
        var cs = sliceW[si];
        var currentExScore = cs.uc && typeof cs.uc.exScore === 'number' ? cs.uc.exScore : null;
        var noteCount = cs.uc && typeof cs.uc.noteCount === 'number' ? cs.uc.noteCount : null;
        var djTarget = nextDjTarget(currentExScore, noteCount);
        var targetRate;
        if (typeof cs.rate === 'number' && typeof cs.binMean === 'number') {
          var stepInc = strength >= 3 ? 4 : strength === 2 ? 3 : 2;
          targetRate = clamp(Math.max(cs.rate + stepInc, cs.binMean - 1.5, djTarget ? djTarget.rate : 0), 0, 98);
        } else if (typeof cs.rate === 'number') {
          var stepInc2 = strength >= 3 ? 4 : strength === 2 ? 3 : 2;
          targetRate = clamp(Math.max(cs.rate + stepInc2, djTarget ? djTarget.rate : 0), 0, 98);
        } else if (typeof cs.binMean === 'number') {
          targetRate = clamp(cs.binMean, 0, 98);
        } else {
          targetRate = null;
        }
        var targetExScore;
        if (targetRate == null || typeof noteCount !== 'number' || noteCount <= 0) {
          targetExScore = djTarget ? djTarget.score : null;
        } else {
          var rateScore = Math.round(noteCount * 2 * targetRate / 100);
          targetExScore = djTarget ? Math.max(rateScore, djTarget.score) : rateScore;
        }
        var r = {
          title: cs.title, chart: cs.diff, level: cs.zasa,
          _hideZasa: !!(cs.e && cs.e.__lowFallback),  // zasa 실측 없이 게임레벨 평균으로 채운 곡 — ☆ 미표기.
          ec: cs.e.ec, hc: cs.e.hc, exh: cs.e.exh,
          ec_n: cs.e.ec_n, hc_n: cs.e.hc_n, exh_n: cs.e.exh_n,
          diffValue: cs.dv,
          currentLamp: cs.uc ? cs.uc.lamp : null,
          margin: baseStar - cs.dv,
          gameLevel: cs.gameLevel,
          _weaknessScore: cs.bestTotal,
          _weaknessBestTotal: cs.bestTotal,
          _weaknessDeficit: cs.deficit,
          _weaknessBinMean: cs.binMean,
          _weaknessRate: cs.rate,
          _weaknessTop3: cs.top3,
          _weaknessWeakFeats: weakFeats,
          _practiceScore: cs.practiceScore,
          _practiceType: cs.practiceType,
          _targetRate: targetRate,
          _targetExScore: targetExScore,
          _targetDjLevel: djTarget ? djTarget.djLevel : null,
          _currentExScore: currentExScore,
          _layoutGain: cs.layoutGain,
          _layoutBaseTotal: cs.layoutBaseTotal,
          _category: 'weakness',
        };
        if (cs._w8 && cs._w8.best) {
          r._matchByHand = {
            bestTotal: cs.bestTotal, bestLabel: cs._w8.bestLabel, best: cs._w8.best,
            L: cs._w8.best.L, R: cs._w8.best.R,
            flip: cs._w8.best.flip, mL: cs._w8.best.mL, mR: cs._w8.best.mR,
            total: cs._w8.best.total, results: cs._w8.results,
          };
        }
        items.push(r);
      }
      for (var ti = 0; ti < items.length; ti++) {
        var ri2 = items[ti];
        if (ri2._tags === undefined) ri2._tags = computeChartTags(ri2);
        if (ri2._hashtags === undefined) ri2._hashtags = computeRecHashtags(ri2);
      }
      return items;
    }

    // buildRecs 의 풀 버전 — { picked, pool } 반환 (INFOhSorry 의 picked 표시 + 클리어 시 pool refill 용).
    //   기본 randomize=true (리롤마다 변동). opts 로 limit / poolSize / randomize 조정 가능.
    function buildRecsWithPool(threshold, getDiffField, baseStar, recLevelMode, djMode, opts) {
      var o = {};
      var src = opts || {};
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) o[k] = src[k];
      o.withPool = true;
      if (o.randomize === undefined) o.randomize = true;
      return buildRecs(threshold, getDiffField, baseStar, recLevelMode, djMode, o);
    }

    return {
      chartStrengthMatch: chartStrengthMatch,
      chartStrengthMatchByHand: chartStrengthMatchByHand,
      computeChartTags: computeChartTags,
      computeRecHashtags: computeRecHashtags,
      buildPools: buildPools,
      buildRecs: buildRecs,
      buildRecsWithPool: buildRecsWithPool,
      buildWeaknessRecs: buildWeaknessRecs,
      setLayoutMode: function (m) { if (m === 'on' || m === 'off') layoutModeForClear = m; },
      getLayoutMode: function () { return layoutModeForClear; },
      // 외부 노출 — calcOhsorryCore result.practiceZasaDefault 가 ohsorryRender UI (연습곡 zasa 토글 기본값) 에서 사용.
      practiceZasaDefault: practiceZasaDefault,
      maxClearGameLevel: maxClearGameLevel,
    };
  }

  return {
    VERSION: VERSION,
    createContext: createContext,
    // 상수 — 외부에서 fallback / 디버깅 시 참고 가능.
    FEAT_TAG_MAP: FEAT_TAG_MAP,
    CATEGORY_TAG_MAP: CATEGORY_TAG_MAP,
    PRACTICE_TAG_MAP: PRACTICE_TAG_MAP,
    HAND_BIAS_THRESHOLD: HAND_BIAS_THRESHOLD,
  };
});
