// analysisRender.js — 유저 분석탭 (vec 막대그래프 + percentile + 기여곡) HTML 빌더.
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
//     userVec,            // weaknessLib 결과 ({ NOTES: -0.5, ..., __entries: [...], __meta: {...} })
//     patternsMap,        // canAnalyze 게이트용 (값 자체는 미사용, 데이터 로드 여부만 체크)
//     allCharts,          // canAnalyze 게이트용 (위와 동일)
//     userPatternScore,   // 본인 user_ohsorry_radars { NOTES: 12.3, ... } — 헤더 절대값 표시
//     maxScoreByFeat,     // feature 별 이론 max (막대그래프 max% 환산용)
//     featureScores,      // { scores: { sid: { chartName: { NOTES: 80.5, ... } } } } — 스킬 대상곡 점수 lookup
//     percentiles,        // RPC 결과 { NOTES: { rank, total, percentile }, ... } 또는 null (랭킹 행)
//     allUserScores,      // 전체 user 배열 [{ iidx_id, dj_name, os_pattern_score: { NOTES: x, ... } }]
//                         //   — 인라인 ranking 표용. 없으면 "랭킹보기" 토글 비활성.
//     myIidxId,           // 본인 iidx_id — ranking 표에서 본인 row 강조용
//     selectedFeat,       // 'NOTES' 등. null 이면 자동으로 가장 강점인 feat (max% 최대) 선택.
//     weaknessLib,        // window.OhsorryWeakness (선택, 없으면 window 에서 lookup)
//     weaknessPopMean,    // weakness-popmean.json ({L,R,mir}) — 개인평가 막대/이유배지 usernorm baseline (선택, 없으면 raw 잔차)
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
  //   0.0.10 — 배율 전부 제거. 헤더 detail score 도 잔차 (vec + 80) 기준으로 통일.
  //            NORMALIZE_ANCHORS / normalizeSkill 함수 정의 통째 제거 (dead code).
  //   0.0.11 — 기여곡 표 Top 3 + 정렬 c.pt desc (그 feature 가 가장 강한 차트) + 표시 c.pt (곡 점수).
  //            강점/약점 동일 형식 (라벨 색만 다름).
  //   0.0.12 — 기여곡 표의 곡 점수 = opts.featureScores (gist 의 quantile score 0~100) lookup.
  //            featureScores 없으면 c.pt (calcWeakness raw 양손 평균) fallback.
  //   0.0.13 — 기여곡 표 3 컬럼: 곡 점수 / rate / 받은 점수 (= 곡 점수 × rate / 100).
  //   0.0.14 — 기여곡 표 정렬을 받은 점수 (earned) desc 로 변경. 추천곡 Top 5 → Top 10.
  //   0.0.15 — 헤더값 = supabase get_user_pattern_score (본인 user_radars os_*, 0~100). opts.userPatternScore 추가.
  //            percentile/rank 표시 제거 (RPC 폐기). 헤더값 없으면 vec + 80 fallback.
  //   0.0.16 — 랭킹 행 (percentile/rank) 표시 복구. opts.percentiles 받음 (없으면 행 숨김 — INFOhSorry 등).
  //            데이터 source 는 호출자가 client-side 로 계산 (전체 user_radars os_* 기준).
  //   0.0.17 — 헤더 score = userPatternScore[k] 만 (fallback 제거). string → parseFloat. 값 없으면 미표시.
  //   0.0.18 — Top 3 표에서 "현재 → 목표 EXSCORE" 컬럼 제거 (약점 feature 일 때만 보이던 컬럼).
  //   0.0.19 — 추천곡 실제 10곡 표시 (sortGentleFirst cap 5→10, played 3→6, np 2→4, extend loop 임계도 10).
  //   0.0.20 — 막대그래프 base 를 잔차(userVec) → max% (user_score / maxScoreByFeat × 100) 로 교체.
  //            userMean = 10 feature max% 평균. 막대 / 헤더 score 모두 (max% - userMean) 차이값.
  //            opts.userPatternScore (절대값) + opts.maxScoreByFeat (feature 별 이론 max) 사용.
  //   0.0.21 — 헤더 score 는 절대값 (user_score) 그대로 표시. isPos / 색은 max% 기반 유지 (막대 색과 일치).
  //   0.0.22 — 기여곡 표 "Top 3" → "스킬 대상곡 30곡". backfill 가중합 식의 top 30 곡 + weight × earned 표시.
  //            컬럼: # / lv / diff / 곡명 / 곡 점수 / rate / 받은 점수 / w / 기여 점수.
  //   0.0.23 — 컬럼 정리: # / w 제거, 기여 점수 끝에서 세번째 위치.
  //            색: lv+diff 는 diff 색상 / 기여 흰색 볼드 / rate · 점수 회색.
  //   0.0.24 — 가중치 1~5위 = 1.0, 6~30위 = 0.90 → 0.05 선형 감소 (계단 5곡 단위 → 선형).
  //   0.0.25 — percentile 행 오른쪽에 "랭킹보기" 버튼 추가 (data-action="show-feature-ranking").
  //            attachClickHandlers 에 handlers.onShowFeatureRanking(feat) 콜백 위임.
  //   0.0.26 — 기존 "추천곡 Top 10" 아래에 새 추천 영역 (Pool A 안친곡 + Pool B 향상곡 → ★ 기준 20곡).
  //            Pool A: chartScore desc top 30 / Pool B: (chartScore - earned) desc top 30 → 합쳐서 |chartStar - baseStar| asc top 20.
  //   0.0.27 — 새 추천 영역에 "예상점수" 컬럼 추가. user_avg_rate = 친 곡들의 rate 평균.
  //            미플 예상 = chartScore × avg / 100 / 향상 예상 = chartScore × max(현재rate, avg) / 100.
  //   0.0.28 — 새 추천 표 컬럼 정리: 곡점수 제거, 예상EX 추가, 예상/잠재 한 컬럼으로 결합.
  //            예상EX = notes × 2 × predicted_rate / 100 (noteCountResolver 활용).
  //   0.0.29 — 추천 filter: 예상점수가 스킬 대상곡 30위 earned 보다 낮으면 미표기. 정렬 = 예상점수 desc.
  //   0.0.30 — filter 폐기 — cutoff 이하 행은 표시는 하되 회색으로 약화 (의미 표시).
  //   0.0.31 — 새 추천 영역에 extraRecFilter 적용 (AC user는 AC 수록곡만 / INF user는 INF 수록곡만).
  //   0.0.32 — 새 추천 표에 "현재EX" 컬럼 추가 (친 곡: round(notes × 2 × rate / 100), 미플: '—').
  //   0.0.33 — 예상/잠재 컬럼 분리. rate / EX / 점수 모두 "현재→예상" 화살표 표기 (친 곡), 미플은 예상만. 유형 컬럼 삭제.
  //   0.0.34 — 기존 "추천곡 Top 10" 영역 폐기. 새 추천 표에서 ★ (zasaLevel) 컬럼 삭제.
  //   0.0.35 — 추천 표 색 스왑: 현재값 흰색 볼드 강조, 예상값 회색. 잠재 컬럼 삭제.
  //   0.0.36 — 스킬 대상곡 top 30 에 이미 있는 차트도 회색 (dim) 처리.
  //   0.0.37 — 추천 영역 (확장 추천 표) 전체 폐기. 관련 helper 코드 (passZasaFilter / buildRecs / findBestTarget / sortGentleFirst 등) 제거.
  //   0.0.38 — "랭킹보기" 버튼 핑크 액센트 (#ff6b9d outline) — shelf.js "프로필" 버튼과 일관 스타일.
  //   0.0.39 — (1) 분석탭 첫 진입 시 가장 강점인 feat (max% 최대) 자동 선택.
  //            (2) "랭킹보기" → "랭킹보기" ↔ "스킬곡 보기" 토글 버튼. 모달 대신 스킬 대상곡 위치에 인라인 ranking 표.
  //                본인 ≤ 30위: 1~30 표시 / 본인 31위~: 1, 2, 3 + "..." + 본인 주변 26명 (위 13 + 본인 + 아래 12).
  //            opts.allUserScores ([{ iidx_id, dj_name, os_pattern_score }]) + opts.myIidxId 추가. 없으면 토글 버튼 숨김.
  //   0.0.40 — (1) 인라인 ranking 표에 IIDX ID 컬럼 복귀 (DJ NAME 옆, 모노스페이스 회색). DJ NAME 볼드 처리. 헤더 IIDX ID 칸은 빈 라벨.
  //            (2) viewMode (랭킹 ↔ 스킬곡) 상태 유지 — 다른 feat 막대 클릭해서 내용 바뀌어도 토글 상태 보존.
  //   0.0.41 — ranking row: DJ NAME 셀 안에 ★rating + DJ NAME + IIDX ID 한 줄로 합침.
  //            ★ 노란색(#ffd43b) / IIDX ID 10px 모노 회색 / 헤더 IIDX ID 빈 칸 제거.
  //   0.0.42 — ★rating 을 DJ NAME 셀에서 분리해서 별도 컬럼으로 (# 뒤). 색을 핑크(#ff6b9d) 액센트로 변경.
  //   0.0.43 — ranking 표 cleanup: max% 컬럼 제거 + # 컬럼 width 고정 풀고 글자 수만큼 자동.
  //   0.0.44 — # 컬럼 우정렬 (min-width 28px) / ★ 컬럼 좌정렬 / 점수 뒤에 "pt" 접미 (작은 회색).
  //   0.0.45 — 막대그래프 기준 변경: max% 평균 대비 → "상위 N%" (= 100 - percentile) 평균 대비.
  //            percentiles 없으면 기존 max% 로 fallback.
  //   0.0.46 — 스킬 대상곡 표에서 chart_score == 0 인 곡 제외 (CHARGE/SOF-LAN 같은 sparse feature 에서 의미 없는 0/0 row 방지).
  //   0.0.47 — 막대그래프 "상대평가 ↔ 개인평가" 토글 추가 (오른쪽 위). 상대평가=상위N% 평균 대비(기존),
  //            개인평가=calcWeakness 잔차(userVec) 평균 대비. barMode 옵션/state 로 관리.
  //   0.0.48 — 평가 토글 스타일을 통계탭 "난이도 선택 :" 토글과 동일한 텍스트+파이프(active 볼드)로 변경.
  //   0.0.49 — 막대그래프 기본 모드를 개인평가(잔차)로 변경 (opts.barMode 명시 없으면 personal).
  //   0.0.50 — 스킬 대상곡 표 위에 잔차 강/약점 이유 박스 추가 (강/약점 배지 + 강한 곡 평균 rate vs 전체 평균 gap).
  //   0.0.51 — 이유 박스 문구를 수치 강조체로 ("<feature> 강한 곡을 전체보다 +X%p 잘/못 칩니다").
  //   0.0.52 — detail 헤더의 feature desc 설명줄 제거 (이유 박스와 중복).
  //   0.0.53 — NOTES 한국어 라벨 '노트수' → '물량'.
  //   0.0.54 — 이유 문구 "플레이 한 곡 중에 <feature>이/가 강한 곡을 평균적으로 ±X% 잘/못 칩니다" (조사 자동, %p→%).
  //   0.0.55 — 이유 배지 강/약점 판정을 막대그래프와 동일 기준(내 잔차 평균 대비)으로 — 막대 색/배지 불일치 해소.
  //   0.0.56 — 이유 문구 ±X% 를 막대 숫자(잔차-내평균)와 일치 + "다른 패턴보다" 문구로 (배지·막대·문구 동일 기준).
  //   0.0.57 — 이유 박스 하단 보조줄(강한 곡/전체 rate) 제거 + 미사용 strongAvg/gap 계산 정리.
  //   0.0.58 — 상대평가 막대 숫자를 등수('N위')로 + 이유 박스를 헤더↔등수 행 사이로 이동(랭킹보기 토글해도 유지).
  //   0.0.59 — 상대평가 막대를 바닥에서 시작(평균=가운데 50% 고정) + 동률(평균과 ≈같음) 시 중립 흰색. 점선 z-index 위로.
  //   0.0.60 — 막대 색을 라이벌 스택바 색으로 통일: 평균 이상(강점·동률) 노랑(#d9a92e) / 평균 미만(약점) 파랑(#2f6db3). 개인·상대평가 공통, 상대평가 단색.
  //   0.0.61 — 상대평가 막대를 절대 등수 스케일(1등=100%, 15등=0%, 16등+ 빈 막대)로 + 막대/등수 라벨 색을 다시 녹(강점)/빨(약점)로 복귀.
  //   0.0.62 — 상대평가 막대를 평균±15등 스케일로(평균선=meanLineP, 상위 유저는 평균선 위로 끌어올려 1등이 천장). 막대 색은 녹/빨, 등수 라벨은 흰색. 점선 위치도 평균선과 동기화.
  //   0.0.63 — 하위권(아래 15등 여유 없음)도 평균선을 아래로 내려 꼴찌가 바닥에 닿게 (total 사용, 상위/하위 대칭). 등수 라벨 볼드 제거(normal).
  //   0.0.64 — 개인평가 막대 + 잔차 이유배지에 usernorm 적용 (7건반 normalizeWeaknessVec=popMean 빼고 유저내 z, 개인차는 7건반 raw 분포 sd 로 z 근사 → 막대 10피처 스케일 통일). opts.weaknessPopMean 없으면 raw fallback.
  var VERSION = '0.0.64';
  var SKILL_WEIGHTS = (function () {
    var ws = [];
    for (var i = 0; i < 5; i++) ws.push(1.0);
    for (var j = 0; j < 25; j++) {
      var pct = 90 - j * (90 - 5) / 24;  // j=0 → 90, j=24 → 5
      ws.push(pct / 100);
    }
    return ws;
  })();
  var SKILL_TOP_N = 30;

  var FEATS = [
    { k: 'NOTES',   ko: '물량',       desc: '곡의 전체 노트 양과 밀도' },
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
  var DIFF_COLOR = { NORMAL: '#74c0fc', HYPER: '#efef51', ANOTHER: '#fba8c1', LEGGENDARIA: '#ce8ef9', BEGINNER: '#868e96' };

  function escH(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // iidx_id (8자리 숫자 or 'C12345678901' 형식) → 표시용 (1234-5678 / C-1234-5678-9012).
  function fmtIidxId(id) {
    var s = String(id == null ? '' : id).trim();
    var m = s.match(/^([A-Za-z]*)(\d+)$/);
    if (!m) return s;
    var groups = m[2].match(/.{1,4}/g) || [m[2]];
    return (m[1] ? m[1] + '-' : '') + groups.join('-');
  }

  // personal 막대/이유배지용 usernorm vec — 막대 10피처 스케일 통일.
  //   7건반(WEAKNESS_KB_FEATS): normalizeWeaknessVec (popMean 빼고 손별 유저내 z).
  //   개인차(CHARGE/SCRATCH/SOF-LAN): popMean·손분리 개념이 없어 raw 잔차를 7건반 raw 잔차의 유저내 sd 로 나눠
  //     z 스케일 근사 (중심 보정은 막대의 userMean 차감이 처리) → 7건반 z 막대와 길이 비교가 가능.
  //   popMean 미로드/미지원이면 userVec 그대로(기존 raw 동작). 막대/이유배지 전용 — ③④추천엔 안 씀.
  function personalUsernormVec(opts) {
    var uv = opts.userVec;
    var wl = opts.weaknessLib || (typeof window !== 'undefined' && window.OhsorryWeakness);
    if (!opts.weaknessPopMean || !wl || typeof wl.normalizeWeaknessVec !== 'function') return uv;
    var nv = wl.normalizeWeaknessVec(uv, opts.weaknessPopMean, {});
    var i, fk, rv;
    // 7건반 raw 잔차의 유저내 mean/sd — 개인차 z 근사 분모.
    var kbRaw = [];
    for (i = 0; i < FEATS.length; i++) {
      fk = FEATS[i].k;
      if (typeof nv[fk] === 'number') { rv = uv && uv[fk]; if (typeof rv === 'number') kbRaw.push(rv); }
    }
    var n = Math.max(1, kbRaw.length);
    var m = 0; for (i = 0; i < kbRaw.length; i++) m += kbRaw[i] / n;
    var vv = 0; for (i = 0; i < kbRaw.length; i++) vv += (kbRaw[i] - m) * (kbRaw[i] - m);
    var sd = Math.sqrt(vv / n) || 1;
    var out = {};
    for (i = 0; i < FEATS.length; i++) {
      fk = FEATS[i].k;
      if (typeof nv[fk] === 'number') {
        out[fk] = nv[fk];                                                  // 7건반: normalizeWeaknessVec z
      } else {
        rv = (uv && typeof uv[fk] === 'number') ? uv[fk] : 0;
        out[fk] = (rv - m) / sd;                                           // 개인차: 7건반 raw 분포로 z 근사
      }
    }
    return out;
  }

  // 가장 강점인 feat 선택 — max% (score / maxScore) 최대값. null 이면 (데이터 부족) null 반환.
  function pickStrongestFeat(userPatternScore, maxScoreByFeat) {
    if (!userPatternScore || !maxScoreByFeat) return null;
    var bestK = null, bestRatio = -Infinity;
    for (var i = 0; i < FEATS.length; i++) {
      var k = FEATS[i].k;
      var raw = userPatternScore[k];
      var s = (typeof raw === 'number') ? raw : (raw != null ? parseFloat(raw) : NaN);
      var mx = maxScoreByFeat[k];
      if (!isFinite(s) || !isFinite(mx) || mx <= 0) continue;
      var ratio = s / mx;
      if (ratio > bestRatio) { bestRatio = ratio; bestK = k; }
    }
    return bestK;
  }

  // feat 별 user 랭킹 정렬 — allUserScores 의 os_pattern_score[feat] desc.
  //   return: [{ iidx_id, dj_name, star, score }] desc 정렬. 데이터 없으면 [].
  function buildFeatRanking(allUserScores, feat) {
    if (!Array.isArray(allUserScores)) return [];
    return allUserScores.map(function (u) {
      var v = u && u.os_pattern_score && u.os_pattern_score[feat];
      var s = (typeof v === 'number') ? v : (v != null ? parseFloat(v) : NaN);
      return isFinite(s) ? { iidx_id: u.iidx_id, dj_name: u.dj_name, star: u.star, score: s } : null;
    }).filter(function (x) { return x != null; }).sort(function (a, b) { return b.score - a.score; });
  }

  // 인라인 ranking 표 HTML — 스킬 대상곡 영역 자리에 그림.
  //   본인 ≤ 30위: 1~30 표시
  //   본인 31위~: 1, 2, 3 + "..." + 본인 주변 26명 (본인 위 13 + 본인 + 아래 12)
  //   본인 row 는 노란색 (#ffd43b) + 배경 강조.
  function buildRankingHTML(feat, rows, myIidxId) {
    var titleHTML = '<div style="font-size:13px;font-weight:600;margin-bottom:4px">' + escH(feat) + ' 랭킹 ' + rows.length + '명</div>';
    if (rows.length === 0) {
      return titleHTML + '<div style="opacity:0.6;font-size:13px;margin-bottom:8px">데이터 없음</div>';
    }
    var myKey = String(myIidxId == null ? '' : myIidxId).replace(/-/g, '');
    var myRank = -1;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].iidx_id) === myKey) { myRank = i + 1; break; }
    }

    // 표시할 indices 계산 (0-based). 본인 ≤ 30위면 1~30, 아니면 1,2,3 + "..." + 본인 주변 26.
    var displayItems = [];  // { type: 'row', row, rank } | { type: 'ellipsis' }
    var topN = 30;
    if (myRank > 0 && myRank <= topN) {
      var end = Math.min(rows.length, topN);
      for (var r = 0; r < end; r++) displayItems.push({ type: 'row', row: rows[r], rank: r + 1 });
    } else {
      // 1, 2, 3 등
      for (var t = 0; t < Math.min(3, rows.length); t++) displayItems.push({ type: 'row', row: rows[t], rank: t + 1 });
      // ellipsis
      displayItems.push({ type: 'ellipsis' });
      // 본인 주변 26명 (본인 위 13 + 본인 + 아래 12) — myRank 없으면 마지막 26명 fallback.
      var aroundStart, aroundEnd;
      if (myRank > 0) {
        aroundStart = Math.max(3, myRank - 1 - 13);  // 0-based start index
        aroundEnd = Math.min(rows.length, aroundStart + 26);
        // 끝이 바닥에 닿으면 위로 끌어올려서 26개 채우기.
        if (aroundEnd - aroundStart < 26) aroundStart = Math.max(3, aroundEnd - 26);
      } else {
        aroundEnd = rows.length;
        aroundStart = Math.max(3, aroundEnd - 26);
      }
      for (var a = aroundStart; a < aroundEnd; a++) displayItems.push({ type: 'row', row: rows[a], rank: a + 1 });
    }

    var html = titleHTML;
    html += '<div style="font-size:13px;margin-bottom:8px">';
    html += '<div style="display:flex;gap:8px;padding:5px 6px;border-bottom:1px solid rgba(127,127,127,0.3);opacity:0.6;font-size:11px;font-weight:600">'
      + '<span style="flex-shrink:0;min-width:28px;text-align:right">#</span>'
      + '<span style="width:50px;flex-shrink:0;text-align:left">★</span>'
      + '<span style="flex:1;min-width:0">DJ NAME</span>'
      + '<span style="width:80px;flex-shrink:0;text-align:right">점수</span>'
      + '</div>';
    for (var di = 0; di < displayItems.length; di++) {
      var it = displayItems[di];
      if (it.type === 'ellipsis') {
        html += '<div style="display:flex;justify-content:center;padding:4px 0;opacity:0.5;font-size:12px;letter-spacing:2px">...</div>';
        continue;
      }
      var rr = it.row;
      var isMe = String(rr.iidx_id) === myKey;
      var bg = isMe ? 'background:rgba(255,212,59,0.12);' : '';
      var color = isMe ? 'color:#ffd43b;font-weight:600;' : '';
      var starTxt = (typeof rr.star === 'number' && isFinite(rr.star)) ? rr.star.toFixed(1) : '?';
      html += '<div style="display:flex;gap:8px;padding:5px 6px;border-bottom:1px solid rgba(127,127,127,0.18);' + bg + color + '">'
        + '<span style="flex-shrink:0;min-width:28px;text-align:right;font-size:11px;color:#888">' + it.rank + '</span>'
        + '<span style="width:50px;flex-shrink:0;text-align:left;color:#ff6b9d;font-size:12px;font-weight:600">★' + starTxt + '</span>'
        + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
        +   '<span style="font-weight:600">' + escH(rr.dj_name || '-') + '</span>'
        +   '<span style="opacity:0.5;font-family:monospace;font-size:10px;margin-left:4px">' + escH(fmtIidxId(rr.iidx_id)) + '</span>'
        + '</span>'
        + '<span style="width:80px;flex-shrink:0;text-align:right;font-variant-numeric:tabular-nums">' + rr.score.toFixed(1)
        +   '<span style="opacity:0.5;font-size:10px;margin-left:2px">pt</span>'
        + '</span>'
        + '</div>';
    }
    html += '</div>';
    return html;
  }

  function buildBarChart(userPatternScore, maxScoreByFeat, selectedFeat, percentiles, barMode, userVec) {
    // 막대그래프 — 각 feature 값의 "내 10 feature 평균 대비" 차이. barMode 로 base 전환.
    //   relative(상대평가): displayVal = 100 - percentile (상위 N%, 큰=상위). percentiles 없으면 max% fallback.
    //   personal(개인평가): displayVal = userVec[f] (calcWeakness 잔차 — 기대 대비 +강점/-약점).
    //   공통: userMean = 10 feature displayVal 평균. 막대 v = displayVal - userMean (+ 강점 / - 약점).
    var personal = barMode === 'personal';
    var valsRaw = FEATS.map(function (f) {
      if (personal) {
        var pv = userVec && userVec[f.k];
        return (typeof pv === 'number') ? pv : 0;  // 잔차 (없으면 0)
      }
      var pctInfo = percentiles && percentiles[f.k];
      if (pctInfo && typeof pctInfo.percentile === 'number') {
        return 100 - pctInfo.percentile;  // 상위 N% (큰=상위)
      }
      // fallback: max%
      if (!userPatternScore || !maxScoreByFeat) return 0;
      var raw = userPatternScore[f.k];
      var score = (typeof raw === 'number') ? raw : (raw != null ? parseFloat(raw) : NaN);
      var max = maxScoreByFeat[f.k];
      if (!isFinite(score) || !isFinite(max) || max <= 0) return 0;
      return score / max * 100;
    });
    var userMean = valsRaw.reduce(function (s, v) { return s + v; }, 0) / valsRaw.length;
    var vals = valsRaw.map(function (v) { return v - userMean; });
    var maxAbs = Math.max.apply(null, vals.map(Math.abs).concat(1));
    // 상대평가 등수 막대 — 내 평균 등수(avgRank) + 평균선 위치(meanLineP, bottom 기준 %).
    //   스케일: 평균 ±15등 = ±50% (15등당 50%). 평균선 위로 15등 여유 있으면 가운데(50%).
    //   예외: 평균이 상위(<16등)면 위 여유(avgRank-1 등)만큼만 위 공간 → 평균선을 끌어올려 1등이 천장(100%)에 닿게.
    var avgRank = null, meanLineP = 50;
    if (!personal && percentiles) {
      var rsum = 0, rn = 0, total = 0;
      for (var ari = 0; ari < FEATS.length; ari++) {
        var arp = percentiles[FEATS[ari].k];
        if (arp && typeof arp.rank === 'number') { rsum += arp.rank; rn++; if (typeof arp.total === 'number') total = arp.total; }
      }
      if (rn > 0) {
        avgRank = rsum / rn;
        var upRoom = avgRank - 1;                            // 평균 위(상위) 등수 여유
        var downRoom = total > 0 ? (total - avgRank) : 15;   // 평균 아래(하위) 등수 여유
        // 위/아래 모두 15등 여유 있으면 평균선 가운데(50%).
        //   상위(위 여유<15)면 평균선 위로 끌어올려 1등이 천장, 하위(아래 여유<15)면 아래로 내려 꼴찌가 바닥.
        if (upRoom < 15) meanLineP = 100 - upRoom / 15 * 50;
        else if (downRoom < 15) meanLineP = downRoom / 15 * 50;
      }
    }
    var cols = FEATS.map(function (f, i) {
      var v = vals[i];
      var rkInfo = (!personal && percentiles) ? percentiles[f.k] : null;
      var rk = rkInfo && typeof rkInfo.rank === 'number' ? rkInfo.rank : null;
      // 색 강/약 기준 — 상대평가는 평균 등수 대비(점선과 일치), 개인평가는 잔차 평균 대비.
      var isPos = (!personal && avgRank != null && rk != null) ? (avgRank - rk >= 0) : (v >= 0);
      // 강점·동률(평균 이상, v>=0) 녹색 / 약점(평균 미만) 빨강. 막대·라벨(등수/잔차) 공통.
      var color = isPos ? '#28a745' : '#dc3545';
      var sign = isPos ? '+' : '';
      // 막대 숫자 라벨 — 상대평가는 등수 기반이므로 'N위'로, 개인평가는 잔차값(±수치)으로.
      //   상대평가라도 percentile rank 없으면(fallback max%) ±수치 유지.
      var label;
      if (!personal) {
        var pInfo = percentiles && percentiles[f.k];
        label = (pInfo && typeof pInfo.rank === 'number') ? (pInfo.rank + '위') : (sign + v.toFixed(1));
      } else {
        label = sign + v.toFixed(1);
      }
      // 라벨 색 — 등수(상대평가) 숫자는 흰색, 개인평가(잔차)는 강약 색.
      var labelColor = personal ? color : '#e9ecef';
      // 막대 HTML.
      var barBase = 'position:absolute;left:20%;right:20%;';
      var barHtml;
      if (personal) {
        // 개인평가 — 가운데(평균) 기준 위(강점)/아래(약점) ± (잔차).
        var pct = Math.abs(v) / maxAbs * 50;
        var ps = isPos ? 'bottom:50%;height:' + pct + '%' : 'top:50%;height:' + pct + '%';
        barHtml = '<div style="' + barBase + ps + ';background:' + color + ';border-radius:2px"></div>';
      } else {
        // 상대평가 — 평균 ±15등 스케일 (15등당 50%). 평균선(meanLineP)에서 상위(rank↓) 위로 / 하위 아래로.
        //   평균이 상위(<16등)면 meanLineP 가 위로 올라가 1등이 천장(100%)에 닿음.
        var rankH = (avgRank != null && rk != null)
          ? Math.max(0, Math.min(100, meanLineP + (avgRank - rk) / 15 * 50))
          : Math.max(0, Math.min(100, userMean > 0 ? (valsRaw[i] / userMean) * 50 : 0));  // rank 없으면 fallback
        barHtml = '<div style="' + barBase + 'bottom:0;height:' + rankH + '%;background:' + color + ';border-radius:2px"></div>';
      }
      var divider = i === 4 ? ';border-right:1px dashed #ccc;margin-right:4px;padding-right:4px' : '';
      var tip = f.k + ' (' + f.ko + ')\n' + f.desc;
      var tipAttr = ' title="' + tip.replace(/"/g, '&quot;') + '"';
      var selBg = selectedFeat === f.k ? 'background:rgba(127,127,127,0.15);' : '';
      return ''
        + '<div data-feat="' + f.k + '"' + tipAttr + ' style="' + selBg + 'cursor:pointer;flex:1;display:flex;flex-direction:column;align-items:center;position:relative' + divider + '">'
        + '  <div style="height:16px;font-size:12px;font-weight:' + (personal ? '600' : '400') + ';color:' + labelColor + '">' + label + '</div>'
        + '  <div style="position:relative;flex:1;width:100%;min-height:100px">'
        + '    ' + barHtml
        + '    <div style="position:absolute;top:' + (personal ? 50 : (100 - meanLineP)) + '%;left:0;right:0;height:1px;background:#ccc;z-index:1"></div>'
        + '  </div>'
        + '  <div style="margin-top:4px;font-size:11px;color:#666;font-weight:500;white-space:nowrap">' + f.k + '</div>'
        + '</div>';
    }).join('');
    return { cols: cols, userMean: userMean };
  }

  // selectedFeat 의 상세 (헤더 + percentile + 기여곡 또는 ranking) HTML
  //   viewMode: 'skill' (스킬 대상곡 표) | 'ranking' (인라인 user 랭킹 표)
  function buildDetailHTML(opts, viewMode) {
    var k = opts.selectedFeat;
    var userVec = opts.userVec;
    var weaknessLib = opts.weaknessLib || (typeof window !== 'undefined' && window.OhsorryWeakness);
    var patternsMap = opts.patternsMap;
    var allCharts = opts.allCharts;
    var userPatternScore = opts.userPatternScore;  // 본인 user_ohsorry_radars (가중합). 헤더 절대 점수 표시용.
    var percentiles = opts.percentiles;  // { NOTES: { rank, total, percentile }, ... } 또는 null. 랭킹 행 (없으면 숨김).
    var allUserScores = opts.allUserScores;  // 전체 user [{ iidx_id, dj_name, os_pattern_score }] — 인라인 랭킹용
    var hasRankingData = Array.isArray(allUserScores) && allUserScores.length > 0;
    var canAnalyze = !!(weaknessLib && weaknessLib.analyzeFeature && patternsMap && Array.isArray(allCharts));

    var f = FEATS.find(function (x) { return x.k === k; });
    if (!f) return '';
    // 헤더 score — user_ohsorry_radars 의 절대값 (가중합 점수) 그대로 표시.
    var rawScore = userPatternScore && userPatternScore[k];
    var score = (typeof rawScore === 'number') ? rawScore : (rawScore != null ? parseFloat(rawScore) : NaN);
    var hasUserScore = isFinite(score);

    var html = ''
      + '<div style="font-size:15px;margin-bottom:8px"><b style="font-size:17px">' + escH(f.k) + '</b>'
      + ' <span style="color:#aaa;font-weight:400">' + (hasUserScore ? score.toFixed(1) + 'pt' : '-') + '</span>'
      + '</div>';

    if (!canAnalyze) {
      html += '<div style="opacity:0.6;font-size:11px">상세 분석 데이터 부재 (patterns / allCharts 미로드)</div>';
      return html;
    }

    // byChartData — 곡별 잔차 평균(rAvg) 집계. 이유 박스 + (아래) 스킬 대상곡 공용.
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

    // 잔차 강/약점 이유 — 헤더(피처 라벨)와 등수 행 사이에 배치 (랭킹보기 토글해도 유지됨).
    //   기준: userVec[k] - 내 10 feature 잔차 평균 (= 막대 v값). 배지·막대 색·문구 ±X% 모두 이 값 부호/크기로 일치.
    var personalVec = personalUsernormVec(opts);   // 7건반 usernorm z + 개인차 raw — 막대와 동일 base (부호/평균 일치)
    var residualValue = (personalVec && typeof personalVec[k] === 'number') ? personalVec[k] : 0;
    var vecMeanForReason = 0, vmN = 0;
    for (var vmi = 0; vmi < FEATS.length; vmi++) {
      var vmv = personalVec && personalVec[FEATS[vmi].k];
      if (typeof vmv === 'number') { vecMeanForReason += vmv; vmN++; }
    }
    vecMeanForReason = vmN > 0 ? vecMeanForReason / vmN : 0;
    var barVal = residualValue - vecMeanForReason;   // 막대 숫자와 동일
    var isStrength = barVal >= 0;
    if (Object.keys(byChartData).length > 0) {
      var reasonColor = isStrength ? '#28a745' : '#dc3545';
      var badge = isStrength ? '강점 ▲' : '약점 ▼';
      var barStr = (barVal >= 0 ? '+' : '-') + Math.abs(barVal).toFixed(1) + '%';
      var verb = barVal >= 0 ? '잘 칩니다' : '못 칩니다';
      // 받침 유무로 주격조사 이/가 선택
      var koLast = f.ko.charCodeAt(f.ko.length - 1);
      var josa = (koLast >= 0xAC00 && koLast <= 0xD7A3 && (koLast - 0xAC00) % 28 !== 0) ? '이' : '가';
      html += '<div style="margin-bottom:8px;padding:8px 10px;border-radius:6px;background:rgba(127,127,127,0.1);border-left:3px solid ' + reasonColor + '">'
        + '<div style="font-size:12px;font-weight:700;color:' + reasonColor + ';margin-bottom:3px">' + badge + '</div>'
        + '<div style="font-size:12px;opacity:0.9">플레이 한 곡을 분석해보니 ' + escH(f.ko) + josa + ' 강한 곡을 다른 패턴보다 '
        + '<b style="color:' + reasonColor + '">' + barStr + '</b> ' + verb + '</div>'
        + '</div>';
    }

    // 랭킹 행 — opts.percentiles 있으면 표시. 없으면 (예: INFOhSorry 처럼 유저 목록 미보유) 숨김.
    //   오른쪽에 "랭킹보기" / "스킬곡 보기" 토글 버튼 (data-action="toggle-view-mode").
    //   allUserScores 없으면 (랭킹 데이터 부재) 버튼 숨김.
    var pct = percentiles && percentiles[k];
    if (pct && typeof pct.rank === 'number' && typeof pct.total === 'number' && pct.total > 0) {
      var btnLabel = viewMode === 'ranking' ? '스킬곡 보기' : '랭킹보기';
      var btnHTML = hasRankingData
        ? '<button type="button" data-action="toggle-view-mode" data-feat="' + escH(k) + '"'
          + ' style="font-size:11px;padding:3px 10px;background:transparent;border:1px solid #ff6b9d;border-radius:4px;color:#ff6b9d;font-weight:600;cursor:pointer;font-family:inherit">'
          + btnLabel + '</button>'
        : '';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;font-size:13px;margin-bottom:8px">'
        + '<div style="opacity:0.85"><b>' + pct.rank + '위 / ' + pct.total + '명</b>'
        + (typeof pct.percentile === 'number' ? ' · 상위 <b>' + pct.percentile.toFixed(1) + '%</b>' : '')
        + '</div>'
        + btnHTML
        + '</div>';
    }

    // viewMode === 'ranking' 이고 랭킹 데이터 있으면 → 스킬 대상곡 표 대신 인라인 ranking 표.
    if (viewMode === 'ranking' && hasRankingData) {
      var rankRows = buildFeatRanking(allUserScores, k);
      html += buildRankingHTML(k, rankRows, opts.myIidxId);
      return html;
    }

    // sumPtPerFeat — vRel 기여 계산용 (byChartData 는 헤더 직후에서 이미 집계됨)
    var sumPtPerFeat = {};
    for (var fi = 0; fi < FEATS.length; fi++) {
      var s = 0;
      for (var cid2 in byChartData) s += (byChartData[cid2].pt[FEATS[fi].k] || 0);
      sumPtPerFeat[FEATS[fi].k] = s;
    }

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

    // featureScores 있으면 차트별 quantile score (0~100) lookup. 없으면 c.pt (calcWeakness raw 양손 평균) fallback.
    //   earned = score × rate / 100 (사용자가 그 곡에서 받은 실효 점수). 정렬 기준.
    var fsScores = opts.featureScores && opts.featureScores.scores;
    var allChartsVRel = Object.keys(byChartData).map(function (cid) {
      var bc = byChartData[cid];
      var parts = cid.split('|');
      var sid = parts[0], cn = parts[1];
      var rawPt = bc.pt[k] || 0;
      var fsScore = null;
      if (fsScores) {
        var ss = fsScores[sid];
        if (ss && ss[cn] && typeof ss[cn][k] === 'number') fsScore = ss[cn][k];
      }
      var sc = fsScore != null ? fsScore : rawPt;
      var rt = bc.rate || 0;
      return {
        chartId: cid, songId: sid, chartName: cn,
        title: bc.title, diff: bc.diff, lv: bc.lv,
        pt: rawPt,
        score: sc,                  // 곡 자체 점수 (quantile 또는 pt fallback)
        earned: sc * rt / 100,      // 사용자가 받은 점수
        rate: rt, lampNum: bc.lampNum,
        residual: bc.rAvg,
        vRel: chartContribToVRel(cid, k),
      };
    });
    // 그 feature 의 chart_score 가 0 인 곡은 스킬 대상곡에서 제외 (backfill 가중합 분자에도 안 들어감, 의미 없는 0/0 row 방지).
    var sortedContribs = allChartsVRel
      .filter(function (c) { return c.score > 0; })
      .sort(function (a, b) { return b.earned - a.earned; });  // 받은 점수 desc
    var topContributors = sortedContribs.slice(0, SKILL_TOP_N);  // 스킬 대상곡 (backfill 가중합 분자에 들어가는 곡들)

    var cTitle = '스킬 대상곡 ' + topContributors.length + '곡';
    html += '<div style="font-size:13px;font-weight:600;margin-bottom:4px">' + cTitle + '</div>';
    if (topContributors.length === 0) {
      html += '<div style="opacity:0.6;font-size:13px;margin-bottom:8px">데이터 없음</div>';
    } else {
      html += '<div style="font-size:13px;margin-bottom:8px">';
      html += '<div style="display:flex;gap:4px;padding:2px 0;border-bottom:1px solid rgba(127,127,127,0.3);opacity:0.6;font-size:11px;font-weight:600">'
        + '<span style="width:26px;flex-shrink:0">lv</span>'
        + '<span style="width:16px;flex-shrink:0">diff</span>'
        + '<span style="flex:1;min-width:0">곡명</span>'
        + '<span style="width:50px;text-align:right;flex-shrink:0">기여</span>'
        + '<span style="width:42px;text-align:right;flex-shrink:0">rate</span>'
        + '<span style="width:80px;text-align:right;flex-shrink:0">점수/최대</span>'
        + '</div>';
      topContributors.forEach(function (c, idx) {
        var dl = DIFF_SHORT_LBL[c.diff] || '?';
        var diffColor = DIFF_COLOR[c.diff] || '#aaa';
        var earnedScore = c.score * (c.rate || 0) / 100;
        var w = SKILL_WEIGHTS[idx] || 0;
        var contribScore = earnedScore * w;
        // 5곡 그룹 경계 시각화 (idx 5/10/15/20/25 시작 행 위에 굵은 선)
        var groupBoundary = (idx > 0 && idx % 5 === 0)
          ? 'border-top:1px solid rgba(127,127,127,0.4);'
          : '';
        var rowAttrs = ' class="__uprofile_pat_row" data-clickable-chart data-title="' + escH(c.title) + '" data-diff="' + escH(c.diff || '') + '"';
        html += '<div' + rowAttrs + ' style="display:flex;gap:4px;padding:2px 0;border-bottom:1px solid rgba(127,127,127,0.15);' + groupBoundary + '">'
          + '<span style="width:26px;flex-shrink:0;color:' + diffColor + '">lv' + c.lv + '</span>'
          + '<span style="width:16px;flex-shrink:0;color:' + diffColor + '">' + dl + '</span>'
          + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escH(c.title) + '</span>'
          + '<span style="width:50px;text-align:right;flex-shrink:0;color:#fff;font-weight:700">' + contribScore.toFixed(2) + '</span>'
          + '<span style="width:42px;text-align:right;flex-shrink:0;color:#888">' + (c.rate || 0).toFixed(1) + '%</span>'
          + '<span style="width:80px;text-align:right;flex-shrink:0;color:#888">' + earnedScore.toFixed(1) + ' / ' + c.score.toFixed(1) + '</span>'
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
    // selectedFeat 없으면 자동으로 가장 강점인 feat (max% 최대) 선택.
    var sf = opts.selectedFeat || pickStrongestFeat(opts.userPatternScore, opts.maxScoreByFeat);
    var viewMode = opts.viewMode === 'ranking' ? 'ranking' : 'skill';
    var barMode = opts.barMode === 'relative' ? 'relative' : 'personal';  // 기본 개인평가(잔차)
    var bar = buildBarChart(opts.userPatternScore, opts.maxScoreByFeat, sf, opts.percentiles, barMode, personalUsernormVec(opts));
    var meta = opts.userVec.__meta || {};
    var lvParts = Object.keys(meta.lvCounts || {}).sort().map(function (lv) {
      return 'lv' + lv + ' ' + meta.lvCounts[lv];
    }).join(' / ');
    var detailHTML = sf
      ? buildDetailHTML(Object.assign({}, opts, { selectedFeat: sf }), viewMode)
      : '<div style="margin-top:10px;padding:10px;font-size:13px;opacity:0.7;text-align:center">분석 항목을 선택하세요 (위 막대 클릭)</div>';
    // 막대 base 토글 — 상대평가(랭킹/상위N%) ↔ 개인평가(잔차). 오른쪽 위.
    //   통계탭 "난이도 선택 :" 토글(ohsorryRender)과 동일한 텍스트+파이프 스타일. active 만 볼드/밝게.
    var segBtn = function (mode, label) {
      var active = barMode === mode;
      return '<span data-action="set-bar-mode" data-barmode="' + mode + '" style="cursor:pointer;'
        + 'color:' + (active ? '#e9ecef' : '#888') + ';font-weight:' + (active ? '700' : '400') + ';transition:color .15s">'
        + label + '</span>';
    };
    var capLabel = barMode === 'personal' ? '기대(잔차) 평균 대비 강점+ / 약점−' : '현재 실력 평균 대비 강점+ / 약점−';
    return ''
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px">'
      + '  <span style="font-size:13px;opacity:0.75">' + capLabel + '</span>'
      + '  <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#888;flex-shrink:0">'
      +      '<span style="margin-right:2px">평가 :</span>'
      +      segBtn('relative', '상대평가') + '<span style="color:#555">|</span>' + segBtn('personal', '개인평가')
      + '  </span>'
      + '</div>'
      + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#888;margin-bottom:2px">'
      + '  <span>← 지력</span><span>개인차 →</span>'
      + '</div>'
      + '<div class="__uprofile_pat_chart" style="display:flex;align-items:stretch;gap:2px;height:140px;padding:4px 0">' + bar.cols + '</div>'
      + '<div style="font-size:12px;color:#888;margin-top:6px">매칭 ' + (meta.matched || 0) + '곡'
      + (lvParts ? ' (' + lvParts + ')' : '') + '</div>'
      + '<div class="__uprofile_pat_detail" style="margin-top:10px;padding:10px;font-size:13px;text-align:' + (sf ? 'left' : 'center') + '">'
      + detailHTML + '</div>';
  }

  // 편의 helper — rootEl 안의 data-feat / data-clickable-chart 클릭을 캡처해서 콜백 호출 + 자동 re-render.
  //   opts: buildAnalysisHTML 의 opts 와 같지만 selectedFeat / viewMode 는 내부 state 로 관리.
  //   handlers: { onChartClick(title, diff), onFeatChange?(feat) }
  //   초기 selectedFeat — opts.selectedFeat 우선, 없으면 가장 강점인 feat 자동 선택.
  //   viewMode 토글 — 'skill' (스킬 대상곡) ↔ 'ranking' (인라인 user 랭킹). 다른 feat 누르면 'skill' 로 reset.
  function attachClickHandlers(rootEl, opts, handlers) {
    handlers = handlers || {};
    var state = {
      selectedFeat: opts.selectedFeat || pickStrongestFeat(opts.userPatternScore, opts.maxScoreByFeat),
      viewMode: 'skill',
      barMode: opts.barMode === 'relative' ? 'relative' : 'personal',  // 기본 개인평가(잔차)
    };
    function render() {
      rootEl.innerHTML = buildAnalysisHTML(Object.assign({}, opts, {
        selectedFeat: state.selectedFeat,
        viewMode: state.viewMode,
        barMode: state.barMode,
      }));
    }
    rootEl.addEventListener('click', function (e) {
      // 막대 base 토글 (상대평가 ↔ 개인평가) — selectedFeat / viewMode 는 유지.
      var barModeBtn = e.target.closest && e.target.closest('[data-action="set-bar-mode"]');
      if (barModeBtn) {
        e.stopPropagation();
        state.barMode = barModeBtn.getAttribute('data-barmode') === 'personal' ? 'personal' : 'relative';
        render();
        return;
      }
      // viewMode 토글 버튼 ("랭킹보기" ↔ "스킬곡 보기").
      var toggleBtn = e.target.closest && e.target.closest('[data-action="toggle-view-mode"]');
      if (toggleBtn) {
        e.stopPropagation();
        state.viewMode = state.viewMode === 'ranking' ? 'skill' : 'ranking';
        render();
        return;
      }
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
        // viewMode 는 그대로 유지 — 다른 feat 으로 옮겨도 ranking/skill 상태 보존.
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
