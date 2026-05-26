# calcWeakness.js

유저 10 feature 약점/강점 벡터 + 차트별 강점/약점 매치 점수 계산 모듈.

- **호스팅**: OhSorry-DP gist (`c3da608194c44f431abd2f1a7a4a9f5e/calcWeakness.js`)
- **로드 방식**: UMD — 브라우저 `window.OhsorryWeakness` / Node `require()`
- **호출처**: `calcOhsorryCore` (compute step2), `ohSorryWeb` 게스트 페이지, `INFOhSorry`

## 개념

유저가 친 차트들의 EX rate 잔차를 9 feature 의 pt (textage 패턴 강도) 로 가중평균하여 "어떤 패턴에 강하고 어떤 패턴에 약한지" 벡터로 표현.

**잔차 정의:**
- `rate(%) = exScore / (noteCount × 2) × 100`
- bucket 평균 rate (or rateRef 의 absolute reference) 와의 차 = 잔차

**약점/강점 벡터:**
```
userVec[f] = Σ(잔차 × pt_f) / Σ(pt_f)
```
- 음수 = 약점 (그 feature 가 강한 차트에서 평균보다 못 침)
- 양수 = 강점

## Export 목록

| 이름 | 종류 | 설명 |
|---|---|---|
| `FEATS` | 상수 (배열) | 10 feature 키 — `NOTES / CHORD / PEAK / CHARGE / SCRATCH / SOF-LAN / PHRASE / JACK / TRILL / RAND` |
| `DIFF2CHART` | 상수 (객체) | `NORMAL→DP_NOR` 등 diff → patterns 차트 키 매핑 |
| `DEFAULT_PATTERNS_URL` | 상수 (string) | patterns-all-slim.json gist URL |
| `avgPt(chartPt)` | 함수 | 차트의 `{p1, p2}` 양손 평균 → `{f1..f10}` |
| `fetchPatternsMap(opts)` | async 함수 | patterns-all-slim.json fetch + localStorage cache |
| `fetchAndCalcWeakness(opts)` | async 함수 | fetchPatternsMap + calcUserWeakness 합친 high-level helper |
| `calcUserWeakness(opts)` | **핵심** | userVec 계산 (잔차 가중평균) |
| `chartStrengthMatch(chartPt, userVec)` | 함수 | `Σ userVec_f × pt_f` — 양손 평균 차트 강점 매치 |
| `chartWeaknessMatch(chartPt, userVec)` | 함수 | `-chartStrengthMatch` (약점 보완 탭용) |
| `chartStrengthMatchByHand(chartPt, vecL, vecR)` | 함수 | 손 분리 + FLIP 배치 매치 → `{ L, R, total, max, flipL, flipR, flipTotal, flipMax, best, bestTotal }` |
| `chartWeaknessMatchByHand(chartPt, vecL, vecR)` | 함수 | 위의 음수 (약점 보완 + FLIP 평가용) |
| `computePatternScoreVec(opts)` | 함수 | supabase user_ohsorry_radars 컬럼 upsert vec (chart_score × score_rate top 30 가중합). backfill 과 동일 알고리즘 통합. |
| `analyzeFeature(opts)` | 함수 | 특정 feature 의 contributors / recommends 상세 (현재 호출처 0) |

## 핵심 함수 — `calcUserWeakness(opts)`

### Input opts

