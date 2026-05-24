# 짭레터넷 (IIDX DP 12 점수 / 추천 계산기)

ereter.net 의 ☆12 난이도 분석 데이터를 e-amusement 의 DP 플레이 데이터에 매칭해서 **★값 추정 + 추천곡 + 통계** 를 보여줍니다.

평소 사용은 **PC 콘솔 한 줄** 또는 **모바일 북마크렛 한 번 탭** 으로 끝.

---

## 평소 사용법

### PC (데스크톱 브라우저)

p.eagate.573.jp 어느 페이지에서나 (메인페이지, 마이페이지 등) F12 → Console → 아래 한 줄 붙여넣기:

```javascript
fetch('https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/2-calc-score.js?t='+Date.now()).then(r=>r.text()).then(eval)
```

진행 상황 패널이 우상단에 뜨고, 약 20~30초 후 결과가 표시됩니다.

> URL 끝의 `?t=` 부분은 Gist 캐시 우회용입니다. 그냥 같이 붙여넣으세요.

### 모바일 (북마크렛)

모바일 브라우저는 콘솔이 없어서 **북마크렛** 으로 실행합니다. 한 번만 등록해두면 그 후로는 북마크 한 번 탭으로 끝.

**1단계: 북마크 등록**

아무 페이지나 북마크에 추가한 뒤, 북마크 편집해서 **URL 부분을 아래 코드로 교체**:

```
javascript:fetch('https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/2-calc-score.js?t='+Date.now()).then(r=>r.text()).then(eval)
```

이름은 알아보기 좋게 (예: "오소리") 으로 변경.

**2단계: 사용**

1. p.eagate.573.jp 로그인 후 아무 페이지에서
2. 주소창에 북마크 이름 (또는 일부) 타이핑 → 검색 결과에서 북마크렛 선택
3. 또는 북마크 메뉴에서 직접 탭

---

## 표시되는 정보

### 1. 프로필 카드
- qpro 이미지, DJ NAME, IIDX ID
- **SP / DP 단위**:
  - 一段 ~ 八段: 파란색
  - 九段, 十段: 빨간색
  - 中伝: 은빛 (부드럽게 반짝)
  - 皆伝: 금빛 (부드럽게 반짝)
- **★값 (큰 숫자)**: 우리 모델 추정값 (OhSorry)
- **이레터 원본 ★** (작은 글씨): 사용자 IIDX ID 가 ereter 에 있으면 비교 표시
  - `ereter: ★4.96 (-0.04)` — 차이 색상 코딩
  - 초록 (\|차이\| ≤ 0.1) / 노랑 (≤ 0.3) / 빨강 (그 이상)

### 2. 추천곡 (EASY / HARD / EX-HARD)
각 단계별 10곡, 매번 랜덤 선정. **3-pool 2:5:3 구조**:

| 풀 | 범위 | 표시 곡 수 |
|---|---|---|
| 하드 도전 | ★ + offset − 0.3 ~ ★ + offset | 2곡 |
| 약 도전 | ★ ~ ★ + 0.2 | 5곡 |
| 정리 | 0 ~ ★ (미만) | 3곡 |

**도전 offset (동적)**: 저레벨일수록 위로 더 멀리 — ★0.5 → +1.0, ★14.0 → +0.3 선형 보간. 즉 ★4.5 사용자라면 도전 offset ≈ +0.79 → 하드 풀은 ★4.99 ~ ★5.29.

**후보 sampling (각 풀)**:
- 클리어 인구수 desc top 10 + 나머지 풀에서 순랜덤 5 = 후보 최대 15곡
- 후보를 셔플 → 위 표의 N곡 선택
- 한 풀이 부족하면 다른 풀 후보에서 보충 (총 10곡 유지)

**미클리어 정의** (단계별 threshold):
- EASY 추천: lamp < EC (NO PLAY/FAILED/ASSIST)
- HARD 추천: lamp < HC (위 + EASY/CLEAR)
- EX-HARD 추천: lamp < EX-HARD (위 + HARD)

**표시 순서**: 카테고리 무관, 전체 10곡을 ★ 오름차순 (낮 → 높) 으로 통합 정렬.

**↻ 다시 뽑기**: 각 단계 헤더(열린 상태)의 버튼을 누르면 그 단계만 새로 뽑아서 갱신 (panel 새로고침 불필요).

**추천곡 기준 토글** (ereter 데이터 매핑 있을 때만 표시):
- `ereter ★4.96 | OhSorry ★4.92` — 글씨 클릭으로 즉시 전환
- 기본값: ereter 모드 (있으면) / 없으면 OhSorry
- 모드 변경 시 모든 단계 추천곡 자동 재계산

차트 표시 색상:
- H (HYPER): 연한 금
- A (ANOTHER): 연한 빨강
- L (LEGGENDARIA): 연한 마젠타

### 3. 상세 통계
- **CLEAR TYPE / DJ LEVEL** (공식 페이지 표): e-amusement 페이지 그대로 표시
- **난이도 별 클리어 램프**: ★11.6 ~ ★12.7 단위로 FC/EX/HC/CL/EC/AC/FA/NP 분포
- **난이도 별 DJ LEVEL**: ★ 단위로 AAA/AA/A/B/C↓/NP 분포

**↻ 다시 계산**: 상세 통계 헤더의 버튼을 누르면 클릭 위치 옆에 확인 토스트 → "재실행" 누르면 전체 패널 제거 후 Gist 다시 fetch + 실행 (e-amusement 페이지 다시 긁음). 매번 북마크 다시 클릭할 필요 없이 패널 안에서 재실행 가능.

---

## ★값 추정 원리

ohSorry 본체의 ★ 추정 모델 / LOOCV / v3.0.x ~ v3.3.x 변경표는 [ohSorryRating README](../ohSorryRating/README.md) 의 "OSR 추정모델 변경사항 (oldOSR)" 섹션 참고.

ohSorry 는 외부 ★ 추정 lib (`oldOSR.js` / `osr.js` / `OSR13.5+.js`) 를 fetch 해서 사용하고, 곡 별 estimate (`ohSorryRating.json`) 도 ohSorryRating 에서 빌드한 산출물을 사용.


## 트러블슈팅

### "ereter 데이터가 비어있어요" 에러
Gist 데이터가 잘못됐거나 ereter.net 페이지 구조가 바뀐 경우.

데이터를 다시 긁어와야 함:
1. ereter.net 어느 페이지에서 F12 → Console
2. `1-fetch-ereter.js` 실행 (자세한 건 "데이터 갱신" 섹션)
3. Gist 의 `ereter-data.json` 갈아끼움

### 캐시가 안 갱신될 때
브라우저 콘솔에서:
```javascript
localStorage.removeItem('ereter_dp_diff_v4')
```
후 다시 step 2 실행.

### "★값 추정: 표본 부족 (XX개)" 메시지
12렙 곡을 30개 이상 시도해야 ★값 추정 가능. 그 미만은 통계가 부족해서 추정 안 함.

### "CUTOFF 미달!" 콘솔 경고
cleared 곡이 50 미만이면 학습 분포 밖이라 추정값 정확도 보장 X. 결과는 표시되지만 큰 오차 가능.

### 매칭 미달 (예: 매칭 280 / 미매칭 13)
ereter.net 에 없는 신곡이거나 곡명 차이로 매칭 안 된 곡. 신곡이 ereter 에 추가될 때까지 기다리거나 데이터 갱신 필요.

### 추천곡 토글 (ereter / OhSorry) 이 안 보임
사용자의 IIDX ID 가 `ereter-data.json` 의 `players` 매핑에 없거나, ereter-data.json 이 옛 형식 (players 필드 없음) 인 경우. 데이터 갱신하면 토글 표시됨.

