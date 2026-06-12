# algorithms — 별값 추정·추천·피쳐점수·약점 분석

> 별값(★) 추정, 추천곡 파이프라인, 28차 피쳐 점수, 약점 분석의 단계·가중치·임계값을 코드에서 확인한 실제 상수로 기술합니다.
> 상위 조망: [`../../docs/ohSorry.md`](../../docs/ohSorry.md) · 인덱스: [README.md](README.md)

> ★추정 모델 본체(oldOSR/osr/OSR135/adopt/onlyOSR/onlyOSRtoEreter)는 core 가 fetch+eval 하는 **별도 gist lib** 라 이 repo `modules/` 에는 소스가 없습니다. 실제 소스는 별도 프로젝트 **[ohSorryRating](../../ohSorryRating/)** 의 [`modules/`](../../ohSorryRating/modules/) 에 있습니다:
> [oldOSR.js](../../ohSorryRating/modules/oldOSR.js) · [osr.js](../../ohSorryRating/modules/osr.js) · [OSR13.5+.js](../../ohSorryRating/modules/OSR13.5+.js) · [adopt.js](../../ohSorryRating/modules/adopt.js) · [onlyOSR.js](../../ohSorryRating/modules/onlyOSR.js) · [onlyOSRtoEreter.js](../../ohSorryRating/modules/onlyOSRtoEreter.js)
> lib 내부 수식·하이퍼파라미터(IRT/ridge 계수 등)는 [ohSorryRating/docs/model.md](../../ohSorryRating/docs/model.md) · [modules.md](../../ohSorryRating/docs/modules.md) 참고. 아래에서는 "core 가 호출하는 인터페이스 + 채택 분기" 까지만 기술합니다.

---

## 1. 별값(★) 추정

core 의 5.5 단계(`calcOhsorryCore.js:853-1141`). 표시용 `starEstimate` 와 추천 baseStar 용 `starEstimateNew`(native) 를 산출합니다.

### 1.1 입력
- `allCharts` (유저 차트 + lamp), `ereterData`(ereter charts + players), `ratingData`(ohSorryRating.json)
- `useOnlyLv12` (`:814`): lv12 플레이 ≥30 이면 lv12-only 통계 모드.

### 1.2 lib 호출 (비-DB 모드, `:959-1141`)
| lib | core 호출 | 산출 |
|-----|-----------|------|
| `oldOSR.inferUser(allCharts, ratingData, ereterPayload)` | `:963` | `starEstimateOld`, `starRaw`, 3 scope(`ereterOnly`/`lv12Only`/`all`) |
| `ohSorryRating.inferUserTiered(allCharts, ratingData)` | `:979` | `starEstimateNew`(=OSR, ereter scale), `osrGroup`(A/B/C), `nativeStar` |
| `OSR135.inferUser(allCharts, {charts:ereterData})` | `:993` | `starEstimate135`, 세 분기 `{ec,hc,exh}.final` (13.5+ 정확도 핵심) |

### 1.3 채택 분기
**adopt.js 가 로드되면** 통합 lib `adopt.adoptStar({...})` 가 채택을 전담(`:1004-1016`). 실패 시 core inline fallback(`:1018-1122`)이 v335E 분기를 그대로 재현. inline 분기 상수(`:1044-1049`):
- `OSR135_TH = 13.5` (OSR135 직행 하한), `BLEND_W = 1.0`(12.5~13.5 블렌드 폭), `GAP_GUARD = 3.0`, `SPREAD_MAX = 2.5`(OSR135 세 분기 spread 신뢰 상한), `OSR135_UNDER_TH = 13.0`, `OSR135_UNDER_GAP = 0.35`
- group 별 base(`baseStar2`): A·B → OSR(없으면 oldOSR), C → OSR≥11.0 면 OSR / <11.0 면 oldOSR / 10.5~11.0 보간(`:1052-1070`)
- OSR135 spread > 2.5 면 불신 → baseStar2 직행(`:1072-1075`)
- ≥13.5 → OSR135 직행 / 12.5~13.5 → diffBlend×(1-gapW)+OSR135×gapW (gapW=clamp((OSR135-OSR)/3)) / <12.5 → baseStar2 (`:1086-1121`)

