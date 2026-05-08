# 짭레터넷 (IIDX DP 12 점수 / 추천 계산기)

ereter.net 의 ☆12 난이도 분석 데이터를 e-amusement 의 DP 플레이 데이터에 매칭해서 **★값 추정 + 추천곡 + 통계** 를 보여줍니다.

평소 사용은 **PC 콘솔 한 줄** 또는 **모바일 북마크렛 한 번 탭** 으로 끝.

---

## 평소 사용법

### PC (데스크톱 브라우저)

p.eagate.573.jp 어느 페이지에서나 (메인페이지, 마이페이지 등) F12 → Console → 아래 한 줄 붙여넣기:

```javascript
fetch('https://gist.githubusercontent.com/hanekawa4365/c3da608194c44f431abd2f1a7a4a9f5e/raw/2-calc-score.js?t='+Date.now()).then(r=>r.text()).then(eval)
```

진행 상황 패널이 우상단에 뜨고, 약 20~30초 후 결과가 표시됩니다.

> URL 끝의 `?t=` 부분은 Gist 캐시 우회용입니다. 그냥 같이 붙여넣으세요.

### 모바일 (북마크렛)

모바일 브라우저는 콘솔이 없어서 **북마크렛** 으로 실행합니다. 한 번만 등록해두면 그 후로는 북마크 한 번 탭으로 끝.

**1단계: 북마크 등록**

아무 페이지나 북마크에 추가한 뒤, 북마크 편집해서 **URL 부분을 아래 코드로 교체**:

```
javascript:fetch('https://gist.githubusercontent.com/hanekawa4365/c3da608194c44f431abd2f1a7a4a9f5e/raw/2-calc-score.js?t='+Date.now()).then(r=>r.text()).then(eval)
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
각 단계별 최대 10곡, 매번 랜덤 선정:

- **기본 (★ ≥ 2.0)**: 도전 6 / 정리 4
  - 도전 풀: 미클리어 곡 중 자기 ★ ~ ★+0.8
  - 정리 풀: 미클리어 곡 중 자기 ★ 이하
- **저레벨 (★ < 2.0)**: 정리 7 / 도전 3
  - 도전 풀이 빈약하기 쉬워서 정리 위주로
- 한쪽이 부족하면 다른 쪽에서 채워서 최대 10곡

미클리어 정의는 단계별로 다름:
- EASY 추천: lamp < EC (NO PLAY/FAILED/ASSIST)
- HARD 추천: lamp < HC (위 + EASY/CLEAR)
- EX-HARD 추천: lamp < EX-HARD (위 + HARD)

각 영역(도전/정리) 안에서 ★ 높은 순으로 정렬되어 표시.

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

---

## ★값 추정 원리 (v3.2.1)

### 모델 구조

**v3.1.1 의 stage1 logistic + v3.2 의 robust feature 통합** 한 2단계 Ridge 회귀 모델. 우리 자체 수집한 104명 사용자 데이터 (lv12 lamp 기준) 로 학습.

**1단계: stage 별 logistic 모델 (raw_s 추정)**

P(clear | S, d, stage) = 1 / (1 + exp( α_s(S) × (d − S) ))

- α_s(S) = a0_s + a1_s · S + a2_s · S²   (사용자 S 의 2차 함수)
- 학습 input 형식 = 실전 input 형식 (lv12 lamp): lamp ≥ 3=EC, ≥ 5=HC, ≥ 6=EXH

stage 별 α 계수 (a0, a1, a2):
- EC  : α(S) = 194.445153 +  41.489739·S +  6.085698·S²
- HC  : α(S) = 119.451394 + 295.165202·S − 20.796304·S² (× 2 적용)
- EXH : α(S) =   2.722775 +   0.444754·S +  3.689284·S²

α 값이 큰 이유는 binary input 에 대해 sigmoid 가 step function 에 가까운 형태로 fit 되기 때문. 수치 안정성을 위해 z = α(d − S) 를 ±50 범위로 clamp.

raw_s 는 **0.01 step grid search + golden-section refinement** 로 negative log-likelihood 최소화.

**안전 규칙:**
- 한 lamp 에서 클리어한 곡이 10 미만이면 그 lamp 의 base feature 6개 = 0
- 모든 lamp 에서 클리어 < 10 이면 → ★ 0.5 (저렙 fallback)
- raw_s 의 grid 상한 14.50: ☆12 곡 데이터로는 ★14.5 이상 영역의 정밀 분리가 어려워 cap

**2단계: 36-feature Ridge 회귀 보정 (raw → final)**

final = raw_s + Σ coef_i × feature_i (intercept 포함)

| 그룹 | feature 수 | 내용 |
|---|---|---|
| Base (raw_s) | 3 | intercept, raw_s, raw_s² |
| Stage 별 분포 (×3) | 18 | 각 lamp 마다 6개 (max_d_clear, min_d_fail, p50_d_clear, frac_clear, fail_below, clear_above) |
| AC/FC (v3.1) | 8 | ASSIST 이상 / FULL COMBO 곡 통계 |
| v3.2 robust | 7 | M, M_top10_avg, gap_top10, gap × is_ec/hc/exh, prob_sum |
| **합계** | **36** | |

v3.2 추가 7개 feature 의 의미:
- **M**: 사용자 도달 stage 의 max ★ (lamp ≥ 6 → exh, =5 → hc, 3-4 → ec)
- **M_top10_avg**: cleared 곡 top 1~10 의 평균 (robust max estimator)
- **gap_top10**: M − top10 (M 이 outlier 인지의 신호 — 클수록 운빨)
- **gap × is_ec/hc/exh**: M 의 stage 별 차등 페널티 (interaction)
- **prob_sum**: S_hat = M_top10_avg 기준 sigmoid prob > 0.99 제외한 failed 곡들의 페널티 합

Ridge 회귀의 정규화 강도 α = 5.0.

전체 계수 표는 `2-calc-score.js` 의 `RIDGE_COEF` 배열 참고.

### 정확도 (LOOCV)

**cutoff = n_cleared ≥ 50** (학습 데이터에 포함될 사용자의 최소 12렙 cleared 곡 수). 이 미만인 사용자는 통계 신뢰도 부족으로 학습/평가 X.

| 지표 | 값 |
|---|---|
| 학습 데이터 | 86명 (cutoff 통과) |
| **LOOCV 평균 \|err\|** | **0.1989** |
| LOOCV 중간값 | 0.1519 |
| LOOCV 최대 | 1.2657 |
| LOOCV RMSE | 0.2941 |

LOOCV 분포:
- ≤0.05 ★ : 18 / 86 (20.9%)
- ≤0.10 ★ : 27 / 86 (31.4%)
- ≤0.30 ★ : 74 / 86 (86.0%)

**핵심 사용자 결과:**
- A.OUT (★11.14): pred 11.17 (오차 +0.03)
- SILENT (★14.54): pred 14.52 (오차 +0.02)
- GROM (★4.96): pred 4.81 (오차 -0.15)
- POCHI (★10.41): pred 9.14 (오차 -1.27, 시도 수 적은 outlier)

남은 약점은 **★1~5 영역 + 시도 곡 수가 적은 사용자**. 이 영역은 lamp 만으로는 추정 불가능하고 ereter 가 다른 정보 (시도 횟수 normalize 등) 를 활용하는 듯하지만 우리 데이터로는 reverse-engineer 불가능.

### 데이터 범위

- ☆11.6 ~ ☆12.7 모든 곡 (이레터넷 페이지 기준 공식 ☆12 전체)
- NO PLAY (lamp 0) 곡은 Stage 1 에서 제외
- 표본 (★값 추정용 fitData) 30개 미만이면 추정 X

### v3.0.3 → v3.2.1 변경 요약

| 항목 | v3.0.3 | v3.1 | v3.1.1 | v3.2 | v3.2.1 |
|---|---|---|---|---|---|
| 학습 데이터 | 103명 (ereter prob) | 104명 (lv12 lamp) | 동일 | 동일 | 동일 |
| 학습 input 형식 | binary clear (ereter prob ≥ 50%) | lv12 lamp | 동일 | 동일 | 동일 |
| Stage 1 alpha (HC) | × 2 | × 1 | × 2 | × 1 | × 2 |
| Stage 2 feature 수 | 21 | 29 (+ AC/FC) | 29 | 11 (단일 모델) | 36 (통합) |
| Stage 2 ridge α | 0.5 | 5.0 | 5.0 | 10.0 | 5.0 |
| cutoff (n_cleared) | 없음 | 없음 | 없음 | 없음 | **≥ 50** |
| Golden-section | X | O | O | O | O |
| Invalid lamp = 0 | O | O | O | O | O |
| LOOCV 평균 \|err\| (우리 데이터) | 0.5393 | 0.2829 | 0.2917 | 0.378 | **0.1989** |

이전 버전들 (v3.0.x ~ v3.2) 의 코드는 [logic/](logic/) 폴더에 archive.

---

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
   fetch('https://gist.githubusercontent.com/hanekawa4365/c3da608194c44f431abd2f1a7a4a9f5e/raw/1-fetch-ereter.js?t='+Date.now()).then(r=>r.text()).then(eval)
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

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `1-fetch-ereter.js` | ereter.net 에서 ☆12 난이도 + 사용자 ★ 데이터 추출 (관리자용) |
| `2-calc-score.js` | e-amusement 콘솔에서 실행, ★값 추정 + UI 표시 (메인) |
| `3-fetch-lv12-batch.js` | lv12 사용자별 batch 수집 (학습 데이터 보강용) |
| `ereter-data.json` | ereter.net 추출 데이터 (관리자가 갱신) |
| `dataset.json` | 학습용 통합 데이터셋 |
| `index.html` | 사용 안내 정적 페이지 |
| `readme-page.js` | 사용 안내 페이지 렌더링 |
| `README.md` | 이 문서 |
| [`logic/`](logic/) | 모델 archive (v3.0.2 ~ v3.2.1 + params JSON) |

학습 데이터는 [`source/`](source/) (combined 페이지) 와 [`source_lv12/`](source_lv12/) (lv12 페이지) 에 사용자 ID 별로 저장.

---

## URL 모음

### Gist Raw URLs

```
1-fetch-ereter.js:
https://gist.githubusercontent.com/hanekawa4365/c3da608194c44f431abd2f1a7a4a9f5e/raw/1-fetch-ereter.js

2-calc-score.js:
https://gist.githubusercontent.com/hanekawa4365/c3da608194c44f431abd2f1a7a4a9f5e/raw/2-calc-score.js

ereter-data.json:
https://gist.githubusercontent.com/hanekawa4365/c3da608194c44f431abd2f1a7a4a9f5e/raw/ereter-data.json
```

캐시 우회는 URL 뒤에 `?t=` + Date.now() 붙이면 됨.

---

## 면책

ereter.net 의 데이터를 사용했습니다. 이레터님의 허락을 받지 않았습니다. 재미로만 이용해주세요.
