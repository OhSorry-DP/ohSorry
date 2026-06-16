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

각 단계 10곡. **`_clearScore` 가중합 기반 정렬** + cleanup 다양성 보정 + slot 분배 흐름.

#### 1단계 — 풀 생성 (stage 별 ★ 범위)

각 차트의 "그 stage 추정 ★" 값 (dv) 으로 4 풀로 분류. **effectiveBase + d 기반**:

| stage | effectiveBase (eb) | 정리 (cleanup) | 약도전 (easy) | 강도전 (hard) | 풀 제외 |
|---|---|---|---|---|---|
| EC | baseStar − 0.5 | dv ∈ [0, eb) | dv ∈ [eb, eb + 0.7d) | dv ∈ [eb + 0.7d, topClearStar + 0.3d] | dv > 강도전 상한 |
| HC | baseStar | 동일 | 동일 | 동일 | 동일 |
| EXH | baseStar + 2 | dv ∈ [0, eb) | (없음) | (없음) | dv ≥ eb |

- **baseStar** — 사용자 ★ 추정값 (ohSorry 또는 ereter 모드 토글로 전환).
- **topClearStar** — 그 stage 를 이미 클리어한 차트의 추정 ★ 최댓값.
- **d** = `max(0, topClearStar − effectiveBase)` — 클리어 영역 폭. d=0 (effectiveBase 이상 클리어 X) 이면 약/강도전 한 점으로 수렴 → 대부분 정리곡.
- **EXH 는 정리곡만** — 점수 도전 stage 이므로 약/강도전 없이 cleanup 만.

각 풀은 다시 **underLamp** (램프 미달) 와 **reached** (램프 도달 + DJ레벨 미달 = 복습곡) 로 분리.

#### 2단계 — `_clearScore` 계산 (각 차트별)

차트마다 8 component 가중합:

| component | 가중치 | 정의 |
|---|---|---|
| diffFit | 0.24 | ★ 거리 적합도 — 1 − \|dv − baseStar\| / 2.4 (EXH 는 3.2) |
| lampFit | 0.18 | 램프 도달 거리 — 도달 0.74 / 미달은 gap 기반 |
| rateFit | 0.18 | 정확도 fit — EC 74% / HC 82% / EXH 89% 기준 width 12~14 |
| countFit | 0.14 | 클리어 인구수 (log 정규화) |
| layoutFit | 0.14 | 8 배치 best 매치 점수 적합도 (배치추천 ON 일 때만 의미) |
| layoutGainFit | 0.06 | 정규 대비 best 배치 이득 (mirror/flip 효과) |
| djFit | 0.06 | 현재 DJ 레벨 적합도 (AAA=1, AA=0.84, A=0.68, ...) |
| categoryBoost | (±) | cleanup +0.10 / easy +0.04 / hard −0.03 |

차트마다 추가로 **`_clearType`** 분류 (UI 해시태그 표시):
- `#한끗` (near-lamp) — 램프 1칸 미달 또는 점수 stage target − 2 이내
- `#점수도전` (score-ready) — 점수 stage target − 5 이내
- `#검증곡` (popular) — 클리어 인구수 약 63명 이상 (= 안전한 도전, 무리한 곡 X)
- `#적합` (fit) — 그 외

#### 3단계 — sample15 + cleanup 50/50 보정

각 cat (underLamp / reached) 의 hard + easy + cleanup 합쳐서 **`_clearScore` desc top 15** 뽑음. 그 다음:

- top 15 안의 cleanup 분류 곡 중 `_clearScore` 낮은 절반을 잘라냄.
- cleanup 풀 전체에서 dv asc (= 가장 쉬운 정리곡) 으로 같은 수만큼 교체.
- 효과 — "사용자에게 잘 맞는 cleanup" + "그냥 쉬운 cleanup" 둘 다 노출, 한쪽 편향 방지.

정렬은 8 배치 evaluator 가 있을 때 sortByBest (`_clearScore` → countField → diffValue), 옛 gist fallback 은 sortByMatch (`chartStrengthMatch` 도 같이), userVec 자체 없을 때는 클리어 인구수 desc.

#### 4단계 — 최종 10곡 추출 (slot 분배)

underLamp 우선, 복습곡 (reached) 은 djMode='on' 일 때만 2곡 섞음:

| stage | djMode off (underTarget 10) | djMode on (underTarget 8 + reached 2) |
|---|---|---|
| EC / HC | cleanup 4 + easy 4 + hard 2 | cleanup 3 + easy 3 + hard 2 + reached 2 |
| EXH | cleanup 8 + easy 1 + hard 1 | cleanup 6 + easy 1 + hard 1 + reached 2 |

- **slot 부족 시 보충 순서**: 각 slot → underAll (cat 무관) → reachedAll → underSample + reachedSample 전체.
- 한 cat 안에서는 `_clearScore` desc 로 선택.