### 1.4 v3.4.0 최종 override — onlyOSR / onlyOSRtoEreter (`:1125-1141`)
adopt 결과를 **덮어쓰는** 현재 별값 체계:
- 비-DB: `onlyOSRtoEreter.inferEreter(allCharts, ratingData, {charts:ereterData, players})` 호출(`:1133`).
  - `starEstimate = r2e.ereterStar` (표시용, ereter scale 변환값 = **onlyOSRtoEreter**)
  - `nativeStar = r2e.ohsorryStar` (전체곡 native 50%, 절대 실력 = **onlyOSR**)
  - `starEstimateNew = nativeStar` → 추천 baseStar 가 native 값을 사용
- DB: `dbData.native_star` 를 읽어 `starEstimateNew` 로(`:1128-1130`), `starEstimate` 는 `dbData.star_estimate` 그대로.

두 별값의 의미 정리(조망 문서 [별값 파이프라인](../../docs/README.md#별값-파이프라인) 과 동일):
| 값 | lib | supabase 컬럼 | 용도 |
|----|-----|---------------|------|
| `nativeStar` | onlyOSR | `native_star` | 추천 baseStar (절대 실력) |
| `starEstimate` | onlyOSRtoEreter | `star` | 표시용 (ereter 비교) |

### 1.5 추천 baseStar 결정 (`:1258-1268`)
- `ohsorryRecBase = starEstimateNew ?? starEstimate` (`:1266`) — OSR/native 단독값 사용(OSR135 over-estimation 배제).
- ereter players 에 유저 IIDX ID 가 있으면 `eraterTrueStar`(ereter 실측)를 우선 → `recBaseMode='ereter'`, 없으면 `'ohsorry'`(`:1267-1268`).

---

## 2. 추천곡 파이프라인

recommend.js 의 `createContext(deps)` 컨텍스트로 동작. core 가 `buildRecs(threshold, stage, baseStar, recLevelMode, djMode, opts)` 를 EC/HC/EXH 로 호출(`calcOhsorryCore.js:1473-1476`).

흐름: **buildPools → (1-pass 8배치 매치 + 태그) → sample15 → cleanup 50/50 보정 → 최종 추출 → finalizeRecs(계층 랜덤/리롤)**.

### 2.1 buildPools (`recommend.js:334-468`)
stage 별 `effectiveBase`(`:362-364`):
- EC: `baseStar - 0.5` / HC: `baseStar` / EXH: `baseStar + 2`

`topClearStar` = 해당 stage 클리어(lampNum≥threshold) 차트의 ereter★ 최댓값(`:354-361`).
`d = max(0, topClearStar - effectiveBase)`, 경계 상수(`:365-370`):
- `hardMin = effectiveBase + 0.65·d` (코드 정본; 일부 주석은 0.7d)
- `hardMax` = EC면 `topClearStar + 0.15·d`, 그 외 `topClearStar + 0.3·d`
- `easyMin = effectiveBase`

**EC/HC 분류**(`:455-462`): `dv>hardMax` 제외 / `≥hardMin` hard / `≥easyMin` easy / 그 외 cleanup (EC 는 `e.hc < baseStar-3` 면 제외).
**EXH 분류**(`:452-454`): `dv≥effectiveBase` 면 제외, 아니면 전부 cleanup(약/강도전 없음).

카테고리(미도달 under / 도달DJ미도달 reached) × 분류(hard/easy/cleanup). `djMode='off'` 면 under(클리어램프 미달)만, `'on'` 이면 reached 도 포함.
저레벨 fallback `lowBase`(`:414-419`): lv8 0.20 / lv9 0.45 / 그 외 0.70, `ec=lowBase, hc=+0.28, exh=+0.58`.

### 2.2 클리어 추천 점수 — `enrichClearCandidate` 8 component (`recommend.js:520-571`)
공통 sub-score(`clamp01`): `diffFit`(난이도 근접, EXH ÷3.2 그 외 ÷2.4), `lampFit`(램프 근접, ≥threshold면 0.74), `rateFit`(점수율 근접, 없으면 0.35), `countFit`(`log10(count+1)/3`), `layoutFit`(8배치 best → `(bestTotal+12)/24`, 없으면 0.5), `layoutGainFit`(`layoutGain/8`), `djFit`(DJ랭크 F=0…AAA=1), `categoryBoost`(cleanup +0.10 / easy +0.04 / hard −0.03).

stage 목표: `stageRateTarget` exh89/hc82/ec74, `stageRateWidth` exh10/hc12/ec14 (`:513-514`).

**v1 가중합**(`:556-564`):
```
diffFit·0.24 + lampFit·0.18 + rateFit·0.18 + countFit·0.14
  + layoutFit·0.14 + layoutGainFit·0.06 + djFit·0.06 + categoryBoost
```
**v2 가중합**(현재 기본 `REC_SCORE_MODE='v2'`, `calcOhsorryCore.js:1463`; `recommend.js:540-554`):
```
matchScore·0.45 + layoutGainFit·0.10 + diffFit·0.15 + lampFit·0.12
  + rateFit·0.10 + countFit·0.04 + djFit·0.04 + categoryBoost
```
`matchScore` = 풀 내 `bestNorm` min-max 정규화값(`_matchNorm`, 없으면 0.5 중립). v2 는 "내 손으로 배치 걸어서라도 칠 수 있는가"(28dim 매칭)를 주력으로 둡니다.

`_clearType`(`:566-569`): near-lamp / score-ready / popular(countFit≥0.6) / fit.

### 2.3 sample15 + cleanup 50/50 (`recommend.js:589-637`)
- pool = hard+easy+cleanup. 1-pass 에서 `_matchByHand`(8배치) + `_tags` 계산. v2 면 `applyMatchNorm` 으로 풀 내 bestNorm 정규화(`:577-588`).
- 2-pass 에서 `enrichClearCandidate` + `_hashtags`.
- 정렬: 8배치 가능(`canUseByHand`)이면 bestTotal desc, userVec만 있으면 match desc, 둘 다 없으면 `count` desc.
- `top15 = sorted.slice(0, SAMPLE_SIZE)`. `SAMPLE_SIZE`=15(randomize/withPool 아닐 때, `:487`).
- **cleanup 50/50 보정**(`:620-635`): top15 의 cleanup 곡 중 `floor(개수/2)` 만큼을 bestTotal 낮은 쪽부터 잘라내고, cleanup 풀 전체에서 `diffValue` 오름차순 곡으로 교체(쉬운 정리곡 보강).

### 2.4 최종 추출 (`recommend.js:658-735`)
- `underTargetBase` = djMode 'on' 면 8, 아니면 10. `underTarget = round(underTargetBase·FACTOR)`(FACTOR=POOL_N/10, `:488`).
- stage 별 slot 배분(`:700-717`):
  - EXH: cleanup=underTarget, easy=1, hard=1
  - EC: cleanup=(base≥10?4:3), easy=(base≥10?5:4), hard=1 (도전곡 축소)
  - HC: cleanup=(base≥10?4:3), easy=(base≥10?4:3), hard=2
- 각 slot 은 `_clearScore` desc(`byClearScore`)로 takeFrom. **underLamp(목표 램프 미도달) 우선**.
- djMode 'on' 이면 reached(도달DJ미달) 곡을 POOL_N 까지 섞음(`:727`, 주석상 "최대 2곡" — underTarget 8 축소로 통상 2슬롯).
- 부족분은 under 전체 → underSample+reachedSample 순 보충.
- `finalizeRecs`(`:491-502`): `randomize:true` 면 `stratifiedSample`(계층 랜덤, 리롤마다 변동), 아니면 top LIMIT(=10).

> core 는 초기 렌더부터 `randomize:true` 로 호출(`calcOhsorryCore.js:1473`) → 첫 화면부터 매번 변동. POOL_N=30(randomize).

### 2.5 8배치 평가 연동 (mirror/flip)
- sample15 1-pass 가 각 row 에 `chartStrengthMatchByHand(r, v2면 normalize)` → `_matchByHand` 부착(`recommend.js:594`). 이 함수가 `weaknessLib.chartStrengthMatch8Way`(8배치) 호출.
- `_layoutGain`(`:534-536`) = bestTotal − 정규배치(`!flip&&!mL&&!mR`) total → `layoutGainFit` 으로 반영("배치 걸면 깰 곡").
- `setLayoutMode(m)`(`:1192`)로 UI 토글: `layoutModeForClear='off'` 면 `{flipOn:false, mirrorOn:false}` 로 정규 N/N 강제(`:216`). core 의 `__dp_rerollRecs(... layoutMode)` 가 전달.
- 8배치 점수/penalty 수식은 [4.3](#43-8배치-평가-mirrorflip) 참고.

### 2.6 추천 해시태그/태그 (`recommend.js:249-303`)
- `computeChartTags`(`:249`): 차트 패턴 feature avgPt top 3(>0)을 `FEAT_TAG_MAP`(`:38-42`, NOTES=밀도/CHORD=동치/PEAK=순간밀도/CHARGE=롱잡/SCRATCH=스크/SOF-LAN=변속/PHRASE=계단/JACK=축연타/TRILL=트릴/RAND=난타) 약어로.
- `computeRecHashtags`(`:263`): `CATEGORY_TAG_MAP`(hard `#어려움`/easy `#도전`) + 시리즈명 + `#가능성높음`(clearScore≥0.72)/`#도전권`(<0.45) + `#램프근접`/`#점수충분`/`#검증곡` + 배치(`#FLIP`/`#쌍미러`/`#좌미러`/`#우미러`) + 한손 편차(`HAND_BIAS_THRESHOLD=0.3`, `:48`)로 `#왼손위주`/`#오른손위주`.

---

## 3. 연습곡(약점) 추천 — buildWeaknessRecs (`recommend.js:752-1170`)

순수 패턴 연습용. **userVec.`__vecL`/`__vecR` + patternsMap + featureScoresMap.scores 모두 필요**(없으면 `[]`).

### 3.1 상수
- `WEAKNESS_FEATS`(`:133`): `NOTES, CHORD, PEAK, PHRASE, JACK, TRILL, RAND` (순수 건반 7).
- `WEAKNESS_CLEAR_LAMP = 4`(`:134`), `MIN_BIN_N = 10`(`:135`).
- `WEAKNESS_MODE_FEATS`(`:136-150`): all=건반7, 개별 건반 7종 단독, CHARGE/SCRATCH/SOF-LAN 은 전용 feature 만(서로 안 섞음).
- `practiceZasaDefault`(`:164-187`): 클리어 최고 zasa 기준 `{min:top-1, max:top}`, 이력 없으면 `{5.9, 6.9}`.

### 3.2 후보 필터 (`:810-884`)
모드별 개인차 필터(예 CHARGE 는 chargeAvg>0 & soflan==0 & scratch<6.35; 건반/all 은 순수 건반곡만), `gameLevel>maxClearGameLevel` 제외, `zasaHardCap`(=`max(topClearZasa+0.5, ecTopClearZasa)`) 초과 제외, zasaMin/Max 범위 밖 제외, **rate≥95 제외**(이미 잘 침).

### 3.3 점수화
zasa 0.1 bin 평균(친 곡만, n<10 이면 이웃 bin 결합) → `deficit = binMean - rate`.
**v1**(`:961-968`): `weakSignal·0.32 + patternScore·0.18 + difficultyFit·0.22 + deficitScore·0.18 + unplayedBonus(0.16) + lampNeed(0.12) − alreadyGoodPenalty(0.18)` + 8배치 가산(`layoutAssist·0.08 + layoutGain·0.08 + layoutPractice·(strength별 0.03~0.08)`, `:1006-1011`).
**v2**(`:1027-1036`): `weakMatchScore·0.38 + weakSignal·0.18 + patternScore·0.08 + difficultyFit·0.18 + deficitScore·0.10 + layoutGain·0.08 + unplayedBonus + lampNeed − alreadyGoodPenalty`.

### 3.4 복습/신규/실전 혼합 (`:1057-1080`)
`practiceType`(`:957-960`): review(친 곡 & deficit>1) / pattern(안 친 곡) / score(lampNeed 또는 rate<88) / practical.
takeType 쿼터: review `ceil(topN·0.3)`, pattern `ceil(topN·0.3)`, score `ceil(topN·0.2)`, practical 나머지. 부족분 점수순 보충. randomize 면 상위 60풀에서 `stratifiedSample(topN)`.

---

## 4. 약점 분석 — calcWeakness

`calcUserWeakness(opts)` (`calcWeakness.js:138-336`). EX rate 잔차를 feature pt 로 가중평균해 강점/약점 벡터를 만듭니다.

### 4.1 잔차 산출 모드 (`:222-278`)
- ratingMap 모드: 한 차트를 `estEc/estHc/estExh` 3 entry 로 펼침(STAGES, `:195`). `bucket = floor(star·2)/2`(0.5 단위).
  - **rate-reference 분기**(absolute): `refRateOf(refCache, stage, bucket)` 있으면 `residual = rate - refRate` 즉시(`:235,240-241`). 모든 유저 동일 baseline → vec 직접 비교 가능. (rate-reference-slim.json = 3550명 평균 EX rate, stage×0.5 bucket. isotonic 단조화는 reference 생성 측 — 이 모듈은 lookup 만.)
  - self-relative fallback: refRate 없으면 bucket 평균 산출 후 `residual = rate - bucketMean`(`:264-268`).
- legacy(lv) 모드: ratingMap 없을 때 lv별 평균 rate 대비 잔차.
- zasaMap 결합(`:176-193`): ratingMap 미등록 차트는 zasaLevel 에서 GAP 차감 추정 — `GAP_EC=10.3, GAP_HC=6.2, GAP_EXH=2.3`(`:107-109`).

rate = `c.scorePercent` 우선, 없으면 `(exScore/(noteCount·2))·100` (`:217-220`).

### 4.2 벡터화 (`:284-319`)
feature 별 가중평균(가중치 = 차트 패턴 pt):
- `vec[f] = Σ(residual·pt[f]) / Σpt[f]` (양손 평균)
- `vecL[f]`/`vecR[f]` = P1/P2(왼손/오른손) pt 기준
- mirror 18차 `vec[stem+'_L']`/`_R` = m1/m2(손별 차트) pt 기준
부호: 음수=약점(강한 차트에서 평균보다 못 침), 양수=강점. 명시적 clamp 없음(경험적 ≈ -1~+1).

### 4.3 8배치 평가 (mirror/flip) — `chartStrengthMatch8Way` (`:474-599`)
8배치 = flip(2) × mirL(2) × mirR(2). 손별 점수 = `invariantScore`(FEATS dot) + `mirrorScore`(18 dim _L/_R).
penalty:
- **misfinger**(`:425-435`): `strongCount·MISFINGER_WEIGHT_STRONG(0.5) + randCount·MISFINGER_WEIGHT_RAND(0.15)`. 왼손은 정규 시 K6/K7, mirror 시 K1/K2 무리(오른손 반대). flip 무관.
- **trill**(`:441-456`): `grp·TRILL_WEIGHT(0.35)`. 왼손 정규=low(12/13/23), mirror=high(56/57/67)(오른손 반대).
- `total = (sL - penL) + (sR - penR)`, `strengthRaw = sL + sR`(penalty 전, weakness 용). `bestNorm` = invariant·mirror 각 pt 로 정규화한 -1~1 값(normalize 옵션 시).
- best 결정: handMode(both/left/right) 별 합계 max → `{best, bestLabel, bestTotal, bestNorm}`.
- `chartWeaknessMatch8Way`(`:606-617`): 부호 반대, `bestTotal = -strengthRaw - pen` (무리배치 차트는 약점 보완 후순위).

### 4.4 28차 피쳐 점수 (supabase 저장용)
dbConn 의 `computePatternScoreVec(iidxId)` (`dbConn.js:558-636`)가 담당(calcWeakness 의 동명 함수 `:648-696` 와 동일 개념):
- feature-scores-slim.json(차트별 quantile 0~100) + textage notes 로 `scoreRate = ex_score/(noteCount·2)`.
- `points = featureScore · scoreRate`, score=0 제외, feature 별 desc top 30(`TOP_N`) 가중합.
- `SKILL_WEIGHTS`(`calcWeakness.js:639-647`, dbConn `:549-557`): 1~5위 = 1.0, 6~30위 = `(90 - i·85/24)/100` 선형 감소(90%→약 5%).
- 결과 28차 → `upsert_user_feature_score` RPC. userVec(휘발, 개인 내 상대)와 달리 feature_score 는 절대(사용자간 비교) + supabase 영속.