| 키 | 필수 | 설명 |
|---|---|---|
| `allCharts` | ✅ | 유저 차트 점수 배열 (`[{title, diff, lv, exScore, lampNum, ...}]`) |
| `patternsMap` | ✅ | `patterns-all-slim.json` 데이터 (`{songId: {t, c: {DP_HYP: {lv, p1, p2}, ...}}}`) |
| `normFn` | ✅ | title 정규화 함수 (보통 `window.OhsorryNorm.norm`) |
| `ratingMap` | optional | `ohSorryRating.json` 의 ratings 배열. 있으면 lv11/12 차트 estEc/Hc/Exh 기반 잔차 분석 |
| `zasaMap` | optional | `zasa-data.json` 의 charts 배열. lv10 차트 zasaLevel 보충 (ratingMap 미수록분, gap GAP_EC/HC/EXH 차감해서 임의 추정) |
| `rateRef` | optional | absolute reference (`{ec: {"9.5": {mean, n}, ...}, hc, exh}`). 있으면 self-relative bucketMean 대신 사용 — 사용자간 vec 직접 비교 가능 |
| `minLv` | optional (default 11) | legacy 모드 (ratingMap 없을 때) 의 lv 임계 |

### Output (`userVec`)

```js
{
  NOTES:    -0.5,    // 잔차 가중평균 (음수=약점 / 양수=강점)
  CHORD:     0.3,
  PEAK:      0.1,
  CHARGE:   -0.2,
  SCRATCH:   0.4,
  'SOF-LAN': 0.0,
  PHRASE:   -0.1,
  JACK:      0.0,
  TRILL:     0.2,
  RAND:     -0.3,

  __meta: {
    matched,    // 매칭된 차트 수
    entries,    // 처리 entries 수 (rating 모드는 1 차트가 ec/hc/exh 3 entries)
    mode,       // 'rating' / 'rating+ref' / 'lv'
    lvCounts,   // lv 모드일 때 lv 별 곡 수
    buckets,    // rating 모드일 때 bucket 별 곡 수
  },
  __entries: [...],   // {chartId, title, diff, lv, rate, residual, pt, ptP1, ptP2, ...} — analysisRender 가 직접 사용
  __bucketAgg,        // bucket 별 집계
  __refCache,         // rateRef cache
  __byLv,             // lv 모드 lv 별 그룹
  __vecL: { NOTES, CHORD, ..., RAND },  // 왼손 (p1) 기준 잔차 가중평균
  __vecR: { NOTES, CHORD, ..., RAND },  // 오른손 (p2) 기준 잔차 가중평균
}
```

### 모드 분기

| ratingMap | rateRef | mode | 동작 |
|---|---|---|---|
| ❌ | (무관) | `lv` | legacy — lv 별 평균 잔차 |
| ✅ | ❌ | `rating` | bucket 별 평균 잔차 (self-relative) |
| ✅ | ✅ | `rating+ref` | absolute reference 잔차 (사용자간 vec 직접 비교 가능) |

## 핵심 함수 — `analyzeFeature(opts)`

특정 feature 에 대한 contributors / recommends 상세.

### Input opts

| 키 | 필수 | 설명 |
|---|---|---|
| `feat` | ✅ | feature 키 (`'NOTES'` 등) |
| `allCharts`, `patternsMap`, `normFn` | ✅ | 위와 동일 |
| `userVec` | optional | 이미 계산한 결과. 없으면 내부에서 calcUserWeakness 재호출 (비용 큼) |
| `ratingMap`, `zasaMap`, `rateRef`, `minLv` | optional | 위와 동일 (userVec 없을 때만 사용) |
| `baseStar` | optional | 추천 ★ 기준 — 차트의 estEc/Hc/Exh 중 하나가 `baseStar ± rangeN` 안 들어가야 후보 |
| `rangeN` | optional (default 1) | 위 ± 범위 |
| `topN` | optional (default 30) | contributors / recommends 최대 개수 |

### Output

```js
{
  feat: 'NOTES',
  value: 0.3,            // userVec[feat]
  isStrength: true,      // value >= 0
  totalContrib,          // Σ byChart.contrib (기여 합)
  summary: {
    strongAvg,           // 상위 곡 평균 rate
    allAvg,              // 전체 평균 rate
    gap,                 // strongAvg - allAvg
    n,                   // 차트 수
  },
  contributors: [        // 그 feature 강하게 기여한 차트 top N
    { chartId, title, diff, lv, pt, rate, residual, contrib, lampNum, ... },
    ...
  ],
  recommends: [          // baseStar 근처 추천 차트 (단순 pt desc top N)
    { songId, chartName, title, lv, pt, rate, lampNum, djLevel, isNp, bucketMean },
    ...
  ],
}
```

