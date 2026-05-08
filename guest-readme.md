# DP 리커멘드 점수 계산기 / 추천곡 자판기

IIDX DP 12 클리어 램프로 **★값 추정 + 추천곡 + 통계** 를 보여주는 도구입니다.

ereter.net 의 ☆12 난이도 분석을 기반으로 동작합니다.

> ⚠️ 이레터님의 허락을 받지 않고 데이터를 사용했습니다. 재미로만 이용해주세요.

---

## 사용법

### 💻 PC 에서

1. [p.eagate.573.jp](https://p.eagate.573.jp) 로그인
2. 아무 페이지에서 **F12** 누르고 **Console** 탭 열기
3. 아래 한 줄을 복사해서 붙여넣고 **Enter**

```javascript
fetch('https://gist.githubusercontent.com/hanekawa4365/c3da608194c44f431abd2f1a7a4a9f5e/raw/2-calc-score.js?t='+Date.now()).then(r=>r.text()).then(eval)
```

진행 상황 패널이 우상단에 뜨고, 약 20~30초 후 결과가 표시됩니다.

### 📱 모바일에서 (북마크렛)

**1단계**: 아무 페이지나 북마크에 추가하고, 북마크 편집해서 **URL 부분을 아래 코드로 교체**:

```
javascript:fetch('https://gist.githubusercontent.com/hanekawa4365/c3da608194c44f431abd2f1a7a4a9f5e/raw/2-calc-score.js?t='+Date.now()).then(r=>r.text()).then(eval)
```

이름은 알아보기 좋게 `짭레터넷` 으로 변경.

**2단계**: p.eagate.573.jp 로그인 후 아무 페이지에서

- 주소창에 북마크 이름 (또는 일부) 타이핑 → 검색 결과에서 북마크렛 선택
- 또는 북마크 메뉴에서 직접 탭

---

## 표시되는 정보

### 1. 프로필 카드
- qpro 이미지, DJ NAME, IIDX ID
- SP / DP 단위 (一段~八段 파랑 / 九段·十段 빨강 / 中伝 은빛 / 皆伝 금빛)
- ★값 (ereter.net 근사치, ±0.15)

### 2. 추천곡 (EASY / HARD / EX-HARD)
각 단계별 최대 10곡:
- **앞쪽**: 자기 ★ 근처의 도전곡
- **뒤쪽**: 안 깬 곡 중 ★ 가장 낮은 정리 추천

### 3. 상세 통계
- **CLEAR TYPE / DJ LEVEL** (공식 페이지 표 그대로)
- **난이도 별 클리어 램프** (★11.6 ~ ★12.7 단위)
- **난이도 별 DJ LEVEL** (★ 단위)

---

## ★값 추정 정확도

- **12명 사용자 데이터로 검증**:
  - 평균 오차: **0.065**
  - 최대 오차: **0.120**
- UI 표기는 **±0.15** 로 안전 마진 적용

---

## 자주 묻는 질문

### Q. ★값이 나오지 않아요
12렙 곡을 30개 이상 시도해야 ★값 추정이 가능해요. 그 미만은 통계가 부족해서 추정 안 합니다.

### Q. 어떤 곡이 매칭이 안 됐어요
신곡이거나 곡명 차이 때문일 수 있어요. ereter.net 에 추가될 때까지 기다려주세요.

### Q. 캐시가 갱신이 안 돼요
브라우저 콘솔에서 아래 명령 실행 후 다시 사용하세요:
```javascript
localStorage.removeItem('ereter_dp_diff_v4')
```

### Q. 안전한가요?
- 비밀번호나 개인정보 수집 없음
- e-amusement 와 ereter.net 의 공개 페이지만 fetch
- 코드는 [Gist 에서 공개](https://gist.github.com/hanekawa4365/c3da608194c44f431abd2f1a7a4a9f5e)

