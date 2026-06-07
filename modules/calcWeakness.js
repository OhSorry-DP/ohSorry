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
//   chartStrengthMatch(chartPt, userVec) — Σ userVec_f × chartPt_f  (강점 차트 우선, 양손 평균)
//   chartWeaknessMatch                   — -chartStrengthMatch     (약점 차트 우선, 약점 보완 탭용)
//   chartStrengthMatchByHand(chartPt, vecL, vecR) — 손 분리 매치 → { L, R, total, max }
//
// 양손 분리:
//   calcUserWeakness 결과에 vec.__vecL / vec.__vecR (왼손/오른손 별 잔차 가중평균) 추가 노출.
//   기존 vec (양손 평균) 호환 그대로 유지. 손 분리는 chartStrengthMatchByHand 로 활용.
//
// UMD — 브라우저 (window.OhsorryWeakness) / Node (module.exports) 양쪽 지원.

;(function (factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;  // Node
  if (typeof window !== 'undefined') window.OhsorryWeakness = api;         // 브라우저
})(function () {
  // FEATS — mirror-invariant 10 feature. 양손 평균/vecL/vecR 흐름.
  var FEATS = ['NOTES', 'CHORD', 'PEAK', 'CHARGE', 'SCRATCH', 'SOF-LAN', 'PHRASE', 'JACK', 'TRILL', 'RAND'];
  // UPSERT_FEATS — supabase user_ohsorry_radars 의 28 dim 컬럼 (mirror-invariant 10 + mirror 9 × L/R 18).
  //   computePatternScoreVec 에서만 사용 — FEATS (10) 만 쓰면 옛 시그니처라 RPC 매칭 실패.
  //   다른 함수 (avgPt/약점 계산 등) 는 FEATS 그대로 사용 (chart pt 양손 평균 흐름).
  var UPSERT_FEATS = FEATS.concat([
    'STAIR_UP_L', 'STAIR_UP_R', 'STAIR_DN_L', 'STAIR_DN_R',
    'K1_L', 'K1_R', 'K2_L', 'K2_R', 'K3_L', 'K3_R',
    'K4_L', 'K4_R', 'K5_L', 'K5_R', 'K6_L', 'K6_R', 'K7_L', 'K7_R',
  ]);
  // MIRROR_FEATS — mirror 적용 시 변하는 9 feature × 손별 분리 (18 dim).
  //   patterns-all-slim 의 m1/m2 에 저장된 STAIR_UP/STAIR_DN/DENSITY[k1~k7] 와 매칭.
  //   user vec 의 dim 이름: STAIR_UP_L, STAIR_UP_R, STAIR_DN_L, STAIR_DN_R, K1_L, K1_R, ..., K7_L, K7_R
  //   각 dim 의 chart pt source — m1 (왼손 _L) 또는 m2 (오른손 _R) 에서 정해진 key/index 의 값.
  var MIRROR_STEMS = [
    { stem: 'STAIR_UP', srcKey: 'STAIR_UP', srcIdx: null },
    { stem: 'STAIR_DN', srcKey: 'STAIR_DN', srcIdx: null },
    { stem: 'K1', srcKey: 'DENSITY', srcIdx: 0 },
    { stem: 'K2', srcKey: 'DENSITY', srcIdx: 1 },
    { stem: 'K3', srcKey: 'DENSITY', srcIdx: 2 },
    { stem: 'K4', srcKey: 'DENSITY', srcIdx: 3 },
    { stem: 'K5', srcKey: 'DENSITY', srcIdx: 4 },
    { stem: 'K6', srcKey: 'DENSITY', srcIdx: 5 },
    { stem: 'K7', srcKey: 'DENSITY', srcIdx: 6 },
  ];
  // m 객체에서 stem 에 대응하는 value 추출.
  function mSrc(m, stem) {
    if (!m) return 0;
    if (stem.srcIdx == null) return m[stem.srcKey] || 0;
    var arr = m[stem.srcKey];
    return (arr && typeof arr[stem.srcIdx] === 'number') ? arr[stem.srcIdx] : 0;
  }
  // mirror swap — m1/m2 를 mirror 적용한 새 객체 반환. STAIR_UP↔STAIR_DN, DENSITY[k]↔DENSITY[6-k].
  function applyMirror(m) {
    if (!m) return null;
    var d = m.DENSITY || [0, 0, 0, 0, 0, 0, 0];
    return {
      STAIR_UP: m.STAIR_DN || 0,
      STAIR_DN: m.STAIR_UP || 0,
      DENSITY: [d[6] || 0, d[5] || 0, d[4] || 0, d[3] || 0, d[2] || 0, d[1] || 0, d[0] || 0],
      // PEAK_CHORD 은 best 평가에 안 쓰지만 정보용 보존 가능 (지금은 swap 안 함, dim 비교 아님).
      PEAK_CHORD: m.PEAK_CHORD || {},
    };
  }
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

  // rateRef ({ ec: { "9.5": {mean, n}, ... }, hc: {...}, exh: {...} }) → stage 별 sorted bucket cache.
  // clamp: bucket < min → min bucket rate / bucket > max → max bucket rate.
  function makeRateRefCache(rateRef) {
    if (!rateRef) return null;
    var cache = {};
    var stages = ['ec', 'hc', 'exh'];
    for (var si = 0; si < stages.length; si++) {
      var s = stages[si];
      var ref = rateRef[s];
      if (!ref) continue;
      var bks = [];
      for (var k in ref) if (Object.prototype.hasOwnProperty.call(ref, k)) bks.push(parseFloat(k));
      bks.sort(function (a, b) { return a - b; });
      if (bks.length === 0) continue;
      cache[s] = { ref: ref, min: bks[0], max: bks[bks.length - 1] };
    }
    return cache;
  }
  function refRateOf(refCache, stage, bucket) {
    if (!refCache) return null;
    var rc = refCache[stage];
    if (!rc) return null;
    var b = bucket < rc.min ? rc.min : (bucket > rc.max ? rc.max : bucket);
    var entry = rc.ref[b.toFixed(1)];
    return entry && typeof entry.mean === 'number' ? entry.mean : null;
  }

  function calcUserWeakness(opts) {
    var allCharts = opts.allCharts || [];
    var patternsMap = opts.patternsMap || {};
    var normFn = opts.normFn || function (s) { return s; };
    var minLv = typeof opts.minLv === 'number' ? opts.minLv : 11;
    var ratingMap = opts.ratingMap;
    var zasaMap = opts.zasaMap;
    // rateRef — absolute reference (3550명 ereter-fetched 평균). 있으면 self-relative bucketMean 대신 사용.
    //   잔차 = rate - rateRef[stage][bucket] → 모든 사용자 동일 baseline → vec 직접 비교 가능.
    //   bucket 이 reference 영역 밖이면 lowest/highest bucket 으로 clamp.
    var refCache = makeRateRefCache(opts.rateRef);

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
      var ptP1 = sp.c[cn].p1 || {};
      var ptP2 = sp.c[cn].p2 || {};
      var ptM1 = sp.c[cn].m1 || null;  // mirror metric — 왼손 (정규 시 1P 자리)
      var ptM2 = sp.c[cn].m2 || null;
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
          // rateRef 모드면 entry 별로 즉시 residual 계산 (absolute), 아니면 bucketAgg 누적 후 후속 계산 (self-relative).
          var refRate = refCache ? refRateOf(refCache, stage, bucket) : null;
          entries.push({
            chartId: sid + '|' + cn, title: c.title, diff: c.diff, lv: lv,
            stage: stage, star: star, bucket: bucket,
            rate: rate, pt: pt, ptP1: ptP1, ptP2: ptP2, ptM1: ptM1, ptM2: ptM2, lampNum: c.lampNum,
            referenceRate: refRate,
            residual: refRate != null ? rate - refRate : null,  // self-relative 모드는 뒤에서 계산
          });
          if (refRate == null) {
            if (!bucketAgg[bucket]) bucketAgg[bucket] = { sum: 0, n: 0 };
            bucketAgg[bucket].sum += rate;
            bucketAgg[bucket].n += 1;
          }
        }
      } else {
        // legacy — lv 단위 bucket
        if (lv < minLv) continue;
        matched++;
        var entry = {
          chartId: sid + '|' + cn, title: c.title, diff: c.diff, lv: lv,
          rate: rate, pt: pt, ptP1: ptP1, ptP2: ptP2, lampNum: c.lampNum,
        };
        if (!byLv[lv]) byLv[lv] = [];
        byLv[lv].push(entry);
        entries.push(entry);
      }
    }

    // 잔차 계산 — rateRef 모드면 entry 별로 이미 계산됨. self-relative 모드만 후속 계산.
    if (ratingsByKey && !refCache) {
      for (var bk in bucketAgg) bucketAgg[bk].mean = bucketAgg[bk].sum / bucketAgg[bk].n;
      for (var ei = 0; ei < entries.length; ei++) {
        entries[ei].residual = entries[ei].rate - bucketAgg[entries[ei].bucket].mean;
      }
    } else if (!ratingsByKey) {
      for (var lv2 in byLv) {
        if (!Object.prototype.hasOwnProperty.call(byLv, lv2)) continue;
        var arr = byLv[lv2];
        var sum = 0;
        for (var j = 0; j < arr.length; j++) sum += arr[j].rate;
        var mean = sum / arr.length;
        for (var j2 = 0; j2 < arr.length; j2++) arr[j2].residual = arr[j2].rate - mean;
      }
    }

    // feature 별 가중평균 — 양손 평균(vec) + 왼손(vecL) + 오른손(vecR) 3종 동시 계산.
    //   vec  = residual × ptAvg[f] / Σptavg  (기존 호환 — chartStrengthMatch 가 그대로 활용)
    //   vecL = residual × ptP1[f] / ΣptP1    (왼손 강점/약점)
    //   vecR = residual × ptP2[f] / ΣptP2    (오른손 강점/약점)
    var vec = {}, vecL = {}, vecR = {};
    for (var fi = 0; fi < FEATS.length; fi++) {
      var f = FEATS[fi];
      var sumRP = 0, sumP = 0;
      var sumRPL = 0, sumPL = 0;
      var sumRPR = 0, sumPR = 0;
      for (var k2 = 0; k2 < entries.length; k2++) {
        var e2 = entries[k2];
        var ptF = e2.pt[f] || 0;
        var ptFL = (e2.ptP1 && e2.ptP1[f]) || 0;
        var ptFR = (e2.ptP2 && e2.ptP2[f]) || 0;
        sumRP += e2.residual * ptF;
        sumP += ptF;
        sumRPL += e2.residual * ptFL;
        sumPL += ptFL;
        sumRPR += e2.residual * ptFR;
        sumPR += ptFR;
      }
      vec[f] = sumP > 0 ? sumRP / sumP : 0;
      vecL[f] = sumPL > 0 ? sumRPL / sumPL : 0;
      vecR[f] = sumPR > 0 ? sumRPR / sumPR : 0;
    }
    // mirror 9 feature × 손별 분리 (18 dim). residual × m1.X (L) 또는 m2.X (R) 가중평균.
    for (var msi = 0; msi < MIRROR_STEMS.length; msi++) {
      var ms = MIRROR_STEMS[msi];
      var sumRPmL = 0, sumPmL = 0, sumRPmR = 0, sumPmR = 0;
      for (var k3 = 0; k3 < entries.length; k3++) {
        var e3 = entries[k3];
        var ml = mSrc(e3.ptM1, ms);
        var mr = mSrc(e3.ptM2, ms);
        sumRPmL += e3.residual * ml; sumPmL += ml;
        sumRPmR += e3.residual * mr; sumPmR += mr;
      }
      vec[ms.stem + '_L'] = sumPmL > 0 ? sumRPmL / sumPmL : 0;
      vec[ms.stem + '_R'] = sumPmR > 0 ? sumRPmR / sumPmR : 0;
    }
    vec.__meta = {
      matched: matched,
      entries: entries.length,
      mode: ratingsByKey ? (refCache ? 'rating+ref' : 'rating') : 'lv',
      lvCounts: ratingsByKey ? null : countLv(byLv),
      buckets: (ratingsByKey && !refCache) ? countBuckets(bucketAgg) : null,
    };
    // __entries / __bucketAgg / __refCache 는 analyzeFeature 가 재사용하도록 노출 (UI 표시 X)
    vec.__entries = entries;
    vec.__bucketAgg = bucketAgg;
    vec.__refCache = refCache;
    vec.__byLv = byLv;
    // 양손 분리 vec — 손별 강점/약점 분석용. chartStrengthMatchByHand 가 활용.
    vec.__vecL = vecL;
    vec.__vecR = vecR;
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

  // 차트 강점 매치 (손 분리 + FLIP 배치 평가).
  //   normal 배치: 왼손=p1, 오른손=p2 → L = vecL·p1, R = vecR·p2
  //   flip 배치:   왼손=p2, 오른손=p1 → flipL = vecL·p2, flipR = vecR·p1
  //   user 가 FLIP 옵션 쓰면 손 ↔ 패턴 매핑이 swap. flip total > normal total 이면 FLIP 추천.
  //
  //   vecL/vecR 은 calcUserWeakness 결과의 __vecL / __vecR.
  //   return: {
  //     L, R, total, max,                       // normal 배치 (기존 호환)
  //     flipL, flipR, flipTotal, flipMax,       // flip 배치
  //     best: 'normal'|'flip',                  // total 큰 쪽
  //     bestTotal,                              // 큰 쪽의 total
  //   }
  function chartStrengthMatchByHand(chartPt, vecL, vecR, opts) {
    var zero = { L: 0, R: 0, total: 0, max: 0, flipL: 0, flipR: 0, flipTotal: 0, flipMax: 0, best: 'normal', bestTotal: 0 };
    if (!chartPt || !vecL || !vecR) return zero;
    // opts.feats     — feature subset (예: 약점 보완 추천에서 SOF-LAN/SCRATCH/CHARGE 제외)
    // opts.handMode  — 'both'(default) / 'left' / 'right'. best/bestTotal 결정 시 어느 손 합계로 비교할지.
    // opts.flipOn    — true(default) / false. false 면 flip 비교 안 함 (normal 강제).
    // L/R/total/flipL/flipR/flipTotal 등 raw 값은 항상 그대로 노출 (호환).
    var feats = (opts && Array.isArray(opts.feats)) ? opts.feats : FEATS;
    var handMode = (opts && opts.handMode) || 'both';
    var flipOn = !(opts && opts.flipOn === false);
    var ptL = chartPt.p1 || {};
    var ptR = chartPt.p2 || {};
    var sL = 0, sR = 0, sFlipL = 0, sFlipR = 0;
    for (var i = 0; i < feats.length; i++) {
      var f = feats[i];
      var pl = ptL[f] || 0;
      var pr = ptR[f] || 0;
      var vl = vecL[f] || 0;
      var vr = vecR[f] || 0;
      sL += vl * pl;
      sR += vr * pr;
      sFlipL += vl * pr;   // 왼손이 p2 패턴 받음
      sFlipR += vr * pl;   // 오른손이 p1 패턴 받음
    }
    var total = sL + sR;
    var flipTotal = sFlipL + sFlipR;
    // handMode 별 normal/flip 합계 (best/bestTotal 결정용)
    var nT, fT;
    if (handMode === 'left')       { nT = sL; fT = sFlipL; }
    else if (handMode === 'right') { nT = sR; fT = sFlipR; }
    else                            { nT = total; fT = flipTotal; }
    var bestFlip = flipOn && fT > nT;
    return {
      L: sL, R: sR, total: total, max: sL > sR ? sL : sR,
      flipL: sFlipL, flipR: sFlipR, flipTotal: flipTotal, flipMax: sFlipL > sFlipR ? sFlipL : sFlipR,
      best: bestFlip ? 'flip' : 'normal',
      bestTotal: bestFlip ? fT : nT,
    };
  }

  // 8배치 misfinger penalty 가중치 — 강도 순서 k12/k67 > rand (사용자 정의).
  //   왼손 키보드 (1P, 스크 왼쪽) → 정규시 K6/K7 가 손가락 멀리 (무리 = k67), mirror 시 K1/K2 위치가 멀리 (무리 = k12).
  //   오른손 키보드 (2P, 스크 오른쪽) → 정규시 K1/K2 멀리 (무리 = k12), mirror 시 K6/K7 위치가 멀리 (무리 = k67).
  //   flip 영향 없음 (flip 은 m1/m2 데이터 swap 일 뿐, 손가락 매핑은 키보드 기준 고정).
  //   rand 는 mirror invariant. 각 result.total 에서 (strong*0.5 + rand*0.15) 차감 → best 가 자연스럽게 무리 적은 쪽.
  var MISFINGER_WEIGHT_STRONG = 0.5;
  var MISFINGER_WEIGHT_RAND = 0.15;
  function misfingerPenalty(m, mirrored, isLeftHand) {
    if (!m || !m.MISFINGER) return 0;
    var mf = m.MISFINGER;
    var strongCount;
    if (isLeftHand) strongCount = mirrored ? ((mf.k12 && mf.k12.count) || 0) : ((mf.k67 && mf.k67.count) || 0);
    else            strongCount = mirrored ? ((mf.k67 && mf.k67.count) || 0) : ((mf.k12 && mf.k12.count) || 0);
    var randCount = (mf.rand && mf.rand.count) || 0;
    return strongCount * MISFINGER_WEIGHT_STRONG + randCount * MISFINGER_WEIGHT_RAND;
  }

  // 8배치 trill penalty — 약지·소지가 직접 트릴 치는 배치가 무리 (스크 misfinger 와 반대 위치).
  //   왼손 키보드 (1P) 약지·소지 = 바깥 K1/K2 쪽 → 정규 무리 = 12/13/23, mirror 시 K6/K7 위치가 바깥 → mirror 무리 = 56/57/67.
  //   오른손 키보드 (2P) 약지·소지 = 바깥 K6/K7 쪽 → 정규 무리 = 56/57/67, mirror 무리 = 12/13/23.
  //   6페어 동일 가중치. 스크 misfinger(strong 0.5)보다 약하게 (사용자 정의). count 는 트릴 구간 노트 수 합.
  var TRILL_WEIGHT = 0.35;
  function trillPenalty(m, mirrored, isLeftHand) {
    if (!m || !m.TRILL) return 0;
    var t = m.TRILL;
    function sum(keys) {
      var s = 0;
      for (var i = 0; i < keys.length; i++) { var e = t[keys[i]]; if (e && e.count) s += e.count; }
      return s;
    }
    var low = sum(['12', '13', '23']);   // 왼쪽 바깥 (K1·K2 약지·소지)
    var high = sum(['56', '57', '67']);  // 오른쪽 바깥 (K6·K7 약지·소지)
    var grp;
    if (isLeftHand) grp = mirrored ? high : low;   // 정규 왼손 = low, mirror = high
    else            grp = mirrored ? low : high;   // 정규 오른손 = high, mirror = low
    return grp * TRILL_WEIGHT;
  }

  // 차트 8 배치 매치 — chartStrengthMatchByHand 의 mirror 확장.
  //   8 배치: N/N, M/-, -/M, M/M, F, F M/-, F -/M, F M/M
  //   mirror-invariant 10 feature (FEATS) dot product + mirror 9 feature (MIRROR_STEMS) × 손별 dot product.
  //   user vec 의 새 18 dim (STAIR_UP_L/R, ..., K7_L/R) 가 chart 의 m1/m2 (mirror applyMirror 거친) 와 매칭.
  //   misfinger penalty — 각 배치 total 에서 차감 (m1/m2 의 MISFINGER 컬럼). opts.misfingerOn=false 면 skip.
  //
  // chart: { p1, p2, m1, m2 } (patterns-all-slim 의 차트 row, lv 제외)
  // userVec: calcUserWeakness 결과. __vecL/__vecR + 새 18 dim 포함.
  // opts:
  //   flipOn       true(default) — false 면 4 배치 (정규 mirror 만), flip 안 비교
  //   mirrorOn     true(default) — false 면 mirror 안 비교 (정규 + flip 만)
  //   misfingerOn  true(default) — false 면 스크 misfinger penalty 안 차감 (디버그/비교용)
  //   trillOn      true(default) — false 면 약지·소지 trill penalty 안 차감 (디버그/비교용)
  //   handMode     'both'(default) / 'left' / 'right' — best 결정 시 합계 기준
  // return: { results: [...8 배치...], best: {label, total, flip, mL, mR}, bestLabel, bestTotal }
  //   results[i] — { flip, mL, mR, label, L, R, total, penalty } (total 은 이미 penalty 차감 후)
  function chartStrengthMatch8Way(chart, userVec, opts) {
    var feats = (opts && Array.isArray(opts.feats)) ? opts.feats : FEATS;
    var flipOn = !(opts && opts.flipOn === false);
    var mirrorOn = !(opts && opts.mirrorOn === false);
    var misfingerOn = !(opts && opts.misfingerOn === false);
    var trillOn = !(opts && opts.trillOn === false);
    var handMode = (opts && opts.handMode) || 'both';
    var normalize = !!(opts && opts.normalize);   // true 면 invariant·mirror 각자 norm 으로 나눠 -1~1 bestNorm 반환 (기존 bestTotal 은 불변)
    var vecL = userVec.__vecL || userVec;
    var vecR = userVec.__vecR || userVec;
    var p1 = (chart && chart.p1) || {}, p2 = (chart && chart.p2) || {};
    var m1 = (chart && chart.m1) || null, m2 = (chart && chart.m2) || null;

    // 손별 mirror feature score — user vec 의 _L 또는 _R suffix dim × chart m (mirror 거친 거 가능).
    function mirrorScore(vec, suffix, m) {
      if (!m) return 0;
      var s = 0;
      for (var i = 0; i < MIRROR_STEMS.length; i++) {
        var ms = MIRROR_STEMS[i];
        var v = vec[ms.stem + '_' + suffix] || 0;
        s += v * mSrc(m, ms);
      }
      return s;
    }
    // 손별 invariant feature score — FEATS subset × chart pt.
    function invariantScore(vec, pt) {
      var s = 0;
      for (var i = 0; i < feats.length; i++) {
        var f = feats[i];
        s += (vec[f] || 0) * (pt[f] || 0);
      }
      return s;
    }
    // 정규화 매치 — pt(곡 패턴)만 분모로 정규화하고 vec(강점/약점 잔차)는 분자에 그대로 둔다.
    //   = "이 곡 패턴 가중으로 본 내 평균 실력" → 곡마다 패턴 분포가 달라 곡 간 변별이 유지됨.
    //   (분모에 |vec| 를 넣으면 vec 가 전부 동부호인 유저에서 ±1 로 붕괴해 변별력이 사라지므로 pt 만 정규화.)
    //   invariant·mirror 를 각자 pt 로 정규화해 스케일을 맞춰 mirror raw count 쏠림도 방지.
    function invMatch(vec, pt) {
      var num = 0, den = 0;
      for (var i = 0; i < feats.length; i++) {
        var f = feats[i];
        var p = pt[f] || 0;
        num += (vec[f] || 0) * p;
        den += Math.abs(p);
      }
      return den > 0 ? num / den : 0;
    }
    function mirMatch(vec, suffix, m) {
      if (!m) return null;   // m 없으면 mirror 항 제외 → invariant 만으로 매치
      var num = 0, den = 0;
      for (var i = 0; i < MIRROR_STEMS.length; i++) {
        var ms = MIRROR_STEMS[i];
        var msrc = mSrc(m, ms);
        num += (vec[ms.stem + '_' + suffix] || 0) * msrc;
        den += Math.abs(msrc);
      }
      return den > 0 ? num / den : null;
    }

    var results = [];
    var flipCases = flipOn ? [false, true] : [false];
    var mirrorCases = mirrorOn ? [false, true] : [false];
    for (var fi = 0; fi < flipCases.length; fi++) {
      var flipped = flipCases[fi];
      var Lpt = flipped ? p2 : p1, Rpt = flipped ? p1 : p2;
      var Lm = flipped ? m2 : m1, Rm = flipped ? m1 : m2;
      for (var ml = 0; ml < mirrorCases.length; ml++) {
        for (var mr = 0; mr < mirrorCases.length; mr++) {
          var mirL = mirrorCases[ml], mirR = mirrorCases[mr];
          var LmCur = mirL ? applyMirror(Lm) : Lm;
          var RmCur = mirR ? applyMirror(Rm) : Rm;
          var sL = invariantScore(vecL, Lpt) + mirrorScore(userVec, 'L', LmCur);
          var sR = invariantScore(vecR, Rpt) + mirrorScore(userVec, 'R', RmCur);
          // 정규화 매치 — invariant·mirror 각각 pt 정규화한 뒤 평균 (mirror 데이터 없으면 invariant 만). normalize 옵션일 때만.
          var nL = 0, nR = 0;
          if (normalize) {
            var imL = invMatch(vecL, Lpt);
            var mmL = mirMatch(userVec, 'L', LmCur);
            nL = (mmL == null) ? imL : (imL + mmL) / 2;
            var imR = invMatch(vecR, Rpt);
            var mmR = mirMatch(userVec, 'R', RmCur);
            nR = (mmR == null) ? imR : (imR + mmR) / 2;
          }
          // misfinger + trill penalty — 왼손은 항상 isLeftHand=true (1P 키보드, 스크 왼쪽), 오른손은 false.
          //   flip 영향 없음 (flip 은 어느 m 데이터를 왼손/오른손이 잡는지만 바꿀 뿐, 손가락 매핑 고정).
          var penL = (misfingerOn ? misfingerPenalty(Lm, mirL, true) : 0) + (trillOn ? trillPenalty(Lm, mirL, true) : 0);
          var penR = (misfingerOn ? misfingerPenalty(Rm, mirR, false) : 0) + (trillOn ? trillPenalty(Rm, mirR, false) : 0);
          var scoreL = sL - penL;
          var scoreR = sR - penR;
          var penalty = penL + penR;
          var label;
          if (!flipped && !mirL && !mirR) label = '';
          else {
            var mirPart = (mirL || mirR) ? ((mirL ? 'M' : '-') + '/' + (mirR ? 'M' : '-')) : '';
            label = (flipped ? 'F' : '') + (flipped && mirPart ? ' ' : '') + mirPart;
          }
          results.push({
            flip: flipped, mL: mirL, mR: mirR, label: label,
            L: sL, R: sR,
            scoreL: scoreL, scoreR: scoreR,
            strengthRaw: sL + sR,        // penalty 차감 전 (weakness 계산용)
            total: scoreL + scoreR,      // penalty 차감 후 (misfingerOn=false 면 penalty=0)
            normL: nL, normR: nR,        // 정규화 손별 점수 (-1~1, normalize 옵션 시. 아니면 0)
            penaltyL: penL, penaltyR: penR, penalty: penalty,
          });
        }
      }
    }
    // best 결정 — handMode 별 합계 기준
    var best = results[0];
    var bestKey = function (r) {
      if (handMode === 'left') return (typeof r.scoreL === 'number') ? r.scoreL : r.L;
      if (handMode === 'right') return (typeof r.scoreR === 'number') ? r.scoreR : r.R;
      return r.total;
    };
    for (var ri = 1; ri < results.length; ri++) {
      if (bestKey(results[ri]) > bestKey(best)) best = results[ri];
    }
    var bestNorm;
    if (normalize) {
      bestNorm = (handMode === 'left') ? best.normL
               : (handMode === 'right') ? best.normR
               : ((best.normL + best.normR) / 2);   // both — 양손 평균 (-1~1)
    }
    return { results: results, best: best, bestLabel: best.label, bestTotal: bestKey(best), bestNorm: bestNorm };
  }

  // 약점 8 배치 매치 — chartStrengthMatch8Way 의 부호 반대.
  //   strength 작은 (= 어느 배치로도 매치 안 되는) 차트가 약점.
  //   bestTotal = -strengthRaw - penalty (penalty 양수면 weakness 점수도 같이 깎음).
  //   penalty 가 weakness 에 더해지지 않도록 strengthRaw 기준으로 계산 (= 무리배치 차트 약점 보완 후순위).
  //   best 배치 자체는 strength 기준 (= 가장 잘 매칭되는 배치로 약점 보완 추천).
  function chartWeaknessMatch8Way(chart, userVec, opts) {
    var s = chartStrengthMatch8Way(chart, userVec, opts);
    // penalty 는 strength 계산에서 이미 misfingerOn/trillOn 토글 반영됨 (둘 다 off 면 0). 그대로 사용.
    var bestPen = s.best.penalty || 0;
    var bestStrengthRaw = (typeof s.best.strengthRaw === 'number') ? s.best.strengthRaw : s.best.total;
    return {
      results: s.results, best: s.best,
      bestLabel: s.bestLabel,
      bestTotal: -bestStrengthRaw - bestPen,
      bestNorm: (typeof s.bestNorm === 'number') ? -s.bestNorm : undefined,   // 정규화 약점 점수 (-1~1, 매칭 낮을수록 ↑ = 약점)
    };
  }

  // chart_score × score_rate 의 top N 가중합 → supabase user_ohsorry_radars 컬럼 upsert 용.
  //   backfill-pattern-score.js (ohSorryRating) / ohSorry dbConn / INFOhSorry Analysis 모두 같은 알고리즘 — 한 곳에 통합.
  //
  // opts:
  //   charts         [{ title, diff, exScore, noteCount }] (diff = NORMAL/HYPER/ANOTHER/LEGGENDARIA)
  //   featureScores  feature-scores-slim.json 전체 객체 ({ _meta, scores })
  //   patternsMap    patterns-all-slim.json (title → songId 매핑용)
  //   normFn         title 정규화
  //   topN           (optional, default 30)
  //
  // 알고리즘:
  //   1. 각 chart 마다 featureScores.scores[songId][DP_xxx] 의 feature score lookup
  //   2. score_rate = exScore / (noteCount × 2)  (0~1)
  //   3. points = score × score_rate  (feature 별)
  //   4. score=0 인 (feature, chart) 쌍은 제외
  //   5. feature 별 points desc 정렬 → top N → 가중치 (1~5위=1.0, 6~30위=0.90~0.05 선형 감소) 가중합
  //
  // return: { NOTES, ..., RAND, STAIR_UP_L/R, STAIR_DN_L/R, K1_L/R ... K7_L/R }  (28 dim)
  //   값 범위 ~0~1500 (이론 max = maxScoreByFeat). null 입력 시 null 반환.
  //   28 dim = supabase user_ohsorry_radars 컬럼 + upsert_user_feature_score 29 인자 매칭.
  var SKILL_WEIGHTS = (function () {
    var ws = [];
    for (var i = 0; i < 5; i++) ws.push(1.0);
    for (var i2 = 0; i2 < 25; i2++) {
      var pct = 90 - i2 * (90 - 5) / 24;  // i=0 → 90, i=24 → 5
      ws.push(pct / 100);
    }
    return ws;
  })();
  function computePatternScoreVec(opts) {
    opts = opts || {};
    if (!opts.charts || !opts.featureScores || !opts.patternsMap) return null;
    var scoresMap = opts.featureScores.scores;
    if (!scoresMap) return null;
    var normFn = opts.normFn || function (s) { return s; };
    var topN = typeof opts.topN === 'number' ? opts.topN : 30;
    // title norm → songId 매핑
    var titleToSid = {};
    for (var sid in opts.patternsMap) {
      if (!Object.prototype.hasOwnProperty.call(opts.patternsMap, sid)) continue;
      var t = opts.patternsMap[sid] && opts.patternsMap[sid].t;
      if (t) titleToSid[normFn(t)] = sid;
    }
    // 각 feature 별 points 수집 — 28 dim (mirror-invariant 10 + mirror 9 × L/R 18).
    //   supabase upsert_user_feature_score 의 29 인자 시그니처와 매칭.
    var pointsByFeat = {};
    for (var fi = 0; fi < UPSERT_FEATS.length; fi++) pointsByFeat[UPSERT_FEATS[fi]] = [];
    for (var ci = 0; ci < opts.charts.length; ci++) {
      var c = opts.charts[ci];
      if (!c || typeof c.exScore !== 'number' || c.exScore <= 0) continue;
      if (typeof c.noteCount !== 'number' || c.noteCount <= 0) continue;
      var sid2 = titleToSid[normFn(c.title || '')];
      if (!sid2) continue;
      var cn = DIFF2CHART[c.diff];
      if (!cn) continue;
      var songScores = scoresMap[sid2];
      if (!songScores) continue;
      var chartScores = songScores[cn];
      if (!chartScores) continue;
      var scoreRate = c.exScore / (c.noteCount * 2);
      for (var fi2 = 0; fi2 < UPSERT_FEATS.length; fi2++) {
        var f = UPSERT_FEATS[fi2];
        var s = chartScores[f];
        if (typeof s !== 'number' || s <= 0) continue;
        pointsByFeat[f].push(s * scoreRate);
      }
    }
    // feature 별 top N 가중합
    var vec = {};
    for (var fi3 = 0; fi3 < UPSERT_FEATS.length; fi3++) {
      var f3 = UPSERT_FEATS[fi3];
      var top = pointsByFeat[f3].sort(function (a, b) { return b - a; }).slice(0, topN);
      var acc = 0;
      for (var ti = 0; ti < top.length; ti++) acc += top[ti] * SKILL_WEIGHTS[ti];
      vec[f3] = acc;
    }
    return vec;
  }

  // 약점 매치 (손 분리 + FLIP). strengthByHand 결과를 그대로 음수로 뒤집어서 약점 보완 정렬에 사용.
  //   약점 정렬은 일반적으로 total 작은 (= 가장 매치 안 되는) 차트가 약점 후보지만,
  //   FLIP 옵션 비교 시에는 "어느 배치로도 매치 안 되는" 차트 (flipTotal 도 작음) 가 진짜 약점.
  //   return: chartStrengthMatchByHand 결과의 부호만 반대 (L/R/total/max/flipL/flipR/flipTotal/flipMax + best='flip' 일 때 절댓값 큰 쪽 = flip 약점).
  function chartWeaknessMatchByHand(chartPt, vecL, vecR, opts) {
    var s = chartStrengthMatchByHand(chartPt, vecL, vecR, opts);
    // handMode 별 normal/flip 합계 — strength 와 같은 산식 (best 의 방향만 반대).
    var handMode = (opts && opts.handMode) || 'both';
    var flipOn = !(opts && opts.flipOn === false);
    var nT, fT;
    if (handMode === 'left')       { nT = s.L; fT = s.flipL; }
    else if (handMode === 'right') { nT = s.R; fT = s.flipR; }
    else                            { nT = s.total; fT = s.flipTotal; }
    var weakBest = (flipOn && fT < nT) ? 'flip' : 'normal';   // 더 작은 (= 약점이 더 드러나는) 쪽
    return {
      L: -s.L, R: -s.R, total: -s.total, max: -s.max,
      flipL: -s.flipL, flipR: -s.flipR, flipTotal: -s.flipTotal, flipMax: -s.flipMax,
      best: weakBest,
      bestTotal: weakBest === 'flip' ? -fT : -nT,
    };
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
  //   topN         default 30 (UI 표시 5 외에 fallback 풀로 활용 가능)
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
      ratingMap: opts.ratingMap, zasaMap: opts.zasaMap, rateRef: opts.rateRef, minLv: opts.minLv,
    });
    var baseStar = opts.baseStar;
    var rangeN = typeof opts.rangeN === 'number' ? opts.rangeN : 1;
    var topN = opts.topN || 30;

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
    var totalContrib = 0;
    for (var ck in byChart) {
      var bch = byChart[ck];
      bch.residual = bch.residualSum / bch.n;
      bch.contrib = bch.residual * bch.pt;
      totalContrib += bch.contrib;
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
    // bucketMean 소스 — rateRef (absolute, stage 별) 우선, 없으면 userVec.__bucketAgg (self-relative).
    var bucketAggForRec = userVec.__bucketAgg || null;
    var refCacheForRec = userVec.__refCache || makeRateRefCache(opts.rateRef);
    var STAGE_KEYS = [['estEc', 'ec'], ['estHc', 'hc'], ['estExh', 'exh']];
    function bucketMeanOf(rat) {
      var sum = 0, n = 0;
      for (var bi = 0; bi < STAGE_KEYS.length; bi++) {
        var ev = rat[STAGE_KEYS[bi][0]];
        if (typeof ev !== 'number') continue;
        var b = Math.floor(ev * 2) / 2;
        var r = null;
        if (refCacheForRec) r = refRateOf(refCacheForRec, STAGE_KEYS[bi][1], b);
        if (r == null && bucketAggForRec) {
          var agg = bucketAggForRec[b];
          if (agg && typeof agg.mean === 'number') r = agg.mean;
        }
        if (r != null) { sum += r; n++; }
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
      totalContrib: totalContrib,  // Σ byChart.contrib — UI 가 /100 스케일 단일 값 표시용 (기여곡 row 와 같은 단위)
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
    chartStrengthMatchByHand: chartStrengthMatchByHand,
    chartStrengthMatch8Way: chartStrengthMatch8Way,
    chartWeaknessMatch8Way: chartWeaknessMatch8Way,
    chartWeaknessMatchByHand: chartWeaknessMatchByHand,
    computePatternScoreVec: computePatternScoreVec,
    fetchPatternsMap: fetchPatternsMap,
    fetchAndCalcWeakness: fetchAndCalcWeakness,
    analyzeFeature: analyzeFeature,
  };
});
