# IIDX DP ★12 실력 추정 — 수집/업로더

ereter.net 의 ☆12 난이도 분석 데이터를 e-amusement 의 DP(·SP) 플레이 기록에 매칭해서 **★값을 추정**하고 **Supabase 에 업로드**합니다. 추정된 별값·추천곡·통계 등 **결과 표시는 [오소리웹](https://ohsorry.vercel.app/)** 에서 봅니다.

평소 사용은 **PC 콘솔 한 줄** 또는 **모바일 북마크렛 한 번 탭** 으로 끝.

> **[구조개편 2C, 2026-06-16]** 이 도구는 "크롤 → 별값(★) 추정 → 업로드" 한 가지 책임으로 **다이어트**(calcOhsorryCore 1660 → 약 800줄)했습니다. 옛 버전은 결과를 e-amusement 페이지 위에 직접 그렸지만, 이제 **인페이지 렌더는 안 합니다** — 결과를 Supabase 에 올리고 **완료 박스 + 오소리웹 카드 링크**만 띄웁니다. 추천곡·배치추천·상세통계 같은 표시·계산은 **오소리웹·오소리레이팅으로 이관**되었습니다.

---

## 평소 사용법

### PC (데스크톱 브라우저)

p.eagate.573.jp 어느 페이지에서나 (메인페이지, 마이페이지 등) F12 → Console → 아래 한 줄 붙여넣기:

```javascript
fetch('https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/ohsorry.js?t='+Date.now()).then(r=>r.text()).then(eval)
```

실행 즉시 모달이 뜨고, 시리즈를 고른 뒤 시작하면 크롤 → 별값 추정 → 업로드가 진행됩니다.

> URL 끝의 `?t=` 부분은 Gist 캐시 우회용입니다. 그냥 같이 붙여넣으세요.

### 모바일 (북마크렛)

모바일 브라우저는 콘솔이 없어서 **북마크렛** 으로 실행합니다. 한 번만 등록해두면 그 후로는 북마크 한 번 탭으로 끝.

**1단계: 북마크 등록**

아무 페이지나 북마크에 추가한 뒤, 북마크 편집해서 **URL 부분을 아래 코드로 교체**:

```
javascript:fetch('https://gist.githubusercontent.com/OhSorry-DP/c3da608194c44f431abd2f1a7a4a9f5e/raw/ohsorry.js?t='+Date.now()).then(r=>r.text()).then(eval)
```

이름은 알아보기 좋게 (예: "오소리") 으로 변경.

**2단계: 사용**

1. p.eagate.573.jp 로그인 후 아무 페이지에서
2. 주소창에 북마크 이름 (또는 일부) 타이핑 → 검색 결과에서 북마크렛 선택
3. 또는 북마크 메뉴에서 직접 탭

> **진입점은 `ohsorry.js`** (wrapper). 옛 북마크렛 URL 인 `2-calc-score.js` · `rivalOhsorry.js` 도 내부에서 `ohsorry.js` 를 fetch+eval 하는 **호환 redirect** 로 유지되니 기존 북마크렛도 그대로 동작합니다. 라이벌은 별도 북마크렛이 아니라 **모달의 IIDX ID input** 으로 통합되었습니다.

---

## 실행하면 일어나는 일

1. 실행 즉시 **모달** 표시 — 시리즈 체크박스(33개, 기본 전체) + **DP / SP 탭** + **IIDX ID input**(기본=본인).
2. 모듈 로드 후 본인 **DJ명 / SP·DP 단위 / IIDX ID** 가 모달 상단에 자동으로 채워집니다.
3. 모달을 보는 동안 별값 lib·ereter·textage 데이터를 백그라운드 **prefetch** → 시작 후 로딩 단축.
4. 시작 → 선택한 시리즈를 크롤 → 별값(★) 추정 → **Supabase 업로드**.
5. **완료 박스** 표시 — DJ명 · IIDX ID · 단위(SP/DP) + **[오소리웹에서 결과 보기]** 버튼. SP 모드면 SP 리센트로 딥링크.

**라이벌 / 여러 명**: 모달의 IIDX input 을 다른 사람 ID 로 바꾸면 그 사람을 라이벌로 처리합니다. 여러 ID(공백·쉼표 구분)를 넣으면 순차 처리 후 **한 명당 한 줄 완료 리스트**로 표시됩니다. own·rival 모두 모달의 DP/SP 토글대로 — **DP 누르면 DP만, SP 누르면 SP만** 크롤·업로드.

---

## 표시되는 정보 (오소리웹에서)

별값·추천곡·배치추천·상세통계 등 **결과 표시는 전부 [오소리웹](https://ohsorry.vercel.app/)** 이 담당합니다. 본체(이 도구)는 데이터만 업로드하고, 오소리웹이 그 데이터를 읽어 보여줍니다. 주요 항목:

- **프로필 카드** — qpro 이미지, DJ NAME, IIDX ID, SP/DP 단위, ★값 추정값(OhSorry) + ereter 원본 ★ 비교.
- **추천곡 (EASY / HARD / EX-HARD)** — `_clearScore` 가중합 기반 정렬 + cleanup 다양성 보정 + 8 배치(mirror × flip) 평가(배치추천).
- **상세 통계** — CLEAR TYPE / DJ LEVEL 표, 난이도 별 클리어 램프·DJ LEVEL 분포.

각 알고리즘(추천 풀 생성·`_clearScore`·8 배치 misfinger penalty·약점 분석)의 상세는 이관된 정본 문서를 참고하세요:

- 추천·배치추천·통계 표시: [ohSorryWeb/docs/features.md](../ohSorryWeb/docs/features.md), [ohSorryWeb/docs/README.md](../ohSorryWeb/docs/README.md)
- 추천·약점 도메인 로직 + 별값 모델: [ohSorryRating/README.md](../ohSorryRating/README.md)

---

## ★값 추정 원리

별값(★) 추정은 **이 도구가 실제로 하는 유일한 계산**입니다. core 는 별값 lib 3종(`OSR13.5+` / `onlyOSR` / `onlyOSRtoEreter`)을 gist 에서 fetch 한 뒤 `onlyOSRtoEreter.inferEreter(...)` 를 **한 번만** 호출해서:

1. **onlyOSR** — 전체 곡 native 별값 (`native_star`, 절대 실력)
2. **onlyOSRtoEreter** — onlyOSR → ereter scale 변환 (`star`, 표시용)

을 산출하고, 곡 별 estimate(`ohSorryRating.json`)도 ohSorryRating 에서 빌드한 산출물을 그대로 씁니다. 일부 시리즈만 크롤하면 별값 계산은 skip 하고 기존 Supabase 값을 보존합니다.

추정 모델 / LOOCV / v3.0.x ~ v3.3.x 변경표 등 상세는 [ohSorryRating README](../ohSorryRating/README.md) 의 "OSR 추정모델 변경사항 (oldOSR)" 섹션을 참고하세요.

---

## 트러블슈팅

### "ereter 데이터가 비어있어요" / 매칭 미달
ereter.net 페이지 구조 변경이나 신곡 미등록(곡명 차이)으로 매칭이 안 되는 경우입니다. ereter 데이터 **수집·갱신의 정본은 [ohSorryRating](../ohSorryRating/README.md)** 입니다(옛 `1-fetch-ereter.js` 는 `D:\work\dpdata\oldOhSorry` 로 아카이브됨). 신곡이 ereter 에 추가될 때까지 기다리거나 데이터 갱신이 필요합니다.

### "★값 추정: 표본 부족 (XX개)" 메시지
12렙 곡을 30개 이상 시도해야 ★값 추정이 가능합니다. 그 미만은 통계가 부족해서 추정하지 않습니다.

### "CUTOFF 미달!" 콘솔 경고
cleared 곡이 50 미만이면 학습 분포 밖이라 추정값 정확도가 보장되지 않습니다. 업로드는 되지만 큰 오차가 가능합니다.

### 결과(추천곡·통계·ereter 비교 토글)가 안 보여요
이 도구는 데이터를 **업로드만** 합니다. 결과 표시는 **[오소리웹](https://ohsorry.vercel.app/)** 에서 보세요(완료 박스의 버튼). ereter ↔ OhSorry 토글이 안 보이는 경우는 IIDX ID 가 `ereter-data.json` 의 `players` 매핑에 없는 것으로, ereter 데이터 갱신이 필요합니다.

---

## 개발 · 상세 문서

파일 구조 · 모듈 구조 · 별값/추천 알고리즘 · 데이터 갱신 절차 등 상세는 [docs/](docs/README.md) 참고:
- [architecture.md](docs/architecture.md) — wrapper→core 로딩 구조(모달·프로필·prefetch) · `compute()` 실행 흐름
- [modules.md](docs/modules.md) — 모듈별 책임 · API (이관된 render/recommend 는 "이관됨" 표기)
- [algorithms.md](docs/algorithms.md) — core 가 실제 하는 별값 추정 + 28차 피쳐 점수
- [data-pipeline.md](docs/data-pipeline.md) — (아카이브된) 수집 스크립트 · gist 배포 · 데이터 형식
- [sp.md](docs/sp.md) — SP(싱글) 모드 경량 업로드

상위 조망(다른 프로젝트와의 관계)은 [../docs/ohSorry.md](../docs/ohSorry.md) 참고.

---

## 변경 이력

전체 변경 이력은 [CHANGELOG.md](CHANGELOG.md) 를 참고하세요.

## 면책

ereter.net 의 데이터를 사용했습니다. 이레터님의 허락을 받지 않았습니다. 재미로만 이용해주세요.