**low 모드** (DP11- 토글, 게임 lv8~10 중심):
- gameLevel 별 균등 분배 (예: lv8/9/10 각 3곡) + lv12 1곡 (있으면 도전용) + 부족분 보충.
- 신규 유저 / ★ 추정 안 되는 유저에게 진입 부담 적은 추천.

#### 미클리어 정의 (stage 별 lamp threshold)

- EASY 추천: lamp < EC (NO PLAY / FAILED / ASSIST)
- HARD 추천: lamp < HC (위 + EASY / CLEAR)
- EX-HARD 추천: lamp < EX-HARD (위 + HARD)

#### 토글 / 옵션

- **추천곡 기준** (ereter 데이터 매핑 있을 때만): `ereter ★` ↔ `OhSorry ★` 클릭 전환. baseStar 가 바뀌어 전체 추천 자동 재계산.
- **DP12 / DP11+ / DP11-**: 추천 풀 게임 레벨 필터.
  - **DP12** — 게임 레벨 12 차트만
  - **DP11+** (기본) — lv11 + lv12
  - **DP11-** — low 모드 (게임 lv8~10 중심, 신규 유저용)
- **복습곡 포함 / 제외**: 램프 도달 + DJ레벨 미달 (= reached) 포함 토글.
- **배치추천 ON / OFF**: 8 배치 평가 ON/OFF. 자세히는 아래 [2-1 섹션](#2-1-배치추천-8-배치-평가).
- **↻ 다시 뽑기**: 각 단계 헤더 버튼 — 그 단계만 재계산 후 부분 갱신.

#### 차트 표시

- **prefix (게임 LEVEL)** — 모든 차트에 `12A`, `11H` 등 표시.
- **chart letter 색**: H (HYPER) 연한 금 / A (ANOTHER) 연한 빨강 / L (LEGGENDARIA) 연한 마젠타.
- **곡명 색** — ereter 미등록 + ohSorryRating only 차트 한정 (lv11 초록 / lv12 하늘) + tooltip "ohSorry 추정 ★, ereter 미등록". ereter 등록 차트는 기본색.
- **배치 배지** (핑크) — 8 배치 best 가 정규 (N/N) 아닐 때 옆에 표시 (예: `M/-`, `F`).

### 2-1. 배치추천 (8 배치 평가)

추천곡 row 옆 핑크 배지 (예: `M/-`, `F`, `M/M`) 가 그 차트의 **best 배치**. 클리어 추천 + 연습곡 모두 8 배치 (mirror × flip 조합) 를 평가해서 사용자의 손별 강점에 가장 잘 맞는 배치를 골라줍니다.

#### 8 배치 정의

| 배지 | 의미 |
|---|---|
| (빈칸) | 정규 (N/N) — 양손 그대로 |
| `M/-` | 왼손만 mirror |
| `-/M` | 오른손만 mirror |
| `M/M` | 양손 mirror (쌍미러) |
| `F` | flip — 양손 패턴 swap (왼손이 2P 패턴, 오른손이 1P 패턴) |
| `F M/-`, `F -/M`, `F M/M` | flip + 각 mirror 조합 |

- **mirror (M)**: 한 손의 키 1↔7, 2↔6, 3↔5 swap (4 고정). 가까운 키와 먼 키 위치가 뒤집힘.
- **flip (F)**: 1P 차트와 2P 차트를 양손이 서로 바꿔 침.

#### 각 배치의 점수 계산

각 배치마다 양손 strength score 를 따로 산출 후 합산:

```
strength_raw = (vecL · pt_L + vec.*_L · m1_metric)   ← 왼손
             + (vecR · pt_R + vec.*_R · m2_metric)   ← 오른손
total        = strength_raw − misfinger_penalty
```

- **vecL / vecR** — 유저의 손별 강점/약점 벡터 (28 차원).
  - **mirror-invariant 10 feature**: `NOTES`, `CHORD`, `PEAK`, `CHARGE`, `SCRATCH`, `SOF-LAN`, `PHRASE`, `JACK`, `TRILL`, `RAND`.
  - **mirror dim 18**: `STAIR_UP_L/R`, `STAIR_DN_L/R`, `K1_L/R` ~ `K7_L/R`. 한 손 내 키 swap 으로 변하는 metric (textage stat 기반).
  - 잔차 분석 — 차트별 (rate − bucket 평균) 을 그 차트의 feature pt 로 가중평균. 양수 = 강점 / 음수 = 약점.
- **pt_L / pt_R** — 차트의 손별 feature pt (textage stat → 환산). mirror 적용 시 mirror 변환된 m1/m2 metric (STAIR_UP↔DN, K1↔K7 swap) 사용.
- **dot product** — vec 와 pt 의 같은 dim 끼리 곱한 후 합. 강점 feature 에 pt 큰 차트 = 매칭 강함 → strength 큼.

#### misfinger (무리배치) penalty

각 배치마다 무리배치 카운트 × 가중치를 strength 에서 차감. **스크래치 + 손가락 새끼 영역 동시발생** 을 무리배치로 봅니다.

**측정** — patterns-all-slim 의 `MISFINGER` 컬럼 (ohSorryRating 의 textage stat 기반, 300ms threshold):
- **k12** — 스크 + K1/K2 가 300ms 이내 동시 발생 카운트
- **k67** — 스크 + K6/K7 가 300ms 이내 동시 발생 카운트
- **rand** — 스크 ±300ms 안에 같은 손이 K1~K7 중 distinct 4 키 이상 (= 흩뿌린 + 스크 = 새끼 따로 + 엄지 스크)

**손 / mirror 조합 별 무리배치 선택**:

| 손 | mirror | 무리배치 metric | 이유 |
|---|---|---|---|
| 왼손 | no | k67 | 1P 키보드는 스크가 왼쪽 → K6/K7 가 새끼 영역 (멀리) |
| 왼손 | yes | k12 | mirror 후 K1/K2 위치가 새끼 영역 |
| 오른손 | no | k12 | 2P 키보드는 스크가 오른쪽 → K1/K2 가 새끼 영역 |
| 오른손 | yes | k67 | mirror 후 K6/K7 위치가 새끼 영역 |

- `rand` 는 mirror invariant — 모든 배치에 동일 적용.
- **flip 영향 없음** — flip 은 어느 손이 어느 패턴 (m1/m2) 을 잡는지만 바꿀 뿐, 손가락 매핑 (왼손=스크 왼쪽 / 오른손=스크 오른쪽) 은 키보드 기준 고정.

**가중치** — k12/k67 × 0.5, rand × 0.15 (강도 순서 k12/k67 > rand). 예: WHA DP_ANO 의 m1.k67=145, m2.k12=231, m1.rand=49, m2.rand=77 → 정규 (N/N) penalty = `(145 + 231) × 0.5 + (49 + 77) × 0.15 ≈ 207`.

#### best 배치 선택 + 추천 정렬 영향

- 각 차트마다 8 배치 result 중 **`total = strength_raw − penalty` 가 max** 인 배치가 best.
- best 배치의 라벨 (예: `M/-`) 이 추천곡 row 옆 핑크 배지로 표시. 정규 (N/N) 이면 배지 없음.
- **추천 정렬 자체에 영향**:
  - 무리배치 많은 차트는 best 배치도 penalty 큰 → strength 낮음 → 추천 후순위로 자연 강등.
  - 약점 보완 추천 (`chartWeaknessMatch8Way`) 에서도 동일 — `bestTotal = −strengthRaw − penalty` 라 무리배치 차트는 약점 보완 정렬에서도 후순위.
  - 예: WHA / CODE:Ø / Like+it! 같은 무리배치 끝판왕 차트는 자동 후순위. 그래도 best 배치를 고르면 무리배치가 덜한 쪽 (예: WHA → `−/M` 오른손만 mirror) 이 선택돼서 그나마 칠 만함.

#### 토글 ON / OFF

추천곡 헤더의 토글 (복습곡 토글 옆):
- **배치추천 ON** (기본) — 8 배치 평가 + misfinger penalty 자동 반영. 사용자에게 가장 잘 맞는 배치 / 무리배치 적은 차트 우선.
- **배치추천 OFF** — 정규 N/N 강제 (mirror / flip 비교 안 함, penalty 도 없음). "그냥 정규 배치로 친다" 가정한 추천 정렬.

연습곡 추천에도 동일한 동작 — UI 만 다름 (연습곡은 별도 컨트롤 행 안의 `배치추천` 칩).

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
2. `1-fetch-ereter.js` 실행 (레포에서 아카이브됨 → `D:\work\dpdata\oldOhSorry\1-fetch-ereter.js`. 수집 정본은 ohSorryRating)
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

## 개발 · 상세 문서

파일 구조 · 모듈 구조 · 별값/추천 알고리즘 · 데이터 갱신 절차 등 상세는 [docs/](docs/README.md) 참고:
- [architecture.md](docs/architecture.md) — 로딩 구조 · compute 실행 흐름
- [modules.md](docs/modules.md) — 모듈별 책임 · API
- [algorithms.md](docs/algorithms.md) — 별값 추정 · 추천 · 약점 분석 알고리즘
- [data-pipeline.md](docs/data-pipeline.md) — 데이터 수집 스크립트 · gist 배포 · 데이터 형식

---

## 변경 이력

전체 변경 이력은 [CHANGELOG.md](CHANGELOG.md) 를 참고하세요.

## 면책

ereter.net 의 데이터를 사용했습니다. 이레터님의 허락을 받지 않았습니다. 재미로만 이용해주세요.
