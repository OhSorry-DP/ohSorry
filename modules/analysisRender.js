// analysisRender.js — 유저 분석탭 (vec 막대그래프 + percentile + 기여곡 + 추천곡) HTML 빌더.
//
// ohSorryWeb (브라우저) / INFOhSorry (electron renderer) 양쪽에서 같은 모듈을 fetch 해서 사용.
// 모듈은 stateless 한 HTML 문자열 빌더. 클릭 핸들러는 data-* 속성으로 위임 → 클라이언트가 처리.
//
// 인터페이스:
//   window.OhsorryAnalysisRender = {
//     VERSION,
//     buildAnalysisHTML(opts) -> string,
//     attachClickHandlers(rootEl, opts) -> void,  // 편의 helper (data-* 위임 + re-render)
//   }
//
// buildAnalysisHTML opts:
//   {
//     userVec,           // weaknessLib 결과 ({ NOTES: -0.5, ..., __entries: [...], __meta: {...} })
//     patternsMap,      ratingMap,                                              //
//     zasaMap,                                                                  // analyzeFeature 인자
//     allCharts,        baseStar,        normFn,                                //
//     percentiles,       // RPC 결과 { NOTES: { rank, total, percentile }, ... } 또는 null
//     selectedFeat,      // 'NOTES' 등 (null 이면 막대그래프 + placeholder 만)
//     noteCountResolver, // (songId, chartName) => number|null  (없으면 EXSCORE 표시 skip)
//     weaknessLib,       // window.OhsorryWeakness (선택, 없으면 window 에서 lookup)
//   }
//
// 클릭 위임 — 클라이언트가 직접 처리 권장:
//   [data-feat="NOTES"] 클릭 → selectedFeat 갱신 + buildAnalysisHTML 재호출
//   [data-clickable-chart] 클릭 → data-title, data-diff 추출 → 자기 모달 / 탭 이동
//
// UMD — 브라우저 (window.OhsorryAnalysisRender) / Node (module.exports) 양쪽 지원.