---

## 데이터 갱신 (관리자용)

ereter 데이터는 가끔 (신곡 추가, 난이도 분석 갱신 시) 새로 받아와야 합니다.

### 절차

1. ereter.net **어느 페이지**에서나 F12 → Console (perlevel 페이지 안 가도 됨)
2. 아래 한 줄로 1-fetch-ereter.js 실행:
   ```javascript
   fetch('https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/1-fetch-ereter.js?t='+Date.now()).then(r=>r.text()).then(eval)
   ```
3. 자동으로 두 페이지 fetch:
   - `/iidxsongs/analytics/perlevel/` — ☆12 곡별 난이도 (684개)
   - `/iidxplayers/` — 사용자별 ★값 매핑 (~3700명)
4. 데이터가 자동으로 클립보드에 복사됨 (`charts` + `players` 통합 JSON)
5. Gist 에서 `ereter-data.json` 편집 → 붙여넣기 → Save

### ereter-data.json 형식 (v2)

```json
{
  "extractedAt": "2026-05-07T13:06:00.000Z",
  "count": 684,
  "playerCount": 3750,
  "charts": [...],
  "players": {
    "01456165": 11.14,
    "62048326": 14.54,
    ...
  }
}
```

옛 형식 (v1, 배열만 또는 charts 만) 도 호환 — 단 `players` 가 없으면 추천곡 토글 X / 이레터 원본 ★ 비교 표시 X.

### zasa 보충 데이터 갱신

ereter 가 등록 안 한 ☆12 차트 (LEGGENDARIA 다수 + 신곡 ANOTHER) 를 보강하기 위해 zasa.sakura.ne.jp 의 비공식 ☆12 난이도표를 보충 데이터로 사용합니다. **추천곡 / ★값 추정에는 사용 X — "★ 단위별 클리어 램프 / DJ LEVEL" 표 의 곡 수 보강용 (ereter 미등록 차트 검증) 만**.

#### 절차

1. https://zasa.sakura.ne.jp/dp/run.php 접속
2. F12 → Console 에서 아래 한 줄 실행:
   ```javascript
   fetch('https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/3-fetch-zasa.js?t='+Date.now()).then(r=>r.text()).then(eval)
   ```
3. 자동으로 ☆12 (★11.6~12.7) 차트 추출 → 클립보드에 JSON 복사
4. Gist 의 `zasa-data.json` 파일을 새로 만들거나 (없으면 "Add file" → 파일명 `zasa-data.json`) 갈아끼움
5. Gist 저장하면 다음 `2-calc-score.js` 실행 시 자동으로 적용

#### zasa-data.json 형식

```json
{
  "extractedAt": "2026-05-09T10:00:00.000Z",
  "source": "https://zasa.sakura.ne.jp/dp/run.php",
  "count": 729,
  "charts": [
    { "title": "곡명", "diff": "ANOTHER", "level": 12.3 },
    ...
  ]
}
```

ereter 와 다른 점:
- `level` 만 있고 `ec` / `hc` / `exh` 단계별 ★ 없음 → 추천곡 / ★값 추정에 못 씀
- `players` 없음 (zasa 는 사용자별 ★ 데이터 X)

#### 갱신 빈도

ereter 보다 보수적으로 — **신곡 시즌 추가 후 한 번** 정도면 충분. zasa 는 비공식 운영자가 수동으로 갱신하니 변경이 잦지 않음.

zasa-data.json 이 Gist 에 없어도 동작 — 그땐 ereter 데이터만 사용 (이전 동작 그대로).

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `1-fetch-ereter.js` | ereter.net 에서 ☆12 난이도 + 사용자 ★ 데이터 추출 (관리자용) |
| `2-calc-score.js` | e-amusement 콘솔에서 실행, ★값 추정 + UI 표시 (메인) |
| `3-fetch-lv12-batch.js` | lv12 사용자별 batch 수집 (학습 데이터 보강용) |
| `3-fetch-zasa.js` | zasa.sakura.ne.jp 에서 비공식 ☆12 난이도표 추출 (관리자용 보충) |
| `ereter-data.json` | ereter.net 추출 데이터 (관리자가 갱신) |
| `zasa-data.json` | zasa 보충 데이터 — ereter 미등록 차트 검증 (선택, 없어도 동작) |
| `dataset.json` | 학습용 통합 데이터셋 |
| `index.html` | 사용 안내 정적 페이지 |
| `readme-page.js` | 사용 안내 페이지 렌더링 |
| `README.md` | 이 문서 |
| [`logic/`](logic/) | 모델 archive (v3.0.2 ~ v3.2.10 + params JSON) |

학습 데이터는 [`source/`](source/) (combined 페이지) 와 [`source_lv12/`](source_lv12/) (lv12 페이지) 에 사용자 ID 별로 저장.

---

## URL 모음

### Gist Raw URLs

```
1-fetch-ereter.js:
https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/1-fetch-ereter.js

2-calc-score.js:
https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/2-calc-score.js

3-fetch-zasa.js:
https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/3-fetch-zasa.js

ereter-data.json:
https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/ereter-data.json

zasa-data.json (선택):
https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/zasa-data.json
```

캐시 우회는 URL 뒤에 `?t=` + Date.now() 붙이면 됨.

---

## 모듈 구조 (v3.3.6 / core v0.0.335 부터)

기존 단일 `2-calc-score.js` (~2230줄) 가 책임별 5개 모듈로 분리됨. 사용자가 콘솔에 붙여넣는 URL 은 그대로 — wrapper 가 나머지 모듈을 자동 fetch.

**로컬 디렉토리 배치** (v0.0.343 부터):
- 진입점 / wrapper 는 root: `2-calc-score.js` (legacy redirect), `ohsorry.js` (본체 wrapper)
- 내부 모듈은 [`modules/`](modules/) 폴더 안: `calcOhsorryCore.js`, `ohsorryRender.js`, `dbConn.js`, `rivalOhsorry.js`, `normTitle.js`, `ohsorryShelf.js`
- gist 에는 파일이 flat 하게 저장되므로 (path 없음) URL 은 모두 동일 유지. gist push 시 `--filename` 으로 파일명만 지정 (예: `gh gist edit ... --filename calcOhsorryCore.js modules/calcOhsorryCore.js`)

