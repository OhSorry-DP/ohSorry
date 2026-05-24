// calcWeakness.js — 유저 9 feature 약점/강점 벡터 + 차트별 강점/약점 매치 점수.
//
// 알고리즘 (잔차 분석):
//   1. 유저의 차트별 EX rate(%) = exScore / (noteCount*2) * 100
//   2. patterns-all-slim.json 의 9 feature pt (양손 평균) 와 매칭 (title norm + diff→DP_xxx)
//   3. lv 별 평균 rate 계산 → 잔차 = rate - lv평균
//   4. feature 별 가중평균 weakness[f] = Σ(잔차 × pt_f) / Σ(pt_f)
//      음수 = 약점 (그 feature 가 강한 차트에서 평균보다 못 침)
//      양수 = 강점
//
// PoC 검증 (ohSorryRating/scripts/analyze-user-weakness.js) — 4명 유저 다른 프로파일 확인 OK.
//
// 추천 정렬용 helper:
//   chartStrengthMatch(chartPt, userVec) — Σ userVec_f × chartPt_f  (강점 차트 우선)
//   chartWeaknessMatch                   — -chartStrengthMatch     (약점 차트 우선, 약점 보완 탭용)
//
// UMD — 브라우저 (window.OhsorryWeakness) / Node (module.exports) 양쪽 지원.

