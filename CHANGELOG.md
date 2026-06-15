# 짭레터넷 (ohSorry) 변경 이력

ohSorry 의 변경 이력입니다. 사용방법은 [README.md](README.md) 를 참고하세요.

### 2026-06-16 — 구조개편 §0 Phase1A: recommend·calcWeakness 본체에서 제거 (→ ohSorryRating 이관)
- 추천 `recommend.js` + 약점/강점 `calcWeakness.js`(+`calcWeakness.md`) 의 정본을 ohSorryRating 으로 이관(도메인 로직) → 본체 `modules/` 에서 삭제.
- 본체는 이 둘을 **gist 에서 fetch** 해 별값/추천 계산에 계속 사용 — 로컬 require 아님. gist URL·내용 불변이라 동작 그대로. 본체의 추천 계산 자체 제거는 Phase 2.
- [docs/modules.md](docs/modules.md): recommend·calcWeakness 섹션을 이관 안내로 교체.
- 검증: 추천/약점 baseline diff 0(레이팅 정본에서 로드).

### 2026-06-15 — 구조개편 §0 Phase1: ohsorryRender·ohsorryShelf 본체에서 제거 (→ ohSorryWeb 이관)
- 표시 책임 모듈 2종 `ohsorryRender.js`·`ohsorryShelf.js` 의 정본을 ohSorryWeb 로 이관 → 본체 `modules/` 에서 삭제.
- 본체는 이 둘을 **gist 에서 fetch** 해 사용(`ohsorry.js`/`rivalOhsorry.js` 콘솔 UI 렌더, `calcOhsorryCore` 추천곡 토스트) — 로컬 require 아님. gist URL·내용 불변이라 **본체 동작 그대로**(정본 위치·편집권만 웹으로). 본체 콘솔 UI 제거는 Phase 2.
- [docs/modules.md](docs/modules.md): 두 섹션을 이관 안내로 교체.

### 2026-06-15 — 구조개편 §0 Phase1: analysisRender.js 본체에서 제거 (→ ohSorryWeb 이관)
- 레포 책임 재배치(통합문서 ROADMAP §0)의 첫 이전. **분석탭 HTML 빌더 `analysisRender.js` 는 표시 책임**이라 ohSorryWeb 가 정본으로 흡수 → 본체 `modules/analysisRender.js` 삭제.
- 본체는 이 모듈을 런타임에서 사용하지 않았음(gist push 용으로만 얹혀 있던 파일). gist(`c3da608…/analysisRender.js`) URL·내용 불변이라 웹·INF 동작 영향 0 — gist push 없이 정본 위치만 이동.
- [docs/modules.md](docs/modules.md): analysisRender 섹션을 이관 안내로 교체.

### 2026-06-15 — 통계 범례 색 박스 가로 절반
- [ohsorryRender.js](modules/ohsorryRender.js) `renderLegend`: 난이도별 클리어램프·DJ LEVEL 범례의 색 박스를 `9×9` 정사각 → **`4.5×9`(가로만 절반, 세로 직사각)** 로. gist(`c3da608…`) 재배포로 게스트 페이지(ohSorryWeb)·본체 동시 반영.

### 2026-06-15 — SP 모드 본인 업로드 시 users 프로필도 저장 (core 0.0.394 / dbConn 0.0.411)
- 증상: SP만 긁으면 status(djName·SP단위·radar)는 fetch 되지만 `users` 테이블에 저장 안 됨. SP 분기가 `upsertUserChartScores`(scores)만 호출하고 `upsertUserProfile` 은 안 불렀음(early return 으로 일반 흐름의 업로드 블록을 안 탐).
- [calcOhsorryCore.js](modules/calcOhsorryCore.js) SP 분기: 본인(own) 업로드 시 `upsertUserProfile` 호출 추가 — `dj_name`/`sp_rank`/`dp_rank`/`notes_radar`(SP·DP) 갱신.
  - **`star`/`ereter_star` 는 SP 모드가 ★분석을 안 하므로 새로 계산하지 않음.** `upsert_user` 가 그 둘을 `EXCLUDED` 로 무조건 덮어쓰는 정책([02_users.sql](../ohSorryAdmin/sql/02_users.sql))이라, null 을 보내면 기존 DP 분석값이 소실됨 → **기존 값을 조회해 그대로 재전송**(없으면 null). `native_star` 는 COALESCE 라 미전송 시 자동 보존.
- [dbConn.js](modules/dbConn.js): `fetchUserStars(iidxId)` 추가 — `/rest/v1/users?select=star,ereter_star` 로 기존값 조회(anon 가능, users RLS `FOR SELECT USING(true)`). getInfRadar batch 의 보존 패턴과 동일.

### 2026-06-14 — 본체 SP 모드 (core 0.0.393 / render 0.0.365)
- [ohsorry.js](ohsorry.js): 곡 데이터 모달 상단에 **DP / SP 탭**(본인 모드만). SP 선택 시 레벨/전곡 선택 숨기고 "SP는 10·11·12 자동" 안내 → `opts.playStyle='SP'`.
- [calcOhsorryCore.js](modules/calcOhsorryCore.js): `playStyle==='SP'` → **SP 경량 분기**(★추정·추천 전부 스킵) — style=0 크롤, 본인은 SP10~12 `play_style:0` 자동 업로드, 최소 result(`spMode`). **라이벌은 토글 없이 DP 분석/업로드 후 SP10~12 도 자동 크롤·업로드**(웹 SP 표시용, 표시는 DP 패널 그대로).
- [ohsorryRender.js](modules/ohsorryRender.js): `result.spMode` 면 경량 패널 — **DJ명 · SP단위 · "오소리웹으로 이동"(`#user@<IIDX>`) 버튼**. (이전 'SP 업로드' 버튼 제거 — SP 모드가 흡수.)
- 적재된 SP 는 오소리웹 DP 화면에 안 섞임(RPC play_style=1 필터, sql/04·05). 웹 SP Recent 가 이 데이터를 표시.

### 2026-06-14 — dbConn(v0.0.408): scores upsert 에 play_style 통과 (SP/DP 공존 대비)
- [dbConn.js](modules/dbConn.js) `upsertUserChartScores`: row 의 `play_style`(0=SP / 1=DP, 기본 1)을 upsert_scores 에 통과시키고 dedup PK 에 포함. DP 단독 적재 동작은 불변(전부 1). scores 04 마이그레이션(ohSorryAdmin) 대응 — 실제 SP10~12 적재는 calcOhsorryCore 의 SP 크롤 패스(예정)에서 play_style:0 으로 전달.

### 2026-06-14 — ohsorryShelf: 서열표 모바일 2번째 줄 재배치 ("C+13  1756")
- [ohsorryShelf.js](modules/ohsorryShelf.js): 모바일 곡 타일 2번째 줄을 왼쪽=DJ등급(색)+작은 회색 +컷대비, 오른쪽=흰색 EXScore(우측정렬)로 재배치. `meta-diff` 에서 앞 등급 글자 제거(+167 만), `meta-ex` 흰색·`margin-left:auto`, DOM 순서 dj→diff→ex. DP·SP 서열표 공통.

### 2026-06-14 — 연습추천 개별 건반 피처 모드: 2단계(피처 게이트 → 개인적합)
- [recommend.js](modules/recommend.js) `buildWeaknessRecs`: 개별 건반 피처(NOTES/CHORD/PEAK/PHRASE/JACK/TRILL/RAND) 선택 시 점수식에 피처를 약하게(~32%) 섞어 성향이 묻히던 것을 **2단계로 분리**. ① `featStrength`(featScore 절대 × 곡내 특화도=7건반 평균 대비 +30점 만점) 상위 `GATE_K`(=max topN×8, 40) **게이트**로 "그 피처 강한 곡" 확정 → ② 그 안에서 `난이도적합·미플레이·미클리어·배치이득·마스터감점`으로 개인적합 정렬. 하드 임계 컷 대신 상대 상위라 후보 고갈 없음. `KB_FEAT_MODES` 분기 — **all·개인차 모드 + 메인(`mode:'all'`)은 불변**.

### 2026-06-14 — analysisRender 0.0.64: 개인평가 막대 + 이유배지 usernorm 정규화
- [analysisRender.js](modules/analysisRender.js): 개인평가 막대 10피처를 usernorm z 스케일로 통일 — 7건반은 `normalizeWeaknessVec`(popMean 빼고 손별 유저내 z), 개인차 3개(롱노트·스크래치·변속)는 popMean·손분리 개념이 없어 **7건반 raw 잔차 분포 sd 로 z 근사**(중심 보정은 막대의 userMean 차감이 처리) → 막대 길이 비교 일관. 잔차 이유배지도 같은 base(`personalUsernormVec`)로 부호·색 일치. `opts.weaknessPopMean` 없으면 raw fallback(기존 동작). ③④추천(7건반+mirror)엔 안 씀 — 막대/이유배지 전용.

### 2026-06-13 — 클리어 추천에도 시리즈(AC/INF) 채보 필터 적용 (LEG 누수 수정)
- [recommend.js](modules/recommend.js) `buildPools`: 후보 채보에 `isInfChartInSeries` 필터 추가 — INF 유저는 INF 수록 채보만 / AC 유저는 AC 수록만(합본은 weakSource 토글). 연습곡(`buildWeaknessRecs`)엔 이미 있었으나 **클리어 추천 풀엔 빠져 있어** AC 유저에게 INF 전용 LEGGENDARIA 등이 추천되던 누수 수정. checker 에 weakness 와 동일한 chartName(`DP_LEG` 등) 형식 전달 → LEG 는 `legen` 비트, 그 외 `ac` 비트로 정확히 판정. (web=api.js acChecker/infChecker, console/INF=core checker 양쪽 호환)

### 2026-06-13 — 클리어 추천 배치(8배치) 기본 OFF — 정배치 위주 추천이 기본
- 문제: 배치추천 토글이 OFF 인데도 추천곡에 #FLIP/미러(배치)가 찍혀 나옴. 원인은 `layoutModeForClear` 기본값이 `'on'` 인데 **초기 추천 빌드가 `setLayoutMode('off')` 를 호출하지 않아** 초기 추천이 8배치 ON 으로 계산됨(웹 유저카드는 클리어추천 배치 토글 미연동이라 항상 ON 상태였음).
- [recommend.js](modules/recommend.js): `layoutModeForClear` 기본값 `'on'` → **`'off'`** (정배치 위주 추천이 정책 기본. 배치 평가는 UI 토글 `setLayoutMode('on')` 시에만). 정배치 bestLabel 은 `''` 라 배지·#FLIP 해시태그 모두 미표시.
- [calcOhsorryCore.js](modules/calcOhsorryCore.js): 초기 EC/HC/EXH 빌드 전 `setLayoutMode('off')` 명시 + 결과에 `recLayoutModeDefault:'off'` 추가(콘솔/INF ohsorryRender 배치추천 토글 UI 도 기본 OFF 로 일치).

### 2026-06-13 — 클리어추천(③) cold-start 풀 전멸 가드 + 저레벨 추천 base 를 star 로
- 문제: 클리어 램프 곡이 거의 없는 cold-start/신규 유저(예: 어제 등록·EC 클리어 0)는 ③ 클리어추천 EC/HC/EXH 가 **전부 0곡**. 원인은 `buildPools` 의 `topClearStar`(해당 stage 클리어곡 ★ 최댓값)=0 → `hardMax = topClearStar + 0.3d = 0` → **estEC ★0 = 11레벨 시작**이라 `dv > 0` 전곡이 컷. ④ 연습추천은 `baseStar=11` fallback 으로 살아남아 "③만 빔" 증상.
- [recommend.js](modules/recommend.js): `buildPools` 에 floor 가드 — `topClearStar < baseStar` 면 `baseStar` 로 floor. cold-start 도 baseStar 근처(**11레벨 위주 + 12레벨 하단**) 풀 구성. `topClearStar ≥ baseStar` 정상 유저는 미발동(회귀 없음). 검증: base 0.87 EC 풀 = 11레벨 234곡 + 12레벨 28곡.
- [calcOhsorryCore.js](modules/calcOhsorryCore.js): 추천 base 를 **★0.5~2(12레벨 정착 전) 구간은 native(onlyOSR) 대신 표시 star(onlyOSRtoEreter)** 로 — 저레벨에서 native 가 과대추정되는 경향 교정. **★0.5 미만은 native 유지**(star 로 낮추면 `clearLvMode`='low' 8~10레벨로 추락해 11레벨 플레이어에 부적합).
- 별값 척도 앵커 명문화: **★0 = 11레벨 시작, ★1 = 12레벨 막 EC**(estEC/HC/EXH 공통). 게임레벨별 분포는 `docs/README.md` "레벨 체계와 별값 기준점" 기록.

### 2026-06-13 — 연습추천 범위: 저레벨 유저 하한 자동 확장 (max−1 → min(max−1, 75분위))
- 문제: `practiceZasaDefault` 가 `[최고클리어zasa − 1.0, 최고클리어zasa]` 였는데, **클리어가 듬성한 저레벨 유저**는 운빨 1곡으로 max 가 실력보다 한참 위로 튀어(예: 중앙 9.0·HC천장 10.0 인데 EC 운빨 11.8) 범위가 통째로 위로 떠 — 연습추천이 전부 **못 깬 곡**이 됨.
- 하한을 `min(topClear − 1.0, 클리어 zasa 75분위)` 로 변경. max 가 운빨로 튄 유저(분위수 ≪ max)만 하한이 자동으로 내려가 **실력대 곡이 풀에 들어오고**, 클리어 촘촘한 유저(분위수 ≈ max)는 기존 −1.0 폭 그대로. ceiling(=topClear)·width·targetZasa·다른 추천 로직은 불변.
- 검증: 58120555(12못함) `[10.8,11.8]`(전부 lamp 0~1) → `[9.6,11.8]`(zasa 10~11.6 실력대 유입). 79301798(12갓시작) `[11.1,12.1]` 변동 없음(75분위 11.2 ≈ max−1).