| 파일 | 버전 | 줄수 | 역할 |
|---|---|---|---|
| `ohsorry.js` | v3.3.6 | ~54 | **본체 wrapper** — eagate 도메인 자동 실행. core/render/db 셋 다 fetch+eval 한 뒤 `Core.compute({mode:'own'})` 호출. `window.__dp_render(dbData)` 노출 (DB 모드). |
| `rivalOhsorry.js` | v3.3.8 | ~118 | **라이벌 wrapper** — 라이벌 페이지 (difficulty_rival.html?rival=&lt;토큰&gt;) 자동 실행. `__dp_fetch_rival_token` / `__dp_batch_rival_by_iidx` 헬퍼 + `Core.compute({mode:'rival'})`. IIDX ID prompt → 토큰 검색 → batch 흐름. |
| `calcOhsorryCore.js` | v0.0.335 | ~1366 | **계산 core** — ereter / zasa / textage / ohSorryRating + 외부 lib (oldOSR / OSR / OSR135) fetch + 캐시, difficulty.html 페이지 순회 fetch, parseDoc, ★ 추정 (v335E 채택 분기), 추천곡 계산, 프로필 fetch. 결과 객체 (`result`) 를 반환하고 `Render.show(result)` 호출. DOM 안 만짐 (UI 는 render). |
| `ohsorryRender.js` | v0.0.335 | ~854 | **UI render** — 진행률 UI (`showProgress`/`hideProgress`), 결과 패널 (프로필 / ★ / 노트레이더 / 추천곡 sortable / 상세통계), `__dp_rerun` / `__dp_confirmRerun` / `__dp_toggleRadar` 등. core 의 `result` 객체 받아서 표시 + `OhsorryDb.upsertUserProfile` 호출. |
| `dbConn.js` | v0.0.335 | ~73 | **supabase 통신** — `upsertUserProfile(payload)` / `fetchUserProfile(iidxId)` 두 RPC 호출만 담당. SUPABASE_URL / SUPABASE_KEY 캡슐화. |
| `ohsorryShelf.js` | v0.0.26 | ~565 | **서열표 렌더 lib** — charts 배열 → 격자 HTML (`renderShelf` / `renderChartRow` / `renderStackbar` / `injectStyle`). `calcOhsorryCore` 가 추천곡 토스트용으로, ohSorryWeb 게스트 페이지가 서열표 탭용으로 gist fetch. ohSorryRating 에서 이관. |
| `2-calc-score.js` | (legacy) | ~9 | **호환용 redirect** — 기존 사용자가 콘솔에 붙여넣던 URL 그대로 유지. 내부에서 `ohsorry.js` 를 fetch + eval 만 함. |

**의존 흐름**:
```
사용자 콘솔 / 북마크렛
     │ (fetch + eval)
     ▼
2-calc-score.js (legacy) ──redirect──► ohsorry.js (본체)
                                       │
                                       │ loadModule (fetch + eval)
                                       ├──► dbConn.js          (window.OhsorryDb)
                                       ├──► ohsorryRender.js   (window.OhsorryRender)
                                       └──► calcOhsorryCore.js (window.OhsorryCore)
                                                │
                                                │ Core.compute(opts)
                                                │   eagate fetch + ★ 추정 + 추천곡
                                                │   → result 객체 build
                                                ▼
                                           Render.show(result)
                                                │   panel DOM 만들기
                                                ▼
                                           Db.upsertUserProfile(result.dbPayload)
```

**Supabase 의 `version` 컬럼**: `${wrapperVersion}-core${CORE_VERSION_SHORT}` 조합 (예: `v3.3.6-core335`). wrapper 버전업 / core 버전업 모두 식별 가능.

**아카이브**: `archive/` 폴더에 각 모듈의 버전 박힌 사본 (`ohsorry-3.3.6.js` / `calcOhsorryCore-0.0.335.js` 등) 보존. 모델 코드 (구버전) 는 `logic/` 폴더.

---

## 변경 이력

### 2026-05-25 — calcOhsorryCore userVec 계산 시 zasaMap 전달 (lv10 차트 포함)
- [modules/calcOhsorryCore.js](modules/calcOhsorryCore.js) — `calcUserWeakness` 호출에 `zasaMap: zasaData` 추가. calcWeakness 가 ratingMap 미수록 lv10 차트도 zasa level 기반 임의 estEc/Hc/Exh 로 잔차 분석 풀에 포함.
- 본체 추천 동작 영향 없음 — userVec 정확도만 향상.

### 2026-05-25 — calcWeakness analyzeFeature 추천곡 entry 에 bucketMean 추가
- [modules/calcWeakness.js](modules/calcWeakness.js) — `analyzeFeature` 의 recommends entry 에 `bucketMean` (estEc/Hc/Exh 3 bucket 평균의 평균) 노출. ohSorryWeb 분석 탭이 "현재 EX → 목표 EX (+차이)" 표기로 그 차트 feature 기여 가능 점수 시각화에 사용.
- 본체 추천 동작 영향 없음 — 신규 필드만 추가.

### 2026-05-24 — 패턴 분석 통합 — calcOhsorryCore 강점 매치 정렬 + 새 추천 범위 룰 + EXH 통합
- **신규 [modules/calcWeakness.js](modules/calcWeakness.js)** (UMD) — 유저 9 feature (NOTES/CHORD/PEAK/CHARGE/SCRATCH/PHRASE/JACK/TRILL/RAND) 약점/강점 벡터 + 차트별 강점·약점 매치 점수 helper. 잔차 분석 (같은 lv 내 평균 rate 잔차 ↔ feature 가중평균). gist 배포 (`window.OhsorryWeakness`).
- **신규 gist `patterns-all-slim.json`** (627 KB / 2171곡 / 2348 차트) — DP NOR/HYP/ANO/LEG 차트별 9 feature pt. ohSorryRating 의 [build-patterns-all.js](../ohSorryRating/scripts/build-patterns-all.js) + slim 빌드.
- **[modules/calcOhsorryCore.js](modules/calcOhsorryCore.js) 통합:**
  - patterns + calcWeakness fetch + `userVec` 계산 (`[step2] userVec` 콘솔 로그)
  - sample15 정렬 — `userVec` 있으면 강점 매치 desc / 없으면 기존 count desc (fallback 안전)
  - 추천 범위 룰 변경 — `challengeOffset` 폐기, `topClearStar` (그 stage 클리어한 ★ 최댓값) 기반 강/약/정리 분리
    - 강도전 = `[hi, hi+1]` / 약도전 = `[lo, hi)` / 정리곡 = `[0, lo)` (hi = max(topClear, base), lo = min)
    - 초보 (topClear < base) 케이스 → 강도전이 자동 baseStar 로 fallback
  - `buildExhRecs` → `buildRecs(6, 'exh')` wrapper (EC/HC 와 동일 구조, 50+ 줄 → 5 줄)
