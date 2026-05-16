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

| 파일 | 버전 | 줄수 | 역할 |
|---|---|---|---|
| `ohsorry.js` | v3.3.6 | ~54 | **본체 wrapper** — eagate 도메인 자동 실행. core/render/db 셋 다 fetch+eval 한 뒤 `Core.compute({mode:'own'})` 호출. `window.__dp_render(dbData)` 노출 (DB 모드). |
| `rivalOhsorry.js` | v3.3.6 | ~112 | **라이벌 wrapper** — 라이벌 페이지 (difficulty_rival.html?rival=&lt;토큰&gt;) 자동 실행. `__dp_fetch_rival_token` / `__dp_batch_rival_by_iidx` 헬퍼 + `Core.compute({mode:'rival'})`. IIDX ID prompt → 토큰 검색 → batch 흐름. |
| `calcOhsorryCore.js` | v0.0.335 | ~1366 | **계산 core** — ereter / zasa / textage / ohSorryRating + 외부 lib (oldOSR / OSR / OSR135) fetch + 캐시, difficulty.html 페이지 순회 fetch, parseDoc, ★ 추정 (v335E 채택 분기), 추천곡 계산, 프로필 fetch. 결과 객체 (`result`) 를 반환하고 `Render.show(result)` 호출. DOM 안 만짐 (UI 는 render). |
| `ohsorryRender.js` | v0.0.335 | ~854 | **UI render** — 진행률 UI (`showProgress`/`hideProgress`), 결과 패널 (프로필 / ★ / 노트레이더 / 추천곡 sortable / 상세통계), `__dp_rerun` / `__dp_confirmRerun` / `__dp_toggleRadar` 등. core 의 `result` 객체 받아서 표시 + `OhsorryDb.upsertUserProfile` 호출. |
| `dbConn.js` | v0.0.335 | ~73 | **supabase 통신** — `upsertUserProfile(payload)` / `fetchUserProfile(iidxId)` 두 RPC 호출만 담당. SUPABASE_URL / SUPABASE_KEY 캡슐화. |
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