;(function (factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;  // Node
  if (typeof window !== 'undefined') window.OhsorryWeakness = api;         // 브라우저
})(function () {
  // FEATS — 우리 정의 표기 (UPPERCASE + hyphen). patterns-all-slim.json 의 데이터 key 와 일치.
  var FEATS = ['NOTES', 'CHORD', 'PEAK', 'CHARGE', 'SCRATCH', 'SOF-LAN', 'PHRASE', 'JACK', 'TRILL', 'RAND'];
  var DIFF2CHART = {
    NORMAL: 'DP_NOR',
    HYPER: 'DP_HYP',
    ANOTHER: 'DP_ANO',
    LEGGENDARIA: 'DP_LEG',
  };

  // 차트 pt ({p1: {9}, p2: {9}}) → 양손 평균 ({9})
  function avgPt(chartPt) {
    var out = {};
    for (var i = 0; i < FEATS.length; i++) {
      var f = FEATS[i];
      var p1v = (chartPt && chartPt.p1 && chartPt.p1[f]) || 0;
      var p2v = (chartPt && chartPt.p2 && chartPt.p2[f]) || 0;
      out[f] = (p1v + p2v) / 2;
    }
    return out;
  }

  // 유저 약점/강점 9 feature 벡터.
  // opts: { allCharts, patternsMap, normFn, minLv = 11 }
  function calcUserWeakness(opts) {
    var allCharts = opts.allCharts || [];
    var patternsMap = opts.patternsMap || {};
    var normFn = opts.normFn || function (s) { return s; };
    var minLv = typeof opts.minLv === 'number' ? opts.minLv : 11;

    // patternsMap 의 title norm → songId 매핑 (한 번만)
    var titleToId = {};
    for (var id in patternsMap) {
      if (!Object.prototype.hasOwnProperty.call(patternsMap, id)) continue;
      var t = (patternsMap[id] && patternsMap[id].t) || '';
      var k = normFn(t);
      if (k && !titleToId[k]) titleToId[k] = id;
    }

    // 매칭 + lv 별 묶기
    var byLv = {};
    var matched = 0;
    for (var i = 0; i < allCharts.length; i++) {
      var c = allCharts[i];
      if (!c || !c.title || !c.diff) continue;
      var cn = DIFF2CHART[c.diff];
      if (!cn) continue;
      var sid = titleToId[normFn(c.title)];
      if (!sid) continue;
      var sp = patternsMap[sid];
      if (!sp || !sp.c || !sp.c[cn]) continue;
      var lv = sp.c[cn].lv;
      if (lv < minLv) continue;
      var pt = avgPt(sp.c[cn]);
      // rate: scorePercent 우선 (ereter), 없으면 exScore/noteCount 로 계산 (ohSorry allCharts)
      var rate;
      if (typeof c.scorePercent === 'number') rate = c.scorePercent;
      else if (typeof c.exScore === 'number' && typeof c.noteCount === 'number' && c.noteCount > 0) {
        rate = (c.exScore / (c.noteCount * 2)) * 100;
      } else continue;
      if (!byLv[lv]) byLv[lv] = [];
      byLv[lv].push({ rate: rate, pt: pt });
      matched++;
    }

    // lv 별 잔차 = rate - lv평균
    var all = [];
    for (var lv in byLv) {
      if (!Object.prototype.hasOwnProperty.call(byLv, lv)) continue;
      var arr = byLv[lv];
      var sum = 0;
      for (var j = 0; j < arr.length; j++) sum += arr[j].rate;
      var mean = sum / arr.length;
      for (var j2 = 0; j2 < arr.length; j2++) {
        arr[j2].residual = arr[j2].rate - mean;
        all.push(arr[j2]);
      }
    }

    // feature 별 가중평균
    var vec = {};
    for (var fi = 0; fi < FEATS.length; fi++) {
      var f = FEATS[fi];
      var sumRP = 0, sumP = 0;
      for (var k2 = 0; k2 < all.length; k2++) {
        sumRP += all[k2].residual * all[k2].pt[f];
        sumP += all[k2].pt[f];
      }
      vec[f] = sumP > 0 ? sumRP / sumP : 0;
    }
    vec.__meta = { matched: matched, lvCounts: countLv(byLv) };
    return vec;
  }

  function countLv(byLv) {
    var out = {};
    for (var lv in byLv) {
      if (Object.prototype.hasOwnProperty.call(byLv, lv)) out[lv] = byLv[lv].length;
    }
    return out;
  }

  // 차트 강점 매치 = Σ userVec_f × chartPt_f. chartPt 는 {p1, p2} 또는 양손 평균 객체.
  function chartStrengthMatch(chartPt, userVec) {
    if (!chartPt || !userVec) return 0;
    var pt = (chartPt.p1 || chartPt.p2) ? avgPt(chartPt) : chartPt;
    var s = 0;
    for (var i = 0; i < FEATS.length; i++) {
      var f = FEATS[i];
      s += (userVec[f] || 0) * (pt[f] || 0);
    }
    return s;
  }

  function chartWeaknessMatch(chartPt, userVec) {
    return -chartStrengthMatch(chartPt, userVec);
  }

  // browser 전용 high-level helper — patterns gist fetch + cache + userVec 계산.
  // 호출처: ohSorry browser (calcOhsorryCore), ohSorryWeb 게스트 페이지, INFOhSorry — 동일 사용.
  //
  // opts:
  //   allCharts      유저 차트 점수 배열
  //   normFn         title 정규화 (window.OhsorryNorm.norm)
  //   patternsUrl    (optional) 기본 OhSorry-DP gist 의 patterns-all-slim.json
  //   minLv          (optional, default 11) 잔차 분석 lv 임계
  //   cacheTtlMs     (optional, default 1시간) localStorage cache 유효시간
  //   force          (optional) cache 무시 강제 fetch
  // return: calcUserWeakness 결과 (9 feature 벡터 + __meta), 실패 시 throw
  var DEFAULT_PATTERNS_URL = 'https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/patterns-all-slim.json';
  var CACHE_KEY = 'OhsorryWeakness:patternsMap';
  var CACHE_TS_KEY = 'OhsorryWeakness:patternsMap:ts';
  var memCache = null;

  async function fetchPatternsMap(opts) {
    opts = opts || {};
    var url = opts.patternsUrl || DEFAULT_PATTERNS_URL;
    var ttl = typeof opts.cacheTtlMs === 'number' ? opts.cacheTtlMs : 60 * 60 * 1000;
    // memory cache 우선 (page lifetime)
    if (!opts.force && memCache && memCache.url === url) return memCache.data;
    // localStorage cache (browser only)
    var hasLs = typeof localStorage !== 'undefined';
    if (!opts.force && hasLs) {
      try {
        var raw = localStorage.getItem(CACHE_KEY);
        var ts  = localStorage.getItem(CACHE_TS_KEY);
        if (raw && ts && (Date.now() - new Date(ts).getTime()) < ttl) {
          var data = JSON.parse(raw);
          memCache = { url: url, data: data };
          return data;
        }
      } catch (e) {}
    }
    var res = await fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('patterns fetch ' + res.status);
    var fresh = await res.json();
    memCache = { url: url, data: fresh };
    if (hasLs) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(fresh));
        localStorage.setItem(CACHE_TS_KEY, new Date().toISOString());
      } catch (e) {}
    }
    return fresh;
  }

  async function fetchAndCalcWeakness(opts) {
    opts = opts || {};
    if (!opts.allCharts) throw new Error('fetchAndCalcWeakness: allCharts 필수');
    if (!opts.normFn)    throw new Error('fetchAndCalcWeakness: normFn 필수');
    var patternsMap = await fetchPatternsMap(opts);
    return calcUserWeakness({
      allCharts: opts.allCharts,
      patternsMap: patternsMap,
      normFn: opts.normFn,
      minLv: opts.minLv,
    });
  }

  // 한 feature 의 상세 분석 — top 기여 곡 (부호별) + "올리려면" 추천 곡.
  // opts:
  //   feat         feature 키 ('NOTES'/'CHORD'/...)
  //   allCharts    유저 차트 점수 배열
  //   patternsMap  patterns-all-slim.json
  //   normFn       title 정규화
  //   userVec      이미 계산한 userVec (없으면 calcUserWeakness 내부 호출 — 비용 큼)
  //   baseStar     사용자 추정 ★ (추천곡 ★ 범위 제한 용)
  //   topN         default 5
  //   minLv        default 11
  // return:
  //   { feat, value, isStrength, summary: {strongAvg, allAvg, gap, n}, contributors, recommends }
  function analyzeFeature(opts) {
    opts = opts || {};
    var feat = opts.feat;
    var allCharts = opts.allCharts || [];
    var patternsMap = opts.patternsMap || {};
    var normFn = opts.normFn || function (s) { return s; };
    var userVec = opts.userVec || calcUserWeakness({ allCharts: allCharts, patternsMap: patternsMap, normFn: normFn, minLv: opts.minLv });
    var baseStar = opts.baseStar;
    var topN = opts.topN || 5;
    var minLv = typeof opts.minLv === 'number' ? opts.minLv : 11;

    var value = userVec[feat] || 0;
    var isStrength = value >= 0;

    // title norm → songId
    var titleToId = {};
    for (var id in patternsMap) {
      if (!Object.prototype.hasOwnProperty.call(patternsMap, id)) continue;
      var t = (patternsMap[id] && patternsMap[id].t) || '';
      var k = normFn(t);
      if (k && !titleToId[k]) titleToId[k] = id;
    }

    // 유저 차트 매칭 + lv 평균 + 잔차
    var lvAgg = {};
    var charts = [];
    for (var i = 0; i < allCharts.length; i++) {
      var c = allCharts[i];
      if (!c || !c.title || !c.diff) continue;
      var cn = DIFF2CHART[c.diff];
      if (!cn) continue;
      var sid = titleToId[normFn(c.title)];
      if (!sid) continue;
      var sp = patternsMap[sid];
      if (!sp || !sp.c || !sp.c[cn]) continue;
      var lv = sp.c[cn].lv;
      if (lv < minLv) continue;
      var pt = avgPt(sp.c[cn])[feat] || 0;
      var rate;
      if (typeof c.scorePercent === 'number') rate = c.scorePercent;
      else if (typeof c.exScore === 'number' && typeof c.noteCount === 'number' && c.noteCount > 0) {
        rate = (c.exScore / (c.noteCount * 2)) * 100;
      } else continue;
      charts.push({
        title: c.title, diff: c.diff, lv: lv, pt: pt, rate: rate,
        lampNum: c.lampNum, songId: sid, chartName: cn,
      });
      if (!lvAgg[lv]) lvAgg[lv] = { sum: 0, n: 0 };
      lvAgg[lv].sum += rate;
      lvAgg[lv].n += 1;
    }
    for (var lvk in lvAgg) lvAgg[lvk].mean = lvAgg[lvk].sum / lvAgg[lvk].n;

    // 잔차 + 기여도
    for (var j = 0; j < charts.length; j++) {
      var ch = charts[j];
      ch.residual = ch.rate - lvAgg[ch.lv].mean;
      ch.contrib = ch.residual * ch.pt;
    }

    // top 기여 곡 — 부호별 (강점=잘 친 / 약점=못 친)
    var sorted = charts.slice().sort(isStrength
      ? function (a, b) { return b.contrib - a.contrib; }
      : function (a, b) { return a.contrib - b.contrib; });
    var contributors = sorted.slice(0, topN);

    // 자연어 설명 — 그 feature pt 강한 차트 (상위 30%) 의 평균 rate vs 전체 평균
    var allAvg = 0;
    if (charts.length > 0) {
      for (var k1 = 0; k1 < charts.length; k1++) allAvg += charts[k1].rate;
      allAvg /= charts.length;
    }
    var sortedByPt = charts.slice().sort(function (a, b) { return b.pt - a.pt; });
    var strongN = Math.max(1, Math.floor(charts.length * 0.3));
    var strongAvg = 0;
    for (var k2 = 0; k2 < Math.min(strongN, sortedByPt.length); k2++) strongAvg += sortedByPt[k2].rate;
    strongAvg = strongN > 0 ? strongAvg / Math.min(strongN, sortedByPt.length) : 0;
    var gap = strongAvg - allAvg;

    // 추천곡 — patternsMap 의 차트 중 그 feature 가 0+ 인 곡 + 사용자 잘 못 친 / NP + baseStar 근처
    //   분석 (calcUserWeakness) 은 lv11+ 만 보지만 추천 풀은 lv 무관 (사용자 ★ 근처 일치 시 도전 가치).
    //   pt 임계는 0 (feature 가 있는 곡 = pt>0). feature 별 분포 (CHARGE 처럼 대부분 0) 차이 흡수.
    // played map — allCharts 전체에서 (lv 필터 없이) 다시 매칭. charts (lv11+ 만) 활용하면 lv1~10 차트가 모두 NP 로 분류됨.
    var played = {};
    for (var pi = 0; pi < allCharts.length; pi++) {
      var pc = allCharts[pi];
      if (!pc || !pc.title || !pc.diff) continue;
      var pcn = DIFF2CHART[pc.diff];
      if (!pcn) continue;
      var psid = titleToId[normFn(pc.title)];
      if (!psid) continue;
      var psp = patternsMap[psid];
      if (!psp || !psp.c || !psp.c[pcn]) continue;
      var prate;
      if (typeof pc.scorePercent === 'number') prate = pc.scorePercent;
      else if (typeof pc.exScore === 'number' && typeof pc.noteCount === 'number' && pc.noteCount > 0) {
        prate = (pc.exScore / (pc.noteCount * 2)) * 100;
      } else continue;
      played[psid + '|' + pcn] = prate;
    }
    var recommends = [];
    for (var sid2 in patternsMap) {
      if (!Object.prototype.hasOwnProperty.call(patternsMap, sid2)) continue;
      var sp2 = patternsMap[sid2];
      if (!sp2 || !sp2.c) continue;
      for (var cn2 in sp2.c) {
        if (!Object.prototype.hasOwnProperty.call(sp2.c, cn2)) continue;
        var ch2 = sp2.c[cn2];
        var lv2 = ch2.lv;
        if (baseStar != null) {
          // baseStar 근처 (-2 ~ +1) 만
          if (lv2 < baseStar - 2 || lv2 > baseStar + 1) continue;
          // baseStar 2.5+ (초보 이상) — lv10 미만 곡은 추천 안 함 (저레벨 곡 추천 의미 X)
          if (baseStar >= 2.5 && lv2 < 10) continue;
        }
        var pt2 = avgPt(ch2)[feat] || 0;
        if (pt2 <= 0) continue;  // 그 feature 가 아예 없는 곡만 제외
        var key2 = sid2 + '|' + cn2;
        var playedRate = played[key2];
        // 만점에 가까운 곡 (rate >= 95%) 만 제외. 강점 기여 곡 (rate 80~94) 도 추천 풀 포함.
        if (playedRate != null && playedRate >= 95) continue;
        recommends.push({
          songId: sid2, chartName: cn2, title: sp2.t, lv: lv2, pt: pt2,
          rate: playedRate == null ? null : playedRate,
          isNp: playedRate == null,
        });
      }
    }
    // 추출 룰 — 친 곡 (기여도 큰 곡) 3 + NP (새 곡) 2 조합.
    //   친 곡 정렬 — |기여도| desc (= |pt × (rate - lvMean)|). contributors 와 같은 기준 (부호 무관).
    //     강점 케이스 (잘 친 + pt 강한) / 약점 케이스 (못 친 + pt 강한) 둘 다 우선.
    //     lv11+ 만 lvAgg 있음. 그 외 lv (10 등) 는 fallback 70.
    //   NP 정렬 — pt desc (단순).
    //   부족 시 반대 풀에서 보충해서 총 topN 채움.
    var played2 = recommends.filter(function (r) { return !r.isNp; });
    var np = recommends.filter(function (r) { return r.isNp; });
    var absContrib = function (r) {
      var lvMean = lvAgg[r.lv] ? lvAgg[r.lv].mean : 70;
      return Math.abs(r.rate - lvMean) * r.pt;
    };
    played2.sort(function (a, b) {
      var ca = absContrib(a);
      var cb = absContrib(b);
      if (ca !== cb) return cb - ca;
      return b.pt - a.pt;
    });
    np.sort(function (a, b) { return b.pt - a.pt; });
    var nPlayed = Math.min(3, played2.length);
    var nNp = Math.min(topN - nPlayed, np.length);
    var pick = played2.slice(0, nPlayed).concat(np.slice(0, nNp));
    var need = topN - pick.length;
    if (need > 0) {
      var usedKeys = {};
      pick.forEach(function (r) { usedKeys[r.songId + '|' + r.chartName] = 1; });
      var restAll = played2.slice(nPlayed).concat(np.slice(nNp))
        .filter(function (r) { return !usedKeys[r.songId + '|' + r.chartName]; })
        .sort(function (a, b) { return b.pt - a.pt; });
      pick = pick.concat(restAll.slice(0, need));
    }
    recommends = pick;

    return {
      feat: feat, value: value, isStrength: isStrength,
      summary: {
        strongAvg: +strongAvg.toFixed(1),
        allAvg: +allAvg.toFixed(1),
        gap: +gap.toFixed(1),
        n: charts.length,
      },
      contributors: contributors,
      recommends: recommends,
    };
  }

  return {
    FEATS: FEATS,
    DIFF2CHART: DIFF2CHART,
    DEFAULT_PATTERNS_URL: DEFAULT_PATTERNS_URL,
    avgPt: avgPt,
    calcUserWeakness: calcUserWeakness,
    chartStrengthMatch: chartStrengthMatch,
    chartWeaknessMatch: chartWeaknessMatch,
    fetchPatternsMap: fetchPatternsMap,
    fetchAndCalcWeakness: fetchAndCalcWeakness,
    analyzeFeature: analyzeFeature,
  };
});