;(function (factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.OhsorryAnalysisRender = api;
})(function () {
  // 변경 이력 (VERSION 변수 = 캐시/배포 확인용 표기, 실제 캐시 무효화 로직 없음):
  //   0.0.1 — 초기 (HTML 빌드 + 클릭 위임)
  //   0.0.2 — extraRecFilter 옵션 추가 (추천 풀 추가 필터, INF 미수록곡 제외용)
  //   0.0.3 — noteCountResolver 시그니처 확장 (songId, chartName, title, diff)
  //   0.0.4 — 추천곡 표 noteCountResolver 호출 시 CHART2DIFF 변환 (c.diff 없을 때 대응)
  //   0.0.5 — 헤더 score 를 userVec.__absoluteSkill (avg over played charts: (chart_pt+85)×rate%) 로 전환
  //   0.0.6 — 막대그래프 + vRel / isPos 모두 absoluteSkill 기준으로 통일 (헤더와 단위 일치)
  //   0.0.7 — feature 별 NORMALIZE_K (174명 상위 10% 평균=180 매핑) 적용 (막대 + 헤더 score 양쪽)
  //   0.0.8 — 6 feature Q-Q 5점 piecewise linear interpolation (eamuse 분포 정확 매핑)
  //   0.0.9 — 막대그래프 잔차 (raw userVec) 기반으로 복구. __absoluteSkill + NORMALIZE 분기 제거.
  //           헤더 detail score / normalizeSkill / NORMALIZE_ANCHORS 정의는 그대로 유지.
  var VERSION = '0.0.9';

  var FEATS = [
    { k: 'NOTES',   ko: '노트수',     desc: '곡의 전체 노트 양과 밀도' },
    { k: 'CHORD',   ko: '동시치기',   desc: '2개 이상 노트를 동시에 누르는 패턴의 빈도·복잡도' },
    { k: 'PHRASE',  ko: '계단',       desc: '인접 키가 순차로 흐르는 패턴 (1→2→3→4 형식)' },
    { k: 'PEAK',    ko: '순간 밀도',  desc: '곡 중 노트가 가장 빽빽하게 쏟아지는 구간의 nps' },
    { k: 'RAND',    ko: '산발',       desc: '키 위치가 지그재그로 자주 바뀌는 분산 패턴' },
    { k: 'JACK',    ko: '축연타',     desc: '같은 키를 짧은 간격으로 반복해서 누르는 패턴' },
    { k: 'TRILL',   ko: '트릴',       desc: '두 키를 빠르게 번갈아 누르는 패턴' },
    { k: 'CHARGE',  ko: '롱노트',     desc: '차지 노트(CN)/헬차지/백스핀 스크래치 비중과 처리 난이도' },
    { k: 'SCRATCH', ko: '스크래치',   desc: '턴테이블을 돌려야 하는 패턴의 빈도와 난이도' },
    { k: 'SOF-LAN', ko: '변속',       desc: 'BPM 변화 횟수 (느려지거나 빨라지는 정도)' },
  ];
  var DIFF_SHORT_LBL = { ANOTHER: 'A', HYPER: 'H', NORMAL: 'N', LEGGENDARIA: 'L' };
  var CHART2DIFF = { DP_NOR: 'NORMAL', DP_HYP: 'HYPER', DP_ANO: 'ANOTHER', DP_LEG: 'LEGGENDARIA' };
  var DJ_CUTOFFS = [2/9, 3/9, 4/9, 5/9, 6/9, 7/9, 8/9, 0.93, 0.95, 0.96, 0.97, 0.98, 0.99, 1.0];

  // 정규화 앵커 — 6 feature 는 159명 (eamuse + os 둘 다 있는 유저) 의 Q-Q 매칭 (percentile 0/25/50/75/100).
  //   같은 percentile 의 (우리값, eamuse값) 5쌍 → piecewise linear interpolation.
  //   분포 모양 그대로 매핑 → 회귀 (선형 1줄) 보다 분포 끝 (꼬리) 정확도 높음.
  //   4 feature (PHRASE/JACK/TRILL/RAND) 는 eamuse 매칭 X — p0/25/50/75/100 → 0/50/100/170/200 단순 매핑.
  var NORMALIZE_ANCHORS = {
    'NOTES':   [{x:67.24,y:31.48}, {x:81.38,y:100.01}, {x:89.37,y:124.97}, {x:101.21,y:146.06}, {x:109.96,y:180.04}],
    'CHORD':   [{x:54.68,y:28.91}, {x:69.63,y:103.37}, {x:76.16,y:139.30}, {x:89.17,y:161.78}, {x:95.26,y:191.02}],
    'PEAK':    [{x:65.38,y:16  }, {x:83.42,y:76.00}, {x:92.55,y:127.00}, {x:112.37,y:150.00}, {x:126.04,y:183.00}],  // y 를 6 feature 평균으로 (이전 29.5/94.8/120.8/141.5/180 — 사용자 체감 낮음)
    'CHARGE':  [{x:49.33,y:16  }, {x:62.61,y:76.00}, {x:68.62,y:127.00}, {x:80.06,y:150.00}, {x:84.89,y:183.00}],  // y 를 6 feature 평균으로 (이전 0.7/71.7/132.3/152.0/184.7 — 사용자 체감 높음)
    'SCRATCH': [{x:52.14,y: 5.07}, {x:65.36,y:66.94}, {x:71.09,y:134.16}, {x:83.70,y:152.08}, {x:92.07,y:181.62}],
    'SOF-LAN': [{x:48.28,y:16  }, {x:62.61,y:76.00}, {x:68.43,y:100.00}, {x:81.31,y:145.00}, {x:87.25,y:180.00}],  // 낮은쪽 올리고 (이전 0/18) 중간 낮춤 (이전 112) 최상위 비슷
    // 4 feature — eamuse 매칭 X. y 는 6 feature 의 percentile 평균 (16/76/127/150/183),
    //   x 는 174명 user_radars 의 해당 feature 우리값 p0/25/50/75/100.
    'PHRASE':  [{x: 7.2,y: 16}, {x:73.7,y: 76}, {x:81.9,y:127}, {x:92.4,y:150}, {x:100.2,y:183}],
    'JACK':    [{x: 7.7,y: 16}, {x:66.1,y: 76}, {x:72.9,y:127}, {x:87.1,y:150}, {x: 91.6,y:183}],
    'TRILL':   [{x: 8.8,y: 16}, {x:66.0,y: 76}, {x:73.3,y:127}, {x:85.8,y:150}, {x: 91.1,y:183}],
    'RAND':    [{x: 7.4,y: 16}, {x:70.5,y: 76}, {x:78.0,y:127}, {x:90.6,y:150}, {x: 95.9,y:183}],
  };
  // piecewise linear interpolation — x 가 앵커 사이면 선형 보간, 양 끝 밖이면 가장 가까운 segment 의 slope 로 extrapolation.
  function normalizeSkill(featKey, rawSkill) {
    if (typeof rawSkill !== 'number') return null;
    var anchors = NORMALIZE_ANCHORS[featKey];
    if (!anchors || anchors.length < 2) return rawSkill;
    var x = rawSkill;
    // 앵커 정렬 가정 (x 오름차순). 양 끝 extrapolation 포함.
    for (var i = 0; i < anchors.length - 1; i++) {
      var a = anchors[i], b = anchors[i + 1];
      if (x <= b.x || i === anchors.length - 2) {
        var t = (b.x - a.x) === 0 ? 0 : (x - a.x) / (b.x - a.x);
        return a.y + t * (b.y - a.y);
      }
    }
    return anchors[anchors.length - 1].y;
  }

  function escH(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildBarChart(userVec, selectedFeat) {
    // 막대그래프 — userVec[f.k] (잔차 분석 결과) 의 사용자 평균 대비 상대값.
    var valsRaw = FEATS.map(function (f) {
      return userVec[f.k] || 0;
    });
    var userMean = valsRaw.reduce(function (s, v) { return s + v; }, 0) / valsRaw.length;
    var vals = valsRaw.map(function (v) { return v - userMean; });
    var maxAbs = Math.max.apply(null, vals.map(Math.abs).concat(1));
    var cols = FEATS.map(function (f, i) {
      var v = vals[i];
      var pct = Math.abs(v) / maxAbs * 50;
      var isPos = v >= 0;
      var color = isPos ? '#28a745' : '#dc3545';
      var sign = isPos ? '+' : '';
      var barStyle = isPos
        ? 'bottom:50%;height:' + pct + '%;background:' + color
        : 'top:50%;height:' + pct + '%;background:' + color;
      var divider = i === 4 ? ';border-right:1px dashed #ccc;margin-right:4px;padding-right:4px' : '';
      var tip = f.k + ' (' + f.ko + ')\n' + f.desc;
      var tipAttr = ' title="' + tip.replace(/"/g, '&quot;') + '"';
      var selBg = selectedFeat === f.k ? 'background:rgba(127,127,127,0.15);' : '';
      return ''
        + '<div data-feat="' + f.k + '"' + tipAttr + ' style="' + selBg + 'cursor:pointer;flex:1;display:flex;flex-direction:column;align-items:center;position:relative' + divider + '">'
        + '  <div style="height:16px;font-size:12px;font-weight:600;color:' + color + '">' + sign + v.toFixed(1) + '</div>'
        + '  <div style="position:relative;flex:1;width:100%;min-height:100px">'
        + '    <div style="position:absolute;top:50%;left:0;right:0;height:1px;background:#ccc"></div>'
        + '    <div style="position:absolute;left:20%;right:20%;' + barStyle + ';border-radius:2px"></div>'
        + '  </div>'
        + '  <div style="margin-top:4px;font-size:11px;color:#666;font-weight:500;white-space:nowrap">' + f.k + '</div>'
        + '</div>';
    }).join('');
    return { cols: cols, userMean: userMean };
  }

  // selectedFeat 의 상세 (헤더 + percentile + 기여곡 + 추천곡) HTML
  function buildDetailHTML(opts, userMean) {
    var k = opts.selectedFeat;
    var userVec = opts.userVec;
    var weaknessLib = opts.weaknessLib || (typeof window !== 'undefined' && window.OhsorryWeakness);
    var patternsMap = opts.patternsMap;
    var ratingMap = opts.ratingMap;
    var zasaMap = opts.zasaMap;
    var allCharts = opts.allCharts;
    var baseStar = opts.baseStar;
    var normFn = opts.normFn || (function (s) { return s; });
    var percentiles = opts.percentiles;
    var noteCountResolver = opts.noteCountResolver || function () { return null; };
    var canAnalyze = !!(weaknessLib && weaknessLib.analyzeFeature && patternsMap && Array.isArray(allCharts));

    var f = FEATS.find(function (x) { return x.k === k; });
    if (!f) return '';
    // __absoluteSkill × NORMALIZE_K[k] (eamuse 단위 ~180) 우선.
    //   없으면 fallback (vec + 80, 옛 정규화). vRel / isPos / 헤더 score 모두 같은 기준.
    var skill = userVec.__absoluteSkill;
    var hasSkill = skill && typeof skill[k] === 'number';
    var vAbs;
    if (hasSkill) {
      var n = normalizeSkill(k, skill[k]);
      vAbs = typeof n === 'number' ? n : skill[k];
    } else {
      vAbs = (userVec[k] || 0) + 80;
    }
    var vRel = vAbs - userMean;
    var isPos = vRel >= 0;
    var absScore = vAbs;

    var html = ''
      + '<div style="font-size:15px;margin-bottom:4px"><b style="font-size:17px">' + escH(f.k) + '</b> <span style="color:#aaa;font-weight:400">' + absScore.toFixed(1) + 'pt</span></div>'
      + '<div style="font-size:11px;opacity:0.65;margin-bottom:8px">' + escH(f.desc) + '</div>';

    if (!canAnalyze) {
      html += '<div style="opacity:0.6;font-size:11px">상세 분석 데이터 부재 (patterns / allCharts 미로드)</div>';
      return html;
    }

    function callAnalyze(rangeN) {
      return weaknessLib.analyzeFeature({
        feat: k, allCharts: allCharts, patternsMap: patternsMap,
        ratingMap: ratingMap, zasaMap: zasaMap, normFn: normFn,
        userVec: userVec, baseStar: baseStar, rangeN: rangeN,
      });
    }

    var r;
    try { r = callAnalyze(1); } catch (e) {
      return html + '<div style="opacity:0.6;font-size:11px;color:#dc3545">분석 오류: ' + escH(e.message) + '</div>';
    }

    var pct = percentiles && percentiles[k];
    if (pct && typeof pct.rank === 'number' && typeof pct.total === 'number' && pct.total > 0) {
      html += '<div style="font-size:13px;margin-bottom:8px;opacity:0.85">'
        + '<b>' + pct.rank + '위 / ' + pct.total + '명</b>'
        + (typeof pct.percentile === 'number' ? ' · 상위 <b>' + pct.percentile.toFixed(1) + '%</b>' : '')
        + '</div>';
    } else {
      html += '<div style="font-size:13px;margin-bottom:8px;opacity:0.6">랭킹 데이터 없음 (오소리 본체 1회 실행 후 갱신됨)</div>';
    }

    // byChartData + sumPtPerFeat 빌드 — vRel 기여 계산용
    var entriesAll = userVec.__entries || [];
    var byChartData = {};
    for (var i = 0; i < entriesAll.length; i++) {
      var e = entriesAll[i];
      if (!byChartData[e.chartId]) byChartData[e.chartId] = {
        pt: e.pt, rSum: 0, n: 0,
        title: e.title, diff: e.diff, lv: e.lv, rate: e.rate, lampNum: e.lampNum,
      };
      byChartData[e.chartId].rSum += e.residual;
      byChartData[e.chartId].n += 1;
    }
    for (var cid in byChartData) byChartData[cid].rAvg = byChartData[cid].rSum / byChartData[cid].n;
    var sumPtPerFeat = {};
    for (var fi = 0; fi < FEATS.length; fi++) {
      var s = 0;
      for (var cid2 in byChartData) s += (byChartData[cid2].pt[FEATS[fi].k] || 0);
      sumPtPerFeat[FEATS[fi].k] = s;
    }
    var sumPtAll = sumPtPerFeat[k] || 0;

    function chartContribToVRel(cid, fk) {
      var bc = byChartData[cid];
      if (!bc) return 0;
      var myContrib = 0, meanContrib = 0;
      for (var j = 0; j < FEATS.length; j++) {
        var sp = sumPtPerFeat[FEATS[j].k];
        if (sp > 0) {
          var cf = bc.rAvg * (bc.pt[FEATS[j].k] || 0) / sp;
          meanContrib += cf;
          if (FEATS[j].k === fk) myContrib = cf;
        }
      }
      meanContrib /= FEATS.length;
      return myContrib - meanContrib;
    }

    var allChartsVRel = Object.keys(byChartData).map(function (cid) {
      var bc = byChartData[cid];
      var parts = cid.split('|');
      return {
        chartId: cid, songId: parts[0], chartName: parts[1],
        title: bc.title, diff: bc.diff, lv: bc.lv,
        pt: bc.pt[k] || 0,
        rate: bc.rate, lampNum: bc.lampNum,
        residual: bc.rAvg,
        vRel: chartContribToVRel(cid, k),
      };
    });
    var sortedContribs = allChartsVRel.slice().sort(isPos
      ? function (a, b) { return b.vRel - a.vRel; }
      : function (a, b) { return a.vRel - b.vRel; }
    );
    var topContributors = sortedContribs.slice(0, 5);

    var cTitle = isPos ? '강점 기여 Top 5' : '약점 기여 Top 5';
    html += '<div style="font-size:13px;font-weight:600;margin-bottom:4px">' + cTitle + '</div>';
    if (topContributors.length === 0) {
      html += '<div style="opacity:0.6;font-size:13px;margin-bottom:8px">데이터 없음</div>';
    } else {
      html += '<div style="font-size:13px;margin-bottom:8px">';
      html += '<div style="display:flex;gap:6px;padding:2px 0;border-bottom:1px solid rgba(127,127,127,0.3);opacity:0.6;font-size:11px;font-weight:600">'
        + '<span style="width:26px;flex-shrink:0">lv</span>'
        + '<span style="width:16px;flex-shrink:0">diff</span>'
        + '<span style="flex:1;min-width:0">곡명</span>'
        + (!isPos ? '<span style="width:140px;text-align:right;flex-shrink:0">현재 → 목표 EXSCORE</span>' : '')
        + '<span style="width:64px;text-align:right;flex-shrink:0">' + (isPos ? '득점' : '감점') + '</span>'
        + '</div>';
      topContributors.forEach(function (c) {
        var dl = DIFF_SHORT_LBL[c.diff] || '?';
        var hideContrib = !isPos && c.vRel >= 0;
        var contribStr = hideContrib ? '' : (c.vRel >= 0 ? '+' : '') + c.vRel.toFixed(2) + 'pt';
        var rowAttrs = ' class="__uprofile_pat_row" data-clickable-chart data-title="' + escH(c.title) + '" data-diff="' + escH(c.diff || '') + '"';
        var targetCell = '';
        if (!isPos) {
          var nc = noteCountResolver(c.songId, c.chartName, c.title, c.diff);
          var bucketMean = c.rate - c.residual;
          var targetStr = '', targetColor = '#888';
          if (typeof nc === 'number' && c.residual < 0) {
            var maxEx = nc * 2;
            var targetEx = Math.round(bucketMean * maxEx / 100);
            var currentEx = Math.round(c.rate * maxEx / 100);
            var diff = targetEx - currentEx;
            if (diff > 0) {
              targetStr = escH(currentEx + ' → ' + targetEx + ' ') + '<span style="color:#a08585;font-size:11px">-' + diff + '</span>';
              targetColor = '#e9ecef';
            }
          } else if (c.residual >= 0) {
            targetStr = escH('다른 곡 시도');
            targetColor = '#888';
          }
          targetCell = '<span style="width:140px;text-align:right;flex-shrink:0;color:' + targetColor + ';font-size:13px">' + targetStr + '</span>';
        }
        html += '<div' + rowAttrs + ' style="display:flex;gap:6px;padding:2px 0;border-bottom:1px solid rgba(127,127,127,0.15)">'
          + '<span style="opacity:0.5;width:26px;flex-shrink:0">lv' + c.lv + '</span>'
          + '<span style="opacity:0.7;width:16px;flex-shrink:0">' + dl + '</span>'
          + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escH(c.title) + '</span>'
          + targetCell
          + '<span style="width:64px;text-align:right;flex-shrink:0;color:' + (c.vRel >= 0 ? '#28a745' : '#dc3545') + '">' + contribStr + '</span>'
          + '</div>';
      });
      html += '</div>';
    }

    // 추천곡
    var contribIds = {};
    topContributors.forEach(function (c) { contribIds[c.chartId] = true; });
    var isBeginnerUser = baseStar != null && baseStar < 0.5;
    var RATING_BY_KEY = {};
    if (Array.isArray(ratingMap)) {
      for (var ri = 0; ri < ratingMap.length; ri++) {
        var rt = ratingMap[ri];
        if (rt && rt.title && rt.diff) RATING_BY_KEY[normFn(rt.title) + '|' + rt.diff] = rt;
      }
    }
    function passZasaFilter(c) {
      if (!isBeginnerUser) return true;
      var diff = CHART2DIFF[c.chartName] || '';
      var rt = RATING_BY_KEY[normFn(c.title) + '|' + diff];
      if (rt && typeof rt.zasaLevel === 'number' && rt.zasaLevel >= 11.8) return false;
      if (!rt && c.lv >= 12) return false;
      return true;
    }
    var extraRecFilter = (typeof opts.extraRecFilter === 'function') ? opts.extraRecFilter : null;
    function buildRecs(rResult) {
      var recs = (rResult.recommends || [])
        .filter(function (x) { return !contribIds[x.songId + '|' + x.chartName]; })
        .filter(passZasaFilter);
      if (extraRecFilter) recs = recs.filter(extraRecFilter);
      if (Array.isArray(rResult.contributors) && rResult.contributors.length > 5) {
        var existing = {};
        recs.forEach(function (x) { existing[x.songId + '|' + x.chartName] = true; });
        for (var ci = 5; ci < rResult.contributors.length; ci++) {
          var c2 = rResult.contributors[ci];
          var parts = (c2.chartId || '').split('|');
          var key = parts[0] + '|' + parts[1];
          if (existing[key] || contribIds[c2.chartId]) continue;
          var fallbackRec = {
            songId: parts[0], chartName: parts[1], title: c2.title, lv: c2.lv,
            pt: typeof c2.pt === 'number' ? c2.pt : ((c2.pt && c2.pt[k]) || 0),
            rate: c2.rate, lampNum: c2.lampNum, isNp: false,
            bucketMean: c2.rate - c2.residual,
            _fromContrib: true,
          };
          if (!passZasaFilter(fallbackRec)) continue;
          if (extraRecFilter && !extraRecFilter(fallbackRec)) continue;
          recs.push(fallbackRec);
          existing[key] = true;
        }
      }
      return recs;
    }
    var recsToRender = buildRecs(r);

    function nextDjOf(rate) {
      var ratio = rate / 100;
      for (var di = 0; di < DJ_CUTOFFS.length; di++) {
        if (ratio < DJ_CUTOFFS[di]) return { rate: DJ_CUTOFFS[di] * 100 };
      }
      return null;
    }
    var vRelRatio = (FEATS.length - 1) / FEATS.length;
    function gainAt(c, targetRate) {
      if (sumPtAll <= 0) return 0;
      var curRate = c.isNp ? 0 : c.rate;
      return (targetRate - curRate) * c.pt * vRelRatio / sumPtAll;
    }
    function findBestTarget(c) {
      if (typeof c.bucketMean !== 'number') return { gain: 0, target: null };
      var curRate = c.isNp ? 0 : c.rate;
      var startRate = curRate < c.bucketMean
        ? c.bucketMean
        : (nextDjOf(c.rate) ? nextDjOf(c.rate).rate : null);
      if (startRate == null) return { gain: 0, target: null };
      var target = startRate;
      for (var ti = 0; ti < 20; ti++) {
        var g = gainAt(c, target);
        if (g >= 0.005) return { gain: g, target: target };
        if (target >= 100) break;
        var nxt = nextDjOf(target);
        if (!nxt || nxt.rate <= target) break;
        target = nxt.rate;
      }
      return { gain: 0, target: null };
    }
    function applyBestAndFilter(recs) {
      for (var rii = 0; rii < recs.length; rii++) {
        var c3 = recs[rii];
        var bt = findBestTarget(c3);
        c3._bestGain = bt.gain;
        c3._bestTarget = bt.target;
      }
      return recs.filter(function (c) { return c._bestGain >= 0.005; });
    }
    function sortGentleFirst(arr) {
      var bigPlayed = arr.filter(function (c) { return c._bestGain >= 0.1 && !c.isNp; })
        .sort(function (a, b) { return a._bestGain - b._bestGain; });
      var bigNp = arr.filter(function (c) { return c._bestGain >= 0.1 && c.isNp; })
        .sort(function (a, b) { return a._bestGain - b._bestGain; });
      var small = arr.filter(function (c) { return c._bestGain < 0.1; })
        .sort(function (a, b) { return b._bestGain - a._bestGain; });
      var playedTake = Math.min(3, bigPlayed.length);
      var npTake = Math.min(2, bigNp.length);
      var result = bigPlayed.slice(0, playedTake).concat(bigNp.slice(0, npTake));
      var need = 5 - result.length;
      if (need > 0) {
        var leftover = bigPlayed.slice(playedTake).concat(bigNp.slice(npTake));
        result = result.concat(leftover.slice(0, need));
        need = 5 - result.length;
      }
      if (need > 0) result = result.concat(small.slice(0, need));
      return result;
    }

    recsToRender = sortGentleFirst(applyBestAndFilter(recsToRender));
    var RANGE_STEPS = [2, 3, 5];
    var stepIdx = 0;
    while (recsToRender.length < 5 && stepIdx < RANGE_STEPS.length) {
      try {
        var rExt = callAnalyze(RANGE_STEPS[stepIdx]);
        var extraIds = {};
        recsToRender.forEach(function (c) { extraIds[c.songId + '|' + c.chartName] = true; });
        var extra = applyBestAndFilter(buildRecs(rExt))
          .filter(function (c) { return !extraIds[c.songId + '|' + c.chartName]; });
        recsToRender = sortGentleFirst(recsToRender.concat(extra));
      } catch (e2) {}
      stepIdx++;
    }
    recsToRender = recsToRender.slice(0, 5);

    html += '<div style="font-size:13px;font-weight:600;margin-bottom:4px">추천곡 Top 5 (★' + (baseStar != null ? baseStar.toFixed(1) : '?') + ' 근처, ' + escH(f.ko) + ' 강한 곡)</div>';
    if (recsToRender.length === 0) {
      html += '<div style="opacity:0.6;font-size:13px">추천 곡 없음</div>';
    } else {
      html += '<div style="font-size:13px">';
      html += '<div style="display:flex;gap:6px;padding:2px 0;border-bottom:1px solid rgba(127,127,127,0.3);opacity:0.6;font-size:11px;font-weight:600">'
        + '<span style="width:26px;flex-shrink:0">lv</span>'
        + '<span style="width:16px;flex-shrink:0">diff</span>'
        + '<span style="flex:1;min-width:0">곡명</span>'
        + '<span style="width:140px;text-align:right;flex-shrink:0">현재 → 목표 EXSCORE</span>'
        + '<span style="width:60px;text-align:right;flex-shrink:0">득점</span>'
        + '</div>';
      recsToRender.forEach(function (c) {
        var dl = (c.chartName || '').replace('DP_', '').charAt(0) || '?';
        var recDiffFull = CHART2DIFF[c.chartName] || c.diff || '';
        var nc = noteCountResolver(c.songId, c.chartName, c.title, recDiffFull);
        var targetStr = '';
        var targetColor = '#888';
        var gainStr = '';
        if (typeof nc === 'number' && c._bestTarget != null) {
          var maxEx = nc * 2;
          var targetEx = Math.ceil(maxEx * c._bestTarget / 100);
          var currentEx = c.isNp ? 0 : Math.round(c.rate * maxEx / 100);
          var diff = targetEx - currentEx;
          targetColor = '#e9ecef';
          targetStr = escH(currentEx + ' → ' + targetEx + ' ') + '<span style="color:#a08585;font-size:11px">-' + diff + '</span>';
          gainStr = '+' + c._bestGain.toFixed(2) + 'pt';
        } else if (typeof c.bucketMean === 'number') {
          targetStr = escH('목표 ' + c.bucketMean.toFixed(1) + '%');
        }
        var recDiff = CHART2DIFF[c.chartName] || '';
        var recRowAttrs = ' class="__uprofile_pat_row" data-clickable-chart data-title="' + escH(c.title) + '" data-diff="' + escH(recDiff) + '"';
        html += '<div' + recRowAttrs + ' style="display:flex;gap:6px;padding:2px 0;border-bottom:1px solid rgba(127,127,127,0.15)">'
          + '<span style="opacity:0.5;width:26px;flex-shrink:0">lv' + c.lv + '</span>'
          + '<span style="opacity:0.7;width:16px;flex-shrink:0">' + escH(dl) + '</span>'
          + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escH(c.title) + '</span>'
          + '<span style="width:140px;text-align:right;flex-shrink:0;color:' + targetColor + ';font-size:13px">' + targetStr + '</span>'
          + '<span style="width:60px;text-align:right;flex-shrink:0;color:#28a745">' + gainStr + '</span>'
          + '</div>';
      });
      html += '</div>';
    }

    return html;
  }

  function buildAnalysisHTML(opts) {
    if (!opts || !opts.userVec) {
      return '<p class="__uprofile_tabempty">분석 데이터 없음 (userVec 부재)</p>';
    }
    var bar = buildBarChart(opts.userVec, opts.selectedFeat);
    var meta = opts.userVec.__meta || {};
    var lvParts = Object.keys(meta.lvCounts || {}).sort().map(function (lv) {
      return 'lv' + lv + ' ' + meta.lvCounts[lv];
    }).join(' / ');
    var detailHTML = opts.selectedFeat
      ? buildDetailHTML(opts, bar.userMean)
      : '<div style="margin-top:10px;padding:10px;font-size:13px;opacity:0.7;text-align:center">분석 항목을 선택하세요 (위 막대 클릭)</div>';
    return ''
      + '<div style="font-size:13px;opacity:0.75;margin-bottom:6px">현재 실력 평균 대비 강점+ / 약점−</div>'
      + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#888;margin-bottom:2px">'
      + '  <span>← 지력</span><span>개인차 →</span>'
      + '</div>'
      + '<div class="__uprofile_pat_chart" style="display:flex;align-items:stretch;gap:2px;height:140px;padding:4px 0">' + bar.cols + '</div>'
      + '<div style="font-size:12px;color:#888;margin-top:6px">매칭 ' + (meta.matched || 0) + '곡'
      + (lvParts ? ' (' + lvParts + ')' : '') + '</div>'
      + '<div class="__uprofile_pat_detail" style="margin-top:10px;padding:10px;font-size:13px;text-align:' + (opts.selectedFeat ? 'left' : 'center') + '">'
      + detailHTML + '</div>';
  }

  // 편의 helper — rootEl 안의 data-feat / data-clickable-chart 클릭을 캡처해서 콜백 호출 + 자동 re-render.
  //   opts: buildAnalysisHTML 의 opts 와 같지만 selectedFeat 는 내부 state 로 관리.
  //   handlers: { onChartClick(title, diff), onFeatChange?(feat) }
  function attachClickHandlers(rootEl, opts, handlers) {
    handlers = handlers || {};
    var state = { selectedFeat: opts.selectedFeat || null };
    function render() {
      rootEl.innerHTML = buildAnalysisHTML(Object.assign({}, opts, { selectedFeat: state.selectedFeat }));
    }
    rootEl.addEventListener('click', function (e) {
      var clickable = e.target.closest && e.target.closest('[data-clickable-chart]');
      if (clickable) {
        var title = clickable.getAttribute('data-title');
        var diff = clickable.getAttribute('data-diff');
        if (handlers.onChartClick) handlers.onChartClick(title, diff);
        return;
      }
      var featEl = e.target.closest && e.target.closest('[data-feat]');
      if (featEl) {
        var k = featEl.getAttribute('data-feat');
        state.selectedFeat = state.selectedFeat === k ? null : k;
        if (handlers.onFeatChange) handlers.onFeatChange(state.selectedFeat);
        render();
      }
    });
    render();
    return {
      setOpts: function (newOpts) { opts = newOpts; render(); },
      setSelectedFeat: function (k) { state.selectedFeat = k; render(); },
    };
  }

  return {
    VERSION: VERSION,
    FEATS: FEATS,
    buildAnalysisHTML: buildAnalysisHTML,
    attachClickHandlers: attachClickHandlers,
  };
});