### 2026-06-13 — 클리어추천(③)도 usernorm 정규화 적용 (④와 high/low 대칭)
- ④ 약점추천에 이어 ③ 클리어추천도 **같은 raw vec 의 population/density 편향**을 강점(high) 방향으로 물려받아, "내 강점"이 아니라 **population 강점(CHORD/PEAK)** 을 보고 모두에게 비슷한 곡을 추천하던 문제 교정. ③/④는 같은 weakness vector 의 high(강점)/low(약점) 대칭 활용 — 같은 정규화 철학으로 통일.
- [recommend.js](modules/recommend.js): `createContext` 에 `clearMatchVec = normalizeWeaknessVec(userVec, popMean)`(7건반 + mirror18). `chartStrengthMatchByHand` wrapper 의 **matchScore 입력(bestNorm)만** clearMatchVec(7건반 feats)로 재계산해 override — layout/bestTotal/layoutGain/bestLabel·diffFit/lampFit·buildPools/cleanup/easy/hard·**matchScore 0.45 가중치 전부 raw 불변**. `weaknessPopMean` dep 없으면 raw 동일 fallback.
- 검증(real buildRecs, 메인 C2000…7849 + V3E): 개인화·다양성·편향감소 명확. V3E EXH 에서 dv **+0.5★ 드리프트** 관측 — 원인분석 결과 **버그 아님**(유저 상대강점 RAND/TRILL/PHRASE 가 풀에서 더 어려운 곡에 몰려 corr(pt,dv) 양수 + matchScore 0.45≫diffFit 0.15). dv 는 population 난이도라 강점매치 곡은 본인에겐 덜 어려울 수 있어 clear-rec 의도에 부합.
- **diffFit 가중치/dv cap 등 난이도 가드 튜닝은 별도 실험으로 분리.** EC/HC 풀은 강유저 계정 특성상 미검증(중간레벨 계정 추후).

### 2026-06-13 — 연습추천 약점 vec 의 population/density 편향 제거 (usernorm 정규화)
- 문제: calcWeakness 약점 vec 이 같은 ★ bucket 안 "pt 높은=더 어려운" 곡 가중으로 전 feature 가 음수로 쏠려(전체 유저 평균이 전부 음수), 약점추천이 개인 약점이 아니라 **population 난이도(밀도 높은 PEAK 곡)** 를 보고 모두에게 비슷한 곡을 추천. 3550명 검증에서 1순위 약점이 TRILL/PHRASE 에 85% 집중.
- [calcWeakness.js](modules/calcWeakness.js): `normalizeWeaknessVec(userVec, popMean, opts)` 추가·export — 손별 invariant 7 + mirror 18 dim 에 ① population 중심화(popMean 빼기) ② 유저내 z-score(상대 약점 shape) 적용. 저변별(프로파일 평평) 유저 노이즈 증폭 가드(sdFloor=0.7). raw vec(③ 클리어추천·user_radars)은 불변.
- [recommend.js](modules/recommend.js): `buildWeaknessRecs` 의 약점 매칭(8Way `weakMatchScore`·`weakSignal`·`weakFeats`)을 정규화 vec(`matchVec`)으로 교체 — 단 개인차 모드(CHARGE/SCRATCH/SOF-LAN)는 잔차가 진짜 개인 적성이라 raw 유지. `deps.weaknessPopMean` 없으면 raw fallback(기존 동작).
- [calcOhsorryCore.js](modules/calcOhsorryCore.js): `weakness-popmean.json` fetch → recommend ctx `weaknessPopMean` 전달. 실패해도 raw fallback.
- popMean 데이터·생성기는 ohSorryRating(`dist/weakness-popmean.json`, `scripts/gen-weakness-popmean.js`).
- 검증(3550명): 1순위 약점 분포 엔트로피 1.61→2.60bit, TRILL/PHRASE 독식 85%→32%. production 8Way 매처 추천 다양성 — 유저간 Jaccard 0.21→0.06, 고유 추천곡 150→280. weakMatchScore 가중치(0.38) 상향은 성격이 달라 **별도 실험으로 분리**.
- **gist 미배포** — 배포 전까지 fetch 실패→raw fallback 이라 라이브 동작 불변.

### 2026-06-13 — 문서 구조 개편 (사용법 / 상세 / 이력 분리)
- README 를 사용방법 중심으로 정리. 파일 구조·모듈 구조·데이터 갱신·URL 모음 등 개발 상세는 `docs/`(architecture / modules / algorithms / data-pipeline) 로 분리하고 링크.
- 변경 이력을 README 에서 이 `CHANGELOG.md` 로 분리.

### 2026-06-09 — patterns 레벨 구간 분할 lazy 로드 (평소 11·12 만 fetch)
- [calcOhsorryCore.js](modules/calcOhsorryCore.js): `PATTERNS_URL` 을 `patterns-dp-1112.json`(11·12) 기본으로, `PATTERNS_URL_0810`/`REST` 추가. `ensurePatternsLevel(band)` 로 하위 구간(8~10·1~7)을 `patternsMap`/`patternsTitleMap` 에 in-place 병합(`window.__dp_ensurePatternsLevel`). 초기 추천이 저렙(`lvMode≠'lv12'`)이면 미리 lazy 로드. `__dp_rerollRecs`/`__dp_rerollWeakness` 를 async 화 — reroll/약점 zasaMin<11 시 하위 구간 lazy.
- [ohsorryRender.js](modules/ohsorryRender.js): reroll 핸들러(`rerenderRecStage`/`rerenderWeakness`) async + await 로 변경.
- 효과: 대부분(11·12) 유저는 patterns fetch 가 **7MB→1.8MB**. `patterns-all-slim.json` 은 INFOhSorry 빌드 번들 호환 위해 gist 에 유지.

### 2026-06-08 — 추천 v2: 28dim 배치적합/약점콕 주력 (REC_SCORE_MODE)
- [calcWeakness.js](modules/calcWeakness.js): `chartStrengthMatch8Way` 에 `normalize` 옵션 + `bestNorm` 추가 — `invMatch`/`mirMatch` 로 **pt(곡 패턴)만 정규화**(vec 은 분자 유지)해 vec 이 전부 동부호인 유저에서도 곡 간 변별 유지. `chartWeaknessMatch8Way` 도 약점방향 `bestNorm` 노출. 기존 `bestTotal`/`best` 는 불변.
- [recommend.js](modules/recommend.js): **클리어 추천** = 28dim 배치적합(`matchScore`) 주력 + 난이도·램프 가드(깰 수 있는 방향) + 배치이득·추천배치 표시 / **약점 추천** = 28dim 약점콕(`weakMatchScore`, 손별 STAIR·K 포함) 주력. 두 추천 모두 **추천 풀 내 min-max 정규화**로 유저 절대 실력 레벨을 제거하고 곡 간 상대 변별만 반영. 모두 `scoreMode:'v2'` 플래그 뒤 (기본 v1 = 기존).
- [calcOhsorryCore.js](modules/calcOhsorryCore.js): `REC_SCORE_MODE='v2'` 스위치 — EC/HC/EXH·약점·리롤 전 추천 호출에 전달. `'v1'` 로 한 줄 롤백.
- [ohsorryRender.js](modules/ohsorryRender.js): 약점 추천 feature 선택 UI 보강 — 건반 종합(all) + 건반 개별 7(물량/동시치기/계단/순간밀도/산발/축연타/트릴) + 개인차 3(롱노트/스크래치/변속) = 10 feature.
- 검증: ohSorryRating `eval-recscore-v1v2.js` 하니스로 약점형·강점형 유저 v1/v2 비교 — 풀 정규화로 포화 없이 28dim 주력항이 추천 순위에 반영됨 확인.

### 2026-06-06 — calcWeakness — 8배치 무리배치에 약지·소지 트릴 조건 추가 (trillPenalty)
- [calcWeakness.js](modules/calcWeakness.js): 8배치 평가에 **약지·소지 트릴 penalty** 추가 — 약지·소지가 직접 트릴 치는 배치가 무리.
  - 기존 스크 misfinger(스크에서 먼 키 K67/K12)와 **반대 위치** — 왼손 바깥 K1·K2 / 오른손 바깥 K6·K7 영역 트릴.
  - 정규 왼손 무리 = 12/13/23, mirror 왼손 = 56/57/67 (오른손 반대). 6페어 동일 가중치 `TRILL_WEIGHT=0.35` (스크 strong 0.5 보다 약하게).
  - `chartStrengthMatch8Way` 에 `trillOn` 토글 추가 (기본 on). `chartWeaknessMatch8Way` 의 bestPen 은 penalty 직접 사용 (misfingerOn/trillOn 이미 반영).
  - 차트 데이터는 `patterns-all-slim.json` 의 m1/m2 `TRILL` 필드(ohSorryRating 에서 생성). gist(c3da608) 배포.

### 2026-06-05 — 분석탭 평가 토글·잔차 이유·등수 막대 + 약점추천 개별 피처 (analysisRender 0.0.63, recommend)
- [analysisRender.js](modules/analysisRender.js): 막대그래프 **"상대평가 ↔ 개인평가" 토글** 추가 (기본 개인평가). 개인평가=calcWeakness 잔차, 상대평가=등수 기반.
  - 막대(feature) 클릭 시 **스킬 대상곡 위에 강/약점 이유 박스** — "플레이 한 곡을 분석해보니 〈피처〉가 강한 곡을 다른 패턴보다 ±X% 잘/못 칩니다" (막대 숫자와 일치). 헤더 desc 줄 제거, NOTES 라벨 '물량'.
  - 상대평가 막대를 **등수 막대**로 — 평균±15등 스케일, 평균선 동적(상위권은 위로 끌어올려 1등이 천장 / 하위권은 아래로 내려 꼴찌가 바닥). 막대 색 녹(강점)/빨(약점), 등수 라벨 흰색.
- [recommend.js](modules/recommend.js): 약점추천 모드에 **개별 건반 피처 7개**(밀도/동치/순간밀도/계단/축연타/트릴/난타) 추가. 후보 풀은 '건반'(all)과 동일하게 개인차(롱잡·스크·변속) 제외.

### 2026-06-03 — calcOhsorryCore — 별값 파이프라인 onlyOSR + onlyOSRtoEreter 로 전환 (adopt 대체)
- 별값 최종을 `onlyOSR`(전체곡 native 50%) + `onlyOSRtoEreter`(ereter★ 변환, OSR13.5 tier) 로 계산 — 기존 `adopt` 대체. ([calcOhsorryCore.js](modules/calcOhsorryCore.js))
- DB 모드는 `dbData.native_star` 로 추천 baseStar 사용, 비-DB 는 `onlyOSRtoEreter.inferEreter` 로 ★(ereter)/native(onlyOSR) 계산. star=toEreter / native_star=onlyOSR(추천 base).
- `native_star` 를 supabase 페이로드 + RPC 파라미터에 추가. ([dbConn.js](modules/dbConn.js))

### 2026-06-03 — 3-fetch-zasa — H/A/L 전부 추출 (☆9 이하 자사레벨 보강)
- [3-fetch-zasa.js](old/3-fetch-zasa.js) 추출 규칙에서 HYPER 필터(`A/L 없거나 ☆11/12`)를 제거하고 **HYPER / ANOTHER / LEGGENDARIA 를 전부** 추가.
  - 기존엔 ☆7~9 곡(HYPER 메인)이 ANOTHER 보유 시 버려져 zasa-data 가 ☆10~12 위주였음.
  - 이제 ☆1~12 전 자사레벨 채보가 들어와, low 유저의 `practiceZasaDefault` 최대 클리어 zasa 매칭을 커버. (zasa-data.json 재추출·배포 필요)

### 2026-06-03 — recommend.js v0.0.10 — 연습곡 zasa 기본 범위 단순화 (최대 클리어 zasa-1 ~ 최대, 이력 없으면 5.9~6.9)
- 연습곡 추천 zasa 토글 기본값(`practiceZasaDefault`)을 정리. ([recommend.js](modules/recommend.js))
  - **최대 클리어 zasa 있는 유저**(low/high 무관) → `min = 최대 zasa − 1`, `max = 최대 zasa` (기존과 동일).
  - **최대 클리어 zasa 이력 없는 유저** → 기존 game level 기반 분기(`5.9~10` / `8~10.9` / `10~12.1` / `11.6~12.7`)를 폐기하고 **`5.9~6.9` 고정**.
  - low 유저가 기본 `5.9~10` 의 넓은 범위로 잡히던 문제 해소. 오소리웹·본체 오소리 공통 적용(공유 모듈).

### 2026-06-02 — eagateFetch — 빈 레벨 폴더에서 멈추지 않고 skip
- 증상: eagate 레벨 모드 fetch 시 첫 레벨(보통 12)을 한 번도 안 친 유저는 그 레벨 폴더가 비어(HTTP 200 + 곡 0개) "로그인 의심" alert 뜨고 전체 fetch 가 중단됨.
- fix: [eagateFetch.js](modules/eagateFetch.js) `fetchOneLevel` 가 빈 레벨(첫 레벨 포함)을 **skip 하고 다음 레벨로 진행**. 로그인/페이지구조 오류 판정은 `collectByLevel` 가 **전 레벨 합산 0곡일 때만** 하도록 이동. (HTTP/네트워크 에러는 기존대로 즉시 감지.)