**현재 호출처:** v0.0.37 (analysisRender) 에서 호출이 제거되어 **활성 호출처 0**.
- 함수 자체는 유지 (역사적 가치 + 향후 재활성 가능성).

## 매치 함수

```js
// 양손 평균 — 가장 단순 (기존)
chartStrengthMatch(chartPt, userVec) → number
  = Σ userVec[f] × pt[f]
  // 양수 = 잘 치는 패턴이 강한 차트 (이미 잘 침)
  // 음수 = 약한 패턴이 강한 차트 (도전 / 약점 보완)

chartWeaknessMatch(chartPt, userVec) → number
  = -chartStrengthMatch  // 약점 보완 탭용 (역순)

// 손 분리 + FLIP 배치 — 양손 편차 큰 user 평가 / FLIP 옵션 곡 추천용 (신규)
chartStrengthMatchByHand(chartPt, vecL, vecR) → {
  // normal 배치 (왼손=p1, 오른손=p2)
  L,        // Σ vecL[f] × pt.p1[f]    왼손 매치
  R,        // Σ vecR[f] × pt.p2[f]    오른손 매치
  total,    // L + R
  max,      // max(L, R)               한 손 특화 user 가 그 손으로 칠 수 있는 최대 매치

  // flip 배치 (왼손=p2, 오른손=p1 — 양손 바꿈 옵션)
  flipL,    // Σ vecL[f] × pt.p2[f]
  flipR,    // Σ vecR[f] × pt.p1[f]
  flipTotal,
  flipMax,

  // 추천 — 큰 쪽이 user 에게 적합한 배치
  best,       // 'normal' | 'flip'      total > flipTotal 이면 'normal'
  bestTotal,  // 위 best 의 total
}

// 약점 매치 (강점 매치 음수) — 약점 보완 정렬용
chartWeaknessMatchByHand(chartPt, vecL, vecR) → {
  L, R, total, max, flipL, flipR, flipTotal, flipMax,   // 모두 chartStrengthMatchByHand 결과의 음수
  best,       // 'normal' | 'flip'      total < flipTotal 이면 'flip' (= 더 매치 안 되는 = 약점 더 드러나는)
  bestTotal,  // 위 best 의 -total
}
```

**chartPt 형식:**
- `chartStrengthMatch` — `{p1, p2}` 또는 이미 양손 평균된 `{NOTES, CHORD, ...}`. 자동 분기.
- `chartStrengthMatchByHand` / `chartWeaknessMatchByHand` — `{p1, p2}` 필수 (분리 평가).

**사용 시점:**
- 양손 평균 (`chartStrengthMatch`) — 추천 정렬 일반 가중치 (calcOhsorryCore sample15)
- 손 분리 + FLIP (`chartStrengthMatchByHand`) — 양손 편차 큰 user 의 "한 손 위주 매치 곡" 별도 표시 / FLIP 추천 카테고리 (flipTotal > total 인 차트)

## 사용 패턴

### 1. high-level (브라우저, 패턴 fetch 까지 자동)

```js
const vec = await OhsorryWeakness.fetchAndCalcWeakness({
  allCharts: userData.charts_json,
  normFn: OhsorryNorm.norm,
});
console.log(vec);  // { NOTES: -0.5, CHORD: 0.3, ..., __meta, __entries, ... }
```

### 2. low-level (Node 또는 patternsMap 이미 있을 때)

```js
const vec = OhsorryWeakness.calcUserWeakness({
  allCharts,
  patternsMap,
  normFn,
  ratingMap: ohSorryRatings,
  zasaMap: zasaData,
  rateRef: rateRefData,
});
```