- 알고리즘 / 데이터 빌드 상세 — [ohSorryRating README "패턴 분석"](../ohSorryRating/README.md#패턴-분석-textage-stat-기반-2026-05-24) 참고

### adopt v0.0.2 — OSR135 10.0+ 직행 + under-blend 폐기 (재학습 OSR135 반영)
- gist 의 [adopt.js](https://gist.githubusercontent.com/.../adopt.js) v0.0.1 → v0.0.2. OSR135 재학습 결과 zone 별 MAE 가 oldOSR / OSR 대비 전 영역에서 압도적 → 채택 분기 단순화.
  - **OSR135_TH: 13.5 → 10.0** (10.0+ 면 OSR135 직행). 9.0~10.0 블렌드, < 9.0 baseStar2 유지.
  - **under-blend 분기 제거** — "OSR > OSR135 면 OSR 신뢰" 보정 폐기. OSR135 가 OSR 보다 정확해진 이상 전제 무너짐.
- [modules/calcOhsorryCore.js](modules/calcOhsorryCore.js) — adopt.js fetch 실패 시 inline fallback 도 동일 정리 (`OSR135_TH=10.0`, under-blend 분기 제거, 헤더 주석 갱신).
- 변경 사유는 [ohSorryRating README](../ohSorryRating/README.md#변경-이력) 참고 — zone 별 MAE 표 포함.

### ohsorryShelf v0.0.26 — renderStackbar zasaData 옵션 추가 (오소리 유저 NP 미집계 fix)
- `renderStackbar(charts, gameLevel, opts)` — `opts.zasaData` 받으면 zasa-data.charts 를 base 로 깔고 charts 매칭, 미매칭 zasa 곡은 NP 로 카운트.
- 기존 회귀: 오소리(아케이드) 유저 `charts_json` 은 플레이한 곡만 들어있어, 격자 (`renderShelf`) 는 NP placeholder 가 채워졌으나 하단 stackbar 는 raw charts 로 집계 → NP 0곡으로 잘못 표기되던 문제. INF 유저는 TSV 가 미플레이 곡까지 들고있어 무관.
- API 호환: `opts` 인자 생략 가능 (기존 호출부 그대로 동작).

### rivalOhsorry v3.3.8 — eagateFetch 모듈 load 누락 fix (라이벌 오소리 작동 불가 해소)
- 본체 wrapper 는 v3.3.7 → v3.3.8 갱신 시 `eagateFetch` 모듈 load 가 추가됐는데 [rivalOhsorry.js](modules/rivalOhsorry.js) 는 v3.3.6 그대로 남아 4개 모듈만 load → `Core.compute` 가 eagate fetch 단계에서 `window.OhsorryEagateFetch` 부재로 alert ("eagateFetch 모듈이 로드되지 않았어요. 페이지 새로고침 후 재시도해주세요.") 띄우고 중단되던 회귀 fix.
- 라이벌 wrapper 도 v3.3.8 로 동기화 — `EAGATE_URL` 추가, `dbData` 없을 때만 `eagateFetch` 모듈 load (본체와 동일 패턴). 진행률 박스 단계 4 → 5.

### wrapper v3.3.8 / core v0.0.346 / eagateFetch v0.0.1 — eagate 페이지 fetch 모듈 분리
- 신규 [modules/eagateFetch.js](modules/eagateFetch.js) (`window.OhsorryEagateFetch`) — 기존 core 안의 closure 함수 `parseDoc` / `parseSeriesDoc` / `fetchOneLevel` / `collectByLevel` / `collectBySeries` + 관련 상수 (`STEP` / `MAX_PAGES` / `DELAY_MIN/MAX_MS` / `randomDelay`) + URL 빌드 (`BASE_URL` / `SERIES_URL` / `LEVELS_TO_FETCH`) 를 별도 모듈로 분리. 공개 API: `collectCharts({ fetchMode, levels, series, style, disp, isRival, rivalToken, updateProgress, alertFn })` → `{ ok, charts, pageCount, fetchMode, LEVELS_TO_FETCH }`. closure mutate 대신 결과 return.
- core (v0.0.346) — 약 400 줄의 fetch 영역 제거. 본인 분석 모드 (`!dbData`) 일 때 `window.OhsorryEagateFetch.collectCharts(ctx)` 한 번 호출하고 결과를 `allCharts` / `pageCount` 에 할당. `fetchMode` 변수만 유지 (4.6 단계 series 모드 유령 차트 제거 분기에 사용).
- wrapper (v3.3.8) — `EAGATE_URL` 추가, **`dbData` 없을 때만** `eagateFetch` 모듈 fetch. ohSorryWeb 게스트 페이지 / INFOhSorry 등 DB 모드는 supabase `charts_json` 으로 채우므로 이 모듈을 다운로드하지 않음.
- core 파일 사이즈 ~79KB → ~68KB (-14%). DB 모드 흐름의 모듈 다운로드량 추가 감소.

### core v0.0.345 — DB 모드일 때 OSR/oldOSR/OSR135/adopt 호출·fetch 모두 skip
- 기존엔 `isInfData` (INFOhSorry 가 series='INF' / version='INFv...' 로 올린 데이터) 일 때만 ★ 모델 재실행을 건너뛰고 `dbData.star_estimate` 를 그대로 사용했음. 일반 AC DB 데이터 (= ohSorryWeb 게스트 페이지 유저 카드) 도 supabase 의 `users.star` 가 이미 채택값이라 OSR 다시 돌릴 필요 없음.
- 변경: `if (dbData)` 분기로 확장 — INF/AC 구분 없이 `dbData` 가 있으면 OSR/oldOSR/OSR135/adopt 호출 전부 skip 하고 `dbData.star_estimate` 를 `starEstimate` + `starEstimateNew` (추천 풀 baseStar) 양쪽에 그대로 셋업.
- 추가로 `oldOSR.js` / `osr.js` / `OSR13.5+.js` / `adopt.js` 4개 lib **fetch 자체** 도 `dbData` 있으면 skip — eval 비용 + 다운로드 절감. ohSorryWeb `prefetch.js` 의 `CORE_LIBS` 에서도 4개 제거.
- 추천곡은 그대로 동작 — `ohsorryRecBase = starEstimateNew != null ? starEstimateNew : starEstimate` 이고 starEstimateNew 에 같은 값을 셋업해 기존 흐름 보존.

### wrapper v3.3.7 / render v0.0.346 / db v0.0.403 — supabase 업로드 트리거를 dbConn 으로 흡수
- 기존 `ohsorryRender` 안에 박혀있던 "결과 패널 렌더 직후 `OhsorryDb.upsertUserProfile` + `upsertUserChartScores` 호출 + 결과 로깅" 트리거 흐름을 `dbConn.js` 에 `uploadResult(result, { dbData })` 신규 함수로 흡수. 별도 dbUpload 모듈로 뺄까 검토했지만 둘 다 supabase 라 한 모듈에 두는 게 자연스러움.
- `ohsorryRender.js` 의 supabase upload 블록 21줄 → `window.OhsorryDb.uploadResult(result, { dbData })` 한 줄로 축약. DB 모드 (dbData 있음 = ohSorryWeb 게스트 페이지) 일 때는 dbConn 안에서 자동 skip.
- 부산물: render 가 upsert RPC 함수들을 직접 호출하지 않게 돼서 render 의 관심사가 UI 로 더 좁아짐.

### render v0.0.345 — v0.0.344 revert (상세통계 스택바 램프 색 원복)
- 직전 v0.0.344 의 `lampPalette` shelf `LAMP_BG` 매핑을 되돌림 — 상세통계 스택바는 기존 자체 팔레트 (`fc #00aab2 / exh #ffcc44 / hd #dc3545 / cl #7dd3da / ez #52a447 / as #9966cc / fa #999 / np #e9ecef`) 유지.
- ohSorryWeb 플레이데이터 탭의 색박스는 shelf `LAMP_BG` 재사용 유지 (그쪽은 의도된 design choice).

### render v0.0.344 — 상세통계 스택바 램프 색을 ohsorryShelf `LAMP_BG` 재사용
- 상세통계의 난이도별 클리어 램프 스택바 색 (`lampPalette`) 을 ohsorryShelf v0.0.25 의 `LAMP_BG` 를 통해 가져옴 — shelf 와 동일한 색 (FC 그라데이션 / EX `#dcaf45` / HARD `#e9ecef` / CLEAR `#5cb8ea` / EASY `#7bc16a` / ASSIST `#9966cc` / FAILED `#7a3030` / NP `#3a3a3a`).
- shelf lib 미로드 시는 동일 색으로 fallback (하드코드된 값이 shelf 의 LAMP_BG 와 일치).
- ohSorryWeb 의 유저 카드 플레이데이터 탭과 동일한 single source of truth.

### ohsorryShelf v0.0.25 — `LAMP_BG` export
- 내부 상수 `LAMP_BG` (램프별 배경 색 — FC 그라데이션 등) 을 lib export 에 노출. ohSorryWeb 의 유저 카드 플레이데이터 탭 등에서 동일 램프 색을 재사용하기 위함 (single source of truth).
- 다른 export 변경 없음 — 기존 사용처는 영향 없음.

### ohsorryShelf v0.0.24 — 모바일 meta 줄 등급+컷대비 표기 (B 2229 B+167)
- 모바일 곡 셀 2번째 줄을 `DJ등급 EX스코어 등급+컷대비` 형식으로 — 예: `B 2229 B+167` (B등급, EX 2229, B 등급 컷보다 167점 위).
- `djLevelFromScore` / `djGradeMinEx` 추가 (`max = noteCount*2`, 등급 컷 2/9~8/9 — ohSorryWeb `rankingModal` 과 동일 로직). `djLevelFromScore` 를 lib export 에 노출 — 향후 rankingModal 도 재사용 가능한 단일 출처.
- `noteCount` 있으면 EX 기준으로 등급 재계산 + 컷대비 차이 표시, 없으면 등급만 (`B 2229`).
- `B+167` 부분은 EX스코어보다 작고(`9px`)·어둡게(`#888`). EX스코어 색은 슬롯 색 추종을 제거하고 기본색을 `brightness(0.8)` 로 (곡명보다 한 단계 어둡게) — `.shelf-song.slot-XXX .shelf-song-meta-ex` 셀렉터 제거.

### ohsorry.js / rivalOhsorry.js — eagate 곡 데이터 수집 범위 선택 모달
- 본체·라이벌 wrapper 가 eagate fetch 모드 진입 시 곡 수집 범위를 묻는 모달(`askFetchOptions`) 추가.
  - **레벨별** — 선택한 LEVEL 폴더만 fetch (difficulty.html, 빠름). 기본 11·12 체크.
  - **전곡** — 시리즈 폴더 전체 fetch (series.html, 약 1분).
- `calcOhsorryCore.compute` 에 `fetchMode`(`'level'` | `'series'`) / `levels` 옵션 추가 — 선택 범위만 순회 fetch.
- 라이벌 batch 는 루프 시작 전 1회만 모달을 띄워 모든 라이벌에 공통 적용. DB 모드(`dbData` 있음)는 `charts_json` 을 그대로 쓰므로 모달 생략.

### normTitle.js v0.0.5 — UMD 전환 + norm 규칙 보강
- `window.OhsorryNorm` 단독 → **UMD** 로 전환 — 브라우저(`window.OhsorryNorm`) / Node(`module.exports`) 양쪽 지원. ohSorry / ohSorryAdmin / ohSorryRating 3곳 동일 사본 (마스터: `ohSorry/modules/normTitle.js`, 수정 후 `ohSorryAdmin/scripts/syncNormTitle.js` 로 동기화).
- norm 규칙 보강 — `CROSSROAD ～Left Story～` alias, `§` → `ss` 치환(BLO§OM).

### ohsorryShelf.js — 서열표 lib 을 ohSorryRating 에서 이관 + 네이밍 통일
- `ohsorry-shelf.js` → `ohsorryShelf.js` rename (`modules/` 의 camelCase 규칙 통일) + `ohSorryRating/modules/` → `ohSorry/modules/` 로 이관.
- 서열표 렌더 lib 은 ohSorry 본체·ohSorryWeb 게스트 페이지가 gist fetch 하는 공용 모듈인데, 그동안 곡 난이도 추정 repo(ohSorryRating)에 얹혀 있었음 — gist 배포 주체인 ohSorry 본체로 정리.
- 참조 갱신: `calcOhsorryCore.js` 의 `CALC_SHELF_URL`, ohSorryWeb `config.js`(`SHELF_LIB_URL`)·`prefetch.js`. gist 파일도 `ohsorry-shelf.js` → `ohsorryShelf.js` 로 rename.
- 아래는 이관해 온 ohsorryShelf lib 자체의 버전별 변경 이력 (v0.0.17~v0.0.23, 이관 전 기록).

#### ohsorryShelf v0.0.23 (모바일 곡 셀 2줄 고정)
- 모바일 곡 셀을 항상 2줄 높이로 — `.shelf-song` 에 `min-height: 30px` 추가. 기록이 없어 표시할 게 없는 셀도 2줄 유지.
- EX스코어·DJ레벨이 둘 다 없는 셀에 `.shelf-song-nometa` 클래스 부여 → 빈 meta 줄을 숨기고 곡명을 2줄까지 표시 (`white-space: normal` + `max-height: 2.5em`, 말줄임표 없이 끝 잘림).
- meta 에 항목이 하나라도(EX스코어 또는 DJ레벨) 있으면 기존대로 곡명 1줄 + EX/DJ 1줄.

#### ohsorryShelf v0.0.22 (모바일 EX스코어 색)
- 모바일 곡 셀의 EX스코어(`.shelf-song-meta-ex`)에 곡명과 같은 슬롯 색(NORMAL `#74c0fc` / HYPER `#efef51` / LEGGENDARIA `#ce8ef9` / ANOTHER 기본 `#e9ecef`)을 적용하고 `filter: brightness(0.8)` 로 곡명보다 한 단계 어둡게.
- 슬롯 색 셀렉터(`.shelf-song.slot-XXX .shelf-song-text`)에 `.shelf-song-meta-ex` 를 함께 묶어 곡명과 색을 공유 — PC 에선 `.shelf-song-meta` 가 `display:none` 이라 영향 없음.

#### ohsorryShelf v0.0.21 (모바일 곡명 1줄 · 말줄임 제거)
- 모바일(`≤768px`) 곡 셀의 곡명을 2줄 `-webkit-line-clamp`(말줄임표 …) → **1줄 `white-space: nowrap` + `text-overflow: clip`** 으로 변경. 곡명이 길면 말줄임표 없이 셀 끝에서 그대로 잘림.
- 셀 = 곡명 1줄 + EX스코어/DJ레벨 1줄 = **총 2줄** (v0.0.20 은 곡명이 2줄까지 늘어 최대 3줄이었음).
- 곡명이 단일 줄(`nowrap`)로 돌아가, ohSorryWeb `shelf.js` 의 hover/탭 마퀴가 모바일에서 다시 동작 (v0.0.20 의 line-clamp 에선 사실상 비활성).

#### ohsorryShelf v0.0.20 (모바일 곡 셀 세로 스택 — 곡명 2줄 + EX/DJ 한 줄)
- **모바일(`≤768px`) 곡 셀 레이아웃 개편** — 가로 1줄 → 세로 스택. 3열 격자는 유지하되 셀 내부가 세로로:
  - 곡명 `13px` 로 키우고 **2줄까지 표시 후 `-webkit-line-clamp` 말줄임(…)**. 기존엔 1줄 `nowrap` 이라 글자가 너무 작았음.
  - 세 번째 줄 `.shelf-song-meta` 신설 — **EX스코어(좌) + DJ레벨(우)** 를 양끝 정렬로 동시 표시. PC 우측 오버레이(`.shelf-song-djlv`)는 모바일에서 숨김.
  - lampbox 를 `position: absolute` 좌측 6px 띠로 (세로 flex 에서 가로 전체로 퍼지는 것 방지).
- **PC 동작 불변** — `.shelf-song-meta` 는 기본 `display: none`. PC 는 기존대로 우측 오버레이 1개 + `rightField` 토글 유지.
- **[modules/ohsorryShelf.js](modules/ohsorryShelf.js)** `renderShelf` 셀 HTML 에 `exText`/`dj` 항상 계산 + `.shelf-song-meta` span 추가, `injectStyle` CSS 보강.
- 게스트 페이지 (ohSorryWeb) 가 gist 에서 fetch 해서 사용 — gist (`c3da608...`) 재배포로 즉시 반영.

#### ohsorryShelf v0.0.19 (곡 우측 오버레이 EX 스코어 토글)
- **[modules/ohsorryShelf.js](modules/ohsorryShelf.js)** `renderShelf` 에 `rightField` 옵션 추가 (`'djlv'` | `'exscore'`). `'exscore'` 면 곡 셀 우측 오버레이에 DJ Level 대신 EX SCORE 표시 — 색은 두 경우 모두 해당 DJ Level 색 (`letterColor`).
- 미플레이 (NP) / `exScore` 없는 곡은 EX 모드에서 빈칸.
- 게스트 페이지 (ohSorryWeb) 툴바의 "우측: DJ레벨 ⇄ EX스코어" 토글 버튼이 이 옵션 사용.

#### ohsorryShelf v0.0.18 (모바일 그리드 3열 고정 + 난이도 라벨 sticky)
- **모바일 곡 목록 3열 고정** — `@media (max-width: 600px)` 의 2열 규칙 블록 제거. 600px 이하에서도 `@media (max-width: 768px)` 의 3열 유지.
- **모바일 난이도 라벨 sticky** — `.shelf-level` 에 `position: sticky; top: 0` 추가. sticky containing block 이 부모 `.shelf-group` 이라 각 그룹 곡 목록 범위 안에서만 상단 고정되고, 다음 그룹이 올라오면 자연히 밀려남. 곡 목록이 비치지 않게 `background: #1a1a1a`, `.shelf-song-djlv`(z-index:1) 위로 올리는 `z-index: 3` 보강.
- 게스트 페이지 (ohSorryWeb) 가 gist 에서 fetch 해서 사용 — gist (`c3da608...`) 재배포로 즉시 반영.

#### ohsorryShelf v0.0.17 (stack bar 위치 + bottom margin 제거)
- `.shelf-stackbar` `margin: 16px 0` → `margin: 16px 0 0 0` — bottom margin 제거 (서열표 최상단으로 위치 옮긴 후 legend 와의 간격 정리).
- 게스트 페이지가 이 lib 사용. 다른 사용처는 ohSorry 본체 (`renderChartRow` 만 사용해 stack bar 영향 X).

### render v0.0.343 — 상세통계 DP11 탭 (DP11+ → lv11 전용)
- 상세통계 난이도 선택 토글 `DP11+` (lv11+12) → `DP11` (gameLevel 11 전용) 으로 변경. 요약 표(CLEAR TYPE / DJ LEVEL)와 난이도별 스택바 모두 lv11 곡만 집계.
- `levels` ★ 버킷 하한 `11.6` → `10` — DP12(★11.6~12.7) + DP11(lv11 ★10.2~12.1) 합집합으로 막대를 한 번 그리고, 모드별 곡 수 0 구간은 숨김.
- `computeStats`: `isLv` 비-lv12 모드를 `gameLevel === 11` 로 한정. ereter 데이터는 gameLevel 필드가 없고 전부 lv12 → 분모(`total`) 합산을 `mode === 'lv12'` 일 때만 수행 (lv11 모드 분모에 lv12 가 섞여 NP 가 과다해지던 버그 수정).
- `buildBarRow`: 곡 수 0 행을 초기 렌더부터 `display:none` (DP12 화면에 lv11 전용 빈 행이 노출되지 않게).
- `statsByMode` 키 / 토글 `data-mode` 를 `all` → `lv11` 로 정리.

### core v0.0.346 / render v0.0.342 — 추천곡 "복습곡" 포함 토글 추가
- 추천곡에 복습곡 (클리어 램프는 도달했지만 DJ레벨이 부족한 곡) 을 포함할지 켜고 끄는 토글 추가. 기본값은 제외 (`REC_DJ_MODE_DEFAULT = 'off'`).
- `calcOhsorryCore.js`: `buildPools` / `buildRecs` / `buildExhRecs` 에 `djMode` 인자 추가 — `'off'` 면 램프 도달 곡 (EXH 는 `lampNum >= 6`) 을 후보 풀에서 제외. `__dp_rerollRecs` 4번째 인자로 전달, `recDjModeDefault` 를 result 에 포함.
- `ohsorryRender.js`: '추천 범위' 토글 행에 "복습곡 포함/제외" 체크박스 (`rec-review-toggle`) + `__dp_setRecDjMode` 핸들러 추가.
- `calcOhsorryCore.js`: supabase `chartScoreRows` 필터를 `exScore > 0` → `exScore > 0 || lampNum > 0` 으로 변경 — 점수가 없어도 한 번이라도 플레이해 램프가 붙은 (FAILED 포함) 차트도 업로드 (NO PLAY 만 제외).

### rivalOhsorry.js — 라이벌 오소리 로딩 스피너 추가
- 라이벌 오소리 wrapper 에도 모듈 fetch / 토큰 검색 동안 `#__dp_progress` 로딩 박스 표시 (`ohsorry.js` 의 `showLoadingProgress` 와 동일 구조, 헤더 "라이벌 오소리 로딩 중...").
- 토큰 검색 구간부터 로딩 박스를 띄워 prompt 확인 직후 ~ 모듈 로딩까지 끊김 없이 이어지게 (이게 없으면 모듈 로딩 박스가 토큰 검색 뒤 잠깐만 떴다 사라짐).
- 진행률 토스트에 `box-sizing:border-box` + `max-width:calc(100vw - 32px)` + `word-break` 적용 (모바일 화면 이탈 방지).

### dbConn v0.0.402 — LAMP_MAP 풀네임 alias 추가 (scores.lamp NULL 이슈 해결)
- `calcOhsorryCore.js` 의 `LAMP_NAMES` 가 chart.lamp 에 풀네임 (`'NO PLAY'` / `'FAILED'` / `'EASY'` / `'CLEAR'` / `'HARD'` / `'EX HARD'` / `'FULL COMBO'`) 을 넣는데 `dbConn.js v0.0.401` 의 LAMP_MAP 은 abbreviation 만 매칭 → 매핑 실패 → `scores.lamp` 가 모든 row 에서 NULL.
- LAMP_MAP 에 풀네임 alias 추가. abbreviation + 풀네임 둘 다 받음.
- 본체 재실행 시 `upsert_scores` 가 PK 같으면 lamp 더 좋을 때 자동 갱신 → 이미 올라간 NULL row 들도 자연 backfill.

### render v0.0.341 / wrapper v3.3.6 — 진행률 토스트 모바일 화면 이탈 방지
- `#__dp_progress` 토스트 (`width:280px` + `padding:12px 14px` + `border:1px`) 가 `box-sizing` 미지정으로 실제 렌더 폭이 310px 였음 → 320px 폭 폰에서 `right:16px` 와 합쳐 좌측이 -6px 까지 밀려나가던 문제 해결.
- `box-sizing:border-box` + `max-width:calc(100vw - 32px)` 로 좁은 viewport 에서 자동 축소.
- 내부 텍스트 div 에 `word-break:break-word;overflow-wrap:anywhere` 추가 — 곡명 등 긴 토큰이 박스 밖으로 흘러나가지 않게.
- `ohsorryRender.js` 의 `showProgress` 와 `ohsorry.js` 의 `showLoadingProgress` 양쪽 동일하게 적용.

### render v0.0.340 — 모바일 결과 패널 전체화면 표시
- `#__dp_score_panel` 기본 스타일을 모바일 전체화면으로 변경: `top/right/bottom/left: 0` + `width:100%` + `height:100dvh` (vh fallback), border / border-radius / box-shadow 제거.
- 데스크톱 (`min-width: 768px`) 에서는 기존 우상단 380px 박스 (테두리 / 둥근 모서리 / 그림자 / 92vh) 를 `@media` 로 복원.
- 모바일에서 8px 여백 + max-width 380px 캡 때문에 가로가 넓은 폰에서 우측 정렬된 좁은 박스로 보이던 문제 해결.

### wrapper v3.3.6 — gist 모듈 fetch 동안 로딩 진행률 박스 표시
- `ohsorry.js` 가 4개 모듈 (normTitle / dbConn / render / core) 을 gist 에서 fetch 하는 동안 우상단에 `#__dp_progress` 박스를 띄움 (OhsorryRender 의 진행률 UI 와 동일한 구조 / 위치 / 스타일).
- 헤더 텍스트 "오소리 로딩 중..." + 모듈명 진행 텍스트 + 진행바 (5 / 30 / 55 / 80 / 100 %).
- Core.compute 호출 직후 박스 제거 — 이어서 Core 가 OhsorryRender.showProgress 로 같은 ID 박스를 재생성하므로 시각적으로 자연스럽게 진행률 UI 로 이어짐.

### normTitle v0.0.4 — ereter 'Ø → O' 변형 alias 추가 (ereter-data 매칭 100%)
- `TITLE_ALIASES` 에 `'Xlo' → 'Xlø'`, `'VOID' → 'VØID'` 추가 (ereter 가 textage 의 Ø 를 알파벳 O 로 표기).
- ereter-data 642 unique titles 검증 결과 640/642 → 642/642 (100%) 달성.
- Ø 곡 6개 일괄 검사 결과 ereter 에 있는 건 위 2곡뿐 (나머지 4곡은 level 범위 밖).

### normTitle v0.0.3 — zasa 표기 alias 추가 (zasa-data 매칭 100%)
- `TITLE_ALIASES` 에 `'FiZZλ_PØT!0И' → 'FiZZλ_PØT!OИ'` 추가 (zasa 가 알파벳 'O' 대신 숫자 '0' 사용).
- zasa-data 1575 unique titles 검증 결과 1574/1575 → 1575/1575 (100%) 달성.

### render v0.0.339 — 상세통계 스택드바 색 조정
- `lampPalette.exh`: `#dcaf45` → `#ffcc44` (CLEAR TYPE 바의 EX-HARD 색을 DJ LEVEL 바의 AAA 색과 동일).
- `djPalette.AA`: `#dcaf45` → `#ffaa33` (기존 황금색이 너무 어두워서 노랑 가까운 주황으로 변경).

### db v0.0.401 / normTitle v0.0.2 — 동명이곡 매칭 재설계 (PK 충돌 해결)
- `normTitle.js`: `TITLE_ALIASES` (eagate→textage raw 치환, dbConn 에서 이동) + `NORM_OVERRIDES` (raw 다른 동명이곡 강제 키 분리) + `denorm(k)` (NORM_OVERRIDES reverse) 통합. v0.0.1 → v0.0.2.
- `NORM_OVERRIDES` 4건: `'ZEИITH'→'zenith2'`, `'Shooting Star'→'shootingstar2'`, `'With You'→'withyou2'`, `'take me higher'→'takemehigher2'` (신곡/리메이크 쪽에 `2` suffix).
- `dbConn.js`: songs 캐시를 `Map<normKey, [{ song_id, title, ac }]>` (array) 로 변경. raw 같은 동명이곡 (ADVANCE 295=INF vs 338=AC 등 10건) 은 `pickSongId()` 가 `played_version` + `ac` 비트맵으로 단일 선택.
- 같은 PK `(song_id, iidx_id, diff, played_version)` 중복 row 안전망 dedup — best ex_score / lamp 유지 (PG 21000 "ON CONFLICT cannot affect row a second time" 회피).
- 동명이곡 (다른 song_id) 은 둘 다 별개 row 로 업로드됨 (PK 다름).

### core v0.0.345 — user_profiles.charts_json 제거 + chart_score row 에 lamp 추가
- `calcOhsorryCore.js` 의 `dbPayload.charts_json` → `null`. user_chart_scores 가 single source of truth.
- `chartScoreRows` 빌드에 `lamp` 필드 추가 — 게스트 페이지 서열표가 `get_user_charts` RPC fallback 으로 격자 렌더 가능.
- 효과: user_profiles 의 거대 jsonb (~270KB/user) 디스크 부담 제거. 곡별 랭킹 / 서열표 / ★ 추정 모두 정상 동작 (chart_scores fallback 자동).
- 같은 흐름: INFOhSorry v0.0.44, ohSorryRating 의 ereter backfill 스크립트, 게스트 페이지 shelf.

### db v0.0.337 — 원격 service-status.json kill-switch
- `dbConn.js` 에 `fetchServiceStatus()` 추가 — gist 의 `service-status.json` fetch + 5분 메모리 캐시 + **fail-closed** (fetch 실패 시 disabled).
- `upsertUserProfile` / `upsertUserChartScores` 시작에서 `uploadEnabled` 확인 후 disabled 시 skip.
- 풀 때는 gist (secret `30c3ba6f87df9847291c42ea216a8d2a`) 의 `service-status.json` 만 `uploadEnabled: true` 로 toggle 하면 5분 캐시 만료 후 반영. 코드 / 배포 변경 없음.
- 의도: supabase 자원 한계 / 점검 시 ohSorry / INFOhSorry / 게스트 페이지 의 DB 호출을 한 곳에서 일괄 차단.

### v3.3.6 / core v0.0.344 / render v0.0.338 / db v0.0.336 — 곡별 랭킹 점수 업로드 추가
- `user_chart_scores` RPC(`upsert_user_chart_scores`) 호출 추가. 오소리 실행 시 `ex_score > 0` 인 곡별 `played_version/title/diff/iidx_id/ex_score/dj_level/level` row 를 함께 업로드.
- `played_version` 은 현재 `SERIES` 값(`33` 등)을 사용하고, `level` 은 `ohSorryRating.zasaLevel` 우선 / ereter level fallback 으로 저장.
- INFOhSorry 도 `upsert_user_profile` 성공 후 `played_version='INF'` 로 같은 곡별 점수 row 를 업로드하도록 연결.

### v3.3.6 / core v0.0.343 (repo cleanup) — 내부 4 모듈을 modules/ 로 이동 + archive/ 추적 해제
- 4개 내부 모듈 (`calcOhsorryCore.js` / `ohsorryRender.js` / `dbConn.js` / `rivalOhsorry.js`) 을 [`modules/`](modules/) 폴더로 이동. 진입점 (`2-calc-score.js`, `ohsorry.js`) 은 root 유지.
- gist 푸시는 파일명 기준이라 URL 변동 없음. gist push 명령만 path 가 `modules/<name>` 으로 바뀜.
- [`archive/`](.gitignore) 의 옛 버전 파일 6개 (`-0.0.335.js` 등) 를 `git rm --cached` 로 untrack + `.gitignore` 에 `archive/` 추가. 로컬은 백업으로 유지.

### v3.3.6 / core v0.0.343 / render v0.0.337 — v335E 채택 분기를 adopt.js lib 로 분리
- 신규 [`adopt.js`](https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/adopt.js) (v0.0.1) — group A/B/C 분기 + group C 2-scope max + OSR135 spread gate + under-blend + 12.5~13.5 blend 까지 전부 lib 함수로 분리.
- `calcOhsorryCore.js` 가 부팅 시 adopt.js fetch + eval → `window.adopt` 등록 → 채택 분기에서 `adopt.adoptStar({starOld, starNew, star135, ...})` 호출.
- adopt 로드 실패 시 inline 분기 fallback (이전 코드 유지) — 오프라인 / fetch 실패 안전망.
- 같은 lib 가 INF오소리 (`src/shared/adopt.ts` bundle + override) 와 `recompute-stars-dryrun.js` (Node require) 에서도 호출 → ohSorry / INF오소리 / server-side recompute 3곳 ★ 분기 로직 통일.

### v3.3.6 / core v0.0.342 / render v0.0.337 — OSR135 과소평가 보정 범위 제한
- `OSR > OSR135` 인 13점대 초반~중반 과소평가 케이스에서만 낮은 base 와 제한 블렌드.
- 보정 하한을 `OSR135 >= 13.0` 으로 제한해서 12점대 유저가 같이 과상승하는 케이스 방지.

### v3.3.6 / core v0.0.341 / render v0.0.337 — 추천 범위 기본값 자동 선택
- 최초 렌더 시 추천 기준 실력 점수가 `6` 미만이면 추천 범위 기본값을 `DP11+`, `6` 이상이면 `DP12` 로 선택.
- 사용자가 추천 범위를 직접 바꾼 뒤에는 `ereter | OhSorry` 기준 변경 시에도 해당 선택을 유지.

### v3.3.6 / core v0.0.340 / render v0.0.336 — 추천곡 범위 토글 추가
- 추천곡 기준(`ereter | OhSorry`) 바로 아래에 추천 범위 토글(`DP12 | DP11+`) 추가.
- `DP12` 선택 시 게임 LEVEL 12 차트만 추천 후보로 사용하고, `DP11+` 선택 시 기존처럼 게임 LEVEL 11+12 차트를 추천 후보로 사용.
- 추천곡 기준 변경 / 다시 뽑기 시에도 현재 선택된 추천 범위를 유지.

### v3.3.6 / core v0.0.339 — 추천곡 DJ Level 미도달 0점 제외
- 이미 해당 stage 램프를 취득한 DJ Level 미도달 후보라도 EX 점수가 `0`이면 추천곡에서 제외.
- EASY/HC 공통 추천과 EX-HARD 전용 추천 모두에 적용.
- `calcOhsorryCore.js` 버전 `0.0.339` 로 갱신.

### v3.3.6 / core v0.0.338 — 추천곡 DJ Level 미도달 후보 램프 범위 보정
- EASY 추천: `EC/NC` 이지만 DJ Level `A` 미도달인 곡만 도달DJ미도달 후보로 포함하고, `HC/EX/FC/PFC` 는 제외.
- HARD 추천: `HC` 이지만 DJ Level `AA` 미도달인 곡만 도달DJ미도달 후보로 포함하고, `EX/FC/PFC` 는 제외.
- EX-HARD 추천: `EX/FC/PFC` 여도 DJ Level `AAA` 미도달이면 후보에 포함.
- `calcOhsorryCore.js` 버전 `0.0.338` 로 갱신.

### v3.3.6 / core v0.0.337 — 추천곡 미도달:도달 5:5 비율 + 분류 보장
- `buildPools`: hard / easy / cleanup 3분류 → `{ underLamp, reached }` 카테고리 구조. `underLamp = lampNum < threshold` / `reached = lampNum >= threshold && !accuracyOK`
- cleared 곡도 dv (난이도) 기준으로 hard / easy / cleanup 분류 (이전엔 cleared → 무조건 cleanup)
- `buildRecs`: 카테고리당 sample 15 (= 미도달 15 + 도달 15 = 30개 풀). 추출 분포 hard 2 (under 1 + reach 1) / easy 4 (2+2) / cleanup 4 (2+2)
- fallback 3단계: 슬롯 primary → 같은 분류의 반대 카테고리 → 전체 30개 풀 (분류 무관)
- 동기 변경: `archive/calcOhsorryCore-0.0.336.js` 신규 (0.0.336 시점 backup)

### v3.3.6 / core v0.0.336 — 곡명 정규화 Æ → a (ÆTHER 매칭)
- `calcOhsorryCore.js` 의 norm 함수에서 `Æ`/`æ` 매핑을 `ae` → `a` 로 변경
- 클라이언트가 `&AElig;` HTML entity decode 실패해서 `ÆTHER` 를 `ATHER` 로 보내는 케이스 호환 — zasa 의 `ÆTHER` (lv11 ANOTHER / lv12.1 LEGGENDARIA) 정상 매칭
- 다른 단어에 `ATHER` 부분문자열 들어있어도 충돌 X (norm 전체 key 완전 일치만 매칭)
- 동기 변경: `ohSorryRating` 의 4 lib (oldOSR / osr / OSR13.5+ / ohsorry-shelf) 및 `INFOhSorry/src/shared/match.ts` 도 동일 매핑 적용

### v3.3.6 / core v0.0.335 — 모듈 분리
- 단일 `2-calc-score.js` (~2230줄) 를 5개 모듈로 분리: `calcOhsorryCore.js` (계산) / `ohsorryRender.js` (UI) / `dbConn.js` (DB) / `ohsorry.js` (본체 wrapper) / `rivalOhsorry.js` (라이벌 wrapper)
- 기존 `2-calc-score.js` 는 호환 redirect (`ohsorry.js` fetch + eval) 로 축소 — 콘솔/북마크렛 URL 그대로 사용 가능
- 함수명 `__dp_render = run(...)` → `OhsorryCore.compute(opts)` 로 정리, core 가 `result` 객체 반환 / `Render.show(result)` 호출 / `OhsorryDb.upsertUserProfile()` 사용
- supabase `version` 컬럼이 `'v3.3.5'` 단일 → `'v3.3.6-core335'` 형태로 wrapper+core 버전 병행 표기

### v3.3.6 — supabase user_profiles PK 확장
- PK 가 `iidx_id` 단일 → `(iidx_id, series)` composite — 같은 IIDX ID 라도 시즌이 다르면 새 row (옛 시즌 데이터 보존)
- RPC `upsert_user_profile` 의 `ON CONFLICT` 도 `(iidx_id, series)` 로 변경 + `last_updated_at = now()` 갱신 추가
- RPC `get_user_profile_full` 는 같은 iidx_id 의 다중 시즌 row 중 `last_updated_at` 최신 1건 반환 (호환성 유지)
- 동기: 다음 시즌 (34+) 출시 시 클라이언트의 `SERIES` 상수만 바꿔서 배포하면 자동으로 새 row 분기 — 옛 시즌 데이터 덮어쓰지 않음

### v3.3.6 — 라이벌 오소리 (`rivalOhsorry.js`)
- eagate IIDX 라이벌 페이지 (`difficulty_rival.html?rival=<토큰>`) 에서 자동 실행 — URL 토큰 추출, 라이벌의 차트 데이터 fetch 후 ★ 추정 + supabase 업로드
- IIDX ID (8자리) → 토큰 검색 (`rival_search.html` POST) → batch 처리: `__dp_batch_rival_by_iidx('1511-6402, 1234-5678, ...')` 형태로 여러 명 한꺼번에
- 본체 (`ohsorry.js`) 와 같은 core / render / db 모듈 공유 — 차이는 wrapper 의 `mode:'rival'` 인자 + 라이벌 토큰

### v3.3.5 / v335E (옛 단일 파일 시점)
- OSR13.5+ 분기 도입 (★13.5 이상 정확도 핵심), 1021명 검증 MAE 0.363
- v335E 채택 분기: OSR135 세 분기 (EC/HC/EXH) spread > 2.5 면 baseStar2 직행, 12.5~13.5 블렌드, gap_guard 등
- 외부 lib 3종 (`oldOSR.js` v3.3.3 / `osr.js` v0.0.2 / `OSR13.5+.js`) 으로 분리
- (이 시점 단일 파일은 `logic/2-calc-score-3.3.5.js` 에 아카이브)

---

## 면책

ereter.net 의 데이터를 사용했습니다. 이레터님의 허락을 받지 않았습니다. 재미로만 이용해주세요.