### 2026-06-02 — calcOhsorryCore v0.0.391 / ohsorryRender — 통계 즉시 렌더(statsOnly) 경량 모드 + noRender
- **statsOnly** 모드 추가 ([calcOhsorryCore.js](modules/calcOhsorryCore.js)) — 통계 + 노트레이더만 즉시 렌더하고 무거운 계산(userVec/calcWeakness · recommend · layoutMap) 과 추천곡 섹션 · supabase 업로드를 스킵. 게스트 페이지에서 통계가 빨리 뜨도록.
- **noRender** 모드 — `show`(패널 렌더) 스킵, result 만 반환. 2차 백그라운드 full compute 시 전체화면 패널 깜빡임 방지. statsOnly 와 독립.
- [ohsorry.js](ohsorry.js) wrapper — `window.__dp_render(dbData, renderOpts)` 로 `{ statsOnly, noRender }` 전달.
- [ohsorryRender.js](modules/ohsorryRender.js) — `show(result, { statsOnly })` 에서 statsOnly 면 추천곡 섹션 생략. 노트레이더 빌더를 named 함수(`buildRadarSection`)로 분리(동작 동일).

### 2026-06-01 — calcOhsorryCore v0.0.391 — ALL 분모는 textage×songs, DP12/DP11 분모는 서열표 곡 집합 (모드별 분리)
- DP12/DP11 막대 분모: 서열표 곡 집합 (AC=`zasaData` 아케이드 전곡 / INF=`allCharts` 보유곡) — v0.0.390 그대로.
- ALL 막대 분모(`gameLevelTotals`): **zasa 무관, textage-meta DP 채보 levels × songs.ac/legen 수록 비트** (INF=2 / AC=1, DX=legen·그 외=ac) 로 복원. `songsByNorm` 전체 유저 fetch. textage levels 0(채보 없음) 을 실제 레벨로 오인하던 버그도 수정(`>= 1` 만 채택).

### 2026-06-01 — calcOhsorryCore v0.0.390 — 통계 분모를 "서열표 곡 집합" 기준으로 (INF/AC 필터 복원)
- 증상: 통계탭 난이도별 스택바 분모가 INF 유저에서 AC 곡(ereter) 기준이라 부정확/과다 (v0.0.389 의 textage×songs 분모도 INF/AC 필터가 의도대로 안 먹음).
- fix: 분모를 **서열표가 그리는 곡 집합**과 동일하게 통일.
  - [calcOhsorryCore.js](modules/calcOhsorryCore.js): `gameLevelTotals` 재작성 — textage×songs 방식 폐기, **AC 유저 = `zasaData`(아케이드 자사★ 전곡) / INF 유저 = `allCharts`(보유·플레이 곡)** 의 gameLevel 별 채보 수. `songsByNorm` fetch 는 원래대로 INF 유저만(분모에 더는 불필요). `result.isInfUser` 추가.
  - [ohsorryRender.js](modules/ohsorryRender.js): DP12/DP11 `computeStats` 분모를 `isInfUser` 분기 — **AC 유저는 기존(ereterData + zasaSupplemental = 아케이드곡)**, **INF 유저는 보유곡(charts) 자체를 zasa★ 버킷별 분모**로. ALL 모드는 재작성된 `gameLevelTotals` 사용.

### 2026-05-31 — calcOhsorryCore v0.0.389 — 통계탭 ALL 분모를 textage-meta × songs 수록 비트로 정확화
- ALL 모드 난이도별 막대의 **분모(총 채보 수)** 를 `allCharts`(플레이/보유 곡) 직접 집계 → **textage-meta DP 채보 × songs.ac/legen 수록 비트** 기반 `gameLevelTotals` 로 교체. 미플레이 채보까지 포함한 실제 NO PLAY 비율이 나옴.
- [calcOhsorryCore.js](modules/calcOhsorryCore.js):
  - `songsByNorm` fetch 를 **AC 유저까지 확대** (기존 INF 유저만 → AC 도 `ac & 1` 수록 필터 필요). `isInfChartInSeries` 동작은 불변(AC 유저 early-return).
  - `gameLevelTotals` 계산 — `textageSongs` 의 DP 채보 levels(DN/DH/DA/DX/DB)를 norm 매칭한 `songs` 레코드(동명이곡 = 같은 norm 의 여러 레코드 **각각**)에 대해 수록 비트 검사. **userBit = INF `2` / AC `1`**, **DX(LEGGENDARIA)=`legen` / 그 외=`ac`**. set 인 채보만 해당 gameLevel 카운트. `result.gameLevelTotals` 로 전달.
- [ohsorryRender.js](modules/ohsorryRender.js): ALL 모드 `computeStats` 가 `total` 을 `gameLevelTotals` 로 사용, `played`/lamp/dj 는 `allCharts` 매칭, **NO PLAY = total − played**. `gameLevelTotals` 없으면(fetch 실패) 기존 allCharts 집계로 fallback.

### 2026-05-31 — ohsorryRender — 통계탭 난이도 선택에 ALL 추가 (gameLevel 1~12 막대)
- 통계탭 "난이도 선택" 토글(DP12 / DP11)에 **ALL** 추가. DP12/DP11 동작은 그대로 보존.
- ALL 모드: `computeStats('all')` 신설 — **gameLevel 정수 1~12 별로 집계**. 난이도별 램프·DJ LEVEL 막대가 zasa★ 가 아닌 `Lv1`~`Lv12` 단위로 표시.
- 막대 행 체계가 모드별로 달라(zasa★ ↔ gameLevel) 부분 갱신 불가 → `__dp_setLvMode` 가 `#__dp_detail_filtered`(표+막대) 전체 재렌더. `details`(클리어 램프 / DJ LEVEL) 펼침 상태는 복원. `buildTable`/`buildBars`/`buildBarRow` 를 `stats`·`mode`·`key/label` 파라미터화.

### 2026-05-31 — recommend.js v0.0.9 — 추천 풀 + 계층 랜덤 추출 (리롤 변동성) + 연습곡 INF 미수록 제외 (notInINF)
- **풀 + 계층 랜덤** — `buildRecs` 에 `opts.randomize`/`withPool`/`limit`/`poolSize` 추가. randomize 시 `_clearScore` 순 상위 30곡(연습곡 60곡) 풀을 3밴드(상위 4/중간 3/하위 3)로 나눠 밴드별 무작위 추출 → 리롤마다 곡 변동. 기존 5-인자 호출은 결정적 동작 100% 보존(하위호환).
  - 신규 `buildRecsWithPool(...) → { picked, pool }` (INFOhSorry 의 클리어 시 pool refill 용).
  - `buildWeaknessRecs` 도 randomize 시 60곡 풀 + topN 비례 밴드.
- **웹 적용** ([calcOhsorryCore.js](modules/calcOhsorryCore.js)) — 초기 렌더 + `__dp_rerollRecs` / `__dp_rerollWeakness` 모두 `randomize:true` → 누를 때마다 새 곡.
- **연습곡 INF 미수록 제외** — `isInfChartInSeries` 가 `service-status.json` 의 `notInINF` 목록도 참조 (songs.legen 데이터 오류 / 캐시 fallback 누수 보강). `chartName→slot` 매핑 후 하드 제외. 라이브·DB 모드 공통.

### 2026-05-31 — recommend.js v0.0.8 — 약도전(easy) 상한 0.7d → 0.65d
- `buildPools` 의 `hardMin` 을 `effectiveBase + 0.7d` → `+ 0.65d` (EC/HC 공통, EXH 무관).
- 약도전 = `[effectiveBase, effectiveBase + 0.65d)`, 도전(hard) 시작점이 그만큼 내려감.

### 2026-05-31 — recommend.js v0.0.7 — EC(이지클) 추천 도전곡(hard) 완화
- 피드백: 이지클 추천의 도전곡(hard)이 과하게 어려움.
- fix [recommend.js](modules/recommend.js) — EC 에만 적용 (HC/EXH 불변):
  - **hard 상한 완화** — `buildPools` 의 `hardMax` 를 `topClearStar + 0.3d` → EC 는 `topClearStar + 0.15d` (내 EC 최고기록 위로의 도전 폭 절반).
  - **hard 슬롯 축소** — `buildRecs` underSlots 를 EC 전용 분기로 분리, `cleanup4 / easy4 / hard2` → `cleanup4 / easy5 / hard1` (도전곡 1곡, 약도전으로 보충).

