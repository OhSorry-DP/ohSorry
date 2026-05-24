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

  // 유저 약점/강점 10 feature 벡터.
  // opts:
  //   allCharts    유저 차트
  //   patternsMap  patterns-all-slim.json
  //   normFn       title 정규화
  //   ratingMap    ohSorryRating.json 의 ratings (array). lv11/12 차트 estEc/Hc/Exh.
  //   zasaMap      zasa-data.json 의 charts (array). lv10 차트 zasaLevel 보충 (ratingMap 미수록 차트).
  //                  zasaMap 매칭 차트는 임의 추정 estEc/Hc/Exh 적용 (gap GAP_EC/HC/EXH 차감).
  //   minLv        legacy (ratingMap 없을 때) 적용
  // 알고리즘 (ratingMap 있을 때):
  //   - 각 차트 → estEc, estHc, estExh 3 entry 로 펼침 (lv11/12 정확값, lv10 zasa 추정값)
  //   - bucket = floor(★ × 2) / 2 (0.5 단위)
  //   - bucket 별 평균 rate → 잔차 = rate - bucket평균
  //   - feature 별 가중평균 (entry 기준)
  var GAP_EC = 10.3;   // zasaLevel - estEc 평균 gap (ohSorryRating 추정)
  var GAP_HC = 6.2;
  var GAP_EXH = 2.3;

  function calcUserWeakness(opts) {
    var allCharts = opts.allCharts || [];
    var patternsMap = opts.patternsMap || {};
    var normFn = opts.normFn || function (s) { return s; };
    var minLv = typeof opts.minLv === 'number' ? opts.minLv : 11;
    var ratingMap = opts.ratingMap;
    var zasaMap = opts.zasaMap;

    // patternsMap 의 title norm → songId 매핑 (한 번만)
    var titleToId = {};
    for (var id in patternsMap) {
      if (!Object.prototype.hasOwnProperty.call(patternsMap, id)) continue;
      var t = (patternsMap[id] && patternsMap[id].t) || '';
      var k = normFn(t);
      if (k && !titleToId[k]) titleToId[k] = id;
    }

    // ratingMap → key map
    var ratingsByKey = null;
    if (ratingMap) {
      if (Array.isArray(ratingMap)) {
        ratingsByKey = {};
        for (var rI = 0; rI < ratingMap.length; rI++) {
          var rt = ratingMap[rI];
          if (!rt || !rt.title || !rt.diff) continue;
          ratingsByKey[normFn(rt.title) + '|' + rt.diff] = rt;
        }
      } else if (typeof ratingMap === 'object') {
        ratingsByKey = ratingMap;
      }
    }

    // zasaMap 결합 — ratingMap 미수록 차트 (lv10 등) 에 임의 추정 estEc/Hc/Exh 적용.
    //   gap = zasaLevel - estXX 평균 (ohSorryRating 차트 기준). 정확도는 떨어지지만 잔차 분석 풀 확장.
    if (zasaMap && ratingsByKey && Array.isArray(zasaMap)) {
      for (var zi = 0; zi < zasaMap.length; zi++) {
        var z = zasaMap[zi];
        if (!z || !z.title || !z.diff) continue;
        if (typeof z.level !== 'number') continue;
        var zk = normFn(z.title) + '|' + z.diff;
        if (ratingsByKey[zk]) continue;  // ratingMap 에 이미 있음 (lv11/12)
        var zl = z.level;
        ratingsByKey[zk] = {
          title: z.title, diff: z.diff,
          gameLevel: z.gameLevel, zasaLevel: zl,
          estEc: zl - GAP_EC,
          estHc: zl - GAP_HC,
          estExh: zl - GAP_EXH,
          __fromZasa: true,
        };
      }
    }

    var STAGES = [['estEc', 'ec'], ['estHc', 'hc'], ['estExh', 'exh']];
    var bucketAgg = {};  // ratingMap 모드 — bucket(★) → {sum, n, mean}
    var byLv = {};        // legacy — lv → entries
    var entries = [];     // 모든 entry (ratingMap 모드는 chart × 3, legacy 모드는 chart × 1)
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
      var pt = avgPt(sp.c[cn]);
      var rate;
      if (typeof c.scorePercent === 'number') rate = c.scorePercent;
      else if (typeof c.exScore === 'number' && typeof c.noteCount === 'number' && c.noteCount > 0) {
        rate = (c.exScore / (c.noteCount * 2)) * 100;
      } else continue;

      if (ratingsByKey) {
        // ratingMap 매칭 → estEc/Hc/Exh 3 entry 펼치기
        var ratKey = normFn(c.title) + '|' + c.diff;
        var rat = ratingsByKey[ratKey];
        if (!rat) continue;
        matched++;
        for (var si = 0; si < STAGES.length; si++) {
          var estK = STAGES[si][0];
          var stage = STAGES[si][1];
          var star = rat[estK];
          if (typeof star !== 'number') continue;
          var bucket = Math.floor(star * 2) / 2;
          entries.push({
            chartId: sid + '|' + cn, title: c.title, diff: c.diff, lv: lv,
            stage: stage, star: star, bucket: bucket,
            rate: rate, pt: pt, lampNum: c.lampNum,
          });
          if (!bucketAgg[bucket]) bucketAgg[bucket] = { sum: 0, n: 0 };
          bucketAgg[bucket].sum += rate;
          bucketAgg[bucket].n += 1;
        }
      } else {
        // legacy — lv 단위 bucket
        if (lv < minLv) continue;
        matched++;
        var entry = {
          chartId: sid + '|' + cn, title: c.title, diff: c.diff, lv: lv,
          rate: rate, pt: pt, lampNum: c.lampNum,
        };
        if (!byLv[lv]) byLv[lv] = [];
        byLv[lv].push(entry);
        entries.push(entry);
      }
    }

    // 잔차 계산
    if (ratingsByKey) {
      for (var bk in bucketAgg) bucketAgg[bk].mean = bucketAgg[bk].sum / bucketAgg[bk].n;
      for (var ei = 0; ei < entries.length; ei++) {
        entries[ei].residual = entries[ei].rate - bucketAgg[entries[ei].bucket].mean;
      }
    } else {
      for (var lv2 in byLv) {
        if (!Object.prototype.hasOwnProperty.call(byLv, lv2)) continue;
        var arr = byLv[lv2];
        var sum = 0;
        for (var j = 0; j < arr.length; j++) sum += arr[j].rate;
        var mean = sum / arr.length;
        for (var j2 = 0; j2 < arr.length; j2++) arr[j2].residual = arr[j2].rate - mean;
      }
    }

    // feature 별 가중평균
    var vec = {};
    for (var fi = 0; fi < FEATS.length; fi++) {
      var f = FEATS[fi];
      var sumRP = 0, sumP = 0;
      for (var k2 = 0; k2 < entries.length; k2++) {
        var ptF = entries[k2].pt[f] || 0;
        sumRP += entries[k2].residual * ptF;
        sumP += ptF;
      }
      vec[f] = sumP > 0 ? sumRP / sumP : 0;
    }
    vec.__meta = {
      matched: matched,
      entries: entries.length,
      mode: ratingsByKey ? 'rating' : 'lv',
      lvCounts: ratingsByKey ? null : countLv(byLv),
      buckets: ratingsByKey ? countBuckets(bucketAgg) : null,
    };
    // __entries / __bucketAgg 는 analyzeFeature 가 재사용하도록 노출 (UI 표시 X)
    vec.__entries = entries;
    vec.__bucketAgg = bucketAgg;
    vec.__byLv = byLv;
    return vec;
  }

  function countBuckets(bucketAgg) {
    var out = {};
    for (var bk in bucketAgg) out[bk] = bucketAgg[bk].n;
    return out;
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
  //   ratingMap    ohSorryRating.json 의 ratings 배열 (또는 {title|diff: rating} map). 추천 ★ 범위 비교용.
  //                ratingMap 없으면 baseStar 비교 skip — 모든 차트 추천 후보.
  //   baseStar     ohSorryRating 의 난이도 기준 ★ (estEc/estHc/estExh 와 같은 단위).
  //                차트의 estEc/estHc/estExh 중 어느 하나라도 baseStar ± rangeN 안 들어가면 후보.
  //   rangeN       baseStar ± rangeN 범위 (default 1)
  //   topN         default 5
  //   minLv        default 11 (잔차 분석 lv 임계 — 추천 풀은 영향 X)
  // return:
  //   { feat, value, isStrength, summary: {strongAvg, allAvg, gap, n}, contributors, recommends }
  function analyzeFeature(opts) {
    opts = opts || {};
    var feat = opts.feat;
    var allCharts = opts.allCharts || [];
    var patternsMap = opts.patternsMap || {};
    var normFn = opts.normFn || function (s) { return s; };
    var userVec = opts.userVec || calcUserWeakness({
      allCharts: allCharts, patternsMap: patternsMap, normFn: normFn,
      ratingMap: opts.ratingMap, zasaMap: opts.zasaMap, minLv: opts.minLv,
    });
    var baseStar = opts.baseStar;
    var rangeN = typeof opts.rangeN === 'number' ? opts.rangeN : 1;
    var topN = opts.topN || 5;

    // ratingMap — array 면 norm(title) + '|' + diff key 로 map 변환. 이미 map 이면 그대로.
    // zasaMap 도 같이 결합 — ratingMap 미수록 차트 (lv10) 추천 풀에도 포함.
    var CHART2DIFF = { DP_NOR: 'NORMAL', DP_HYP: 'HYPER', DP_ANO: 'ANOTHER', DP_LEG: 'LEGGENDARIA' };
    var ratingsByKey = null;
    if (opts.ratingMap) {
      if (Array.isArray(opts.ratingMap)) {
        ratingsByKey = {};
        for (var ri = 0; ri < opts.ratingMap.length; ri++) {
          var rt = opts.ratingMap[ri];
          if (!rt || !rt.title || !rt.diff) continue;
          ratingsByKey[normFn(rt.title) + '|' + rt.diff] = rt;
        }
      } else if (typeof opts.ratingMap === 'object') {
        ratingsByKey = opts.ratingMap;
      }
    }
    if (opts.zasaMap && ratingsByKey && Array.isArray(opts.zasaMap)) {
      for (var zi2 = 0; zi2 < opts.zasaMap.length; zi2++) {
        var z2 = opts.zasaMap[zi2];
        if (!z2 || !z2.title || !z2.diff) continue;
        if (typeof z2.level !== 'number') continue;
        var zk2 = normFn(z2.title) + '|' + z2.diff;
        if (ratingsByKey[zk2]) continue;
        var zl2 = z2.level;
        ratingsByKey[zk2] = {
          title: z2.title, diff: z2.diff,
          gameLevel: z2.gameLevel, zasaLevel: zl2,
          estEc: zl2 - GAP_EC, estHc: zl2 - GAP_HC, estExh: zl2 - GAP_EXH,
          __fromZasa: true,
        };
      }
    }

    var value = userVec[feat] || 0;
    var isStrength = value >= 0;

    // title norm → songId (recommends 풀 매칭용)
    var titleToId = {};
    for (var id in patternsMap) {
      if (!Object.prototype.hasOwnProperty.call(patternsMap, id)) continue;
      var t = (patternsMap[id] && patternsMap[id].t) || '';
      var k = normFn(t);
      if (k && !titleToId[k]) titleToId[k] = id;
    }

    // userVec.__entries 활용 — calcUserWeakness 가 이미 잔차 + bucket 계산함.
    //   ratingMap 모드: 한 차트가 estEc/Hc/Exh 3 entry 로 펼쳐짐. chartId 별 dedup.
    //   legacy 모드: 한 차트가 1 entry.
    var entries = userVec.__entries || [];
    var byChart = {};
    for (var ei = 0; ei < entries.length; ei++) {
      var en = entries[ei];
      if (!byChart[en.chartId]) {
        var parts = en.chartId.split('|');
        byChart[en.chartId] = {
          chartId: en.chartId, songId: parts[0], chartName: parts[1],
          title: en.title, diff: en.diff, lv: en.lv,
          pt: (en.pt && en.pt[feat]) || 0,
          rate: en.rate, lampNum: en.lampNum,
          residualSum: 0, n: 0,
        };
      }
      byChart[en.chartId].residualSum += en.residual;
      byChart[en.chartId].n += 1;
    }
    var charts = [];
    for (var ck in byChart) {
      var bch = byChart[ck];
      bch.residual = bch.residualSum / bch.n;
      bch.contrib = bch.residual * bch.pt;
      charts.push(bch);
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
    // played map — allCharts 전체에서 (lv 필터 없이) 다시 매칭. value = { rate, lampNum, djLevel }
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
      played[psid + '|' + pcn] = {
        rate: prate,
        lampNum: typeof pc.lampNum === 'number' ? pc.lampNum : null,
        djLevel: typeof pc.djLevel === 'string' ? pc.djLevel : (typeof pc.scoreRank === 'string' ? pc.scoreRank : null),
      };
    }
    // bucketAgg — userVec.__bucketAgg (있으면), 추천곡 bucketMean 계산용.
    var bucketAggForRec = userVec.__bucketAgg || null;
    function bucketMeanOf(rat) {
      if (!bucketAggForRec) return null;
      var ests = [rat.estEc, rat.estHc, rat.estExh];
      var sum = 0, n = 0;
      for (var bi = 0; bi < ests.length; bi++) {
        var ev = ests[bi];
        if (typeof ev !== 'number') continue;
        var b = Math.floor(ev * 2) / 2;
        var agg = bucketAggForRec[b];
        if (agg && typeof agg.mean === 'number') { sum += agg.mean; n++; }
      }
      return n > 0 ? sum / n : null;
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
        var recRat = null;
        // baseStar 비교 — ratingMap 의 estEc/estHc/estExh 중 어느 하나라도 baseStar ± rangeN 안 들어가면 후보.
        //   baseStar 는 ohSorryRating 의 난이도 ★ 단위 (estEc/estHc/estExh 와 같은 단위).
        //   ratingMap 에 매칭 안 되는 차트 (lv1~10 차트 — ratings 는 lv11/12 만 가짐) 는 추천 풀 제외.
        //   baseStar 또는 ratingMap 없으면 비교 skip (모든 차트 후보).
        if (baseStar != null && ratingsByKey) {
          var diff2 = CHART2DIFF[cn2];
          recRat = diff2 ? ratingsByKey[normFn(sp2.t) + '|' + diff2] : null;
          if (!recRat) continue;
          var inRange = false;
          var ests = [recRat.estEc, recRat.estHc, recRat.estExh];
          for (var ei = 0; ei < ests.length; ei++) {
            var ev = ests[ei];
            if (typeof ev === 'number' && ev >= baseStar - rangeN && ev <= baseStar + rangeN) {
              inRange = true;
              break;
            }
          }
          if (!inRange) continue;
        } else if (ratingsByKey) {
          // baseStar 없어도 bucketMean 계산 위해 rat 조회
          var diff3 = CHART2DIFF[cn2];
          recRat = diff3 ? ratingsByKey[normFn(sp2.t) + '|' + diff3] : null;
        }
        var pt2 = avgPt(ch2)[feat] || 0;
        if (pt2 <= 0) continue;  // 그 feature 가 아예 없는 곡만 제외
        var key2 = sid2 + '|' + cn2;
        var pInfo = played[key2];
        var playedRate = pInfo ? pInfo.rate : null;
        // 만점에 가까운 곡 (rate >= 95%) 제외.
        if (playedRate != null && playedRate >= 95) continue;
        var recBM = recRat ? bucketMeanOf(recRat) : null;
        // 이미 평균 이상 친 곡 (residual >= 0, 강점 기여중) 제외 — 추천 의미 없음.
        if (playedRate != null && typeof recBM === 'number' && playedRate >= recBM) continue;
        recommends.push({
          songId: sid2, chartName: cn2, title: sp2.t, lv: lv2, pt: pt2,
          rate: playedRate,
          lampNum: pInfo ? pInfo.lampNum : null,
          djLevel: pInfo ? pInfo.djLevel : null,
          isNp: playedRate == null,
          bucketMean: recBM,
        });
      }
    }
    // 단순 pt desc 정렬 — top N. 친/NP 비율 강제 X.
    recommends.sort(function (a, b) { return b.pt - a.pt; });
    recommends = recommends.slice(0, topN);

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
