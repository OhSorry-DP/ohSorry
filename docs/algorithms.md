# algorithms — 별값 추정·36차 피쳐 점수

> **[구조개편 2C, 2026-06-16]** core 가 실제로 하는 계산은 **별값(★) 추정 한 가지** + dbConn 의 36차 피쳐 점수뿐입니다. 추천곡·약점분석·★-모델 내부 수식은 core 에서 제거돼 **오소리레이팅**으로 이관됐습니다(아래 §3 포인터).
> 상위 조망: [`../../docs/ohSorry.md`](../../docs/ohSorry.md) · 인덱스: [README.md](README.md)

> ★추정 모델 본체(OSR13.5+/onlyOSR/onlyOSRtoEreter)는 core 가 fetch+eval 하는 **별도 gist lib** 라 이 repo `modules/` 에는 소스가 없습니다. 실제 소스·수식은 [ohSorryRating](../../ohSorryRating/) 의 [`modules/`](../../ohSorryRating/modules/) + [docs/model.md](../../ohSorryRating/docs/model.md). 아래는 "core 가 호출하는 인터페이스" 까지만.

---

## 1. 별값(★) 추정

core 의 5.5 단계(`calcOhsorryCore.js:521-540`). 표시용 `star` 와 절대 실력 `native_star` 를 산출합니다.

### 1.1 입력
- `allCharts` (유저 차트 + lamp, series 크롤 + textage gameLevel 보강)
- `ratingData` (= ohSorryRating.json)
- ereter payload `{charts: ereterData, players: ereterPlayers}`

### 1.2 단일 호출 — onlyOSRtoEreter.inferEreter
별값 lib 3종(OSR13.5+ → onlyOSR → onlyOSRtoEreter)을 `__loadStarLibs`(`:223-235`)가 gist 에서 fetch+eval(window 전역 등록). core 는 **`onlyOSRtoEreter` 하나만** 직접 호출:

```js
const r2e = onlyOSR2eLib.inferEreter(allCharts, ratingData, { charts: ereterData, players: ereterPlayers });
starEstimate = r2e.ereterStar;   // 표시용 (ereter scale 변환)
nativeStar   = r2e.ohsorryStar;  // 전체곡 native 50% (절대 실력)
```

- `inferEreter` 는 내부적으로 OSR13.5+(13.5 tier)·onlyOSR(native) lib 을 쓰며, **자체 norm 으로 매칭**(core 의 `norm` 과 무관 → norm 통일이 별값에 영향 없음).
- 산출 실패/미로드 시 `star/native_star = null` → 업로드에서 기존 supabase 값 보존(+ `console.warn`).

### 1.3 부분 크롤 skip (`:524-526`)
`fullCrawl`(seriesList 33개 전부)일 때만 별값 계산. 일부 시리즈만 크롤하면 데이터 불완전 → **별값 계산 skip**:
- `star` 는 `fetchUserStars(iidxId)` 로 기존값 조회해 재전송(upsert_user 의 star EXCLUDED 덮어쓰기로 인한 null wipe 방지).
- `native_star` 는 null 전송 — upsert_user 가 COALESCE 라 기존값 자동 보존.

### 1.4 두 별값의 의미
| 값 | lib | supabase 컬럼 | 용도 |
|----|-----|---------------|------|
| `nativeStar` | onlyOSR | `native_star` | 추천 baseStar (절대 실력) — 오소리웹/INF 가 소비 |
| `starEstimate` | onlyOSRtoEreter | `star` | 표시용 (ereter 비교) |

> 구버전 oldOSR/osr/OSR135 3-lib + adopt 채택 분기는 onlyOSR 체계로 대체(2026-06-03)되며 core 에서 제거. 채택 수식 이력은 [ohSorryRating/docs/](../../ohSorryRating/docs/) 참고.

---

## 2. 36차 피쳐 점수 (supabase 저장용) — dbConn

추천/약점 userVec 와 달리, **36차 손별 feature score 는 dbConn 이 업로드 시 자체 계산**(`computePatternScoreVec(iidxId)`, `dbConn.js:724~`. 산식은 ohSorryRating `patternScoreKernel.js` 정본의 inline 동기 사본 `:661~`):
- `feature-scores-slim.json`(차트별 quantile 0~100) + textage notes 로 `scoreRate = ex_score/(noteCount·2)`.
- `points = featureScore · scoreRate`, score=0 제외, feature 별 desc top 30(`TOP_N`) 가중합.
- `SKILL_WEIGHTS`(dbConn `:549-557`): 1~5위 = 1.0, 6~30위 = `(90 − i·85/24)/100` 선형 감소(90%→약 5%).
- 결과 36차 → `upsert_user_feature_score`(37-arg) RPC. userVec(휘발, 개인 내 상대)와 달리 feature_score 는 절대(사용자간 비교) + supabase 영속.

기본 10 feature(NOTES/CHORD/PEAK/CHARGE/SCRATCH/SOF-LAN/PHRASE/JACK/TRILL/RAND) + 손별 18(STAIR_UP/DN_L·R, K1~K7_L·R) + 신규 8(DOUBLE_STAIR_L·R, KEIMA_L·R, HSTAIR_ONEHAND/SYNC/SAMESHAPE/DIFFSHAPE). 키 매핑은 [data-pipeline.md](data-pipeline.md#32-키-매핑-메모).

---

## 3. 추천곡·약점분석·★-모델 — 이관됨 → ohSorryRating

구조개편(ROADMAP §0)으로 **도메인 로직**(추천 풀 분류·8 component 가중합·8배치 mirror/flip·calcWeakness 잔차 벡터·★-모델 수식)은 오소리레이팅이 정본으로 흡수했습니다. core 는 더 이상 `recommend.js`/`calcWeakness.js`/oldOSR 등을 fetch 하지 않습니다.

- 추천 파이프라인(buildPools → 8 component → sample15 → 8배치) · 연습곡(약점) 추천: [ohSorryRating/modules/recommend.js](../../ohSorryRating/modules/recommend.js), [ohSorryRating/docs/](../../ohSorryRating/docs/)
- 약점/강점 분석(calcUserWeakness · chartStrengthMatch8Way · misfinger/trill penalty): [ohSorryRating/modules/calcWeakness.js](../../ohSorryRating/modules/calcWeakness.js), 설계메모 동소 `calcWeakness.md`
- ★-모델(IRT/ridge 계수, tier 채택): [ohSorryRating/docs/model.md](../../ohSorryRating/docs/model.md)
- 표시(추천 토스트·서열표·분석탭 렌더): [ohSorryWeb](../../ohSorryWeb/) (gist-modules)

> 이 계산들은 런타임에 **오소리웹/INF** 가 별값 lib·recommend·calcWeakness 를 직접 fetch 해 수행합니다(코어-free). 본체 core 는 무관.