### 3. 추천 정렬 (calcOhsorryCore sample15)

```js
const matchScore = OhsorryWeakness.chartStrengthMatch(
  patternsMap[songId].c[chartName],
  userVec
);
// matchScore desc 정렬 → 강점 매치 우선 (또는 chartWeaknessMatch 로 약점 보완)
```

## 데이터 의존성

| Gist 파일 | 호스팅 | 용도 |
|---|---|---|
| `patterns-all-slim.json` | OhSorry-DP gist `c3da608...` | 차트별 9 feature pt (textage 패턴 분석 결과) |
| `ohSorryRating.json` | OhSorry-DP gist `c3da608...` | lv11/12 차트 estEc/Hc/Exh (난이도 추정) |
| `zasa-data.json` | OhSorry-DP gist `c3da608...` | lv10 차트 zasaLevel 보충 |
| `rate-reference-slim.json` | OhSorry-DP gist `c3da608...` | absolute reference (3550명 ereter 평균 EX rate by bucket) |

## `computePatternScoreVec(opts)` — supabase upsert vec

backfill-pattern-score.js (ohSorryRating) / ohSorry dbConn / INFOhSorry Analysis 가 모두 같은 알고리즘을 쓰던 걸 통합한 함수.

### Input opts

| 키 | 필수 | 설명 |
|---|---|---|
| `charts` | ✅ | `[{ title, diff, exScore, noteCount }]` (diff = NORMAL/HYPER/ANOTHER/LEGGENDARIA) |
| `featureScores` | ✅ | feature-scores-slim.json 전체 객체 (`{ _meta, scores }`) |
| `patternsMap` | ✅ | patterns-all-slim.json (title → songId 매핑용) |
| `normFn` | ✅ | title 정규화 |
| `topN` | optional (default 30) | top N 가중합 |

### 알고리즘

```
1. 각 chart 마다 featureScores.scores[songId][DP_xxx] 의 feature score lookup
2. score_rate = exScore / (noteCount × 2)  (0~1)
3. points = score × score_rate  (feature 별)
4. score=0 인 (feature, chart) 쌍은 제외
5. feature 별 points desc 정렬 → top N → 가중치 (1~5위=1.0, 6~30위=0.90~0.05 선형 감소) 가중합
```

### Output

```js
{ NOTES: 1245.3, CHORD: 982.1, ..., RAND: 678.5 }  // 0~maxScoreByFeat 범위
```

## userVec vs feature_score 차이

| | userVec (이 모듈) | feature_score (dbConn) |
|---|---|---|
| **알고리즘** | 잔차 가중평균 | quantile score × score_rate top 30 가중합 |
| **결과 범위** | -1.0 ~ +1.0 (음수 가능) | 0 ~ ~1500 (절대값) |
| **계산 시점** | client 매번 (compute) | client 매번 (uploadResult) + supabase backfill |
| **저장 위치** | 메모리만 (휘발) | supabase `user_ohsorry_radars` |
| **표시 위치** | 분석탭 사용 X (현재) — `__entries` 만 활용 | 분석탭 헤더 / 막대그래프 / 랭킹 |
| **추천 가중치** | ✅ `chartStrengthMatch` 정렬 | ❌ |

같은 "feature 별 user 점수" 같지만 의미가 다름.
- userVec — "평균 대비 잘/못 침" (개인 내 상대 비교)
- feature_score — "모든 user 대비 절대 점수" (사용자간 비교)

## 관련 README 변경이력

- [2026-05-25 — calcWeakness analyzeFeature default topN 5 → 30](../README.md)
- [2026-05-25 — calcWeakness rateRef (absolute reference) 옵션 + calcOhsorryCore 통합](../README.md)
- [2026-05-24 — 패턴 분석 2단계 완료 — slim 빌드 + gist 배포 + ohSorry 통합](../README.md)