### 2026-05-31 — recommend.js v0.0.6 — 연습곡 후보 zasa 도 zasaMap fallback (미표기 오작동 수정)
- 증상: v0.0.5 미표기 적용 후, zasaMap 에 실측이 있는 11레벨 곡(예: Macho Gang 11.8)이 `☆--` 로 잘못 미표기됨.
- 원인: 상한 계산(`practiceZasaDefault`/`topClearZasa`)은 zasaMap 을 보지만, **후보 곡의 표시 zasa 를 정하는 [L723-737](modules/recommend.js#L723-L737) 은 ereter→rating→`zasaAvgByGameLv` 로 zasaMap 을 건너뜀** → 실측 곡도 게임레벨 평균 임의값(`__lowFallback`)으로 빠져 미표기.
- fix [recommend.js](modules/recommend.js) — 후보 수집부에도 zasaMap fallback 추가. 함수 내 세 경로(상한 2곳 + 후보 표시값) 모두 `ereter→rating→zasaMap→평균` 으로 통일. 실측 있으면 `☆11.8` 정상 표시, 진짜 없는 곡만 `☆--`.

### 2026-05-31 — recommend.js v0.0.5 — 연습곡 zasa 실측 없는 곡 ☆ 미표기
- 증상: 연습곡 추천에서 zasa 실측(ereter/rating/zasaMap)이 없는 곡에 게임레벨 평균(`zasaAvgByGameLv`) 임의값을 `☆11.x` 로 표시 — 실제 서열표 값이 아닌데 있는 것처럼 보임.
- fix:
  - [recommend.js](modules/recommend.js) — `zasaAvgByGameLv` 로 임의로 채운 `e` 에 `__lowFallback` 플래그, item 에 `_hideZasa` 전달. 임의 `level` 은 정렬/필터 계산용으론 유지 (추천 후보에서 빠지진 않음).
  - [ohsorryRender.js](modules/ohsorryRender.js) — `_hideZasa` 면 `☆--` 로 미표기 (클리어 추천의 `★--` 와 통일), tooltip "zasa 미등록".

### 2026-05-31 — recommend.js v0.0.4 — 연습곡 추천 상한 로직 개선 (3건)
- 증상: 유저별로 연습곡 추천 상한이 들쭉날쭉. `7930-1798` 은 11.4 에서 막히고(상한이 너무 낮음), `5812-0555`(11렙까지만 클리어) 는 12.7 까지 나옴(상한이 너무 높음).
- fix [recommend.js](modules/recommend.js) (v0.0.2 → v0.0.4):
  - **① EC클 최고까지 하드캡 확장** — `buildWeaknessRecs` 하드캡을 `topClearZasa(HC)+0.5` 단일 기준에서 `Math.max(topClearZasa+0.5, ecTopClearZasa)` 로. 클리어 최고 zasa 루프를 `lampNum>=3` 으로 넓혀 `topClearZasa`(HC 이상)·`ecTopClearZasa`(EC 이상)를 함께 산출. EC클 최고가 HC+0.5 보다 높은 유저도 EC클 곡까지 추천.
  - **② 게임레벨 캡 추가** — 후보 곡 중 `gameLevel > maxClearGameLevel`(클리어 최고 게임레벨) 제외. 플레이만 하고 클리어 못한 상위 레벨이 상한을 끌어올리는 것 방지.
  - **③ zasaMap fallback** — `topClearZasa`/`practiceZasaDefault` 계산이 ereter/rating 만 보고 `zasaMap`(sub-12, 11렙) 을 안 봐서, 11렙 곡만 클리어한 유저는 `topClearZasa=0` → 게임레벨 fallback(12.1/12.7) 로 빠짐. `zasaMap` fallback 추가로 11렙 클리어곡(예: Macho Gang zasa 11.8 — ereter/rating 엔 없고 zasaMap 에만 존재)도 인식 → 상한이 본인 클리어 zasa 로 정확히 잡힘.
- 결과: 모든 유저가 "본인 실제 클리어 실력(게임레벨 + zasa)" 기준으로 일관된 상한을 받음.

### 2026-05-30 — ohsorryRender 추천 영역 카드 순서 (연습곡 마지막으로)
- [ohsorryRender.js](modules/ohsorryRender.js) — 기존: `연습곡 → EASY → HARD → EX-HARD`. 변경: `EASY → HARD → EX-HARD → 연습곡`. INFOhSorry v0.0.67 의 RecCard 4번째 = 연습곡과 순서 통일.

### 2026-05-30 — recommend.js 신규 모듈 분리 + 로딩 스피너 + 해시태그 토스트 테마 분기
- **recommend.js (신규, gist)** — calcOhsorryCore 의 추천 관련 함수 약 850 line 을 별도 모듈로 분리. UMD wrapper 로 `window.OhsorryRecommend.createContext(deps)` 패턴.
  - 분리 함수: `chartStrengthMatch` / `chartStrengthMatchByHand` / `computeChartTags` / `computeRecHashtags` / `buildPools` / `buildRecs` / `buildWeaknessRecs` + `setLayoutMode` / `getLayoutMode` 토글.
  - 자체 캡슐화: `FEAT_TAG_MAP` / `CATEGORY_TAG_MAP` / `PRACTICE_TAG_MAP` / `HAND_BIAS_THRESHOLD` / `WEAKNESS_FEATS` / `WEAKNESS_CLEAR_LAMP` / `WEAKNESS_MODE_FEATS` / `MIN_BIN_N` / `CHART2DIFF_REC` 상수 + `practiceZasaDefault` / `maxClearGameLevel` 자체 계산.
  - 외부 노출: `practiceZasaDefault` / `maxClearGameLevel` 도 context 반환 객체에 포함 — ohsorryRender 가 `result.practiceZasaDefault` 로 UI 토글 기본값 사용.
  - 효과: 추천 알고리즘 한 곳 (gist `recommend.js`) 에서만 관리. ohSorryWeb / INFOhSorry 등 외부 클라이언트가 calcOhsorryCore 전체 fetch 안 하고도 가벼운 추천 모듈만 fetch 가능.
- **calcOhsorryCore (대규모 리팩토링)** — `RECOMMEND_URL` 상수 + `recommendLib` fetch (calcWeakness 옆) + `recommendCtx = recommendLib.createContext({userVec, weaknessLib, patternsMap, patternsTitleMap, normFn, seriesNames, textageSeriesByNorm, allCharts, ereterMap, ratingMap, zasaMap, zasaAvgByGameLv, featureScoresMap, isInfChartInSeries, pdLayoutMap: __pdLayoutMap})` 호출. 이식 함수 + 자체 상수 + dead code 제거. **2330 → 1520 line (~810 감소)**.
  - 호출부 통과: `recsEC/HC/EXH.push(...recommendCtx.buildRecs(...))` / `recsWeakness.push(...recommendCtx.buildWeaknessRecs(...))` / `window.__dp_rerollWeakness` / `window.__dp_rerollRecs` 의 stage 별 `ctx.buildRecs` + `ctx.setLayoutMode`.
  - result 객체의 `practiceZasaDefault` 는 `recommendCtx.practiceZasaDefault` 로 통과 (null 시 `{min:11.6, max:12.7}` fallback).
- **로딩 스피너** — `compute` / `runFromDb` 시작 시 우측 상단 floating spinner ("오소리 분석 로딩 중..."), 끝 / 에러 시 자동 제거. eamuse 콘솔 직접 실행 시 진행 가시화.
- **ohsorryRender.js — 해시태그 toast 테마 분기**: `location.hostname` 이 `eagate.573.jp` 면 투명 배경 + 진한 글자 (밝은 환경), 그 외 (ohSorryWeb / INFOhSorry) 는 기존 검은 배경 + 흰 글자 유지.
- 짝 변경: gist `recommend.js` 신규 업로드, `calcOhsorryCore.js` / `ohsorryRender.js` 갱신. [ohSorryWeb 2026-05-30 로딩 스피너](../ohSorryWeb/README.md).

### 2026-05-30 — dbConn v0.0.410 / calcWeakness — upsert_user_feature_score 28 dim 시그니처 매칭 + make_grid_data 페이지네이션
- 증상: 본체 업로드 후 분석탭 percentile / 막대그래프가 안 보이는 유저 다수. 04290300 (MURI ★2.6) 등 188 유저 중 11명 `user_ohsorry_radars` 빈 row.
- 원인: 2026-05-27 [migration_mirror_features.sql](../ohSorryAdmin/sql/migration_mirror_features.sql) 로 `user_ohsorry_radars` 에 18 dim (STAIR_UP/DN_L/R + K1~K7 손별) 추가 + `upsert_user_feature_score` RPC 시그니처 11 → 29 인자로 확장. dbConn 의 `callUpsertFeatureScore` 가 옛 11 인자만 보내서 PostgREST 가 함수 매칭 실패 (`PGRST202`) → `uploadResult` step 5 의 `try/catch` 가 console.warn 으로 묻음 → row 가 빈 채로 남음.
- fix [dbConn.js](modules/dbConn.js) (v0.0.410):
  - `computePatternScoreVec` 의 `FEATS` 10 → 28 (STAIR_UP_L/R, STAIR_DN_L/R, K1_L/R ~ K7_L/R 18 dim 추가).
  - `callUpsertFeatureScore` 인자 11 → 29 (`p_os_stair_up_l/r`, `p_os_stair_dn_l/r`, `p_os_k1_l/r ~ p_os_k7_l/r`).
  - `make_grid_data` RPC 페이지네이션 추가 — PostgREST 기본 max_rows=1000 이라 plays 많은 유저 (예: 04290300 의 2049 row) 의 vec 가 부정확하던 문제. `?limit=&offset=` 으로 모든 row fetch (ohSorryWeb / backfill-pattern-score.js 와 동일 패턴).
- fix [calcWeakness.js](modules/calcWeakness.js): `UPSERT_FEATS` (28 dim) 신규 변수 추가, `computePatternScoreVec` 가 그것만 사용. 기존 `FEATS` (10) 는 `avgPt` / 약점 계산 등 양손 평균 흐름이 그대로 써야 해서 분리 — 그 함수들엔 영향 없음. INFOhSorry 도 같은 gist `calcWeakness.js` 를 쓰므로 lib 갱신만으로 28 dim vec 자동 적용.
- 짝 변경: INFOhSorry v0.0.66 (`Analysis.tsx upsertFeatureScore` 29 인자), [backfill-pattern-score.js](../ohSorryRating/scripts/backfill-pattern-score.js) (`make_grid_data` 페이지네이션 + 28 dim 일괄 백필 — 188 유저 / 177 채워짐).

### 2026-05-30 — calcOhsorryCore v0.0.388 — textage 캐시 raw 호환 (시리즈 해시태그 robust)
- 증상: ohSorryWeb 의 PlayData 탭 진입 후 추천곡에 `#시리즈명` 안 보임.
- 원인: ohSorryWeb 의 `populatePlayData` 가 textage-meta 의 raw 전체 (`{generatedAt, count, songs}`) 를 `window.__ohsorryLibCache.textage` 로 set. calcOhsorryCore 는 `.songs` 직접 (= 곡 id → entry Map) 가정 → `Object.keys` 가 `['generatedAt', 'count', 'songs']` 3개만 → `textageSeriesByNorm` Map 비어있음.
- fix: calcOhsorryCore 의 0.55 단계 cache 처리에 형식 호환 추가 — `cached.songs && typeof cached.songs === 'object'` 면 그것만 사용. 두 형식 (raw / `.songs` 만) 모두 OK. ohSorryWeb 측도 별도로 `.songs` 만 캐시하도록 정정 (양쪽 fix).

### 2026-05-30 — calcOhsorryCore v0.0.387 — 추천곡 해시태그에 `#시리즈명` 추가
- 효과: 추천 row hover/토스트의 해시태그에 그 곡이 수록된 시리즈명 (예: `#EPOLIS`, `#INFINITAS`, `#1st&substream`) 이 카테고리 (`#어려움` 등) 다음, FLIP/한손위주 앞에 추가됨.
- 흐름:
  - `SERIES_NAME_URL` 상수 추가 — gist `30c3ba6.../series-name.json` (`{ "99":"NEW", "98":"INFINITAS", "33":"...", ..., "1":"..." }`).
  - 0.56 단계에서 series-name.json fetch + `window.__ohsorryLibCache.seriesNames` memory 캐시 (zasa/textage 와 동일 패턴).
  - 1단계 (곡명 정규화) 직후 `textageSeriesByNorm` Map 빌드 — `textageSongs.<id>.series_no` (parseTextage 가 채움) 를 `norm(title)` 키로 인덱싱.
  - `computeRecHashtags(r)` 안에서 `textageSeriesByNorm.get(norm(r.title))` → `seriesNames[String(series_no)]` lookup. 미매핑/실패 시 skip.
- 사전 조건: ohSorryAdmin `parseTextage` v2026-05-30 (`metaSongs[id].series_no` 필드 채움) + textage-meta gist 재업로드. 옛 textage-meta (series_no 필드 없음) 로는 시리즈 태그가 모든 row 에 안 붙음.

### 2026-05-29 — calcOhsorryCore v0.0.386 — layoutMap key 를 raw title 로 변경 (norm 불일치 해소)
- v0.0.385 의 `__pdLayoutMap[norm(c.title) + '|' + c.diff]` 가 ohSorryWeb 의 `normFnPd(window.OhsorryNorm.norm, 강한 norm)` 와 매칭 안 됨 — ohSorry compute 안의 `norm` (line 384) 은 간이 norm (lowercase + 공백 제거) 이고 ohSorryWeb 은 OhsorryNorm 의 강한 norm 이라 두 결과가 다름.
- fix: key 를 raw title (`c.title + '|' + c.diff`) 로 변경. ohSorryWeb 도 같은 키로 lookup.

### 2026-05-29 — calcOhsorryCore v0.0.385 — 추천 풀 배치 라벨을 result.layoutMap 으로 export
- ohSorryWeb 의 PlayData 탭에서 "배치 ON" 토글 시 NOTES 컬럼에 best 배치 라벨 (예: `M/-`, `F M/N`) 을 표시할 수 있도록 compute 의 closure 에 `__pdLayoutMap` 추가.
  - compute body 시작부에 `const __pdLayoutMap = {}` 선언.
  - 추천 풀 (`pool`) 의 chart 마다 `c.layoutLabel = w8.bestLabel` 채울 때 `__pdLayoutMap[norm(c.title) + '|' + c.diff] = c.layoutLabel` 동시에 기록.
  - result 객체에 `layoutMap: __pdLayoutMap` 추가.
- 한계: 추천 풀에 들어간 chart 만 (= patternScore > 0). 모든 chart 는 아님. ohSorryWeb 에서 비어있는 chart 는 `-` 로 fallback.

### 2026-05-29 — 시리즈 폴더 fetch 시 songs.series_no 자동 갱신 — eagateFetch / dbConn v0.0.409
- 사전 조건: ohSorryAdmin `sql/migrate_20260529_bump_song_series.sql` 적용 (`bump_song_series(int[], int)` RPC).
- [eagateFetch.js](modules/eagateFetch.js) `parseSeriesDoc(doc, seriesNo)` — chart entry 에 `seriesNo` 필드 (= eamuse `list` value + 1, 1~33 = ohSorryWeb `series-name.json` 키와 일치) 채움. `collectBySeries` 의 호출 측이 `sn + 1` 전달.
- [dbConn.js](modules/dbConn.js) `upsertUserChartScores` — row 의 `seriesNo` 가 있으면 song_id 별로 시리즈 그룹 모음. score upsert 완료 후 시리즈마다 `bump_song_series(p_song_ids, p_series_no)` 호출 → 그 곡들의 `songs.series_no` 를 명시값으로 무조건 덮어쓰기. 실패해도 graceful (score upsert 자체는 성공으로 처리, `console.warn` 만 출력).
- 효과: 시리즈 폴더 전곡 fetch 한 번이면 eamuse 시리즈 분류 = DB series_no 가 정정됨. 옛 textage VER 기반 시드와 새 series-name.json 매핑 (1~33) 의 시프트 차이도 자동 보정. ohSorryWeb 플레이데이터 탭의 시리즈 폴더 그룹화가 정확해짐.

### 2026-05-29 — INF 유저 연습곡 추천 차트 단위 정확 필터 (legen 비트맵) — calcOhsorryCore v0.0.384 / dbConn v0.0.408
- 직전 v0.0.382 의 곡 단위 (charts_json title set) 필터는 곡은 INF 수록인데 LEG 차트만 미수록인 케이스 (예: `鏡像都市` — `ac=3 legen=0`) 를 못 거르던 한계.
- fix: ohSorryWeb [api.js](../ohSorryWeb/modules/api.js) `makeChartSeriesChecker` 와 동등한 차트 단위 비트맵 검사 ohSorry 본체에도 적용.
  - **[dbConn](modules/dbConn.js)** — songsCache fetch 의 select 에 `legen` 컬럼 추가 + cache entry 에 포함. `getSongsByNorm()` 외부 export 신설 (`Map<normKey, [{ song_id, title, ac, legen }]>`).
  - **[calcOhsorryCore](modules/calcOhsorryCore.js)** — `buildWeaknessRecs` 정의 직전 compute scope 에 `isInfChartInSeries(title, chartName)` 헬퍼 정의. INF 유저 (`isInfData` or `iidx_id` 첫 글자 알파벳) 면 `OhsorryDb.getSongsByNorm()` 결과로 `chartName === 'DP_LEG'/'SP_LEG'` → `songs.legen & 2`, 그 외 → `songs.ac & 2` 검사. songs 캐시 fetch 실패 시 charts_json title set fallback (곡 단위).
  - candidate loop 안 검사 위치를 `cn` (chartName) 루프 안으로 이동 → 차트 단위 정확 차단.
- 효과: 곡은 INF 수록인데 LEG 만 미수록인 케이스도 정확히 제외. AC 유저 경로는 isInfUser=false 라 fetch / 필터 모두 skip — 기존 동작 그대로 유지.

### 2026-05-28 — 연습곡 기본 ☆ 범위 −0.1 회귀 fix (EC 이상으로 인정) — calcOhsorryCore v0.0.383
- 증상: 12.4 까지 깬 유저의 기본 범위 max 가 12.3 으로, 12.6 유저는 12.5 로 −0.1 낮게 잡힘.
- 원인: 직전 v0.0.381 의 `practiceZasaDefault` 가 `WEAKNESS_CLEAR_LAMP` (= 4, NC 이상) 기준으로 topClearZasa 산정 → EC 만 한 12.4 / 12.6 곡이 누락되어 다음 NC 곡이 max 로 채택.
- fix: `practiceZasaDefault` IIFE 안의 lampNum 비교를 `>= 3` (EC 이상, 사용자 인지의 "깼다") 으로 변경. `WEAKNESS_CLEAR_LAMP` 상수 자체는 `buildWeaknessRecs` 의 다른 안전장치 용도 (절벽 상한 + uc.lampNum 검사) 라 NC 기준 그대로 유지.

### 2026-05-28 — INF 유저 연습곡 추천에서 INF 미수록곡 차단 — calcOhsorryCore v0.0.382
- 증상: INF 유저 (`iidx_id` 첫 글자 알파벳 또는 `dbData.series === 'INF'`) 의 연습곡 추천 (`buildWeaknessRecs`) 에 AC 전용 곡이 섞여 나오던 회귀.
- 원인: candidate 풀이 `patternsMap` 전체 (= AC + INF + 미수록 모두) — `allCharts` 에 없는 곡 (사용자가 안 친 신규 패턴곡) 도 의도적으로 포함하기 때문에 INF 미수록도 자연스럽게 후보로 들어감.
- fix: 서열표 ([ohsorryShelf](modules/ohsorryShelf.js)) 의 INF 분기 정신 (`charts_json` 안 곡만 base) 을 그대로 차용. INF 유저면 `allCharts` 의 title 들을 `norm()` 한 `Set` 만들어, candidate loop 진입 직후 `infTitleSet.has(norm(title))` 통과 못 한 곡 skip. AC 유저 / 게스트 모드는 `infTitleSet === null` 로 기존 동작 유지.
- 한계: 곡 단위 필터링이라 곡은 INF 수록인데 LEG 차트만 미수록인 케이스는 못 거름 (ohSorryWeb 의 `songs.legen` 비트맵 같은 차트 단위 데이터가 본체에는 없음). 추후 [dbConn](modules/dbConn.js) songsCache 에 `legen` 추가 + export 하면 정확화 가능.

### 2026-05-28 — 연습곡 기본 ☆ 범위 = [topClearZasa−1, topClearZasa] — calcOhsorryCore v0.0.381
- 기존: `practiceZasaDefault` 가 게임레벨 (`maxClearGameLevel`) 기준 4단계 하드코딩 (12+→11.6~12.7 등).
- 변경: 사용자가 EC 이상 클리어한 차트 중 zasa 최고값 (`topClearZasa`) 을 먼저 구해 `{ min: topClearZasa − 1, max: topClearZasa }` 반환. 게임레벨이 같아도 사용자별 실제 클리어 zasa 에 정확히 붙음.
- fallback: 클리어 이력이 없어 `topClearZasa === 0` 이면 기존 게임레벨 기반 4단계 fallback 유지 (신규 유저용).
- float 정밀도: `+(topClearZasa − 1).toFixed(1)` 로 정리 → `.5999...` 같은 부동소수 오차 차단.

### 2026-05-28 — 추천곡 순서 변경 (연습곡 → EASY → HARD → EX-HARD) — ohsorryRender v0.0.378
- 사용자 요청 — 연습곡 추천이 클리어 추천 (EC/HC/EXH) 위로 올라오도록 [ohsorryRender.js](modules/ohsorryRender.js) `renderRec` 호출 순서 재배치.

### 2026-05-28 — README 추천곡 섹션 현재 동작에 맞춰 다시 작성
- 옛 설명 (3-pool 2:5:3 / 도전 offset 동적 / 클리어 인구 top 10 + 랜덤 5 셔플) → 현 코드 (effectiveBase + d 기반 풀 / `_clearScore` 8-component 가중합 / cleanup 50/50 다양성 보정 / slot 분배 4:4:2 또는 EXH 8:1:1).
- _clearType (#한끗 / #점수도전 / #검증곡 / #적합) 분류 의미 + low 모드 + 토글 옵션 + 차트 표시 (prefix / 곡명 색 조건) 정리.

### 2026-05-28 — 복습곡 토글 + 배치추천 토글 좌측에 붙도록 정렬 — ohsorryRender v0.0.377
- 두 토글 모두 `rec-review-toggle` 의 `margin-right: auto` 가 적용돼 첫 토글이 두 번째를 오른쪽 끝으로 밀어내던 문제.
- `.rec-layout-toggle` 만 `margin-right: 0; margin-left: 12px` 로 override → 복습곡 옆에 바로 붙음.

### 2026-05-28 — 오소리웹 (다크) 환경의 토글 active 색 가독성 — ohsorryRender v0.0.376
- **`복습곡 포함` / `배치추천 ON` 토글의 active 색**이 본체 (밝은 테마) 기준 검정 (#212529) — 오소리웹 다크 배경에서 안 보이는 문제.
- **`.__users_card #__dp_score_panel .rec-review-toggle.active` override 추가** — 다크 wrapper 한정으로 `#e9ecef` (밝은 색) 적용.

### 2026-05-28 — 곡명 색 / "ereter 미등록" tooltip 조건 fix — calcOhsorryCore v0.0.380 / ohsorryRender v0.0.375
- **증상**: 클리어 추천 곡명 색 (lv11 초록 / lv12 하늘) + tooltip "ohSorry 추정 ★ ereter 미등록" 이 ereter 등록 차트에도 적용 (= 모든 lv11/12 차트에 색).
- **원인**: 직전 commit (v0.0.378 의 game level prefix fix) 에서 `gameLevel` 을 모든 차트에 채우게 했더니, ohsorryRender 의 titleStyle / tooltip 조건이 `r.gameLevel === 11/12` 단일로 판단 → ereter 등록 차트도 색 입혀짐. 원래 `gameLevel` 자체가 "ohSorryRating-only" marker 였는데 그 의미가 prefix 요구로 깨짐.
- **fix**: 별도 flag `ratingOnly` 분리. prefix (12A) 는 `gameLevel` 로 모든 차트, 색/tooltip 은 `ratingOnly` 로 ohSorryRating only 차트만.

### 2026-05-28 — 클리어 추천에도 배치추천 토글 추가 — calcOhsorryCore v0.0.379 / ohsorryRender v0.0.374
- **클리어 추천 (EC/HC/EXH) 의 복습곡 토글 옆에 "배치추천 ON/OFF" 토글 신규** — 같은 `rec-review-toggle` 스타일.
  - ON (기본) → 8 배치 (mirror + flip) 평가 → best 배치 선택 + misfinger penalty 자동 반영.
  - OFF → 정규 N/N 강제 (chartStrengthMatch8Way 에 `flipOn: false, mirrorOn: false` 전달).
- **[calcOhsorryCore]** `layoutModeForClear` closure 변수 + `chartStrengthMatchByHand` 가 OFF 시 정규 강제 opts 전달. `__dp_rerollRecs(stage, base, lvMode, djMode, layoutMode)` 시그니처 확장.
- **[ohsorryRender]** `recLayoutMode` 상태 + `window.__dp_setRecLayoutMode` setter. `rerenderRecStage` 호출 시 layoutMode 전달.

### 2026-05-28 — 클리어 추천 row 의 game level prefix 누락 fix — calcOhsorryCore v0.0.378
- **증상**: 클리어 추천 (EC/HC/EXH) 의 chart letter 앞 game level prefix 가 ereter 등록 차트 (대부분 lv12 ANO 등) 에서 누락 ("12A" → "A"). 미등록 차트 (ratingMap 만 있는 lv11/12 신곡) 는 정상 "11A" 표시.
- **원인**: `buildPools` 의 `let gameLevel = null` 초기값이 ereter 분기에서 override 되지 않음 (ratingMap fallback 분기에서만 `r.gameLevel` 로 채움).
- **fix**: `let gameLevel = (typeof c.gameLevel === 'number') ? c.gameLevel : null` — allCharts 단계 textage meta 보강에서 이미 채워진 `c.gameLevel` 을 기본값으로 사용.

### 2026-05-28 — 8 배치 misfinger penalty — calcWeakness 무리배치 차트 후순위 자연 강등
- **`chartStrengthMatch8Way` 의 각 배치 result.total 에서 misfinger penalty 차감** — patterns-all-slim 의 m1/m2 `MISFINGER` 컬럼 활용 (ohSorryRating 새 metric).
  - 가중치 — strong (k12/k67) × 0.5 + rand × 0.15 (강도 순서 k12/k67 > rand).
  - 손/mirror 조합 별 키셋 자동 선택: 왼손 mirror=no → k67 / mirror=yes → k12 (오른손 반대). flip 영향 없음 (손가락 매핑은 키보드 기준 고정).
- **`strengthRaw` / `penalty` 별도 노출** — best 결정은 strength − penalty 기준 (= 무리 적은 배치가 자동 best). 디버그/비교는 `opts.misfingerOn=false`.
- **`chartWeaknessMatch8Way` bestTotal = −strengthRaw − penalty** — penalty 가 strength / weakness 양쪽 score 다 깎음 (= 무리배치 차트는 약점 보완 정렬에서도 후순위).
- 효과: lv12 평균 무리 62회 × 0.5 ≈ −31 penalty. WHA / CODE:Ø / Like+it! 같은 무리배치 끝판왕 차트는 추천 정렬에서 강등. WHA 의 best 배치는 "−/M" (오른손만 mirror, k12=231 → k67=172) 자연 선택.

### 2026-05-28 — 연습곡 목표 점수 DJ LEVEL 보장 — calcOhsorryCore v0.0.377 / ohsorryRender v0.0.373
- **`nextDjTarget()` 신규** — 현재 EX score 의 다음 DJ LEVEL (E/D/C/B/A/AA/AAA) 도달 점수 산출. `targetRate / targetExScore` 가 적어도 다음 DJ 랭크는 보장하도록 강화.
- **`_targetExScore` / `_targetDjLevel` / `_currentExScore`** 노출 — render 가 "현재 EX → 목표 EX (djLevel)" 형식 표시 가능.
- **[ohsorryRender] tags row goal 표시** — `data-goal` attribute + display:flex 로 우측 정렬. 곡명 클릭 시 hashtag + 목표 동시 노출 (좌: 태그 / 우: `현재 → 목표 (DJLV)`).

### 2026-05-28 — 연습곡 목표 점수 + 쌍미러 표기 — calcOhsorryCore v0.0.376
- **`_targetRate` / `_targetExScore` 신규** — 연습곡 row 에 강도별 목표 EX rate / EX 점수 산출.
  - 강도별 step: 가볍게 +2 / 적당히 +3 / 빡세게 +4 (현재 rate 대비)
  - 하한: `binMean - 1.5` (zasa bin 평균 근처 보장)
  - 상한: 98% clamp
  - `_targetExScore = noteCount × 2 × _targetRate / 100`
  - 안 친 곡 (rate=null) 은 `binMean` 만으로 target 산출
- **hashtag `#양미러` → `#쌍미러`** — 표기 통일.

### 2026-05-28 — low 모드 토글 라벨 "DP11-" — ohsorryRender v0.0.372
- 저레벨 유저 (`recBaseStar < 0.5` low 모드) 클리어 범위 토글 라벨 `DP8~10` → `DP11-` (DP11+ 와 짝). tooltip 도 "게임 LEVEL 11 미만 중심 추천".

### 2026-05-28 — 연습곡 ☆ 범위 라벨 다크 테마 가독성 — ohsorryRender v0.0.370
- 연습곡 zasa 범위 입력 옆 "☆ ~" 라벨 색 `#555 → #e9ecef` + `font-weight:600`. 다크 배경에서 잘 보이도록.

### 2026-05-27 — 클리어 추천 row 에도 game level prefix — ohsorryRender v0.0.368
- chart letter 앞 game level prefix (예: "11H", "12A") 표시 조건을 `_category === 'weakness'` 한정에서 **모든 row** 로 확장 (`typeof r.gameLevel === 'number'`).
- 효과: 클리어 추천 (EC/HC/EXH) 에서도 게임 레벨 한눈에 — DP12 / DP11+ / low 모드 결과 구분 쉬워짐.

### 2026-05-27 — 사용자 게임레벨 적응 (low 모드 / 연습곡 zasa / HC/EXH 가드) — calcOhsorryCore v0.0.375 / ohsorryRender v0.0.367
- **`maxClearGameLevel` 산정** — `allCharts` 중 `lampNum ≥ 3` (EC 이상) 클리어한 차트의 `gameLevel` 최댓값. 추천 풀 / 연습곡 기본 범위에 모두 활용.
- **'low' 모드 허용 레벨 동적** — 기존 고정 lv8~10 → `maxClearGameLevel` 기반:
  - ≥ 12 → `[10, 11, 12]` (이미 12 까지 깬 유저는 더 위 레벨)
  - ≥ 11 → `[10, 11]`
  - 그 외 → `[8, 9, 10]` (신규 / 초보)
- **low 모드 추출 흐름 신규** — 게임레벨별 균등 분배 (12 제외 main 레벨 각각 ≈ `(10-targetLv12)/N`) + lv12 1곡 + 부족분 채움 + `djMode='on'` 시 reached 보충.
- **연습곡 기본 ☆ 범위 동적** (`practiceZasaDefault`):
  - max ≥ 12 → `11.6 ~ 12.7`
  - max ≥ 11 → `10.0 ~ 12.1`
  - max ≥ 10 → `8.0 ~ 10.9`
  - 그 외 → `5.9 ~ 10.0`
  - UI input placeholder 도 그 값으로. core 가 `practiceZasaDefault` 노출, ohsorryRender 가 받아서 활용.
- **HC / EXH 가드** — `recBaseStar < 0.5` 면 HC/EXH 추천 빈 배열. reroll 도 동일 가드. 신규 유저 (★ 측정 안 됨) 는 EC + low 모드 + 연습곡 만 노출.
- **`_hideDiffValue`** — low 모드 fallback (zasa/ratingMap 미수록 lv8~10 차트의 임의 estEc/Hc/Exh) 시 차트 item 에 플래그. ohsorryRender 가 `★--` (회색) + tooltip "EC/HC/EXH 지표 없음" 으로 표시 (정확 추정값 아닌데 ★ 숫자 표시 안 함).
- **ohsorryRender v0.0.367** — 연습곡 zasa input 기본값 `practiceZasaDefault` 로, low 모드일 때 추천 토글 라벨 "DP11+" → "DP8~10" + tooltip.
- 효과: 사용자 게임레벨에 맞춰 추천 풀 / 연습곡 범위 자동 조정. 신규 유저 / 저레벨 유저는 HC/EXH 비노출, low 모드 + 적정 zasa 로 진입 부담 완화.

### 2026-05-27 — 클리어 추천 _clearScore 점수식 + 'low' 모드 + 연습곡 기본 zasa 11.6~12.7 — calcOhsorryCore v0.0.374 / ohsorryRender v0.0.366
- **클리어 추천 정렬 → `_clearScore` 점수식 desc**. 기존 `bestTotal × _starWeight` 또는 단순 `bestTotal` 대체.
  - `diffFit × 0.24` (`|diffValue - baseStar|` 거리 감쇠, stage 별 폭 EXH 3.2 / EC/HC 2.4)
  - `lampFit × 0.18` (그 stage 미달 lamp 갭이 작을수록 큼; reached 도달이면 0.74 고정)
  - `rateFit × 0.18` (현재 EX rate 가 stage target 근처면 큼 — EXH 89 / HC 82 / EC 74, 폭 10/12/14)
  - `countFit × 0.14` (그 stage 클리어 인원 log10 정규화)
  - `layoutFit × 0.14` (8 way best 의 bestTotal 정규화)
  - `layoutGainFit × 0.06` (mirror/flip 으로 정규 대비 향상폭)
  - `djFit × 0.06` (현재 dj 레벨 F~AAA → 0~1)
  - `categoryBoost` (cleanup +0.10 / easy +0.04 / hard -0.03 — 정리곡 우선)
- **`_clearType` 분류** — `near-lamp` / `score-ready` / `popular` / `fit`. hashtag `#램프근접 / #점수충분 / #검증곡` + `#가능성높음 (≥0.72) / #도전권 (<0.45)`.
- **최종 추출 변경** — 옛 SLOTS (hard 2 / easy 4 / cleanup 4 + fallback) 폐기, **underLamp 우선 + clearScore desc takeFrom** 으로 교체.
  - `djMode='off'` → underLamp 10곡
  - `djMode='on'` → underLamp 8 + reached 2
  - EXH 는 `cleanup ≤ 10 + easy 1 + hard 1` (정리곡 위주), EC/HC 는 `cleanup 4 + easy 4 + hard 2` (부족 시 3+3+2)
- **'low' 추천 모드 신규** — `recBaseStar < 0.5` 시 자동 진입. gameLevel 8~10 만, lv 별 base ec/hc/exh fallback (zasa 데이터 없는 lv8~10 신규 유저 보호). 분류: lv8=cleanup, lv9=easy, lv10=hard.
- **`buildPools` 차트 item 에 추가 필드** — `lampNum / djLevel / exScore / noteCount / scoreRate`. `_clearScore` 계산에 필요.
- **`CATEGORY_TAG_MAP.cleanup = '정리곡'`** — 표기 생략 → 명시.
- **연습곡 기본 zasa 11.6~12.7 고정** — 옛 자동 범위 (baseStar 기준) 폐기, `PRACTICE_ZASA_MIN/MAX` 상수. UI input 비우면 placeholder 11.6/12.7 그대로.
- **ohsorryRender v0.0.366** — "추천 범위" → "클리어 범위" 라벨. 'low' lvMode 활성 표시 (DP11+ 와 같이 active). 연습곡 zasa 기본값 11.6/12.7 placeholder 로 복원.
- 효과: 클리어 점수식이 명시적으로 "클리어 가능성 큰 곡" 우선화. low 모드로 신규 유저 (★ <0.5) 도 lv8~10 곡 추천 가능. 연습곡 범위는 직관적 lv12 기본.

### 2026-05-27 — '연습곡' 알고리즘 재설계 — calcOhsorryCore v0.0.373 / ohsorryRender v0.0.365
- 탭/라벨 명명 변경: **약점보완 → 연습곡**, 합산 → 건반, 강도 1/2/3 → **가볍게/적당히/빡세게**. zasaMin/Max 빈 칸 = "자동" (placeholder).
- 풀 확장: 친 곡만 → **친 곡 + 안 친 곡** (신규 패턴 곡 노출). `rate ≥ 95%` 곡 제외.
- 자동 zasa 범위: opts.zasaMin/Max 없으면 `baseStar - 0.7 ~ baseStar + (0.8/1.1/1.4 by 강도)`. `targetZasa` 도 강도별 풀 중심 위치.
- 점수식 `practiceScore` 가중합 (10 신호):
  - weakSignal × 0.32 (top 3 feature × `-userVec[f]` 가중평균)
  - patternScore × 0.18 (top 3 feature score 평균)
  - difficultyFit × 0.22 (`zasa` vs `targetZasa` 거리 감쇠)
  - deficitScore × 0.18 (bin 평균 대비 못 친 정도)
  - unplayedBonus 0.16 / lampNeed 0.12 / alreadyGoodPenalty -0.18
  - layoutAssistScore × 0.08 / layoutGainScore × 0.08 / layoutPracticeScore × 강도별
- `practiceType` 분류 (review / pattern / score / practical) + quota slicing — `review 30% + pattern 30% + score 20% + practical 나머지` 다양성 강제.
- mode 분리 강화: `CHARGE` / `SCRATCH` / `SOF-LAN` 서로 안 섞임 (반대 raw pt 가진 곡 제외).
- 배치 hashtag: `#FLIP / #좌미러 / #우미러 / #양미러` + `#연습 + #복습/#패턴연습/#점수회복/#실전연습`.
- **calcWeakness.js**: `chartStrengthMatch8Way.bestTotal` 반환을 `bestKey(best)` 로 변경 — handMode='left'/'right' 일 때 L/R 만 정렬 키로 (handMode='both' 동일).
- 효과: 약점 + 신규 + 점수회복 + 실전이 균형 잡힘, 한쪽 편향 완화.

### 2026-05-27 — 약점보완 알고리즘 vec 잔차 약점 + 강점 보완 우선 — calcOhsorryCore v0.0.372
- `buildWeaknessRecs` 풀 진입 조건 강화:
  - 기존: zasa bin 평균 대비 `deficit > 0` (못 친 곡) 모두 풀
  - **추가**: 사용자 vec 잔차 음수 (`userVec[f] < 0`) feature 가 곡 top 3 (feats subset 의 feature score 큰 top 3) 안에 하나라도 있어야 풀 진입
  - 해석: "이 곡 못 친 이유가 내 약점 feature 라서일 가능성" 있는 곡만
- 정렬 — `deficit asc` (살짝 부족 → 큰 약점) 에서 **`bestTotal` desc (8 way best 강점 매치 desc)** 로 교체.
  - 의도: 그 곡의 다른 feature 가 사용자 강점이면 우선 (= 강점으로 보완 가능)
- 강도 1/2/3 의미 — `bestTotal` 정렬 위치. 1=앞 (가장 보완 잘 됨), 2=중간, 3=뒤 (가장 힘듦).
- 효과: "약점 feature 노출 + 강점으로 풀 만한" 곡 우선 표시.

### 2026-05-27 — 정리곡 50/50 다양성 보정 — calcOhsorryCore v0.0.371
- sample 15 안의 cleanup 분류 곡들 중 bestTotal 낮은 절반을 잘라내고, **cleanup 풀 전체의 `dv` asc top** (= 그 stage 추정 ★ 낮은 = 가장 쉬운 곡) 으로 교체.
- hard / easy 카테고리는 현행 그대로 bestTotal desc.
- 의도: 정리곡 추천이 사용자 강점 매치 곡만 우선하지 않고 "치기 쉬운 곡" 도 절반 보장 — 한쪽만 우선되는 편향 완화.

### 2026-05-27 — 클리어 추천 풀 / 정렬 재정의 — calcOhsorryCore v0.0.370
- **풀 분류 (`buildPools`)** — stage 별 `effectiveBase` + `d = max(0, topClearStar - effectiveBase)` 기반.
  - effectiveBase: EC=`baseStar - 0.5` / HC=`baseStar` / EXH=`baseStar + 2`
  - **EC/HC**: 정리곡 `[0, effectiveBase)` / 약도전 `[effectiveBase, effectiveBase + 0.7d)` / 강도전 `[effectiveBase + 0.7d, topClearStar + 0.3d]`. `dv > topClearStar + 0.3d` 풀 제외.
  - **EXH**: 정리곡만 `[0, effectiveBase)`. 약/강도전 분류 없음, `dv ≥ effectiveBase` 풀 제외.
  - d=0 (사용자가 effectiveBase 이상 클리어 없음) → 약/강도전 한 점 → 대부분 정리곡으로 채워짐.
- **정렬 (`sample15`)** — `bestTotal` desc 단순. `_starWeight` 감쇠 제거 (풀 자체가 좁아져 불필요). top 10 + random 5 → **top 15** (재현 가능, 랜덤 의존 없음).
- **buildExhRecs 제거** — EXH 도 `buildRecs(6, 'exh')` 로 통일. EXH 전용 별도 로직 (★ 거리 감쇠 fallback 등) 모두 제거.
- **useCutoff opts 제거** — EC fallback 케이스도 새 룰의 effectiveBase=baseStar-0.5 가 자동 처리. 풀 cutoff 자체가 사라짐.
- 효과: 추천 풀이 stage 별 의미에 맞게 좁혀짐. EC 는 사용자 ★ 보다 약간 쉬운 영역 (-0.5), HC 는 자기 ★, EXH 는 더 어려운 영역 (+2 미만의 정리곡만). 결과가 deterministic 해서 비교 / 디버그 편함.

### 2026-05-27 — 약점보완 알고리즘 zasa bin 기반 재설계 — calcOhsorryCore v0.0.369
- **알고리즘 교체** — 기존 (calcWeakness 잔차 × FEATS dot product 매치) → **zasa 0.1 단위 bin 안 사용자 평균 rate 대비 deficit 기반**.
  - 사용자가 친 곡 (rate>0) 만 풀 — 안 친 곡은 bin 평균 + 추천 풀 둘 다 제외.
  - `binMean(bk)` = zasa 0.1 단위 bin 의 사용자 EX rate 평균. bin 곡 < 10 이면 양쪽 이웃 bin (±0.1, ±0.2, ... ±3.0 까지) 결합.
  - `deficit = binMean - rate`. deficit > 0 (bin 평균보다 못 친 곡) 만 풀 진입.
  - 곡 top 3 feature 추출 (7 feature 안에서) — 표시/태그 용. mode 'all' 풀은 단일 풀 (분류 X).
- **강도 토글 의미 변경** — 1=소(작은 deficit, 살짝 부족) / 2=중(median 부근) / 3=대(큰 deficit, 큰 약점). pool deficit asc 정렬 후 startIdx 위치 결정.
- **mode (all/CHARGE/SCRATCH/SOF-LAN)** — 기존 그대로. 단일 mode 도 동일 알고리즘 (그 feature raw pt 강한 곡만 풀).
- **[modules/calcOhsorryCore.js](modules/calcOhsorryCore.js) v0.0.369** — `FEATURE_SCORES_URL` fetch 추가 (`featureScoresMap`). `buildWeaknessRecs` 재구현 (1단계 candidates 수집 → 2단계 bin 평균 → 3단계 deficit 풀 + top3 분류 → 4단계 강도 위치 slice → 5단계 `_matchByHand` 배치추천 라벨 표시용). 잔차 × dot product 매치 (`chartWeaknessMatchByHand`/`chartWeaknessMatch8Way` 호출) 약점보완에서 제거.
- 효과: 약점보완 추천이 "fluffy 잔차" 가 아닌 "구체적 곡 EX rate" 기준 → 어떤 곡 어떻게 못 쳤는지 직관적. zasa lv 비슷한 곡끼리 비교라 lv 별 편차 영향 없음.

### 2026-05-27 — 8 배치 추천 (mirror + flip 조합) — calcOhsorryCore v0.0.368 / ohsorryRender v0.0.364
- 추천 곡 옆에 배치 라벨 표시 (`M/-`, `-/M`, `M/M`, `F`, `F M/-`, `F -/M`, `F M/M`). 정규(N/N) 면 라벨 없음. 8 배치 중 best 의 라벨이 핑크 배지로 노출.
- **[modules/calcWeakness.js](modules/calcWeakness.js)** — `MIRROR_STEMS` (STAIR_UP/DN + K1~K7), `applyMirror` (UP↔DN swap, DENSITY reverse), 새 18 dim vec 산출 (residual × m1/m2 가중평균), `chartStrengthMatch8Way` + `chartWeaknessMatch8Way` (정규+mirror+flip 조합 8 배치 평가).
- **[modules/calcOhsorryCore.js](modules/calcOhsorryCore.js) v0.0.368** — `chartStrengthMatchByHand` wrapper 가 새 `chartStrengthMatch8Way` 우선 사용 (옛 gist fallback 유지). `_matchByHand` 에 `bestLabel` / `best.{flip,mL,mR}` 노출. `computeRecHashtags` 의 `#FLIP+N` 제거 (label 로 대체). 약점보완 `buildWeaknessRecs` 도 8 배치 — `flipOn` 토글이 `mirrorOn` 도 같이 ON/OFF (ON=8 배치 best, OFF=정규 N/N 강제).
- **[modules/ohsorryRender.js](modules/ohsorryRender.js) v0.0.364** — 추천 row 의 FLIP 핑크 배지를 `bestLabel` 출력으로 교체 (정규 시 미표시). 약점보완 토글 라벨 `FLIP` → `배치추천` (8 배치 추천 ON/OFF 의미).
- **데이터 의존** — patterns-all-slim.json 의 `m1` / `m2` (정규 mirror metric, ohSorryRating Stage A) + user_ohsorry_radars 의 18 신규 컬럼 (ohSorryAdmin migration + ohSorryRating Stage B backfill). 셋이 모두 갱신돼야 작동.

### 2026-05-27 — 약점보완 한 줄 UI 높이 통일 + 레벨 입력 앞 배치 (ohsorryRender v0.0.363)
- 약점보완 한 줄 컨트롤 (select / number input / FLIP 토글) 모두 `height:22px; box-sizing:border-box` 로 통일 — 브라우저 native 렌더 차이로 시각적 높이 제각각이던 문제 해소.
- 순서 재배치 — `☆ min ~ max → 모드 → 곡수 → FLIP → 손 → 강도`. 레벨 입력이 가장 앞으로 (사용 빈도 높을 것으로 가정).
- 공통 스타일 변수화 (`wkCtl` / `wkInput` / `wkSelect` / `wkFlipOn` / `wkLabel`) — 동일 값 반복 인라인 정리.

### 2026-05-27 — 약점보완 zasa 범위 입력 (calcOhsorryCore v0.0.367 / ohsorryRender v0.0.362)
- **calcOhsorryCore v0.0.367** ([modules/calcOhsorryCore.js](modules/calcOhsorryCore.js)) — `buildWeaknessRecs` opts 에 `zasaMin` / `zasaMax` 추가. number 일 때만 적용, 기존 `topClearZasa` 상한 + ★ 거리 cutoff 와 **AND 결합** (모두 통과해야 풀 진입). 초기 호출 default `11.6 ~ 12.7` (lv12 zasa 분포 중심).
- **ohsorryRender v0.0.362** ([modules/ohsorryRender.js](modules/ohsorryRender.js)) — 약점보완 한 줄 UI 에 `☆ [number] ~ [number]` input 두 칸 추가 (step 0.1, value 11.6 / 12.7). `__dp_weakness_setZasaMin` / `__dp_weakness_setZasaMax` setter, `weaknessOpts.zasaMin/Max` 초기값 11.6 / 12.7. input 비우면 NaN → undefined → 해당 방향 필터 해제 (자동 cutoff 만 동작).

### 2026-05-27 — 추천 ★ 거리 cutoff 안전망 + EC fallback 보호 (calcOhsorryCore v0.0.366)
- v0.0.364 의 ★ 거리 cutoff (weight=0 곡 풀 제외) 가 baseStar 가 매우 작거나 풀이 협소한 사용자에서 추천을 통째로 비워버리는 문제 수정.
- **EC fallback (recBaseStar==null) 케이스 cutoff 끔** — OSR 미산정 신규 유저는 `EC_FALLBACK_BASE = 0.3` 으로 EC 만 계산되는데, ★ 거리 3 cutoff 때문에 lv11/12 풀이 통째로 빠지던 문제. `buildRecs` 호출 시 `useCutoff: false` 전달.
- **cutoff 안전망** — `buildRecs` / `buildExhRecs` 에서 cutoff 후 풀이 비면 자동으로 원본 풀 (cutoff 전) 그대로 사용. 저실력 유저 (★8 이하 등) 의 풀 협소 케이스도 보호.
- `window.__dp_rerollRecs` (EC reroll) 도 동일 옵션 적용.

### 2026-05-27 — 약점보완 풀에서 recLevelMode 분리 (calcOhsorryCore v0.0.365)
- 일반 추천 (EC/HC/EXH) 의 `recLevelMode` (lv12 / lv11+12 / all) 토글이 약점보완에도 영향 주던 부작용 제거.
- `buildWeaknessRecs` 시그니처에서 `recLevelMode` 인자 제거 — 호출자 (default + reroll) 도 정리.
- 약점보완 풀은 `topClearZasa` 상한 + ★ 거리 cutoff 만으로 자체 좁힘.

### 2026-05-27 — 추천 정렬 ★ 거리 감쇠 + baseStar 상한 제거 (calcOhsorryCore v0.0.364)
- **gameLevel 별 zasaLevel 평균 lookup** — `ohSorryRatings` (lv11/12) + `zasaData` (lv1~10) 합쳐서 산출. 차트에 zasa 가 없을 때 fallback.
- **getEffectiveStar / starDistanceWeight 헬퍼** — `weight = max(0, 1 - |chart★ - baseStar| / STAR_DISTANCE_W)`, W=3.
- **baseStar ★ 상한 제거** —
  - `buildPools` (EC/HC) 의 `hardMax = hi + 1.0` 제거, hard 카테고리 `[hardMin, +∞)` 로 개방.
  - `buildExhRecs` 의 `hardMax = baseStar + 1.0` cut 제거. 거리 감쇠가 자동 cutoff (weight=0 → 정렬 제외).
- **추천 정렬에 ★ 거리 weight 적용** (EC/HC/EXH):
  - `chartStrengthMatchByHand.bestTotal × starDistanceWeight` 으로 desc 정렬.
  - weight=0 곡은 풀에서 제외 (baseStar±W 안의 곡만).
- **약점보완** — 점진학습 정렬 (`bestTotal asc`) 보호. 거리 weight 는 **cutoff 만** 적용 (weight=0 곡 풀 제외, 곱셈 X). `topClearZasa` 상한은 그대로.
- **약점보완 zasa fallback** — ratingMap 매칭 안 되는 차트도 `zasaAvgByGameLv[gameLevel]` 로 e.level 채워서 풀 진입 가능 (ec/hc/exh 는 null).

### 2026-05-27 — 약점보완 토글 UI 한 줄 압축 (ohsorryRender v0.0.361)
- 5라인 라디오 → 한 줄 dropdown (모드/곡수/손/강도) + FLIP 토글 버튼.
- 옛 5라인 정의는 코드 안에 JS 블록 주석으로 보존 (필요 시 복구).
- FLIP 토글 버튼 — 클릭 시 active 반전, active 면 핑크 fill / 비활성 면 회색 outline. `__dp_weakness_setFlip` 이 inline style 도 같이 갱신.
- 동작/setter 변경 없음 — `__dp_weakness_setMode/setTopN/setFlip/setHand/setStrength` 그대로 호출.

### 2026-05-27 — 약점보완 토글 확장 + ★ 상한 정책 교체 (calcOhsorryCore v0.0.363 / ohsorryRender v0.0.360 / calcWeakness)
- **calcWeakness** ([modules/calcWeakness.js](modules/calcWeakness.js)) — `chartStrengthMatchByHand` / `chartWeaknessMatchByHand` 에 `opts.flipOn` (default true) + `opts.handMode` (`'both'`/`'left'`/`'right'`, default `'both'`) 추가. `best`/`bestTotal` 만 영향 (L/R/total/flipL/flipR/flipTotal raw 는 항상 그대로). `flipOn: false` 면 flip 비교 안 함 (normal 강제). `handMode: 'left'` 면 매치 합계가 왼손 (`sL` / `sFlipL`) 만, `'right'` 면 오른손만.
- **calcOhsorryCore v0.0.363** ([modules/calcOhsorryCore.js](modules/calcOhsorryCore.js)) — `buildWeaknessRecs` 정책 교체:
  - **★ 상한 정책 변경** — `baseStar + 0.5` → 사용자가 EC 이상 (`lampNum >= 4`) 클리어한 차트의 `zasaLevel` 최댓값 (`topClearZasa`) 이하만 통과. "지금 칠 수 있는 최고 난이도" 안에서 약점보완. 클리어 없으면 `topClearZasa = 0` → 상한 없음.
  - **flipOn / handMode opts 실제 동작** — `chartWeaknessMatchByHand` 호출에 전달, 매치 점수가 옵션에 맞춰 산출.
  - **연습 강도 (`strength` opts)** — offset 단계. `offset = (strength - 1) × topN`, `slice(offset, offset + topN)`. 강도 1 = top N, 강도 2 = N+1 ~ 2N, 강도 3 = 2N+1 ~ 3N.
  - `WEAKNESS_REC_RANGE` 제거, `WEAKNESS_CLEAR_LAMP = 4` 추가.
- **ohsorryRender v0.0.360** ([modules/ohsorryRender.js](modules/ohsorryRender.js)) — 약점보완 토글 UI 3종 추가:
  - **FLIP** : on | off — `window.__dp_weakness_setFlip(true/false)`
  - **손** : 양손 | 왼손 | 오른손 — `window.__dp_weakness_setHand('both'/'left'/'right')`
  - **강도** : 1 | 2 | 3 — `window.__dp_weakness_setStrength(N)`
  - 모든 토글이 `weaknessOpts` 갱신 후 `window.__dp_rerollWeakness` 부분 재렌더.

### 2026-05-27 — 약점보완 추천 stage 추가 (calcOhsorryCore v0.0.362 / ohsorryRender v0.0.359 / calcWeakness)
- **calcWeakness** ([modules/calcWeakness.js](modules/calcWeakness.js)) — `chartStrengthMatchByHand` / `chartWeaknessMatchByHand` 에 `opts.feats` 추가. feature subset 으로 매치 점수 계산 가능 (단일 mode 약점보완에서 활용).
- **calcOhsorryCore v0.0.362** ([modules/calcOhsorryCore.js](modules/calcOhsorryCore.js)) — `buildWeaknessRecs` 추가. `chartWeaknessMatchByHand.bestTotal` (= -strength) 기반, bestTotal 양수 차트만 채택 후 asc 정렬 (점진학습 — 약점 살짝 드러나는 곡부터).
  - 모드: `all` (NOTES/CHORD/PEAK/PHRASE/JACK/TRILL/RAND 7개, SOF-LAN/SCRATCH/CHARGE 제외) / `CHARGE` / `SCRATCH` / `SOF-LAN` 단일.
  - mode 별 raw pt 필터로 풀 구성 (합산 모드는 SOF-LAN raw>0 / CHARGE raw>0 / SCRATCH raw≥6.35(p70) 제외).
  - **★ 상한 `WEAKNESS_REC_RANGE = 0.5`** — `estEc/Hc/Exh` 중 어느 하나라도 `baseStar + 0.5` 이하인 차트만 통과 (유저 실력 기준 점진학습).
  - 별개로 EXH 추천 (`buildExhRecs`) 도 `buildRecs` 재사용에서 분리 — `baseStar + 1` 이하 단순 풀 + 손 분리 + FLIP 매치 desc top 10.
  - `CATEGORY_TAG_MAP` 에서 `cleanup` (정리곡) hashtag 표기 생략.
- **ohsorryRender v0.0.359** ([modules/ohsorryRender.js](modules/ohsorryRender.js)) — `약점보완` stage 렌더 추가 (`#ff6b9d` 핑크).
  - 모드 토글 (합산/차지/스크/소프란) + 곡수 토글 (5/10/20). `window.__dp_rerollWeakness(opts)` 로 부분 재렌더.
  - 약점보완 row 는 ★ 안 보임 (실력값 비교 무관) → chart letter 앞에 게임 lv prefix (예: `11H`) 로 lv 정보 보충.
  - 추천 row tooltip 통합 — hashtag + 게임 lv 11/12 추정 ★ 안내를 한 `title` 속성에 합침 (자식 element title 우선 회피).

### 2026-05-26 — 추천곡 row 추천 이유 hashtag (calcOhsorryCore v0.0.348 / ohsorryRender v0.0.348)
- **calcOhsorryCore v0.0.348** — `_hashtags` 캐시. 순서: `#강도전/약도전/정리곡` (sample15 분류) + `#FLIP+N` (best === 'flip' 일 때 flipTotal − total 차이) + `#왼손위주/오른손위주` (best 배치의 L/R 편차 ≥ 30%) + pattern feature top 3 (`#동치 #계단 #밀도 #순간밀도 #축연타 #트릴 #스크 #변속 #롱잡 #난타`).
- **ohsorryRender v0.0.348** — 추천 row hover 시 title 속성으로 hashtag 한 줄 표시. 곡명 클릭 시 토스트 (renderChartRow) 하단에 같은 hashtag 가 핑크 (#ff6b9d) row 로 한 줄 추가.

### 2026-05-26 — 추천곡 정렬 손 분리 + FLIP 매치 (calcOhsorryCore v0.0.347 / ohsorryRender v0.0.347 / calcWeakness)
- **calcWeakness** ([modules/calcWeakness.js](modules/calcWeakness.js) / [calcWeakness.md](modules/calcWeakness.md)) — 양손 분리 vec (`__vecL` / `__vecR`) + 신규 함수 `chartStrengthMatchByHand` / `chartWeaknessMatchByHand` / `computePatternScoreVec`.
  - `chartStrengthMatchByHand(chartPt, vecL, vecR)` → `{L, R, total, max, flipL, flipR, flipTotal, flipMax, best, bestTotal}` — 정규 배치 (왼손=p1 / 오른손=p2) + FLIP 배치 (양손 바꿈) 둘 다 평가. `bestTotal` = 더 잘 맞는 배치의 total.
  - `computePatternScoreVec` — chart_score × score_rate top 30 가중합 통합 (ohSorryRating backfill / ohSorry dbConn / INFOhSorry 가 같은 알고리즘 공유).
- **calcOhsorryCore v0.0.347** ([modules/calcOhsorryCore.js](modules/calcOhsorryCore.js)) — `sample15` 정렬 (EC/HC/EXH) 을 `chartStrengthMatch` 양손 평균 → `chartStrengthMatchByHand` 의 `bestTotal` desc 로 교체. 차트 객체에 `_matchByHand` 캐시 (UI 가 FLIP 권장 표시 등에 활용). 옛 gist (vecL/vecR 미보유) 면 양손 평균 fallback.
- **ohsorryRender v0.0.347** ([modules/ohsorryRender.js](modules/ohsorryRender.js)) — 추천곡 row 의 곡명 옆에 `_matchByHand.best === 'flip'` 일 때 작은 핑크 `FLIP` 배지 표시 (FLIP 배치 권장 마크, `#ff6b9d` 액센트).

### 2026-05-25 — analysisRender v0.0.12 — 기여곡 표 곡 점수 = quantile score (featureScores opts)
- [modules/analysisRender.js](modules/analysisRender.js) — `opts.featureScores` 옵션 추가. 있으면 차트별 quantile score (`feature-scores-slim.json`, dbConn v0.0.407 백필과 동일 데이터) lookup → 정렬/표시. 없으면 `c.pt` (calcWeakness raw 양손 평균) fallback.
- 기여곡 표 제목 "강점 기여 Top 3" / "약점 기여 Top 3" → **"Top 3"** 으로 통일 (라벨 색만 강점/약점 구분).
- 호출자 (ohSorryWeb users.js, INFOhSorry Analysis.tsx) 가 `feature-scores-slim.json` fetch → opts 로 전달.

### 2026-05-25 — analysisRender v0.0.11 — 기여곡 표 Top 3 + 곡 점수 표시
- [modules/analysisRender.js](modules/analysisRender.js) — 강점/약점 기여곡 표 둘 다 **Top 3** 으로 통일.
- 정렬: `c.pt` desc (그 feature 가 가장 강한 차트 — `calcWeakness` 의 raw 양손 평균 pt).
- 표시: 오른쪽 컬럼 `vRel pt` → `곡 점수 (c.pt)` 로 변경. 컬럼 헤더도 "득점/감점" → "곡 점수" 통일.
- 라벨 색만 강점 (`#28a745` 초록) / 약점 (`#dc3545` 빨강) 구분, 정렬/표시는 동일.

### 2026-05-25 — analysisRender v0.0.10 — 배율 전부 제거 (헤더 detail score 잔차 기준 통일)
- [modules/analysisRender.js](modules/analysisRender.js) — `buildDetailHTML` 의 `__absoluteSkill` + `normalizeSkill` 분기 제거. 헤더 score (`피처이름 옆 NN.Npt`) / `vRel` / `isPos` 모두 잔차 기준 (`(userVec[k] || 0) + 80`) 으로 통일.
- `NORMALIZE_ANCHORS` 정의 + `normalizeSkill` 함수 통째 삭제 (dead code).
- 막대그래프는 v0.0.9 에서 이미 잔차 기반. 이제 분석탭 전체가 같은 단위 (잔차) 로 표시됨.

### 2026-05-25 — dbConn v0.0.407 — pattern 점수 알고리즘 재설계 (quantile score 평균)
- [modules/dbConn.js](modules/dbConn.js) — `uploadResult` 5단계 (pattern vec upsert) 가 **차트별 precomputed quantile score** (gist 의 `feature-scores-slim.json`, [ohSorryRating dump-feature-scores.js](../ohSorryRating/scripts/dump-feature-scores.js) 산출) 기반으로 변경.
- 알고리즘: `make_grid_data` RPC 의 plays 차트마다 (`textage_song_id`, `diff`) → `feature-scores` lookup → feature 별 `sum(score) / count(score>0)` → `upsert_user_pattern_vec` RPC.
- `score=0` 인 곡은 분모 제외 (CHARGE/SOF-LAN/SOF-LAN-ratio 의 baseline 0 곡 + 다른 feature 의 raw=0 곡).
- 이전 v0.0.406 (절대 실력값 = patterns raw pt × rate%, push 안 됐었음) 제거 — 사용자 의도와 안 맞음. user_radars `os_*` 컬럼이 이제 plays 차트의 quantile score 평균 (0~100, 정규화된 의미).
- RPC schema (`upsert_user_pattern_vec`) 는 그대로 — 10 feature (NOTES/CHORD/PEAK/CHARGE/SCRATCH/SOF-LAN/PHRASE/JACK/TRILL/RAND). SOF-LAN-ratio 는 별도 컬럼 없어서 미저장.

### 2026-05-25 — analysisRender v0.0.9 — 막대그래프 잔차 기반으로 복구
- [modules/analysisRender.js](modules/analysisRender.js) — `buildBarChart` 의 `__absoluteSkill` + `NORMALIZE_ANCHORS` (Q-Q hinge 매핑) 분기 제거. `userVec[f.k]` (잔차 분석 결과) 의 사용자 평균 대비 상대값으로 표시.
- 헤더 detail score / `normalizeSkill` / `NORMALIZE_ANCHORS` 정의는 그대로 유지 (다른 곳 활용 여지).
- gist 마스터 (ohSorryWeb + INFOhSorry 양쪽이 fetch) — **INF오소리 분석탭 막대그래프도 같이 영향**.
- ohSorry repo 에 처음 add (이전엔 gist 만 관리).

### 2026-05-25 — dbConn v0.0.405 — songs 마스터 자동 등록 (ensure_song RPC)
- [modules/dbConn.js](modules/dbConn.js) — `upsertUserChartScores` 에서 신곡 (songs 마스터 미등록) 이 eagate 에서 들어오면 `ensure_song` RPC 로 자동 INSERT.
- `ac` 비트 (1=AC, 2=INF) 자동 결정: playedVersion 0=INF→2, 그 외=AC→1. `LEGGENDARIA` 차트는 `legen` 비트만, 그 외는 `ac` 비트만 set.
- RPC 실패 (SQL 미적용 / 권한 X) 시 graceful — 기존처럼 unmatched skip. songs cache 도 즉시 갱신 → 같은 곡의 다른 차트 row 가 재매칭됨.
- `callRpc` 헬퍼 — 응답 body parse 추가 (JSON / text / null), `ensure_song` 의 song_id 반환값 받기 위함.
- 사전 조건: [ohSorryAdmin setup_song_master.sql](../ohSorryAdmin/sql/setup_song_master.sql) 의 `ensure_song` RPC 적용 (anon GRANT 포함).

### 2026-05-25 — ohsorryRender v0.0.347 — 프로필 카드 쿠프로 아래 "오소리웹으로 이동" 링크
- [modules/ohsorryRender.js](modules/ohsorryRender.js) — 프로필 카드의 쿠프로 이미지 아래에 `오소리웹으로 이동` 링크 추가. 클릭 시 새 탭으로 `https://ohsorry.vercel.app/#user@{iidxId}` (해당 유저 카드) 이동.
- 레이아웃: 기존 `.profile-img` 한 칸을 `.profile-img-col` (flex-direction: column) 으로 감싸 쿠프로 + 링크 세로 배치. qproImg 또는 iidxId 둘 다 없으면 wrapper 자체 생략.
- 색: 링크 `#666` (회색) / hover `#212529` (어두운 회색). font-size 10px.
- own 모드 / rival 모드 양쪽 다 동일하게 표시 — rival 모드 시 그 라이벌의 iidxId 로 링크 (rivalOhsorry 의 batch 종료 목록 행 클릭 흐름과 동일 URL).

### 2026-05-25 — rivalOhsorry — 라이벌 목록 단위 색 본체 프로필 카드와 통일
- [modules/rivalOhsorry.js](modules/rivalOhsorry.js) — `renderRivalList` 의 dp_rank 표시 색을 `ohsorryRender.js` 프로필 카드 `rankStyle` 와 동일 규칙으로 변경. 기존에는 무조건 `#ff9bce` (핑크) 였음.
  - 皆伝 / 中伝 → 금빛 / 은빛 shimmer 그라데이션 (CSS `rank-kaiden` / `rank-chuden` 키프레임 `#__dp_rival_list` 스코프로 inline 주입)
  - 9段·10段 (九段·十段) → `#dc3545` (빨강) / 1~8段 → `#1971c2` (파랑) / 一級~九級 / 미지정 → `#6c757d` (회색)
- `rankToKanji(r)` → `rankInfo(r)` 로 교체. `{ label, color, cls }` 반환. string (이미 한자) 입력도 받음 — 한자 매칭으로 색 분류.

### 2026-05-25 — ohsorry wrapper v3.3.9 — 라이벌 페이지에서 자동 rival 모드 (레벨 선택 가능)
- [ohsorry.js](ohsorry.js) — 본체 wrapper 가 URL 의 `?rival=<토큰>` 감지 시 자동으로 `Core.compute({mode:'rival', rivalToken})` 호출. 라이벌 페이지 (`difficulty_rival.html?rival=...`) 띄워둔 상태에서 본체 북마크렛 / 콘솔 한 줄 그대로 실행하면 그 라이벌 데이터를 긁어옴.
- rivalOhsorry wrapper 와 차이 — 기존 rivalOhsorry 는 시리즈 (전곡) 만 긁었지만, 본체 wrapper 의 rival 모드는 기존 레벨/시리즈 선택 모달을 그대로 유지 → 라이벌 데이터도 LEVEL 11·12 만 빠르게 받기 가능. eagateFetch 가 `isRival`/`rivalToken` 받아서 `difficulty_rival.html` + `&rival=<토큰>` 으로 fetch URL 자동 전환.
- 모달 title 만 라이벌 모드면 "라이벌 오소리 — 곡 데이터 불러오기" 로 분기, 그 외 동작/UI 동일. IIDX prompt / batch / 라이벌 목록 패널 은 rivalOhsorry 전용 (본체는 단일 라이벌만).
- dbData 모드 (ohSorryWeb 게스트 페이지 등) 는 영향 없음 — URL 체크 자체를 건너뜀.

### 2026-05-25 — rivalOhsorry — batch 종료 시 라이벌 목록 패널 + ohSorryWeb 새 탭
- [modules/rivalOhsorry.js](modules/rivalOhsorry.js) — `__dp_batch_rival_by_iidx` 변경. 각 라이벌 처리 후 ohsorryRender 패널 그리지 않음 (첫 compute 후 `OhsorryRender.show` 임시 swap → no-op). supabase upsert (uploadResult) 는 그대로.
- 모든 라이벌 처리 끝나면 `renderRivalList` — 행 = `djname / iidxid / dp단위 (한자)`. 행 클릭 시 `https://ohsorry.vercel.app/#user@{iidxid}` 새 탭 open.
- 첫 라이벌의 잔여 패널 (`#__dp_score_panel`) 정리.

### 2026-05-25 — rivalOhsorry — 레벨 선택 모달 제거 (무조건 시리즈)
- [modules/rivalOhsorry.js](modules/rivalOhsorry.js) — `askFetchOptions` 의 레벨별/전곡 선택 UI 제거. 무조건 `{ fetchMode: 'series', levels: undefined }` 반환.
- 호출처 (`__dp_batch_rival_by_iidx` / `__dp_render_rival`) 흐름 그대로 유지 (Promise 시그니처).

### 2026-05-25 — dbConn v0.0.404 — pattern vec supabase upsert
- [modules/dbConn.js](modules/dbConn.js) — `uploadResult` 의 5단계로 `callUpsertPatternVec` 추가. `result.userVec` (calcOhsorryCore step2 의 rateRef 기준 vec) 을 supabase `user_radars` 의 `os_*` 10 컬럼에 upsert (DP row 만).
- 사전 조건: [ohSorryAdmin setup_users.sql](../ohSorryAdmin/sql/setup_users.sql) (user_radars os_* 10컬럼 포함) + [setup_pattern_vec_rpc.sql](../ohSorryAdmin/sql/setup_pattern_vec_rpc.sql) 적용.
- 용도: ohSorryWeb 분석탭의 사용자 percentile (`get_pattern_vec_percentiles` RPC) 비교 분포 누적.

### 2026-05-25 — calcWeakness analyzeFeature default topN 5 → 30
- [modules/calcWeakness.js](modules/calcWeakness.js) — `analyzeFeature` 의 `topN` default 늘림. UI 는 보통 top 5 만 표시하지만 contributors 의 나머지가 추천곡 fallback 풀로 활용 가능 (ohSorryWeb 분석탭에서 기여곡 Top 5 외 차트를 추천곡 부족분 채움).

### 2026-05-25 — calcWeakness rateRef (absolute reference) 옵션 + calcOhsorryCore 통합
- [modules/calcWeakness.js](modules/calcWeakness.js) — `calcUserWeakness` / `analyzeFeature` 에 `rateRef` 옵션 추가. rateRef 있으면 self-relative bucketMean 대신 absolute reference (★ × 0.5 bucket → 평균 EX rate) 기준 잔차 분석 → 사용자간 vec 직접 비교 가능. bucket 영역 밖은 lowest/highest bucket clamp.
- [modules/calcOhsorryCore.js](modules/calcOhsorryCore.js) — `rate-reference-slim.json` (gist 신규) fetch + `calcUserWeakness` 에 rateRef 전달. 실패 시 self-relative fallback.
- rateRef 데이터: ohSorryRating 의 3550명 ereter-fetched plays 평균 (isotonic monotonic). [ohSorryRating README](../ohSorryRating/README.md) 참고.
- 본체 추천 동작 영향 없음 — vec 가 self-relative 든 absolute 든 ordering 비슷.

### 2026-05-25 — calcOhsorryCore userVec 계산 시 zasaMap 전달 (lv10 차트 포함)
- [modules/calcOhsorryCore.js](modules/calcOhsorryCore.js) — `calcUserWeakness` 호출에 `zasaMap: zasaData` 추가. calcWeakness 가 ratingMap 미수록 lv10 차트도 zasa level 기반 임의 estEc/Hc/Exh 로 잔차 분석 풀에 포함.
- 본체 추천 동작 영향 없음 — userVec 정확도만 향상.

### 2026-05-25 — calcWeakness analyzeFeature 추천곡 entry 에 bucketMean 추가 + 기여중 곡 풀에서 제외 + totalContrib 노출
- [modules/calcWeakness.js](modules/calcWeakness.js) — `analyzeFeature` 의 recommends entry 에 `bucketMean` (estEc/Hc/Exh 3 bucket 평균의 평균) 노출. ohSorryWeb 분석 탭이 "현재 EX → 목표 EX (+차이)" 표기로 그 차트 feature 기여 가능 점수 시각화에 사용.
- 추천 풀 필터 강화 — 이미 bucketMean 이상 친 곡 (residual >= 0, 강점 기여중) 은 추천 의미 없어 제외. 기존엔 rate >= 95% 만 제외.
- `totalContrib` (Σ byChart.contrib) return 값 추가 — UI 가 feature 별 현재 누적 기여를 기여곡 row 와 같은 스케일로 표시.
- 본체 추천 동작 영향 없음 — analyzeFeature 만 사용 (calcOhsorryCore 미사용).

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
